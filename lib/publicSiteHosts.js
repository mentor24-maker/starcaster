'use strict';

/**
 * Host classification for custom-domain public Builder sites.
 *
 * Canonical list used by Node handlers (routes, server.js).
 * Edge middleware (middleware.mjs) duplicates SYSTEM_HOST_RE — keep in sync.
 *
 * See docs/CUSTOM_DOMAIN_PUBLIC_SITES.md
 */

/** Hosts that receive the StarCaster admin app, not a tenant public site.
 *  The admin app lives at app.starcaster.pro (since 2026-10-11, task
 *  86bcgjq5k). Every OTHER starcaster.pro host — the apex itself included —
 *  resolves like a custom domain: starcaster.pro serves the company's own
 *  site, built in the Builder under the "Starcaster" project, and
 *  delraytennis.starcaster.pro serves whichever project's Domain field says
 *  so. Before that date the apex WAS the admin host, which is why the
 *  company home page could not appear at its own address.
 *  A host still needs BOTH a Vercel domain entry and a matching project
 *  Domain value before it serves anything. */
const SYSTEM_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|.*\.vercel\.app|app\.starcaster\.pro)$/;

/** The company's own apex. It is a tenant host like any other (the
 *  "Starcaster" project's published pages), with one exception: the legal
 *  pages registered with Meta and TikTok app review keep their addresses
 *  here — see PLATFORM_PAGE_PATHS and routes/publicSitePages.js. */
const PLATFORM_HOST = 'starcaster.pro';

/** Paths that serve the platform's own static page on PLATFORM_HOST even
 *  though that host is a tenant site. These addresses are registered with
 *  third parties (Meta app review names the privacy policy and data-deletion
 *  URLs), so a tenant page — or a blank render where none exists — must never
 *  shadow them. Admin hosts serve them as ordinary static pages already. */
const PLATFORM_PAGE_PATHS = Object.freeze([
  '/privacy-policy',
  '/terms-of-service',
  '/data-deletion',
]);

function isPlatformPagePath(host, pathname) {
  if (normalizePublicSiteHost(host) !== PLATFORM_HOST) return false;
  const p = String(pathname || '').toLowerCase().replace(/\/+$/, '').replace(/\.html$/, '');
  return PLATFORM_PAGE_PATHS.includes(p);
}

function normalizePublicSiteHost(value) {
  const text = String(value || '').split(',')[0].trim();
  if (!text) return '';
  return text.split(':')[0].toLowerCase().replace(/^www\./, '');
}

function isSystemHost(host) {
  const normalized = normalizePublicSiteHost(host);
  if (!normalized) return true;
  return SYSTEM_HOST_RE.test(normalized);
}

module.exports = {
  SYSTEM_HOST_RE,
  PLATFORM_HOST,
  PLATFORM_PAGE_PATHS,
  normalizePublicSiteHost,
  isSystemHost,
  isPlatformPagePath,
};
