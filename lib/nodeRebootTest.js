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
 * Write a verification.
 *
 * REFUSES a record with no observed rows, and that refusal is the mechanism
 * behind acceptance criterion 3. There is deliberately no way to record "I
 * verified this machine" without handing over what was actually seen, role by
 * role — so a caller cannot stamp a pass by reaching its own last line.
 */
function recordVerification({ node, boot, roles, at, homedir = os.homedir(), write = fs } = {}) {
  if (!boot || !Number.isFinite(Number(boot.sec))) {
    return { ok: false, why: 'no boot identity was supplied, so there is nothing a later run could compare against' };
  }
  if (!Array.isArray(roles) || roles.length === 0) {
    return { ok: false, why: 'no role observations were supplied — a verification that saw nothing proves nothing' };
  }
  for (const row of roles) {
    if (!row || typeof row.role !== 'string' || !row.role) {
      return { ok: false, why: 'a role observation has no role name' };
    }
    if (typeof row.installed !== 'boolean' || typeof row.loaded !== 'boolean') {
      return { ok: false, why: `the observation for "${row.role}" does not say whether it was installed and loaded` };
    }
  }

  const record = {
    node: String(node || ''),
    boot: { sec: Number(boot.sec), at: boot.at || new Date(Number(boot.sec) * 1000).toISOString() },
    at: at || new Date().toISOString(),
    roles: roles.map((r) => ({ role: r.role, installed: r.installed, loaded: r.loaded })),
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
  return { found: true, readable: true, file, record };
}

// --- the verdict ------------------------------------------------------------

/**
 * Have this machine's roles been verified since it last restarted?
 *
 * Pure. Everything it needs is passed in: the machine's current boot reading,
 * whatever `readVerification` returned, and this machine's node name.
 *
 * Returns `{ state, headline, why, fix, roles }` where `state` is one of
 * `pass` / `fail` / `unknown` — the same three the report prints, never two.
 */
function rebootTestReport({ boot, stored, node } = {}) {
  const unknown = (headline, why, fix) => ({ state: 'unknown', headline, why, fix, roles: [] });

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

  // A record from another machine. Possible the moment somebody copies an
  // Application Support folder between Macs, which is exactly the mistake the
  // Claude-memory check in doctor:node already exists to catch one floor down.
  if (node && record.node && record.node !== node) {
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

  const missing = record.roles.filter((r) => !r.installed || !r.loaded);
  if (missing.length > 0) {
    return {
      state: 'fail',
      headline: `${missing.length} role${missing.length === 1 ? '' : 's'} did not come back after this machine restarted.`,
      why: missing
        .map((r) => `${r.role}: ${r.installed ? 'schedule installed but launchd has not loaded it' : 'schedule not installed'}`)
        .join('; '),
      fix: 'npm run provision:node      # then npm run node:verify again',
      roles: record.roles,
    };
  }

  return {
    state: 'pass',
    headline: `All ${record.roles.length} owned role${record.roles.length === 1 ? '' : 's'} came back after the last restart.`,
    why: `Verified at ${record.at}, against this machine's current boot (${boot.at}). `
      + `Observed: ${record.roles.map((r) => r.role).join(', ')}.`,
    fix: null,
    roles: record.roles,
  };
}

module.exports = {
  SAME_BOOT_TOLERANCE_S,
  isSameBoot,
  parseBootTime,
  parseScheduleStatus,
  readVerification,
  rebootTestReport,
  recordVerification,
  verificationDir,
  verificationFile,
};
