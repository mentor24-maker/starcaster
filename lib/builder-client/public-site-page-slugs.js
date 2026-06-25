'use strict';

/**
 * Public vs private site page slugs for custom-domain Builder sites.
 *
 * Private pages require project-admin login (GET /api/public/admin-pages).
 * Public pages are listed via GET /api/public/pages.
 *
 * Finer-grained RBAC may split this later; for now "admin" ≈ private.
 */

/** Editor / CRM slugs that are private but do not use the admin-* prefix. */
const PRIVATE_SITE_SLUGS_EXACT = new Set([
  'blog-post-edit',
  'blog-create-post',
  'blog-post-manager',
  'blog-category-manager',
  'crm',
]);

/** Private-pattern slugs that remain publicly reachable (e.g. sign-in). */
const PUBLIC_SITE_SLUG_OVERRIDES = new Set([
  'admin-login',
]);

function normalizeSiteSlug(slugInput) {
  return String(slugInput ?? '').trim().toLowerCase();
}

function isPrivateSiteSlug(slugInput) {
  const slug = normalizeSiteSlug(slugInput);
  if (!slug || slug === 'home') return false;
  if (PUBLIC_SITE_SLUG_OVERRIDES.has(slug)) return false;
  if (PRIVATE_SITE_SLUGS_EXACT.has(slug)) return true;
  if (slug === 'admin' || slug.startsWith('admin-')) return true;
  return false;
}

function isPublicSiteSlug(slugInput) {
  return !isPrivateSiteSlug(slugInput);
}

function filterPublicSitePages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.filter((page) => isPublicSiteSlug(page?.slug));
}

function filterPrivateSitePages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.filter((page) => isPrivateSiteSlug(page?.slug));
}

module.exports = {
  PRIVATE_SITE_SLUGS_EXACT,
  PUBLIC_SITE_SLUG_OVERRIDES,
  normalizeSiteSlug,
  isPrivateSiteSlug,
  isPublicSiteSlug,
  filterPublicSitePages,
  filterPrivateSitePages,
};
