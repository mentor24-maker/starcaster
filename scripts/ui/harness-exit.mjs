/**
 * THE THREE VERDICTS A BROWSER HARNESS MAY RETURN.
 *
 * A check that could not run must not exit 0. On 2026-09-02 two refusals were
 * observed reading as passes, and the audit that followed (task 86bbt6hgx)
 * found eight paths across `check_screens`, `check_nav_controls`,
 * `check_panels` and `check_render` where the harness printed an excellent
 * explanation of why it could measure nothing and then exited 0 — or exited 1,
 * calling a reading it never took a failure of the code under test.
 *
 * A pass and a refusal are indistinguishable to any script, to CI, and to
 * anyone skimming a log for the exit status. `npm run throughput` already
 * solved this in this repo, and this is the same scheme:
 *
 *   0  ran, and what it measured was correct
 *   1  ran, and what it measured was WRONG — the code under test has a defect
 *   2  could not take a reading — say nothing about the code
 *
 * The difference between 1 and 2 is whose problem it is. A stale build, an
 * unseeded fixture, a rate-limited server and a missing variant are all
 * problems with the INSTRUMENT; reporting them as 1 sends whoever reads the
 * log looking for a bug that is not there. The rule of thumb: if the code
 * under test could be perfect and this could still happen, it is a 2.
 *
 * `docs/DOCTRINE.md` on checks that silently do not run; `doctor:node` answers
 * the same question with CANNOT TELL rather than PASS.
 */

/** Ran, and what it measured was correct. */
export const EXIT_PASS = 0;
/** Ran, and what it measured was wrong — a defect in the code under test. */
export const EXIT_FAIL = 1;
/** Could not take a reading. Says NOTHING about the code under test. */
export const EXIT_CANNOT_TELL = 2;

/**
 * Print a refusal and exit 2.
 *
 * `label` is the command as a person types it (`check:panels`), so the line
 * names itself in a log carrying several harnesses. `message` is the whole
 * explanation, already formatted — these messages are the fix instructions and
 * are the one part of a refusal worth reading.
 */
export function cannotTell(label, message) {
  console.error(`\n[${label}] COULD NOT TAKE A READING — exiting ${EXIT_CANNOT_TELL}.\n\n${message}\n`);
  process.exit(EXIT_CANNOT_TELL);
}

/**
 * The verdict for a run that finished, given what it found and what it could
 * not see.
 *
 * A real failure outranks a could-not-tell on purpose: a screen that overflows
 * its viewport overflowed it, whatever else was hollow about the run. But a
 * PASS never outranks a could-not-tell, because a pass over something nobody
 * measured is the exact result this scheme exists to stop being green.
 */
export function verdict({ failures = 0, blind = 0 } = {}) {
  if (failures > 0) return EXIT_FAIL;
  if (blind > 0) return EXIT_CANNOT_TELL;
  return EXIT_PASS;
}
