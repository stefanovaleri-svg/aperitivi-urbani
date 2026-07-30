import type {
  ApprovalStatus,
  DisclosureKind,
  ExperienceTagInput,
  VenueDraftInput,
  VenuePatchInput,
} from "./types";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const APPROVALS = new Set<ApprovalStatus>(["pending", "approved", "rejected"]);
const DISCLOSURES = new Set<DisclosureKind>([
  "none",
  "invited",
  "gifted",
  "paid_sponsorship",
  "affiliate",
  "other_disclosed",
  "unknown",
]);
const TAG_DIMENSIONS = new Set<ExperienceTagInput["dimension"]>([
  "occasion",
  "group",
  "dietary",
  "setting",
  "time",
  "price",
  "atmosphere",
  "other",
]);

export class CmsInputError extends Error {
  readonly status = 400;
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "CmsInputError";
    this.issues = issues;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CmsInputError(["Il body deve essere un oggetto JSON."]);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  issues: string[],
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`Campo non supportato: ${key}`);
  }
}

function requiredText(
  value: unknown,
  field: string,
  max: number,
  issues: string[],
): string {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${field} è obbligatorio`);
    return "";
  }
  const result = value.trim();
  if (result.length > max) issues.push(`${field} supera ${max} caratteri`);
  return result;
}

function optionalText(
  value: unknown,
  field: string,
  max: number,
  issues: string[],
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    issues.push(`${field} deve essere testo o null`);
    return null;
  }
  const result = value.trim();
  if (result.length > max) issues.push(`${field} supera ${max} caratteri`);
  return result || null;
}

function optionalNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
  issues: string[],
): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    issues.push(`${field} deve essere un numero tra ${min} e ${max}`);
    return null;
  }
  return value;
}

function optionalUrl(value: unknown, field: string, issues: string[]): string | null {
  const text = optionalText(value, field, 2_048, issues);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      issues.push(`${field} deve usare http o https`);
    }
  } catch {
    issues.push(`${field} non è un URL valido`);
  }
  return text;
}

function optionalDate(value: unknown, field: string, issues: string[]): string | null {
  const text = optionalText(value, field, 10, issues);
  if (!text) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (
    !DATE_RE.test(text) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  ) {
    issues.push(`${field} deve essere una data YYYY-MM-DD valida`);
  } else if (text > new Date().toISOString().slice(0, 10)) {
    issues.push(`${field} non può essere nel futuro`);
  }
  return text;
}

function parseApproval(
  value: unknown,
  issues: string[],
  fallback: ApprovalStatus,
): ApprovalStatus {
  if (typeof value === "string" && APPROVALS.has(value as ApprovalStatus)) {
    return value as ApprovalStatus;
  }
  if (value !== undefined) issues.push("creatorApprovalStatus non valido");
  return fallback;
}

function parseDisclosure(
  value: unknown,
  issues: string[],
  fallback: DisclosureKind,
): DisclosureKind {
  if (typeof value === "string" && DISCLOSURES.has(value as DisclosureKind)) {
    return value as DisclosureKind;
  }
  if (value !== undefined) issues.push("disclosureKind non valido");
  return fallback;
}

function parseTags(value: unknown, issues: string[]): ExperienceTagInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) {
    issues.push("experienceTags deve essere un array con massimo 50 elementi");
    return [];
  }
  const seen = new Set<string>();
  const result: ExperienceTagInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push("Ogni experience tag deve essere un oggetto");
      continue;
    }
    const tag = item as Record<string, unknown>;
    rejectUnknown(tag, new Set(["slug", "label", "dimension"]), issues);
    const slug = requiredText(tag.slug, "experienceTags.slug", 80, issues);
    const label = requiredText(tag.label, "experienceTags.label", 100, issues);
    const dimension =
      typeof tag.dimension === "string" &&
      TAG_DIMENSIONS.has(tag.dimension as ExperienceTagInput["dimension"])
        ? (tag.dimension as ExperienceTagInput["dimension"])
        : "other";
    if (tag.dimension !== undefined && dimension === "other" && tag.dimension !== "other") {
      issues.push(`Dimensione experience tag non valida: ${String(tag.dimension)}`);
    }
    if (slug && !SLUG_RE.test(slug)) issues.push(`Slug experience tag non valido: ${slug}`);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      result.push({ slug, label, dimension });
    }
  }
  return result;
}

const CREATE_FIELDS = new Set([
  "name",
  "slug",
  "city",
  "neighbourhood",
  "address",
  "googlePlaceId",
  "latitude",
  "longitude",
  "priceTier",
  "directionsUrl",
  "bookingUrl",
  "creatorHandle",
  "creatorDisplayName",
  "sourcePostUrl",
  "attributionText",
  "editorialText",
  "creatorApprovalStatus",
  "creatorApprovedAt",
  "disclosureKind",
  "visitedOn",
  "visitCaption",
  "sourceKind",
  "experienceTags",
]);

export function parseVenueDraft(value: unknown): VenueDraftInput {
  const input = record(value);
  const issues: string[] = [];
  rejectUnknown(input, CREATE_FIELDS, issues);

  const slug = requiredText(input.slug, "slug", 120, issues);
  if (slug && !SLUG_RE.test(slug)) issues.push("slug deve essere minuscolo e URL-safe");

  const creatorHandle = requiredText(input.creatorHandle, "creatorHandle", 30, issues)
    .replace(/^@/, "")
    .toLowerCase();
  if (creatorHandle && !HANDLE_RE.test(creatorHandle)) {
    issues.push("creatorHandle non valido");
  }

  const priceTier = optionalNumber(input.priceTier, "priceTier", 1, 5, issues);
  if (priceTier !== null && !Number.isInteger(priceTier)) {
    issues.push("priceTier deve essere un intero");
  }

  const creatorApprovalStatus = parseApproval(
    input.creatorApprovalStatus,
    issues,
    "pending",
  );
  const creatorApprovedAt = optionalDate(
    input.creatorApprovedAt,
    "creatorApprovedAt",
    issues,
  );
  if (creatorApprovalStatus !== "approved" && creatorApprovedAt) {
    issues.push("creatorApprovedAt è ammesso solo quando lo stato è approved");
  }
  if (creatorApprovalStatus === "approved" && !creatorApprovedAt) {
    issues.push("creatorApprovedAt è obbligatorio quando lo stato è approved");
  }

  const sourceKind =
    input.sourceKind === undefined || input.sourceKind === "single"
      ? "single"
      : input.sourceKind === "list"
        ? "list"
        : "single";
  if (
    input.sourceKind !== undefined &&
    input.sourceKind !== "single" &&
    input.sourceKind !== "list"
  ) {
    issues.push("sourceKind non valido");
  }

  const result: VenueDraftInput = {
    name: requiredText(input.name, "name", 180, issues),
    slug,
    city: requiredText(input.city ?? "Milano", "city", 120, issues),
    neighbourhood: optionalText(input.neighbourhood, "neighbourhood", 160, issues),
    address: optionalText(input.address, "address", 500, issues),
    googlePlaceId: optionalText(input.googlePlaceId, "googlePlaceId", 255, issues),
    latitude: optionalNumber(input.latitude, "latitude", -90, 90, issues),
    longitude: optionalNumber(input.longitude, "longitude", -180, 180, issues),
    priceTier,
    directionsUrl: optionalUrl(input.directionsUrl, "directionsUrl", issues),
    bookingUrl: optionalUrl(input.bookingUrl, "bookingUrl", issues),
    creatorHandle,
    creatorDisplayName: requiredText(
      input.creatorDisplayName,
      "creatorDisplayName",
      180,
      issues,
    ),
    sourcePostUrl: optionalUrl(input.sourcePostUrl, "sourcePostUrl", issues),
    attributionText: optionalText(input.attributionText, "attributionText", 500, issues),
    editorialText: optionalText(input.editorialText, "editorialText", 20_000, issues) ?? "",
    creatorApprovalStatus,
    creatorApprovedAt,
    disclosureKind: parseDisclosure(input.disclosureKind, issues, "unknown"),
    visitedOn: optionalDate(input.visitedOn, "visitedOn", issues),
    visitCaption: optionalText(input.visitCaption, "visitCaption", 20_000, issues),
    sourceKind,
    experienceTags: parseTags(input.experienceTags, issues),
  };

  if (issues.length) throw new CmsInputError(issues);
  return result;
}

const PATCH_FIELDS = new Set([
  "revision",
  "name",
  "slug",
  "city",
  "neighbourhood",
  "address",
  "googlePlaceId",
  "latitude",
  "longitude",
  "priceTier",
  "directionsUrl",
  "bookingUrl",
  "sourcePostUrl",
  "attributionText",
  "editorialText",
  "creatorApprovalStatus",
  "creatorApprovedAt",
  "disclosureKind",
  "experienceTags",
]);

export function parseVenuePatch(value: unknown): VenuePatchInput {
  const input = record(value);
  const issues: string[] = [];
  rejectUnknown(input, PATCH_FIELDS, issues);
  if (!Number.isInteger(input.revision) || Number(input.revision) < 1) {
    issues.push("revision deve essere un intero positivo");
  }

  const result: VenuePatchInput = { revision: Number(input.revision) };
  if ("name" in input) result.name = requiredText(input.name, "name", 180, issues);
  if ("slug" in input) {
    result.slug = requiredText(input.slug, "slug", 120, issues);
    if (result.slug && !SLUG_RE.test(result.slug)) {
      issues.push("slug deve essere minuscolo e URL-safe");
    }
  }
  if ("city" in input) result.city = requiredText(input.city, "city", 120, issues);
  if ("neighbourhood" in input) {
    result.neighbourhood = optionalText(input.neighbourhood, "neighbourhood", 160, issues);
  }
  if ("address" in input) result.address = optionalText(input.address, "address", 500, issues);
  if ("googlePlaceId" in input) {
    result.googlePlaceId = optionalText(input.googlePlaceId, "googlePlaceId", 255, issues);
  }
  if ("latitude" in input) {
    result.latitude = optionalNumber(input.latitude, "latitude", -90, 90, issues);
  }
  if ("longitude" in input) {
    result.longitude = optionalNumber(input.longitude, "longitude", -180, 180, issues);
  }
  if ("priceTier" in input) {
    result.priceTier = optionalNumber(input.priceTier, "priceTier", 1, 5, issues);
    if (result.priceTier !== null && !Number.isInteger(result.priceTier)) {
      issues.push("priceTier deve essere un intero");
    }
  }
  if ("directionsUrl" in input) {
    result.directionsUrl = optionalUrl(input.directionsUrl, "directionsUrl", issues);
  }
  if ("bookingUrl" in input) {
    result.bookingUrl = optionalUrl(input.bookingUrl, "bookingUrl", issues);
  }
  if ("sourcePostUrl" in input) {
    result.sourcePostUrl = optionalUrl(input.sourcePostUrl, "sourcePostUrl", issues);
  }
  if ("attributionText" in input) {
    result.attributionText = optionalText(
      input.attributionText,
      "attributionText",
      500,
      issues,
    );
  }
  if ("editorialText" in input) {
    result.editorialText =
      optionalText(input.editorialText, "editorialText", 20_000, issues) ?? "";
  }
  if ("creatorApprovalStatus" in input) {
    result.creatorApprovalStatus = parseApproval(
      input.creatorApprovalStatus,
      issues,
      "pending",
    );
  }
  if ("creatorApprovedAt" in input) {
    result.creatorApprovedAt = optionalDate(
      input.creatorApprovedAt,
      "creatorApprovedAt",
      issues,
    );
  }
  if ("disclosureKind" in input) {
    result.disclosureKind = parseDisclosure(input.disclosureKind, issues, "unknown");
  }
  if ("experienceTags" in input) {
    result.experienceTags = parseTags(input.experienceTags, issues);
  }

  const hasApproval = "creatorApprovalStatus" in input;
  const hasApprovalDate = "creatorApprovedAt" in input;
  if (hasApproval !== hasApprovalDate) {
    issues.push(
      "creatorApprovalStatus e creatorApprovedAt devono essere aggiornati insieme",
    );
  } else if (
    hasApproval &&
    result.creatorApprovalStatus === "approved" &&
    !result.creatorApprovedAt
  ) {
    issues.push("creatorApprovedAt è obbligatorio quando lo stato è approved");
  } else if (
    hasApproval &&
    result.creatorApprovalStatus !== "approved" &&
    result.creatorApprovedAt
  ) {
    issues.push("creatorApprovedAt deve essere null se lo stato non è approved");
  }

  if (issues.length) throw new CmsInputError(issues);
  return result;
}
