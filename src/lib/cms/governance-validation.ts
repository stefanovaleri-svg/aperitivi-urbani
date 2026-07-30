import type {
  CreatorLifecyclePatch,
  CreatorLicenseStatus,
  CreatorStatus,
  SiteLifecyclePatch,
  SiteStatus,
} from "./types";
import { CmsInputError } from "./venue-validation";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CREATOR_STATUSES = new Set<CreatorStatus>([
  "prospect",
  "onboarding",
  "active",
  "paused",
  "archived",
]);
const LICENSE_STATUSES = new Set<CreatorLicenseStatus>([
  "pending",
  "active",
  "expired",
  "revoked",
]);
const SITE_STATUSES = new Set<SiteStatus>([
  "draft",
  "active",
  "paused",
  "archived",
]);

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CmsInputError(["Il body deve essere un oggetto JSON."]);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`Campo non supportato: ${key}`);
  }
}

function revision(value: unknown, issues: string[]): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    issues.push("revision deve essere un intero positivo");
  }
  return Number(value);
}

function optionalDate(
  value: unknown,
  field: string,
  issues: string[],
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    issues.push(`${field} deve essere una data YYYY-MM-DD o null`);
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !DATE_RE.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    issues.push(`${field} deve essere una data YYYY-MM-DD valida`);
  }
  return value;
}

export function parseCreatorLifecyclePatch(
  value: unknown,
): CreatorLifecyclePatch {
  const input = inputRecord(value);
  const issues: string[] = [];
  rejectUnknown(
    input,
    new Set([
      "revision",
      "status",
      "licenseStatus",
      "licenseStartsAt",
      "licenseEndsAt",
    ]),
    issues,
  );

  const result: CreatorLifecyclePatch = {
    revision: revision(input.revision, issues),
  };
  if ("status" in input) {
    if (
      typeof input.status !== "string" ||
      !CREATOR_STATUSES.has(input.status as CreatorStatus)
    ) {
      issues.push("status creator non valido");
    } else {
      result.status = input.status as CreatorStatus;
    }
  }
  if ("licenseStatus" in input) {
    if (
      typeof input.licenseStatus !== "string" ||
      !LICENSE_STATUSES.has(input.licenseStatus as CreatorLicenseStatus)
    ) {
      issues.push("licenseStatus non valido");
    } else {
      result.licenseStatus = input.licenseStatus as CreatorLicenseStatus;
    }
  }
  if ("licenseStartsAt" in input) {
    result.licenseStartsAt = optionalDate(
      input.licenseStartsAt,
      "licenseStartsAt",
      issues,
    );
  }
  if ("licenseEndsAt" in input) {
    result.licenseEndsAt = optionalDate(
      input.licenseEndsAt,
      "licenseEndsAt",
      issues,
    );
  }
  if (
    !("status" in input) &&
    !("licenseStatus" in input) &&
    !("licenseStartsAt" in input) &&
    !("licenseEndsAt" in input)
  ) {
    issues.push("Indicare almeno una modifica lifecycle creator");
  }
  if (
    result.licenseStartsAt &&
    result.licenseEndsAt &&
    result.licenseEndsAt <= result.licenseStartsAt
  ) {
    issues.push("licenseEndsAt deve essere successiva a licenseStartsAt");
  }

  if (issues.length) throw new CmsInputError(issues);
  return result;
}

export function parseSiteLifecyclePatch(value: unknown): SiteLifecyclePatch {
  const input = inputRecord(value);
  const issues: string[] = [];
  rejectUnknown(input, new Set(["revision", "status"]), issues);
  const parsedRevision = revision(input.revision, issues);
  if (
    typeof input.status !== "string" ||
    !SITE_STATUSES.has(input.status as SiteStatus)
  ) {
    issues.push("status sito non valido");
  }
  if (issues.length) throw new CmsInputError(issues);
  return {
    revision: parsedRevision,
    status: input.status as SiteStatus,
  };
}
