'use strict';

/**
 * Where an asset came from — the surface it was uploaded through, not who
 * uploaded it (that is assets.owner_user_id).
 *
 * The value is declared by the client and validated here rather than stamped
 * from the endpoint, because the two upload endpoints the Assets screen uses
 * (/api/assets/import-image and /api/assets/upload-google-drive) are shared
 * with the Builder and the asset picker. Stamping by endpoint would label a
 * Builder upload as a Media Manager one.
 *
 * An unrecognised value normalizes to '' rather than being stored as-is: this
 * column exists to be filtered on, and one typo'd variant makes a filter quietly
 * incomplete. '' means "origin not recorded", which is what every row written
 * before this column existed says, and is the honest answer.
 */

const ASSET_SOURCE_ADMIN_MEDIA_MANAGER = 'admin-media-manager';

const ASSET_SOURCES = new Set([
  ASSET_SOURCE_ADMIN_MEDIA_MANAGER,
]);

function normalizeAssetSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return ASSET_SOURCES.has(source) ? source : '';
}

function isKnownAssetSource(value) {
  return ASSET_SOURCES.has(String(value || '').trim().toLowerCase());
}

module.exports = {
  ASSET_SOURCE_ADMIN_MEDIA_MANAGER,
  ASSET_SOURCES,
  normalizeAssetSource,
  isKnownAssetSource,
};
