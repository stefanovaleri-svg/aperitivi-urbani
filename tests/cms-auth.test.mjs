import assert from "node:assert/strict";
import test from "node:test";

import { generateKeyPair, SignJWT } from "jose";

import {
  CmsAuthError,
  resolveCmsPrincipal,
  verifyCloudflareAccessRequest,
} from "../src/lib/cms/auth.ts";

const ISSUER = "https://aperitivi-test.cloudflareaccess.com";
const AUDIENCE = "test-access-audience";
const NOW_SECONDS = 1_800_000_000;
const NOW = new Date(NOW_SECONDS * 1000);

async function signedAccessToken(
  privateKey,
  {
    issuer = ISSUER,
    audience = AUDIENCE,
    subject = "access-user-1",
    email = "owner@example.com",
    notBefore = NOW_SECONDS - 10,
    expiresAt = NOW_SECONDS + 300,
    algorithm = "RS256",
  } = {},
) {
  const jwt = new SignJWT({ email })
    .setProtectedHeader({ alg: algorithm, kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setExpirationTime(expiresAt);
  if (notBefore !== null) jwt.setNotBefore(notBefore);
  return jwt.sign(privateKey);
}

function accessRequest(token) {
  return new Request("https://admin.example.com/api/admin/session", {
    headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
  });
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (!this.sql.includes("FROM cms_principals")) {
      throw new Error(`Unexpected first() SQL: ${this.sql}`);
    }
    const [sub] = this.values;
    return this.db.rows.find((row) => row.access_sub === sub) ?? null;
  }

  async run() {
    if (this.sql.includes("UPDATE cms_principals")) {
      const [sub, email, id] = this.values;
      const row = this.db.rows.find((candidate) => candidate.id === id);
      assert.ok(row, "bootstrap UPDATE must target a real row");
      Object.assign(row, {
        access_sub: sub,
        email,
        role: "owner",
        active: 1,
      });
      return { success: true };
    }

    if (this.sql.includes("INSERT INTO cms_principals")) {
      const [id, sub, email] = this.values;
      if (
        this.db.rows.some(
          (row) =>
            row.access_sub === sub ||
            row.email.toLowerCase() === email.toLowerCase(),
        )
      ) {
        throw new Error("UNIQUE constraint failed: cms_principals.email");
      }
      this.db.rows.push({
        id,
        access_sub: sub,
        email,
        role: "owner",
        active: 1,
      });
      return { success: true };
    }

    throw new Error(`Unexpected run() SQL: ${this.sql}`);
  }
}

class FakeD1 {
  constructor(rows = []) {
    this.rows = structuredClone(rows);
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

test("verifies RS256 Access token with exact issuer, audience, exp and nbf", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const token = await signedAccessToken(privateKey);

  const identity = await verifyCloudflareAccessRequest(accessRequest(token), {
    teamUrl: `${ISSUER}/`,
    audience: AUDIENCE,
    verificationKey: publicKey,
    currentDate: NOW,
  });

  assert.equal(identity.sub, "access-user-1");
  assert.equal(identity.email, "owner@example.com");
  assert.equal(identity.issuer, ISSUER);
  assert.equal(identity.expiresAt, NOW_SECONDS + 300);
  assert.equal(identity.notBefore, NOW_SECONDS - 10);
});

test("fails closed for missing, expired, future, missing-nbf and wrong-audience tokens", async (t) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const cases = [
    ["missing", null],
    [
      "expired",
      await signedAccessToken(privateKey, {
        expiresAt: NOW_SECONDS - 30,
      }),
    ],
    [
      "future",
      await signedAccessToken(privateKey, {
        notBefore: NOW_SECONDS + 30,
      }),
    ],
    [
      "wrong audience",
      await signedAccessToken(privateKey, {
        audience: "another-audience",
      }),
    ],
    [
      "missing nbf",
      await signedAccessToken(privateKey, {
        notBefore: null,
      }),
    ],
  ];

  for (const [name, token] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        verifyCloudflareAccessRequest(accessRequest(token), {
          teamUrl: ISSUER,
          audience: AUDIENCE,
          verificationKey: publicKey,
          currentDate: NOW,
          clockToleranceSeconds: 0,
        }),
        (error) =>
          error instanceof CmsAuthError &&
          ["access_token_missing", "access_token_invalid"].includes(error.code),
      );
    });
  }
});

test("rejects JWT algorithms other than RS256", async () => {
  const secret = new TextEncoder().encode("a-test-secret-at-least-32-bytes-long");
  const token = await signedAccessToken(secret, { algorithm: "HS256" });

  await assert.rejects(
    verifyCloudflareAccessRequest(accessRequest(token), {
      teamUrl: ISSUER,
      audience: AUDIENCE,
      verificationKey: secret,
      currentDate: NOW,
    }),
    (error) =>
      error instanceof CmsAuthError && error.code === "access_token_invalid",
  );
});

test("rejects a correctly signed token from a different exact issuer", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const token = await signedAccessToken(privateKey, {
    issuer: "https://other.cloudflareaccess.com",
  });

  await assert.rejects(
    verifyCloudflareAccessRequest(accessRequest(token), {
      teamUrl: ISSUER,
      audience: AUDIENCE,
      verificationKey: publicKey,
      currentDate: NOW,
    }),
    (error) =>
      error instanceof CmsAuthError && error.code === "access_token_invalid",
  );
});

test("maps an active principal by Access subject", async () => {
  const db = new FakeD1([
    {
      id: "principal-1",
      access_sub: "access-user-1",
      email: "owner@example.com",
      role: "reviewer",
      active: 1,
    },
  ]);

  const principal = await resolveCmsPrincipal(db, {
    sub: "access-user-1",
    email: "owner@example.com",
  });
  assert.deepEqual(principal, {
    id: "principal-1",
    accessSub: "access-user-1",
    email: "owner@example.com",
    role: "reviewer",
  });
});

test("persists an exact allowlisted bootstrap owner before returning", async () => {
  const db = new FakeD1();
  const principalId = "19d8d6a0-8c12-4d62-9ab7-856a8f8406ea";
  const identity = {
    sub: "bootstrap-sub",
    email: "bootstrap@example.com",
  };

  const principal = await resolveCmsPrincipal(db, identity, {
    bootstrapOwnerEmails:
      "someone@example.com, bootstrap@example.com, another@example.com",
    idFactory: () => principalId,
  });

  assert.deepEqual(principal, {
    id: principalId,
    accessSub: "bootstrap-sub",
    email: "bootstrap@example.com",
    role: "owner",
  });
  assert.deepEqual(db.rows, [
    {
      id: principalId,
      access_sub: "bootstrap-sub",
      email: "bootstrap@example.com",
      role: "owner",
      active: 1,
    },
  ]);
});

test("reactivates a disabled bootstrap owner only for the same Access subject", async () => {
  const db = new FakeD1([
    {
      id: "principal-disabled",
      access_sub: "bootstrap-sub",
      email: "bootstrap@example.com",
      role: "editor",
      active: 0,
    },
  ]);
  const identity = {
    sub: "bootstrap-sub",
    email: "bootstrap@example.com",
  };

  const principal = await resolveCmsPrincipal(db, identity, {
    bootstrapOwnerEmails: "bootstrap@example.com",
  });
  assert.equal(principal.id, "principal-disabled");
  assert.equal(principal.role, "owner");
  assert.equal(db.rows[0].active, 1);
  assert.equal(db.rows[0].access_sub, "bootstrap-sub");

  await assert.rejects(
    resolveCmsPrincipal(
      new FakeD1([
        {
          id: "principal-existing",
          access_sub: "immutable-sub",
          email: "bootstrap@example.com",
          role: "owner",
          active: 1,
        },
      ]),
      { sub: "different-sub", email: "bootstrap@example.com" },
      { bootstrapOwnerEmails: "bootstrap@example.com" },
    ),
    /UNIQUE constraint failed/,
  );

  await assert.rejects(
    resolveCmsPrincipal(new FakeD1(), {
      sub: "unknown-sub",
      email: "unknown@example.com",
    }),
    (error) =>
      error instanceof CmsAuthError && error.code === "cms_principal_unknown",
  );
});
