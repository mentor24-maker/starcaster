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

async function handleGetKnowledge(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Allow': 'GET', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Method ${req.method} Not Allowed` }));
  }

  try {
    const os = require('os');
    const knowledgeDir = path.join(os.homedir(), '.gemini', 'antigravity', 'knowledge');
    
    if (!fs.existsSync(knowledgeDir)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }

    const items = [];
    const entries = fs.readdirSync(knowledgeDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metadataPath = path.join(knowledgeDir, entry.name, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
          try {
            const raw = fs.readFileSync(metadataPath, 'utf8');
            const data = JSON.parse(raw);
            items.push({
              id: entry.name,
              title: data.title || entry.name.replace(/_/g, ' '),
              summary: data.summary || '',
              timestamp: data.timestamp || '',
              path: path.join(knowledgeDir, entry.name)
            });
          } catch (e) {
            console.error(`[server] Failed to parse KI metadata: ${metadataPath}`, e);
          }
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(items));
  } catch (error) {
    console.error(`[server] Internal error reading knowledge items:`, error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
}

async function handleKnowledgeContent(req, res, urlObj) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, { 'Allow': 'GET, POST', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Method ${req.method} Not Allowed` }));
  }

  try {
    const id = urlObj.searchParams.get('id');
    if (!id || id.includes('..') || id.includes('/')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid or missing id parameter' }));
    }

    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const artifactPath = path.join(os.homedir(), '.gemini', 'antigravity', 'knowledge', id, 'artifacts', 'overview.md');
    
    if (req.method === 'GET') {
      if (!fs.existsSync(artifactPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Artifact not found' }));
      }
      const content = fs.readFileSync(artifactPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ content }));
    } 
    
    if (req.method === 'POST') {
      let bodyData = '';
      for await (const chunk of req) {
        bodyData += chunk;
        if (bodyData.length > 5 * 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Payload Too Large' }));
        }
      }
      const { content } = JSON.parse(bodyData);
      if (typeof content !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing content string' }));
      }
      fs.writeFileSync(artifactPath, content, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

  } catch (error) {
    console.error(`[server] Internal error handling knowledge content:`, error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
}

async function handleFilesystemTree(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Method ${req.method} Not Allowed` }));
  }

  const path = require('path');
  const fs = require('fs');
  const rootDir = __dirname;
  const excludeDirs = ['.git', 'node_modules', 'dist', '.DS_Store'];

  function walk(dir) {
    const stats = fs.statSync(dir);
    const node = {
      name: path.basename(dir) || 'root',
      path: path.relative(rootDir, dir) || '/',
      type: stats.isDirectory() ? 'directory' : 'file'
    };

    if (stats.isDirectory()) {
      node.children = [];
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (excludeDirs.includes(file) || file === 'bundle.js') continue;
        const fullPath = path.join(dir, file);
        node.children.push(walk(fullPath));
      }
      node.children.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      });
    } else {
      node.size = stats.size;
    }
    return node;
  }

  try {
    const tree = walk(rootDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(tree));
  } catch (error) {
    console.error(`[server] Internal error generating file tree:`, error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
}

async function handleFilesystemContent(req, res, urlObj) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Method ${req.method} Not Allowed` }));
  }

  const reqPath = urlObj.searchParams.get('path');
  if (!reqPath) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing path parameter' }));
  }

  const path = require('path');
  const fs = require('fs');
  const rootDir = __dirname;
  
  let relativeReqPath = reqPath;
  if (relativeReqPath.startsWith('/')) {
    relativeReqPath = relativeReqPath.substring(1);
  }
  const targetPath = path.resolve(rootDir, relativeReqPath);

  if (!targetPath.startsWith(rootDir)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Path traversal forbidden' }));
  }

  if (req.method === 'GET') {
    try {
      if (!fs.existsSync(targetPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'File not found' }));
      }
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
         const files = fs.readdirSync(targetPath);
         const content = `[DIRECTORY CONTENTS]\n\n${files.join('\n')}`;
         res.writeHead(200, { 'Content-Type': 'application/json' });
         return res.end(JSON.stringify({ content }));
      }
      const content = fs.readFileSync(targetPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ content }));
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }

  if (req.method === 'POST') {
    try {
      let bodyData = '';
      for await (const chunk of req) {
        bodyData += chunk;
        if (bodyData.length > 5 * 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Payload Too Large' }));
        }
      }
      const { content } = JSON.parse(bodyData);
      if (typeof content !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing content string' }));
      }
      fs.writeFileSync(targetPath, content, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }
}

async function handleFilesystemSummary(req, res, urlObj) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Method ${req.method} Not Allowed` }));
  }

  const reqPath = urlObj.searchParams.get('path');
  if (!reqPath) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing path parameter' }));
  }

  const path = require('path');
  const fs = require('fs');
  const rootDir = __dirname;
  
  let relativeReqPath = reqPath;
  if (relativeReqPath.startsWith('/')) {
    relativeReqPath = relativeReqPath.substring(1);
  }
  const targetPath = path.resolve(rootDir, relativeReqPath);

  if (!targetPath.startsWith(rootDir)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Path traversal forbidden' }));
  }
  
  if (!fs.existsSync(targetPath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'File not found' }));
  }

  const summariesPath = path.join(rootDir, '.file_summaries.json');
  let summaries = {};
  if (fs.existsSync(summariesPath)) {
    try {
      summaries = JSON.parse(fs.readFileSync(summariesPath, 'utf8'));
    } catch (e) {
      console.error(e);
    }
  }

  const relPath = path.relative(rootDir, targetPath);
  if (summaries[relPath]) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ summary: summaries[relPath] }));
  }

  const stat = fs.statSync(targetPath);

  try {
    const { queryOpenAI, queryGemini, queryAnthropic } = require('./lib/rogerClient');
    let systemPrompt, promptBody;
    
    if (stat.isDirectory()) {
      const files = fs.readdirSync(targetPath).filter(f => !f.startsWith('.'));
      const truncatedFiles = files.slice(0, 100).join('\n');
      systemPrompt = "You are an expert software developer. Your task is to briefly describe what this directory is for and how it fits into the overall architecture, based on its path and the files it contains. Keep it 2 to 3 sentences maximum. Return ONLY a valid JSON object matching exactly this structure: { \"summary\": \"your summary here\" }";
      promptBody = `Directory: ${relPath}\nContents:\n${truncatedFiles}`;
    } else {
      const rawContent = fs.readFileSync(targetPath, 'utf8');
      const truncated = rawContent.substring(0, 8000); 
      systemPrompt = "You are an expert software developer. Your task is to briefly describe what this file does in 2 to 3 sentences maximum based on its content. Return ONLY a valid JSON object matching exactly this structure: { \"summary\": \"your summary here\" }";
      promptBody = `File: ${relPath}\n\n${truncated}`;
    }
    
    // We will try OpenAI first as it natively guarantees JSON object output format easily
    const result = await queryOpenAI(systemPrompt, promptBody);
    
    let summaryText = "Could not generate summary.";
    if (result.ok && result.text) {
      try {
        const parsed = JSON.parse(result.text);
        if (parsed.summary) summaryText = parsed.summary;
      } catch(e) {
        summaryText = result.text.substring(0, 300) + '...';
      }
    }
    
    summaries[relPath] = summaryText;
    fs.writeFileSync(summariesPath, JSON.stringify(summaries, null, 2), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ summary: summaryText }));

  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Failed to generate summary' }));
  }
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (urlObj.pathname === '/api/agent/report') {
    return await handleAgentReport(req, res);
  }
  if (urlObj.pathname === '/api/campaigns/active') {
    return await handleGetActiveCampaigns(req, res);
  }
  if (urlObj.pathname === '/api/system/knowledge/content') {
    return await handleKnowledgeContent(req, res, urlObj);
  }
  if (urlObj.pathname === '/api/system/knowledge') {
    return await handleGetKnowledge(req, res);
  }
  if (urlObj.pathname === '/api/system/filesystem/tree') {
    return await handleFilesystemTree(req, res);
  }
  if (urlObj.pathname === '/api/system/filesystem/content') {
    return await handleFilesystemContent(req, res, urlObj);
  }
  if (urlObj.pathname === '/api/system/filesystem/summary') {
    return await handleFilesystemSummary(req, res, urlObj);
  }

  if (req.url.startsWith('/api/')) {
    return handleRequest(req, res);
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  logRegistry();
  initTimerDaemon();
});
