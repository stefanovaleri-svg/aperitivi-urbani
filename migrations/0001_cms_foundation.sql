PRAGMA foreign_keys = ON;

CREATE TABLE creators (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE
    CHECK (length(trim(slug)) > 0),
  display_name TEXT NOT NULL
    CHECK (length(trim(display_name)) > 0),
  handle TEXT NOT NULL UNIQUE
    CHECK (length(trim(handle)) > 0),
  follower_count INTEGER
    CHECK (follower_count IS NULL OR follower_count >= 0),
  primary_city TEXT,
  status TEXT NOT NULL DEFAULT 'prospect'
    CHECK (status IN ('prospect', 'onboarding', 'active', 'paused', 'archived')),
  license_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (license_status IN ('pending', 'active', 'expired', 'revoked')),
  license_starts_at TEXT,
  license_ends_at TEXT,
  license_revoked_at TEXT,
  content_rights_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(content_rights_json)),
  rev_share_config_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(rev_share_config_json)),
  revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision >= 1),
  last_mutation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (license_status = 'revoked' AND license_revoked_at IS NOT NULL)
    OR (license_status <> 'revoked' AND license_revoked_at IS NULL)
  )
);

CREATE TRIGGER creators_archived_is_terminal
BEFORE UPDATE OF status ON creators
WHEN OLD.status = 'archived' AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'archived creators cannot be reactivated');
END;

CREATE TRIGGER creators_revoked_licence_is_terminal
BEFORE UPDATE OF license_status, license_revoked_at ON creators
WHEN OLD.license_status = 'revoked' AND (
  NEW.license_status <> OLD.license_status
  OR NEW.license_revoked_at IS NOT OLD.license_revoked_at
)
BEGIN
  SELECT RAISE(ABORT, 'revoked creator licences cannot be reactivated');
END;

CREATE TABLE white_label_sites (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  site_key TEXT NOT NULL UNIQUE
    CHECK (length(trim(site_key)) > 0),
  display_name TEXT NOT NULL
    CHECK (length(trim(display_name)) > 0),
  hostname TEXT UNIQUE,
  city TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  branding_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(branding_json)),
  config_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(config_json)),
  revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision >= 1),
  last_mutation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER white_label_sites_archived_is_terminal
BEFORE UPDATE OF status ON white_label_sites
WHEN OLD.status = 'archived' AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'archived sites cannot be reactivated');
END;

CREATE INDEX idx_white_label_sites_creator
  ON white_label_sites(creator_id, status);

-- Authentication identities only. Passwords and password hashes do not belong
-- in D1; access_sub is the immutable subject from the configured access layer.
CREATE TABLE cms_principals (
  id TEXT PRIMARY KEY,
  access_sub TEXT NOT NULL UNIQUE
    CHECK (length(trim(access_sub)) > 0),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(trim(email)) > 0),
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'reviewer', 'editor')),
  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE
    CHECK (length(trim(slug)) > 0),
  name TEXT NOT NULL
    CHECK (length(trim(name)) > 0),
  city TEXT NOT NULL DEFAULT 'Milano'
    CHECK (length(trim(city)) > 0),
  neighborhood TEXT,
  address TEXT,
  latitude REAL
    CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  longitude REAL
    CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  google_place_id TEXT UNIQUE,
  directions_url TEXT,
  booking_url TEXT,
  venue_types_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(venue_types_json) AND json_type(venue_types_json) = 'array'),
  price_band TEXT
    CHECK (price_band IS NULL OR price_band IN ('€', '€€', '€€€', '€€€€', '€€€€€')),
  mentioned_items_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(mentioned_items_json) AND json_type(mentioned_items_json) = 'array'),
  sentiment TEXT
    CHECK (sentiment IS NULL OR sentiment IN ('entusiasta', 'positivo', 'neutro', 'tiepido', 'critico')),
  inferred_rating REAL
    CHECK (inferred_rating IS NULL OR (inferred_rating >= 1 AND inferred_rating <= 5)),
  sponsored INTEGER NOT NULL DEFAULT 0
    CHECK (sponsored IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_venues_city_neighborhood
  ON venues(city, neighborhood);

CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES white_label_sites(id) ON DELETE RESTRICT,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE RESTRICT,
  venue_id TEXT NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'published', 'archived')),
  source_post_url TEXT,
  attribution_text TEXT,
  editorial_text TEXT,
  creator_approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (creator_approval_status IN ('pending', 'approved', 'rejected')),
  creator_approved_at TEXT,
  sponsored_disclosure TEXT NOT NULL DEFAULT 'unknown'
    CHECK (
      sponsored_disclosure IN (
        'none',
        'invited',
        'gifted',
        'paid_sponsorship',
        'affiliate',
        'other_disclosed',
        'unknown'
      )
    ),
  premium_status TEXT NOT NULL DEFAULT 'none'
    CHECK (premium_status IN ('none', 'trial', 'active', 'paused', 'cancelled')),
  published_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1
    CHECK (revision >= 1),
  last_mutation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (site_id, venue_id),
  CHECK (
    status <> 'published'
    OR (
      source_post_url IS NOT NULL
      AND length(trim(source_post_url)) > 0
      AND attribution_text IS NOT NULL
      AND length(trim(attribution_text)) > 0
      AND creator_approval_status = 'approved'
      AND creator_approved_at IS NOT NULL
      AND length(trim(creator_approved_at)) > 0
    )
  )
);

CREATE INDEX idx_listings_site_status
  ON listings(site_id, status);
CREATE INDEX idx_listings_creator_status
  ON listings(creator_id, status);
CREATE INDEX idx_listings_venue
  ON listings(venue_id);

CREATE TRIGGER listings_publish_requires_active_creator_insert
BEFORE INSERT ON listings
WHEN NEW.status = 'published' AND (
  NOT EXISTS (
    SELECT 1
    FROM creators AS creator
    WHERE creator.id = NEW.creator_id
      AND creator.status = 'active'
      AND creator.license_status = 'active'
      AND creator.license_revoked_at IS NULL
      AND (
        creator.license_starts_at IS NULL
        OR creator.license_starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
      AND (
        creator.license_ends_at IS NULL
        OR creator.license_ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
  )
  OR NOT EXISTS (
    SELECT 1
    FROM white_label_sites AS site
    WHERE site.id = NEW.site_id
      AND site.creator_id = NEW.creator_id
      AND site.status = 'active'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'published listings require an active creator, active licence, and active matching site');
END;

CREATE TRIGGER listings_publish_requires_active_creator_update
BEFORE UPDATE OF status, creator_id, site_id ON listings
WHEN NEW.status = 'published' AND (
  NOT EXISTS (
    SELECT 1
    FROM creators AS creator
    WHERE creator.id = NEW.creator_id
      AND creator.status = 'active'
      AND creator.license_status = 'active'
      AND creator.license_revoked_at IS NULL
      AND (
        creator.license_starts_at IS NULL
        OR creator.license_starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
      AND (
        creator.license_ends_at IS NULL
        OR creator.license_ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
  )
  OR NOT EXISTS (
    SELECT 1
    FROM white_label_sites AS site
    WHERE site.id = NEW.site_id
      AND site.creator_id = NEW.creator_id
      AND site.status = 'active'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'published listings require an active creator, active licence, and active matching site');
END;

CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  visit_index INTEGER NOT NULL
    CHECK (visit_index >= 1),
  visited_on TEXT,
  source_post_url TEXT NOT NULL
    CHECK (length(trim(source_post_url)) > 0),
  caption TEXT NOT NULL
    CHECK (length(trim(caption)) > 0),
  source_issue_number INTEGER
    CHECK (source_issue_number IS NULL OR source_issue_number >= 1),
  source_kind TEXT NOT NULL DEFAULT 'singola'
    CHECK (source_kind IN ('singola', 'lista')),
  sponsored INTEGER NOT NULL DEFAULT 0
    CHECK (sponsored IN (0, 1)),
  sentiment TEXT
    CHECK (sentiment IS NULL OR sentiment IN ('entusiasta', 'positivo', 'neutro', 'tiepido', 'critico')),
  inferred_rating REAL
    CHECK (inferred_rating IS NULL OR (inferred_rating >= 1 AND inferred_rating <= 5)),
  source_metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(source_metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_visits_listing_order
  ON visits(listing_id, visit_index);
CREATE INDEX idx_visits_source_post
  ON visits(source_post_url);

CREATE TABLE experience_tags (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL
    CHECK (length(trim(slug)) > 0),
  label TEXT NOT NULL
    CHECK (length(trim(label)) > 0),
  dimension TEXT NOT NULL
    CHECK (length(trim(dimension)) > 0),
  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (dimension, slug)
);

CREATE TABLE listing_experience_tags (
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  experience_tag_id TEXT NOT NULL REFERENCES experience_tags(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (listing_id, experience_tag_id)
);

CREATE INDEX idx_listing_experience_tags_tag
  ON listing_experience_tags(experience_tag_id, listing_id);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE RESTRICT,
  storage_provider TEXT NOT NULL
    CHECK (storage_provider IN ('r2', 'legacy_static')),
  storage_key TEXT NOT NULL
    CHECK (length(trim(storage_key)) > 0),
  public_url TEXT,
  original_filename TEXT NOT NULL
    CHECK (length(trim(original_filename)) > 0),
  mime_type TEXT,
  byte_size INTEGER
    CHECK (byte_size IS NULL OR byte_size >= 0),
  sha256 TEXT
    CHECK (
      sha256 IS NULL
      OR (
        length(sha256) = 64
        AND sha256 NOT GLOB '*[^0-9a-f]*'
      )
    ),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'ready', 'failed', 'quarantined', 'deleted')),
  last_mutation_id TEXT,
  media_type TEXT NOT NULL DEFAULT 'image'
    CHECK (media_type IN ('image', 'video')),
  sort_order INTEGER NOT NULL DEFAULT 0
    CHECK (sort_order >= 0),
  is_hero INTEGER NOT NULL DEFAULT 0
    CHECK (is_hero IN (0, 1)),
  attribution_text TEXT,
  rights_status TEXT NOT NULL DEFAULT 'inherited'
    CHECK (rights_status IN ('inherited', 'approved', 'restricted', 'revoked')),
  supersedes_media_asset_id TEXT REFERENCES media_assets(id) ON DELETE RESTRICT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (storage_provider, storage_key),
  CHECK (supersedes_media_asset_id IS NULL OR supersedes_media_asset_id <> id),
  CHECK (
    state <> 'ready'
    OR (
      mime_type IS NOT NULL
      AND length(trim(mime_type)) > 0
      AND byte_size IS NOT NULL
      AND sha256 IS NOT NULL
    )
  )
);

CREATE INDEX idx_media_assets_visit_order
  ON media_assets(visit_id, sort_order, id);

CREATE TRIGGER media_assets_storage_key_content_immutable
BEFORE INSERT ON media_assets
WHEN EXISTS (
  SELECT 1
  FROM media_assets AS existing
  WHERE existing.storage_provider = NEW.storage_provider
    AND existing.storage_key = NEW.storage_key
    AND existing.sha256 IS NOT NEW.sha256
)
BEGIN
  SELECT RAISE(ABORT, 'media storage key already refers to different content');
END;

-- A replacement is a new row using supersedes_media_asset_id. Moving or
-- retargeting a historical asset would corrupt the visit record.
CREATE TRIGGER media_assets_identity_immutable
BEFORE UPDATE OF visit_id, storage_provider, storage_key ON media_assets
WHEN
  OLD.visit_id <> NEW.visit_id
  OR OLD.storage_provider <> NEW.storage_provider
  OR OLD.storage_key <> NEW.storage_key
BEGIN
  SELECT RAISE(ABORT, 'media asset identity is immutable; insert a replacement row');
END;

CREATE TRIGGER media_assets_ready_digest_immutable
BEFORE UPDATE OF sha256 ON media_assets
WHEN OLD.state = 'ready' AND OLD.sha256 <> NEW.sha256
BEGIN
  SELECT RAISE(ABORT, 'ready media content is immutable; insert a replacement row');
END;

CREATE TABLE interaction_events (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  visit_id TEXT REFERENCES visits(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL
    CHECK (
      event_type IN (
        'directions_click',
        'save',
        'share',
        'booking_click',
        'booking_completed',
        'visit_verified',
        'voucher_redeemed',
        'qr_payment'
      )
    ),
  verification_status TEXT NOT NULL
    CHECK (
      verification_status IN (
        'unverified',
        'intent_proxy',
        'platform_verified',
        'venue_verified'
      )
    ),
  dedupe_key TEXT NOT NULL UNIQUE
    CHECK (length(trim(dedupe_key)) > 0),
  occurred_at TEXT NOT NULL
    CHECK (length(trim(occurred_at)) > 0),
  pseudonymous_session_id TEXT,
  referrer TEXT,
  utm_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(utm_json)),
  value_minor INTEGER
    CHECK (value_minor IS NULL OR value_minor >= 0),
  currency TEXT
    CHECK (currency IS NULL OR length(currency) = 3),
  party_size INTEGER
    CHECK (party_size IS NULL OR party_size >= 1),
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_interaction_events_listing_time
  ON interaction_events(listing_id, occurred_at);
CREATE INDEX idx_interaction_events_type_verification
  ON interaction_events(event_type, verification_status, occurred_at);

CREATE TABLE commercial_config_versions (
  id TEXT PRIMARY KEY,
  version_key TEXT NOT NULL UNIQUE
    CHECK (length(trim(version_key)) > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'retired')),
  effective_from TEXT,
  effective_until TEXT,
  config_json TEXT NOT NULL
    CHECK (json_valid(config_json) AND json_type(config_json) = 'object'),
  notes TEXT,
  created_by_principal_id TEXT REFERENCES cms_principals(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    effective_until IS NULL
    OR effective_from IS NULL
    OR effective_until > effective_from
  )
);

CREATE UNIQUE INDEX idx_commercial_config_one_active
  ON commercial_config_versions(status)
  WHERE status = 'active';

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  principal_id TEXT REFERENCES cms_principals(id) ON DELETE RESTRICT,
  action TEXT NOT NULL
    CHECK (length(trim(action)) > 0),
  entity_type TEXT NOT NULL
    CHECK (length(trim(entity_type)) > 0),
  entity_id TEXT NOT NULL
    CHECK (length(trim(entity_id)) > 0),
  before_json TEXT
    CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT
    CHECK (after_json IS NULL OR json_valid(after_json)),
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_audit_logs_entity_time
  ON audit_logs(entity_type, entity_id, created_at);
CREATE INDEX idx_audit_logs_principal_time
  ON audit_logs(principal_id, created_at);

CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit logs are append-only');
END;

CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit logs are append-only');
END;
