import {
  createRemoteJWKSet,
  jwtVerify,
  type JWK,
  type JWTPayload,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
} from "jose";

import type { CmsPrincipal, CmsRole } from "./types";

const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
const CMS_ROLES = new Set<CmsRole>(["owner", "reviewer", "editor"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const remoteJwksByIssuer = new Map<string, JWTVerifyGetKey>();

export type AccessVerificationKey =
  | CryptoKey
  | Uint8Array
  | JWK
  | JWTVerifyGetKey;

export interface AccessVerificationOptions {
  teamUrl: string;
  audience: string;
  verificationKey?: AccessVerificationKey;
  currentDate?: Date;
  clockToleranceSeconds?: number;
}

export interface VerifiedAccessIdentity {
  sub: string;
  email: string;
  issuer: string;
  audience: string | string[];
  expiresAt: number;
  notBefore: number;
  payload: JWTPayload & { email: string };
}

export interface PrincipalResolutionOptions {
  bootstrapOwnerEmails?: string;
  idFactory?: () => string;
}

export interface AuthenticateCmsRequestOptions
  extends AccessVerificationOptions,
    PrincipalResolutionOptions {
  db: D1Database;
}

type PrincipalRow = {
  id: string;
  access_sub: string;
  email: string;
  role: string;
  active: number;
};

export class CmsAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CmsAuthError";
    this.status = status;
    this.code = code;
  }
}

function configurationError(message: string): CmsAuthError {
  return new CmsAuthError(503, "cms_auth_misconfigured", message);
}

export function normalizeAccessTeamUrl(value: string): string {
  if (!value?.trim()) {
    throw configurationError("CF_ACCESS_TEAM_URL non configurato.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw configurationError(
      `CF_ACCESS_TEAM_URL non valido: ${(cause as Error).message}`,
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw configurationError(
      "CF_ACCESS_TEAM_URL deve essere un'origine HTTPS senza path, query o credenziali.",
    );
  }

  return url.origin;
}

function getRemoteJwks(issuer: string): JWTVerifyGetKey {
  const cached = remoteJwksByIssuer.get(issuer);
  if (cached) return cached;

  const resolver = createRemoteJWKSet(
    new URL(`${issuer}/cdn-cgi/access/certs`),
  );
  remoteJwksByIssuer.set(issuer, resolver);
  return resolver;
}

function normalizeVerifiedEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new CmsAuthError(
      403,
      "access_token_invalid",
      "Il token Access non contiene un indirizzo email.",
    );
  }

  const email = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) {
    throw new CmsAuthError(
      403,
      "access_token_invalid",
      "Il token Access contiene un indirizzo email non valido.",
    );
  }
  return email;
}

export async function verifyCloudflareAccessRequest(
  request: Request,
  options: AccessVerificationOptions,
): Promise<VerifiedAccessIdentity> {
  const issuer = normalizeAccessTeamUrl(options.teamUrl);
  const audience = options.audience?.trim();
  if (!audience) {
    throw configurationError("CF_ACCESS_AUD non configurato.");
  }

  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) {
    throw new CmsAuthError(
      401,
      "access_token_missing",
      "Token Cloudflare Access mancante.",
    );
  }

  const key = options.verificationKey ?? getRemoteJwks(issuer);
  const verifyOptions: JWTVerifyOptions = {
    algorithms: ["RS256"],
    issuer,
    audience,
    requiredClaims: ["exp", "nbf", "sub", "email"],
    currentDate: options.currentDate,
    clockTolerance: options.clockToleranceSeconds ?? 5,
  };

  try {
    const result =
      typeof key === "function"
        ? await jwtVerify(token, key, verifyOptions)
        : await jwtVerify(token, key, verifyOptions);

    if (result.protectedHeader.alg !== "RS256") {
      throw new Error("Algoritmo JWT non consentito.");
    }

    const { payload } = result;
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.exp !== "number" ||
      typeof payload.nbf !== "number" ||
      !payload.iss ||
      !payload.aud
    ) {
      throw new Error("Claim Access obbligatorie mancanti.");
    }

    return {
      sub: payload.sub,
      email: normalizeVerifiedEmail(payload.email),
      issuer: payload.iss,
      audience: payload.aud,
      expiresAt: payload.exp,
      notBefore: payload.nbf,
      payload: payload as JWTPayload & { email: string },
    };
  } catch (cause) {
    if (cause instanceof CmsAuthError) throw cause;
    throw new CmsAuthError(
      403,
      "access_token_invalid",
      "Token Cloudflare Access non valido.",
      { cause },
    );
  }
}

export function parseBootstrapOwnerEmails(value?: string): Set<string> {
  const emails = new Set<string>();
  for (const candidate of value?.split(",") ?? []) {
    const email = candidate.trim().toLowerCase();
    if (!email) continue;
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) {
      throw configurationError(
        "CMS_BOOTSTRAP_OWNER_EMAILS contiene un indirizzo non valido.",
      );
    }
    emails.add(email);
  }
  return emails;
}

function isCmsRole(value: string): value is CmsRole {
  return CMS_ROLES.has(value as CmsRole);
}

async function findPrincipal(
  db: D1Database,
  identity: VerifiedAccessIdentity,
): Promise<PrincipalRow | null> {
  return db
    .prepare(
      `SELECT id, access_sub, email, role, active
         FROM cms_principals
        WHERE access_sub = ?
        LIMIT 1`,
    )
    .bind(identity.sub)
    .first<PrincipalRow>();
}

function principalFromRow(
  row: PrincipalRow,
  identity: VerifiedAccessIdentity,
): CmsPrincipal {
  if (!isCmsRole(row.role)) {
    throw configurationError(
      `Ruolo CMS non valido per il principal ${row.id}.`,
    );
  }
  return {
    id: row.id,
    accessSub: identity.sub,
    email: identity.email,
    role: row.role,
  };
}

async function provisionBootstrapOwner(
  db: D1Database,
  identity: VerifiedAccessIdentity,
  current: PrincipalRow | null,
  idFactory: () => string,
): Promise<CmsPrincipal> {
  if (current) {
    await db
      .prepare(
        `UPDATE cms_principals
            SET access_sub = ?,
                email = ?,
                role = 'owner',
                active = 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .bind(identity.sub, identity.email, current.id)
      .run();
  } else {
    const id = idFactory();
    if (!UUID_PATTERN.test(id)) {
      throw configurationError(
        "Impossibile generare un UUID valido per il principal CMS.",
      );
    }

    try {
      await db
        .prepare(
          `INSERT INTO cms_principals
             (id, access_sub, email, role, active, created_at, updated_at)
           VALUES (?, ?, ?, 'owner', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(id, identity.sub, identity.email)
        .run();
    } catch (cause) {
      const raced = await findPrincipal(db, identity);
      if (!raced) throw cause;
    }
  }

  const provisioned = await findPrincipal(db, identity);
  if (
    !provisioned ||
    provisioned.active !== 1 ||
    provisioned.role !== "owner"
  ) {
    throw configurationError(
      "Provisioning del bootstrap owner CMS non riuscito.",
    );
  }
  return principalFromRow(provisioned, identity);
}

export async function resolveCmsPrincipal(
  db: D1Database,
  identity: VerifiedAccessIdentity,
  options: PrincipalResolutionOptions = {},
): Promise<CmsPrincipal> {
  const row = await findPrincipal(db, identity);
  if (row?.active === 1) {
    return principalFromRow(row, identity);
  }

  const bootstrapOwners = parseBootstrapOwnerEmails(
    options.bootstrapOwnerEmails,
  );
  if (bootstrapOwners.has(identity.email)) {
    return provisionBootstrapOwner(
      db,
      identity,
      row,
      options.idFactory ?? (() => crypto.randomUUID()),
    );
  }

  throw new CmsAuthError(
    403,
    row ? "cms_principal_inactive" : "cms_principal_unknown",
    "Identità non autorizzata per il CMS.",
  );
}

export async function authenticateCmsRequest(
  request: Request,
  options: AuthenticateCmsRequestOptions,
): Promise<CmsPrincipal> {
  const identity = await verifyCloudflareAccessRequest(request, options);
  return resolveCmsPrincipal(options.db, identity, {
    bootstrapOwnerEmails: options.bootstrapOwnerEmails,
    idFactory: options.idFactory,
  });
}
