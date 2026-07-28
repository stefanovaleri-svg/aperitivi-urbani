import assert from "node:assert/strict";
import test from "node:test";

import {
  CmsSecurityError,
  assertCsrfDoubleSubmit,
  assertMinimumRole,
  assertSameOriginMutation,
  createCsrfToken,
  isExplicitlyEnabled,
  readJsonBody,
  roleAtLeast,
  sanitizeCampaignSlug,
  serializeCsrfCookie,
} from "../src/lib/cms/security.ts";

test("requires an exact opt-in for state-changing features", () => {
  assert.equal(isExplicitlyEnabled("true"), true);
  for (const value of [undefined, "", "false", "TRUE", "1", "yes"]) {
    assert.equal(isExplicitlyEnabled(value), false);
  }
});

test("keeps only non-identifying campaign slugs", () => {
  assert.equal(sanitizeCampaignSlug(" Summer_Launch-26 "), "summer_launch-26");
  for (const value of [
    "user@example.com",
    "+39 333 1234567",
    "campaign 2026",
    "1234567890",
    "x".repeat(65),
  ]) {
    assert.equal(sanitizeCampaignSlug(value), null);
  }
});

function mutationRequest(headers = {}, body = "{}") {
  return new Request("https://admin.example.com/api/admin/venues", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://admin.example.com",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body,
  });
}

test("accepts only the exact configured origin and same-origin fetch metadata", () => {
  assert.doesNotThrow(() =>
    assertSameOriginMutation(
      mutationRequest(),
      "https://admin.example.com/",
    ),
  );

  for (const headers of [
    { Origin: "https://evil.example" },
    { Origin: "" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "" },
  ]) {
    assert.throws(
      () =>
        assertSameOriginMutation(
          mutationRequest(headers),
          "https://admin.example.com",
        ),
      (error) => error instanceof CmsSecurityError && error.status === 403,
    );
  }
});

test("issues and verifies a double-submit CSRF token", () => {
  const token = createCsrfToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  const cookie = serializeCsrfCookie(token);
  assert.match(cookie, /^__Host-au_csrf=/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /HttpOnly/);

  const request = mutationRequest({
    Cookie: `other=1; __Host-au_csrf=${token}`,
    "X-CSRF-Token": token,
  });
  assert.doesNotThrow(() => assertCsrfDoubleSubmit(request));

  assert.throws(
    () =>
      assertCsrfDoubleSubmit(
        mutationRequest({
          Cookie: `__Host-au_csrf=${token}`,
          "X-CSRF-Token": createCsrfToken(),
        }),
      ),
    (error) =>
      error instanceof CmsSecurityError && error.code === "csrf_invalid",
  );
});

test("reads bounded JSON and rejects MIME, declared and streamed overflows", async () => {
  const parsed = await readJsonBody(
    mutationRequest({ "Content-Type": "application/problem+json" }, '{"ok":true}'),
    32,
  );
  assert.deepEqual(parsed, { ok: true });

  await assert.rejects(
    readJsonBody(
      mutationRequest({ "Content-Type": "text/plain" }, '{"ok":true}'),
      32,
    ),
    (error) =>
      error instanceof CmsSecurityError &&
      error.code === "content_type_unsupported",
  );

  await assert.rejects(
    readJsonBody(
      mutationRequest({ "Content-Length": "100" }, '{"ok":true}'),
      32,
    ),
    (error) =>
      error instanceof CmsSecurityError && error.code === "body_too_large",
  );

  await assert.rejects(
    readJsonBody(mutationRequest({}, JSON.stringify({ value: "x".repeat(40) })), 32),
    (error) =>
      error instanceof CmsSecurityError && error.code === "body_too_large",
  );
});

test("rejects malformed JSON and non-identity content encodings", async () => {
  await assert.rejects(
    readJsonBody(mutationRequest({}, "{broken"), 64),
    (error) =>
      error instanceof CmsSecurityError && error.code === "json_invalid",
  );

  await assert.rejects(
    readJsonBody(
      mutationRequest({ "Content-Encoding": "gzip" }, '{"ok":true}'),
      64,
    ),
    (error) =>
      error instanceof CmsSecurityError &&
      error.code === "content_encoding_unsupported",
  );
});

test("enforces owner > reviewer > editor role ordering", () => {
  assert.equal(roleAtLeast("owner", "editor"), true);
  assert.equal(roleAtLeast("reviewer", "editor"), true);
  assert.equal(roleAtLeast("editor", "reviewer"), false);
  assert.doesNotThrow(() => assertMinimumRole("owner", "owner"));
  assert.throws(
    () => assertMinimumRole("editor", "reviewer"),
    (error) =>
      error instanceof CmsSecurityError && error.code === "role_forbidden",
  );
});
