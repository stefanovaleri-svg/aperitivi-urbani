export const prerender = false;

import type { APIRoute } from "astro";

import {
  getBindings,
  requireDatabase,
  requireMediaBucket,
} from "../../lib/cms/bindings";
import { getPublicMedia } from "../../lib/cms/repository";

function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const bindings = getBindings(locals);
    if (bindings.PUBLIC_CONTENT_ENABLED === "false") return notFound();
    const db = requireDatabase(bindings);
    const bucket = requireMediaBucket(bindings);
    const media = await getPublicMedia(db, params.id ?? "");
    if (!media) return notFound();
    const object = await bucket.get(media.storage_key);
    if (!object) return notFound();

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", media.mime_type);
    headers.set("content-length", String(media.byte_size));
    headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set("content-security-policy", "default-src 'none'; sandbox");
    headers.set("etag", object.httpEtag);
    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    console.error("Media delivery error", error);
    return notFound();
  }
};
