'use strict';

/**
 * Studio API — what the Footage screen reads (Studio Phase 1 · 8 of 8).
 *
 *   GET /api/studio/footage                    every file, grouped by session
 *       ?lane=iphone&from=<ISO>&to=<ISO>       filters (all optional)
 *   GET /api/studio/sources/:id/thumbnail      the file's picture, from Drive
 *
 * Read-only. The pipeline writes the catalog from the Mac Mini
 * (workers/studio/); nothing here changes a row.
 *
 * WHERE THE PICTURES COME FROM. Nothing in the pipeline makes a thumbnail of
 * its own — the proxies it renders live on the Mini's disk, which a serverless
 * function cannot read. Every file it ingests came off Google Drive, though,
 * and Drive draws a preview frame for a video it has processed. So the
 * thumbnail is Drive's, fetched with the server's own Drive credential and
 * passed through; the browser never sees a token. A file Drive has not drawn
 * a preview for yet answers 404 and the screen shows its placeholder.
 *
 * Auth and project scope are decided centrally in routes/index.js.
 */

const { sendOk, sendErr, getUrlObj } = require('./http');
const { listSessions } = require('../lib/videoSessionsStore');
const { listSources, getSourceById } = require('../lib/videoSourcesStore');
const { buildFootage, readFilters } = require('../lib/studioFootage');
const googleDrive = require('../lib/googleDrive');
const { checkEndpointLimit } = require('../lib/rateLimiter');

/** The most rows one read takes. resolveLimit's own ceiling. */
const READ_LIMIT = 1000;

/** How long the browser keeps a thumbnail. Drive's preview of a finished
 *  video does not change, and every one re-fetched is a request against the
 *  global rate limit. */
const THUMBNAIL_CACHE_SECONDS = 24 * 60 * 60;

/** An access token is good for an hour; re-mint well inside that. */
const TOKEN_REUSE_MS = 40 * 60 * 1000;

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId:    String(req?.authUser?.id || '').trim(),
  };
}

/**
 * Reused across thumbnail requests in one warm process. Without it, a screen
 * of forty pictures is forty OAuth refreshes against Google before a single
 * image is fetched.
 */
let cachedToken = { value: '', at: 0 };

async function driveToken() {
  if (cachedToken.value && Date.now() - cachedToken.at < TOKEN_REUSE_MS) {
    return { ok: true, token: cachedToken.value };
  }
  const res = await googleDrive.getAccessToken();
  if (!res.ok) return res;
  cachedToken = { value: res.data.accessToken, at: Date.now() };
  return { ok: true, token: cachedToken.value };
}

function forgetToken() {
  cachedToken = { value: '', at: 0 };
}

async function sendFootage(req, res, urlObj) {
  const params = urlObj.searchParams;
  const read = readFilters({
    lane: params.get('lane'),
    from: params.get('from'),
    to: params.get('to'),
  });
  if (!read.ok) return sendErr(res, 400, read.error, { code: 'VALIDATION_ERROR' });

  const scope = requestScope(req);
  const [sessions, sources] = await Promise.all([
    listSessions(READ_LIMIT, scope),
    listSources(READ_LIMIT, scope),
  ]);
  // A failed read is an error, never an empty catalog: "you have no footage"
  // and "the database did not answer" must not be the same screen.
  if (!sessions.ok) return sendErr(res, sessions.status || 500, `Could not read the sessions: ${sessions.error}`);
  if (!sources.ok) return sendErr(res, sources.status || 500, `Could not read the files: ${sources.error}`);

  const view = buildFootage({ sessions: sessions.data, sources: sources.data, filters: read.filters });
  // At the ceiling there may be more rows than were read, so the counts are a
  // floor and the screen has to say so.
  const truncated = sources.data.length >= READ_LIMIT || sessions.data.length >= READ_LIMIT;
  return sendOk(res, 200, { ...view, truncated, readLimit: READ_LIMIT });
}

async function sendThumbnail(req, res, sourceId) {
  const found = await getSourceById(sourceId, requestScope(req));
  if (!found.ok) {
    const status = found.status === 404 ? 404 : (found.status || 500);
    return sendErr(res, status, found.error || 'Source not found', { code: status === 404 ? 'NOT_FOUND' : undefined });
  }
  const driveFileId = String(found.data.driveFileId || '').trim();
  if (!driveFileId) {
    return sendErr(res, 404, 'This file did not come from Drive, so there is no preview for it.', { code: 'NO_THUMBNAIL' });
  }

  const token = await driveToken();
  if (!token.ok) {
    return sendErr(res, 503, `Drive is not reachable for previews: ${token.error}`, { code: 'DRIVE_UNAVAILABLE' });
  }

  const meta = await googleDriveMeta(token.token, driveFileId);
  if (!meta.ok) {
    if (meta.status === 401) forgetToken();
    const status = meta.status === 404 ? 404 : 502;
    return sendErr(res, status, `Drive would not describe this file: ${meta.error}`, { code: 'NO_THUMBNAIL' });
  }
  const link = String(meta.data?.thumbnailLink || '').trim();
  if (!meta.data?.hasThumbnail || !link) {
    return sendErr(res, 404, 'Drive has not drawn a preview for this file yet.', { code: 'NO_THUMBNAIL' });
  }

  let image;
  try {
    image = await fetch(link, { headers: { Authorization: `Bearer ${token.token}` } });
  } catch (err) {
    return sendErr(res, 502, `Could not fetch the preview from Drive: ${err.message}`, { code: 'NO_THUMBNAIL' });
  }
  const contentType = String(image.headers.get('content-type') || '');
  if (!image.ok || !contentType.startsWith('image/')) {
    if (image.status === 401) forgetToken();
    return sendErr(res, 502, `Drive answered ${image.status} for the preview.`, { code: 'NO_THUMBNAIL' });
  }
  const body = Buffer.from(await image.arrayBuffer());
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': `private, max-age=${THUMBNAIL_CACHE_SECONDS}`,
  });
  res.end(body);
  return undefined;
}

async function googleDriveMeta(token, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`
    + '?fields=hasThumbnail,thumbnailLink&supportsAllDrives=true';
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    return { ok: false, status: 502, error: err.message };
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: payload?.error?.message || `status ${res.status}` };
  }
  return { ok: true, status: 200, data: payload };
}

async function handle(req, res, pathname, method) {
  if (method !== 'GET') return false;

  if (pathname === '/api/studio/footage') {
    await sendFootage(req, res, getUrlObj(req));
    return true;
  }

  const thumb = pathname.match(/^\/api\/studio\/sources\/([^/]+)\/thumbnail$/);
  if (thumb) {
    // true means it has ALREADY sent the 429 (CLAUDE.md landmine 11).
    if (checkEndpointLimit(req, res, 'studio.thumbnail')) return true;
    await sendThumbnail(req, res, decodeURIComponent(thumb[1]));
    return true;
  }

  return false;
}

const manifest = {
  id:       'studio',
  label:    'Studio',
  prefixes: ['/api/studio'],
};

module.exports = { handle, manifest, READ_LIMIT };
