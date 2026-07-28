import type { APIRoute } from "astro";

import { assertAdminMutation } from "../../../lib/cms/admin-request";
import {
  getBindings,
  getMaxUploadBytes,
  requireDatabase,
  requireMediaBucket,
} from "../../../lib/cms/bindings";
import {
  generateMediaStorageTarget,
  validateImageBytes,
} from "../../../lib/cms/media";
import {
  getAdminVenue,
  getFirstVisitId,
  insertPendingMedia,
  markMediaState,
} from "../../../lib/cms/repository";
import { apiError, json, requestId } from "../../../lib/cms/responses";
import { CmsSecurityError } from "../../../lib/cms/security";

export const prerender = false;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: Uint8Array): Promise<string> {
  const bytes = Uint8Array.from(value);
  return hex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer)),
  );
}

async function venueStorageNamespace(venueId: string): Promise<string> {
  const suffix = venueId.replace(/^venue:/, "");
  if (UUID_RE.test(suffix)) return suffix;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(venueId)),
  );
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const value = hex(digest.slice(0, 16));
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(
    12,
    16,
  )}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function requiredFormText(
  form: FormData,
  name: string,
  maxLength: number,
): string {
  const value = form.get(name);
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new CmsSecurityError(400, "upload_field_invalid", `${name} non valido.`);
  }
  return value.trim();
}

export const POST: APIRoute = async (context) => {
  let pending:
    | {
        db: D1Database;
        mediaId: string;
        principal: NonNullable<App.Locals["cmsPrincipal"]>;
        requestId: string;
        bucket: R2Bucket;
        storageKey: string;
        objectStored: boolean;
      }
    | undefined;
  try {
    const principal = assertAdminMutation(context, "editor");
    const bindings = getBindings(context.locals);
    const db = requireDatabase(bindings);
    const maxBytes = getMaxUploadBytes(bindings);
    const contentType = context.request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
      throw new CmsSecurityError(
        415,
        "upload_content_type_invalid",
        "Upload multipart/form-data richiesto.",
      );
    }
    const contentLength = context.request.headers.get("content-length");
    if (!contentLength || !/^\d+$/.test(contentLength)) {
      throw new CmsSecurityError(
        411,
        "upload_length_required",
        "Content-Length richiesto per l'upload.",
      );
    }
    if (Number(contentLength) > maxBytes + 512 * 1024) {
      throw new CmsSecurityError(413, "upload_too_large", "Upload troppo grande.");
    }

    const form = await context.request.formData();
    const venueId = requiredFormText(form, "venueId", 200);
    const listingId = requiredFormText(form, "listingId", 200);
    const altText = requiredFormText(form, "altText", 500);
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new CmsSecurityError(400, "upload_file_missing", "Immagine mancante.");
    }
    if (
      !file.name ||
      file.name.length > 255 ||
      /[\u0000-\u001f\u007f]/.test(file.name)
    ) {
      throw new CmsSecurityError(
        400,
        "upload_filename_invalid",
        "Nome file non valido.",
      );
    }

    const venue = await getAdminVenue(db, venueId);
    if (String(venue.listing_id) !== listingId) {
      throw new CmsSecurityError(
        400,
        "upload_listing_mismatch",
        "Il locale e la scheda non corrispondono.",
      );
    }
    if (venue.listing_status === "published") {
      throw new CmsSecurityError(
        409,
        "published_listing_immutable",
        "Non è possibile aggiungere media a una scheda già pubblicata.",
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = validateImageBytes(bytes, file.type, maxBytes);
    const target = generateMediaStorageTarget(
      await venueStorageNamespace(venueId),
      image.format,
    );
    const digest = await sha256(bytes);
    const visitId = await getFirstVisitId(db, listingId);
    const reqId = requestId(context.request);

    await insertPendingMedia(
      db,
      principal,
      {
        id: target.mediaId,
        visitId,
        storageKey: target.storageKey,
        originalFilename: file.name,
        mimeType: image.mimeType,
        byteSize: image.byteSize,
        sha256: digest,
        altText,
        isHero: form.get("isHero") === "true",
      },
      reqId,
    );
    const bucket = requireMediaBucket(bindings);
    pending = {
      db,
      mediaId: target.mediaId,
      principal,
      requestId: reqId,
      bucket,
      storageKey: target.storageKey,
      objectStored: false,
    };

    await bucket.put(target.storageKey, bytes, {
      httpMetadata: {
        contentType: image.mimeType,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        mediaId: target.mediaId,
        sha256: digest,
      },
    });
    pending.objectStored = true;
    await markMediaState(db, principal, target.mediaId, "ready", reqId);
    pending = undefined;

    return json(201, {
      media: {
        id: target.mediaId,
        url: `/media/${target.mediaId}`,
        mimeType: image.mimeType,
        byteSize: image.byteSize,
      },
    });
  } catch (error) {
    if (pending) {
      if (pending.objectStored) {
        await pending.bucket
          .delete(pending.storageKey)
          .catch((deleteError) =>
            console.error("Unable to remove orphaned R2 object", deleteError),
          );
      }
      await markMediaState(
        pending.db,
        pending.principal,
        pending.mediaId,
        "failed",
        pending.requestId,
      ).catch((markError) => console.error("Unable to mark failed media", markError));
    }
    return apiError(error);
  }
};
