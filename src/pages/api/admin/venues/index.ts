import type { APIRoute } from "astro";

import { readAdminJson, requireCmsPrincipal } from "../../../../lib/cms/admin-request";
import { getBindings, requireDatabase } from "../../../../lib/cms/bindings";
import {
  createVenueDraft,
  listAdminVenues,
} from "../../../../lib/cms/repository";
import { apiError, json, requestId } from "../../../../lib/cms/responses";
import { parseVenueDraft } from "../../../../lib/cms/venue-validation";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    requireCmsPrincipal(locals);
    const venues = await listAdminVenues(requireDatabase(getBindings(locals)));
    return json(200, { venues });
  } catch (error) {
    return apiError(error);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    const { principal, body } = await readAdminJson(context, "editor");
    const parsed = parseVenueDraft(body);
    const input =
      principal.role === "editor"
        ? {
            ...parsed,
            creatorApprovalStatus: "pending" as const,
            creatorApprovedAt: null,
          }
        : parsed;
    const venue = await createVenueDraft(
      requireDatabase(getBindings(context.locals)),
      principal,
      input,
      requestId(context.request),
    );
    return json(201, { venue });
  } catch (error) {
    return apiError(error);
  }
};
