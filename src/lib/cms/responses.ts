import {
  CmsConflictError,
  CmsNotFoundError,
  CmsPublishError,
} from "./repository";
import { CmsAuthError } from "./auth";
import { CmsMediaError } from "./media";
import { CmsSecurityError } from "./security";
import { CmsInputError } from "./venue-validation";

export function json(
  status: number,
  body: unknown,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

export function requestId(request: Request): string {
  return request.headers.get("cf-ray") ?? crypto.randomUUID();
}

export function apiError(error: unknown): Response {
  if (
    error instanceof CmsAuthError ||
    error instanceof CmsMediaError ||
    error instanceof CmsSecurityError
  ) {
    return json(error.status, { error: error.message, code: error.code });
  }
  if (error instanceof CmsInputError) {
    return json(error.status, { error: "Input non valido.", issues: error.issues });
  }
  if (error instanceof CmsPublishError) {
    return json(error.status, {
      error: "La scheda non soddisfa i requisiti di pubblicazione.",
      issues: error.issues,
    });
  }
  if (error instanceof CmsConflictError || error instanceof CmsNotFoundError) {
    return json(error.status, { error: error.message });
  }
  console.error("CMS API error", error);
  return json(500, { error: "Errore interno." });
}
