'use strict';

/**
 * Running a drift probe on the machine an object actually lives on.
 *
 * `check_ecosystem_drift.cjs` proves the other machine is reachable over SSH
 * and then declines to check anything hosted on it:
 *
 *   ? colima:     hosted on mac-mini, not on this machine
 *   ? job-colima: scheduled on mac-mini, not on this machine
 *
 * Declining is the right answer when we genuinely cannot look (DOCTRINE §3.11
 * — a silent skip is how a sweep gives a false all-clear). But once SSH has
 * answered, we CAN look, and every role the Mini takes on widens that blind
 * spot. On 2026-08-21 the first thing to appear in it was a container runtime
 * that had been fatally broken since commissioning, with nothing able to say so.
 *
 * This module is the "where does this one-liner run" seam. The probes keep
 * asking exactly the questions they asked before; only the location changes.
 *
 * Three rules it exists to enforce:
 *
 *   1. ONE ssh connection per machine, not one per object. Reachability is
 *      established once and memoised; every later probe reuses that verdict.
 *   2. Unreachable is NOT drift. A sleeping, travelling or key-less box is
 *      still real — it lands in COULD NOT CHECK, with the same wording as
 *      before. Dane's laptop-and-Mini setup means one of them is regularly
 *      off, and a check that cries wolf gets ignored.
 *   3. A remote probe FAILING is different from a host being unreachable.
 *      "colima is installed but will not start" is drift; "the Mini is asleep"
 *      is not. SSH gives us that distinction for free: exit status 255 is the
 *      connection failing, anything else is the remote command's own verdict.
 *
 * `run` is injected so the tests never open a socket — see remoteProbe.test.js,
 * which exercises both directions (reachable-but-broken, and unreachable).
 */

// Read-only, non-interactive, and it gives up quickly: a probe that hangs on a
// sleeping machine is a probe nobody waits for.
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=4'];

// ssh(1) reserves 255 for "the connection itself failed" — DNS, refused,
// timed out, no usable key. Any other status came back FROM the remote host,
// which means the connection worked and the command has an opinion.
const SSH_CONNECTION_FAILED = 255;

/**
 * A place to run read-only shell one-liners: this machine, or another one over
 * SSH. Every probe goes through `shell()` and never builds an ssh line itself.
 *
 * @param {object}   deps
 * @param {Function} deps.run       (cmd, args, timeoutMs) => { ok, out, missing, timedOut, code }
 * @param {string?}  deps.hereId    inventory id of the machine we are standing on
 * @param {Function} deps.sshTarget machineId => ssh destination (default: the id itself)
 */
function createExecutor({ run, hereId = null, sshTarget = (id) => id }) {
  // machineId -> { reachable, why }. Filled by the first probe that asks, read
  // by every probe after it. This is rule 1.
  const reachCache = new Map();

  function isHere(machineId) {
    return machineId != null && hereId != null && machineId === hereId;
  }

  /**
   * Is this machine reachable over SSH? Asked at most once per machine.
   * @returns {{reachable: boolean, why?: string}}
   */
  function reach(machineId) {
    if (isHere(machineId)) return { reachable: true };
    if (reachCache.has(machineId)) return reachCache.get(machineId);

    const target = sshTarget(machineId);
    const r = run('ssh', [...SSH_OPTS, target, 'true'], 12000);
    const verdict = r.ok
      ? { reachable: true, target }
      : {
          reachable: false,
          target,
          // The exact wording the check has always used for an absent host.
          // Deliberately unchanged: it is a state, not a disagreement.
          why: `ssh "${target}" did not answer — asleep, off this network, or key not set up; not treated as drift`,
        };
    reachCache.set(machineId, verdict);
    return verdict;
  }

  /**
   * Run a read-only shell one-liner on `machineId`.
   *
   * @returns {{ran: false, why: string}}                 host could not be reached
   *          {{ran: true, ok: boolean, out: string, where: string}}  it ran; ok is the command's verdict
   */
  function shell(machineId, command, timeoutMs = 15000) {
    if (isHere(machineId) || machineId == null) {
      const r = run('/bin/sh', ['-c', command], timeoutMs);
      return { ran: true, ok: r.ok === true, out: r.ok ? r.out : '', where: 'this machine' };
    }

    const reachable = reach(machineId);
    if (!reachable.reachable) return { ran: false, why: reachable.why };

    const target = reachable.target ?? sshTarget(machineId);
    const r = run('ssh', [...SSH_OPTS, target, command], timeoutMs);

    // The host answered a moment ago but the connection has since dropped —
    // that is still "could not check", never drift. Rule 3, cautious direction:
    // we would rather under-report drift than accuse a sleeping machine.
    if (!r.ok && (r.code === SSH_CONNECTION_FAILED || r.timedOut)) {
      return {
        ran: false,
        why: `ssh "${target}" answered but the probe connection failed — not treated as drift`,
      };
    }

    return { ran: true, ok: r.ok === true, out: r.ok ? r.out : '', where: `${machineId} over ssh` };
  }

  return { reach, shell, isHere };
}

module.exports = { createExecutor, SSH_OPTS, SSH_CONNECTION_FAILED };
