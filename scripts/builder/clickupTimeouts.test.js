'use strict';

/**
 * Every call out of `scripts/lib/clickup.cjs` has a DEADLINE.
 *
 * Task 86bbqz7rg, review round 2. Node's `fetch` has no default request
 * timeout and `execFileSync` has no default `timeout:`, so a half-open
 * connection to ClickUp did not fail — it waited, effectively forever. In a
 * scheduled job that is the worst available outcome: launchd will not start a
 * second copy while the first is still going, so the job never exits, never
 * prints and never returns non-zero, and `report_job_failure.mjs` never fires.
 *
 * The fetch bound is proved against a REAL server that accepts the connection
 * and then says nothing, because that is the failure — a pure test of the
 * message would pass just as happily with the deadline deleted. Reverting
 * `signal: AbortSignal.timeout(...)` hangs the first test until the runner
 * kills it; reverting `timeout:` on the shell-out fails the last two.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Read at module load, so they have to be set before the require below.
process.env.CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN || 'test-token-not-a-real-one';
const listening = new Promise((resolve) => {
  // Accepts the request and never answers it. This is the shape a hung
  // ClickUp presents: not a refused connection, not an error status — silence
  // on an open socket.
  const server = http.createServer(() => { /* deliberately no response, ever */ });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

test('a ClickUp call that hangs is abandoned, and says it timed out', async () => {
  const server = await listening;
  process.env.CLICKUP_API_BASE = `http://127.0.0.1:${server.address().port}`;
  delete require.cache[require.resolve('../lib/clickup.cjs')];
  const clickup = require('../lib/clickup.cjs');

  const started = Date.now();
  await assert.rejects(
    () => clickup.call('GET', '/api/v2/task/never-answers', undefined, { timeoutMs: 300 }),
    (err) => {
      assert.match(err.message, /did not answer within/,
        'the message has to name the deadline — "The operation was aborted" sends the '
        + 'reader looking for a bug in our code instead of at the network');
      assert.match(err.message, /GET \/api\/v2\/task\/never-answers/, 'and which call it was');
      return true;
    },
  );
  assert.ok(Date.now() - started < 5000, 'it gave up near its deadline rather than waiting on the socket');
  server.close();
});

test('a shell-out that was KILLED reports the timeout, not an empty reason', () => {
  const clickup = require('../lib/clickup.cjs');
  // THIS IS THE MEASURED SHAPE, not a guessed one. Run against a real child
  // that outlives its deadline, `execFileSync` throws with
  // `killed=undefined, signal='SIGTERM', code='ETIMEDOUT'` and an EMPTY
  // stderr — so a branch that only checked `err.killed` would look correct,
  // pass a test written from memory, and still produce "failed: " with
  // nothing after it on the one run that matters.
  const real = { killed: undefined, signal: 'SIGTERM', code: 'ETIMEDOUT', stderr: '', stdout: '' };
  const detail = clickup.shellFailureDetail(real, 120000);
  assert.match(detail, /did not finish within 120s and was killed/);
});

test('an ordinary shell-out failure still reports what it said', () => {
  const clickup = require('../lib/clickup.cjs');
  const detail = clickup.shellFailureDetail({ stderr: 'Task not found (404)' }, 120000);
  assert.equal(detail, 'Task not found (404)',
    'a real error message must not be replaced by a timeout story it does not have');
});

test('the shell-out door passes a deadline to the child it spawns', () => {
  const clickup = require('../lib/clickup.cjs');
  let sawOptions = null;
  clickup.runDirect(['chat', '--channel', '1'], {
    what: 'a test',
    input: 'hello',
    timeoutMs: 4321,
    run: (_cmd, _args, options) => { sawOptions = options; return ''; },
  });
  assert.equal(sawOptions.timeout, 4321,
    'without a timeout: option the child can hang forever, which is the whole defect');
});
