import type { APIRoute } from "astro";

import { getBindings, requireDatabase } from "../../lib/cms/bindings";
import { recordIntentEvent } from "../../lib/cms/repository";
import { apiError, json } from "../../lib/cms/responses";
import {
  assertSameOriginMutation,
  CmsSecurityError,
  readJsonBody,
  sanitizeCampaignSlug,
} from "../../lib/cms/security";

export const prerender = false;

const EVENT_TYPES = new Set([
  "directions_click",
  "save",
  "share",
  "booking_click",
]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EventInput = {
  listingId?: unknown;
  eventType?: unknown;
  eventId?: unknown;
  sessionId?: unknown;
};

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  );
}

function parseInput(value: EventInput) {
  if (
    typeof value.listingId !== "string" ||
    !value.listingId ||
    value.listingId.length > 200
  ) {
    throw new CmsSecurityError(400, "event_listing_invalid", "listingId non valido.");
  }
  if (
    typeof value.eventType !== "string" ||
    !EVENT_TYPES.has(value.eventType)
  ) {
    throw new CmsSecurityError(400, "event_type_invalid", "eventType non valido.");
  }
  if (typeof value.eventId !== "string" || !UUID_RE.test(value.eventId)) {
    throw new CmsSecurityError(400, "event_id_invalid", "eventId non valido.");
  }
  if (typeof value.sessionId !== "string" || !UUID_RE.test(value.sessionId)) {
    throw new CmsSecurityError(400, "event_session_invalid", "sessionId non valido.");
  }
  return {
    listingId: value.listingId,
    eventType: value.eventType as
      | "directions_click"
      | "save"
      | "share"
      | "booking_click",
    eventId: value.eventId,
    sessionId: value.sessionId,
  };
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  try {
    const bindings = getBindings(locals);
    if (bindings.PUBLIC_CONTENT_ENABLED === "false") {
      return json(404, { accepted: false });
    }
    assertSameOriginMutation(request, bindings.APP_ORIGIN ?? url.origin);
    const salt = bindings.EVENT_HASH_SALT ?? "";
    if (salt.length < 32) {
      throw new CmsSecurityError(
        503,
        "event_salt_missing",
        "Raccolta eventi non configurata.",
      );
    }
    const input = parseInput(await readJsonBody<EventInput>(request, 16 * 1024));
    if (!bindings.EVENT_IP_RATE_LIMITER) {
      throw new CmsSecurityError(
        503,
        "event_rate_limit_missing",
        "Rate limit eventi non configurato.",
      );
    }
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (!clientIp) {
      throw new CmsSecurityError(
        503,
        "trusted_client_signal_missing",
        "Segnale client Cloudflare non disponibile.",
      );
    }
    const sessionHash = await hmac(`session:${input.sessionId}`, salt);
    const clientHash = await hmac(`client-ip:${clientIp}`, salt);
    const rate = await bindings.EVENT_IP_RATE_LIMITER.limit({
      key: `events:${clientHash}`,
    });
    if (!rate.success) {
      throw new CmsSecurityError(
        429,
        "event_rate_limited",
        "Troppe richieste evento.",
      );
    }
    const referrerHeader = request.headers.get("referer");
    let referrer: string | null = null;
    const utm: Record<string, string> = {};
    if (referrerHeader) {
      try {
        const candidate = new URL(referrerHeader);
        if (candidate.origin === url.origin) {
          referrer = candidate.pathname.slice(0, 500);
          for (const key of [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_content",
          ]) {
            const item = candidate.searchParams.get(key);
            if (item) {
              const safe = sanitizeCampaignSlug(item);
              if (safe) utm[key] = safe;
            }
          }
        }
      } catch {
        // Invalid or cross-origin referrers are deliberately ignored.
      }
    }

    const result = await recordIntentEvent(requireDatabase(bindings), {
      listingId: input.listingId,
      eventType: input.eventType,
      eventId: await hmac(
        `event:${input.listingId}:${input.eventId}`,
        salt,
      ),
      occurredAt: new Date().toISOString(),
      pseudonymousSessionId: sessionHash,
      referrer,
      utm,
    });
    return json(result.accepted ? 202 : 404, result);
  } catch (error) {
    return apiError(error);
  }
};
