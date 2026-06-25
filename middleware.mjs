/**
 * Vercel Edge Middleware — custom-domain public Builder sites at clean URLs.
 *
 * Rewrites browser paths internally to serverless handlers; the address bar
 * stays at / or /{slug}. Must use .mjs (ESM) — see docs/CUSTOM_DOMAIN_PUBLIC_SITES.md.
 *
 * SYSTEM_HOST_RE must stay in sync with lib/publicSiteHosts.js
 */

import { rewrite } from '@vercel/functions';

const SYSTEM_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|.*\.vercel\.app|starcaster\.pro|.*\.starcaster\.pro)$/;

function normalizeHost(value) {
  const text = String(value || '').split(',')[0].trim();
  if (!text) return '';
  return text.split(':')[0].toLowerCase().replace(/^www\./, '');
}

function hasFileExtension(pathname) {
  return /\.[a-z0-9]+$/i.test(pathname);
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname || '/';

  if (pathname.startsWith('/api/')) return;
  if (hasFileExtension(pathname)) return;

  const host = normalizeHost(
    request.headers.get('x-forwarded-host') || request.headers.get('host')
  );
  if (!host || SYSTEM_HOST_RE.test(host)) return;

  const target = new URL(request.url);
  target.pathname = pathname === '/' ? '/api/index' : `/api${pathname}`;

  return rewrite(target);
}

export const config = {
  matcher: [
    '/',
    '/((?!api/|images/|favicon.ico|.*\\..*).+)',
  ],
};
