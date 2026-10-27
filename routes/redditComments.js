'use strict';

/**
 * Reddit comments API (Reddit comments 2/4, task 86bch3jp3) — a thin layer
 * over lib/redditCommentsStore.js, which does all the checking.
 *
 *   GET    /api/engage/reddit-comments/items              ?status=&limit=
 *   POST   /api/engage/reddit-comments/items              { url, postTitle?, postBody?, parentCommentText? }
 *   GET    /api/engage/reddit-comments/items/:id
 *   POST   /api/engage/reddit-comments/items/:id/draft    write three options (AI, 9/19); "Three more" too
 *   POST   /api/engage/reddit-comments/items/:id/approve  { text?, option? }  (his wording, and which option he picked)
 *   POST   /api/engage/reddit-comments/items/:id/reject
 *   POST   /api/engage/reddit-comments/items/:id/paste       { postTitle, postBody, parentCommentText? }
 *   POST   /api/engage/reddit-comments/items/:id/read-again  ask the Mini to read it again
 *   GET    /api/engage/reddit-comments/status             the Mini's Reddit sign-in, and the pace
 *
 * Add saves the row as `readState: reading` and the Mini's signed-in browser
 * fills the post in (Outreach wizard 17/19). While the Mini is not signed in
 * to Reddit, Add answers 409 `POST_TEXT_NEEDED` with that reason instead, and
 * sending Add again with the post pasted saves it. A row the Mini could not
 * read takes the post pasted onto it (`paste`) or another try (`read-again`).
 *
 * Nothing here posts: the Mini's worker does (workers/youtube-outreach/
 * adapters/reddit.js, 4/4). `status` only READS what that worker last wrote
 * about its browser — no route can write it. The older
 * /api/engage/reddit/* routes in routes/engage.js are untouched.
 *
 * Auth and project scope are decided centrally in routes/index.js; /api/engage
 * is closed to a client's own site admin (lib/projectAdminApiAuth.js).
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const store = require('../lib/redditCommentsStore');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const { REDDIT_PACE } = require('../lib/redditPace');
const outreachAccounts = require('../lib/outreachAccounts');

const PREFIX = '/api/engage/reddit-comments';

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
    sendErr(res, status, result.error || 'The Reddit comments could not be read or saved', { code: result.code || errorCode(status) });
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

async function handle(req, res, pathname, method) {
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;
  const scope = requestScope(req);

  if (pathname === `${PREFIX}/items`) {
    if (method === 'GET') {
      const urlObj = getUrlObj(req);
      const limit = urlObj.searchParams.get('limit');
      return reply(res, await store.listItems(limit === null ? 200 : Number(limit), scope, {
        status: urlObj.searchParams.get('status') || undefined,
      }));
    }
    if (method === 'POST') {
      if (checkEndpointLimit(req, res, 'redditComments.add')) return true;
      const body = await readBody(req, res);
      if (!body) return true;
      const added = await store.addItem(body, scope);
      // Logged so the first real Add in production records whether Reddit
      // answers Vercel at all (measured blocked from the Mini, 2026-10-12).
      if (!added.ok && added.code === 'POST_TEXT_NEEDED') {
        console.warn(`[reddit-comments] add: the Mini was not asked to read the post (${added.readerCode || 'unknown'}) — ${added.error}`);
      }
      return reply(res, added, 201);
    }
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  if (pathname === `${PREFIX}/status`) {
    if (method !== 'GET') return sendErr(res, 405, 'Method not allowed'), true;
    const check = await store.getBrowserCheck(scope);
    // The account and the pace live on the Reddit settings row since Outreach
    // wizard 2/19 (chosen on Engage › Outreach). A row that cannot be read
    // falls back to the plain default pace and no account — which is also
    // what holds every post — and says so on its own line, like the sign-in
    // reading below.
    const chosen = await outreachAccounts.getAccount('reddit', scope);
    return reply(res, {
      ok: true,
      status: 200,
      data: {
        account: chosen.ok ? chosen.data.expectedAccount : '',
        accountError: chosen.ok ? '' : chosen.error,
        pace: chosen.ok ? chosen.data.pace : REDDIT_PACE,
        browserCheck: check.ok ? check.data : null,
        browserCheckError: check.ok ? '' : check.error,
      },
    });
  }

  const decision = pathname.match(/^\/api\/engage\/reddit-comments\/items\/([^/]+)\/(draft|approve|reject|paste|read-again)$/);
  if (decision) {
    if (method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    const id = decodeURIComponent(decision[1]);
    if (decision[2] === 'paste') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.pasteForItem(id, body, scope));
    }
    if (decision[2] === 'read-again') return reply(res, await store.readAgain(id, scope));
    if (decision[2] === 'approve') {
      const body = await readBody(req, res);
      if (!body) return true;
      return reply(res, await store.approveItem(id, body, scope));
    }
    if (decision[2] === 'reject') return reply(res, await store.rejectItem(id, scope));
    if (checkEndpointLimit(req, res, 'redditComments.drafts.create')) return true;
    return reply(res, await store.writeDraftForItem(id, scope));
  }

  const one = pathname.match(/^\/api\/engage\/reddit-comments\/items\/([^/]+)$/);
  if (one) {
    if (method !== 'GET') return sendErr(res, 405, 'Method not allowed'), true;
    return reply(res, await store.getItemById(decodeURIComponent(one[1]), scope));
  }

  return sendErr(res, 404, 'Unknown Reddit comments endpoint', { code: 'NOT_FOUND' }), true;
}

const manifest = { id: 'redditComments', label: 'Reddit comments', prefixes: [PREFIX] };

module.exports = { handle, manifest };
