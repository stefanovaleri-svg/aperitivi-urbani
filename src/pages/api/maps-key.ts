export const prerender = false;

import type { APIRoute } from "astro";
import { getBindings } from "../../lib/cms/bindings";

export const GET: APIRoute = async ({ locals }) => {
  const key = getBindings(locals).GOOGLE_MAPS_API_KEY ?? "";
  return new Response(JSON.stringify({ key }), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
  });
};
