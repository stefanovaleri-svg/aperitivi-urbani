import type { APIRoute } from "astro";

import { cmsWritesEnabled, getBindings } from "../../../lib/cms/bindings";
import { requireCmsPrincipal } from "../../../lib/cms/admin-request";
import { apiError, json } from "../../../lib/cms/responses";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const principal = requireCmsPrincipal(locals);
    return json(200, {
      principal: {
        email: principal.email,
        role: principal.role,
      },
      csrfToken: locals.cmsCsrfToken,
      writesEnabled: cmsWritesEnabled(getBindings(locals)),
    });
  } catch (error) {
    return apiError(error);
  }
};
