'use strict';

/**
 * "Google Drive sign-in needed on the MacBook" — the standing ticket that tells
 * Dane when media intake cannot upload because Google refused rclone's sign-in
 * (task SC-879). The pass is scripts/media_intake.mjs; recognising the refusal
 * is lib/mediaIntake.js (`isSigninRefusal`); the write is the ticket door's
 * `writeStandingTicket`, the same routine "SQL waiting for you" and "Broken
 * links on client sites" use.
 *
 * WHY. The sign-in was refused from 2026-10-19 to 10-26 and again on
 * 2026-11-18, when Dane's Zoom test recording never arrived. Both times the
 * only report was a bus post, and the bus does not reach him: he found out
 * because the recording was missing. So the refusal goes on a ticket assigned
 * to him, with the date it broke and the one thing to do, and it clears itself
 * when an upload works again.
 *
 * THE RULES.
 *   - Only a refused SIGN-IN assigns him. A network blip or a full Drive is not
 *     his to fix by signing in; those stay on the bus as before.
 *   - Rewritten only when what it says changes (the date it broke, how many
 *     recordings wait, or broken → working). A pass every 15 minutes must not
 *     rewrite it 96 times a day.
 *   - A pass that neither uploaded nor was refused says nothing new: the
 *     ticket is left as it is. (While it is broken, the pass asks Drive once
 *     with a cheap listing, so a ticket can still clear on a day with nothing
 *     to send.)
 *   - A write that fails is said in the log as failed and NOT remembered as
 *     written, so the next pass tries again. The bus post for the failed
 *     upload still goes out (scripts/run_media_intake.sh).
 */

const { mountainTime } = require('./unappliedSql');

const TASK_NAME = 'Google Drive sign-in needed on the MacBook';
const FIX_COMMAND = 'rclone config reconnect gdrive:';
const ACCOUNT = 'mentorofaio';

/**
 * What this pass learned about the sign-in, from its reports (Zoom, Photos).
 *   refused  — at least one upload was refused for the sign-in
 *   working  — at least one upload went through
 *   unknown  — nothing reached Drive either way (nothing new to send, or only
 *              other failures)
 * `waiting` is how many recordings the refusal held back.
 */
function signinVerdict(reports = []) {
  const all = reports.filter(Boolean);
  const refused = all.flatMap((r) => (r.failed || []).filter((f) => f.signinRefused));
  if (refused.length) return { verdict: 'refused', waiting: refused.length };
  if (all.some((r) => (r.sent || []).length)) return { verdict: 'working', waiting: 0 };
  return { verdict: 'unknown', waiting: 0 };
}

/** A probe's answer (uploader.probe()) as a verdict. A failure that is not a refusal tells nothing. */
function probeVerdict(probe, waiting = 0) {
  if (probe && probe.ok) return { verdict: 'working', waiting: 0 };
  if (probe && probe.signinRefused) return { verdict: 'refused', waiting };
  return { verdict: 'unknown', waiting, why: probe ? probe.why : 'no answer' };
}

function footer() {
  return [
    '---',
    `The **${TASK_NAME}** ticket. Do not build this, do not close it, do not delete it.`,
    'It is rewritten in place by the MacBook\'s media-intake job (`scripts/media_intake.mjs`, every 15 minutes, '
      + 'task SC-879), and Dane is assigned exactly while Google is refusing the sign-in. It is only rewritten '
      + 'when what it says changes.',
  ].join('\n');
}

/**
 * The ticket, from the remembered state.
 *   brokenSince — ISO time of the first refused pass, or null when working
 *   waiting     — recordings held back by the refusal
 * Returns { body, fingerprint, assign }.
 */
function renderTicket({ brokenSince = null, waiting = 0, now = Date.now(), node = '' } = {}) {
  if (!brokenSince) {
    return {
      body: [
        '# Nothing needed — the MacBook\'s Google Drive sign-in is working',
        '',
        `Confirmed ${mountainTime(now)}${node ? ` on ${node}` : ''}: an upload to the Studio Inbox went through. `
          + 'Zoom recordings and videos in the Photos "Studio" album are reaching Studio.',
        '',
        footer(),
      ].join('\n'),
      // No time in it: a working sign-in is the same news every pass.
      fingerprint: 'working',
      assign: false,
    };
  }
  const n = Number(waiting) || 0;
  return {
    body: [
      '# Sign in to Google Drive again on the MacBook',
      '',
      `Since **${mountainTime(Date.parse(brokenSince))}**, Google has refused the MacBook's Drive sign-in, so new `
        + 'Zoom recordings and videos in the Photos "Studio" album are **not reaching Studio**.',
      '',
      n
        ? `**${n} recording${n === 1 ? '' : 's'} waiting** to be sent (as of ${mountainTime(now)}). Nothing is lost: `
          + 'they go up by themselves once the sign-in works.'
        : `No recording is waiting right now (as of ${mountainTime(now)}), but the next one will not go up until the `
          + 'sign-in works.',
      '',
      '## The fix — about a minute, on the MacBook',
      '',
      '1. Open **Terminal**.',
      `2. Type \`${FIX_COMMAND}\` and press Return.`,
      '3. If it asks a question, press Return to take the suggested answer.',
      `4. A browser window opens. Sign in as **${ACCOUNT}** (not mentor24) and click **Allow**.`,
      '5. When the browser says "Success", you are done.',
      '',
      'Nothing else to do: the waiting recordings go up on the next pass (within 15 minutes), and this ticket '
        + 'clears itself and un-assigns you.',
      '',
      footer(),
    ].join('\n'),
    fingerprint: `refused:${brokenSince}:${n}`,
    assign: true,
  };
}

/**
 * The state after this pass, and whether the ticket needs writing.
 *   state — { brokenSince, waiting, ticket: { id, fingerprint, assign, writtenAt } }
 * Returns { next, rendered, due }. `rendered` is null on an 'unknown' pass.
 */
function decide({ state = {}, verdict = 'unknown', waiting = 0, now = Date.now(), node = '' } = {}) {
  const prior = state || {};
  if (verdict === 'unknown') return { next: { ...prior }, rendered: null, due: false };
  const brokenSince = verdict === 'refused' ? (prior.brokenSince || new Date(now).toISOString()) : null;
  const next = { ...prior, brokenSince, waiting: verdict === 'refused' ? waiting : 0 };
  const rendered = renderTicket({ brokenSince, waiting: next.waiting, now, node });
  const ticket = prior.ticket || {};
  const due = ticket.fingerprint !== rendered.fingerprint || ticket.assign !== rendered.assign;
  return { next, rendered, due };
}

/**
 * Run the decision and the write. `write(rendered, rememberedId)` is the door's
 * writeStandingTicket (or a fake in the tests) and resolves { ok, id, url, why }.
 * Returns { state, lines, outcome } where outcome is one of
 *   'nothing' | 'unchanged' | 'dry-run' | 'written' | 'failed'
 * and `state` is what to save. A failed write leaves the ticket half of the
 * state as it was, so the next pass tries again.
 */
async function report({ state = {}, verdict, waiting = 0, now = Date.now(), node = '', write, dryRun = false } = {}) {
  const { next, rendered, due } = decide({ state, verdict, waiting, now, node });
  const lines = [];
  if (!rendered) {
    return { state: next, lines, outcome: 'nothing' };
  }
  if (!due) {
    lines.push(`Drive sign-in: ${verdict}; the "${TASK_NAME}" ticket already says this.`);
    return { state: next, lines, outcome: 'unchanged' };
  }
  if (dryRun) {
    lines.push(`--- would write the "${TASK_NAME}" ticket (assign Dane: ${rendered.assign}) ---`, rendered.body,
      '--- (dry run: nothing written, nothing remembered) ---');
    return { state, lines, outcome: 'dry-run' };
  }
  let wrote;
  try {
    wrote = await write(rendered, (state && state.ticket && state.ticket.id) || '');
  } catch (err) {
    wrote = { ok: false, why: String((err && err.message) || err) };
  }
  if (!wrote || !wrote.ok) {
    lines.push(`Drive sign-in: ${verdict} — could NOT write the "${TASK_NAME}" ticket, so Dane has NOT been told `
      + `there: ${(wrote && wrote.why) || 'no reason given'}. The next pass tries again.`);
    return { state: { ...next, ticket: (state && state.ticket) || undefined }, lines, outcome: 'failed' };
  }
  lines.push(`Drive sign-in: ${verdict} — wrote the "${TASK_NAME}" ticket ${wrote.url || wrote.id} `
    + `(Dane ${rendered.assign ? 'assigned' : 'unassigned'}).`);
  return {
    state: {
      ...next,
      ticket: { id: wrote.id, fingerprint: rendered.fingerprint, assign: rendered.assign, writtenAt: new Date(now).toISOString() },
    },
    lines,
    outcome: 'written',
  };
}

module.exports = {
  TASK_NAME,
  FIX_COMMAND,
  signinVerdict,
  probeVerdict,
  renderTicket,
  decide,
  report,
};
