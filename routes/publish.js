'use strict';

/**
 * Publishing a site: turn drafts into the live snapshot.
 *
 * Its own module rather than more surface on routes/builder.js, per
 * routes/CLAUDE.md — the monoliths are supposed to stop growing.
 *
 * AUTHENTICATED. These are /api/builder/* paths, which routes/index.js treats
 * as requiring a session; nothing here is exempt, and every call is scoped to
 * the caller's active project.
 *
 * THE SHAPE IS A LOOP, NOT A LONG REQUEST
 * POST /publish writes ONE BATCH and answers with how many remain, so the
 * caller keeps calling until `done`. That is deliberate and load-bearing:
 * propagateCanonicalSection was a single long loop inside a serverless
 * function, and on 2026-07-22 it was killed when the response went out,
 * leaving 30 pages updated and 20 stale. A batch that dies costs at most the
 * pages in that batch, and every page it did write is a complete build.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const {
  publishPages,
  getPublishStatus,
  PUBLISH_BATCH_SIZE,
} = require('../lib/builderPublishStore');

const manifest = {
  id: 'publish',
  label: 'Publish (draft → live snapshot)',
  prefixes: ['/api/builder/publish'],
};

function projectIdFor(req) {
  return String(req?.projectContext?.project?.id || '').trim();
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/builder/publish')) return false;

  const requestMethod = String(method || '').toUpperCase();
  const projectId = projectIdFor(req);
  if (!projectId) {
    return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' }), true;
  }

  // GET /api/builder/publish/status — how much is unpublished.
  if (pathname === '/api/builder/publish/status' && requestMethod === 'GET') {
    const result = await getPublishStatus(projectId);
    if (!result.ok) {
      return sendErr(res, result.status || 500, result.error || 'Could not read publish status', {
        code: result.code || null,
      }), true;
    }
    return sendOk(res, 200, result.data, result.data), true;
  }

  // POST /api/builder/publish — build one batch, report what remains.
  if (pathname === '/api/builder/publish' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const result = await publishPages(projectId, {
      buildId: body?.buildId,
      limit: body?.limit,
    });
    if (!result.ok) {
      return sendErr(res, result.status || 500, result.error || 'Could not publish', {
        code: result.code || null,
      }), true;
    }
    return sendOk(res, 200, result.data, result.data, { batchSize: PUBLISH_BATCH_SIZE }), true;
  }

  return false;
}

module.exports = { handle, manifest };
