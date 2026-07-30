export type CmsRole = "owner" | "reviewer" | "editor";
export type ListingStatus = "draft" | "review" | "published" | "archived";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type CreatorStatus =
  | "prospect"
  | "onboarding"
  | "active"
  | "paused"
  | "archived";
export type CreatorLicenseStatus = "pending" | "active" | "expired" | "revoked";
export type SiteStatus = "draft" | "active" | "paused" | "archived";
export type DisclosureKind =
  | "none"
  | "invited"
  | "gifted"
  | "paid_sponsorship"
  | "affiliate"
  | "other_disclosed"
  | "unknown";

export interface CmsPrincipal {
  id: string;
  accessSub: string;
  email: string;
  role: CmsRole;
}

export interface CreatorLifecyclePatch {
  revision: number;
  status?: CreatorStatus;
  licenseStatus?: CreatorLicenseStatus;
  licenseStartsAt?: string | null;
  licenseEndsAt?: string | null;
}

export interface SiteLifecyclePatch {
  revision: number;
  status: SiteStatus;
}

export interface ExperienceTagInput {
  slug: string;
  label: string;
  dimension:
    | "occasion"
    | "group"
    | "dietary"
    | "setting"
    | "time"
    | "price"
    | "atmosphere"
    | "other";
}

export interface VenueDraftInput {
  name: string;
  slug: string;
  city: string;
  neighbourhood: string | null;
  address: string | null;
  googlePlaceId: string | null;
  latitude: number | null;
  longitude: number | null;
  priceTier: number | null;
  directionsUrl: string | null;
  bookingUrl: string | null;
  creatorHandle: string;
  creatorDisplayName: string;
  sourcePostUrl: string | null;
  attributionText: string | null;
  editorialText: string;
  creatorApprovalStatus: ApprovalStatus;
  creatorApprovedAt: string | null;
  disclosureKind: DisclosureKind;
  visitedOn: string | null;
  visitCaption: string | null;
  sourceKind: "single" | "list";
  experienceTags: ExperienceTagInput[];
}

export interface VenuePatchInput {
  revision: number;
  name?: string;
  slug?: string;
  city?: string;
  neighbourhood?: string | null;
  address?: string | null;
  googlePlaceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  priceTier?: number | null;
  directionsUrl?: string | null;
  bookingUrl?: string | null;
  sourcePostUrl?: string | null;
  attributionText?: string | null;
  editorialText?: string;
  creatorApprovalStatus?: ApprovalStatus;
  creatorApprovedAt?: string | null;
  disclosureKind?: DisclosureKind;
  experienceTags?: ExperienceTagInput[];
}

export interface AdminVenueSummary {
  venueId: string;
  listingId: string;
  name: string;
  slug: string;
  city: string;
  neighbourhood: string | null;
  status: ListingStatus;
  approvalStatus: ApprovalStatus;
  creatorHandle: string;
  revision: number;
  updatedAt: string;
}
