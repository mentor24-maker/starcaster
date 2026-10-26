'use strict';

/**
 * Outreach overview (Outreach wizard 1/19, task 86bcrmb8x).
 *
 *   GET /api/outreach/overview   where each channel's five stages stand
 *
 * Read-only: it reports what the existing outreach stores hold and names the
 * screen for the next step (lib/outreachOverview.js). A stage whose read
 * fails comes back "cannot_tell" with the reason, inside a 200 — the screen
 * shows that stage as unknown rather than the whole answer as an error.
 *
 * Auth and project scope are decided centrally in routes/index.js;
 * /api/outreach is closed to a client's own site admin
 * (lib/projectAdminApiAuth.js), the same as /api/engage.
 */

const { sendOk, sendErr } = require('./http');
const { buildOverview } = require('../lib/outreachOverview');

const PREFIX = '/api/outreach';

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId:    String(req?.authUser?.id || '').trim(),
  };
}

async function handle(req, res, pathname, method, { build = buildOverview } = {}) {
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;

  if (pathname === `${PREFIX}/overview`) {
    if (method !== 'GET') return sendErr(res, 405, 'Method not allowed'), true;
    const scope = requestScope(req);
    if (!scope.projectId) {
      return sendErr(res, 400, 'No project is selected, so there is no outreach to report on. Pick a project in the project menu.', { code: 'VALIDATION_ERROR' }), true;
    }
    return sendOk(res, 200, await build(scope)), true;
  }

  return sendErr(res, 404, 'Unknown outreach endpoint', { code: 'NOT_FOUND' }), true;
}

module.exports = { handle, PREFIX };
