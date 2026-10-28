'use strict';

/**
 * Outreach overview (Outreach wizard 1/19, task 86bcrmb8x).
 *
 *   GET  /api/outreach/overview                  where each channel's five stages stand
 *   POST /api/outreach/accounts/:site/choose     { account } — the account
 *                                                this channel posts as
 *   POST /api/outreach/accounts/:site/check      "Check now": ask the Mini to
 *                                                re-run its sign-in check
 *   POST /api/outreach/accounts/reddit/pace      { maxCommentsPerDay,
 *                                                minMinutesBetween }
 *   GET  /api/outreach/feedback/reasons          the chips a Reject offers: five
 *                                                defaults plus every reason Dane
 *                                                has used before (Outreach wizard
 *                                                12/19, lib/outreachFeedbackStore.js)
 *
 * The three POSTs are Outreach wizard 2/19 (task 86bcrmba0), over
 * lib/outreachAccounts.js. Nothing on the internet can reach the Mini, so
 * "Check now" leaves a request on the channel's settings row and the posting
 * worker picks it up within about half a minute
 * (workers/youtube-outreach/poster.js).
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

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { buildOverview } = require('../lib/outreachOverview');
const outreachAccounts = require('../lib/outreachAccounts');
const outreachFeedback = require('../lib/outreachFeedbackStore');

const PREFIX = '/api/outreach';

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId:    String(req?.authUser?.id || '').trim(),
  };
}

function reply(res, result) {
  if (result.ok) return sendOk(res, result.status || 200, result.data);
  return sendErr(res, result.status || 500, result.error, { code: result.status === 400 ? 'VALIDATION_ERROR' : undefined });
}

async function readBody(req, res) {
  try {
    const body = await parseJsonBody(req);
    return body && typeof body === 'object' ? body : {};
  } catch (err) {
    sendErr(res, 400, `The request body is not valid JSON: ${err.message}`, { code: 'VALIDATION_ERROR' });
    return null;
  }
}

async function handle(req, res, pathname, method, { build = buildOverview, accounts = outreachAccounts, feedback = outreachFeedback } = {}) {
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;

  if (pathname === `${PREFIX}/overview`) {
    if (method !== 'GET') return sendErr(res, 405, 'Method not allowed'), true;
    const scope = requestScope(req);
    if (!scope.projectId) {
      return sendErr(res, 400, 'No project is selected, so there is no outreach to report on. Pick a project in the project menu.', { code: 'VALIDATION_ERROR' }), true;
    }
    return sendOk(res, 200, await build(scope)), true;
  }

  if (pathname === `${PREFIX}/feedback/reasons`) {
    if (method !== 'GET') return sendErr(res, 405, 'Method not allowed'), true;
    return reply(res, await feedback.listReasons(requestScope(req))), true;
  }

  const action = pathname.match(/^\/api\/outreach\/accounts\/([a-z]+)\/(choose|check|pace)$/);
  if (action) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    const [, site, verb] = action;
    if (!accounts.SITES[site] || (verb === 'pace' && site !== 'reddit')) {
      return sendErr(res, 404, 'Unknown outreach endpoint', { code: 'NOT_FOUND' }), true;
    }
    const scope = requestScope(req);
    if (verb === 'check') return reply(res, await accounts.requestCheck(site, scope)), true;
    const body = await readBody(req, res);
    if (!body) return true;
    if (verb === 'choose') return reply(res, await accounts.chooseAccount(site, body.account, scope)), true;
    return reply(res, await accounts.saveRedditPace(body, scope)), true;
  }

  return sendErr(res, 404, 'Unknown outreach endpoint', { code: 'NOT_FOUND' }), true;
}

module.exports = { handle, PREFIX };
