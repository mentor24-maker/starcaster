/**
 * Vercel Edge Middleware — custom-domain public sites with clean URLs.
 *
 * Rewrites pretty paths (/, /tractornav, …) to the serverless /api handler
 * while keeping the browser URL unchanged. Legacy bootstrap URLs 301 to /path.
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

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname || '/';

  if (pathname.startsWith('/api/')) return;
  if (hasFileExtension(pathname)) return;

  const host = normalizeHost(
    request.headers.get('x-forwarded-host') || request.headers.get('host')
  );
  if (!host || SYSTEM_HOST_RE.test(host)) return;

  if (isBootstrapPath(pathname)) {
    const restorePath = String(url.searchParams.get('path') || '/').trim() || '/';
    const dest = new URL(restorePath.startsWith('/') ? restorePath : `/${restorePath}`, url.origin);
    dest.search = '';
    return Response.redirect(dest.toString(), 301);
  }

  const invokeUrl = new URL(request.url);
  invokeUrl.pathname = pathname === '/' ? '/api' : `/api${pathname}`;

  return fetch(invokeUrl.toString(), {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
  });
}

export const config = {
  matcher: [
    '/((?!api/|images/|favicon.ico|.*\\..*).*)',
  ],
};
