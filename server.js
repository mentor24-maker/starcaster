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
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

async function handleAgentReport(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Allow': 'POST', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Method ${req.method} Not Allowed` }));
  }

  try {
    let bodyData = '';
    for await (const chunk of req) {
      bodyData += chunk;
      if (bodyData.length > 10 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Payload Too Large' }));
      }
    }

    const { filePath, content } = JSON.parse(bodyData);

    if (!filePath || typeof content !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing required parameters: filePath or content' }));
    }

    console.log(`[IPC Engine] Received IPC structural report for: ${filePath}`);
    console.log(`[IPC Engine] Payload size: ${content.length} characters`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'Report received successfully.' }));

  } catch (error) {
    console.error(`[IPC Engine] Internal server error handling IPC report:`, error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
}

async function handleGetActiveCampaigns(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Allow': 'GET', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Method ${req.method} Not Allowed` }));
  }

  const mockCampaigns = [
    {
      id: 101,
      name: "Q4 Holiday Promo",
      description: "Standard end-of-year discount push targeting returning customers."
    },
    {
      id: 102,
      name: "Spring Reactivation",
      description: "Emails targeted to users who have been inactive for over 90 days."
    }
  ];

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(mockCampaigns));
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (urlObj.pathname === '/api/agent/report') {
    return await handleAgentReport(req, res);
  }
  if (urlObj.pathname === '/api/campaigns/active') {
    return await handleGetActiveCampaigns(req, res);
  }

  if (req.url.startsWith('/api/')) {
    return handleRequest(req, res);
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  logRegistry();
});
