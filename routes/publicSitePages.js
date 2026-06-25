'use strict';

/**
 * HTML page routing: StarCaster admin shell vs tenant public Builder sites.
 *
 * Invoked early from routes/index.js for non-API browser paths and for
 * internal rewrites (/api/index, /api/{slug}) from middleware.mjs.
 *
 * See docs/CUSTOM_DOMAIN_PUBLIC_SITES.md
 */

const fs = require('fs');
const path = require('path');
const {
  normalizeApiPathname,
  getClientHost,
  getPublicSiteDomainParam,
  getPublicSiteDomainFromPath,
} = require('./http');
const { isSystemHost } = require('../lib/publicSiteHosts');
const { buildFaviconHeadTags, faviconVersionKey, writeProjectFaviconResponse } = require('../lib/projectFavicon');

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

function createPublicSitePageHandlers({ isRegisteredApiPath }) {
  function isPageRequestPath(pathname, req) {
    const p = normalizeApiPathname(pathname);
    if (p === '/api') return true;
    if (p === '/api/app-shell.html') return true;
    if (p === '/api/_site' || p.startsWith('/api/_site/')) return true;
    if (!p.startsWith('/api/')) return true;
    if (!isRegisteredApiPath(p)) {
      const host = getClientHost(req);
      if (host && !isSystemHost(host)) return true;
    }
    return false;
  }

  function pagePathnameForRequest(pathname) {
    const p = normalizeApiPathname(pathname);
    if (p === '/api' || p === '/api/index') return '/';
    if (p === '/api/app-shell.html') return '/app-shell.html';
    if (p === '/api/_site') return '/_site';
    if (p.startsWith('/api/_site/')) return p.slice(4);
    if (p.startsWith('/api/') && !isRegisteredApiPath(p)) {
      return p.slice(4) || '/';
    }
    return p;
  }

  function isBootstrapPath(pathname) {
    const p = normalizeApiPathname(pathname || '');
    return p === '/_site' || p === '/api/_site'
      || p.startsWith('/_site/') || p.startsWith('/api/_site/');
  }

  async function resolvePublicSiteProject(req, pathname) {
    const { findProjectByDomain } = require('../lib/projectsStore');
    const pathDomain = getPublicSiteDomainFromPath(pathname || '');
    const domainParam = getPublicSiteDomainParam(req);
    const host = getClientHost(req);
    const candidates = [];
    if (pathDomain) candidates.push(pathDomain);
    if (domainParam) candidates.push(domainParam);
    if (host && !isSystemHost(host)) candidates.push(host);
    const seen = new Set();
    for (const domain of candidates) {
      const key = String(domain || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const result = await findProjectByDomain(key);
      if (result.ok) return result;
    }
    return { ok: false };
  }

  function servePublicSiteHtml(res, project) {
    let siteHtml;
    try {
      siteHtml = fs.readFileSync(path.join(__dirname, '../public/site.html'), 'utf8');
    } catch {
      res.statusCode = 500;
      res.end('Site template unavailable');
      return true;
    }
    const projectId = String(project?.id || '').trim();
    const projectName = String(project?.name || '').trim();
    const config = JSON.stringify({
      projectId,
      projectName,
      faviconVersion: faviconVersionKey(project),
    });
    const faviconTags = buildFaviconHeadTags(project);
    siteHtml = siteHtml.replace(
      '</head>',
      `  ${faviconTags}\n  <script>window.__SITE_CONFIG__ = ${config};</script>\n</head>`
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.statusCode = 200;
    res.end(siteHtml);
    return true;
  }

  function serveStaticPage(res, pathname) {
    const safePath = pathname.replace(/\.\./g, '').replace(/\/+/g, '/') || '/';
    if (isBootstrapPath(safePath)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Public site bootstrap path unavailable');
      return;
    }
    if (safePath === '/app-shell.html') {
      const filePath = path.join(__dirname, '../public/app-shell.html');
      try {
        const content = fs.readFileSync(filePath);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.statusCode = 200;
        return res.end(content);
      } catch {
        res.statusCode = 404;
        return res.end('Not found');
      }
    }
    let filePath;
    if (safePath === '/') {
      filePath = path.join(__dirname, '../public/app-shell.html');
    } else {
      const rel = safePath.replace(/^\//, '');
      filePath = path.join(__dirname, '../public', rel);
      if (!path.extname(safePath) && !fs.existsSync(filePath)) {
        filePath += '.html';
      }
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(__dirname, '../public/app-shell.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    try {
      const content = fs.readFileSync(filePath);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.statusCode = 200;
      return res.end(content);
    } catch {
      res.statusCode = 404;
      return res.end('Not found');
    }
  }

  async function handlePageRequest(req, res, pathname) {
    const safePath = String(pathname || '/').replace(/\.\./g, '').replace(/\/+/g, '/') || '/';
    const isFaviconRequest = safePath === '/favicon.ico';

    if (isBootstrapPath(pathname)) {
      const result = await resolvePublicSiteProject(req, pathname);
      if (result.ok) {
        res.setHeader('X-Site-Handler', 'bootstrap-resolved');
        if (isFaviconRequest) {
          await writeProjectFaviconResponse(res, result.data, {
            cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
          });
          return;
        }
        servePublicSiteHtml(res, result.data);
        return;
      }
      res.setHeader('X-Site-Handler', 'bootstrap-miss');
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Public site not found for this domain');
      return;
    }

    const result = await resolvePublicSiteProject(req, pathname);
    if (result.ok) {
      res.setHeader('X-Site-Handler', isFaviconRequest ? 'favicon-resolved' : 'resolved');
      if (isFaviconRequest) {
        await writeProjectFaviconResponse(res, result.data, {
          cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
        });
        return;
      }
      servePublicSiteHtml(res, result.data);
      return;
    }

    const host = getClientHost(req);
    if (host && !isSystemHost(host)) {
      res.setHeader('X-Site-Handler', 'domain-miss');
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('No published site for this domain');
      return;
    }

    res.setHeader('X-Site-Handler', 'app-shell');
    serveStaticPage(res, pathname);
  }

  return {
    handlePageRequest,
    isPageRequestPath,
    pagePathnameForRequest,
  };
}

module.exports = { createPublicSitePageHandlers };
