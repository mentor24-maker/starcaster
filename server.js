'use strict';

/**
 * server.js  —  Local development HTTP server.
 *
 * Changes for #7 (Formal Environment Configuration):
 *   - Loads .env via dotenv at the very top, before any other require()
 *   - Calls config.validateAtStartup() to warn about missing required vars
 *   - Everything else is unchanged
 *
 * For production (Vercel): environment variables are set in the Vercel dashboard
 * or via `vercel env add`.  This file is NOT used in production.
 */

// ── Load .env FIRST — must be before any lib that reads process.env ─────────
// dotenv is a dev dependency; it's a no-op if the package is absent (Vercel).
try {
  const dotenv = require('dotenv');
  dotenv.config();                          // .env (legacy)
  dotenv.config({ path: '.env.local', override: false }); // .env.local (Vercel CLI default)
  console.log('[server] Loaded env files');
} catch (_) {
  // dotenv not installed — fine for production/Vercel
}

// ── Validate required config early ──────────────────────────────────────────
const config = require('./lib/config');
config.validateAtStartup();

// ── Rest of server setup (unchanged) ────────────────────────────────────────
const http = require('http');
const path = require('path');
const fs   = require('fs');
const { handleRequest, logRegistry } = require('./routes/index');
const { sendErr } = require('./routes/http');
const { initTimerDaemon } = require('./lib/taskTimerDaemon');

const PORT = Number(config.get('port')) || 3000;

// ---------------------------------------------------------------------------
// Static file serving for public/
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

function sendStaticFile(res, fullPath) {
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    });
    res.end(data);
  });
}

function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const filePath = urlPath === '/' ? '/app-shell.html' : urlPath;
  const fullPath = path.join(__dirname, 'public', filePath);

  if (!path.extname(filePath)) {
    const htmlPath = `${fullPath}.html`;
    fs.stat(htmlPath, (statErr) => {
      if (!statErr) return sendStaticFile(res, htmlPath);
      return sendStaticFile(res, fullPath);
    });
    return;
  }

  // When a /{slug}.html is requested and no static file exists, serve the builder
  // preview page so nav links (which add .html) resolve to a live page preview.
  if (filePath.endsWith('.html') && !filePath.startsWith('/builder-') && !filePath.startsWith('/app-shell')) {
    fs.stat(fullPath, (statErr) => {
      if (!statErr) return sendStaticFile(res, fullPath);
      sendStaticFile(res, path.join(__dirname, 'public', 'builder-preview.html'));
    });
    return;
  }

  sendStaticFile(res, fullPath);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    try {
      await handleRequest(req, res);
    } catch (err) {
      console.error('[server] API request failed:', err);
      if (!res.headersSent) {
        sendErr(res, 500, err?.message || 'Internal server error', { code: 'INTERNAL_ERROR' });
      }
    }
    return;
  }

  try {
    const { getClientHost, normalizeApiPathname } = require('./routes/http');
    const { isSystemHost } = require('./lib/publicSiteHosts');
    const pageUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pagePath = normalizeApiPathname(pageUrl.pathname);
    const host = getClientHost(req);
    if (!isSystemHost(host) && !/\.[a-z0-9]+$/i.test(pagePath)) {
      await handleRequest(req, res);
      return;
    }
  } catch (err) {
    console.error('[server] Public site page request failed:', err);
    if (!res.headersSent) {
      sendErr(res, 500, err?.message || 'Internal server error', { code: 'INTERNAL_ERROR' });
      return;
    }
  }

  serveStatic(req, res);
});

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
});

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  logRegistry();
  try {
    const assetsRoutes = require('./routes/assets');
    console.log(`[server] ${assetsRoutes.IMPORT_DRIVE_FOLDER_PATH} registered (GET health, POST import)`);
    console.log(`[server] ${assetsRoutes.IMPORT_FROM_FIELDS_PATH} registered (GET meta, POST import)`);
  } catch (err) {
    console.warn('[server] Assets routes failed to load:', err.message);
  }
  try {
    require('./lib/devTeamStore');
    console.log('[server] devAgent team + roles + team invite routes registered (project-scoped)');
  } catch (err) {
    console.warn('[server] Dev team routes failed to load:', err.message);
  }
  initTimerDaemon();
});
