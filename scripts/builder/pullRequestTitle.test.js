'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { decidePullRequestTitle, parseTaskName } = require('./pullRequestTitle.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * The rule (task 86bbqwupk): a pull request is titled with its ClickUp task
 * name, VERBATIM, so the Closed list and the deploy list can be paired up by
 * name. Everything around this in `ship_thread.cjs` needs a remote, an open PR
 * and a live ClickUp token, so these are the assertions that can actually run.
 */

const TICKET = "A pull request must carry its ticket's name, so the two lists can be read side by side";
const ok = (stdout) => () => ({ ok: true, stdout, output: '' });
const broken = (output) => () => ({ ok: false, stdout: '', output });

/* ------------------------------------------ criterion 1: the stamp is present */

test('a stamped branch is titled after the ticket, byte for byte', () => {
  const decided = decidePullRequestTitle({
    taskId: '86bbqwupk',
    fallbackSubject: 'wip',
    fetchTaskName: ok(`${TICKET}\n`),
  });
  assert.equal(decided.title, TICKET);
  assert.equal(decided.source, 'ticket');
  assert.equal(decided.loud, false);
});

test('the ticket name wins even when the commit subject is a perfectly good sentence', () => {
  // The failure this exists to stop is not a BAD commit subject — #481 差 by one
  // word ("drifts" vs "scrolls") and read as a match until you looked twice.
  const decided = decidePullRequestTitle({
    taskId: '86bbqwupk',
    fallbackSubject: 'Builder: parallax — a background image or video that drifts slower than the page',
    fetchTaskName: ok('Builder: parallax — a background image or video that scrolls slower than the page\n'),
  });
  assert.equal(decided.title, 'Builder: parallax — a background image or video that scrolls slower than the page');
  assert.equal(decided.source, 'ticket');
});

test('a name whose own punctuation looks like markup survives untouched', () => {
  const awkward = 'check:syntax does not reach routes/, api/, workers/ or server.js — "the same parse hole"';
  const decided = decidePullRequestTitle({
    taskId: '86bbr74kv', fallbackSubject: 'wip', fetchTaskName: ok(`${awkward}\n`),
  });
  assert.equal(decided.title, awkward);
});

/* ------------------------------------------- criterion 2: the stamp is absent */

test('an unstamped branch still ships, titled from the commit, and says why', () => {
  let asked = false;
  const decided = decidePullRequestTitle({
    taskId: '',
    fallbackSubject: 'wip',
    fetchTaskName: () => { asked = true; return { ok: true, stdout: 'should never be read' }; },
  });
  assert.equal(decided.title, 'wip');
  assert.equal(decided.source, 'commit');
  assert.equal(decided.reason, 'no-stamp');
  assert.equal(decided.loud, true, 'a silent fallback is how this rule gets quietly lost again');
  assert.match(decided.message, /no ClickUp ticket/i);
  assert.equal(asked, false, 'with no stamp there is nothing to ask ClickUp about');
});

test('a stamp of whitespace counts as no stamp, not as a ticket id', () => {
  const decided = decidePullRequestTitle({
    taskId: '   ', fallbackSubject: 'wip', fetchTaskName: ok('nope\n'),
  });
  assert.equal(decided.reason, 'no-stamp');
  assert.equal(decided.title, 'wip');
});

/* -------------------------------------------- criterion 3: the fetch fails */

test('a failed fetch falls back to the commit subject and does not stop the ship', () => {
  const decided = decidePullRequestTitle({
    taskId: '86bbqwupk',
    fallbackSubject: 'wip',
    fetchTaskName: broken('ClickUp said: team not authorized'),
  });
  assert.equal(decided.title, 'wip');
  assert.equal(decided.source, 'commit');
  assert.equal(decided.reason, 'fetch-failed');
  assert.equal(decided.loud, true);
  assert.match(decided.message, /86bbqwupk/, 'the message names the ticket it could not read');
  assert.match(decided.message, /team not authorized/, 'and quotes what ClickUp actually said');
});

test('a fetcher that throws is a failed fetch, not a crashed ship', () => {
  const decided = decidePullRequestTitle({
    taskId: '86bbqwupk',
    fallbackSubject: 'wip',
    fetchTaskName: () => { throw new Error('getaddrinfo ENOTFOUND api.clickup.com'); },
  });
  assert.equal(decided.title, 'wip');
  assert.equal(decided.reason, 'fetch-failed');
  assert.match(decided.message, /ENOTFOUND/);
});

test('a fetch that succeeds with nothing in it is a fallback, not an empty title', () => {
  // gh refuses a PR with an empty title, so a blank name has to become the
  // commit subject rather than being passed straight through.
  const decided = decidePullRequestTitle({
    taskId: '86bbqwupk', fallbackSubject: 'wip', fetchTaskName: ok('   \n\n'),
  });
  assert.equal(decided.title, 'wip');
  assert.equal(decided.reason, 'empty-name');
  assert.equal(decided.loud, true);
});

test('every fallback message names the command that renames the PR by hand', () => {
  for (const decided of [
    decidePullRequestTitle({ taskId: '', fallbackSubject: 'wip', fetchTaskName: ok('x\n') }),
    decidePullRequestTitle({ taskId: '86bbqwupk', fallbackSubject: 'wip', fetchTaskName: broken('down') }),
    decidePullRequestTitle({ taskId: '86bbqwupk', fallbackSubject: 'wip', fetchTaskName: ok('\n') }),
  ]) {
    assert.match(decided.message, /gh pr edit <pr> --title/, `no repair command in: ${decided.message}`);
  }
});

/* ------------------------------------------------- reading the fetch's stdout */

test('npm\'s run banner is stripped, so the title can never become "> starcaster@1.0.0 clickup"', () => {
  // npm writes the banner to STDOUT, not stderr. `--silent` suppresses it
  // today; this makes the title survive an npm that stops honouring the flag.
  const withBanner = `\n> starcaster@1.0.0 clickup\n> doppler run --project starcaster -- node scripts/clickup_direct.mjs task-name\n\n${TICKET}\n`;
  assert.equal(parseTaskName(withBanner), TICKET);
  const decided = decidePullRequestTitle({
    taskId: '86bbqwupk', fallbackSubject: 'wip', fetchTaskName: ok(withBanner),
  });
  assert.equal(decided.title, TICKET);
});

test('parseTaskName keeps an interior ">" — only the leading banner lines go', () => {
  assert.equal(parseTaskName('Builder: a > b comparison\n'), 'Builder: a > b comparison');
});

test('parseTaskName is empty for nothing at all', () => {
  for (const input of ['', '\n\n', '   ', null, undefined]) {
    assert.equal(parseTaskName(input), '');
  }
});

/* --------------------------------- the wiring, asserted on ship's source text */

test('ship titles the PR from the decision, never straight from the commit subject', () => {
  const src = read('scripts/ship_thread.cjs');
  assert.match(src, /decidePullRequestTitle/, 'ship must ask the decider');
  assert.match(
    src,
    /gh',\s*\['pr',\s*'create',\s*'--title',\s*titled\.title/,
    'the title handed to `gh pr create` must be the decided one'
  );
  assert.equal(
    /'--title',\s*subject\b/.test(src), false,
    'the raw commit subject must not reach `gh pr create` — that is the defect'
  );
});

test('ship reads the task name from stdout alone, never from combined output', () => {
  // `quiet()` concatenates stdout and stderr, and clickup_direct writes its
  // rate-limit line to stderr — so using it here would glue "ClickUp's own
  // limit: 91 of 100 left this minute" onto the end of every PR title.
  const src = read('scripts/ship_thread.cjs');
  const fetcher = src.slice(
    src.indexOf('function fetchTaskNameFromClickUp'),
    src.indexOf('/** Block for ms without a busy loop')
  );
  assert.ok(fetcher.length > 0, 'the fetcher should still be there');
  assert.match(fetcher, /'--silent'/, 'npm prints its banner to stdout without --silent');
  assert.equal(/quiet\(/.test(fetcher), false, 'quiet() merges stderr into the title');
  assert.match(fetcher, /stdout: result\.stdout/);
});

test('the fallback still exists — pullRequestCommit is the path for an unstamped branch', () => {
  const src = read('scripts/ship_thread.cjs');
  assert.match(src, /pickPullRequestCommit\(git\)/, 'the housekeeping fix stays as the fallback');
  assert.ok(
    fs.existsSync(path.join(ROOT, 'scripts', 'builder', 'pullRequestCommit.test.js')),
    'its tests stay too — explicitly out of scope to delete'
  );
});

test('clickup_direct has a machine-readable task-name command that keeps stdout clean', () => {
  const src = read('scripts/clickup_direct.mjs');
  assert.match(src, /cmd === 'task-name'/, 'ship needs a name it does not have to parse out of a header block');
  const block = src.slice(src.indexOf("cmd === 'task-name'"), src.indexOf("cmd === 'comments'"));
  assert.match(block, /process\.stdout\.write/, 'the name goes to stdout');
  assert.equal(
    /reportLimits\(/.test(block), false,
    'the rate-limit line must not be printed here — a caller reading combined output would title the PR with it'
  );
});

test('task-name is listed in the command help, or nobody will find it', () => {
  // A command that only `ship` knows about is a command a hand-driven session
  // re-invents by parsing `get`, which is the parse this exists to replace.
  const src = read('scripts/clickup_direct.mjs');
  const usage = src.slice(src.indexOf('function usage'), src.indexOf('function usage') + 20000);
  assert.match(usage, /task-name --task <id>/, 'the usage block must advertise it');
});

test('loop-build writes the title rule down, since the loop lane never calls ship', () => {
  const skill = read('.claude/skills/loop-build/SKILL.md');
  assert.match(
    skill,
    /title[^\n]*task name|task name[^\n]*title/i,
    'step 7 must state that the PR title is the ClickUp task name'
  );
});
