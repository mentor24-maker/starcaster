'use strict';

/**
 * Where a tag came from — which side of the platform created it, not who
 * created it (that is messaging_tags.owner_user_id).
 *
 * Starcaster had two tag registries until 2026-09-04: messaging_tags, written
 * by the Starcaster back-end, and asset_tags, written by the Media Manager
 * module that runs inside a client's OWN admin back-end. Dane asked for one
 * table with the origin recorded on the row, which is what this vocabulary is.
 *
 * Client-declared and validated here rather than stamped from the endpoint,
 * for the same reason lib/assetSource.js is: /api/asset-tags is reachable from
 * both the Starcaster admin app and a tenant's admin-media-manager module
 * (lib/projectAdminApiAuth.js lets it through deliberately), so stamping by
 * endpoint would label one as the other.
 *
 * An unrecognised value normalizes to '' rather than being stored as-is: this
 * column exists to be filtered on, and one typo'd variant makes a filter
 * quietly incomplete. '' means "origin not recorded", which is what all 149
 * rows written before the column existed say, and is the honest answer.
 *
 * Note the deliberate difference from assets.source, whose value is
 * 'admin-media-manager'. That column records which upload SURFACE a file came
 * through. This one records which side of the platform created the tag, which
 * is the question Dane asked ("flagged as having come from the Client Admin")
 * and which stays true if a second client-admin module ever writes tags.
 */

const MESSAGING_TAG_SOURCE_CLIENT_ADMIN = 'client-admin';

const MESSAGING_TAG_SOURCES = new Set([
  MESSAGING_TAG_SOURCE_CLIENT_ADMIN,
]);

function normalizeMessagingTagSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return MESSAGING_TAG_SOURCES.has(source) ? source : '';
}

function isKnownMessagingTagSource(value) {
  return MESSAGING_TAG_SOURCES.has(String(value || '').trim().toLowerCase());
}

module.exports = {
  MESSAGING_TAG_SOURCE_CLIENT_ADMIN,
  MESSAGING_TAG_SOURCES,
  normalizeMessagingTagSource,
  isKnownMessagingTagSource,
};
