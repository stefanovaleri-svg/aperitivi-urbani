import assert from "node:assert/strict";
import test from "node:test";

import {
  CmsInputError,
  parseVenueDraft,
  parseVenuePatch,
} from "../src/lib/cms/venue-validation.ts";

const validDraft = {
  name: "Locale Test",
  slug: "locale-test",
  city: "Milano",
  neighbourhood: "Isola",
  address: "Via Test 1",
  latitude: 45.48,
  longitude: 9.19,
  priceTier: 2,
  creatorHandle: "aperitivi_urbani",
  creatorDisplayName: "Valeria Carbone",
  sourcePostUrl: "https://www.instagram.com/p/example/",
  attributionText: "@aperitivi_urbani",
  editorialText: "Una prova editoriale.",
  creatorApprovalStatus: "pending",
  creatorApprovedAt: null,
  disclosureKind: "unknown",
  visitedOn: "2026-07-28",
  visitCaption: "Caption originale.",
  sourceKind: "single",
  experienceTags: [
    { slug: "after-work", label: "After work", dimension: "occasion" },
  ],
};

test("parseVenueDraft accepts a bounded normalized draft", () => {
  const parsed = parseVenueDraft(validDraft);
  assert.equal(parsed.slug, "locale-test");
  assert.equal(parsed.creatorHandle, "aperitivi_urbani");
  assert.deepEqual(parsed.experienceTags.map((tag) => tag.slug), ["after-work"]);
});

test("parseVenueDraft rejects traversal, unknown fields and invalid coordinates", () => {
  assert.throws(
    () =>
      parseVenueDraft({
        ...validDraft,
        slug: "../locale",
        latitude: 120,
        injected: "not-allowed",
      }),
    (error) => {
      assert.ok(error instanceof CmsInputError);
      assert.match(error.message, /slug/);
      assert.match(error.message, /latitude/);
      assert.match(error.message, /Campo non supportato/);
      return true;
    },
  );
});

test("parseVenueDraft does not accept an approval timestamp for a pending listing", () => {
  assert.throws(
    () =>
      parseVenueDraft({
        ...validDraft,
        creatorApprovedAt: "2026-07-28T10:00:00Z",
      }),
    /creatorApprovedAt/,
  );
});

test("parseVenuePatch requires optimistic revision and rejects mass assignment", () => {
  assert.throws(
    () => parseVenuePatch({ revision: 0, status: "published" }),
    (error) => {
      assert.ok(error instanceof CmsInputError);
      assert.match(error.message, /revision/);
      assert.match(error.message, /status/);
      return true;
    },
  );
});

test("parseVenuePatch requires paired, real and non-future approval evidence", () => {
  for (const patch of [
    { revision: 1, creatorApprovalStatus: "approved" },
    { revision: 1, creatorApprovedAt: "2026-07-28" },
    {
      revision: 1,
      creatorApprovalStatus: "approved",
      creatorApprovedAt: "2026-02-30",
    },
    {
      revision: 1,
      creatorApprovalStatus: "approved",
      creatorApprovedAt: "2999-01-01",
    },
  ]) {
    assert.throws(() => parseVenuePatch(patch), CmsInputError);
  }
  assert.deepEqual(
    parseVenuePatch({
      revision: 2,
      creatorApprovalStatus: "approved",
      creatorApprovedAt: "2026-07-28",
    }),
    {
      revision: 2,
      creatorApprovalStatus: "approved",
      creatorApprovedAt: "2026-07-28",
    },
  );
});
