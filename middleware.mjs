/**
 * Vercel Edge Middleware — custom-domain public sites.
 *
 * Vercel can serve public/index.html for "/" before the catch-all API route runs.
 * Redirect custom-domain HTML requests to /api/_site/{hostname} so the serverless
 * handler can return site.html instead of the StarCaster admin shell.
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

function hasFileExtension(pathname) {
  return /\.[a-z0-9]+$/i.test(pathname);
}

export default function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname || '/';

  if (pathname.startsWith('/api/')) return;
  if (hasFileExtension(pathname)) return;

  const host = normalizeHost(
    request.headers.get('x-forwarded-host') || request.headers.get('host')
  );
  if (!host || SYSTEM_HOST_RE.test(host)) return;
  if (isBootstrapPath(pathname)) return;

  const dest = new URL(request.url);
  dest.pathname = `/api/_site/${encodeURIComponent(host)}`;
  dest.search = `?path=${encodeURIComponent(pathname + url.search)}`;

  return Response.redirect(dest.toString(), 302);
}

export const config = {
  matcher: [
    '/((?!api/|images/|favicon.ico|.*\\..*).*)',
  ],
};
