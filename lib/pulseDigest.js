'use strict';

/**
 * What a SCHEDULED pulse does with what the pulse found.
 *
 * WHY THIS EXISTS (task 86bbqz7rg)
 * `npm run pulse` was built, reviewed, shipped and declared Live in phase 1
 * (86bbm9h60), and then never ran, because no schedule was ever created for
 * it. Its own closing line says the quiet part out loud:
 *
 *   PULSE COMPLETE <timestamp> — if a scheduled run does not print this line,
 *   that absence IS the alert
 *
 * There was no scheduled run, so the absence was permanent and alerted nobody.
 * Run by hand on 2026-08-31 it had two live alarms and a notice in it, none of
 * which anybody had seen. That is the cost of the gap, measured before a line
 * of this was written.
 *
 * WHAT THIS FILE IS
 * The scheduled half needs three decisions, and every one of them is the kind
 * that is easy to get subtly wrong and impossible to notice afterwards:
 *
 *   1. what reaches the bus, and what only reaches the durable record
 *   2. how a finding is identified across runs, so it is announced once and
 *      not every hour
 *   3. when a stamp may be cleared, so a fault that returns is announced again
 *
 * All three are pure functions over the JSON `scripts/pulse.cjs --json`
 * already produces. Nothing here touches the network, reads a clock of its
 * own, or writes a file — the IO lives in `scripts/pulse_publish.mjs`, and the
 * READING lives in `scripts/pulse.cjs`, which has no write path at all and
 * must keep it that way (its own header is the contract).
 *
 * THE DESTINATION, AND WHY IT IS NOT THE BUS
 * The pulse prints on every run — rule 1, silence is never an all-clear. A
 * scheduled job posting a full clean report to the bus daily is 365 messages a
 * year, and a channel nobody reads is the same as no channel. The house
 * pattern already answers this and is followed rather than reinvented: the
 * heartbeat rewrites a ClickUp ticket in place and posts only on a miss;
 * `report_job_failure.mjs` suppresses to one post per job per window, cleared
 * by the next success. So:
 *
 *   the FULL report      -> a durable ticket, rewritten in place, every run
 *   alarms + cannot-tells -> the bus, once per finding per 6 hours
 *   notices              -> the ticket only
 *
 * A COULD-NOT-TELL IS NOT A PASS, and it reaches the bus for that reason
 * (docs/DOCTRINE.md §3.11). A watchdog that goes quiet exactly when it cannot
 * see is worse than no watchdog, because its silence reads as health.
 */

const pulse = require('../scripts/builder/pulse.js');

/**
 * The durable record's identity is its NAME, exactly as the roll call's and
 * the pause switch's are. An id in an env var is a shortcut, never the
 * definition — a shortcut pointing at a deleted task must fall back to the
 * name rather than report the record missing.
 */
const DIGEST_TASK_NAME = 'Pipeline pulse';

/** Only these reach the bus. `notice` is real, and it is not urgent. */
const ANNOUNCED = new Set(['alarm', 'cannot-tell']);

/**
 * The sections a run can measure, and therefore the scopes whose stamps a run
 * is entitled to clear. Keyed by the prefix on every stamp that section owns.
 *
 * This pairing is the whole of decision 3 above. Clearing a stamp for a
 * section that could NOT be read this pass would announce the same finding
 * again the moment the source came back — noise. Never clearing it turns a
 * six-hour suppression window into a permanent one, which is silence. Both are
 * failures; only one of them is visible.
 */
const SCOPES = ['a1', 'a2', 'b1', 'queue'];

/**
 * A run may only clear stamps for a scope that is on that list. It is not
 * decoration: without it the list documented itself as authoritative and
 * decided nothing, so a scope invented by a typo — `measured.add('b2')` — would
 * have been honoured silently. `announcements` is pinned to the list by a test,
 * so a genuinely new section is added in one place and fails loudly if it is
 * not added here too.
 */
function isClearableScope(scope) {
  return SCOPES.includes(String(scope || ''));
}

function truncate(text, max) {
  const s = String(text == null ? '' : text);
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** A stamp filename has to survive a filesystem, and a key has to survive
 *  being split back apart. Both are done here so only one file knows the shape. */
function stampFileName(key) {
  return `${String(key).replace(/[^a-z0-9:.-]/gi, '-')}.stamp`;
}

function scopeOfKey(key) {
  return String(key || '').split(':')[0];
}

/**
 * Everything in this run that must reach the bus, plus which sections were
 * actually measured.
 *
 * IT MIRRORS `pulse.tally()` ON PURPOSE, and a test pins them together: if a
 * future section is added to the tally and not to this, the pulse would count
 * an alarm in its summary line and never announce it — a check that reports a
 * problem to a ticket nobody has open. The test compares the two counts on
 * every fixture rather than trusting the reading of this comment.
 *
 * ONE DELIBERATE DIFFERENCE, stated rather than hidden: `queueError` is
 * announced here and is NOT counted by `tally()`. A total ClickUp outage
 * therefore renders as "0 alarm(s), 0 notice(s), 0 could-not-tell" in the
 * pulse's own summary while two of its three sections saw nothing at all. That
 * is a real defect in `tally()`/`exitCodeFor()` and it is not this ticket's to
 * fix (86bbt6hgx, "A check that could not run must not exit 0", is already
 * filed for that shape). What matters here is that the SCHEDULED pass must not
 * inherit it — so the publisher decides from these items, never from the
 * pulse's exit code.
 */
function announcements(result) {
  const items = [];
  const measured = new Set();
  const noOp = result?.noOp || null;
  const job = String(result?.job || 'loop-build');

  const add = (key, scope, severity, title, detail) => {
    items.push({ key, scope, severity, title, detail: String(detail || '') });
  };

  // ── A1: is the build loop claiming? ───────────────────────────────────────
  if (noOp) {
    if (noOp.sourceError) {
      // The log could not be opened. On a machine that does not run the loop
      // that is expected — and it is still not an all-clear, because "no log"
      // and "the loop never claimed" are the same bytes.
      add(`a1:${job}:source`, 'a1', 'cannot-tell',
        `the ${job} log could not be read`, noOp.sourceError);
    } else {
      measured.add('a1');
      if (noOp.verdict === 'finding') {
        add(`a1:${job}:stalled`, 'a1', 'alarm', `${job} is not claiming`, noOp.message);
      } else if (noOp.verdict === 'cannot-tell') {
        add(`a1:${job}:unreadable`, 'a1', 'cannot-tell',
          `whether ${job} is claiming could not be told`, noOp.message);
      }
      for (const u of noOp.unterminated || []) {
        // `start` is the pass's identity and the only stable part of its
        // message — the rest carries an age that changes every hour, which
        // would defeat suppression entirely.
        const id = String(u.start || u.message || '').slice(0, 40);
        if (u.state === 'hung') {
          add(`a1:${job}:hung:${id}`, 'a1', 'alarm', `a ${job} pass hung`, u.message);
        } else if (u.state === 'cannot-tell') {
          add(`a1:${job}:pass:${id}`, 'a1', 'cannot-tell',
            `a ${job} pass could not be classified`, u.message);
        }
      }
    }
  }

  // ── A2: is anything sitting too long in a stage? ──────────────────────────
  if (result?.residency) {
    measured.add('a2');
    for (const f of result.residency.findings || []) {
      if (f.severity !== 'alarm') continue; // notices live on the ticket only
      add(`a2:${f.taskId}:${f.status}`, 'a2', 'alarm',
        `${f.taskId} is stuck in ${f.status}`, f.message);
    }
    for (const c of result.residency.cannotTell || []) {
      add(`a2:${c.taskId}:unreadable`, 'a2', 'cannot-tell',
        `${c.taskId}'s age could not be measured`, c.reason);
    }
  }

  // ── B1: does every ticket and its PR name the other? ──────────────────────
  if (result?.drift) {
    measured.add('b1');
    for (const f of result.drift.findings || []) {
      if (f.severity !== 'alarm') continue;
      add(`b1:${f.taskId}:${f.shape}${f.pr ? `:${f.pr}` : ''}`, 'b1', 'alarm',
        `${f.taskId}: ticket and PR disagree`, f.message);
    }
    for (const c of result.drift.cannotTell || []) {
      add(`b1:${c.taskId}:unreadable`, 'b1', 'cannot-tell',
        `${c.taskId}'s PR link could not be read`, c.reason);
    }
  }

  // ── the source everything else rests on ───────────────────────────────────
  if (result?.queueError) {
    add('queue:unreadable', 'queue', 'cannot-tell',
      'the Loop Queue could not be read at all', String(result.queueError));
  } else if (result?.residency || result?.drift) {
    measured.add('queue');
  }

  const order = { alarm: 0, 'cannot-tell': 1 };
  items.sort((a, b) => (order[a.severity] - order[b.severity]) || a.key.localeCompare(b.key));
  return { items: items.filter((i) => ANNOUNCED.has(i.severity)), measured: [...measured] };
}

/**
 * Which stamps this run has earned the right to delete.
 *
 * Only stamps whose SECTION was measured, and which this run did not raise.
 * A section that could not be read keeps its stamps: we did not observe the
 * finding going away, and "I could not look" is not "it is fixed".
 */
function staleStampKeys(existingKeys, { items, measured }) {
  const live = new Set((items || []).map((i) => i.key));
  const canClear = new Set((measured || []).filter(isClearableScope));
  return (existingKeys || []).filter(
    (key) => canClear.has(scopeOfKey(key)) && !live.has(key),
  );
}

/**
 * The same rule again, at the boundary where the stamps are actually FILES.
 *
 * `clearStale` in the publisher used to reimplement `staleStampKeys` over
 * filenames, which is the shape where a test proves a function nothing runs:
 * the two agreed, so nothing was broken, but changing the rule in the tested
 * function would have passed CI and changed no behaviour. Now the publisher
 * reads the directory, calls this, and deletes what it returns — no decision
 * of its own left.
 *
 * The comparison happens in the STORED form on both sides, because
 * `stampFileName` sanitises and sanitising is one-way. That matters for a real
 * key, not a hypothetical one: an A1 hung-pass key carries the pass's start
 * time, `a1:loop-build:hung:2026-09-01 03:00:00`, and those spaces become
 * dashes on disk. Comparing a raw key against a stored name would find no
 * match, decide the finding had gone away, and clear the stamp of an alarm
 * that is still live — re-announcing it every hour.
 */
function stampNamesToClear({ onDiskNames, items, measured }) {
  const stored = (items || []).map((i) => ({ key: stampFileName(i.key).replace(/\.stamp$/, '') }));
  return staleStampKeys(onDiskNames || [], { items: stored, measured });
}

/**
 * Which of this run's items are due to be posted, and which are held.
 *
 * One window per FINDING rather than per run: a second problem appearing an
 * hour after the first is announced at once instead of being swallowed by the
 * first one's window. Same rule the heartbeat, the failure alert and the
 * stale-ready check all use.
 */
function duePosts({ items, stamps, now, everyMs }) {
  const due = [];
  const held = [];
  for (const item of items || []) {
    const lastAt = (stamps instanceof Map ? stamps.get(item.key) : (stamps || {})[item.key]) || '';
    const then = Date.parse(lastAt);
    if (!lastAt || !Number.isFinite(then) || now - then >= everyMs) due.push(item);
    else held.push(item);
  }
  return { due, held };
}

// --- the pause switch, and the two different things exit 3 can mean ---------
//
// `npm run pipeline -- check` exits 3 for BOTH "paused" and "the switch could
// not be read", on purpose: both must lead to writing nothing. That is right,
// and it is not the whole story for a job that runs unattended every hour.
//
// A PAUSED pass is healthy. It took a full reading and correctly stayed quiet.
// A pass that could not READ the switch is a muzzled watchdog: left as a quiet
// exit 0 it publishes nothing, every hour, indefinitely, `report_job_failure`
// never fires, and the only thing that eventually notices is the 25-hour roll
// call — which would announce that this job stopped firing, sending the next
// reader to launchd instead of to the switch.
//
// Both functions are here, rather than inline in the publisher, for the reason
// the reviewer gave about `staleStampKeys`: a rule that only exists inside a
// script is a rule nothing can break-test.

/**
 * Read the verdict out of what `pipeline.mjs check --json` actually did.
 *
 * `certain: false` covers both unreadable shapes the switch reports — a failed
 * ClickUp read, and a trail so truncated that a "still paused" reminder
 * arrived without the pause it refers to. Neither is a pause; both are this
 * job unable to tell.
 */
function switchVerdict({ error = null, signal = null, status = 0, stdout = '', stderr = '', timeoutMs = 0 } = {}) {
  const unreadable = (why) => ({ paused: true, readable: false, why });
  if (error) {
    const timedOut = error.code === 'ETIMEDOUT' || Boolean(signal);
    return unreadable(timedOut
      ? `the pipeline switch did not answer within ${Math.round((timeoutMs || 0) / 60000)} minutes and was killed`
      : `the pipeline switch could not be read (${error.message || error})`);
  }
  // The verdict is the LAST line that parses. Anything printed before it — a
  // token warning, a usage line — is not the answer.
  let verdict = null;
  for (const line of String(stdout || '').trim().split('\n').reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.paused === 'boolean') { verdict = parsed; break; }
    } catch { /* not the verdict line */ }
  }
  if (!verdict) {
    const said = String(stderr || stdout || '').trim().split('\n')[0];
    return unreadable(`the pipeline switch check exited ${status} without a readable verdict`
      + `${said ? ` — ${said}` : ''}`);
  }
  const said = String(verdict.message || '').trim().split('\n')[0];
  if (verdict.certain === false) return unreadable(said || 'the pipeline switch could not be read');
  return { paused: Boolean(verdict.paused), readable: true, why: said };
}

/**
 * What the pass does about it. Three outcomes, and the middle one is the fix:
 *
 *   running        publish, beat, exit 0
 *   paused         publish nothing, BEAT, exit 0 — a complete pass that stayed
 *                  quiet. Without the beat, Dane holding the deck for a day
 *                  makes the roll call announce that this job has gone quiet
 *                  while it is running perfectly.
 *   unreadable     publish nothing, do NOT beat, exit 1, loudly — the pass did
 *                  not complete, and a beat would certify a blind watchdog as
 *                  healthy.
 */
function switchOutcome({ readable = true, paused = false } = {}) {
  if (readable === false) return { publish: false, beat: false, exit: 1, loud: true };
  if (paused) return { publish: false, beat: true, exit: 0, loud: false };
  return { publish: true, beat: true, exit: 0, loud: false };
}

/**
 * A pass that found things and DELIVERED NONE OF THEM is not a pass.
 *
 * Round 3's send-back (2026-09-02): the bus post was wrapped in a try/catch
 * that logged the failure and then fell through to the heartbeat and `exit 0`.
 * So a run that took a full reading, found six alarms and delivered nothing
 * ended as: exit 0, beat recorded, `report_job_failure.mjs` never fired, and
 * the roll call showing this job alive and well. Twenty-four hours of that —
 * ClickUp's write limit is a rolling 24h window, and the bus chat has had
 * outages (2026-08-23) — is "alive but useless" reading as healthy, which is
 * the exact shape CLAUDE.md names: a job that runs but ships nothing has to
 * say so too.
 *
 * `writeDigest` failing already exits 1, because the record is the artifact.
 * The bus post is the ALERT, and failing to deliver the alert is not the
 * smaller of the two failures. So it takes the same verdict, and takes it in
 * BOTH currencies at once, because they surface on different clocks:
 *
 *   exit 1   -> `report_job_failure.mjs` posts within the hour (and writes a
 *               local log line even when the bus is the thing that is down).
 *   no beat  -> the roll call notices at the 25h mark, which is the surface
 *               that survives the bus being unreachable for a whole day.
 *
 * What is NOT changed here is the suppression stamp: a failed send is still
 * never recorded as sent, so the next hourly run retries and a transient
 * failure heals itself. That half was right. It is the SUSTAINED failure that
 * had no surface at all.
 *
 *   nothing due   delivered, trivially — there was nothing to deliver.
 *   delivered     beat, exit 0.
 *   undelivered   do NOT beat, exit 1, loudly.
 */
function deliveryOutcome({ due = 0, delivered = true, why = '' } = {}) {
  if (due > 0 && delivered === false) {
    return {
      beat: false,
      exit: 1,
      loud: true,
      why: `${due} finding(s) were found and NONE of them reached the bus`
        + `${why ? ` — ${why}` : ''}.`,
    };
  }
  return { beat: true, exit: 0, loud: false, why: '' };
}

/**
 * Did the durable record actually LAND?
 *
 * A ClickUp description write that normalises to nothing returns a clean 200
 * (docs/DOCTRINE.md §3.10), and this write REPLACES the whole field — so a
 * silent truncation loses the previous run's report as well as this one's.
 * The record is the only artifact this job produces; an `ok` from the PUT is
 * not evidence it exists. So the publisher reads it back, and this decides
 * what the reading means.
 *
 * Three outcomes, and the middle one is the point:
 *
 *   landed        non-empty and close enough in size. ClickUp normalises
 *                 markdown on save, so an exact match is the WRONG test; a
 *                 large shortfall is not normalisation, it is loss.
 *   did not land  empty, or a fraction of what was sent. Fatal: a record that
 *                 looks finished and is not is worse than no record, because
 *                 the next reader stops looking.
 *   not verified  the write returned ok and the READ-BACK failed. Reported
 *                 loudly and treated as a complete pass, deliberately: the
 *                 write itself succeeded, the next hourly run rewrites the
 *                 ticket anyway, and failing here would stop this pass posting
 *                 the alarms it just found. Suppressing real alarms to punish
 *                 an unverifiable read is the worse of the two failures. It is
 *                 never silent — silence is what the doctrine forbids, not
 *                 carrying on with the gap named.
 */
function digestWriteVerdict({ sent = '', readBack = null, readable = true, why = '' } = {}) {
  const wanted = String(sent || '').trim().length;
  if (readable === false) {
    return {
      ok: true,
      verified: false,
      why: 'the record was written, but reading it back to check it landed failed'
        + `${why ? ` — ${why}` : ''}. The report above is real; whether the ticket now holds it is UNVERIFIED.`,
    };
  }
  const saved = String(readBack || '').trim();
  if (!saved) {
    return {
      ok: false,
      verified: true,
      why: 'the record reads back EMPTY. The write returned ok and wiped the ticket — '
        + `${wanted} characters were sent and nothing is there.`,
    };
  }
  // Below 60% of what was sent is loss, not ClickUp's markdown normalisation.
  // The same threshold `clickup_direct.mjs describe` uses, for the same reason.
  if (wanted > 0 && saved.length < wanted * 0.6) {
    return {
      ok: false,
      verified: true,
      why: `the record reads back TRUNCATED: ${wanted} characters sent, ${saved.length} read back.`,
    };
  }
  return { ok: true, verified: true, why: '' };
}

/** The bus message. Written for somebody who was not already suspicious. */
function renderPulsePost({ items, node, now, everyMs, digestUrl = '' }) {
  const alarms = (items || []).filter((i) => i.severity === 'alarm');
  const cannot = (items || []).filter((i) => i.severity === 'cannot-tell');
  const lines = [];

  lines.push('🩺 **The pipeline pulse found something.**', '');
  if (alarms.length) {
    lines.push(`**${alarms.length} alarm${alarms.length === 1 ? '' : 's'}**`);
    for (const a of alarms) lines.push(`- ${truncate(a.detail || a.title, 300)}`);
    lines.push('');
  }
  if (cannot.length) {
    lines.push(`**${cannot.length} could-not-tell** — not an all-clear; these are readings that could not be taken.`);
    for (const c of cannot) lines.push(`- ${truncate(c.detail || c.title, 300)}`);
    lines.push('');
  }

  lines.push('Notices are not repeated here — the full report, including them, is rewritten on');
  lines.push(digestUrl ? `every run at ${digestUrl}` : `every run on the "${DIGEST_TASK_NAME}" ticket.`);
  lines.push('');
  lines.push('Look yourself with:', '```', 'npm run pulse', '```', '');
  lines.push(
    `_Noticed at ${new Date(now).toISOString()}${node ? ` by ${node}` : ''}. `
    + `Each finding is repeated at most once every ${Math.round(everyMs / 3600000)} hours until it clears._`,
  );
  lines.push('', '— [CC-starcaster]');
  return lines.join('\n');
}

/**
 * The durable record: the WHOLE report, rewritten in place every run.
 *
 * Nothing reads this back — unlike the roll call, which merges rows from two
 * machines, a pulse run is a complete reading and simply replaces the last
 * one. So there is no data block to parse and no way for a rendered table and
 * a hidden payload to drift apart.
 *
 * The findings are repeated ABOVE the fenced report as well as inside it,
 * because ClickUp renders a description in a wide column and a long fence is
 * still something you have to scroll. What is wrong should be readable without
 * scrolling; the report underneath is the evidence for it.
 */
function renderDigest({ result, report, items, node, now, everyMs, cadenceText = 'every hour' }) {
  const announced = items || [];
  // THE HEADLINE IS COUNTED FROM THE ANNOUNCED ITEMS, NOT FROM `tally()`.
  //
  // Everything else in the publisher goes out of its way not to trust
  // `tally()`, because it does not count `queueError` (86bbt6hgx). The
  // headline used to trust it anyway, so a total Loop Queue outage rendered as
  // "0 alarm(s), 0 notice(s), 0 could-not-tell" directly above a CANNOT TELL
  // line saying the queue could not be read at all — a contradiction on the
  // one surface a person actually scans. Notices still come from `tally()`,
  // which is the only place they are counted; they are not part of that gap.
  const alarms = announced.filter((i) => i.severity === 'alarm').length;
  const cannotTell = announced.filter((i) => i.severity === 'cannot-tell').length;
  const { notices } = pulse.tally(result || {});
  const lines = [];

  lines.push(`The **${DIGEST_TASK_NAME}**. Do not build this, do not close it, do not delete it.`, '');
  lines.push('This is what `npm run pulse` found on its last scheduled run. It is rewritten in place');
  lines.push(`${cadenceText}, so there is exactly one of it and it is always current — a clean pipeline`);
  lines.push('does not post 365 messages a year to say so.', '');
  lines.push('Alarms and could-not-tells also go to the bus, once each per '
    + `${Math.round(everyMs / 3600000)} hours until they clear. Notices stay here.`, '');

  lines.push(`### ${alarms} alarm(s), ${notices} notice(s), ${cannotTell} could-not-tell`, '');
  lines.push('_A could-not-tell is not a pass._', '');

  if (!announced.length) {
    lines.push('Nothing was announced this run.', '');
  } else {
    for (const i of announced) {
      const tag = i.severity === 'alarm' ? '**ALARM**' : '**CANNOT TELL**';
      lines.push(`- ${tag} — ${i.detail || i.title}`);
    }
    lines.push('');
  }

  lines.push('### The full report', '');
  lines.push('_Generated on every run — edit nothing here; the next run overwrites all of it._', '');
  lines.push('```');
  lines.push(String(report || '').trimEnd());
  lines.push('```', '');
  lines.push(`_Written ${new Date(now).toISOString()}${node ? ` by ${node}` : ''}._`, '');
  return lines.join('\n');
}

module.exports = {
  ANNOUNCED,
  DIGEST_TASK_NAME,
  SCOPES,
  announcements,
  isClearableScope,
  deliveryOutcome,
  digestWriteVerdict,
  duePosts,
  renderDigest,
  renderPulsePost,
  scopeOfKey,
  stampNamesToClear,
  staleStampKeys,
  stampFileName,
  switchOutcome,
  switchVerdict,
};
