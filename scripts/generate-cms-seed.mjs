#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const CONTENT_DIR = path.join("content", "locali");
const DEFAULT_CREATOR = {
  id: "creator:aperitivi-urbani",
  slug: "aperitivi-urbani",
  displayName: "Valeria Carbone",
  handle: "@aperitivi_urbani",
  primaryCity: "Milano",
};
const DEFAULT_SITE = {
  id: "site:aperitivi-urbani",
  key: "aperitivi-urbani",
  displayName: "Aperitivi Urbani",
  hostname: "aperitivi-urbani.pages.dev",
  city: "Milano",
};

function parseArguments(argv) {
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      if (output !== null || index + 1 >= argv.length) {
        throw new Error("--output requires exactly one file path");
      }
      output = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return { output };
}

function extractFrontmatter(markdown, filename) {
  const cleaned = markdown.replace(/^\uFEFF/, "");
  const match = cleaned.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/,
  );
  if (!match) {
    throw new Error(`${filename}: missing YAML frontmatter`);
  }

  const parsed = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filename}: frontmatter must be a YAML mapping`);
  }
  return parsed;
}

function requiredText(value, field, filename) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${filename}: ${field} must be a non-empty string`);
  }
  if (value.includes("\0")) {
    throw new Error(`${filename}: ${field} contains a NUL byte`);
  }
  return value.trim();
}

function nullableText(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (text.includes("\0")) throw new Error("text value contains a NUL byte");
  return text;
}

function nullableNumber(value, field, filename) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${filename}: ${field} must be a finite number`);
  }
  return number;
}

function booleanInteger(value) {
  return value === true ? 1 : 0;
}

function normalizeStringArray(value, field, filename) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${filename}: ${field} must be an array`);
  }
  return value.map((item, index) =>
    requiredText(item, `${field}[${index}]`, filename),
  );
}

function normalizeSlug(value, filename) {
  const slug = requiredText(value, "slug", filename);
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`${filename}: slug must match ^[a-z0-9-]+$`);
  }
  return slug;
}

function normalizeVisitDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim() || null;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("cannot serialize non-finite number");
    return String(value);
  }
  const text = String(value);
  if (text.includes("\0")) throw new Error("cannot serialize a NUL byte");
  return `'${text.replaceAll("'", "''")}'`;
}

function jsonLiteral(value) {
  return sqlLiteral(JSON.stringify(value));
}

function stableHash(...parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function renderInsertOrIgnore(table, columns, values) {
  return [
    `INSERT OR IGNORE INTO ${table} (${columns.join(", ")})`,
    `VALUES (${values.map(sqlLiteral).join(", ")});`,
  ].join("\n");
}

// The Markdown import is bootstrap-only. Once a row exists, D1 is the sole
// source of truth and a seed rerun must never overwrite review or licence state.
function renderBootstrapInsert({ table, columns, values }) {
  return renderInsertOrIgnore(table, columns, values);
}

function disclosureFromSource(locale, visits) {
  const captions = visits
    .map((visit) => (typeof visit.caption === "string" ? visit.caption : ""))
    .join("\n")
    .toLowerCase();
  if (/(^|\s)#invito\b/.test(captions)) return "invited";
  if (/(^|\s)#gifted\b|\bgifting\b/.test(captions)) return "gifted";
  if (/(^|\s)#affiliate\b|\baffiliate link\b/.test(captions)) return "affiliate";
  if (
    /(^|\s)#(?:adv|ad|sponsored)\b|\bin collaborazione con\b|\bcollab\b/.test(
      captions,
    )
  ) {
    return "paid_sponsorship";
  }
  return locale.sponsorizzato === true ? "unknown" : "none";
}

function mimeTypeFor(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".avif":
      return "image/avif";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function mediaTypeFor(mimeType) {
  return mimeType.startsWith("video/") ? "video" : "image";
}

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveLegacyMedia(root, slug, rawPhoto, filename) {
  const photo = requiredText(rawPhoto, "foto[]", filename).replaceAll("\\", "/");
  if (photo.split("/").includes("..")) {
    throw new Error(`${filename}: media path cannot contain '..': ${photo}`);
  }

  const relativeCandidates = [];
  if (photo.startsWith("/")) {
    relativeCandidates.push(photo.slice(1));
  } else if (photo.includes("/")) {
    relativeCandidates.push(photo);
  } else {
    relativeCandidates.push(
      path.posix.join("images", "locali", slug, photo),
      path.posix.join("img", "locali", slug, photo),
    );
  }

  let storageKey = null;
  let absolutePath = null;
  for (const candidate of relativeCandidates) {
    const normalized = path.posix.normalize(candidate);
    const absolute = path.join(root, "public", ...normalized.split("/"));
    if (await pathExists(absolute)) {
      storageKey = normalized;
      absolutePath = absolute;
      break;
    }
  }

  if (!storageKey || !absolutePath) {
    throw new Error(`${filename}: media file not found under public/: ${photo}`);
  }

  const contents = await readFile(absolutePath);
  const mediaStat = await stat(absolutePath);
  const originalFilename = path.posix.basename(storageKey);
  const mimeType = mimeTypeFor(originalFilename);
  return {
    storageKey,
    publicUrl: `/${storageKey}`,
    originalFilename,
    mimeType,
    mediaType: mediaTypeFor(mimeType),
    byteSize: mediaStat.size,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

async function loadSources(root) {
  const contentDir = path.join(root, CONTENT_DIR);
  let filenames;
  try {
    filenames = (await readdir(contentDir))
      .filter((filename) => filename.endsWith(".md"))
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`missing content directory: ${CONTENT_DIR}`);
    }
    throw error;
  }
  if (filenames.length === 0) {
    throw new Error(`no Markdown sources found in ${CONTENT_DIR}`);
  }

  const sources = [];
  for (const filename of filenames) {
    const markdown = await readFile(path.join(contentDir, filename), "utf8");
    sources.push({
      filename,
      locale: extractFrontmatter(markdown, filename),
    });
  }
  return sources;
}

async function generateSeedSql(root = process.cwd()) {
  const statements = [
    "-- Deterministic seed generated from content/locali/*.md.",
    "-- Existing CMS rows are never deleted; media rows are append-only.",
    "PRAGMA foreign_keys = ON;",
  ];

  statements.push(
    renderBootstrapInsert({
      table: "creators",
      columns: [
        "id",
        "slug",
        "display_name",
        "handle",
        "primary_city",
        "status",
        "license_status",
      ],
      values: [
        DEFAULT_CREATOR.id,
        DEFAULT_CREATOR.slug,
        DEFAULT_CREATOR.displayName,
        DEFAULT_CREATOR.handle,
        DEFAULT_CREATOR.primaryCity,
        "onboarding",
        "pending",
      ],
    }),
  );
  statements.push(
    renderBootstrapInsert({
      table: "white_label_sites",
      columns: [
        "id",
        "creator_id",
        "site_key",
        "display_name",
        "hostname",
        "city",
      ],
      values: [
        DEFAULT_SITE.id,
        DEFAULT_CREATOR.id,
        DEFAULT_SITE.key,
        DEFAULT_SITE.displayName,
        DEFAULT_SITE.hostname,
        DEFAULT_SITE.city,
      ],
    }),
  );

  const sources = await loadSources(root);
  for (const { filename, locale } of sources) {
    const fallbackSlug = path.basename(filename, path.extname(filename));
    const slug = normalizeSlug(locale.slug ?? fallbackSlug, filename);
    const name = requiredText(locale.nome, "nome", filename);
    const visits = locale.visite;
    if (!Array.isArray(visits) || visits.length === 0) {
      throw new Error(`${filename}: visite must contain at least one visit`);
    }

    const venueId = `venue:${slug}`;
    const listingId = `listing:${DEFAULT_SITE.key}:${slug}`;
    const venueTypes = normalizeStringArray(locale.tipo, "tipo", filename);
    const mentionedItems = normalizeStringArray(
      locale.piatti_drink_citati,
      "piatti_drink_citati",
      filename,
    );
    const sourcePostUrl = nullableText(
      visits.find((visit) => nullableText(visit?.post_url))?.post_url ??
        locale.instagram_url,
    );
    const firstCaption = nullableText(visits[0]?.caption);

    statements.push(
      renderBootstrapInsert({
        table: "venues",
        columns: [
          "id",
          "slug",
          "name",
          "city",
          "neighborhood",
          "address",
          "latitude",
          "longitude",
          "venue_types_json",
          "price_band",
          "mentioned_items_json",
          "sentiment",
          "inferred_rating",
          "sponsored",
        ],
        values: [
          venueId,
          slug,
          name,
          nullableText(locale.citta) ?? "Milano",
          nullableText(locale.zona),
          nullableText(locale.indirizzo),
          nullableNumber(locale.lat, "lat", filename),
          nullableNumber(locale.lng, "lng", filename),
          JSON.stringify(venueTypes),
          nullableText(locale.fascia_prezzo),
          JSON.stringify(mentionedItems),
          nullableText(locale.sentiment),
          nullableNumber(locale.voto_dedotto, "voto_dedotto", filename),
          booleanInteger(locale.sponsorizzato),
        ],
      }),
    );

    statements.push(
      renderBootstrapInsert({
        table: "listings",
        columns: [
          "id",
          "site_id",
          "creator_id",
          "venue_id",
          "status",
          "source_post_url",
          "attribution_text",
          "editorial_text",
          "creator_approval_status",
          "creator_approved_at",
          "sponsored_disclosure",
        ],
        values: [
          listingId,
          DEFAULT_SITE.id,
          DEFAULT_CREATOR.id,
          venueId,
          "draft",
          sourcePostUrl,
          DEFAULT_CREATOR.handle,
          firstCaption,
          "pending",
          null,
          disclosureFromSource(locale, visits),
        ],
      }),
    );

    const visitRows = [];
    for (let index = 0; index < visits.length; index += 1) {
      const visit = visits[index];
      if (!visit || typeof visit !== "object" || Array.isArray(visit)) {
        throw new Error(`${filename}: visite[${index}] must be a mapping`);
      }
      const postUrl = requiredText(
        visit.post_url ?? locale.instagram_url,
        `visite[${index}].post_url`,
        filename,
      );
      const caption = requiredText(
        visit.caption,
        `visite[${index}].caption`,
        filename,
      );
      const visitedOn = normalizeVisitDate(visit.data);
      const issueNumber = nullableNumber(
        visit.issue,
        `visite[${index}].issue`,
        filename,
      );
      const sourceKind = nullableText(visit.fonte_tipo) ?? "singola";
      if (!["singola", "lista"].includes(sourceKind)) {
        throw new Error(
          `${filename}: visite[${index}].fonte_tipo must be singola or lista`,
        );
      }
      const fingerprint =
        postUrl || `${visitedOn ?? "undated"}:${issueNumber ?? index + 1}`;
      const visitId = `visit:${slug}:${stableHash(slug, fingerprint).slice(0, 24)}`;
      const sourceMetadata = {
        legacy_source_file: filename,
      };
      if (visit.note_reel !== undefined && visit.note_reel !== null) {
        sourceMetadata.note_reel = visit.note_reel;
      }

      statements.push(
        renderBootstrapInsert({
          table: "visits",
          columns: [
            "id",
            "listing_id",
            "visit_index",
            "visited_on",
            "source_post_url",
            "caption",
            "source_issue_number",
            "source_kind",
            "sponsored",
            "sentiment",
            "inferred_rating",
            "source_metadata_json",
          ],
          values: [
            visitId,
            listingId,
            index + 1,
            visitedOn,
            postUrl,
            caption,
            issueNumber,
            sourceKind,
            booleanInteger(
              visit.sponsorizzato === true || locale.sponsorizzato === true,
            ),
            nullableText(visit.sentiment ?? locale.sentiment),
            nullableNumber(
              visit.voto ?? visit.voto_dedotto ?? locale.voto_dedotto,
              `visite[${index}].voto`,
              filename,
            ),
            JSON.stringify(sourceMetadata),
          ],
        }),
      );
      visitRows.push({
        id: visitId,
        photos: normalizeStringArray(
          visit.foto,
          `visite[${index}].foto`,
          filename,
        ),
      });
    }

    const mediaInputs = [];
    const topLevelPhotos = normalizeStringArray(locale.foto, "foto", filename);
    for (const photo of topLevelPhotos) {
      mediaInputs.push({ visitId: visitRows[0].id, photo });
    }
    for (const visitRow of visitRows) {
      for (const photo of visitRow.photos) {
        mediaInputs.push({ visitId: visitRow.id, photo });
      }
    }
    if (mediaInputs.length === 0) {
      throw new Error(`${filename}: no media assets; refusing to invent media`);
    }

    const seenStorageKeys = new Set();
    let mediaOrder = 0;
    for (const { visitId, photo } of mediaInputs) {
      const media = await resolveLegacyMedia(root, slug, photo, filename);
      if (seenStorageKeys.has(media.storageKey)) continue;
      seenStorageKeys.add(media.storageKey);
      const mediaId = `media:${stableHash("legacy_static", media.storageKey).slice(0, 24)}`;
      statements.push(
        renderInsertOrIgnore(
          "media_assets",
          [
            "id",
            "visit_id",
            "storage_provider",
            "storage_key",
            "public_url",
            "original_filename",
            "mime_type",
            "byte_size",
            "sha256",
            "state",
            "media_type",
            "sort_order",
            "is_hero",
            "attribution_text",
            "rights_status",
          ],
          [
            mediaId,
            visitId,
            "legacy_static",
            media.storageKey,
            media.publicUrl,
            media.originalFilename,
            media.mimeType,
            media.byteSize,
            media.sha256,
            "ready",
            media.mediaType,
            mediaOrder,
            mediaOrder === 0 ? 1 : 0,
            DEFAULT_CREATOR.handle,
            "inherited",
          ],
        ),
      );
      mediaOrder += 1;
    }
  }

  return `${statements.join("\n\n")}\n`;
}

async function main() {
  const { output } = parseArguments(process.argv.slice(2));
  const sql = await generateSeedSql(process.cwd());
  if (output === null) {
    process.stdout.write(sql);
    return;
  }

  const outputPath = path.resolve(process.cwd(), output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, sql, "utf8");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`generate-cms-seed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export { generateSeedSql, sqlLiteral };
