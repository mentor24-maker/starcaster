/**
 * Vercel Edge Middleware — canonical URLs for custom-domain public sites.
 *
 * Legacy bootstrap URLs (/api/_site/{domain}?path=...) redirect to the clean path.
 * Page HTML is served at the pretty URL via vercel.json routing to /api.
 */

const SYSTEM_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|.*\.vercel\.app|starcaster\.pro|.*\.starcaster\.pro)$/;

function normalizeHost(value) {
  const text = String(value || '').split(',')[0].trim();
  if (!text) return '';
  return text.split(':')[0].toLowerCase().replace(/^www\./, '');
}

function isBootstrapPath(pathname) {
  return pathname === '/_site'
    || pathname === '/api/_site'
    || pathname.startsWith('/_site/')
    || pathname.startsWith('/api/_site/');
}

export default function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname || '/';

  if (!isBootstrapPath(pathname)) return;

  const host = normalizeHost(
    request.headers.get('x-forwarded-host') || request.headers.get('host')
  );
  if (!host || SYSTEM_HOST_RE.test(host)) return;

  const restorePath = String(url.searchParams.get('path') || '/').trim() || '/';
  const dest = new URL(restorePath.startsWith('/') ? restorePath : `/${restorePath}`, url.origin);
  dest.search = '';
  return Response.redirect(dest.toString(), 301);
}

export const config = {
  matcher: [
    '/api/_site/:path*',
    '/_site/:path*',
  ],
};
