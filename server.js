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
  require('dotenv').config();
  console.log('[server] Loaded .env');
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

function serveStatic(req, res) {
  const urlPath  = req.url.split('?')[0];
  const filePath = urlPath === '/' ? '/index.html' : urlPath;
  const fullPath = path.join(__dirname, 'public', filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    return handleRequest(req, res);
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  logRegistry();
});
