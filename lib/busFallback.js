'use strict';

/**
 * WHERE AN ALARM GOES WHEN THE PARTY LINE WILL NOT TAKE IT.
 *
 * WHY THIS EXISTS (task 86bbwab1n, measured 2026-09-07/08)
 * The bus is the ONLY surface on which this pipeline raises an alarm. Every
 * one of these posts there and nowhere else:
 *
 *   heartbeat --check / --stale-check   a scheduled job stopped firing
 *   throughput --check                  the queue is STALLED, or UNKNOWN
 *   report_job_failure.mjs              a scheduled job failed
 *   reconcile --check                   ClickUp and the branches disagree
 *   stale_answer / checkout_currency    an answer or a checkout went stale
 *
 * On 2026-09-07 ClickUp's chat write endpoint began returning
 * `400 Invalid Request` for every message on the party line, including the
 * single word `test`. Reads on the same channel with the same token return
 * 200, and task-comment writes with the same token succeed — so it is not the
 * token, not the quota and not the channel id. The last message that landed
 * was 2026-09-07T21:39:49Z; every alarm raised after it was discarded with no
 * trace anywhere but the calling job's own console.
 *
 * This is the SECOND time. `scripts/clickup_direct.mjs` already carries a
 * comment naming "the 2026-08-23 chat outage", and records the one thing that
 * kept working through it: task comments. The relay grew a durable fallback
 * out of that day (`deliverToBus`), but it covers RELAYED messages only —
 * they have a ticket to fall back to, because the message is about one. The
 * alarms above have no ticket, so they got no fallback, so they are lost.
 *
 * WHAT THIS FILE DECIDES
 * An alarm with no ticket of its own still has somewhere to go: a standing
 * ticket whose whole job is to hold alarms the bus refused. Its identity is
 * its NAME, not an id in a config file — the same choice `nodeHeartbeat`'s
 * roll call and `pulseDigest`'s report make, for the same reason: a recorded
 * id rots the moment somebody deletes the ticket, and an id nobody can resolve
 * fails in exactly the way this whole ticket is about.
 *
 * The rendering lives here rather than in the command so it can be tested
 * without a network, and so the words a dropped alarm arrives wearing are one
 * reviewable thing rather than a template buried in a 5,000-line CLI.
 */

/** The standing ticket. Found by name; created on first need. */
const FALLBACK_TASK_NAME = 'Undelivered alarms';

/**
 * Its status. A status no loop claims from, for the same reason the roll call
 * uses one: this ticket is a noticeboard, not work. Overridable because a list
 * that lacks the status would otherwise refuse the create and lose the alarm
 * at the exact moment it is trying to save it.
 */
const FALLBACK_TASK_STATUS = 'Live';

/** The seed description, written once when the ticket is created. */
function renderFallbackSeed() {
  return [
    `The **${FALLBACK_TASK_NAME}**. Do not build this, do not close it, do not delete it.`,
    '',
    'Every comment below is a pipeline alarm that could not be posted to the party',
    'line. It is here because the alternative was losing it: the bus is the only',
    'surface these alarms have, and when ClickUp\'s chat API refuses a write they',
    'used to be discarded with nothing but a line in a log file nobody reads.',
    '',
    'Each comment says which alarm it was, which machine raised it, and why the',
    'bus refused it. **A comment here means something else is wrong** — read the',
    'alarm itself, not this ticket.',
    '',
    'When the party line is working again, new alarms go back to it and nothing',
    'new appears here. The old comments stay as the record.',
  ].join('\n');
}

/**
 * The comment a dropped alarm arrives as.
 *
 * The alarm's own text is reproduced VERBATIM and last, under a header that
 * says how it got here. Verbatim because the alarm was already written for a
 * reader; re-summarising it here would put a second author between the fault
 * and the person reading about it.
 */
function renderFallbackComment({ text, channel, why, node, at }) {
  const who = String(node || '').trim() || 'an unnamed machine';
  const when = String(at || '').trim();

  // THE OPTIONAL FIELDS ARE DROPPED HERE, NOT FROM THE JOINED ARRAY.
  //
  // This used to end `.filter((line) => line !== '')`, which was meant to drop
  // an absent `at` or `channel` and dropped the deliberate blank separators
  // with them (review round 1, 2026-09-08). Without the blank line before it,
  // Markdown reads `---` as a setext underline: the horizontal rule vanishes
  // and the line above it — "The alarm itself, unchanged:" — is rendered as a
  // heading. It is cosmetic, and it is cosmetic on the one surface a person
  // reads DURING an outage, which is the wrong place to be sloppy.
  const facts = [
    `*   raised by: **${who}**`,
    when ? `*   at: ${when}` : null,
    `*   the party line refused it: \`${String(why || 'no reason given').slice(0, 300)}\``,
    channel ? `*   channel: \`${channel}\`` : null,
  ].filter(Boolean);

  return [
    '**⚠️ This alarm could not reach the party line, so it is here instead.**',
    '',
    ...facts,
    '',
    'The alarm itself, unchanged:',
    '',
    '---',
    '',
    String(text || '').trim(),
  ].join('\n');
}

/**
 * The line the command prints about where the message actually went.
 *
 * Separate from the comment because the two readers are different: this one is
 * for the log of the job that raised the alarm, and its job is to make
 * "delivered somewhere else" impossible to mistake for "delivered as normal".
 */
function renderRouteLine({ via, channel, why, url }) {
  if (via === 'chat') return `Posted to channel ${channel}.`;
  if (via === 'ticket') {
    return [
      '',
      `THE PARTY LINE REFUSED THIS MESSAGE (${why}).`,
      `It was NOT lost: it is a comment on the standing "${FALLBACK_TASK_NAME}" ticket instead.`,
      url ? `  ${url}` : '',
      'Treat this as delivered — but the bus itself is broken, and that is its own fault to fix.',
    ].filter(Boolean).join('\n');
  }
  return `Delivered nowhere (${why}).`;
}

/**
 * WHY A LOOP NOTE REFUSED, IN THE TERMS THAT CHANGE WHAT A PASS SHOULD DO.
 *
 * Two causes print the same failure today and they are opposites:
 *
 *   "not found"      the field has never been created. The pass carries on;
 *                    only the note is missing, and nothing was ever depending
 *                    on it. This is what the skills tell a pass to expect.
 *   "plan exhausted" the field EXISTS and refuses writes, because the
 *                    workspace is out of custom-field usages. The Loop note is
 *                    the only surface on which a pass in flight is visible to
 *                    another pass, so a refusal here means THIS PASS'S CLAIM
 *                    IS INVISIBLE and another pass may take the ticket out
 *                    from under it. That is the 2026-08-22 double-review
 *                    failure (PR #362) with the guard switched off.
 *
 * The skills say a stamp failure is not a failure of the build. That was right
 * when the only cause was "not set up yet". Told apart, the second cause can
 * say the thing that is actually true.
 */
function classifyFieldRefusal({ status, body }) {
  const text = String(body || '');
  if (/custom field usages exceeded/i.test(text)) {
    return {
      kind: 'plan-exhausted',
      lines: [
        '',
        'THE LOOP NOTE EXISTS AND IS REFUSING WRITES — this is NOT "the field is not set up yet".',
        `ClickUp says: ${text.slice(0, 200)}`,
        '',
        'What this costs, in plain words: the Loop note is the only place another pass',
        'can see that this ticket is already being worked on. With it refusing writes,',
        'every pass reads an empty note and takes the ticket — which is exactly the',
        '2026-08-22 failure the field was added to prevent (two review passes verified',
        'PR #362 at the same time and the second overwrote the first one\'s verdict).',
        '',
        'Your claim is invisible. The ClickUp status move still happened and is still',
        'the real claim, so carry on — but say in your run report that the queue could',
        'not be stamped, and do not treat a ticket with an empty Loop note as free.',
        '',
        'DO NOT ASK ANYONE TO PAY FOR THIS. On 2026-08-23 the identical pair of',
        'symptoms — every chat write 400, every custom-field write "usages exceeded" —',
        'was diagnosed as the Free Forever plan and the proposed fix was an upgrade.',
        'It was wrong. The plan was unchanged before, during and after, and the window',
        'closed on its own after about sixteen hours. See docs/LOOP_ENGINEERING.md,',
        '"The party line is not the only way out". Check whether it is a window before',
        'you go looking for a permission: read the plan, read the party line timestamps,',
        'and try again in an hour.',
      ],
    };
  }
  return { kind: 'other', lines: [], status: status ?? null };
}

module.exports = {
  FALLBACK_TASK_NAME,
  FALLBACK_TASK_STATUS,
  classifyFieldRefusal,
  renderFallbackComment,
  renderFallbackSeed,
  renderRouteLine,
};
