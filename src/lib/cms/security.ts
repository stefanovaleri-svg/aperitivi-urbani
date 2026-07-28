import type { CmsRole } from "./types";

export const DEFAULT_MAX_JSON_BYTES = 64 * 1024;
export const DEFAULT_CSRF_COOKIE_NAME = "__Host-au_csrf";
export const DEFAULT_CSRF_HEADER_NAME = "X-CSRF-Token";

export function isExplicitlyEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function sanitizeCampaignSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized) ||
    /\d{7,}/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export const CMS_ROLE_RANK: Readonly<Record<CmsRole, number>> = Object.freeze({
  editor: 1,
  reviewer: 2,
  owner: 3,
});

export class CmsSecurityError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CmsSecurityError";
    this.status = status;
    this.code = code;
  }
}

function normalizeExpectedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CmsSecurityError(
      503,
      "origin_misconfigured",
      "APP_ORIGIN non valido.",
    );
  }

  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new CmsSecurityError(
      503,
      "origin_misconfigured",
      "APP_ORIGIN deve essere un'origine senza path, query o credenziali.",
    );
  }
  return url.origin;
}

export function assertSameOriginMutation(
  request: Request,
  expectedOrigin: string,
): void {
  const expected = normalizeExpectedOrigin(expectedOrigin);
  const supplied = request.headers.get("Origin");
  if (!supplied) {
    throw new CmsSecurityError(
      403,
      "origin_missing",
      "Header Origin mancante.",
    );
  }

  let actual: string;
  try {
    actual = new URL(supplied).origin;
  } catch {
    throw new CmsSecurityError(
      403,
      "origin_invalid",
      "Header Origin non valido.",
    );
  }
  if (actual !== expected || supplied !== actual) {
    throw new CmsSecurityError(
      403,
      "origin_forbidden",
      "Origine della richiesta non consentita.",
    );
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite !== "same-origin") {
    throw new CmsSecurityError(
      403,
      "fetch_site_forbidden",
      "La richiesta deve provenire dallo stesso origin.",
    );
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createCsrfToken(byteLength = 32): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 16 || byteLength > 64) {
    throw new CmsSecurityError(
      500,
      "csrf_configuration_invalid",
      "La lunghezza del token CSRF deve essere tra 16 e 64 byte.",
    );
  }
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function isValidCsrfToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{22,86}$/.test(value);
}

export function readCookie(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

export function serializeCsrfCookie(
  token: string,
  options: {
    cookieName?: string;
    maxAgeSeconds?: number;
    secure?: boolean;
  } = {},
): string {
  if (!isValidCsrfToken(token)) {
    throw new CmsSecurityError(
      500,
      "csrf_token_invalid",
      "Token CSRF non valido.",
    );
  }

  const cookieName = options.cookieName ?? DEFAULT_CSRF_COOKIE_NAME;
  const maxAge = options.maxAgeSeconds ?? 8 * 60 * 60;
  const secure = options.secure ?? true;
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookieName)) {
    throw new CmsSecurityError(
      500,
      "csrf_cookie_invalid",
      "Nome cookie CSRF non valido.",
    );
  }
  if (
    cookieName.startsWith("__Host-") &&
    !secure
  ) {
    throw new CmsSecurityError(
      500,
      "csrf_cookie_invalid",
      "I cookie __Host- richiedono Secure e Path=/.",
    );
  }
  if (!Number.isSafeInteger(maxAge) || maxAge <= 0) {
    throw new CmsSecurityError(
      500,
      "csrf_cookie_invalid",
      "Durata cookie CSRF non valida.",
    );
  }

  return [
    `${cookieName}=${token}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Strict",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearCsrfCookie(
  cookieName = DEFAULT_CSRF_COOKIE_NAME,
  secure = true,
): string {
  return [
    `${cookieName}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Strict",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function assertCsrfDoubleSubmit(
  request: Request,
  options: {
    cookieName?: string;
    headerName?: string;
  } = {},
): void {
  const cookieName = options.cookieName ?? DEFAULT_CSRF_COOKIE_NAME;
  const headerName = options.headerName ?? DEFAULT_CSRF_HEADER_NAME;
  const cookieToken = readCookie(request.headers.get("Cookie"), cookieName);
  const headerToken = request.headers.get(headerName);

  if (
    !cookieToken ||
    !headerToken ||
    !isValidCsrfToken(cookieToken) ||
    !isValidCsrfToken(headerToken) ||
    !constantTimeEqual(cookieToken, headerToken)
  ) {
    throw new CmsSecurityError(
      403,
      "csrf_invalid",
      "Verifica CSRF fallita.",
    );
  }
}

export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" ||
    Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"))
  );
}

export function assertJsonRequestMetadata(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new CmsSecurityError(
      500,
      "json_limit_invalid",
      "Limite JSON non valido.",
    );
  }
  if (!isJsonContentType(request.headers.get("Content-Type"))) {
    throw new CmsSecurityError(
      415,
      "content_type_unsupported",
      "Content-Type JSON richiesto.",
    );
  }

  const contentEncoding = request.headers.get("Content-Encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new CmsSecurityError(
      415,
      "content_encoding_unsupported",
      "Content-Encoding non supportato.",
    );
  }

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new CmsSecurityError(
        400,
        "content_length_invalid",
        "Content-Length non valido.",
      );
    }
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length)) {
      throw new CmsSecurityError(
        400,
        "content_length_invalid",
        "Content-Length non valido.",
      );
    }
    if (length > maxBytes) {
      throw new CmsSecurityError(
        413,
        "body_too_large",
        "Corpo JSON troppo grande.",
      );
    }
  }
}

async function readBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new CmsSecurityError(
          413,
          "body_too_large",
          "Corpo JSON troppo grande.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonBody<T = unknown>(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<T> {
  assertJsonRequestMetadata(request, maxBytes);
  const bytes = await readBodyWithinLimit(request, maxBytes);
  if (bytes.byteLength === 0) {
    throw new CmsSecurityError(400, "json_empty", "Corpo JSON mancante.");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CmsSecurityError(
      400,
      "json_encoding_invalid",
      "Il corpo JSON non è UTF-8 valido.",
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CmsSecurityError(
      400,
      "json_invalid",
      "Corpo JSON non valido.",
    );
  }
}

export function roleAtLeast(actual: CmsRole, required: CmsRole): boolean {
  return CMS_ROLE_RANK[actual] >= CMS_ROLE_RANK[required];
}

export function assertMinimumRole(
  actual: CmsRole,
  required: CmsRole,
): void {
  if (!roleAtLeast(actual, required)) {
    throw new CmsSecurityError(
      403,
      "role_forbidden",
      "Ruolo CMS insufficiente.",
    );
  }
}
