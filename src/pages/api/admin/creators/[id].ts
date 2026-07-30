import type { APIRoute } from "astro";

import { readAdminJson } from "../../../../lib/cms/admin-request";
import { getBindings, requireDatabase } from "../../../../lib/cms/bindings";
import { parseCreatorLifecyclePatch } from "../../../../lib/cms/governance-validation";
import { updateCreatorLifecycle } from "../../../../lib/cms/repository";
import { apiError, json, requestId } from "../../../../lib/cms/responses";
import { CmsSecurityError } from "../../../../lib/cms/security";

export const prerender = false;

export const PATCH: APIRoute = async (context) => {
  try {
    const creatorId = context.params.id;
    if (!creatorId || creatorId.length > 200) {
      throw new CmsSecurityError(
        400,
        "creator_id_invalid",
        "ID creator non valido.",
      );
    }
    const { principal, body } = await readAdminJson(
      context,
      "reviewer",
      16 * 1024,
    );
    const creator = await updateCreatorLifecycle(
      requireDatabase(getBindings(context.locals)),
      principal,
      creatorId,
      parseCreatorLifecyclePatch(body),
      requestId(context.request),
    );
    return json(200, { creator });
  } catch (error) {
    return apiError(error);
  }
};
