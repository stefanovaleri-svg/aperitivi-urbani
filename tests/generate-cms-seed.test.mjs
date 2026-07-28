import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");
const GENERATOR = path.join(REPO_ROOT, "scripts", "generate-cms-seed.mjs");
const MIGRATION = path.join(REPO_ROOT, "migrations", "0001_cms_foundation.sql");

function runGenerator(cwd, args = []) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
}

async function writeLocale(root, filename, frontmatter) {
  const contentDir = path.join(root, "content", "locali");
  await mkdir(contentDir, { recursive: true });
  await writeFile(
    path.join(contentDir, filename),
    `---\n${frontmatter.trim()}\n---\n`,
    "utf8",
  );
}

async function makeSeedFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "aperitivi-cms-seed-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeLocale(
    root,
    "zeta.md",
    `
nome: "L'Osteria"
slug: l-osteria
citta: Milano
zona: "Porta Romana"
indirizzo: "Via dell'Arte, 1"
lat: 45.46
lng: 9.20
tipo:
  - cocktail-bar
  - bistrot
fascia_prezzo: "€€"
foto:
  - hero-one.jpg
  - /img/locali/l-osteria/second.jpg
sponsorizzato: true
piatti_drink_citati:
  - "chef's spritz"
visite:
  - data: "2026-01-02"
    caption: "It's the creator's first visit."
    post_url: "https://www.instagram.com/p/first/"
    fonte_tipo: singola
    foto:
      - visit-one.jpg
  - data: "2026-02-03"
    caption: "A second visit must remain separate."
    post_url: "https://www.instagram.com/p/second/"
    fonte_tipo: lista
    foto: []
`,
  );

  await writeLocale(
    root,
    "alpha.md",
    `
nome: Alpha
slug: alpha
citta: Milano
tipo:
  - aperitivo
foto:
  - alpha.jpg
visite:
  - data: "2026-03-04"
    caption: "Alpha caption"
    post_url: "https://www.instagram.com/p/alpha/"
    foto: []
`,
  );

  await mkdir(path.join(root, "public", "images", "locali", "l-osteria"), {
    recursive: true,
  });
  await mkdir(path.join(root, "public", "img", "locali", "l-osteria"), {
    recursive: true,
  });
  await mkdir(path.join(root, "public", "images", "locali", "alpha"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "public", "images", "locali", "l-osteria", "hero-one.jpg"),
    "",
  );
  await writeFile(
    path.join(root, "public", "images", "locali", "l-osteria", "visit-one.jpg"),
    "",
  );
  await writeFile(
    path.join(root, "public", "img", "locali", "l-osteria", "second.jpg"),
    "",
  );
  await writeFile(
    path.join(root, "public", "images", "locali", "alpha", "alpha.jpg"),
    "",
  );

  return root;
}

test("migration enforces publishing, event, principal, and media invariants", async () => {
  const db = new DatabaseSync(":memory:");
  const migration = await readFile(MIGRATION, "utf8");
  db.exec(migration);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map(({ name }) => name);
  assert.ok(tables.includes("cms_principals"));
  assert.ok(!tables.includes("admin_users"));

  db.exec(`
    INSERT INTO creators
      (id, slug, display_name, handle, status, license_status)
    VALUES
      ('creator:test', 'test', 'Test Creator', '@test', 'active', 'active');
    INSERT INTO white_label_sites
      (id, creator_id, site_key, display_name, status)
    VALUES ('site:test', 'creator:test', 'test', 'Test Site', 'active');
    INSERT INTO venues (id, slug, name, city)
    VALUES ('venue:test', 'test-venue', 'Test Venue', 'Milano');
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO listings
          (id, site_id, creator_id, venue_id, status)
        VALUES
          ('listing:invalid', 'site:test', 'creator:test', 'venue:test', 'published');
      `),
    /CHECK constraint failed/,
  );

  db.exec(`
    UPDATE creators
    SET license_status = 'pending'
    WHERE id = 'creator:test';
  `);
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO listings
          (
            id, site_id, creator_id, venue_id, status, source_post_url,
            attribution_text, creator_approval_status, creator_approved_at
          )
        VALUES
          (
            'listing:unlicensed', 'site:test', 'creator:test', 'venue:test',
            'published', 'https://www.instagram.com/p/test/', '@test',
            'approved', '2026-01-01T00:00:00Z'
          );
      `),
    /published listings require an active creator, active licence, and active matching site/,
  );
  db.exec(`
    UPDATE creators
    SET license_status = 'active'
    WHERE id = 'creator:test';
  `);

  db.exec(`
    INSERT INTO listings
      (
        id, site_id, creator_id, venue_id, status, source_post_url,
        attribution_text, creator_approval_status, creator_approved_at
      )
    VALUES
      (
        'listing:valid', 'site:test', 'creator:test', 'venue:test', 'published',
        'https://www.instagram.com/p/test/', '@test', 'approved',
        '2026-01-01T00:00:00Z'
      );
    INSERT INTO visits
      (id, listing_id, visit_index, source_post_url, caption)
    VALUES
      (
        'visit:test', 'listing:valid', 1,
        'https://www.instagram.com/p/test/', 'Test caption'
      );
  `);

  db.exec(`
    INSERT INTO interaction_events
      (
        id, listing_id, event_type, verification_status, dedupe_key,
        occurred_at
      )
    VALUES
      (
        'event:1', 'listing:valid', 'directions_click', 'intent_proxy',
        'dedupe:test', '2026-01-02T00:00:00Z'
      );
  `);
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO interaction_events
          (
            id, listing_id, event_type, verification_status, dedupe_key,
            occurred_at
          )
        VALUES
          (
            'event:2', 'listing:valid', 'booking_completed',
            'platform_verified', 'dedupe:test', '2026-01-02T00:01:00Z'
          );
      `),
    /UNIQUE constraint failed: interaction_events\.dedupe_key/,
  );
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO interaction_events
          (
            id, listing_id, event_type, verification_status, dedupe_key,
            occurred_at
          )
        VALUES
          (
            'event:3', 'listing:valid', 'anything', 'unverified',
            'dedupe:other', '2026-01-02T00:02:00Z'
          );
      `),
    /CHECK constraint failed/,
  );

  db.exec(`
    INSERT INTO media_assets
      (
        id, visit_id, storage_provider, storage_key, public_url,
        original_filename, mime_type, byte_size, sha256, state, media_type,
        sort_order
      )
    VALUES
      (
        'media:legacy', 'visit:test', 'legacy_static',
        'images/locali/test/test.jpg', '/images/locali/test/test.jpg',
        'test.jpg', 'image/jpeg', 10,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'ready', 'image', 0
      ),
      (
        'media:r2', 'visit:test', 'r2',
        'locali/test/new.jpg', 'https://media.example/new.jpg',
        'new.jpg', 'image/jpeg', 20,
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'ready', 'image', 1
      );
  `);
  assert.throws(
    () =>
      db.exec(`
        UPDATE media_assets
        SET storage_key = 'images/locali/test/replaced.jpg'
        WHERE id = 'media:legacy';
      `),
    /media asset identity is immutable/,
  );
  assert.throws(
    () =>
      db.exec(`
        UPDATE media_assets
        SET sha256 = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
        WHERE id = 'media:legacy';
      `),
    /ready media content is immutable/,
  );
  assert.throws(
    () =>
      db.exec(`
        INSERT OR IGNORE INTO media_assets
          (
            id, visit_id, storage_provider, storage_key, public_url,
            original_filename, mime_type, byte_size, sha256, state,
            media_type, sort_order
          )
        VALUES
          (
            'media:collision', 'visit:test', 'legacy_static',
            'images/locali/test/test.jpg', '/images/locali/test/test.jpg',
            'test.jpg', 'image/jpeg', 11,
            'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
            'ready', 'image', 2
          );
      `),
    /media storage key already refers to different content/,
  );

  const revisions = db
    .prepare(`
      SELECT
        (SELECT revision FROM creators WHERE id = 'creator:test') AS creator_revision,
        (SELECT revision FROM white_label_sites WHERE id = 'site:test') AS site_revision,
        (SELECT revision FROM venues WHERE id = 'venue:test') AS venue_revision,
        (SELECT revision FROM listings WHERE id = 'listing:valid') AS listing_revision
    `)
    .get();
  assert.equal(revisions.creator_revision, 1);
  assert.equal(revisions.site_revision, 1);
  assert.equal(revisions.venue_revision, 1);
  assert.equal(revisions.listing_revision, 1);

  db.exec(`
    UPDATE creators
    SET license_status = 'revoked', license_revoked_at = CURRENT_TIMESTAMP
    WHERE id = 'creator:test';
    UPDATE white_label_sites
    SET status = 'archived'
    WHERE id = 'site:test';
  `);
  assert.throws(
    () =>
      db.exec(`
        UPDATE creators
        SET license_status = 'active', license_revoked_at = NULL
        WHERE id = 'creator:test';
      `),
    /revoked creator licences cannot be reactivated/,
  );
  assert.throws(
    () =>
      db.exec(`
        UPDATE white_label_sites
        SET status = 'active'
        WHERE id = 'site:test';
      `),
    /archived sites cannot be reactivated/,
  );

  db.close();
});

test("generator is deterministic, SQL-safe, idempotent, and lossless", async (t) => {
  const root = await makeSeedFixture(t);
  const first = runGenerator(root);
  const second = runGenerator(root);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /L''Osteria/);
  assert.match(first.stdout, /It''s the creator''s first visit\./);
  assert.doesNotMatch(first.stdout, /INSERT\s+INTO\s+cms_principals/i);
  assert.doesNotMatch(first.stdout, /\b(?:BEGIN|COMMIT|SAVEPOINT)\b/i);
  assert.match(first.stdout, /INSERT OR IGNORE INTO media_assets/);

  const db = new DatabaseSync(":memory:");
  db.exec(await readFile(MIGRATION, "utf8"));
  db.exec(first.stdout);
  db.exec(`
    UPDATE creators
    SET
      status = 'paused',
      license_status = 'revoked',
      license_revoked_at = CURRENT_TIMESTAMP
    WHERE id = 'creator:aperitivi-urbani';
    UPDATE white_label_sites
    SET status = 'paused'
    WHERE id = 'site:aperitivi-urbani';
    UPDATE listings
    SET editorial_text = 'Testo revisionato in D1'
    WHERE id = 'listing:aperitivi-urbani:l-osteria';
  `);
  db.exec(first.stdout);

  const scalar = (sql) => db.prepare(sql).get().value;
  assert.equal(scalar("SELECT count(*) AS value FROM creators"), 1);
  assert.equal(scalar("SELECT count(*) AS value FROM white_label_sites"), 1);
  assert.equal(scalar("SELECT count(*) AS value FROM cms_principals"), 0);
  assert.equal(scalar("SELECT count(*) AS value FROM venues"), 2);
  assert.equal(scalar("SELECT count(*) AS value FROM listings"), 2);
  assert.equal(scalar("SELECT count(*) AS value FROM visits"), 3);
  assert.equal(scalar("SELECT count(*) AS value FROM media_assets"), 4);
  assert.equal(
    scalar(
      "SELECT count(*) AS value FROM creators WHERE status = 'paused' AND license_status = 'revoked'",
    ),
    1,
  );
  assert.equal(
    scalar(
      "SELECT count(*) AS value FROM white_label_sites WHERE status = 'paused'",
    ),
    1,
  );
  assert.equal(
    scalar(
      "SELECT count(*) AS value FROM listings WHERE editorial_text = 'Testo revisionato in D1'",
    ),
    1,
  );
  assert.equal(
    scalar(
      "SELECT count(*) AS value FROM listings WHERE status = 'draft' AND creator_approval_status = 'pending' AND creator_approved_at IS NULL",
    ),
    2,
  );
  assert.equal(
    scalar(
      "SELECT max(revision) AS value FROM venues",
    ),
    1,
  );
  assert.equal(
    scalar(
      "SELECT max(revision) AS value FROM listings",
    ),
    1,
  );
  assert.equal(
    scalar(
      "SELECT count(*) AS value FROM media_assets WHERE storage_provider = 'legacy_static'",
    ),
    4,
  );
  assert.equal(
    scalar(
      "SELECT count(*) AS value FROM experience_tags WHERE dimension = 'legacy_type'",
    ),
    0,
  );
  assert.equal(
    scalar(
      "SELECT count(*) AS value FROM listing_experience_tags",
    ),
    0,
  );

  const venue = db
    .prepare("SELECT name, mentioned_items_json FROM venues WHERE slug = ?")
    .get("l-osteria");
  assert.equal(venue.name, "L'Osteria");
  assert.deepEqual(JSON.parse(venue.mentioned_items_json), ["chef's spritz"]);

  const visits = db
    .prepare(
      "SELECT caption FROM visits WHERE listing_id LIKE '%l-osteria%' ORDER BY visit_index",
    )
    .all()
    .map(({ caption }) => caption);
  assert.deepEqual(visits, [
    "It's the creator's first visit.",
    "A second visit must remain separate.",
  ]);

  const storageKeys = db
    .prepare(
      "SELECT storage_key FROM media_assets ORDER BY storage_key",
    )
    .all()
    .map(({ storage_key }) => storage_key);
  assert.deepEqual(storageKeys, [
    "images/locali/alpha/alpha.jpg",
    "images/locali/l-osteria/hero-one.jpg",
    "images/locali/l-osteria/visit-one.jpg",
    "img/locali/l-osteria/second.jpg",
  ]);

  db.close();
});

test("--output writes the same deterministic SQL instead of stdout", async (t) => {
  const root = await makeSeedFixture(t);
  const stdoutRun = runGenerator(root);
  assert.equal(stdoutRun.status, 0, stdoutRun.stderr);

  const outputPath = path.join(root, "generated", "cms-seed.sql");
  const outputRun = runGenerator(root, ["--output", outputPath]);
  assert.equal(outputRun.status, 0, outputRun.stderr);
  assert.equal(outputRun.stdout, "");
  assert.equal(await readFile(outputPath, "utf8"), stdoutRun.stdout);
});

test("generator refuses to invent media for a source with no photos", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "aperitivi-cms-no-media-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeLocale(
    root,
    "no-media.md",
    `
nome: No Media
slug: no-media
visite:
  - data: "2026-01-01"
    caption: "No media was supplied."
    post_url: "https://www.instagram.com/p/no-media/"
`,
  );

  const result = runGenerator(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no media assets/i);
});
