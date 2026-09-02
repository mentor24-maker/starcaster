/**
 * Print, then leave — without losing the last 64KB of what you printed.
 *
 * `process.exit()` does not flush. On macOS, stdout to a PIPE is asynchronous
 * (Node's own docs: files and TTYs are synchronous on POSIX, pipes and sockets
 * are not), so anything still sitting in the stream when `exit` is called is
 * simply discarded. Measured on the Mini, 2026-09-02, not reasoned about:
 *
 *     printed   65535 bytes -> the parent got   65535   intact
 *     printed   65536 bytes -> the parent got   65536   intact
 *     printed   66000 bytes -> the parent got   65536   *** TRUNCATED ***
 *     printed  200000 bytes -> the parent got   65536   *** TRUNCATED ***
 *
 * To a terminal none of this shows, which is why it survived review: the
 * failure only appears once something reads the output through a pipe. The
 * pulse's own scheduled publisher became that first consumer, and its JSON
 * handoff grows by roughly 144 bytes per Live ticket — so this was a dated
 * bomb rather than a hypothetical. Somewhere around 380 Live tickets every
 * hourly run would have failed to parse and alarmed about a bug that did not
 * exist, while the check itself went blind.
 *
 * Why not simply `process.exitCode = n` and let the process end naturally:
 * because it might not. Anything holding the event loop open — undici's
 * keep-alive sockets after a `fetch`, most obviously — turns a truncation into
 * a hang, and a scheduled job that hangs is a strictly worse failure than one
 * that prints short. So: write, and exit from the write's own flush callback,
 * with a deadline in case the callback never comes and `exitCode` set so even
 * the natural exit carries the right number. Three ways out, all of them the
 * caller's code.
 */

// Generous: this is a guard against a callback that never fires, not a
// throughput budget. A real flush of a few hundred KB down a pipe a parent is
// actively reading takes milliseconds.
const FLUSH_DEADLINE_MS = 10_000;

/**
 * @param {string} text     what to print (a trailing newline is added)
 * @param {number} code     the exit code
 * @param {object} [opts]
 * @param {'stdout'|'stderr'} [opts.stream]  default 'stdout'
 */
function printAndExit(text, code, { stream = 'stdout' } = {}) {
  const out = stream === 'stderr' ? process.stderr : process.stdout;
  // If we ever leave by the natural route, leave with the right number.
  process.exitCode = code;

  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    process.exit(code);
  };

  const guard = setTimeout(leave, FLUSH_DEADLINE_MS);
  // Unref'd so it cannot itself hold the process open; if the loop drains
  // first the natural exit already carries `code`.
  if (typeof guard.unref === 'function') guard.unref();

  out.write(`${text}\n`, leave);
}

module.exports = { printAndExit, FLUSH_DEADLINE_MS };
