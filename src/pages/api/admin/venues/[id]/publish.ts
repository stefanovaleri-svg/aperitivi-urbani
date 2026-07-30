import type { APIRoute } from "astro";

import { assertAdminMutation } from "../../../../../lib/cms/admin-request";
import { getBindings, requireDatabase } from "../../../../../lib/cms/bindings";
import { publishVenue } from "../../../../../lib/cms/repository";
import { apiError, json, requestId } from "../../../../../lib/cms/responses";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  try {
    const principal = assertAdminMutation(context, "reviewer");
    const venueId = context.params.id;
    if (!venueId || venueId.length > 200) throw new Error("ID locale non valido.");
    const venue = await publishVenue(
      requireDatabase(getBindings(context.locals)),
      principal,
      venueId,
      requestId(context.request),
    );
    return json(200, { venue });
  } catch (error) {
    return apiError(error);
  }
};
