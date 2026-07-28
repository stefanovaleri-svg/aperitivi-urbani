import { env as cloudflareEnv } from "cloudflare:workers";
import { isExplicitlyEnabled } from "./security";

export type ContentSource = "markdown" | "d1";

export interface CmsBindings {
  DB?: D1Database;
  MEDIA_BUCKET?: R2Bucket;
  EVENT_IP_RATE_LIMITER?: RateLimit;
  CONTENT_SOURCE?: ContentSource;
  PUBLIC_CONTENT_ENABLED?: string;
  SITE_CREATOR_HANDLE?: string;
  APP_ORIGIN?: string;
  CF_ACCESS_TEAM_URL?: string;
  CF_ACCESS_AUD?: string;
  CMS_BOOTSTRAP_OWNER_EMAILS?: string;
  CMS_WRITES_ENABLED?: string;
  MAX_UPLOAD_BYTES?: string;
  EVENT_HASH_SALT?: string;
  GOOGLE_MAPS_API_KEY?: string;
  GOOGLE_PLACES_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

export function getBindings(locals?: unknown): CmsBindings {
  void locals;
  return cloudflareEnv as unknown as CmsBindings;
}

export function requireDatabase(bindings: CmsBindings): D1Database {
  if (!bindings.DB) {
    throw new Error("Binding D1 DB non configurato.");
  }
  return bindings.DB;
}

export function requireMediaBucket(bindings: CmsBindings): R2Bucket {
  if (!bindings.MEDIA_BUCKET) {
    throw new Error("Binding R2 MEDIA_BUCKET non configurato.");
  }
  return bindings.MEDIA_BUCKET;
}

export function cmsWritesEnabled(bindings: CmsBindings): boolean {
  return isExplicitlyEnabled(bindings.CMS_WRITES_ENABLED);
}

export function getMaxUploadBytes(bindings: CmsBindings): number {
  const parsed = Number.parseInt(bindings.MAX_UPLOAD_BYTES ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8 * 1024 * 1024;
}
