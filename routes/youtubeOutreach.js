'use strict';

/**
 * YouTube outreach API — the target-video list and the account-wide limits
 * (YouTube outreach 1/7, task 86bcda5vb). A thin layer over
 * lib/youtubeOutreachStore.js, which does all the checking.
 *
 *   GET    /api/youtube-outreach/targets            ?account=&status=   the list
 *   POST   /api/youtube-outreach/targets            { videoUrl, ...settings }
 *   GET    /api/youtube-outreach/targets/:id
 *   PATCH  /api/youtube-outreach/targets/:id        (PUT accepted too)
 *   POST   /api/youtube-outreach/targets/:id/pause
 *   POST   /api/youtube-outreach/targets/:id/resume
 *   DELETE /api/youtube-outreach/targets/:id
 *   GET    /api/youtube-outreach/settings           ?account=
 *   PUT    /api/youtube-outreach/settings           ?account=   (PATCH accepted too)
 *
 * Drafts and approval (4/7, task 86bcda661 — lib/youtubeOutreachCommentsStore.js):
 *
 *   POST   /api/youtube-outreach/targets/:id/drafts             write a draft (AI)
 *   GET    /api/youtube-outreach/comments    ?status=draft,approved&targetId=
 *   POST   /api/youtube-outreach/comments/:id/approve   { text }  (edited wording)
 *   POST   /api/youtube-outreach/comments/:id/reject
 *   POST   /api/youtube-outreach/comments/:id/redraft            "Write another"
 *
 * The scheduled pass (6/7, task 86bcda6bg — lib/youtubeOutreachRunDue.js):
 *
 *   GET|POST /api/youtube-outreach/run-due   Vercel Cron only; drafts what is due
 *
 * GET /targets also carries each target's `nextDraft` — "Next draft: Oct 15",
 * or why it is not due — from the same plan the pass would make.
 *
 * `account` defaults to dane_of_earth. Auth and project scope are decided
 * centrally in routes/index.js; there is no public access to any of this.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const store = require('../lib/youtubeOutreachStore');
const commentsStore = require('../lib/youtubeOutreachCommentsStore');
const runDue = require('../lib/youtubeOutreachRunDue');
const { getProjectTimezoneForUser } = require('../lib/projectsStore');
const { checkEndpointLimit } = require('../lib/rateLimiter');

const PREFIX = '/api/youtube-outreach';

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId:    String(req?.authUser?.id || '').trim(),
  };
}

function errorCode(status) {
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'RULE_BROKEN';
  return undefined;
}

/** Answer from a store envelope. Returns true so `return reply(...)` ends the route. */
function reply(res, result, okStatus) {
  if (!result.ok) {
    const status = result.status || 500;
    sendErr(res, status, result.error || 'The outreach list could not be read or saved', { code: errorCode(status) });
    return true;
  }
  sendOk(res, okStatus || result.status || 200, result.data);
  return true;
}

async function readBody(req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendErr(res, 400, 'The request body must be a JSON object', { code: 'VALIDATION_ERROR' });
      return null;
    }
    return body;
  } catch (err) {
    sendErr(res, 400, `The request body is not valid JSON: ${err.message}`, { code: 'VALIDATION_ERROR' });
    return null;
  }
}

function accountOptions(urlObj) {
  const options = {};
  const account = urlObj.searchParams.get('account');
  if (account !== null) options.accountKey = account;
  const status = urlObj.searchParams.get('status');
  if (status !== null) options.status = status;
  return options;
}

async function handle(req, res, pathname, method) {
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;
  const scope = requestScope(req);
  const urlObj = getUrlObj(req);

  // CRON ONLY, like the bug-report sweep: it reads every project's targets at
  // once, so a session is deliberately not enough. `req.cronPublish` is set in
  // routes/index.js only for a CRON_PATHS path carrying Vercel's cron header
  // or the CRON_SECRET bearer token. Vercel's scheduler sends GET.
  if (pathname === `${PREFIX}/run-due`) {
    if (method !== 'GET' && method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    if (!req.cronPublish) {
      return sendErr(res, 403, 'The outreach drafting pass runs on a schedule only', { code: 'CRON_ONLY' }), true;
    }
    const result = await runDue.runDue();
    if (!result.ok) {
      console.error(`[youtube-outreach] run-due REFUSED: ${result.error}`);
      return reply(res, result);
    }
    const { accounts, drafted, held, finished, failed, skippedForPassLimit } = result.data;
    // Logged on every run, the quiet ones too: "nothing was due" and "never
    // ran" must not look the same in the log.
    console.log(`[youtube-outreach] run-due accounts=${accounts} drafted=${drafted.length} held_by_daily_max=${held.length} `
      + `finished=${finished.length} left_for_next_pass=${skippedForPassLimit.length} failed=${failed.length}`);
    for (const item of failed) {
      console.error(`[youtube-outreach] run-due FAILED project=${item.projectId} account=${item.accountKey} target=${item.targetId || '-'}: ${item.error}`);
    }
    return reply(res, result);
  }

  if (pathname === `${PREFIX}/targets`) {
    if (method === 'GET') {
      const limit = urlObj.searchParams.get('limit');
      const options = accountOptions(urlObj);
      const listed = await store.listTargets(limit === null ? 200 : Number(limit), scope, options);
      if (!listed.ok) return reply(res, listed);
      const planned = await runDue.describeSchedule(listed.data, scope, {
        accountKey: options.accountKey,
        projectTimeZone: getProjectTimezoneForUser,
      });
      // A schedule that could not be read says so on every row, rather than
      // dropping the line (an absent "Next draft" reads as "nothing planned").
      const data = listed.data.map((target) => ({
        ...target,
        nextDraft: planned.ok
          ? (planned.data[target.id] || null)
          : { due: false, finished: false, text: `Next draft: could not tell — ${planned.error || 'the schedule could not be read'}` },
      }));
      return reply(res, { ok: true, status: 200, data });
    }
    if (method === 'POST') {
      if (checkEndpointLimit(req, res, 'youtubeOutreach.targets.create')) return true;
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.createTarget(body, scope), 201);
    }
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  const drafts = pathname.match(/^\/api\/youtube-outreach\/targets\/([^/]+)\/drafts$/);
  if (drafts) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    if (checkEndpointLimit(req, res, 'youtubeOutreach.drafts.create')) return true;
    return reply(res, await commentsStore.writeDraftForTarget(decodeURIComponent(drafts[1]), scope), 201);
  }

  if (pathname === `${PREFIX}/comments`) {
    if (method !== 'GET') return sendErr(res, 405, 'Method not allowed'), true;
    const limit = urlObj.searchParams.get('limit');
    const status = urlObj.searchParams.get('status');
    return reply(res, await commentsStore.listComments(limit === null ? 200 : Number(limit), scope, {
      statuses: status ? status.split(',') : [],
      targetId: urlObj.searchParams.get('targetId') || '',
    }));
  }

  const decision = pathname.match(/^\/api\/youtube-outreach\/comments\/([^/]+)\/(approve|reject|redraft)$/);
  if (decision) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    const id = decodeURIComponent(decision[1]);
    if (decision[2] === 'approve') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await commentsStore.approveComment(id, body, scope));
    }
    if (decision[2] === 'reject') return reply(res, await commentsStore.rejectComment(id, scope));
    if (checkEndpointLimit(req, res, 'youtubeOutreach.drafts.create')) return true;
    return reply(res, await commentsStore.redraftComment(id, scope), 201);
  }

  const action = pathname.match(/^\/api\/youtube-outreach\/targets\/([^/]+)\/(pause|resume)$/);
  if (action) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    const id = decodeURIComponent(action[1]);
    const status = action[2] === 'pause' ? 'paused' : 'active';
    return reply(res, await store.setTargetStatus(id, status, scope));
  }

  const one = pathname.match(/^\/api\/youtube-outreach\/targets\/([^/]+)$/);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (method === 'GET') return reply(res, await store.getTargetById(id, scope));
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.updateTarget(id, body, scope));
    }
    if (method === 'DELETE') return reply(res, await store.deleteTarget(id, scope));
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  if (pathname === `${PREFIX}/settings`) {
    if (method === 'GET') return reply(res, await store.getSettings(scope, accountOptions(urlObj)));
    if (method === 'PUT' || method === 'PATCH') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.saveSettings(body, scope, accountOptions(urlObj)));
    }
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  return sendErr(res, 404, 'Unknown YouTube outreach endpoint', { code: 'NOT_FOUND' }), true;
}

const manifest = { id: 'youtubeOutreach', label: 'YouTube outreach', prefixes: [PREFIX] };

module.exports = { handle, manifest };
