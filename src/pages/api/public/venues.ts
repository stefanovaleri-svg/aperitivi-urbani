export const prerender = false;

import type { APIRoute } from "astro";

import { getBindings } from "../../../lib/cms/bindings";
import { listPublicLocales } from "../../../lib/cms/public-source";
import { json } from "../../../lib/cms/responses";

export const GET: APIRoute = async ({ locals }) => {
  try {
    const entries = await listPublicLocales(getBindings(locals));
    return json(
      200,
      {
        venues: entries.map((entry) => ({
          id: entry.data.listing_id ?? null,
          slug: entry.data.slug,
          name: entry.data.nome,
          city: entry.data.citta,
          neighbourhood: entry.data.zona,
          types: entry.data.tipo,
          experiences: entry.data.esperienze ?? [],
          priceBand: entry.data.fascia_prezzo,
          sponsored: entry.data.sponsorizzato,
          disclosureKind: entry.data.disclosure_kind ?? "unknown",
          latitude: entry.data.lat ?? null,
          longitude: entry.data.lng ?? null,
        })),
      },
      { "cache-control": "private, no-store" },
    );
  } catch (error) {
    console.error("Public venues API error", error);
    return json(503, { error: "Catalogo temporaneamente non disponibile." });
  }
};
