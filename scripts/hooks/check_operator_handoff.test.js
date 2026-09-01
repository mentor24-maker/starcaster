'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'check_operator_handoff.cjs');
const {
  offendingCommands,
  statedException,
  splitFences,
  lastAssistantTurn,
  isInteractive,
} = require('../lib/operator_handoff.cjs');

/**
 * The Stop hook that enforces CLAUDE.md "CC runs the operational commands".
 *
 * The point of this file is the FAILING case. A guard that only proves it
 * stays quiet has proved nothing -- the rule it replaces was "enforced" by
 * being written down three times and was broken all three times. So the tests
 * that matter drive the real hook process with real JSON and assert it
 * actually refuses, with the actual exit code the harness reads.
 */

const FENCE = '```';

function fenced(body, lang = '') {
  return `${FENCE}${lang}\n${body}\n${FENCE}`;
}

/** A transcript the hook can read: one assistant turn, with an entrypoint. */
function makeTranscript(text, entrypoint = 'cli') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ophandoff-'));
  const file = path.join(dir, 'transcript.jsonl');
  const records = [
    { type: 'user', entrypoint, message: { role: 'user', content: 'go' } },
    {
      type: 'assistant',
      entrypoint,
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    },
  ];
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

function runHook(text, { entrypoint = 'cli', sessionId = 's1', cwd = os.tmpdir() } = {}) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: sessionId,
      cwd,
      transcript_path: makeTranscript(text, entrypoint),
    }),
    encoding: 'utf8',
  });
  return { code: result.status, stderr: result.stderr || '' };
}

// ---------------------------------------------------------------------------
// The four cases the ticket names, driven through the real hook.
// ---------------------------------------------------------------------------

test('a fenced doppler block fails the stop', () => {
  const { code, stderr } = runHook(
    `Here is how to list the Delray pages:\n\n${fenced('doppler run -- node scripts/list_pages.mjs', 'bash')}`
  );
  assert.equal(code, 2, 'must refuse the stop');
  assert.match(stderr, /hands the operator a command/i);
  assert.match(stderr, /doppler run -- node scripts\/list_pages\.mjs/);
});

test('the same block with "Exception: secret value" passes', () => {
  const { code } = runHook(
    `You have to run this one -- it prints the real token.\n\n`
    + `Exception: secret value\n\n${fenced('doppler run -- printenv SUPABASE_SERVICE_KEY', 'bash')}`
  );
  assert.equal(code, 0, 'a named exception is the sanctioned way through');
});

test('an inline backtick mention passes', () => {
  const { code } = runHook(
    'I ran `npm run doctor` and the folder is sound; `doppler run` was not needed.'
  );
  assert.equal(code, 0, 'naming a command is not handing it over');
});

test('npm run pipeline -- resume --operator-asked passes', () => {
  const { code } = runHook(
    `The line is paused. Only you can hand the deck back:\n\n`
    + fenced('npm run pipeline -- resume --operator-asked')
  );
  assert.equal(code, 0, 'resume is operator-only by doctrine');
});

// ---------------------------------------------------------------------------
// Break it on purpose: the exception line is what makes the difference.
// ---------------------------------------------------------------------------

test('removing the exception line turns the same reply into a refusal', () => {
  const block = fenced('doppler run -- printenv SUPABASE_SERVICE_KEY', 'bash');
  const withLine = `You have to run this one.\n\nException: secret value\n\n${block}`;
  const withoutLine = `You have to run this one.\n\n${block}`;

  assert.equal(runHook(withLine).code, 0);
  assert.equal(
    runHook(withoutLine).code, 2,
    'if this passes, the exception line is not what is being read'
  );
});

// ---------------------------------------------------------------------------
// Every command shape in the spec.
// ---------------------------------------------------------------------------

test('each handed-over command shape is caught', () => {
  const caught = [
    'doppler run --project starcaster -- node scripts/x.mjs',
    'ssh mac-mini',
    'ssh -p 22 dane@mini',
    'npm run db:refresh',
    'node scripts/check_conventions.cjs',
    'cd ~/WebApps/starcaster && npm run build',
  ];
  for (const command of caught) {
    assert.equal(
      offendingCommands(fenced(command)).length, 1,
      `should have been caught: ${command}`
    );
  }
});

test('near-misses are left alone', () => {
  const allowed = [
    'npm run pipeline -- resume --operator-asked',
    'ssh-keygen -t ed25519',       // local key work, not a hand-off
    'git status',
    'node server.js',              // not node scripts/
    'SELECT * FROM pages;',
    'cd ~/WebApps/normie && ls',   // not this repo's preamble
  ];
  for (const command of allowed) {
    assert.deepEqual(
      offendingCommands(fenced(command)), [],
      `should NOT have been caught: ${command}`
    );
  }
});

test('only the first non-blank line of a block is judged', () => {
  const block = fenced('# a note\nnpm run build');
  assert.deepEqual(
    offendingCommands(block), [],
    'the spec keys off the first line; a comment first is not a hand-off shape'
  );
  assert.equal(offendingCommands(fenced('\n\nnpm run build')).length, 1,
    'blank lines before the command do not hide it');
});

test('a pasted shell prompt does not hide the command', () => {
  assert.equal(offendingCommands(fenced('$ npm run db:refresh')).length, 1);
});

test('an unterminated fence still counts', () => {
  assert.equal(offendingCommands('here:\n```bash\nnpm run db:refresh').length, 1);
});

test('a tilde fence counts too', () => {
  assert.equal(offendingCommands('~~~\nnpm run db:refresh\n~~~').length, 1);
});

// ---------------------------------------------------------------------------
// The exception line itself.
// ---------------------------------------------------------------------------

test('all four exceptions are accepted, and nothing else is', () => {
  for (const word of ['secret value', 'billing', 'browser login', 'decision']) {
    assert.equal(statedException(`Exception: ${word}\n`), word);
  }
  assert.equal(statedException('Exception: I was busy\n'), null);
  assert.equal(statedException('no exception here\n'), null);
});

test('markdown emphasis on the exception line is tolerated', () => {
  assert.equal(statedException('**Exception:** decision — your call\n'), 'decision');
});

test('an exception line inside a code fence does not count', () => {
  const message = fenced('Exception: decision') + '\n' + fenced('npm run db:refresh');
  assert.equal(statedException(message), null, 'an example is not a claim');
  assert.equal(runHook(message).code, 2);
});

// ---------------------------------------------------------------------------
// Scope: headless loop runs have no operator at the other end.
// ---------------------------------------------------------------------------

test('a headless (sdk-cli) run is not touched', () => {
  const message = `Ran the refresh:\n\n${fenced('npm run db:refresh')}`;
  assert.equal(runHook(message, { entrypoint: 'cli' }).code, 2, 'control: fires interactively');
  assert.equal(
    runHook(message, { entrypoint: 'sdk-cli' }).code, 0,
    'nobody is reading a loop transcript live'
  );
});

test('isInteractive only says yes to a terminal session', () => {
  assert.equal(isInteractive('cli'), true);
  assert.equal(isInteractive('sdk-cli'), false);
  assert.equal(isInteractive(null), false);
});

// ---------------------------------------------------------------------------
// Failing open, and not wedging the session.
// ---------------------------------------------------------------------------

test('an unreadable transcript steps aside rather than wedging the turn', () => {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 's-missing',
      cwd: os.tmpdir(),
      transcript_path: path.join(os.tmpdir(), 'does-not-exist-12345.jsonl'),
    }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
});

test('unparseable input steps aside', () => {
  const result = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('SKIP_OPERATOR_HANDOFF=1 stands it down', () => {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'Stop',
      session_id: 's-skip',
      cwd: os.tmpdir(),
      transcript_path: makeTranscript(fenced('npm run db:refresh'), 'cli'),
    }),
    encoding: 'utf8',
    env: { ...process.env, SKIP_OPERATOR_HANDOFF: '1' },
  });
  assert.equal(result.status, 0);
});

test('the stand-down also works from inside a WORKTREE', () => {
  // The regression this exists for: state used to be written to
  // `<toplevel>/.git/`, which is a DIRECTORY only in the main checkout. In a
  // worktree `.git` is a one-line file, so the write failed with ENOTDIR --
  // silently, because it is wrapped in a try/catch -- and the counter never
  // advanced. Every thread in this repo runs in a worktree, so the safety
  // valve was inoperative in exactly the folders that use it. Without the
  // `--absolute-git-dir` fix this test refuses four times instead of three.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ophandoff-wt-'));
  const git = (args, cwd) => spawnSync('git', args, { cwd, stdio: 'ignore' });
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'test'], dir);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  git(['add', '-A'], dir);
  git(['commit', '-m', 'seed'], dir);

  const wt = path.join(dir, 'wt');
  git(['worktree', 'add', wt, '-b', 'topic'], dir);
  assert.ok(fs.statSync(path.join(wt, '.git')).isFile(), 'precondition: .git is a file in a worktree');

  const message = fenced('npm run db:refresh');
  const opts = { sessionId: 'worktree-test', cwd: wt };

  assert.equal(runHook(message, opts).code, 2);
  assert.equal(runHook(message, opts).code, 2);
  assert.equal(runHook(message, opts).code, 2);
  assert.equal(
    runHook(message, opts).code, 0,
    'the refusal counter never persisted in a worktree, so it could never stand down'
  );
});

test('it stands down after three refusals in one session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ophandoff-repo-'));
  spawnSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  const message = fenced('npm run db:refresh');
  const opts = { sessionId: 'wedge-test', cwd: dir };

  assert.equal(runHook(message, opts).code, 2);
  assert.equal(runHook(message, opts).code, 2);
  assert.equal(runHook(message, opts).code, 2);
  assert.equal(
    runHook(message, opts).code, 0,
    'a hook that can wedge a conversation shut is worse than the miss it prevents'
  );
});

// ---------------------------------------------------------------------------
// Transcript reading.
// ---------------------------------------------------------------------------

test('the last assistant message with TEXT is the one read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ophandoff-tr-'));
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'assistant', entrypoint: 'cli', message: { content: [{ type: 'text', text: 'first' }] } }),
    JSON.stringify({ type: 'assistant', entrypoint: 'cli', message: { content: [{ type: 'text', text: 'the real reply' }] } }),
    // The final record is very often a bare tool_use with no text at all.
    JSON.stringify({ type: 'assistant', entrypoint: 'cli', message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] } }),
  ].join('\n') + '\n');

  const turn = lastAssistantTurn(file);
  assert.equal(turn.text, 'the real reply');
  assert.equal(turn.entrypoint, 'cli');
});

test('splitFences keeps prose and blocks apart', () => {
  const { blocks, prose } = splitFences(`before\n${FENCE}\nin here\n${FENCE}\nafter`);
  assert.deepEqual(blocks, ['in here']);
  assert.deepEqual(prose, ['before', 'after']);
});

// ---------------------------------------------------------------------------
// The wiring. A hook script that nothing invokes is dead code that reads as a
// control -- exactly the "check that could silently not run" CLAUDE.md warns
// about. This is the only thing that proves the tripwire is armed.
// ---------------------------------------------------------------------------

test('the hook is registered as a Stop hook in .claude/settings.json', () => {
  const settingsPath = path.join(__dirname, '..', '..', '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

  const stop = (settings.hooks && settings.hooks.Stop) || [];
  const commands = stop.flatMap((entry) => (entry.hooks || []).map((h) => String(h.command || '')));

  assert.ok(
    commands.some((c) => c.includes('scripts/hooks/check_operator_handoff.cjs')),
    'unwired, the tripwire is a file nobody runs'
  );
});

test('the wired command actually points at a file that exists', () => {
  assert.ok(fs.existsSync(HOOK), HOOK);
});
