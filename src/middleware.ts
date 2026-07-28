import { defineMiddleware } from "astro:middleware";

import { authenticateCmsRequest, CmsAuthError } from "./lib/cms/auth";
import { getBindings, requireDatabase } from "./lib/cms/bindings";
import { apiError, json } from "./lib/cms/responses";
import {
  createCsrfToken,
  DEFAULT_CSRF_COOKIE_NAME,
  readCookie,
  serializeCsrfCookie,
} from "./lib/cms/security";

function isProtectedPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
  );
}

function isAdminApi(pathname: string): boolean {
  return pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

function isPublicCatalogPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/locali/") ||
    pathname === "/api/public" ||
    pathname.startsWith("/api/public/") ||
    pathname.startsWith("/media/")
  );
}

function applySecurityHeaders(headers: Headers, admin = false): Headers {
  if (!headers.has("content-security-policy")) {
    headers.set(
      "content-security-policy",
      admin
        ? "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        : "default-src 'self'; img-src 'self' data: https://maps.googleapis.com https://maps.gstatic.com; script-src 'self' https://static.cloudflareinsights.com https://maps.googleapis.com 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-src https://www.google.com; connect-src 'self' https://maps.googleapis.com https://*.googleapis.com https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
  }
  headers.set("x-frame-options", "DENY");
  headers.set("x-content-type-options", "nosniff");
  headers.set(
    "referrer-policy",
    admin ? "same-origin" : "strict-origin-when-cross-origin",
  );
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (admin) {
    headers.set("cache-control", "no-store, private");
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  }
  return headers;
}

function secureResponse(response: Response, admin = false): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: applySecurityHeaders(new Headers(response.headers), admin),
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (!isProtectedPath(pathname)) {
    const response = secureResponse(await next());
    const bindings = getBindings(context.locals);
    if (
      isPublicCatalogPath(pathname) &&
      (bindings.CONTENT_SOURCE === "d1" ||
        bindings.PUBLIC_CONTENT_ENABLED === "false")
    ) {
      const headers = new Headers(response.headers);
      headers.set("cache-control", "private, no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }

  try {
    const bindings = getBindings(context.locals);
    const db = requireDatabase(bindings);
    context.locals.cmsPrincipal = await authenticateCmsRequest(context.request, {
      db,
      teamUrl: bindings.CF_ACCESS_TEAM_URL ?? "",
      audience: bindings.CF_ACCESS_AUD ?? "",
      bootstrapOwnerEmails: bindings.CMS_BOOTSTRAP_OWNER_EMAILS,
    });

    const isHttps = (bindings.APP_ORIGIN ?? context.url.origin).startsWith(
      "https://",
    );
    const cookieName = isHttps ? DEFAULT_CSRF_COOKIE_NAME : "au_csrf";
    const existingToken = readCookie(
      context.request.headers.get("Cookie"),
      cookieName,
    );
    const csrfToken = existingToken ?? createCsrfToken();
    context.locals.cmsCsrfToken = csrfToken;
    context.locals.cmsCsrfCookieName = cookieName;

    const response = await next();
    const headers = applySecurityHeaders(new Headers(response.headers), true);
    if (!existingToken) {
      headers.append(
        "set-cookie",
        serializeCsrfCookie(csrfToken, {
          cookieName,
          secure: isHttps,
        }),
      );
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    if (isAdminApi(pathname)) return secureResponse(apiError(error), true);
    if (error instanceof CmsAuthError) {
      return secureResponse(
        new Response(
          error.status === 401
            ? "Accesso al CMS richiesto."
            : "Identità non autorizzata per il CMS.",
          {
            status: error.status,
            headers: {
              "content-type": "text/plain; charset=utf-8",
            },
          },
        ),
        true,
      );
    }
    console.error("CMS middleware error", error);
    return secureResponse(
      json(503, { error: "CMS non configurato." }),
      true,
    );
  }
});
