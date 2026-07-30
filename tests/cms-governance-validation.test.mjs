import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCreatorLifecyclePatch,
  parseSiteLifecyclePatch,
} from "../src/lib/cms/governance-validation.ts";
import { CmsInputError } from "../src/lib/cms/venue-validation.ts";

test("creator lifecycle parser accepts bounded governance changes", () => {
  assert.deepEqual(
    parseCreatorLifecyclePatch({
      revision: 3,
      status: "active",
      licenseStatus: "active",
      licenseStartsAt: "2026-07-01",
      licenseEndsAt: "2027-07-01",
    }),
    {
      revision: 3,
      status: "active",
      licenseStatus: "active",
      licenseStartsAt: "2026-07-01",
      licenseEndsAt: "2027-07-01",
    },
  );
});

test("creator lifecycle parser rejects unknown, empty, and invalid date changes", () => {
  for (const value of [
    { revision: 1 },
    { revision: 1, status: "published" },
    { revision: 1, status: "active", extra: true },
    { revision: 1, licenseStartsAt: "2026-02-30" },
    {
      revision: 1,
      licenseStartsAt: "2027-01-01",
      licenseEndsAt: "2026-01-01",
    },
  ]) {
    assert.throws(() => parseCreatorLifecyclePatch(value), CmsInputError);
  }
});

test("site lifecycle parser requires an exact valid state and revision", () => {
  assert.deepEqual(parseSiteLifecyclePatch({ revision: 2, status: "paused" }), {
    revision: 2,
    status: "paused",
  });
  assert.throws(
    () => parseSiteLifecyclePatch({ revision: 0, status: "active" }),
    CmsInputError,
  );
  assert.throws(
    () => parseSiteLifecyclePatch({ revision: 1, status: "draft", extra: true }),
    CmsInputError,
  );
});
