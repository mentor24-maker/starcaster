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
 * Four rules it exists to enforce:
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
 *   4. A remote probe runs in the environment the probed thing actually runs
 *      in. `ssh host 'cmd'` is a NON-login shell, and sshd hands it a PATH of
 *      /usr/bin:/bin:/usr/sbin:/sbin — no /opt/homebrew/bin, no /usr/local/bin.
 *      Probing a Homebrew-installed tool that way reports it missing, so the
 *      check would call a perfectly healthy machine drift, simultaneously,
 *      about every tool Homebrew put there. That is worse than the blind spot
 *      it replaces: a check that cries wolf gets ignored. Measured on the Mini
 *      2026-08-24 — `colima` is /opt/homebrew/bin/colima and `docker` is
 *      /usr/local/bin/docker, neither reachable from the sshd PATH, while a
 *      login bash resolves both. So EVERY remote command goes through a login
 *      shell, wrapped once here where no caller can forget it.
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

// The shell a remote command is wrapped in. `-l` is the whole point: it reads
// the login profile, which on macOS runs path_helper and puts Homebrew back on
// PATH. bash rather than zsh because /bin/bash is always present and its login
// profile (/etc/profile) is the one path_helper lives in.
const LOGIN_SHELL = 'bash';
const LOGIN_SHELL_FLAGS = '-lc';

/**
 * Quote a string so a remote shell sees it as ONE argument.
 *
 * ssh does not take an argv — it joins everything after the destination with
 * spaces and hands the result to the remote login shell. So `['bash','-lc',cmd]`
 * would arrive word-split and run only the first word of `cmd`. The command has
 * to be quoted here, into a single string, before ssh ever sees it.
 */
function singleQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * The exact string handed to ssh for a remote one-liner. Exported so the tests
 * can assert the login shell is present rather than trusting that it is.
 */
function loginShellCommand(command) {
  return `${LOGIN_SHELL} ${LOGIN_SHELL_FLAGS} ${singleQuote(command)}`;
}

/**
 * Did this child_process error come from the timeout, rather than from the
 * command itself failing?
 *
 * This lives here, and is tested against a REAL timeout, because `shell()`
 * below leans on it to tell a hung connection (COULD NOT CHECK) from a remote
 * command that answered "no" (DRIFT). The obvious spelling — `err.killed` —
 * is wrong on Node: execFileSync leaves `killed` undefined on a timeout and
 * reports it as `code: 'ETIMEDOUT'` with `signal: 'SIGTERM'`. Keying off
 * `killed` alone made the guard permanently false, so a machine that accepted
 * the connection and then stalled was reported as drift.
 *
 * `killed` is still honoured: it costs nothing and other runtimes do set it.
 */
function isTimeout(err) {
  return err != null && (err.killed === true || err.code === 'ETIMEDOUT');
}

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
    // Rule 4: a login shell, always, centrally — never the bare command.
    const r = run('ssh', [...SSH_OPTS, target, loginShellCommand(command)], timeoutMs);

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

module.exports = {
  createExecutor,
  loginShellCommand,
  isTimeout,
  SSH_OPTS,
  SSH_CONNECTION_FAILED,
  LOGIN_SHELL,
  LOGIN_SHELL_FLAGS,
};
