import type { APIContext } from "astro";

import { cmsWritesEnabled, getBindings } from "./bindings";
import { CmsAuthError } from "./auth";
import {
  assertCsrfDoubleSubmit,
  assertMinimumRole,
  assertSameOriginMutation,
  CmsSecurityError,
  readJsonBody,
} from "./security";
import type { CmsPrincipal, CmsRole } from "./types";

export function requireCmsPrincipal(locals: App.Locals): CmsPrincipal {
  if (!locals.cmsPrincipal) {
    throw new CmsAuthError(401, "cms_principal_missing", "Sessione CMS mancante.");
  }
  return locals.cmsPrincipal;
}

export function assertAdminMutation(
  context: Pick<APIContext, "request" | "locals" | "url">,
  requiredRole: CmsRole,
): CmsPrincipal {
  const bindings = getBindings(context.locals);
  if (!cmsWritesEnabled(bindings)) {
    throw new CmsSecurityError(
      503,
      "cms_writes_disabled",
      "Le scritture CMS sono temporaneamente disabilitate.",
    );
  }
  const principal = requireCmsPrincipal(context.locals);
  assertMinimumRole(principal.role, requiredRole);
  assertSameOriginMutation(
    context.request,
    bindings.APP_ORIGIN ?? context.url.origin,
  );
  assertCsrfDoubleSubmit(context.request, {
    cookieName: context.locals.cmsCsrfCookieName,
  });
  return principal;
}

export async function readAdminJson<T = unknown>(
  context: Pick<APIContext, "request" | "locals" | "url">,
  requiredRole: CmsRole,
  maxBytes?: number,
): Promise<{ principal: CmsPrincipal; body: T }> {
  const principal = assertAdminMutation(context, requiredRole);
  const body = await readJsonBody<T>(context.request, maxBytes);
  return { principal, body };
}
