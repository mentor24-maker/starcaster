'use strict';

/**
 * Throughput — making "alive but useless" detectable.
 *
 * WHY THIS EXISTS (2026-08-31, ticket 86bbqrw3p)
 * `npm run heartbeat` answers "did this job stop firing?". On 2026-08-31 the
 * build loop fired every hour, exited 0 every time, and did not move the
 * queue: 52 tickets queued, 1 in review, six rework PRs open with the oldest
 * sitting since Aug 25. Every gate was green and every green was honest.
 *
 * A heartbeat structurally cannot detect that. It measures LIVENESS, and the
 * loop was alive. Nothing in the system asked "is the queue getting shorter?"
 *
 * This is the same shape as the silence problem heartbeat was built for, one
 * level up — and worse in one specific way. A job that never fires writes
 * nothing at all, and nothing at least LOOKS like nothing. A loop that runs
 * and achieves nothing writes a full, cheerful log, which reads as health and
 * so stops anybody looking.
 *
 * FOUR STATES, NEVER TWO (docs/DOCTRINE.md 3.11)
 *   MOVING   tickets closed inside the window. The pipeline is delivering.
 *   IDLE     nothing closed, and there was nothing to close. Healthy, and it
 *            says WHY it is healthy rather than presenting a bare zero.
 *   STALLED  nothing closed while open work sat there. This is the finding.
 *   UNKNOWN  a reading needed for the verdict could not be taken. NEVER
 *            rendered as healthy — a monitor that fails quietly is worse than
 *            no monitor, because it converts "nobody is watching" into
 *            "something is watching" and then stops anybody looking.
 *
 * NOTHING HERE TOUCHES THE NETWORK OR THE CLOCK. Every decision is a pure
 * function over data the caller fetched, so `node --test` drives every branch
 * with no token, no ClickUp, no GitHub and no clock of its own. The IO lives
 * in scripts/loop_throughput.mjs.
 */

const wipCap = require('../scripts/builder/wipCap.js');
const loopStatuses = require('../scripts/builder/loopStatuses.js');
const { REPOST_EVERY_MS, dueAgain, ageText } = require('./nodeHeartbeat.js');

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back "nothing has closed" has to reach before it is a stall. */
const STALL_WINDOW_MS = DAY_MS;

/** How many days the report shows. A week, so a weekend reads as a weekend. */
const REPORT_DAYS = 7;

/**
 * Ticket statuses that mean the work is finished. Borrowed from wipCap rather
 * than re-listed — two files disagreeing about what "done" means is precisely
 * the drift that produced the incident next door (task 86bbq8br2), and this
 * module already depends on that one for the rework bucket.
 */
const TERMINAL_STATUSES = wipCap.TERMINAL_STATUSES;

// --- day buckets ------------------------------------------------------------

/**
 * A CALENDAR. Two paired questions — which day does this instant fall in, and
 * when does that day end — kept in one object so they cannot disagree.
 *
 * INJECTABLE ON PURPOSE. The report is read by a person in a timezone, so the
 * default is the machine's LOCAL day: a ticket closed at 8pm Eastern belongs
 * to that evening, not to the next UTC morning. But a test asserting local
 * days would pass or fail depending on the machine's TZ, which is a flake, so
 * every function here takes `calendar` and the tests hand it the UTC one.
 *
 * THE PAIRING IS THE POINT. The first draft bucketed closures by calendar day
 * and then measured the backlog curve at "this time of day, N days ago" — a
 * rolling 24h boundary wearing a calendar day's label. The two disagreed by up
 * to a day at every row, which is exactly the quiet wrongness this whole file
 * is about, so `end` is derived from the key rather than from an offset.
 */
const LOCAL_DAYS = {
  key(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },
  /** The first instant of the NEXT day — an exclusive upper bound. */
  end(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, m - 1, d + 1).getTime();
  },
};

const UTC_DAYS = {
  key(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  },
  end(key) {
    return Date.parse(`${key}T00:00:00.000Z`) + DAY_MS;
  },
};

/**
 * The `days` calendar days ending with the one `now` falls in, oldest first.
 *
 * Walked back through `end()` rather than by subtracting 24h a day at a time,
 * so a clock change cannot skip or repeat a day. `end(K) - DAY_MS` lands within
 * an hour of K's own start whichever way the clocks moved; a further 3 hours
 * back therefore cannot land anywhere but the day before.
 */
function dayWindow({ now, days = REPORT_DAYS, calendar = LOCAL_DAYS }) {
  const out = [calendar.key(now)];
  while (out.length < days) out.unshift(calendar.key(calendar.end(out[0]) - DAY_MS - 3 * 3600000));
  return out;
}

// --- reading the tickets ----------------------------------------------------

/**
 * When a ticket closed, in ms, or null.
 *
 * ClickUp hands `date_closed` back as a STRING of milliseconds, and an open
 * ticket carries `null` — or, on some payloads, the string "0". Both have to
 * read as "not closed": a 0 parsed as an instant is 1 January 1970, which
 * would silently drop off the far end of every window rather than erroring.
 */
function closedAt(task) {
  const raw = Number(task && task.date_closed);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** When a ticket was filed, in ms, or null. Same string-of-millis shape. */
function createdAt(task) {
  const raw = Number(task && task.date_created);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function statusOf(task) {
  return String(task?.status?.status ?? '').trim().toLowerCase();
}

/**
 * THE HEADLINE NUMBER: how many tickets reached a terminal status on each of
 * the last N days.
 *
 * Counted from `date_closed` rather than from a status field, because a status
 * is a fact about NOW and this question is about the past. The list only holds
 * tickets that still exist, so a deleted one is invisible here — which
 * undercounts, never over, and undercounting is the safe direction for a
 * stall detector.
 */
function closedPerDay({ tasks, now, days = REPORT_DAYS, calendar = LOCAL_DAYS } = {}) {
  const window = dayWindow({ now, days, calendar });
  const counts = new Map(window.map((d) => [d, 0]));
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const at = closedAt(t);
    if (at === null) continue;
    const key = calendar.key(at);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  return window.map((date) => ({ date, count: counts.get(date) }));
}

/** How many tickets closed in the `windowMs` ending at `now`. The stall test. */
function closedSince({ tasks, now, windowMs = STALL_WINDOW_MS } = {}) {
  const floor = now - windowMs;
  return (Array.isArray(tasks) ? tasks : []).filter((t) => {
    const at = closedAt(t);
    return at !== null && at >= floor && at <= now;
  }).length;
}

/**
 * The shape of the queue right now.
 *
 * `queued` is the headline depth the ticket asks to print — the work a build
 * loop can actually claim, which since task 86bbr1u9v is `Rework` AND `Queued`
 * (loop-build drains all of the first before any of the second). Counting a
 * rework ticket as "in flight" instead would be the worst possible reading
 * here: nothing is in flight on it, and the stall detector would report a
 * healthy pipeline while the send-backs rotted — which is the precise failure
 * the Rework status was created to end.
 *
 * `openWork` is every ticket that has not finished, and it is what gates the
 * verdict. "Nothing closed" is healthy only when there was NOTHING TO CLOSE,
 * and two tickets parked in review with an empty Queued column is emphatically
 * something to close — it is the exact shape of a merge side that has stopped.
 * Gating on `queued` alone would call that healthy.
 */
function queueShape(tasks) {
  const shape = { queued: 0, inFlight: 0, openWork: 0, closed: 0, total: 0, byStatus: {} };
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const status = statusOf(t);
    shape.total += 1;
    shape.byStatus[status || 'unknown'] = (shape.byStatus[status || 'unknown'] || 0) + 1;
    if (TERMINAL_STATUSES.includes(status)) { shape.closed += 1; continue; }
    shape.openWork += 1;
    if (loopStatuses.isClaimableByBuild(status)) shape.queued += 1;
    else shape.inFlight += 1;
  }
  return shape;
}

/**
 * THE BACKLOG CURVE: how deep the open queue stood at the end of each day.
 *
 * "A queue that is not shrinking over days is the actual signal; a single
 * depth reading is not" — and nothing in this system has ever recorded queue
 * depth over time. Rather than start a new state file that would be empty for
 * a week and lie for a day, the curve is RECONSTRUCTED from the two timestamps
 * every ticket already carries: it was open on day D if it was created on or
 * before D and had not closed by the end of D.
 *
 * WHAT THAT CANNOT SEE, said out loud rather than left to be discovered: a
 * ticket deleted or archived since is not in the list, so early days are
 * undercounted; and closure is the only transition it can reconstruct, so this
 * is the depth of OPEN WORK, not of the Queued column specifically. Both errors
 * point the same way — the real backlog was never smaller than this says.
 */
function depthPerDay({ tasks, now, days = REPORT_DAYS, calendar = LOCAL_DAYS } = {}) {
  const window = dayWindow({ now, days, calendar });
  const list = Array.isArray(tasks) ? tasks : [];
  const rows = window.map((date) => {
    // A true calendar boundary from the same object that produced the label,
    // capped at `now` so today's row reads "open right now" rather than
    // reaching into a future that has not happened yet.
    const endOfDay = Math.min(calendar.end(date), now);
    let open = 0;
    for (const t of list) {
      const born = createdAt(t);
      if (born === null || born > endOfDay) continue;
      if (undatedClosure(t)) continue;
      const died = closedAt(t);
      if (died !== null && died <= endOfDay) continue;
      open += 1;
    }
    return { date, open };
  });
  return rows;
}

/**
 * A ticket whose STATUS says it is finished but which carries no closure
 * timestamp. Treated as closed for the whole window.
 *
 * WHY, MEASURED (2026-08-31). The first live run printed "57 open" as the last
 * point of the curve directly above "56 open in total" — two numbers for the
 * same question, one report, disagreeing by one. The cause was a single real
 * ticket, 86bb4uyvp, sitting in `live` with `date_closed` empty. `queueShape`
 * reads the status and calls it closed; the curve read the timestamp, found
 * none, and called it open on every day forever.
 *
 * The status is the authoritative fact about NOW, so it wins — otherwise the
 * headline number and the curve's own last point contradict each other, which
 * is exactly the quiet disagreement this file was written against.
 *
 * The cost is that its history is unknown, so it is missing from EVERY day
 * rather than appearing until whenever it actually closed. That undercounts
 * the past by however many such tickets exist, which is why `undatedClosures`
 * counts them and the report says the number out loud rather than adjusting
 * silently.
 */
function undatedClosure(task) {
  return closedAt(task) === null && TERMINAL_STATUSES.includes(statusOf(task));
}

/** How many tickets the curve had to guess about. Printed, never hidden. */
function undatedClosures(tasks) {
  return (Array.isArray(tasks) ? tasks : []).filter(undatedClosure).length;
}

/**
 * How long the queue has been at or above where it stands now.
 *
 * Reported as a run of days rather than a single number because that is the
 * finding: 51 open today is a fact, and 51-or-more open every day for a week
 * is a diagnosis.
 */
function depthPlateau(curve) {
  const rows = Array.isArray(curve) ? curve : [];
  if (!rows.length) return { days: 0, since: null, depth: null };
  const depth = rows[rows.length - 1].open;
  let days = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].open < depth) break;
    days += 1;
  }
  return { days, since: rows[rows.length - days].date, depth };
}

// --- the rework bucket ------------------------------------------------------

/**
 * The oldest open pull request whose ticket is waiting to be re-claimed.
 *
 * TWO BUCKETS, ONE POPULATION (2026-08-31, task 86bbr1u9v). A send-back now
 * lands in its own status, `Rework`, so `classifyPrs` reports it there instead
 * of inferring it from the ticket being `Queued`. Both are counted here, and
 * that is not the conflation `wipCap` deliberately undid:
 *
 *   - `rework` is a send-back — the status says so.
 *   - `queued` with an open PR is the SAME shape read the old way, and it is
 *     what every existing ticket looks like until `clickup migrate-rework`
 *     runs after this ships.
 *
 * Reading only one of them would make this report say zero on the day the
 * status shipped, or zero on the day the tickets moved — a silent wrong answer
 * either side of the migration. The question this report asks is "what open
 * branch is nothing finishing", and both buckets answer it.
 *
 * THE BUCKETS ARE READ FROM `wipCap.classifyPrs`, NOT DERIVED A SECOND TIME.
 * That module already decides what counts as rework, and it decides it with
 * a page of reasoning and a test suite behind it. Task 86bbq8br2 is the
 * incident that argues for one reading of a shared question: two call sites
 * asked "is the merge side full?" in their own words and reached opposite
 * answers for a whole morning. Both were correct in isolation. They were
 * simply not the same reading, which is the failure that arrives silently.
 *
 * classifyPrs returns PR NUMBERS, so the ages are looked up against the same
 * list that was handed to it — the numbers are the bucket, the list is only
 * where `createdAt` lives.
 */
function reworkPrs({ prs, ticketStatusById, now } = {}) {
  const groups = wipCap.classifyPrs({ prs, ticketStatusById });
  const byNumber = new Map();
  for (const pr of Array.isArray(prs) ? prs : []) {
    if (pr && typeof pr === 'object') byNumber.set(pr.number, pr);
  }
  const rows = [...groups.rework, ...groups.queued].map((number) => {
    const pr = byNumber.get(number);
    const opened = Date.parse(pr?.createdAt ?? '');
    const ageMs = Number.isFinite(opened) ? now - opened : null;
    return { number, openedAt: Number.isFinite(opened) ? pr.createdAt : null, ageMs };
  });
  // Oldest first, and a PR whose age could not be read sorts LAST rather than
  // being dropped: it is still rework sitting open, and silently omitting it
  // would shrink the very number this report exists to show.
  rows.sort((a, b) => (b.ageMs ?? -1) - (a.ageMs ?? -1));
  const oldest = rows.find((r) => r.ageMs !== null) || null;
  return { rows, oldest, groups };
}

// --- the verdict ------------------------------------------------------------

/**
 * MOVING / IDLE / STALLED / UNKNOWN, with the reason in plain English.
 *
 * `loopsFiring` is TRI-STATE — true, false, or null for "could not tell" — and
 * it never turns a stall into a pass. The build loop has no beat emitter
 * (lib/nodeHeartbeat.js NOT_REPORTING_WHY), so on most machines this genuinely
 * cannot be answered, and a detector that required an answer it cannot get
 * would report nothing at all. What it changes is WHERE the reader is sent:
 * a stall with the loops firing is a pipeline problem, a stall with the loops
 * dead is a schedule problem and belongs to `npm run heartbeat`. Both are
 * stalls. A queue that is not shipping is not healthy because the reason for
 * it happens to live in another tool.
 */
function verdict({
  closedLast24h, queue, loopsFiring = null, windowMs = STALL_WINDOW_MS, unreadable = null,
} = {}) {
  if (unreadable) {
    return {
      state: 'UNKNOWN', exitCode: 2, stalled: false,
      why: `Could not tell whether the queue is moving — ${unreadable}. `
        + 'Reported as unknown rather than healthy on purpose: a green board nobody can justify '
        + 'is the failure this check exists to prevent.',
    };
  }

  const hours = Math.round(windowMs / 3600000);
  if (closedLast24h > 0) {
    return {
      state: 'MOVING', exitCode: 0, stalled: false,
      why: `${closedLast24h} ticket(s) reached Live in the last ${hours}h.`,
    };
  }

  if (!queue || queue.openWork === 0) {
    return {
      state: 'IDLE', exitCode: 0, stalled: false,
      why: `Nothing closed in the last ${hours}h, and there was nothing to close — no open work `
        + 'in the queue. This is healthy: a zero here is correct, not a stall.',
    };
  }

  const firing = loopsFiring === true
    ? 'The loops ARE firing, so the blockage is in the pipeline rather than the schedule.'
    : loopsFiring === false
      ? 'The loops do NOT appear to be firing either — start with `npm run heartbeat`, which '
        + 'covers the schedule half of this.'
      : 'Whether the loops fired could not be determined from here (the loop lanes have no beat '
        + 'emitter), so this says nothing about the schedule either way.';

  return {
    state: 'STALLED', exitCode: 1, stalled: true,
    why: `Nothing reached Live in the last ${hours}h while ${queue.openWork} ticket(s) sat open `
      + `(${queue.queued} queued, ${queue.inFlight} in flight). ${firing}`,
  };
}

// --- rendering --------------------------------------------------------------

function bar(count, max, width = 20) {
  if (!max) return '';
  return '█'.repeat(Math.max(count > 0 ? 1 : 0, Math.round((count / max) * width)));
}

/** The whole report, for a person at a terminal. */
function renderReport({ verdict: v, closed, curve, plateau, rework, queue, now, undated = 0 }) {
  const max = closed.reduce((m, d) => Math.max(m, d.count), 0);
  const lines = [];
  lines.push(`Throughput — is the queue getting shorter?  (${new Date(now).toISOString()})`);
  lines.push('');
  lines.push(`  ${v.state}`);
  lines.push(`  ${v.why}`);
  lines.push('');
  lines.push('Tickets closed per day');
  for (const d of closed) {
    lines.push(`  ${d.date}  ${String(d.count).padStart(3)}  ${bar(d.count, max)}`);
  }
  lines.push('');
  lines.push('Open work at the end of each day');
  for (const d of curve) lines.push(`  ${d.date}  ${String(d.open).padStart(3)}`);
  if (plateau.days > 1) {
    lines.push(`  → ${plateau.depth} or more open every day since ${plateau.since} (${plateau.days} days).`);
  }
  if (undated > 0) {
    // Said rather than silently absorbed: the curve treats these as closed for
    // the whole window, so the earlier days here read slightly LOW.
    lines.push(`  → ${undated} finished ticket(s) carry no closure date, so the earlier days are `
      + 'a little low. Today\'s row is exact.');
  }
  lines.push('');
  lines.push('Queue now');
  lines.push(`  ${queue.queued} queued, ${queue.inFlight} in flight, ${queue.openWork} open in total.`);
  lines.push('');
  lines.push('Rework pull requests (open, ticket waiting to be re-claimed)');
  if (!rework.rows.length) {
    lines.push('  none.');
  } else {
    for (const r of rework.rows) {
      lines.push(`  #${r.number}  ${r.ageMs === null ? 'age unknown' : `opened ${ageText(r.ageMs)}`}`);
    }
    if (rework.oldest) {
      lines.push(`  → the oldest was opened ${ageText(rework.oldest.ageMs)}.`);
    }
  }
  return lines.join('\n');
}

/**
 * The bus message for a stall. Written for somebody who was NOT already
 * suspicious — it names the number that is zero, the number that is not, and
 * the one command that says more.
 */
function renderStallPost({ verdict: v, closed, plateau, rework, queue, now, node = '' }) {
  const week = closed.reduce((s, d) => s + d.count, 0);
  const lines = [
    '🐌 **The queue is not getting shorter.**',
    '',
    v.why,
    '',
    `- ${week} ticket(s) closed across the last ${closed.length} days; **0** in the last 24h.`,
    `- ${queue.queued} queued, ${queue.inFlight} in flight.`,
  ];
  if (plateau.days > 1) {
    lines.push(`- ${plateau.depth} or more open every day since ${plateau.since} (${plateau.days} days).`);
  }
  if (rework.oldest) {
    lines.push(`- Oldest rework PR **#${rework.oldest.number}** was opened ${ageText(rework.oldest.ageMs)}.`);
  }
  lines.push(
    '',
    'Nothing failed and nothing went quiet — those alarms would have fired on their own. This is the',
    'other half: the loops ran, exited 0, and shipped nothing, which writes a cheerful log and reads',
    'as health.',
    '',
    'Look with:',
    '```',
    'npm run throughput            # this report in full',
    'npm run clickup -- wip-check  # is the merge side full?',
    'npm run heartbeat             # did anything stop firing?',
    '```',
    '',
    `_Noticed at ${new Date(now).toISOString()}${node ? ` by ${node}` : ''}. `
      + `Repeated at most once every ${Math.round(REPOST_EVERY_MS / 3600000)} hours until the queue moves._`,
    '',
    '— [CC-starcaster]',
  );
  return lines.join('\n');
}

module.exports = {
  DAY_MS,
  REPORT_DAYS,
  STALL_WINDOW_MS,
  TERMINAL_STATUSES,
  ageText,
  closedAt,
  closedPerDay,
  closedSince,
  createdAt,
  depthPerDay,
  depthPlateau,
  dueAgain,
  LOCAL_DAYS,
  UTC_DAYS,
  dayWindow,
  queueShape,
  undatedClosures,
  renderReport,
  renderStallPost,
  reworkPrs,
  verdict,
};
