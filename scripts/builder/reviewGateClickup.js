'use strict';

/**
 * review_gate's two ClickUp calls, lifted out of `scripts/review_gate.mjs` so
 * they can be TESTED (2026-09-04, task 86bbugcpa).
 *
 * WHY THEY MOVED. This gate runs in CI, not on the Mini, and CI's token has
 * expired silently before — the known failure being that the gate keeps
 * answering while its token is dead. Its behaviour with a missing or expired
 * token is therefore load-bearing, and it lived inside an ESM entrypoint that
 * runs `main()` on import: nothing could import it, so nothing could pin it.
 * The migration onto the shared ClickUp client had to be able to prove it
 * changed nothing here, and "read the diff carefully" is not a proof.
 *
 * WHAT IS DELIBERATE IN HERE, all of it pre-existing behaviour this module
 * only made visible:
 *
 *   - `null` comments and `[]` comments are DIFFERENT and are never collapsed.
 *     "I could not look" and "I looked and there is nothing" lead to opposite
 *     verdicts, and a gate that confuses them passes a PR it never checked.
 *   - A missing token is reported as a missing CI SECRET, by name. The reader
 *     of that line is somebody staring at a red check in Actions.
 *   - Neither function throws. Both answer with a reason, because the caller
 *     turns every one of these into CANNOT TELL — and CANNOT TELL must never
 *     become a pass by way of an exception nobody caught.
 *
 * The transport is injected (`deps.clickupFetch`) rather than imported, so the
 * shared client's counter sees these requests while the tests can still drive
 * every failure shape without a network.
 */

const { clickupFetch } = require('../lib/clickup.cjs');

const API_BASE = process.env.CLICKUP_API_BASE || 'https://api.clickup.com';

/**
 * The ticket's comments, or null if they could not be read. Null and an empty
 * array mean very different things here — "I could not look" versus "I looked
 * and there is nothing" — so the two are never collapsed.
 */
async function readTicketComments(taskId, { token, fetchImpl = clickupFetch } = {}) {
  if (!token) {
    return { comments: null, why: 'CLICKUP_API_TOKEN is not set in this job — the CI secret is missing' };
  }
  // The shared door RETURNS a transport failure rather than throwing it, so
  // the unreachable case is a branch here, not a catch. The message is the
  // one this function has always produced.
  const out = await fetchImpl(`${API_BASE}/api/v2/task/${encodeURIComponent(taskId)}/comment`, {
    headers: { Authorization: token, 'Content-Type': 'application/json' },
  });
  if (out.transportError) {
    const err = out.transportError;
    return { comments: null, why: `ClickUp is unreachable: ${err?.message || err}` };
  }
  if (!out.res.ok) return { comments: null, why: `ClickUp answered HTTP ${out.res.status}` };
  const json = out.json;
  if (!Array.isArray(json?.comments)) return { comments: null, why: 'ClickUp returned no comment list' };
  return { comments: json.comments, why: '' };
}

/** Announce an override. Returns ok/why so a failure is reported, not assumed. */
async function announceWaiver(content, { token, workspace, busChannel, fetchImpl = clickupFetch } = {}) {
  if (!token) return { ok: false, why: 'no ClickUp token in this job' };
  const out = await fetchImpl(
    `${API_BASE}/api/v3/workspaces/${workspace}/chat/channels/${busChannel}/messages`,
    {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'message', content, content_format: 'text/md' }),
    },
  );
  if (out.transportError) {
    const err = out.transportError;
    return { ok: false, why: String(err?.message || err) };
  }
  return { ok: out.res.ok, why: out.res.ok ? '' : `HTTP ${out.res.status}` };
}

module.exports = { readTicketComments, announceWaiver, API_BASE };
