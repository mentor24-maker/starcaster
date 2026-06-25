'use strict';

/**
 * Server-side filters for GET /api/public/pages vs GET /api/public/admin-pages.
 * Slug rules live in lib/builder-client/public-site-page-slugs.js (shared with client bundle).
 */

const slugRules = require('./builder-client/public-site-page-slugs');

const {
  PRIVATE_SITE_SLUGS_EXACT,
  PUBLIC_SITE_SLUG_OVERRIDES,
  isPrivateSiteSlug,
  isPublicSiteSlug,
  filterPublicSitePages,
  filterPrivateSitePages,
} = slugRules;

/** @deprecated Use isPrivateSiteSlug */
const isRestrictedAdminSiteSlug = isPrivateSiteSlug;

/** @deprecated Use isPrivateSiteSlug */
const isExcludedFromPublicSitePage = isPrivateSiteSlug;

/** @deprecated Use filterPrivateSitePages */
const filterRestrictedAdminSitePages = filterPrivateSitePages;

/** @deprecated Use PRIVATE_SITE_SLUGS_EXACT */
const EXACT_EXCLUDED_SLUGS = PRIVATE_SITE_SLUGS_EXACT;

/** @deprecated Use PUBLIC_SITE_SLUG_OVERRIDES */
const PUBLIC_ADMIN_SITE_SLUGS = PUBLIC_SITE_SLUG_OVERRIDES;

module.exports = {
  PRIVATE_SITE_SLUGS_EXACT,
  PUBLIC_SITE_SLUG_OVERRIDES,
  EXACT_EXCLUDED_SLUGS,
  PUBLIC_ADMIN_SITE_SLUGS,
  isPrivateSiteSlug,
  isPublicSiteSlug,
  isRestrictedAdminSiteSlug,
  isExcludedFromPublicSitePage,
  filterPublicSitePages,
  filterPrivateSitePages,
  filterRestrictedAdminSitePages,
};
