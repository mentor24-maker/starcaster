'use strict';

/**
 * Run a command and say plainly whether it worked.
 *
 * WHY THIS IS ITS OWN FILE. It used to live inside `scripts/weekly_report.mjs`,
 * where no test could reach it — the script gathers figures and publishes the
 * moment it is imported, so a test cannot load it to look at one function. That
 * mattered, because the defect below is not visible by reading a call site: it
 * is a disagreement between what `ok` means here and what every caller assumes
 * it means. `scripts/builder/weeklyReport.js` was the obvious home and is the
 * wrong one — it declares itself pure (no network, no filesystem, no clock) and
 * that contract is worth more than the convenience of one fewer file.
 *
 * THERE IS NO `allowFail` OPTION, ON PURPOSE, AND THIS IS THE THIRD TELLING.
 * There used to be one. It set `ok: true` on a non-zero exit so a caller could
 * still read the output, which meant `ok` said two different things depending on
 * a flag written several lines away — and every `if (!res.ok)` underneath it
 * became unreachable code that still LOOKED like error handling.
 *
 * It bit twice, in two different functions, one review round apart:
 *
 *   round 2 — `gh` exiting 127 was reported to the operator as "GitHub's run
 *             list did not parse as JSON". The wrong diagnosis entirely.
 *   round 3 — a failed post to the bus printed nothing at all. That is the ONLY
 *             escalation channel an unattended Monday run has, and the bus was
 *             returning HTTP 400 in production at the time (ticket 86bbjzg83),
 *             so a real publish failure would have notified nobody.
 *
 * Removing the flag removes the class. `ok` now means exactly one thing: the
 * command exited 0. A caller that genuinely wants the output of a failed
 * command reads `stdout`/`stderr`, which are always populated — see
 * `gatherTests`, where a failing suite is a figure rather than an error. A
 * caller that does not care about the result ignores it. Both of those choices
 * are now visible at the call site instead of hidden in an option object.
 */
function run(cmd, args, { cwd = process.cwd(), timeout = 300000 } = {}) {
  const { spawnSync } = require('node:child_process');
  const res = spawnSync(cmd, args, { cwd, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const shown = `${cmd} ${args.join(' ')}`;
  if (res.error) {
    return { ok: false, status: null, reason: `\`${shown}\` could not run (${res.error.message})`, stdout: '', stderr: '' };
  }
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim().split('\n').slice(0, 2).join(' ').slice(0, 200);
    return {
      ok: false,
      status: res.status,
      reason: `\`${shown}\` exited ${res.status}${detail ? `: ${detail}` : ''}`,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
    };
  }
  return { ok: true, status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

module.exports = { run };
