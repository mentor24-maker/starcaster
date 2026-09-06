'use strict';

/**
 * The reboot test — did this machine's jobs come back after it restarted?
 *
 * WHY THIS EXISTS (NODES Slice D, principle P5, ticket 86bbq893p)
 * `doctor:node` shipped covering identity, toolchain, repos, config and
 * schedules. It did not cover the one acceptance item vault
 * `doctrine/NODES.md` §5 names: restart the machine, then confirm the roles
 * came back — reported as CANNOT TELL until it has been run since the last
 * restart.
 *
 * That check is the one behind the FileVault decision (ClickUp doc
 * `2kydhxeu-754`, page 1). Scheduled jobs on macOS are USER jobs: they do not
 * start until somebody logs in. On an always-on box with FileVault on and no
 * automatic login, a 3am power blip leaves the Mac sitting at a login screen
 * with every scheduled job stopped and nothing anywhere reporting it. The
 * machine looks fine. `launchctl list` shows nothing wrong, because nothing is
 * loaded to be wrong. The failure is SILENCE, and silence is what the rest of
 * Slice D was built to make impossible.
 *
 * THE BOOT IDENTITY IS THE THING COMPARED, NOT A TIMESTAMP
 * A "last verified" date somebody has to remember to update is a date that
 * goes stale silently. `sysctl -n kern.boottime` gives the machine's own
 * statement of when it last started, so a restart invalidates the record on
 * its own with nobody having to notice.
 *
 * THE RECORD CARRIES THE OBSERVATIONS, NOT A VERDICT
 * This is acceptance criterion 3 and it is the whole point: a green tick
 * written by the code path that was SUPPOSED to check is the failure mode this
 * slice exists against. So `recordVerification` refuses to write a record that
 * carries no per-role rows, and `rebootTestReport` re-derives PASS or FAIL
 * from those rows every time it is read. There is no boolean anywhere that a
 * script could set by reaching the end of itself.
 *
 * A PASS IS MEASURED AGAINST WHAT THE MACHINE OWNS, NOT AGAINST THE RECORD
 * The record is evidence, never the standard. Grading the rows against
 * themselves means a record covering three roles on a machine that owns six
 * reports "all owned roles came back" — which is what this file did until
 * round 2 of ticket 86bbq893p, on the Mini, about the exact three roles a 3am
 * power blip is most likely to take out. So `rebootTestReport` is handed
 * `nodeProvision.schedulesForNode()` and compares: an owned probeable role
 * absent from the record is CANNOT TELL naming it, and an owned role with no
 * schedule at all is named on the PASS line rather than omitted from the
 * count. The same shape `lib/nodeHeartbeat.js` settled — a role with no
 * emitter reports NOT REPORTING with its reason, never as healthy.
 *
 * BOTH VERDICTS COME OFF ONE INTERSECTION — OWNED **AND** PROBEABLE
 * Grading against ownership was applied to the PASS count first and to nothing
 * else, so three ways to reach a verdict nobody earned survived round 2 of
 * ticket 86bbq893p:
 *   - a green `0 of 2 owned roles confirmed`, on a machine whose every role
 *     had lost its schedule, naming the same role as Observed and as Not
 *     checked in one sentence;
 *   - a PERMANENT failure naming a role this Mac does not run, because FAIL
 *     still filtered `record.roles` and never asked what the machine owns;
 *   - a CANNOT TELL on `macbook-pro` whose fix line was a command that refuses
 *     that machine (exit 2), so one of the two known nodes could never clear
 *     it.
 * So the record's rows are intersected ONCE with the probeable inventory, and
 * PASS, FAIL and the drift case all read off that. A row outside it is stale:
 * named in the `why`, counted in neither. A PASS needs at least one confirmed
 * role, and a machine with nothing probeable gets its own sentence rather than
 * an instruction that would be refused — the same sentence
 * `scripts/verify_node_roles.mjs` already writes, so the read half and the
 * write half agree instead of pointing at each other.
 *
 * WHAT THE WRITE HALF REFUSES, THE READ HALF REFUSES TOO
 * Round 3 found the two halves of this file disagreeing about what a record
 * is. `recordVerification` validated every row on the way in;
 * `readVerification` validated the record's shape and stopped at the edge of
 * the list; `rebootTestReport` then read `row.role` off each row. One `null`
 * row threw a TypeError, and because `doctor_node.mjs` prints its whole report
 * with a single `console.log` on its last line, ALL SIX of its sections went
 * with it — the command CLAUDE.md calls "read-only, safe anywhere" answered
 * with a stack trace, on the morning this section exists for. Separately,
 * `recordVerification` would write `node: ""` for a caller with no node name
 * and the copied-record guard read `record.node && record.node !== node`, so
 * an UNATTRIBUTED record — the shape with the least claim on this machine of
 * any — skipped the guard and was graded as its own.
 * Both are one rule now: the write half and the read half share `observationProblem`
 * and `skippedProblem`, neither will produce or accept a record that cannot
 * name its machine, and the verdict re-checks the rows itself because it is
 * also fed records directly. A crash is not one of the three states.
 *
 * THE CROSS-MACHINE HALF LIVES IN SLICE E, DELIBERATELY
 * Doctrine says "confirm FROM ANOTHER MACHINE", and it is right that a machine
 * which cannot log in also cannot report on itself. That mechanism already
 * exists and is Slice E: `lib/nodeHeartbeat.js` records a beat on every
 * successful run and `scripts/run_bus_relay.sh` runs the staleness check
 * BEFORE it asks whether it owns the relay — so the non-owning machine, which
 * is awake every ten minutes doing nothing, is the vantage point that survives
 * the owning machine being dead. Building a second cross-machine mechanism
 * here would be two watchdogs disagreeing quietly. What this file adds is the
 * half the heartbeat structurally cannot do: stand ON the machine and say
 * whether its roles have been confirmed since the current boot.
 *
 * THREE STATES, NEVER TWO (docs/DOCTRINE.md §3.11)
 *   pass    verified after the CURRENT boot, and every role came back.
 *   fail    verified after the current boot, and something did not come back.
 *   unknown not verified since this boot — the default, and the honest answer.
 *
 * NOTHING HERE TOUCHES THE NETWORK OR SHELLS OUT. Every decision is a pure
 * function over data the caller read, so `node --test` drives every branch
 * with no machine state of its own. The IO lives in
 * `scripts/verify_node_roles.mjs` and `scripts/doctor_node.mjs`.
 *
 * NO MACHINE IS NAMED HERE (NODES P1). Paths derive from os.homedir().
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// --- reading the machine's boot identity ------------------------------------

/**
 * How far two readings of `kern.boottime` may differ and still be the same
 * boot.
 *
 * Not zero, and the reason is macOS-specific: `kern.boottime` is stored as an
 * absolute wall-clock instant rather than counted from uptime, so when NTP
 * corrects the clock the kernel adjusts it by the same amount. Demanding exact
 * equality would report a machine that merely re-synced its clock as having
 * restarted.
 *
 * Sixty seconds, and the direction of the error is chosen on purpose: drift
 * larger than this reads as "restarted", which costs a spurious CANNOT TELL —
 * never a spurious PASS. A tolerance wide enough to absorb every conceivable
 * drift would be wide enough to swallow a fast reboot, and a false PASS here
 * is exactly the silence the check exists to break.
 */
const SAME_BOOT_TOLERANCE_S = 60;

/**
 * Parse `sysctl -n kern.boottime`, whose output looks like:
 *
 *   { sec = 1787381676, usec = 445740 } Sat Aug 22 00:54:36 2026
 *
 * Only `sec` is read. The trailing human date is the same instant rendered for
 * a reader, and parsing prose that the OS is free to reword is how a check
 * starts reporting on its own formatting.
 */
function parseBootTime(text) {
  const raw = String(text == null ? '' : text);
  // The lookbehind is load-bearing: `usec` ENDS in `sec`, so the obvious
  // pattern reads `{ usec = 445740 }` as a boot 445,740 seconds after the
  // epoch — a confident, completely wrong instant from a reading that had no
  // `sec` field at all. Caught by its own test before it could ship.
  const m = raw.match(/(?<![A-Za-z])sec\s*=\s*(\d+)/);
  if (!m) {
    return { ok: false, why: `kern.boottime did not contain a "sec =" field (got ${JSON.stringify(raw.slice(0, 120))})` };
  }
  const sec = Number(m[1]);
  if (!Number.isFinite(sec) || sec <= 0) {
    return { ok: false, why: `kern.boottime reported an impossible instant (${m[1]})` };
  }
  return { ok: true, sec, at: new Date(sec * 1000).toISOString() };
}

/** Are two boot readings the same boot? Missing readings are never "same". */
function isSameBoot(a, b, toleranceS = SAME_BOOT_TOLERANCE_S) {
  const left = Number(a && a.sec);
  const right = Number(b && b.sec);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= toleranceS;
}

// --- reading a schedule's status --------------------------------------------

/**
 * Read one `install_*.sh --status` block.
 *
 * Shared with `doctor_node.mjs` on purpose. The reboot test and the SCHEDULES
 * section are answering the same question about the same text a few lines
 * apart, and two copies of a regex are two answers waiting to disagree.
 */
function parseScheduleStatus(text) {
  const raw = String(text == null ? '' : text);
  return {
    installed: /schedule:\s+INSTALLED/.test(raw),
    loaded: /loaded:\s+yes/.test(raw),
  };
}

// --- one fact, read the same way everywhere ---------------------------------

/**
 * The ONE expression for "this role did not come back".
 *
 * It is a named function rather than an inline test because it was written
 * twice and the two copies disagreed: `verify_node_roles.mjs` printed a row's
 * prefix off `row.loaded` alone while its summary counted `!installed ||
 * !loaded`. A plist deleted without unloading — the state
 * `install_bus_relay.sh --uninstall` explicitly handles — is
 * `{installed: false, loaded: true}`, so the table said `ok  bus-relay: loaded`
 * under a line saying one role did not come back, naming nothing. The operator
 * was handed a contradiction and no way to resolve it.
 *
 * A row is only good if it is BOTH installed and loaded, and anything that is
 * not literally `true` is not good — an observation that arrived as a string,
 * or absent, is not evidence a schedule survived a restart.
 */
function didNotComeBack(row) {
  return !row || row.installed !== true || row.loaded !== true;
}

/**
 * Why a role is in the state it is, in the SAME words wherever it is printed.
 *
 * Shared for the same reason as `didNotComeBack`: the verdict's `why` and
 * node:verify's table are describing one observation, and two vocabularies for
 * one fact is how a reader ends up comparing two screens instead of reading
 * one.
 */
function describeRole(row) {
  if (!row) return 'no observation was recorded';
  if (row.installed !== true && row.loaded === true) {
    return 'launchd still has it loaded, but the schedule is not installed — the plist was deleted without unloading, so it will be gone at the next restart';
  }
  if (row.installed !== true) return 'schedule not installed';
  if (row.loaded !== true) return 'schedule installed but launchd has not loaded it';
  return 'loaded';
}

/**
 * One row of `npm run node:verify`'s table.
 *
 * It lives here, beside the summary's own test, so the prefix and the count
 * cannot drift apart again — that drift is not catchable by reading two files
 * a hundred lines apart, and it shipped once already.
 */
function roleTableLine(row) {
  return `  ${didNotComeBack(row) ? 'FAIL' : 'ok  '}  ${(row && row.role) || '(unnamed role)'}: ${describeRole(row)}`;
}

/**
 * What this machine OWNS, split into what can be probed and what cannot.
 *
 * Takes `lib/nodeProvision.js`'s `schedulesForNode()` output. The split is the
 * whole point of grading against ownership rather than against the record: a
 * role with no installer yet (`blocked`) or no schedule on purpose (`manual`)
 * is a role no verification can speak for, and one that is silently omitted is
 * a role nobody will ever ask about again.
 *
 * Returns `{ ok: false, why }` rather than guessing when the list is not a
 * usable inventory — "I do not know what this machine owns" cannot come out as
 * a pass.
 */
/**
 * The first sentence of a reason, for the line a reader scans.
 *
 * The inventory's reasons in `lib/nodeProvision.js` run to several sentences
 * each — deliberately, because `provision:node` prints them in full and they
 * carry the ticket that unblocks the row. Three of them end to end turn this
 * verdict's detail line into a paragraph nobody reads, which is its own way of
 * hiding a role. The name and the gist go here; the full text stays one
 * command away.
 */
function firstSentence(text) {
  const raw = String(text == null ? '' : text).trim();
  const stop = raw.search(/[.?!](\s|$)/);
  return stop === -1 ? raw : raw.slice(0, stop + 1);
}

function ownedInventory(owned) {
  if (!Array.isArray(owned)) {
    return { ok: false, why: 'the list of roles this machine owns was not supplied, so a pass could only be measured against the record grading itself' };
  }
  const probeable = [];
  const unprobeable = [];
  for (const job of owned) {
    if (!job || typeof job.role !== 'string' || !job.role) {
      return { ok: false, why: 'the list of roles this machine owns contains a row with no role name' };
    }
    if (job.blocked) unprobeable.push({ role: job.role, why: String(job.blocked) });
    else if (job.manual) unprobeable.push({ role: job.role, why: String(job.why || 'no schedule, on purpose') });
    else probeable.push(job.role);
  }
  return { ok: true, probeable, unprobeable, total: probeable.length + unprobeable.length };
}

// --- where the verification is recorded -------------------------------------

/**
 * Alongside the heartbeat stamps, and for the same reason: this is a fact
 * about the MACHINE, not about the code. A worktree is deleted when its thread
 * ships, and a verification that vanished with it would report a machine that
 * has been confirmed as unconfirmed.
 */
function verificationDir(homedir = os.homedir()) {
  return path.join(homedir, 'Library', 'Application Support', 'starcaster', 'heartbeat');
}

function verificationFile(homedir = os.homedir()) {
  return path.join(verificationDir(homedir), 'role-verification.json');
}

/**
 * Is this row a usable role observation, and if not, what is wrong with it?
 *
 * ONE definition, read by the write half, the read half AND the verdict, for
 * exactly the reason `didNotComeBack` and `describeRole` are shared: three
 * spellings of "a usable row" is how two halves of one module come to
 * disagree without either one being wrong on its own.
 *
 * They disagreed here. `recordVerification` refused every shape below on the
 * way in, `readVerification` checked none of them on the way out, and
 * `rebootTestReport` — which dereferences `row.role` while grading — took the
 * difference as a crash rather than a verdict. `doctor_node.mjs` builds its
 * whole report in memory and prints it with a single `console.log` on its last
 * line, so one `null` in the `roles` list of a file in Application Support
 * discarded ALL SIX sections: identity, toolchain, repos, config, schedules and
 * the reboot test, leaving the npm banner and a stack trace. The command
 * CLAUDE.md calls "read-only, safe anywhere" answered nothing at all — on the
 * morning after the 3am power blip this whole section exists to catch.
 *
 * Acceptance criterion 4: an unreadable record is CANNOT TELL, never a pass. A
 * crash is neither. Returns the sentence to say, or null when the row is fine.
 */
function observationProblem(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return 'a role observation in the record is not an observation at all';
  }
  if (typeof row.role !== 'string' || !row.role) {
    return 'a role observation has no role name';
  }
  if (typeof row.installed !== 'boolean' || typeof row.loaded !== 'boolean') {
    return `the observation for "${row.role}" does not say whether it was installed and loaded`;
  }
  return null;
}

/**
 * The same question for a `skipped` row, which states a role that was NOT
 * probed and why.
 *
 * Nothing reads `record.skipped` back off disk today — `verify_node_roles.mjs`
 * prints the list it just computed, not the stored one. It is validated on
 * both sides anyway, because "nothing calls it that way yet" is the reasoning
 * round 1 was sent back over, and because a reader who finds `roles` guarded
 * and `skipped` not guarded has to work out which of the two is the mistake.
 */
function skippedProblem(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return 'a skipped row in the record is not a row at all';
  }
  if (typeof row.role !== 'string' || !row.role) {
    return 'a skipped row has no role name';
  }
  if (typeof row.why !== 'string' || !row.why) {
    return `the skipped row for "${row.role}" does not say why it was not checked`;
  }
  return null;
}

/**
 * Write a verification.
 *
 * REFUSES a record with no observed rows, and that refusal is the mechanism
 * behind acceptance criterion 3. There is deliberately no way to record "I
 * verified this machine" without handing over what was actually seen, role by
 * role — so a caller cannot stamp a pass by reaching its own last line.
 *
 * `skipped` carries the roles that were NOT probed and why, so the record is a
 * full statement of what was looked at rather than only of what answered. A
 * record that lists three roles on a machine owning six is indistinguishable,
 * on its own, from a machine that owns three — and that ambiguity read as
 * "all 3 owned roles came back" on this Mini while the two loop lanes and the
 * media worker were never checked at all.
 */
function recordVerification({ node, boot, roles, skipped, at, homedir = os.homedir(), write = fs } = {}) {
  // WHOSE MACHINE IS THIS A RECORD OF — refused, not defaulted.
  //
  // This used to write `String(node || '')`, so a caller with no node name
  // produced a record attributed to nobody, and the reading half graded an
  // unattributed record as this machine's own (round 3). `verify_node_roles.mjs`
  // refuses an unknown node before it ever gets here, so nothing in this repo
  // writes that shape today — which is precisely the "nothing calls it that way
  // yet" that round 1 was sent back over. The two halves agree now: neither one
  // will produce a record that cannot name its machine, and neither one will
  // accept it.
  if (typeof node !== 'string' || !node) {
    return { ok: false, why: 'no node name was supplied, so the record could not say which machine it describes' };
  }
  if (!boot || !Number.isFinite(Number(boot.sec))) {
    return { ok: false, why: 'no boot identity was supplied, so there is nothing a later run could compare against' };
  }
  if (!Array.isArray(roles) || roles.length === 0) {
    return { ok: false, why: 'no role observations were supplied — a verification that saw nothing proves nothing' };
  }
  for (const row of roles) {
    const problem = observationProblem(row);
    if (problem) return { ok: false, why: problem };
  }

  if (skipped != null) {
    if (!Array.isArray(skipped)) {
      return { ok: false, why: 'the skipped rows were supplied as something other than a list' };
    }
    for (const row of skipped) {
      const problem = skippedProblem(row);
      if (problem) return { ok: false, why: problem };
    }
  }

  const record = {
    node: String(node),
    boot: { sec: Number(boot.sec), at: boot.at || new Date(Number(boot.sec) * 1000).toISOString() },
    at: at || new Date().toISOString(),
    roles: roles.map((r) => ({ role: r.role, installed: r.installed, loaded: r.loaded })),
    skipped: (skipped || []).map((r) => ({ role: r.role, why: r.why })),
  };

  try {
    write.mkdirSync(verificationDir(homedir), { recursive: true });
    write.writeFileSync(verificationFile(homedir), `${JSON.stringify(record, null, 2)}\n`);
    return { ok: true, record, file: verificationFile(homedir) };
  } catch (err) {
    return { ok: false, why: String(err && err.message), file: verificationFile(homedir) };
  }
}

/**
 * Read the last verification.
 *
 * A missing file and an unreadable one are DIFFERENT answers, exactly as they
 * are for a heartbeat stamp. "Never verified" is a fact about this machine;
 * "the file is corrupt" is a thing we could not read. Both come out as CANNOT
 * TELL upstairs, but they get different sentences, because only one of them is
 * fixed by deleting a file.
 */
function readVerification({ homedir = os.homedir(), read = fs } = {}) {
  const file = verificationFile(homedir);
  let raw;
  try {
    raw = read.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { found: false, readable: true, file };
    return { found: false, readable: false, file, why: String(err && err.message) };
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch (err) {
    return { found: false, readable: false, file, why: `the record is not JSON — ${String(err && err.message)}` };
  }
  if (!record || typeof record !== 'object') {
    return { found: false, readable: false, file, why: 'the record is not an object' };
  }
  if (!record.boot || !Number.isFinite(Number(record.boot.sec))) {
    return { found: false, readable: false, file, why: 'the record carries no boot identity, so it cannot be aged' };
  }
  if (!Array.isArray(record.roles)) {
    return { found: false, readable: false, file, why: 'the record carries no role observations' };
  }
  // THE ROWS THEMSELVES, checked here rather than trusted downstream.
  //
  // Everything above validates the record's SHAPE and stops at the edge of the
  // list; the verdict then reads `row.role` off every row in it. A file in
  // Application Support that anything may have written was deciding whether
  // `doctor:node` printed a report or a stack trace. `observationProblem` is
  // the write half's own test, so a record this repo could not have written is
  // now a record it will not grade.
  for (const row of record.roles) {
    const problem = observationProblem(row);
    if (problem) return { found: false, readable: false, file, why: problem };
  }
  // Records written before `skipped` existed are read, not rejected: what they
  // are missing is a note about roles nobody probed, and the verdict now
  // derives that from what the machine OWNS rather than from the record. A
  // `skipped` list that is PRESENT and malformed is a different thing from an
  // absent one, and gets the same refusal the rows get.
  if (!Array.isArray(record.skipped)) record.skipped = [];
  for (const row of record.skipped) {
    const problem = skippedProblem(row);
    if (problem) return { found: false, readable: false, file, why: problem };
  }
  return { found: true, readable: true, file, record };
}

// --- the verdict ------------------------------------------------------------

/**
 * Have this machine's roles been verified since it last restarted?
 *
 * Pure. Everything it needs is passed in: the machine's current boot reading,
 * whatever `readVerification` returned, this machine's node name, and the
 * roles this machine OWNS (`nodeProvision.schedulesForNode()`).
 *
 * `owned` is not optional, and that is the fix for the first way this reported
 * a pass it had not earned. It used to grade whatever rows the record happened
 * to carry and never ask what the machine was supposed to be running, so on
 * this Mini — which owns six roles, three of them with no installer yet — a
 * three-role record printed "All 3 owned roles came back". The morning after a
 * 3am power blip is exactly when the two loop lanes have certainly NOT come
 * back, and the section written to catch that morning would have named none of
 * them. Absent `owned`, the honest answer is CANNOT TELL: a record cannot be
 * the standard it is graded against.
 *
 * Returns `{ state, headline, why, fix, roles }` where `state` is one of
 * `pass` / `fail` / `unknown` — the same three the report prints, never two.
 */
function rebootTestReport({ boot, stored, node, owned } = {}) {
  const unknown = (headline, why, fix) => ({ state: 'unknown', headline, why, fix, roles: [] });
  const plural = (n, one, many) => (n === 1 ? one : many);
  // Every detail line here is several findings end to end, and each of them is
  // built somewhere else in this function. Joining them by hand put a stale-row
  // sentence hard against the end of a not-checked list — `youtube-media
  // (Installing it needs ...) pulse-pipelines is in the record, but ...` — so a
  // role this machine had STOPPED owning read as a fourth one it owns and
  // cannot check. The FAIL line had the same seam. This is the only joiner:
  // hand it finished sentences, and empty ones fall out rather than leaving a
  // double space where a finding would have been.
  const sentences = (...parts) => parts
    .map((part) => String(part == null ? '' : part).trim())
    .filter(Boolean)
    .join(' ');

  // WHICH MACHINE IS THIS — asked first, because every other answer here is a
  // statement ABOUT a named machine.
  //
  // `doctor_node.mjs` used to pass `node: null` for an unrecognised machine,
  // which disarmed the copied-record guard below (`if (node && ...)`) and let
  // the grading run to a pass. That is backwards: on a machine this system
  // cannot identify, the only verification record that could exist is one
  // copied from another Mac, so the guard was switched off in precisely the
  // case it was standing there for. `npm run node:verify` already refuses an
  // unknown node outright (exit 2); the reading half refuses for the same
  // reason. CLAUDE.md: "A machine whose name is not recognised does not
  // quietly skip; it refuses out loud."
  if (typeof node !== 'string' || !node) {
    return unknown(
      'This machine does not know which node it is, so its roles cannot be confirmed.',
      'A verification record cannot be attributed to a machine with no recognised name, and "the roles this machine owns" '
        + 'has no answer without one — so a record sitting here is most likely one copied from another Mac. '
        + 'npm run node:verify refuses an unknown node for the same reason (exit 2).',
      'npm run node:whoami      # then write the right name: echo <node-name> > ~/.alphire-node',
    );
  }

  // WHAT DOES THIS MACHINE OWN — asked before any evidence is read, because
  // ownership is a fact about the named machine and no record can change it.
  //
  // Only the zero-probeable verdict returns from here. The rest of the
  // inventory's problems are reported further down, after the record's own,
  // because "you have never verified this machine" is a better sentence than
  // "I do not know what you own".
  const inventory = ownedInventory(owned);

  // NOTHING HERE A REBOOT COULD TAKE AWAY. `macbook-pro` owns exactly two
  // roles — `db-refresh`, which deliberately has no schedule, and
  // `pulse-pipelines`, whose installer is another slice — so it has nothing
  // probeable at all. Until this branch existed, one of the two known nodes
  // got a CANNOT TELL telling it to run `npm run node:verify`, and
  // `verify_node_roles.mjs` refuses that machine (exit 2) with this very
  // sentence. A fix line that refuses is worse than no fix line: it reads as
  // a step somebody skipped. The read half now agrees with the write half.
  if (inventory.ok && inventory.probeable.length === 0) {
    const named = inventory.unprobeable.length
      ? ` — ${inventory.unprobeable.map((u) => `${u.role} (${firstSentence(u.why)})`).join(', ')}`
      : '';
    return unknown(
      'Nothing on this machine has a schedule a reboot could take away.',
      `${node} owns ${inventory.total} role${plural(inventory.total, '', 's')}, and not one of them has a schedule that can be probed${named}. `
        + 'There is nothing here to verify, and npm run node:verify refuses this machine for the same reason (exit 2). '
        + 'This is not a pass: nothing to check is not checked.',
      'npm run node:whoami      # what this machine is and what it may run',
    );
  }

  if (!boot || !Number.isFinite(Number(boot.sec))) {
    return unknown(
      'Cannot tell whether this machine\'s roles have been verified since it restarted.',
      (boot && boot.why) || 'This machine\'s boot time could not be read, so there is nothing to compare a record against.',
      'sysctl -n kern.boottime      # if this answers, the reading is fixable; if not, say so rather than assuming',
    );
  }

  if (!stored || (!stored.found && stored.readable)) {
    return unknown(
      'This machine\'s roles have never been verified since the reboot test was added.',
      `No verification record exists at ${(stored && stored.file) || verificationFile()}. `
        + 'This is the default and the honest answer — never a pass.',
      'npm run node:verify      # probes every owned schedule and records what it saw',
    );
  }

  if (!stored.readable) {
    return unknown(
      'This machine\'s role verification could not be read.',
      `${stored.why || 'unknown reason'} — an unreadable record is not a passing one.`,
      `rm ${stored.file}  &&  npm run node:verify`,
    );
  }

  const record = stored.record;

  // A RECORD THAT CANNOT SAY WHOSE IT IS.
  //
  // The guard below used to read `if (node && record.node && record.node !==
  // node)`, and that middle clause let the missing case through to a PASS: a
  // record with `node: ""` or no `node` at all skipped the comparison entirely
  // and was graded as this machine's own. It is the wrong way round. By this
  // module's own reasoning the likeliest way any record is sitting here is that
  // somebody copied an Application Support folder between Macs, so a record
  // that names NO machine is at least as suspect as one naming another — it
  // simply has less to say for itself. `node` is a non-empty string by the
  // identity guard at the top of this function, so the `node &&` clause was
  // dead as well; both are gone.
  if (typeof record.node !== 'string' || !record.node) {
    return unknown(
      'The verification record on this machine does not say which machine it describes.',
      sentences(
        `This machine calls itself ${node}, and nothing in the record says it is about this one.`,
        'A record that cannot name its own machine is no more this machine\'s than one naming another Mac is —',
        'the likeliest way for either to be here is a folder copied between them.',
      ),
      `rm ${stored.file}  &&  npm run node:verify`,
    );
  }

  // A record from another machine. Possible the moment somebody copies an
  // Application Support folder between Macs, which is exactly the mistake the
  // Claude-memory check in doctor:node already exists to catch one floor down.
  if (record.node !== node) {
    return unknown(
      `The only verification record on this machine belongs to ${record.node}.`,
      `This machine calls itself ${node}. A record copied from another Mac says nothing about this one's schedules.`,
      `rm ${stored.file}  &&  npm run node:verify`,
    );
  }

  if (!isSameBoot(boot, record.boot)) {
    return unknown(
      'This machine has restarted since its roles were last verified.',
      `Verified at ${record.at} against a boot of ${record.boot.at}; this machine booted at ${boot.at}. `
        + 'Scheduled jobs are user jobs — with FileVault on and no automatic login, they do not start until '
        + 'somebody logs in, and a machine sitting at a login screen looks exactly like a quiet one.',
      'npm run node:verify      # run it on the machine, after logging in',
    );
  }

  // Same boot, and a record that got past `recordVerification` — so it carries
  // rows. The guard stays anyway: this function is also fed records off disk,
  // which anything may have written, and a vacuous "all zero roles came back"
  // is the shape of a pass that checked nothing.
  if (record.roles.length === 0) {
    return unknown(
      'The verification on this machine observed no roles at all.',
      'A record with no role rows cannot distinguish "everything came back" from "nothing was looked at".',
      'npm run node:verify',
    );
  }

  // AND THE ROWS ARE RE-CHECKED HERE, for the same reason as the guard above
  // it: `readVerification` refuses these shapes now, but this function is also
  // handed records directly, and the grading below dereferences `row.role` on
  // every one of them. A module whose contract is "never a pass it did not
  // earn" cannot answer a malformed input with a TypeError — a crash is not one
  // of the three verdicts, and the caller that dies is the diagnostic somebody
  // is running because something is already wrong.
  const rowProblem = record.roles.map(observationProblem).find(Boolean);
  if (rowProblem) {
    return unknown(
      'The verification on this machine is not a usable record of what was seen.',
      `${rowProblem} — so this record cannot be graded, and an ungradeable record is not a passing one.`,
      `rm ${stored.file}  &&  npm run node:verify`,
    );
  }

  // The inventory was read at the top; its refusal is reported HERE, after the
  // record's own problems, because "never verified" is a better sentence than
  // "I do not know what you own".
  if (!inventory.ok) {
    return unknown(
      'Cannot tell whether this machine\'s roles came back, because what it owns is not known here.',
      `${inventory.why}. Grading a record against itself is how a three-role record on a six-role machine read as "all owned roles came back".`,
      'npm run node:whoami      # what this machine is and what it may run',
    );
  }

  // ONE INTERSECTION, AND BOTH VERDICTS READ OFF IT.
  //
  // The record is evidence; the inventory is the standard. A row for a role
  // this machine no longer owns, or that no longer has a schedule to probe, is
  // neither confirmation nor failure — it is a stale row, and it belongs in
  // neither count. Round 1 fixed the PASS count to grade against ownership and
  // left FAIL grading `record.roles`, so a row left behind by a role that had
  // since moved machines was a PERMANENT failure naming a job this Mac does
  // not run, clearable only by deleting the file.
  //
  // Drawing the confirmed list from the probeable roles is also what makes
  // "Observed: bus-relay ... Not checked: bus-relay" structurally impossible:
  // `graded` and `notChecked` are disjoint by construction, because a role is
  // either probeable or it is not.
  const probeableRoles = new Set(inventory.probeable);
  const graded = record.roles.filter((r) => probeableRoles.has(r.role));
  const stale = record.roles.filter((r) => !probeableRoles.has(r.role));
  const observedRoles = new Set(graded.map((r) => r.role));
  const unverified = inventory.probeable.filter((role) => !observedRoles.has(role));
  const notChecked = inventory.unprobeable;
  const namedNotChecked = notChecked.length
    ? `Not checked: ${notChecked.map((u) => u.role).join(', ')} — ${plural(notChecked.length, 'it has', 'they have')} no schedule to check.`
    : '';
  const namedStale = stale.length
    ? `${stale.map((r) => r.role).join(', ')} ${plural(stale.length, 'is', 'are')} in the record, but this machine no longer owns `
      + `${plural(stale.length, 'it', 'them')} or can probe ${plural(stale.length, 'it', 'them')} — `
      + `${plural(stale.length, 'a stale row counts', 'stale rows count')} neither as confirmation nor as a failure.`
    : '';

  // A PASS NEEDS AT LEAST ONE CONFIRMED ROLE, and this is where that is
  // enforced. It is the same shape as the `record.roles.length === 0` guard
  // above — that one guards the RECORD being empty, this one guards the
  // CONFIRMATION being empty, and the second is the one that survived round 1.
  // A record whose every row has moved elsewhere confirms exactly as much as
  // an empty one, and it used to print a green `0 of 2 owned roles confirmed`.
  if (graded.length === 0) {
    return unknown(
      'Nothing in this machine\'s verification record speaks for a role it currently owns and can probe.',
      sentences(
        `${node} owns ${inventory.probeable.length} probeable role${plural(inventory.probeable.length, '', 's')} `
          + `(${inventory.probeable.join(', ')}), and the record covers ${record.roles.map((r) => r.role).join(', ')}.`,
        namedStale,
        'A record that confirms nothing this machine runs is not a pass.',
      ),
      'npm run node:verify      # re-probes every owned schedule and rewrites the record',
    );
  }

  const missing = graded.filter(didNotComeBack);
  if (missing.length > 0) {
    // A found defect outranks a blind spot, so this is a FAIL even when other
    // roles are unverified — but the unverified ones are named here too, or
    // the count reads as the whole story when it is a floor.
    return {
      state: 'fail',
      headline: `${missing.length} role${plural(missing.length, '', 's')} did not come back after this machine restarted.`,
      why: sentences(
        `${missing.map((r) => `${r.role}: ${describeRole(r)}`).join('; ')}.`,
        unverified.length
          ? `${unverified.join(', ')} ${plural(unverified.length, 'is', 'are')} owned and probeable but absent from the record, so ${plural(unverified.length, 'it', 'they')} may be worse than this.`
          : '',
        namedNotChecked,
        namedStale,
      ),
      fix: 'npm run provision:node      # then npm run node:verify again',
      roles: graded,
    };
  }

  // THE DRIFT CASE. A role that is owned and probeable TODAY but absent from
  // the record was, when the record was written, either blocked or not owned.
  // Give a blocked row an installer — which lib/nodeProvision.js explicitly
  // anticipates — and without this the section keeps reporting PASS off a
  // record written before that role could be checked at all, until the next
  // reboot happens to clear it.
  if (unverified.length > 0) {
    return unknown(
      `${unverified.length} role${plural(unverified.length, '', 's')} this machine owns ${plural(unverified.length, 'is', 'are')} not in its verification record.`,
      sentences(
        `${node} owns ${inventory.probeable.length} probeable role${plural(inventory.probeable.length, '', 's')} (${inventory.probeable.join(', ')}), `
          + `and the record speaks for ${graded.length} of ${plural(graded.length, 'it', 'them')} (${graded.map((r) => r.role).join(', ')}).`,
        `Nothing here says whether ${unverified.join(', ')} came back — a record written before a role had a schedule cannot speak for it.`,
        namedStale,
      ),
      'npm run node:verify      # re-probes every owned schedule and rewrites the record',
    );
  }

  // A PASS, and the count is measured against ownership. Roles with no
  // schedule are named on the verdict line itself rather than omitted — the
  // heartbeat settled this shape already: a role with no emitter reports NOT
  // REPORTING with its reason, never as healthy.
  const confirmed = observedRoles.size;
  const headline = notChecked.length
    ? `${confirmed} of ${inventory.total} owned roles confirmed after the last restart; `
      + `${notChecked.map((u) => u.role).join(', ')} ${plural(notChecked.length, 'has', 'have')} no schedule to check.`
    : `All ${confirmed} owned role${plural(confirmed, '', 's')} came back after the last restart.`;

  return {
    state: 'pass',
    headline,
    why: sentences(
      `Verified at ${record.at}, against this machine's current boot (${boot.at}).`,
      `Observed: ${graded.map((r) => r.role).join(', ')}.`,
      // Each reason is parenthesised and the list is one sentence, so three of
      // them cannot read as prose that has lost its punctuation. The reason's
      // own full stop comes off inside the brackets and the clause carries one
      // of its own at the end — otherwise the line ends `(Same as loop-build.).`
      notChecked.length
        ? `Not checked: ${notChecked.map((u) => `${u.role} (${firstSentence(u.why).replace(/\.$/, '')})`).join('; ')}.`
        : '',
      namedStale,
    ),
    fix: null,
    roles: graded,
  };
}

module.exports = {
  SAME_BOOT_TOLERANCE_S,
  describeRole,
  didNotComeBack,
  isSameBoot,
  ownedInventory,
  parseBootTime,
  parseScheduleStatus,
  readVerification,
  rebootTestReport,
  recordVerification,
  roleTableLine,
  verificationDir,
  verificationFile,
};
