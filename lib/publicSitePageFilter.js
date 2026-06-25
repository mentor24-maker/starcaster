'use strict';

/**
 * Slugs excluded from GET /api/public/pages (admin/editor surfaces).
 * Align with client-side module filters in BuilderPublicSitePage where possible.
 */

const EXACT_EXCLUDED_SLUGS = new Set([
  'blog-post-edit',
  'blog-create-post',
  'blog-post-manager',
  'blog-category-manager',
  'crm',
]);

function isExcludedFromPublicSitePage(slugInput) {
  const slug = String(slugInput ?? '').trim().toLowerCase();
  if (!slug) return false;
  if (slug === 'home') return false;
  if (slug.startsWith('admin-') || slug === 'admin') return true;
  if (EXACT_EXCLUDED_SLUGS.has(slug)) return true;
  return false;
}

function filterPublicSitePages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.filter((page) => !isExcludedFromPublicSitePage(page?.slug));
}

module.exports = {
  isExcludedFromPublicSitePage,
  filterPublicSitePages,
  EXACT_EXCLUDED_SLUGS,
};
