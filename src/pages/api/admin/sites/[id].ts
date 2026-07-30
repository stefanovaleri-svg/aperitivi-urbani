import type { APIRoute } from "astro";

import { readAdminJson } from "../../../../lib/cms/admin-request";
import { getBindings, requireDatabase } from "../../../../lib/cms/bindings";
import { parseSiteLifecyclePatch } from "../../../../lib/cms/governance-validation";
import { updateSiteLifecycle } from "../../../../lib/cms/repository";
import { apiError, json, requestId } from "../../../../lib/cms/responses";
import { CmsSecurityError } from "../../../../lib/cms/security";

export const prerender = false;

export const PATCH: APIRoute = async (context) => {
  try {
    const siteId = context.params.id;
    if (!siteId || siteId.length > 200) {
      throw new CmsSecurityError(400, "site_id_invalid", "ID sito non valido.");
    }
    const { principal, body } = await readAdminJson(
      context,
      "reviewer",
      8 * 1024,
    );
    const site = await updateSiteLifecycle(
      requireDatabase(getBindings(context.locals)),
      principal,
      siteId,
      parseSiteLifecyclePatch(body),
      requestId(context.request),
    );
    return json(200, { site });
  } catch (error) {
    return apiError(error);
  }
};
