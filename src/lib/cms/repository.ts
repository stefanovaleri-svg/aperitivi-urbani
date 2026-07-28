import type {
  AdminVenueSummary,
  CmsPrincipal,
  CreatorLifecyclePatch,
  CreatorLicenseStatus,
  CreatorStatus,
  SiteLifecyclePatch,
  SiteStatus,
  VenueDraftInput,
  VenuePatchInput,
} from "./types";

export class CmsConflictError extends Error {
  readonly status = 409;
}

export class CmsNotFoundError extends Error {
  readonly status = 404;
}

export class CmsPublishError extends Error {
  readonly status = 422;
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.issues = issues;
  }
}

function uuid(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function priceBand(priceTier: number | null | undefined): string | null {
  return priceTier == null ? null : "€".repeat(priceTier);
}

function resultChanged(result: D1Result<unknown> | undefined): boolean {
  return Number(result?.meta?.changes ?? 0) > 0;
}

function isUniqueConflict(error: unknown): boolean {
  return /unique constraint|SQLITE_CONSTRAINT_UNIQUE/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

function buildCreatorAndSiteBootstrap(
  db: D1Database,
  principal: CmsPrincipal,
  input: VenueDraftInput,
  requestId: string,
  timestamp: string,
): {
  normalizedHandle: string;
  siteKey: string;
  statements: D1PreparedStatement[];
} {
  const normalizedHandle = `@${input.creatorHandle.replace(/^@/, "").toLowerCase()}`;
  const siteKey = input.creatorHandle.replace(/^@/, "").toLowerCase();
  const creatorId = uuid("creator");
  const siteId = uuid("site");
  const creatorMutationId = uuid("mutation");
  const siteMutationId = uuid("mutation");

  return {
    normalizedHandle,
    siteKey,
    statements: [
      db
        .prepare(
          `INSERT INTO creators
            (
              id, slug, display_name, handle, primary_city, status,
              license_status, revision, last_mutation_id, created_at, updated_at
            )
           VALUES (?, ?, ?, ?, ?, 'onboarding', 'pending', 1, ?, ?, ?)
           ON CONFLICT(handle) DO NOTHING`,
        )
        .bind(
          creatorId,
          input.creatorHandle.replace(/[._]+/g, "-"),
          input.creatorDisplayName,
          normalizedHandle,
          input.city,
          creatorMutationId,
          timestamp,
          timestamp,
        ),
      db
        .prepare(
          `INSERT INTO audit_logs
            (id, principal_id, action, entity_type, entity_id, after_json, request_id)
           SELECT ?, ?, 'creator.create_onboarding', 'creator', id, ?, ?
           FROM creators
           WHERE id = ? AND last_mutation_id = ?`,
        )
        .bind(
          uuid("audit"),
          principal.id,
          JSON.stringify({
            id: creatorId,
            handle: normalizedHandle,
            status: "onboarding",
            licenseStatus: "pending",
          }),
          requestId,
          creatorId,
          creatorMutationId,
        ),
      db
        .prepare(
          `INSERT INTO white_label_sites
            (
              id, creator_id, site_key, display_name, city, status,
              revision, last_mutation_id, created_at, updated_at
            )
           SELECT ?, id, ?, ?, ?, 'draft', 1, ?, ?, ?
           FROM creators
           WHERE handle = ? COLLATE NOCASE
           ON CONFLICT(site_key) DO NOTHING`,
        )
        .bind(
          siteId,
          siteKey,
          input.creatorDisplayName,
          input.city,
          siteMutationId,
          timestamp,
          timestamp,
          normalizedHandle,
        ),
      db
        .prepare(
          `INSERT INTO audit_logs
            (id, principal_id, action, entity_type, entity_id, after_json, request_id)
           SELECT ?, ?, 'site.create_draft', 'white_label_site', id, ?, ?
           FROM white_label_sites
           WHERE id = ? AND last_mutation_id = ?`,
        )
        .bind(
          uuid("audit"),
          principal.id,
          JSON.stringify({
            id: siteId,
            siteKey,
            status: "draft",
            creatorHandle: normalizedHandle,
          }),
          requestId,
          siteId,
          siteMutationId,
        ),
    ],
  };
}

export async function listAdminVenues(db: D1Database): Promise<AdminVenueSummary[]> {
  const result = await db
    .prepare(
      `SELECT
         v.id AS venue_id,
         l.id AS listing_id,
         v.name,
         v.slug,
         v.city,
         v.neighborhood,
         l.status,
         l.creator_approval_status,
         c.handle AS creator_handle,
         l.revision,
         l.updated_at
       FROM listings l
       JOIN venues v ON v.id = l.venue_id
       JOIN creators c ON c.id = l.creator_id
       WHERE l.status <> 'archived'
       ORDER BY l.updated_at DESC, v.name COLLATE NOCASE`,
    )
    .all<Record<string, unknown>>();

  return (result.results ?? []).map((row) => ({
    venueId: String(row.venue_id),
    listingId: String(row.listing_id),
    name: String(row.name),
    slug: String(row.slug),
    city: String(row.city),
    neighbourhood: row.neighborhood == null ? null : String(row.neighborhood),
    status: row.status as AdminVenueSummary["status"],
    approvalStatus: row.creator_approval_status as AdminVenueSummary["approvalStatus"],
    creatorHandle: String(row.creator_handle),
    revision: Number(row.revision),
    updatedAt: String(row.updated_at),
  }));
}

export type AdminVenueRecord = Record<string, unknown> & {
  visits: Record<string, unknown>[];
  experience_tags: Record<string, unknown>[];
  media: Record<string, unknown>[];
};

export async function getAdminVenue(
  db: D1Database,
  venueId: string,
): Promise<AdminVenueRecord> {
  const row = await db
    .prepare(
      `SELECT
         v.*,
         l.id AS listing_id,
         l.site_id,
         l.creator_id,
         l.status AS listing_status,
         l.source_post_url,
         l.attribution_text,
         l.editorial_text,
         l.creator_approval_status,
         l.creator_approved_at,
         l.sponsored_disclosure,
         l.premium_status,
         l.published_at,
         l.revision AS listing_revision,
         c.id AS governance_creator_id,
         c.handle AS creator_handle,
         c.display_name AS creator_display_name,
         c.status AS creator_status,
         c.license_status AS creator_license_status,
         c.license_starts_at AS creator_license_starts_at,
         c.license_ends_at AS creator_license_ends_at,
         c.license_revoked_at AS creator_license_revoked_at,
         c.revision AS creator_revision,
         s.id AS governance_site_id,
         s.status AS site_status,
         s.revision AS site_revision
       FROM venues v
       JOIN listings l ON l.venue_id = v.id
       JOIN creators c ON c.id = l.creator_id
       JOIN white_label_sites s ON s.id = l.site_id
       WHERE v.id = ? AND l.status <> 'archived'
       LIMIT 1`,
    )
    .bind(venueId)
    .first<Record<string, unknown>>();
  if (!row) throw new CmsNotFoundError("Locale non trovato.");

  const listingId = String(row.listing_id);
  const [visits, tags, media] = await Promise.all([
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
        `SELECT t.id, t.slug, t.label, t.dimension
         FROM experience_tags t
         JOIN listing_experience_tags lt ON lt.experience_tag_id = t.id
         WHERE lt.listing_id = ?
         ORDER BY t.dimension, t.label COLLATE NOCASE`,
      )
      .bind(listingId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT m.id, m.visit_id, m.storage_provider, m.public_url, m.media_type,
                m.sort_order, m.is_hero, m.attribution_text, m.rights_status,
                m.original_filename, m.mime_type, m.byte_size, m.sha256, m.state
         FROM media_assets m
         JOIN visits vs ON vs.id = m.visit_id
         WHERE vs.listing_id = ? AND m.state <> 'deleted'
         ORDER BY m.is_hero DESC, m.sort_order, m.created_at`,
      )
      .bind(listingId)
      .all<Record<string, unknown>>(),
  ]);

  return {
    ...row,
    visits: visits.results ?? [],
    experience_tags: tags.results ?? [],
    media: media.results ?? [],
  } as AdminVenueRecord;
}

type CreatorLifecycleRow = {
  id: string;
  status: CreatorStatus;
  license_status: CreatorLicenseStatus;
  license_starts_at: string | null;
  license_ends_at: string | null;
  license_revoked_at: string | null;
  revision: number;
};

type SiteLifecycleRow = {
  id: string;
  status: SiteStatus;
  revision: number;
};

const CREATOR_STATUSES = new Set<CreatorStatus>([
  "prospect",
  "onboarding",
  "active",
  "paused",
  "archived",
]);
const CREATOR_LICENSE_STATUSES = new Set<CreatorLicenseStatus>([
  "pending",
  "active",
  "expired",
  "revoked",
]);
const SITE_STATUSES = new Set<SiteStatus>([
  "draft",
  "active",
  "paused",
  "archived",
]);

const CREATOR_STATUS_TRANSITIONS: Readonly<
  Record<CreatorStatus, ReadonlySet<CreatorStatus>>
> = Object.freeze({
  prospect: new Set<CreatorStatus>(["onboarding", "archived"]),
  onboarding: new Set<CreatorStatus>(["active", "paused", "archived"]),
  active: new Set<CreatorStatus>(["paused", "archived"]),
  paused: new Set<CreatorStatus>(["active", "archived"]),
  archived: new Set<CreatorStatus>(),
});

const CREATOR_LICENSE_TRANSITIONS: Readonly<
  Record<CreatorLicenseStatus, ReadonlySet<CreatorLicenseStatus>>
> = Object.freeze({
  pending: new Set<CreatorLicenseStatus>(["active", "revoked"]),
  active: new Set<CreatorLicenseStatus>(["expired", "revoked"]),
  expired: new Set<CreatorLicenseStatus>(["active", "revoked"]),
  revoked: new Set<CreatorLicenseStatus>(),
});

const SITE_STATUS_TRANSITIONS: Readonly<
  Record<SiteStatus, ReadonlySet<SiteStatus>>
> = Object.freeze({
  draft: new Set<SiteStatus>(["active", "archived"]),
  active: new Set<SiteStatus>(["paused", "archived"]),
  paused: new Set<SiteStatus>(["active", "archived"]),
  archived: new Set<SiteStatus>(),
});

function assertLifecycleTransition<T extends string>(
  entity: string,
  current: T,
  next: T,
  transitions: Readonly<Record<T, ReadonlySet<T>>>,
): void {
  if (next === current) return;
  if (!transitions[current].has(next)) {
    throw new CmsConflictError(
      `Transizione ${entity} non consentita: ${current} → ${next}.`,
    );
  }
}

async function getCreatorLifecycleRow(
  db: D1Database,
  creatorId: string,
): Promise<CreatorLifecycleRow> {
  const row = await db
    .prepare(
      `SELECT
         id, status, license_status, license_starts_at, license_ends_at,
         license_revoked_at, revision
       FROM creators
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(creatorId)
    .first<CreatorLifecycleRow>();
  if (!row) throw new CmsNotFoundError("Creator non trovato.");
  return row;
}

function creatorLifecycleResult(row: CreatorLifecycleRow) {
  return {
    id: row.id,
    status: row.status,
    licenseStatus: row.license_status,
    licenseStartsAt: row.license_starts_at,
    licenseEndsAt: row.license_ends_at,
    licenseRevokedAt: row.license_revoked_at,
    revision: Number(row.revision),
  };
}

export async function updateCreatorLifecycle(
  db: D1Database,
  principal: CmsPrincipal,
  creatorId: string,
  patch: CreatorLifecyclePatch,
  requestId: string,
) {
  const before = await getCreatorLifecycleRow(db, creatorId);
  if (!Number.isInteger(patch.revision) || patch.revision < 1) {
    throw new CmsConflictError("Revisione creator non valida.");
  }
  if (patch.status !== undefined && !CREATOR_STATUSES.has(patch.status)) {
    throw new CmsConflictError("Stato creator non valido.");
  }
  if (
    patch.licenseStatus !== undefined &&
    !CREATOR_LICENSE_STATUSES.has(patch.licenseStatus)
  ) {
    throw new CmsConflictError("Stato licenza creator non valido.");
  }

  const touchesLicense =
    patch.licenseStatus !== undefined ||
    patch.licenseStartsAt !== undefined ||
    patch.licenseEndsAt !== undefined;
  if (before.license_status === "revoked" && touchesLicense) {
    throw new CmsConflictError("La revoca della licenza creator è definitiva.");
  }

  const status = patch.status ?? before.status;
  const licenseStatus = patch.licenseStatus ?? before.license_status;
  const licenseStartsAt =
    patch.licenseStartsAt === undefined
      ? before.license_starts_at
      : patch.licenseStartsAt;
  const licenseEndsAt =
    patch.licenseEndsAt === undefined ? before.license_ends_at : patch.licenseEndsAt;
  const timestamp = nowIso();
  const licenseRevokedAt =
    licenseStatus === "revoked" ? before.license_revoked_at ?? timestamp : null;

  assertLifecycleTransition(
    "creator",
    before.status,
    status,
    CREATOR_STATUS_TRANSITIONS,
  );
  assertLifecycleTransition(
    "licenza creator",
    before.license_status,
    licenseStatus,
    CREATOR_LICENSE_TRANSITIONS,
  );
  if (
    licenseStartsAt &&
    licenseEndsAt &&
    String(licenseEndsAt) <= String(licenseStartsAt)
  ) {
    throw new CmsConflictError(
      "La fine della licenza deve essere successiva al suo inizio.",
    );
  }

  const changed =
    status !== before.status ||
    licenseStatus !== before.license_status ||
    licenseStartsAt !== before.license_starts_at ||
    licenseEndsAt !== before.license_ends_at ||
    licenseRevokedAt !== before.license_revoked_at;
  if (!changed) throw new CmsConflictError("Nessuna modifica lifecycle creator.");

  const mutationId = uuid("mutation");
  const after = {
    status,
    licenseStatus,
    licenseStartsAt,
    licenseEndsAt,
    licenseRevokedAt,
  };
  const results = await db.batch([
    db
      .prepare(
        `UPDATE creators
         SET status = ?,
             license_status = ?,
             license_starts_at = ?,
             license_ends_at = ?,
             license_revoked_at = ?,
             revision = revision + 1,
             last_mutation_id = ?,
             updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .bind(
        status,
        licenseStatus,
        licenseStartsAt,
        licenseEndsAt,
        licenseRevokedAt,
        mutationId,
        timestamp,
        creatorId,
        patch.revision,
      ),
    db
      .prepare(
        `INSERT INTO audit_logs
          (
            id, principal_id, action, entity_type, entity_id,
            before_json, after_json, request_id
          )
         SELECT ?, ?, 'creator.lifecycle_update', 'creator', ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM creators
           WHERE id = ? AND last_mutation_id = ?
         )`,
      )
      .bind(
        uuid("audit"),
        principal.id,
        creatorId,
        JSON.stringify(creatorLifecycleResult(before)),
        JSON.stringify(after),
        requestId,
        creatorId,
        mutationId,
      ),
  ]);
  if (!resultChanged(results[0])) {
    throw new CmsConflictError(
      "Il creator è stato modificato da un altro utente.",
    );
  }
  return creatorLifecycleResult(await getCreatorLifecycleRow(db, creatorId));
}

async function getSiteLifecycleRow(
  db: D1Database,
  siteId: string,
): Promise<SiteLifecycleRow> {
  const row = await db
    .prepare(
      `SELECT id, status, revision
       FROM white_label_sites
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(siteId)
    .first<SiteLifecycleRow>();
  if (!row) throw new CmsNotFoundError("Sito creator non trovato.");
  return row;
}

function siteLifecycleResult(row: SiteLifecycleRow) {
  return {
    id: row.id,
    status: row.status,
    revision: Number(row.revision),
  };
}

export async function updateSiteLifecycle(
  db: D1Database,
  principal: CmsPrincipal,
  siteId: string,
  patch: SiteLifecyclePatch,
  requestId: string,
) {
  const before = await getSiteLifecycleRow(db, siteId);
  if (
    !Number.isInteger(patch.revision) ||
    patch.revision < 1 ||
    !SITE_STATUSES.has(patch.status)
  ) {
    throw new CmsConflictError("Lifecycle sito non valido.");
  }
  assertLifecycleTransition(
    "sito",
    before.status,
    patch.status,
    SITE_STATUS_TRANSITIONS,
  );
  if (patch.status === before.status) {
    throw new CmsConflictError("Nessuna modifica lifecycle sito.");
  }

  const mutationId = uuid("mutation");
  const timestamp = nowIso();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE white_label_sites
         SET status = ?,
             revision = revision + 1,
             last_mutation_id = ?,
             updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .bind(patch.status, mutationId, timestamp, siteId, patch.revision),
    db
      .prepare(
        `INSERT INTO audit_logs
          (
            id, principal_id, action, entity_type, entity_id,
            before_json, after_json, request_id
          )
         SELECT ?, ?, 'site.lifecycle_update', 'white_label_site', ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM white_label_sites
           WHERE id = ? AND last_mutation_id = ?
         )`,
      )
      .bind(
        uuid("audit"),
        principal.id,
        siteId,
        JSON.stringify(siteLifecycleResult(before)),
        JSON.stringify({ status: patch.status }),
        requestId,
        siteId,
        mutationId,
      ),
  ]);
  if (!resultChanged(results[0])) {
    throw new CmsConflictError(
      "Il sito creator è stato modificato da un altro utente.",
    );
  }
  return siteLifecycleResult(await getSiteLifecycleRow(db, siteId));
}

export async function createVenueDraft(
  db: D1Database,
  principal: CmsPrincipal,
  input: VenueDraftInput,
  requestId: string,
) {
  const venueId = uuid("venue");
  const listingId = uuid("listing");
  const visitId = input.sourcePostUrl && input.visitCaption ? uuid("visit") : null;
  const timestamp = nowIso();
  const bootstrap = buildCreatorAndSiteBootstrap(
    db,
    principal,
    input,
    requestId,
    timestamp,
  );

  const statements: D1PreparedStatement[] = [
    ...bootstrap.statements,
    db
      .prepare(
        `INSERT INTO venues
          (id, slug, name, city, neighborhood, address, latitude, longitude,
           google_place_id, directions_url, booking_url, price_band, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        venueId,
        input.slug,
        input.name,
        input.city,
        input.neighbourhood,
        input.address,
        input.latitude,
        input.longitude,
        input.googlePlaceId,
        input.directionsUrl,
        input.bookingUrl,
        priceBand(input.priceTier),
        timestamp,
        timestamp,
      ),
    db
      .prepare(
        `INSERT INTO listings
          (id, site_id, creator_id, venue_id, status, source_post_url,
           attribution_text, editorial_text, creator_approval_status,
           creator_approved_at, sponsored_disclosure, created_at, updated_at)
         VALUES (
           ?,
           (
             SELECT s.id
             FROM white_label_sites s
             JOIN creators c ON c.id = s.creator_id
             WHERE s.site_key = ? AND c.handle = ? COLLATE NOCASE
           ),
           (
             SELECT id FROM creators WHERE handle = ? COLLATE NOCASE
           ),
           ?,
           'draft', ?, ?, ?, ?, ?, ?, ?, ?
         )`,
      )
      .bind(
        listingId,
        bootstrap.siteKey,
        bootstrap.normalizedHandle,
        bootstrap.normalizedHandle,
        venueId,
        input.sourcePostUrl,
        input.attributionText,
        input.editorialText,
        input.creatorApprovalStatus,
        input.creatorApprovedAt,
        input.disclosureKind,
        timestamp,
        timestamp,
      ),
  ];

  if (visitId && input.sourcePostUrl && input.visitCaption) {
    statements.push(
      db
        .prepare(
          `INSERT INTO visits
            (id, listing_id, visit_index, visited_on, source_post_url, caption,
             source_kind, sponsored, source_metadata_json, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          visitId,
          listingId,
          input.visitedOn,
          input.sourcePostUrl,
          input.visitCaption,
          input.sourceKind === "list" ? "lista" : "singola",
          input.disclosureKind === "none" || input.disclosureKind === "unknown" ? 0 : 1,
          JSON.stringify({ disclosure_kind: input.disclosureKind }),
          timestamp,
          timestamp,
        ),
    );
  }

  for (const tag of input.experienceTags) {
    const tagId = `experience:${tag.dimension}:${tag.slug}`;
    statements.push(
      db
        .prepare(
          `INSERT INTO experience_tags (id, slug, label, dimension)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(dimension, slug) DO UPDATE SET
             label = excluded.label,
             active = 1,
             updated_at = excluded.updated_at`,
        )
        .bind(tagId, tag.slug, tag.label, tag.dimension),
      db
        .prepare(
          `INSERT OR IGNORE INTO listing_experience_tags
            (listing_id, experience_tag_id)
           VALUES (?, ?)`,
        )
        .bind(listingId, tagId),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO audit_logs
          (id, principal_id, action, entity_type, entity_id, after_json, request_id)
         VALUES (?, ?, 'venue.create_draft', 'listing', ?, ?, ?)`,
      )
      .bind(
        uuid("audit"),
        principal.id,
        listingId,
        JSON.stringify({ venueId, listingId, input }),
        requestId,
      ),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new CmsConflictError("Esiste già un locale con questo slug o Place ID.");
    }
    throw error;
  }

  return { venueId, listingId, visitId, revision: 1 };
}

function buildVenueUpdate(
  db: D1Database,
  patch: VenuePatchInput,
  venueId: string,
  listingId: string,
): D1PreparedStatement {
  const columns: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    columns.push(`${column} = ?`);
    values.push(value);
  };
  if ("name" in patch) add("name", patch.name);
  if ("slug" in patch) add("slug", patch.slug);
  if ("city" in patch) add("city", patch.city);
  if ("neighbourhood" in patch) add("neighborhood", patch.neighbourhood);
  if ("address" in patch) add("address", patch.address);
  if ("googlePlaceId" in patch) add("google_place_id", patch.googlePlaceId);
  if ("latitude" in patch) add("latitude", patch.latitude);
  if ("longitude" in patch) add("longitude", patch.longitude);
  if ("priceTier" in patch) add("price_band", priceBand(patch.priceTier));
  if ("directionsUrl" in patch) add("directions_url", patch.directionsUrl);
  if ("bookingUrl" in patch) add("booking_url", patch.bookingUrl);
  columns.push("revision = revision + 1", "updated_at = ?");
  values.push(nowIso());
  values.push(venueId, listingId, patch.revision);
  return db
    .prepare(
      `UPDATE venues SET ${columns.join(", ")}
       WHERE id = ?
         AND EXISTS (
           SELECT 1 FROM listings
           WHERE id = ? AND revision = ? AND status <> 'archived'
         )`,
    )
    .bind(...values);
}

function buildListingUpdate(
  db: D1Database,
  patch: VenuePatchInput,
  listingId: string,
  mutationId: string,
): D1PreparedStatement {
  const columns: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    columns.push(`${column} = ?`);
    values.push(value);
  };
  if ("sourcePostUrl" in patch) add("source_post_url", patch.sourcePostUrl);
  if ("attributionText" in patch) add("attribution_text", patch.attributionText);
  if ("editorialText" in patch) add("editorial_text", patch.editorialText);
  if ("creatorApprovalStatus" in patch) {
    add("creator_approval_status", patch.creatorApprovalStatus);
  }
  if ("creatorApprovedAt" in patch) add("creator_approved_at", patch.creatorApprovedAt);
  if ("disclosureKind" in patch) add("sponsored_disclosure", patch.disclosureKind);
  columns.push("revision = revision + 1", "last_mutation_id = ?", "updated_at = ?");
  values.push(mutationId, nowIso());
  values.push(listingId, patch.revision);
  return db
    .prepare(
      `UPDATE listings SET ${columns.join(", ")}
       WHERE id = ? AND revision = ? AND status <> 'archived'`,
    )
    .bind(...values);
}

export async function updateVenueDraft(
  db: D1Database,
  principal: CmsPrincipal,
  venueId: string,
  patch: VenuePatchInput,
  requestId: string,
) {
  const before = await getAdminVenue(db, venueId);
  const listingId = String(before.listing_id);
  if (before.listing_status === "published") {
    throw new CmsConflictError(
      "Una scheda pubblicata è immutabile: archiviarla e creare una nuova revisione.",
    );
  }
  if (
    Number(before.listing_revision) !== patch.revision ||
    Number(before.revision) !== patch.revision
  ) {
    throw new CmsConflictError("La scheda è stata modificata da un altro utente.");
  }
  const mutationId = uuid("mutation");
  const statements = [
    buildVenueUpdate(db, patch, venueId, listingId),
    buildListingUpdate(db, patch, listingId, mutationId),
  ];
  if (patch.experienceTags) {
    statements.push(
      db
        .prepare(
          `DELETE FROM listing_experience_tags
           WHERE listing_id = ?
             AND EXISTS (
               SELECT 1 FROM listings WHERE id = ? AND last_mutation_id = ?
             )`,
        )
        .bind(listingId, listingId, mutationId),
    );
    for (const tag of patch.experienceTags) {
      const tagId = `experience:${tag.dimension}:${tag.slug}`;
      statements.push(
        db
          .prepare(
            `INSERT INTO experience_tags (id, slug, label, dimension)
             SELECT ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM listings WHERE id = ? AND last_mutation_id = ?
             )
             ON CONFLICT(dimension, slug) DO UPDATE SET
               label = excluded.label,
               active = 1,
               updated_at = excluded.updated_at`,
          )
          .bind(
            tagId,
            tag.slug,
            tag.label,
            tag.dimension,
            listingId,
            mutationId,
          ),
        db
          .prepare(
            `INSERT OR IGNORE INTO listing_experience_tags
              (listing_id, experience_tag_id)
             SELECT ?, ?
             WHERE EXISTS (
               SELECT 1 FROM listings WHERE id = ? AND last_mutation_id = ?
             )`,
          )
          .bind(listingId, tagId, listingId, mutationId),
      );
    }
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO audit_logs
          (id, principal_id, action, entity_type, entity_id, before_json, after_json, request_id)
         SELECT ?, ?, 'venue.update_draft', 'listing', ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM listings WHERE id = ? AND last_mutation_id = ?
         )`,
      )
      .bind(
        uuid("audit"),
        principal.id,
        listingId,
        JSON.stringify(before),
        JSON.stringify(patch),
        requestId,
        listingId,
        mutationId,
      ),
  );

  try {
    const results = await db.batch(statements);
    if (!resultChanged(results[1])) {
      throw new CmsConflictError("La scheda è stata modificata da un altro utente.");
    }
  } catch (error) {
    if (error instanceof CmsConflictError) throw error;
    if (isUniqueConflict(error)) {
      throw new CmsConflictError("Slug o Place ID già in uso.");
    }
    throw error;
  }
  return getAdminVenue(db, venueId);
}

export async function publishVenue(
  db: D1Database,
  principal: CmsPrincipal,
  venueId: string,
  requestId: string,
) {
  const before = await getAdminVenue(db, venueId);
  const listingId = String(before.listing_id);
  const issues: string[] = [];
  if (!before.source_post_url) issues.push("manca il post sorgente");
  if (!before.attribution_text) issues.push("manca l'attribuzione creator");
  if (before.creator_approval_status !== "approved") {
    issues.push("l'approvazione creator non è approved");
  }
  if (!before.creator_approved_at) issues.push("manca la data di approvazione creator");
  if (before.creator_status !== "active") {
    issues.push("il creator non è active");
  }
  if (before.creator_license_status !== "active") {
    issues.push("la licenza creator non è active");
  }
  const now = nowIso();
  if (before.creator_license_revoked_at) {
    issues.push("la licenza creator è revocata");
  }
  if (
    before.creator_license_starts_at &&
    String(before.creator_license_starts_at) > now
  ) {
    issues.push("la licenza creator non è ancora valida");
  }
  if (
    before.creator_license_ends_at &&
    String(before.creator_license_ends_at) <= now
  ) {
    issues.push("la licenza creator è scaduta");
  }
  if (before.site_status !== "active") {
    issues.push("il sito creator non è active");
  }
  if (!Array.isArray(before.visits) || before.visits.length === 0) {
    issues.push("manca almeno una visita");
  }
  const publishableMedia = Array.isArray(before.media)
    ? before.media.filter(
        (item) =>
          item.state === "ready" &&
          item.storage_provider === "r2" &&
          item.rights_status === "approved",
      )
    : [];
  if (publishableMedia.length === 0) {
    issues.push(
      "manca almeno un media R2 ready con diritti approvati",
    );
  }
  if (issues.length) throw new CmsPublishError(issues);

  const timestamp = now;
  const mutationId = uuid("mutation");
  const results = await db.batch([
    db
      .prepare(
        `UPDATE listings
         SET status = 'published',
             published_at = COALESCE(published_at, ?),
             revision = revision + 1,
             last_mutation_id = ?,
             updated_at = ?
         WHERE id = ? AND status IN ('draft', 'review')`,
      )
      .bind(timestamp, mutationId, timestamp, listingId),
    db
      .prepare(
        `INSERT INTO audit_logs
          (id, principal_id, action, entity_type, entity_id, before_json, after_json, request_id)
         SELECT ?, ?, 'venue.publish', 'listing', ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM listings
           WHERE id = ? AND status = 'published' AND last_mutation_id = ?
         )`,
      )
      .bind(
        uuid("audit"),
        principal.id,
        listingId,
        JSON.stringify(before),
        JSON.stringify({ status: "published" }),
        requestId,
        listingId,
        mutationId,
      ),
  ]);
  if (!resultChanged(results[0])) {
    throw new CmsConflictError("La scheda non è pubblicabile nello stato corrente.");
  }
  return getAdminVenue(db, venueId);
}

export async function archiveVenue(
  db: D1Database,
  principal: CmsPrincipal,
  venueId: string,
  requestId: string,
) {
  const before = await getAdminVenue(db, venueId);
  const listingId = String(before.listing_id);
  const mutationId = uuid("mutation");
  const results = await db.batch([
    db
      .prepare(
        `UPDATE listings
         SET status = 'archived',
             revision = revision + 1,
             last_mutation_id = ?,
             updated_at = ?
         WHERE id = ? AND status <> 'archived'`,
      )
      .bind(mutationId, nowIso(), listingId),
    db
      .prepare(
        `INSERT INTO audit_logs
          (id, principal_id, action, entity_type, entity_id, before_json, after_json, request_id)
         SELECT ?, ?, 'venue.archive', 'listing', ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM listings
           WHERE id = ? AND status = 'archived' AND last_mutation_id = ?
         )`,
      )
      .bind(
        uuid("audit"),
        principal.id,
        listingId,
        JSON.stringify(before),
        JSON.stringify({ status: "archived" }),
        requestId,
        listingId,
        mutationId,
      ),
  ]);
  if (!resultChanged(results[0])) {
    throw new CmsConflictError("Scheda già archiviata.");
  }
}

export async function getFirstVisitId(db: D1Database, listingId: string): Promise<string> {
  const visit = await db
    .prepare(
      `SELECT id FROM visits
       WHERE listing_id = ?
       ORDER BY visit_index ASC
       LIMIT 1`,
    )
    .bind(listingId)
    .first<{ id: string }>();
  if (!visit) throw new CmsPublishError(["creare una visita prima di caricare media"]);
  return visit.id;
}

export async function insertPendingMedia(
  db: D1Database,
  principal: CmsPrincipal,
  input: {
    id: string;
    visitId: string;
    storageKey: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    altText: string;
    isHero: boolean;
  },
  requestId: string,
) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO media_assets
          (id, visit_id, storage_provider, storage_key, media_type, sort_order,
           is_hero, attribution_text, rights_status, original_filename, mime_type,
           byte_size, sha256, state, metadata_json)
         VALUES (
           ?, ?, 'r2', ?, 'image',
           COALESCE((SELECT MAX(sort_order) + 1 FROM media_assets WHERE visit_id = ?), 0),
           ?, ?, 'restricted', ?, ?, ?, ?, 'pending', '{}'
         )`,
      )
      .bind(
        input.id,
        input.visitId,
        input.storageKey,
        input.visitId,
        input.isHero ? 1 : 0,
        input.altText,
        input.originalFilename,
        input.mimeType,
        input.byteSize,
        input.sha256,
      ),
    db
      .prepare(
        `INSERT INTO audit_logs
          (id, principal_id, action, entity_type, entity_id, after_json, request_id)
         VALUES (?, ?, 'media.upload_start', 'media_asset', ?, ?, ?)`,
      )
      .bind(
        uuid("audit"),
        principal.id,
        input.id,
        JSON.stringify({
          visitId: input.visitId,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          sha256: input.sha256,
        }),
        requestId,
      ),
  ]);
}

export async function markMediaState(
  db: D1Database,
  principal: CmsPrincipal,
  mediaId: string,
  state: "ready" | "failed",
  requestId: string,
) {
  const mutationId = uuid("mutation");
  const results = await db.batch([
    db
      .prepare(
        `UPDATE media_assets
         SET state = ?, last_mutation_id = ?
         WHERE id = ? AND state = 'pending'`,
      )
      .bind(state, mutationId, mediaId),
    db
      .prepare(
        `INSERT INTO audit_logs
          (id, principal_id, action, entity_type, entity_id, after_json, request_id)
         SELECT ?, ?, ?, 'media_asset', ?, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM media_assets
           WHERE id = ? AND state = ? AND last_mutation_id = ?
         )`,
      )
      .bind(
        uuid("audit"),
        principal.id,
        `media.${state}`,
        mediaId,
        JSON.stringify({ state }),
        requestId,
        mediaId,
        state,
        mutationId,
      ),
  ]);
  if (!resultChanged(results[0])) {
    throw new CmsConflictError("Stato media non aggiornabile.");
  }
}

export async function updateMediaRights(
  db: D1Database,
  principal: CmsPrincipal,
  mediaId: string,
  rightsStatus: "approved" | "restricted" | "revoked",
  requestId: string,
) {
  const before = await db
    .prepare(
      `SELECT m.id, m.rights_status, m.state, l.status AS listing_status
       FROM media_assets m
       JOIN visits v ON v.id = m.visit_id
       JOIN listings l ON l.id = v.listing_id
       WHERE m.id = ?
       LIMIT 1`,
    )
    .bind(mediaId)
    .first<Record<string, unknown>>();
  if (!before) throw new CmsNotFoundError("Media non trovato.");
  if (before.state !== "ready") {
    throw new CmsConflictError("Solo un media ready può cambiare stato diritti.");
  }
  if (before.rights_status === "revoked") {
    throw new CmsConflictError("La revoca dei diritti è definitiva.");
  }
  if (before.listing_status === "published" && rightsStatus === "approved") {
    throw new CmsConflictError(
      "Non è possibile aggiungere nuovi media approvati a una scheda pubblicata.",
    );
  }

  const mutationId = uuid("mutation");
  const results = await db.batch([
    db
      .prepare(
        `UPDATE media_assets
         SET rights_status = ?, last_mutation_id = ?
         WHERE id = ?
           AND state = 'ready'
           AND rights_status <> 'revoked'
           AND rights_status <> ?`,
      )
      .bind(rightsStatus, mutationId, mediaId, rightsStatus),
    db
      .prepare(
        `INSERT INTO audit_logs
          (id, principal_id, action, entity_type, entity_id, before_json, after_json, request_id)
         SELECT ?, ?, 'media.rights_update', 'media_asset', ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM media_assets
           WHERE id = ? AND last_mutation_id = ?
         )`,
      )
      .bind(
        uuid("audit"),
        principal.id,
        mediaId,
        JSON.stringify(before),
        JSON.stringify({ rightsStatus }),
        requestId,
        mediaId,
        mutationId,
      ),
  ]);
  if (!resultChanged(results[0])) {
    throw new CmsConflictError("Stato diritti media non aggiornabile.");
  }
  return { id: mediaId, rightsStatus };
}

export async function getPublicMedia(db: D1Database, mediaId: string) {
  return db
    .prepare(
      `SELECT
         m.storage_key,
         m.mime_type,
         m.byte_size,
         m.sha256,
         l.status AS listing_status
       FROM media_assets m
       JOIN visits v ON v.id = m.visit_id
       JOIN listings l ON l.id = v.listing_id
       JOIN creators c ON c.id = l.creator_id
       JOIN white_label_sites s ON s.id = l.site_id
       WHERE m.id = ?
         AND m.storage_provider = 'r2'
         AND m.state = 'ready'
         AND m.rights_status = 'approved'
         AND l.status = 'published'
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
    .bind(mediaId)
    .first<{
      storage_key: string;
      mime_type: string;
      byte_size: number;
      sha256: string;
      listing_status: string;
    }>();
}

export async function recordIntentEvent(
  db: D1Database,
  input: {
    listingId: string;
    eventType: "directions_click" | "save" | "share" | "booking_click";
    eventId: string;
    occurredAt: string;
    pseudonymousSessionId: string | null;
    referrer: string | null;
    utm: Record<string, string>;
  },
) {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO interaction_events
        (id, listing_id, event_type, verification_status, dedupe_key,
         occurred_at, pseudonymous_session_id, referrer, utm_json)
       SELECT ?, ?, ?, 'intent_proxy', ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1
         FROM listings l
         JOIN creators c ON c.id = l.creator_id
         JOIN white_label_sites s ON s.id = l.site_id
         WHERE l.id = ?
           AND l.status = 'published'
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
       )`,
    )
    .bind(
      uuid("event"),
      input.listingId,
      input.eventType,
      input.eventId,
      input.occurredAt,
      input.pseudonymousSessionId,
      input.referrer,
      JSON.stringify(input.utm),
      input.listingId,
    )
    .run();
  return { accepted: resultChanged(result) };
}
