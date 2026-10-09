'use strict';

/**
 * The account limits, checked BEFORE anything is posted (YouTube outreach 5/7,
 * task 86bcda68h). Pure: every input is passed in, including the clock, so the
 * tests can stand on any hour of any day and say exactly what the worker would
 * decide.
 *
 * Site-neutral on purpose. The worker core runs one adapter per site (YouTube
 * now, Substack Notes in 6/7), and each site's limits are its OWN — a busy
 * YouTube day must never use up Substack's allowance — so an adapter hands this
 * file its own settings and its own history, and nothing here knows which site
 * it is judging.
 *
 * TWO KINDS OF "WAIT", and the worker treats them differently:
 *
 *   account  — the daily maximum, the gap between comments, the active hours.
 *              These hold EVERY comment on the account, so the worker stops
 *              for this site until the next pass.
 *   item     — something about THIS comment (its video already has one, its
 *              target is paused, a repeat is not due yet). Only this comment
 *              waits; the worker looks at the next one. Without this split the
 *              oldest approved comment could hold the whole queue for ever.
 *
 * Every reason is a sentence Dane can read on the screen, naming the number or
 * the time that decided it (CLAUDE.md landmine 17: an empty or waiting state
 * that does not say why reads as a broken one).
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function isValidTimeZone(zone) {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day and the hour (0-23) at `atMs` in `timeZone`. */
function localParts(atMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(atMs));
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

/** "3:42pm" in the account's time zone. */
function clockText(atMs, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    .format(new Date(atMs))
    .replace(' AM', 'am')
    .replace(' PM', 'pm');
}

/** "Oct 15" in the account's time zone. */
function dateText(atMs, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(new Date(atMs));
}

function hourText(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  if (h === 0) return 'midnight';
  if (h === 12) return 'noon';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/**
 * Inside the active hours? Start inclusive, end exclusive. An end before the
 * start wraps past midnight (22 to 6 means overnight); equal means all day.
 */
function insideHours(hour, start, end) {
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/**
 * The random part of the gap between comments, FIXED PER COMMENT.
 *
 * Re-rolled on every pass, a 0-15 minute jitter would not be random spacing at
 * all: a pass every two minutes gets seven rolls at it, and the earliest one
 * that clears wins, so posts would bunch at the minimum gap. Deriving it from
 * the comment's id gives each comment one draw that stays put, which is what
 * "random variation" was meant to buy.
 */
function jitterMinutesFor(id, jitterMinutes) {
  const span = Math.max(0, Math.floor(Number(jitterMinutes) || 0));
  if (!span) return 0;
  let hash = 2166136261;
  for (const char of String(id || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % (span + 1);
}

/** When a row counts as having gone out: posted_at, or when posting started. */
function sentAt(row) {
  const at = Date.parse(row.postedAt || row.postingStartedAt || '');
  return Number.isFinite(at) ? at : null;
}

/**
 * Account-wide limits. `history` is every comment on this account that went
 * out or may have (posted AND posting). Returns `{ ok: true }` or
 * `{ ok: false, scope: 'account', reason }`.
 */
function checkAccountLimits({ settings, history, itemId, now, timeZone }) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const today = localParts(now, zone);
  const where = `(${zone})`;

  const start = Number(settings.activeStartHour);
  const end = Number(settings.activeEndHour);
  if (Number.isInteger(start) && Number.isInteger(end) && !insideHours(today.hour, start, end)) {
    return {
      ok: false,
      scope: 'account',
      reason: `Waiting for active hours — comments only go out between ${hourText(start)} and ${hourText(end)} ${where}.`,
    };
  }

  const times = (history || []).map(sentAt).filter((t) => t !== null);
  const cap = Number(settings.maxCommentsPerDay);
  if (Number.isFinite(cap)) {
    const usedToday = times.filter((t) => localParts(t, zone).day === today.day).length;
    if (usedToday >= cap) {
      return {
        ok: false,
        scope: 'account',
        reason: `Waiting for tomorrow's allowance — ${usedToday} of ${cap} comment${cap === 1 ? '' : 's'} a day already posted today ${where}.`,
      };
    }
  }

  const minGap = Math.max(0, Number(settings.minMinutesBetween) || 0);
  const gap = minGap + jitterMinutesFor(itemId, settings.jitterMinutes);
  const last = times.length ? Math.max(...times) : null;
  if (gap && last !== null && now - last < gap * MINUTE) {
    const nextAt = last + gap * MINUTE;
    return {
      ok: false,
      scope: 'account',
      reason: `Waiting for the gap between comments — the next can go out after ${clockText(nextAt, zone)} ${where} `
        + `(at least ${minGap} minutes apart, plus a little random extra).`,
    };
  }
  return { ok: true };
}

/**
 * Rules about THIS comment. `target` is its target video now (null if it was
 * removed); `videoHistory` is every posted/posting comment on the same video
 * for this account. Returns `{ ok: true }` or `{ ok: false, scope: 'item', reason }`.
 */
function checkItemRules({ settings, target, videoHistory, now, timeZone }) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  if (!target) {
    return { ok: false, scope: 'item', reason: 'Not posting: its video is no longer on the target list.' };
  }
  if (target.status !== 'active') {
    return { ok: false, scope: 'item', reason: `Waiting: this video's target is ${target.status}. Resume it to let this post.` };
  }

  const times = (videoHistory || []).map(sentAt).filter((t) => t !== null);
  if (!times.length) return { ok: true };

  if (target.repeatMode !== 'repeat') {
    if (settings.oneCommentPerVideo !== false) {
      return {
        ok: false,
        scope: 'item',
        reason: 'Not posting: there is already a comment on this video, and its target is not set to repeat.',
      };
    }
    return { ok: true };
  }

  const maxTimes = Number(target.repeatMaxTimes);
  if (Number.isFinite(maxTimes) && maxTimes > 0 && times.length >= maxTimes) {
    return {
      ok: false,
      scope: 'item',
      reason: `Not posting: this video has had ${times.length} of its ${maxTimes} repeat comment${maxTimes === 1 ? '' : 's'}.`,
    };
  }
  if (target.repeatUntil) {
    const until = Date.parse(`${target.repeatUntil}T23:59:59Z`);
    if (Number.isFinite(until) && now > until) {
      return { ok: false, scope: 'item', reason: `Not posting: this video's repeats stopped on ${target.repeatUntil}.` };
    }
  }
  const every = Number(target.repeatEveryDays);
  if (Number.isFinite(every) && every > 0) {
    const dueAt = Math.max(...times) + every * DAY;
    if (now < dueAt) {
      return {
        ok: false,
        scope: 'item',
        reason: `Waiting: this video repeats every ${every} day${every === 1 ? '' : 's'}; the next is due ${dateText(dueAt, zone)}.`,
      };
    }
  }
  return { ok: true };
}

module.exports = {
  checkAccountLimits,
  checkItemRules,
  jitterMinutesFor,
  insideHours,
  localParts,
  isValidTimeZone,
};
