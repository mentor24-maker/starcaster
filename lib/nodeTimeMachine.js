'use strict';

/**
 * When did Time Machine last actually FINISH a backup — on each machine that
 * is supposed to have one?
 *
 * WHY THIS EXISTS (ticket 86bbvr110, slice 5 of 86bbvqh4z)
 * Measured 2026-09-06 on the MacBook: the last completed Time Machine backup
 * was 2024-11-15. One attempt at 16% battery failed, the drive was never
 * plugged in again, and for twenty-two months every surface kept saying
 * backups were ON — System Settings, `AutoBackup = 1`, and a
 * `LastBackupActivity` stamp that is refreshed every night by attempts that
 * never complete. Nothing anywhere asked "when did one last SUCCEED?"
 * (docs/DOCTRINE.md §3.11: a check that cannot report what it could not
 * verify reports all-clear).
 *
 * This is the other backup from lib/nodeBackup.js, and the two are not the
 * same question. That one is the nightly, secrets-free copy of the few files
 * that exist on exactly one node. This one is the whole disk — Dane's
 * Desktop, his Downloads, everything that is NOT derived from a repo, Doppler
 * or Supabase — which on the laptop is most of what matters.
 *
 * WHERE THE ANSWER COMES FROM, AND WHERE IT DELIBERATELY DOES NOT
 * `tmutil latestbackup` is the obvious source and it is useless here, measured
 * 2026-09-21 on macOS 26.6.2: with the drive absent it printed
 * "Failed to mount backup destination ... Code=18" and EXITED 0. It also
 * cannot answer at all without mounting the drive, and a laptop's drive is
 * usually in a drawer. Time Machine keeps its own record of every completed
 * backup — `SnapshotDates` in its preferences — which reads fine with no drive
 * attached. So the verdict comes from that record, and `latestbackup` is kept
 * only to NAME a mount failure when there is one.
 *
 * The preferences file itself cannot be opened directly (macOS privacy
 * protection refuses `plutil` on it); `defaults export` goes through the
 * preferences daemon and is allowed. Measured, not assumed.
 *
 * UNPLUGGED IS NOT A FAILURE; OLD IS. For a USB drive, "cannot be mounted"
 * and "is not plugged in right now" are the same answer from macOS. Failing
 * on a mount error would fail every day the laptop travels — an alarm that is
 * ignored inside a week, which is worse than none. So the age of the last
 * COMPLETED backup decides, a mount failure is named as the reason when it
 * coincides with staleness, and it is never softened to CANNOT TELL: the
 * reading was taken and it was definite.
 *
 * NOTHING HERE TOUCHES A MACHINE. Every function is a pure decision over the
 * text a probe printed, so `node --test` drives every branch with no drive, no
 * ssh and no clock. The IO lives in scripts/doctor_node.mjs.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which machines are EXPECTED to have a Time Machine destination.
 *
 * A committed list rather than "whatever the machine has configured", because
 * the machine's own configuration is the thing that can go missing. A laptop
 * whose destination was removed would otherwise drop out of this check
 * silently — no destination, nothing to grade, no line printed. Being on this
 * list is what turns "none configured" into a FAIL.
 *
 * The Mac Mini is absent on purpose: its disaster copy is the nightly
 * `npm run backup:node` (lib/nodeBackup.js), because almost everything on it
 * is derived. If it ever gains a Time Machine destination it is still graded —
 * a configured destination is checked wherever it is found.
 */
const TIME_MACHINE_NODES = Object.freeze({
  'macbook-pro': 'Dane\'s working files live only on this disk — Desktop, Downloads and the archive consolidation (86bbvqh4z) — so a whole-disk backup is the only copy of them.',
});

/**
 * How old the last completed backup may be before it is a FAIL: 14 days.
 *
 * Derived, not picked — the lib/nodeHeartbeat.js discipline. A laptop's drive
 * legitimately spends days in a drawer, so the threshold has to be read off
 * how this laptop actually behaved while backing up was a working habit.
 * `SnapshotDates` from the MacBook, measured 2026-09-21, the healthy stretch
 * 2024-10-29 to 2024-11-15 (15 completed backups):
 *
 *   gap between consecutive completed backups
 *     typical   0.9 – 1.3 days   (plugged in roughly daily)
 *     longest   9.3 days         (2024-11-03 09:55 -> 2024-11-12 16:13)
 *
 *   14 days  =  the longest healthy gap (9.3 d) x 1.5, rounded up to whole weeks
 *
 * The 2022-12-30 -> 2024-10-29 gap (669 days) is excluded: that WAS the
 * failure, twice over, and a threshold fitted to it would never fire. When
 * slice 4 makes MaxOne the backup drive and there is fresh history, re-measure
 * against it — fifteen backups is a small sample, and it is the only one.
 */
const STALE_AFTER_MS = 14 * DAY_MS;

/**
 * The one-liner run on each machine. It ALWAYS exits 0 and carries every
 * sub-command's output between markers, because remoteProbe's `shell()`
 * discards the output of a command that exits non-zero — and a failing
 * `defaults export` is exactly the output this needs to see. `@@END` proves
 * the output was not cut short; without it the reading is CANNOT TELL.
 *
 * Full paths: a non-interactive ssh shell's PATH is not something to rely on
 * (the 2026-08-21 colima false alarm), and these three live in /usr/bin.
 */
const PROBE_COMMAND = [
  'echo @@DESTINATIONS',
  '/usr/bin/tmutil destinationinfo 2>&1',
  'echo @@LATEST',
  '/usr/bin/tmutil latestbackup 2>&1',
  'echo @@PREFS',
  '/usr/bin/defaults export /Library/Preferences/com.apple.TimeMachine - 2>&1',
  'echo @@END',
  'true',
].join('; ');

const MARKERS = ['@@DESTINATIONS', '@@LATEST', '@@PREFS', '@@END'];

/** Split the probe's output back into its sections. `complete` = @@END seen. */
function splitProbe(out) {
  const sections = {};
  let current = null;
  let complete = false;
  for (const line of String(out || '').split('\n')) {
    const marker = MARKERS.find((m) => line.trim() === m);
    if (marker === '@@END') { complete = true; current = null; continue; }
    if (marker) { current = marker.slice(2).toLowerCase(); sections[current] = []; continue; }
    if (current) sections[current].push(line);
  }
  const text = (k) => (sections[k] ? sections[k].join('\n').trim() : null);
  return { complete, destinations: text('destinations'), latest: text('latest'), prefs: text('prefs') };
}

/**
 * A small XML property-list reader — enough for Time Machine's preferences.
 * Returns null when the text is not a plist at all (an error message, say),
 * which the caller must treat as "could not read", never as "empty".
 */
function parsePlist(xml) {
  const text = String(xml || '');
  const start = text.indexOf('<plist');
  if (start === -1) return null;
  const tokens = text.slice(start).matchAll(/<(\/?)([A-Za-z]+)[^>]*?(\/?)>|([^<]+)/g);
  const stack = [{ kind: 'root', value: undefined }];
  let leaf = null; // { tag, text }

  const place = (value) => {
    const top = stack[stack.length - 1];
    if (top.kind === 'array') top.value.push(value);
    else if (top.kind === 'dict') { top.value[top.key] = value; top.key = undefined; }
    else top.value = value;
  };

  for (const [, closing, tag, selfClosing, chars] of tokens) {
    if (chars !== undefined) { if (leaf) leaf.text += chars; continue; }
    if (tag === 'plist' || tag === '?xml') continue;
    if (selfClosing) {
      if (tag === 'true') place(true);
      else if (tag === 'false') place(false);
      else if (tag === 'dict') place({});
      else if (tag === 'array') place([]);
      continue;
    }
    if (!closing) {
      if (tag === 'dict') stack.push({ kind: 'dict', value: {}, key: undefined });
      else if (tag === 'array') stack.push({ kind: 'array', value: [] });
      else leaf = { tag, text: '' };
      continue;
    }
    if (tag === 'dict' || tag === 'array') {
      const done = stack.pop();
      if (!done || done.kind !== tag) return null;
      place(done.value);
      continue;
    }
    if (!leaf || leaf.tag !== tag) continue;
    const raw = leaf.text.trim();
    leaf = null;
    if (tag === 'key') { stack[stack.length - 1].key = raw; continue; }
    if (tag === 'integer') place(Number.parseInt(raw, 10));
    else if (tag === 'real') place(Number.parseFloat(raw));
    else if (tag === 'date') place(new Date(raw));
    else if (tag === 'data') place(raw);
    else place(raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  const root = stack[0].value;
  return root && typeof root === 'object' && !Array.isArray(root) ? root : null;
}

/**
 * Every configured destination and its completed backups, from the parsed
 * preferences. `lastError` is Time Machine's own words for why the most recent
 * attempt stopped, when it recorded any — "Insufficient battery power
 * remaining (16%)" in the 2024 incident.
 */
function destinationsFrom(prefs) {
  const list = Array.isArray(prefs?.Destinations) ? prefs.Destinations : [];
  return list.map((d) => {
    const snapshots = (Array.isArray(d?.SnapshotDates) ? d.SnapshotDates : [])
      .map((x) => (x instanceof Date ? x.getTime() : Date.parse(x)))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const params = Array.isArray(d?.MessageParameters) ? d.MessageParameters.filter((p) => typeof p === 'string') : [];
    return {
      id: d?.DestinationID || '',
      name: d?.LastKnownVolumeName || d?.DestinationID || 'an unnamed destination',
      snapshots,
      lastError: params.length ? params.join('; ') : null,
    };
  });
}

function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'an unknown time';
  const hours = Math.round(ms / 3600000);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(ms / DAY_MS);
  if (days < 60) return `${days} days`;
  const months = Math.round(days / 30.4);
  return `${months} months`;
}

const dateText = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * THE VERDICT. Three states that grade, plus one that says "not asked":
 *
 *   PASS         a completed backup newer than the threshold.
 *   FAIL         the newest completed backup is older than the threshold, a
 *                destination has never completed one, or an EXPECTED machine
 *                has no destination at all. A mount failure is named here —
 *                never downgraded to CANNOT TELL.
 *   CANNOT TELL  the machine could not be reached, or it answered and its
 *                record could not be read. Never PASS, never FAIL.
 *   NOT EXPECTED a machine off TIME_MACHINE_NODES with no destination. Said
 *                out loud as a note, so its absence from the grading is
 *                visible rather than silent.
 *
 * @param {object}  opts
 * @param {string}  opts.machine    the node being graded
 * @param {object}  opts.probe      remoteProbe `shell()` result: {ran, ok, out, why}
 * @param {boolean} opts.expected   is `machine` on TIME_MACHINE_NODES?
 * @param {number}  [opts.now]
 * @param {number}  [opts.staleAfterMs]
 */
function timeMachineReport({ machine, probe, expected, now = Date.now(), staleAfterMs = STALE_AFTER_MS }) {
  const who = machine || 'this machine';
  const fixPlug = (name) => `Plug in ${name} (on mains power) and run: tmutil startbackup --auto --block`;

  // Unreachable: asleep, travelling, no route. Not a failure of the backup —
  // a machine that is off is not evidence of anything (the ticket's trap).
  if (!probe || probe.ran === false) {
    return {
      state: 'CANNOT TELL',
      headline: `${who}: cannot tell when Time Machine last backed it up.`,
      why: probe?.why || 'the machine could not be asked.',
      fix: `Run npm run doctor:node on ${who} itself, or check again when it is awake.`,
    };
  }

  const parts = splitProbe(probe.out);
  if (!parts.complete || parts.destinations == null || parts.prefs == null) {
    return {
      state: 'CANNOT TELL',
      headline: `${who}: cannot tell when Time Machine last backed it up.`,
      why: probe.ok === false
        ? 'the probe ran but failed or timed out before it could print anything.'
        : 'the probe\'s output was cut short, so Time Machine\'s record was never fully read.',
    };
  }

  const noneConfigured = /No destinations configured/i.test(parts.destinations);
  const prefs = parsePlist(parts.prefs);
  const mountFailed = /Failed to mount/i.test(parts.latest || '');

  if (noneConfigured) {
    if (!expected) {
      return {
        state: 'NOT EXPECTED',
        headline: `${who}: no Time Machine destination, and none is expected (its copy is the nightly backup above).`,
      };
    }
    return {
      state: 'FAIL',
      headline: `${who}: has no Time Machine destination at all.`,
      why: `This machine is expected to have one (lib/nodeTimeMachine.js, TIME_MACHINE_NODES): ${TIME_MACHINE_NODES[machine] || ''}`.trim(),
      fix: 'System Settings → General → Time Machine → Add Backup Disk',
    };
  }

  if (!prefs) {
    // Destinations exist but their record could not be parsed — a privacy
    // refusal, a changed format. We did not see a date, so we do not grade one.
    const said = parts.prefs.split('\n')[0].slice(0, 160);
    return {
      state: 'CANNOT TELL',
      headline: `${who}: a Time Machine destination is configured, but its record of completed backups could not be read.`,
      why: `defaults export answered: "${said}"`,
    };
  }

  const dests = destinationsFrom(prefs);
  if (dests.length === 0) {
    return {
      state: 'CANNOT TELL',
      headline: `${who}: tmutil lists a destination, but Time Machine's record names none.`,
      why: 'The two sources disagree, so neither is trusted for a date.',
    };
  }

  // The newest completed backup to ANY destination — one fresh copy is a copy.
  let best = null;
  for (const d of dests) {
    const last = d.snapshots[d.snapshots.length - 1];
    if (last !== undefined && (!best || last > best.at)) best = { at: last, dest: d };
  }
  const names = dests.map((d) => d.name).join(', ');
  const errors = dests.filter((d) => d.lastError).map((d) => `${d.name}: "${d.lastError}"`);
  const reasons = [];
  if (mountFailed) reasons.push(`the destination cannot be mounted right now (tmutil: "Failed to mount backup destination")`);
  if (errors.length) reasons.push(`Time Machine's last recorded error — ${errors.join('; ')}`);
  const reasonText = reasons.length ? ` Why, as far as the machine can say: ${reasons.join('; and ')}.` : '';

  if (!best) {
    return {
      state: 'FAIL',
      headline: `${who}: Time Machine is set up (${names}) but has never completed a backup.`,
      why: `Settings that say backups are on are not a backup.${reasonText}`,
      fix: fixPlug(dests[0].name),
    };
  }

  const ageMs = now - best.at;
  const line = `${who}: last completed Time Machine backup ${ageText(ageMs)} ago (${dateText(best.at)}, to ${best.dest.name}).`;
  if (ageMs > staleAfterMs) {
    return {
      state: 'FAIL',
      headline: line,
      why: `Older than the ${Math.round(staleAfterMs / DAY_MS)}-day threshold.${reasonText}`,
      fix: fixPlug(best.dest.name),
      ageMs,
    };
  }
  return {
    state: 'PASS',
    headline: line,
    why: mountFailed ? `${best.dest.name} is not attached right now — fine inside the ${Math.round(staleAfterMs / DAY_MS)}-day window.` : null,
    ageMs,
  };
}

module.exports = {
  PROBE_COMMAND,
  STALE_AFTER_MS,
  TIME_MACHINE_NODES,
  destinationsFrom,
  parsePlist,
  splitProbe,
  timeMachineReport,
};
