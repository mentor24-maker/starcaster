'use strict';

/**
 * Slugs excluded from GET /api/public/pages (admin/editor surfaces).
 * Align with client-side module filters in BuilderPublicSitePage where possible.
 *
 * admin-login is intentionally public; other admin-* slugs require an admin
 * session via GET /api/public/admin-pages.
 */

const EXACT_EXCLUDED_SLUGS = new Set([
  'blog-post-edit',
  'blog-create-post',
  'blog-post-manager',
  'blog-category-manager',
  'crm',
]);

/** Admin site slugs served without authentication. */
const PUBLIC_ADMIN_SITE_SLUGS = new Set([
  'admin-login',
]);

function isRestrictedAdminSiteSlug(slugInput) {
  const slug = String(slugInput ?? '').trim().toLowerCase();
  if (!slug) return false;
  if (PUBLIC_ADMIN_SITE_SLUGS.has(slug)) return false;
  if (slug === 'admin' || slug.startsWith('admin-')) return true;
  return false;
}

function isExcludedFromPublicSitePage(slugInput) {
  const slug = String(slugInput ?? '').trim().toLowerCase();
  if (!slug) return false;
  if (slug === 'home') return false;
  if (PUBLIC_ADMIN_SITE_SLUGS.has(slug)) return false;
  if (slug.startsWith('admin-') || slug === 'admin') return true;
  if (EXACT_EXCLUDED_SLUGS.has(slug)) return true;
  return false;
}

function filterPublicSitePages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.filter((page) => !isExcludedFromPublicSitePage(page?.slug));
}

function filterRestrictedAdminSitePages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.filter((page) => isRestrictedAdminSiteSlug(page?.slug));
}

module.exports = {
  isRestrictedAdminSiteSlug,
  isExcludedFromPublicSitePage,
  filterPublicSitePages,
  filterRestrictedAdminSitePages,
  EXACT_EXCLUDED_SLUGS,
  PUBLIC_ADMIN_SITE_SLUGS,
};
