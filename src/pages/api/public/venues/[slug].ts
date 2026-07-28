export const prerender = false;

import type { APIRoute } from "astro";

import { getBindings } from "../../../../lib/cms/bindings";
import { getPublicLocale } from "../../../../lib/cms/public-source";
import { json } from "../../../../lib/cms/responses";

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const venue = await getPublicLocale(getBindings(locals), params.slug ?? "");
    if (!venue) return json(404, { error: "Locale non trovato." });
    return json(
      200,
      {
        venue: {
          id: venue.data.listing_id ?? null,
          slug: venue.data.slug,
          name: venue.data.nome,
          city: venue.data.citta,
          neighbourhood: venue.data.zona,
          address: venue.data.indirizzo,
          types: venue.data.tipo,
          experiences: venue.data.esperienze ?? [],
          priceBand: venue.data.fascia_prezzo,
          mentionedItems: venue.data.piatti_drink_citati,
          sentiment: venue.data.sentiment,
          inferredRating: venue.data.voto_dedotto,
          sponsored: venue.data.sponsorizzato,
          disclosureKind: venue.data.disclosure_kind ?? "unknown",
          latitude: venue.data.lat ?? null,
          longitude: venue.data.lng ?? null,
          directionsUrl: venue.data.directions_url ?? null,
          bookingUrl: venue.data.booking_url ?? null,
          photos: venue.data.foto,
          visits: venue.data.visite.map((visit) => ({
            date: visit.data || null,
            sourcePostUrl: visit.post_url,
            caption: visit.caption,
            photos: visit.foto,
            sourceKind: visit.fonte_tipo,
          })),
        },
      },
      { "cache-control": "private, no-store" },
    );
  } catch (error) {
    console.error("Public venue API error", error);
    return json(503, { error: "Scheda temporaneamente non disponibile." });
  }
};
