import type { APIRoute } from "astro";

import { readAdminJson } from "../../../../lib/cms/admin-request";
import { getBindings, requireDatabase } from "../../../../lib/cms/bindings";
import { updateMediaRights } from "../../../../lib/cms/repository";
import { apiError, json, requestId } from "../../../../lib/cms/responses";
import { CmsSecurityError } from "../../../../lib/cms/security";

export const prerender = false;

const RIGHTS = new Set(["approved", "restricted", "revoked"]);

export const PATCH: APIRoute = async (context) => {
  try {
    const mediaId = context.params.id;
    if (!mediaId || mediaId.length > 200) {
      throw new CmsSecurityError(400, "media_id_invalid", "ID media non valido.");
    }
    const { principal, body } = await readAdminJson<Record<string, unknown>>(
      context,
      "reviewer",
      8 * 1024,
    );
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "rightsStatus") ||
      typeof body.rightsStatus !== "string" ||
      !RIGHTS.has(body.rightsStatus)
    ) {
      throw new CmsSecurityError(
        400,
        "media_rights_invalid",
        "rightsStatus non valido.",
      );
    }
    const media = await updateMediaRights(
      requireDatabase(getBindings(context.locals)),
      principal,
      mediaId,
      body.rightsStatus as "approved" | "restricted" | "revoked",
      requestId(context.request),
    );
    return json(200, { media });
  } catch (error) {
    return apiError(error);
  }
};
