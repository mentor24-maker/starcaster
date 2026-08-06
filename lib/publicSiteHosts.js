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
 *  Only the apex serves the app (www. is stripped by normalization) —
 *  every OTHER starcaster.pro subdomain resolves like a custom domain,
 *  which is what makes per-client staging hosts possible
 *  (delraytennis.starcaster.pro → the project whose Domain field says so).
 *  A subdomain still needs BOTH a Vercel domain entry and a matching
 *  project Domain value before it serves anything. */
const SYSTEM_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|.*\.vercel\.app|starcaster\.pro)$/;

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
  normalizePublicSiteHost,
  isSystemHost,
};
