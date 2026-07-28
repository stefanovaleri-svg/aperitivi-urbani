import type { APIRoute } from "astro";

import { readAdminJson, requireCmsPrincipal } from "../../../../../lib/cms/admin-request";
import { getBindings, requireDatabase } from "../../../../../lib/cms/bindings";
import {
  getAdminVenue,
  updateVenueDraft,
} from "../../../../../lib/cms/repository";
import { apiError, json, requestId } from "../../../../../lib/cms/responses";
import { assertMinimumRole } from "../../../../../lib/cms/security";
import { parseVenuePatch } from "../../../../../lib/cms/venue-validation";

export const prerender = false;

function venueId(value: string | undefined): string {
  if (!value || value.length > 200) throw new Error("ID locale non valido.");
  return value;
}

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    requireCmsPrincipal(locals);
    const venue = await getAdminVenue(
      requireDatabase(getBindings(locals)),
      venueId(params.id),
    );
    return json(200, { venue });
  } catch (error) {
    return apiError(error);
  }
};

export const PATCH: APIRoute = async (context) => {
  try {
    const { principal, body } = await readAdminJson(context, "editor");
    const patch = parseVenuePatch(body);
    if (
      [
        "sourcePostUrl",
        "attributionText",
        "creatorApprovalStatus",
        "creatorApprovedAt",
        "disclosureKind",
      ].some((field) => field in patch)
    ) {
      assertMinimumRole(principal.role, "reviewer");
    }
    const venue = await updateVenueDraft(
      requireDatabase(getBindings(context.locals)),
      principal,
      venueId(context.params.id),
      patch,
      requestId(context.request),
    );
    return json(200, { venue });
  } catch (error) {
    return apiError(error);
  }
};
