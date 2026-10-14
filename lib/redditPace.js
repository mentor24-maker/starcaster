'use strict';

/**
 * Reddit's pace, per account (Reddit comments 4/4, task 86bch3jpg). There is
 * no settings form for it: these numbers ARE the setting. The Mini's worker
 * enforces them (workers/youtube-outreach/limits.js re-exports this) and the
 * Comments screen shows them (routes/redditComments.js). It lives in lib/
 * because served code may not reach workers/ (npm run check:vercel-bundle).
 *
 * NOT MEASURED: how fast Reddit lets a new account comment before its spam
 * filter starts hiding the comments or flags the account. So this is
 * deliberately low — three a day, at least twenty minutes apart, plus up to
 * ten minutes of random extra so they do not land on a clock. Raise it only on
 * evidence (comments that stayed up at this pace), never on a guess.
 * No active hours: none were asked for. "Today" is the project's time zone.
 */
const REDDIT_PACE = Object.freeze({
  maxCommentsPerDay: 3,
  minMinutesBetween: 20,
  jitterMinutes: 10,
});

module.exports = { REDDIT_PACE };
