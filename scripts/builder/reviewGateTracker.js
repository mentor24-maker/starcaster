'use strict';

/**
 * review_gate's two calls to THE TRACKER (SC-795).
 *
 * StarCaster's tickets moved from ClickUp to the tracker on 2026-11-12
 * (SC-790), and the review verdicts went with them. This gate runs on
 * GitHub's machines, which cannot see the Mini's home-network address
 * (`trackerUrl`, mac-mini.local). It calls the tracker at its INTERNET
 * address instead, `trackerPublicUrl` in spirality.project.json (the
 * Tailscale Funnel route, where only the API answers and everything needs a
 * sign-in).
 *
 * It signs in with its own tracker seat, whose token is the repository secret
 * TRACKER_REVIEW_GATE_TOKEN. Putting that secret in is the operator's (a real
 * secret value); until it is there, every answer here is "could not look",
 * which the gate turns into CANNOT TELL and, while advisory, blocks nothing.
 *
 * WHAT IS DELIBERATE IN HERE, carried over from the ClickUp version it
 * replaced (2026-09-04, task 86bbugcpa):
 *
 *   - `null` comments and `[]` comments are DIFFERENT and are never collapsed.
 *     "I could not look" and "I looked and there is nothing" lead to opposite
 *     verdicts, and a gate that confuses them passes a PR it never checked.
 *   - A missing token is reported as a missing CI SECRET, by name. The reader
 *     of that line is somebody staring at a check in Actions.
 *   - Neither function throws. Both answer with a reason, because the caller
 *     turns every one of these into CANNOT TELL, and CANNOT TELL must never
 *     become a pass by way of an exception nobody caught.
 *
 * The comments come back in the shape the gate's pure logic already reads
 * (`comment_text`, `date` as epoch-millisecond strings), the same mapping the
 * ticket door makes (loop/scripts/tracker/apiTracker.mjs, `commentFromRow`):
 * top-level comments only, as ClickUp's comment list gave, newest first.
 *
 * The transport is injected (`deps.fetchImpl`, defaulting to the global
 * fetch) so the tests drive every failure shape without a network.
 */

const { pickTeamChat, renderBusPost, mountainTime } = require('../../loop/lib/trackerBus.js');

/** The repository secret the workflow passes in. Named once, here. */
const TOKEN_SECRET = 'TRACKER_REVIEW_GATE_TOKEN';
const HTTP_TIMEOUT_MS = 30 * 1000;

const trim = (url) => String(url || '').replace(/\/+$/, '');

async function call(method, url, { token, body, fetchImpl, timeoutMs }) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Connection: 'close' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs || HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    return { transportError: err };
  }
  let json = null;
  try { json = JSON.parse(await res.text()); } catch { json = null; }
  return { res, json };
}

/** Why an HTTP refusal happened, in words a person reading Actions can act on. */
function refusalWhy(res, json) {
  const said = json && (json.message || json.error) ? ` (${json.message || json.error})` : '';
  if (res.status === 401) return `the tracker refused the sign-in: HTTP 401${said}. The ${TOKEN_SECRET} secret is wrong or its seat was removed`;
  return `the tracker answered HTTP ${res.status}${said}`;
}

/** The setup problem that stops any call, or '' when there is none. */
function setupProblem({ token, baseUrl }) {
  if (!baseUrl) return 'spirality.project.json names no trackerPublicUrl, so this job has no internet address to reach the tracker at';
  if (!token) return `${TOKEN_SECRET} is not set in this job — the CI secret is missing`;
  return '';
}

/** A tracker comment row as the gate reads it (ClickUp's comment shape). */
function shapeComment(c) {
  return {
    id: String(c.id),
    comment_text: String(c.body ?? ''),
    date: String(Date.parse(c.createdAt)),
    user: { id: c.author },
    parent: c.parent == null ? null : String(c.parent),
  };
}

/**
 * The ticket's comments, or null if they could not be read, with the reason.
 * GET /tickets/<ID> answers the ticket with its comments (oldest first).
 */
async function readTicketComments(ticketId, { token, baseUrl, fetchImpl = fetch, timeoutMs } = {}) {
  const problem = setupProblem({ token, baseUrl });
  if (problem) return { comments: null, why: problem };
  const id = encodeURIComponent(String(ticketId || '').toUpperCase());
  const out = await call('GET', `${trim(baseUrl)}/tickets/${id}`, { token, fetchImpl, timeoutMs });
  if (out.transportError) {
    const err = out.transportError;
    return { comments: null, why: `the tracker is unreachable at ${trim(baseUrl)}: ${err?.message || err}` };
  }
  if (!out.res.ok) return { comments: null, why: refusalWhy(out.res, out.json) };
  if (!Array.isArray(out.json?.comments)) return { comments: null, why: 'the tracker returned no comment list' };
  const comments = out.json.comments
    .filter((c) => c && c.parent == null)
    .map(shapeComment)
    .reverse();
  return { comments, why: '' };
}

/**
 * Announce an override on the bus: one comment on the bus project's
 * "Team chat" ticket, as `bus-post` writes it. Returns ok/why so a failure is
 * reported, never assumed. It never creates the ticket: `bus-post` does that,
 * and a gate making noticeboards on GitHub's machines would be a surprise.
 */
async function announceWaiver(content, { token, baseUrl, busProject, fetchImpl = fetch, timeoutMs, now = Date.now() } = {}) {
  const problem = setupProblem({ token, baseUrl });
  if (problem) return { ok: false, why: problem };
  if (!busProject) return { ok: false, why: 'spirality.project.json names no busProject, so there is no bus to post to' };
  const base = trim(baseUrl);
  const listed = await call('GET', `${base}/projects/${encodeURIComponent(busProject)}/tickets?open=true`, { token, fetchImpl, timeoutMs });
  if (listed.transportError) return { ok: false, why: `the tracker is unreachable: ${listed.transportError?.message || listed.transportError}` };
  if (!listed.res.ok) return { ok: false, why: refusalWhy(listed.res, listed.json) };
  const tickets = Array.isArray(listed.json?.tickets) ? listed.json.tickets : null;
  if (!tickets) return { ok: false, why: `the tracker returned no ticket list for ${busProject}` };
  const chat = pickTeamChat(tickets.map((t) => ({ id: t.id, name: t.name, date_created: String(Date.parse(t.createdAt)) })));
  if (!chat) return { ok: false, why: `there is no "Team chat" ticket in ${busProject} (npm run clickup -- bus-post makes one)` };
  const text = renderBusPost({ text: content, node: 'the review gate on GitHub', at: mountainTime(now) });
  if (!text) return { ok: false, why: 'the announcement is empty' };
  const posted = await call('POST', `${base}/tickets/${encodeURIComponent(chat.id)}/comments`, { token, fetchImpl, timeoutMs, body: { body: text } });
  if (posted.transportError) return { ok: false, why: `the tracker is unreachable: ${posted.transportError?.message || posted.transportError}` };
  if (!posted.res.ok) return { ok: false, why: refusalWhy(posted.res, posted.json) };
  // Read back: the answer is the comment as stored. A post the tracker did not
  // keep as written is not an announcement anybody will see.
  if (posted.json?.id == null || !String(posted.json?.body ?? '').includes(String(content).trim())) {
    return { ok: false, why: `the post on ${chat.id} did not read back as written` };
  }
  return { ok: true, why: '', ticket: chat.id };
}

module.exports = { readTicketComments, announceWaiver, shapeComment, TOKEN_SECRET };
