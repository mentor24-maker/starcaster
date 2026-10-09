'use strict';

/**
 * YouTube outreach 6/7 (task 86bcda6bg) — which target videos are due a new
 * draft, and why the others are not. Pure: the targets, their comments, the
 * account settings and the clock are all passed in, so the tests can stand on
 * any day and say exactly what the scheduled pass would do.
 *
 * The pass itself is lib/youtubeOutreachRunDue.js. It only ever writes DRAFTS:
 * Dane approves every comment (his decision, 2026-10-05), and posting is the
 * Mini's job (5/7). The timer only saves him clicking "Write a draft".
 *
 * THE RULES
 *
 *   - A paused target is never due. A target marked done is never due.
 *   - ONE WAITING COMMENT PER TARGET. A target with a draft waiting for
 *     approval, or an approved comment not yet posted, gets no new draft — so
 *     drafts do not pile up while Dane is away.
 *   - A one-off target is due until a comment on it has been posted, then it
 *     is finished.
 *   - A repeat target is due every N days after its last posted comment, until
 *     it has posted its maximum count or passed its stop date.
 *   - Higher priority goes first; within a priority, the target added first.
 *   - THE DAILY MAXIMUM APPLIES TO DRAFTING TOO. The pass never leaves more
 *     comments in the pipe than the account could still post today:
 *     maxCommentsPerDay, less what already went out today, less what is
 *     already waiting (drafts, approved, being posted).
 *
 * "Posted" means the same thing the poster's limits mean (5/7,
 * workers/youtube-outreach/limits.js): a comment that went out, dated by
 * posted_at. A rejected draft or a failed post does not use up a one-off.
 *
 * Every reason is a sentence Dane can read next to the video (CLAUDE.md
 * landmine 17: an unexplained "not due" reads as a broken timer).
 */

const DAY = 24 * 60 * 60 * 1000;

/** Waiting for Dane, or waiting for the poster: either way the target already has one in the pipe. */
const WAITING_STATUSES = new Set(['draft', 'approved', 'posting']);

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

function isValidTimeZone(zone) {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day (2026-10-08) at `atMs` in `timeZone`. */
function localDay(atMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(atMs));
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "Oct 15" in the account's time zone. */
function dateText(atMs, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(new Date(atMs));
}

/** When a posted comment went out, or null if it never did. */
function postedTime(comment) {
  if (comment?.status !== 'posted') return null;
  const at = Date.parse(comment.postedAt || comment.updatedAt || '');
  return Number.isFinite(at) ? at : null;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * One target's standing. Returns
 *   { due, finished, reason, nextAt, text }
 * where `reason` is a short code for tests and the pass, `nextAt` is the
 * moment a not-yet-due repeat becomes due (ms) or null, and `text` is the
 * sentence the screen shows.
 *
 * `comments` is every comment on THIS target, any status.
 */
function evaluateTarget({ target, comments, now, timeZone }) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const list = Array.isArray(comments) ? comments : [];
  const posted = list.map(postedTime).filter((t) => t !== null);
  const repeating = target.repeatMode === 'repeat';
  const maxTimes = repeating ? Number(target.repeatMaxTimes) : 1;
  const hasMax = Number.isFinite(maxTimes) && maxTimes > 0;

  if (target.status === 'paused') {
    return { due: false, finished: false, reason: 'paused', nextAt: null, text: 'Not due: paused' };
  }

  if (hasMax && posted.length >= maxTimes) {
    return {
      due: false,
      finished: true,
      reason: 'finished',
      nextAt: null,
      text: `Finished: posted ${posted.length} of ${maxTimes}`,
    };
  }

  let until = null;
  if (repeating && target.repeatUntil) {
    const end = Date.parse(`${target.repeatUntil}T23:59:59Z`);
    if (Number.isFinite(end)) until = end;
  }
  if (until !== null && now > until) {
    return {
      due: false,
      finished: true,
      reason: 'finished',
      nextAt: null,
      text: `Finished: repeats stopped on ${target.repeatUntil} (posted ${posted.length}${hasMax ? ` of ${maxTimes}` : ''})`,
    };
  }

  if (target.status === 'done') {
    return { due: false, finished: true, reason: 'done', nextAt: null, text: 'Not due: marked done' };
  }

  if (list.some((c) => c.status === 'draft')) {
    return { due: false, finished: false, reason: 'awaiting_approval', nextAt: null, text: 'Not due: waiting for your approval on the last draft' };
  }
  if (list.some((c) => WAITING_STATUSES.has(c.status))) {
    return { due: false, finished: false, reason: 'awaiting_post', nextAt: null, text: 'Not due: the approved comment has not been posted yet' };
  }

  if (repeating && posted.length) {
    const every = Number(target.repeatEveryDays);
    if (Number.isFinite(every) && every > 0) {
      const nextAt = Math.max(...posted) + every * DAY;
      if (until !== null && nextAt > until) {
        return {
          due: false,
          finished: true,
          reason: 'finished',
          nextAt: null,
          text: `Finished: the next repeat would fall after the stop date ${target.repeatUntil} (posted ${posted.length}${hasMax ? ` of ${maxTimes}` : ''})`,
        };
      }
      if (now < nextAt) {
        return { due: false, finished: false, reason: 'not_yet', nextAt, text: `Next draft: ${dateText(nextAt, zone)}` };
      }
    }
  }

  return { due: true, finished: false, reason: 'due', nextAt: null, text: 'Next draft: on the next scheduled pass' };
}

/**
 * How many drafts the account may still add today: the daily maximum, less
 * what already went out today, less what is already waiting anywhere on the
 * account. `accountComments` is every comment on the account, any status.
 */
function draftAllowance({ settings, accountComments, now, timeZone }) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const cap = Number(settings?.maxCommentsPerDay);
  const list = Array.isArray(accountComments) ? accountComments : [];
  const today = localDay(now, zone);
  const postedToday = list.map(postedTime).filter((t) => t !== null && localDay(t, zone) === today).length;
  const waiting = list.filter((c) => WAITING_STATUSES.has(c.status)).length;
  if (!Number.isFinite(cap)) return { allowance: 0, cap: null, postedToday, waiting };
  return { allowance: Math.max(0, cap - postedToday - waiting), cap, postedToday, waiting };
}

/**
 * The whole account's plan for one pass. Returns
 *   { draft: [target], held: [{ target, text }], verdicts: Map<id, verdict>, allowance }
 * `draft` is in the order the pass should write them; `held` is due targets
 * the daily maximum left for later, each with the sentence saying so.
 */
function planAccount({ targets, accountComments, settings, now, timeZone }) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const list = Array.isArray(accountComments) ? accountComments : [];
  const byTarget = new Map();
  for (const comment of list) {
    if (!byTarget.has(comment.targetId)) byTarget.set(comment.targetId, []);
    byTarget.get(comment.targetId).push(comment);
  }

  const verdicts = new Map();
  const due = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const verdict = evaluateTarget({ target, comments: byTarget.get(target.id) || [], now, timeZone: zone });
    verdicts.set(target.id, verdict);
    if (verdict.due) due.push(target);
  }
  due.sort((a, b) => {
    const rank = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    if (rank) return rank;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });

  const allowance = draftAllowance({ settings, accountComments: list, now, timeZone: zone });
  const draft = due.slice(0, allowance.allowance);
  const held = due.slice(allowance.allowance).map((target) => {
    const text = allowance.cap === null
      ? 'Not drafted: the daily maximum is not set'
      : `Not drafted yet: the daily maximum is ${plural(allowance.cap, 'comment')}, and ${allowance.postedToday} posted today plus ${allowance.waiting} waiting already fill it`;
    verdicts.set(target.id, { ...verdicts.get(target.id), text });
    return { target, text };
  });

  return { draft, held, verdicts, allowance };
}

module.exports = {
  WAITING_STATUSES,
  isValidTimeZone,
  localDay,
  evaluateTarget,
  draftAllowance,
  planAccount,
};
