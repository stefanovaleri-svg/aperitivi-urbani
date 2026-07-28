import { getCollection, type CollectionEntry } from "astro:content";

import type { CmsBindings } from "./bindings";
import type { DisclosureKind } from "./types";

type LegacyLocale = CollectionEntry<"locali">;

export type PublicLocaleEntry = {
  id: string;
  data: LegacyLocale["data"] & {
    listing_id?: string;
    creator_handle?: string;
    esperienze?: string[];
    directions_url?: string | null;
    booking_url?: string | null;
    disclosure_kind?: DisclosureKind;
  };
  body?: string;
  legacyEntry?: LegacyLocale;
};

function safeJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function disclosureFromMarkdown(data: LegacyLocale["data"]): DisclosureKind {
  const captions = data.visite
    .map((visit) => visit.caption)
    .join("\n")
    .toLowerCase();
  if (/(^|\s)#invito\b/.test(captions)) return "invited";
  if (/(^|\s)#gifted\b|\bgifting\b/.test(captions)) return "gifted";
  if (/(^|\s)#affiliate\b|\baffiliate link\b/.test(captions)) return "affiliate";
  if (/(^|\s)#(?:adv|ad|sponsored)\b/.test(captions)) {
    return "paid_sponsorship";
  }
  return data.sponsorizzato ? "unknown" : "none";
}

function mediaPublicUrl(row: Record<string, unknown>): string | null {
  if (row.storage_provider === "r2") return `/media/${String(row.id)}`;
  return null;
}

async function listFromMarkdown(): Promise<PublicLocaleEntry[]> {
  const entries = await getCollection("locali");
  return entries.map((entry) => {
    const disclosureKind = disclosureFromMarkdown(entry.data);
    return {
      id: entry.id,
      data: {
        ...entry.data,
        voto_dedotto: null,
        visite: entry.data.visite.map((visit) => ({ ...visit, voto: null })),
        esperienze: [],
        disclosure_kind: disclosureKind,
      },
      body: entry.body,
      legacyEntry: entry,
    };
  });
}

async function listFromD1(
  db: D1Database,
  siteKey: string,
): Promise<PublicLocaleEntry[]> {
  const result = await db
    .prepare(
      `SELECT
         l.id AS listing_id,
         l.source_post_url,
         l.sponsored_disclosure,
         v.slug,
         v.name,
         v.city,
         v.neighborhood,
         v.address,
         v.latitude,
         v.longitude,
         v.venue_types_json,
         v.price_band,
         v.mentioned_items_json,
         v.sentiment,
         v.inferred_rating,
         v.sponsored,
         v.directions_url,
         v.booking_url,
         c.handle AS creator_handle,
         MAX(vs.visited_on) AS latest_visit,
         GROUP_CONCAT(DISTINCT et.slug) AS experience_slugs
       FROM listings l
       JOIN venues v ON v.id = l.venue_id
       JOIN creators c ON c.id = l.creator_id
       JOIN white_label_sites s ON s.id = l.site_id
       LEFT JOIN visits vs ON vs.listing_id = l.id
       LEFT JOIN listing_experience_tags let ON let.listing_id = l.id
       LEFT JOIN experience_tags et
         ON et.id = let.experience_tag_id
        AND et.active = 1
        AND et.dimension <> 'legacy_type'
       WHERE l.status = 'published'
         AND s.site_key = ?
         AND s.status = 'active'
         AND s.creator_id = c.id
         AND c.status = 'active'
         AND c.license_status = 'active'
         AND c.license_revoked_at IS NULL
         AND (
           c.license_starts_at IS NULL
           OR c.license_starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         )
         AND (
           c.license_ends_at IS NULL
           OR c.license_ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         )
       GROUP BY l.id, v.id, c.id
       ORDER BY COALESCE(MAX(vs.visited_on), l.published_at) DESC, v.name COLLATE NOCASE`,
    )
    .bind(siteKey)
    .all<Record<string, unknown>>();

  return (result.results ?? []).map((row) => {
    const latest = row.latest_visit == null ? "" : String(row.latest_visit);
    return {
      id: String(row.listing_id),
      data: {
        slug: String(row.slug),
        nome: String(row.name),
        zona: row.neighborhood == null ? null : String(row.neighborhood),
        indirizzo: row.address == null ? null : String(row.address),
        citta: String(row.city),
        tipo: safeJsonArray(row.venue_types_json) as LegacyLocale["data"]["tipo"],
        fascia_prezzo:
          row.price_band == null
            ? null
            : (String(row.price_band) as LegacyLocale["data"]["fascia_prezzo"]),
        piatti_drink_citati: safeJsonArray(row.mentioned_items_json),
        sentiment:
          row.sentiment == null
            ? null
            : (String(row.sentiment) as LegacyLocale["data"]["sentiment"]),
        voto_dedotto: null,
        sponsorizzato:
          Number(row.sponsored) === 1 ||
          !["none", "unknown"].includes(String(row.sponsored_disclosure)),
        visite: [
          {
            data: latest,
            post_url: String(row.source_post_url ?? "https://www.instagram.com/"),
            caption: "",
            foto: [],
            fonte_tipo: "singola",
            sponsorizzato: false,
          },
        ],
        foto: [],
        instagram_url:
          row.source_post_url == null ? null : String(row.source_post_url),
        lat: row.latitude == null ? undefined : Number(row.latitude),
        lng: row.longitude == null ? undefined : Number(row.longitude),
        listing_id: String(row.listing_id),
        creator_handle: String(row.creator_handle),
        esperienze:
          typeof row.experience_slugs === "string" && row.experience_slugs
            ? row.experience_slugs.split(",")
            : [],
        directions_url:
          row.directions_url == null ? null : String(row.directions_url),
        booking_url: row.booking_url == null ? null : String(row.booking_url),
        disclosure_kind: String(row.sponsored_disclosure) as DisclosureKind,
      },
    };
  });
}

export async function listPublicLocales(
  bindings: CmsBindings,
): Promise<PublicLocaleEntry[]> {
  if (bindings.PUBLIC_CONTENT_ENABLED === "false") return [];
  if (bindings.CONTENT_SOURCE !== "d1") return listFromMarkdown();
  if (!bindings.DB) throw new Error("CONTENT_SOURCE=d1 richiede il binding DB.");
  return listFromD1(
    bindings.DB,
    (bindings.SITE_CREATOR_HANDLE ?? "aperitivi-urbani").replace(/^@/, ""),
  );
}

async function getFromD1(
  db: D1Database,
  siteKey: string,
  slug: string,
): Promise<PublicLocaleEntry | null> {
  const row = await db
    .prepare(
      `SELECT
         l.id AS listing_id,
         l.source_post_url,
         l.attribution_text,
         l.editorial_text,
         l.sponsored_disclosure,
         v.*,
         c.handle AS creator_handle
       FROM listings l
       JOIN venues v ON v.id = l.venue_id
       JOIN creators c ON c.id = l.creator_id
       JOIN white_label_sites s ON s.id = l.site_id
       WHERE l.status = 'published'
         AND s.site_key = ?
         AND v.slug = ?
         AND s.status = 'active'
         AND s.creator_id = c.id
         AND c.status = 'active'
         AND c.license_status = 'active'
         AND c.license_revoked_at IS NULL
         AND (
           c.license_starts_at IS NULL
           OR c.license_starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         )
         AND (
           c.license_ends_at IS NULL
           OR c.license_ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         )
       LIMIT 1`,
    )
    .bind(siteKey, slug)
    .first<Record<string, unknown>>();
  if (!row) return null;

  const listingId = String(row.listing_id);
  const [visitResult, mediaResult, tagResult] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM visits
         WHERE listing_id = ?
         ORDER BY visit_index ASC`,
      )
      .bind(listingId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT m.*
         FROM media_assets m
         JOIN visits vs ON vs.id = m.visit_id
         WHERE vs.listing_id = ?
           AND m.storage_provider = 'r2'
           AND m.state = 'ready'
           AND m.rights_status = 'approved'
         ORDER BY m.is_hero DESC, m.sort_order, m.created_at`,
      )
      .bind(listingId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT et.slug
         FROM experience_tags et
         JOIN listing_experience_tags let ON let.experience_tag_id = et.id
         WHERE let.listing_id = ?
           AND et.active = 1
           AND et.dimension <> 'legacy_type'
         ORDER BY et.dimension, et.label COLLATE NOCASE`,
      )
      .bind(listingId)
      .all<{ slug: string }>(),
  ]);

  const mediaByVisit = new Map<string, string[]>();
  const gallery: string[] = [];
  for (const media of mediaResult.results ?? []) {
    const url = mediaPublicUrl(media);
    if (!url) continue;
    gallery.push(url);
    const visitId = String(media.visit_id);
    const items = mediaByVisit.get(visitId) ?? [];
    items.push(url);
    mediaByVisit.set(visitId, items);
  }

  const visits = (visitResult.results ?? []).map((visit) => ({
    data: visit.visited_on == null ? "" : String(visit.visited_on),
    post_url: String(visit.source_post_url),
    caption: String(visit.caption),
    foto: mediaByVisit.get(String(visit.id)) ?? [],
    issue:
      visit.source_issue_number == null ? undefined : Number(visit.source_issue_number),
    fonte_tipo: visit.source_kind === "lista" ? ("lista" as const) : ("singola" as const),
    sponsorizzato: Number(visit.sponsored) === 1,
    note_reel: null,
    sentiment:
      visit.sentiment == null
        ? null
        : (String(visit.sentiment) as LegacyLocale["data"]["sentiment"]),
    voto: null,
  }));

  return {
    id: listingId,
    body: row.editorial_text == null ? "" : String(row.editorial_text),
    data: {
      slug: String(row.slug),
      nome: String(row.name),
      zona: row.neighborhood == null ? null : String(row.neighborhood),
      indirizzo: row.address == null ? null : String(row.address),
      citta: String(row.city),
      tipo: safeJsonArray(row.venue_types_json) as LegacyLocale["data"]["tipo"],
      fascia_prezzo:
        row.price_band == null
          ? null
          : (String(row.price_band) as LegacyLocale["data"]["fascia_prezzo"]),
      piatti_drink_citati: safeJsonArray(row.mentioned_items_json),
      sentiment:
        row.sentiment == null
          ? null
          : (String(row.sentiment) as LegacyLocale["data"]["sentiment"]),
      voto_dedotto: null,
      sponsorizzato:
        Number(row.sponsored) === 1 ||
        !["none", "unknown"].includes(String(row.sponsored_disclosure)),
      visite: visits,
      foto: gallery,
      instagram_url:
        row.source_post_url == null ? null : String(row.source_post_url),
      lat: row.latitude == null ? undefined : Number(row.latitude),
      lng: row.longitude == null ? undefined : Number(row.longitude),
      listing_id: listingId,
      creator_handle: String(row.creator_handle),
      esperienze: (tagResult.results ?? []).map((tag) => tag.slug),
      directions_url: row.directions_url == null ? null : String(row.directions_url),
      booking_url: row.booking_url == null ? null : String(row.booking_url),
      disclosure_kind: String(row.sponsored_disclosure) as DisclosureKind,
    },
  };
}

export async function getPublicLocale(
  bindings: CmsBindings,
  slug: string,
): Promise<PublicLocaleEntry | null> {
  if (bindings.PUBLIC_CONTENT_ENABLED === "false") return null;
  if (bindings.CONTENT_SOURCE === "d1") {
    if (!bindings.DB) throw new Error("CONTENT_SOURCE=d1 richiede il binding DB.");
    return getFromD1(
      bindings.DB,
    (bindings.SITE_CREATOR_HANDLE ?? "aperitivi-urbani").replace(/^@/, ""),
      slug,
    );
  }
  const entries = await listFromMarkdown();
  return entries.find((entry) => entry.data.slug === slug) ?? null;
}
