/**
 * A files-only server over this checkout's public/ folder, for photographing
 * builder-preview.html where no copy of the app is running (SC-862: the import
 * difference report runs as the build's last step on the import worker).
 *
 * Why not `node server.js`: the worker carries the production credentials, and
 * the full app starts background jobs on boot (the task-timer daemon writes to
 * production every minute). A camera must not do that. This serves files and
 * nothing else; every /api/ request answers 404 in the app's error envelope,
 * so a module that would have fetched data renders empty rather than reaching
 * production. The report's camera already supplies the page and its themes by
 * intercepting those two requests in the browser.
 *
 * Bound to 127.0.0.1 on a free port. Returns { url, close }.
 */
import http from 'node:http';
import path from 'node:path';
import { createReadStream, statSync } from 'node:fs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

/** The file under `publicDir` a request path names, or null (outside it, or missing). */
export function resolvePublicFile(publicDir, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(String(urlPath || '/').split('?')[0]); } catch { return null; }
  const wanted = decoded === '/' ? '/builder-preview.html' : decoded;
  const full = path.resolve(publicDir, `.${wanted}`);
  if (full !== publicDir && !full.startsWith(publicDir + path.sep)) return null;
  for (const candidate of path.extname(full) ? [full] : [full, `${full}.html`]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* next */ }
  }
  return null;
}

export async function startStaticPreviewServer(rootDir) {
  const publicDir = path.resolve(rootDir, 'public');
  const server = http.createServer((req, res) => {
    const urlPath = String(req.url || '/').split('?')[0];
    if (urlPath.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { message: 'files-only preview server: no API here', code: 'NO_API' } }));
      return;
    }
    const file = resolvePublicFile(publicDir, urlPath);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
