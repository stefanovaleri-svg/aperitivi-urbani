import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  CmsConflictError,
  CmsPublishError,
  archiveVenue,
  createVenueDraft,
  getFirstVisitId,
  getPublicMedia,
  insertPendingMedia,
  markMediaState,
  publishVenue,
  updateCreatorLifecycle,
  updateMediaRights,
  updateSiteLifecycle,
  updateVenueDraft,
} from "../src/lib/cms/repository.ts";

class TestStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestStatement(this.database, this.sql, values);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  async all() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.values),
      meta: { changes: 0 },
    };
  }
}

class TestD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new TestStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const principal = {
  id: "principal:test-owner",
  accessSub: "access-sub",
  email: "owner@example.test",
  role: "owner",
};

async function cmsDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    await readFile(
      new URL("../migrations/0001_cms_foundation.sql", import.meta.url),
      "utf8",
    ),
  );
  sqlite
    .prepare(
      `INSERT INTO cms_principals (id, access_sub, email, role)
       VALUES (?, ?, ?, ?)`,
    )
    .run(principal.id, principal.accessSub, principal.email, principal.role);
  return { sqlite, db: new TestD1(sqlite) };
}

function draftInput() {
  return {
    name: "Test Locale",
    slug: "test-locale",
    city: "Milano",
    neighbourhood: "Porta Romana",
    address: "Via Test 1",
    googlePlaceId: "place:test",
    latitude: 45.46,
    longitude: 9.2,
    priceTier: 2,
    directionsUrl: "https://maps.example.test/test-locale",
    bookingUrl: "https://booking.example.test/test-locale",
    creatorHandle: "creator_test",
    creatorDisplayName: "Creator Test",
    sourcePostUrl: "https://www.instagram.com/p/test/",
    attributionText: "@creator_test · post originale",
    editorialText: "Una bozza editoriale.",
    creatorApprovalStatus: "pending",
    creatorApprovedAt: null,
    disclosureKind: "none",
    visitedOn: "2026-07-01",
    visitCaption: "Visita verificabile dal post sorgente.",
    sourceKind: "single",
    experienceTags: [
      { slug: "date-night", label: "Date night", dimension: "occasion" },
    ],
  };
}

test("draft → audited edit → ready media → publish → archive", async () => {
  const { sqlite, db } = await cmsDatabase();
  try {
    const created = await createVenueDraft(
      db,
      principal,
      draftInput(),
      "request:create",
    );
    assert.equal(created.revision, 1);

    const storedVenue = sqlite
      .prepare(
        `SELECT directions_url, booking_url, revision
         FROM venues WHERE id = ?`,
      )
      .get(created.venueId);
    assert.equal(storedVenue.directions_url, draftInput().directionsUrl);
    assert.equal(storedVenue.booking_url, draftInput().bookingUrl);
    assert.equal(storedVenue.revision, 1);

    const updated = await updateVenueDraft(
      db,
      principal,
      created.venueId,
      {
        revision: 1,
        editorialText: "Testo revisionato.",
        creatorApprovalStatus: "approved",
        creatorApprovedAt: "2026-07-02",
        experienceTags: [
          { slug: "terrazza", label: "Terrazza", dimension: "setting" },
        ],
      },
      "request:update",
    );
    assert.equal(updated.listing_revision, 2);

    await assert.rejects(
      updateVenueDraft(
        db,
        principal,
        created.venueId,
        { revision: 1, editorialText: "Scrittura obsoleta." },
        "request:stale",
      ),
      CmsConflictError,
    );

    const visitId = await getFirstVisitId(db, created.listingId);
    await insertPendingMedia(
      db,
      principal,
      {
        id: "00000000-0000-4000-8000-000000000001",
        visitId,
        storageKey:
          "venues/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000001.jpg",
        originalFilename: "test.jpg",
        mimeType: "image/jpeg",
        byteSize: 4,
        sha256: "a".repeat(64),
        altText: "Test Locale",
        isHero: true,
      },
      "request:media",
    );
    await markMediaState(
      db,
      principal,
      "00000000-0000-4000-8000-000000000001",
      "ready",
      "request:ready",
    );

    await assert.rejects(
      publishVenue(db, principal, created.venueId, "request:blocked-publish"),
      (error) =>
        error instanceof CmsPublishError &&
        error.issues.includes("il creator non è active") &&
        error.issues.includes("la licenza creator non è active") &&
        error.issues.includes("il sito creator non è active"),
    );
    const lifecycle = sqlite
      .prepare(
        `SELECT creator_id, site_id
         FROM listings
         WHERE id = ?`,
      )
      .get(created.listingId);
    const activatedCreator = await updateCreatorLifecycle(
      db,
      principal,
      lifecycle.creator_id,
      {
        revision: 1,
        status: "active",
        licenseStatus: "active",
        licenseStartsAt: null,
        licenseEndsAt: null,
      },
      "request:creator-active",
    );
    assert.equal(activatedCreator.revision, 2);
    await assert.rejects(
      updateCreatorLifecycle(
        db,
        principal,
        lifecycle.creator_id,
        { revision: 1, status: "paused" },
        "request:creator-stale",
      ),
      CmsConflictError,
    );
    const activatedSite = await updateSiteLifecycle(
      db,
      principal,
      lifecycle.site_id,
      { revision: 1, status: "active" },
      "request:site-active",
    );
    assert.equal(activatedSite.revision, 2);
    await assert.rejects(
      updateSiteLifecycle(
        db,
        principal,
        lifecycle.site_id,
        { revision: 1, status: "paused" },
        "request:site-stale",
      ),
      CmsConflictError,
    );
    await updateMediaRights(
      db,
      principal,
      "00000000-0000-4000-8000-000000000001",
      "approved",
      "request:rights",
    );

    const published = await publishVenue(
      db,
      principal,
      created.venueId,
      "request:publish",
    );
    assert.equal(published.listing_status, "published");
    assert.ok(
      await getPublicMedia(
        db,
        "00000000-0000-4000-8000-000000000001",
      ),
    );
    sqlite
      .prepare("UPDATE media_assets SET rights_status = 'inherited' WHERE id = ?")
      .run("00000000-0000-4000-8000-000000000001");
    assert.equal(
      await getPublicMedia(
        db,
        "00000000-0000-4000-8000-000000000001",
      ),
      null,
      "R2 media without explicit approval must never be public",
    );
    sqlite
      .prepare("UPDATE media_assets SET rights_status = 'approved' WHERE id = ?")
      .run("00000000-0000-4000-8000-000000000001");
    const pausedCreator = await updateCreatorLifecycle(
      db,
      principal,
      lifecycle.creator_id,
      { revision: 2, status: "paused" },
      "request:creator-pause",
    );
    assert.equal(pausedCreator.revision, 3);
    assert.equal(
      await getPublicMedia(
        db,
        "00000000-0000-4000-8000-000000000001",
      ),
      null,
    );
    const resumedCreator = await updateCreatorLifecycle(
      db,
      principal,
      lifecycle.creator_id,
      { revision: 3, status: "active" },
      "request:creator-resume",
    );
    assert.equal(resumedCreator.revision, 4);
    assert.ok(
      await getPublicMedia(
        db,
        "00000000-0000-4000-8000-000000000001",
      ),
    );
    await updateMediaRights(
      db,
      principal,
      "00000000-0000-4000-8000-000000000001",
      "revoked",
      "request:revoke-rights",
    );
    assert.equal(
      await getPublicMedia(
        db,
        "00000000-0000-4000-8000-000000000001",
      ),
      null,
    );
    await assert.rejects(
      updateVenueDraft(
        db,
        principal,
        created.venueId,
        {
          revision: Number(published.listing_revision),
          editorialText: "Modifica dopo la pubblicazione.",
        },
        "request:published-edit",
      ),
      CmsConflictError,
    );

    await archiveVenue(db, principal, created.venueId, "request:archive");
    assert.equal(
      sqlite
        .prepare("SELECT status FROM listings WHERE id = ?")
        .get(created.listingId).status,
      "archived",
    );
    assert.deepEqual(
      sqlite
        .prepare("SELECT action FROM audit_logs ORDER BY created_at, rowid")
        .all()
        .map((row) => row.action),
      [
        "creator.create_onboarding",
        "site.create_draft",
        "venue.create_draft",
        "venue.update_draft",
        "media.upload_start",
        "media.ready",
        "creator.lifecycle_update",
        "site.lifecycle_update",
        "media.rights_update",
        "venue.publish",
        "creator.lifecycle_update",
        "creator.lifecycle_update",
        "media.rights_update",
        "venue.archive",
      ],
    );
  } finally {
    sqlite.close();
  }
});

test("failed draft creation rolls back creator and site bootstrap", async () => {
  const { sqlite, db } = await cmsDatabase();
  try {
    await createVenueDraft(db, principal, draftInput(), "request:first");

    await assert.rejects(
      createVenueDraft(
        db,
        principal,
        {
          ...draftInput(),
          creatorHandle: "orphan_candidate",
          creatorDisplayName: "Orphan Candidate",
          googlePlaceId: "place:orphan-candidate",
        },
        "request:duplicate",
      ),
      CmsConflictError,
    );

    assert.equal(
      sqlite
        .prepare("SELECT count(*) AS value FROM creators WHERE handle = ?")
        .get("@orphan_candidate").value,
      0,
    );
    assert.equal(
      sqlite
        .prepare("SELECT count(*) AS value FROM white_label_sites WHERE site_key = ?")
        .get("orphan_candidate").value,
      0,
    );
    assert.equal(
      sqlite
        .prepare(
          `SELECT count(*) AS value
           FROM audit_logs
           WHERE after_json LIKE '%orphan_candidate%'`,
        )
        .get().value,
      0,
    );
  } finally {
    sqlite.close();
  }
});

test("archived sites and revoked creator licences cannot be reactivated", async () => {
  const { sqlite, db } = await cmsDatabase();
  try {
    const created = await createVenueDraft(
      db,
      principal,
      draftInput(),
      "request:create",
    );
    const lifecycle = sqlite
      .prepare("SELECT creator_id, site_id FROM listings WHERE id = ?")
      .get(created.listingId);

    const revoked = await updateCreatorLifecycle(
      db,
      principal,
      lifecycle.creator_id,
      { revision: 1, licenseStatus: "revoked" },
      "request:revoke-license",
    );
    assert.equal(revoked.licenseStatus, "revoked");
    assert.ok(revoked.licenseRevokedAt);
    await assert.rejects(
      updateCreatorLifecycle(
        db,
        principal,
        lifecycle.creator_id,
        { revision: 2, licenseStatus: "active" },
        "request:restore-license",
      ),
      CmsConflictError,
    );
    const archivedCreator = await updateCreatorLifecycle(
      db,
      principal,
      lifecycle.creator_id,
      { revision: 2, status: "archived" },
      "request:archive-creator",
    );
    assert.equal(archivedCreator.status, "archived");
    await assert.rejects(
      updateCreatorLifecycle(
        db,
        principal,
        lifecycle.creator_id,
        { revision: 3, status: "active" },
        "request:restore-creator",
      ),
      CmsConflictError,
    );

    const archived = await updateSiteLifecycle(
      db,
      principal,
      lifecycle.site_id,
      { revision: 1, status: "archived" },
      "request:archive-site",
    );
    assert.equal(archived.status, "archived");
    await assert.rejects(
      updateSiteLifecycle(
        db,
        principal,
        lifecycle.site_id,
        { revision: 2, status: "active" },
        "request:restore-site",
      ),
      CmsConflictError,
    );
  } finally {
    sqlite.close();
  }
});
