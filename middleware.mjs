/**
 * Vercel Edge Middleware — custom-domain public sites at clean URLs.
 *
 * Browser URL stays / or /tractornav; internally we fetch the bootstrap
 * route that returns site.html (the bare / path still serves app-shell on Vercel).
 */

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

  const invokeUrl = new URL(request.url);
  invokeUrl.pathname = `/api/_site/${encodeURIComponent(host)}`;
  invokeUrl.search = `?path=${encodeURIComponent(pathname + url.search)}`;

  return fetch(invokeUrl.toString(), {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
  });
}

export const config = {
  matcher: [
    '/',
    '/((?!api/|images/|favicon.ico|.*\\..*).+)',
  ],
};
