/// <reference types="astro/client" />

import type { CmsPrincipal } from "./lib/cms/types";

declare global {
  namespace App {
    interface Locals {
      cmsPrincipal?: CmsPrincipal;
      cmsCsrfToken?: string;
      cmsCsrfCookieName?: string;
    }
  }
}

export {};
