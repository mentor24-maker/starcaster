'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { KINDS, SCHEDULED_LAUNCHERS, callerKind, isScheduled } = require('../lib/clickupCaller.cjs');

const SCRIPTS = path.join(__dirname, '..');

test('a declared scheduled job is scheduled, and says where the answer came from', () => {
  const out = callerKind({ env: { STARCASTER_CALLER: 'scheduled' } });
  assert.equal(out.kind, 'scheduled');
  assert.equal(out.source, 'STARCASTER_CALLER');
  assert.equal(isScheduled({ env: { STARCASTER_CALLER: 'scheduled' } }), true);
});

test('the marker is read case- and whitespace-insensitively', () => {
  assert.equal(callerKind({ env: { STARCASTER_CALLER: '  Scheduled\n' } }).kind, 'scheduled');
});

/*
 * The default is the operator's decision made mechanical: "You are never
 * blocked by a background job." Being wrong in the scheduled direction blocks
 * a session Dane is sitting in front of; being wrong in the interactive
 * direction costs a background job a little of the reserve. Not symmetric.
 */
test('anything undeclared is interactive, so a session Dane is in is never blocked', () => {
  const out = callerKind({ env: {} });
  assert.equal(out.kind, 'interactive');
  assert.match(out.why, /never blocked/);
});

/*
 * A typo must not read as a declaration — and, just as important, must not be
 * ignored in silence. `STARCASTER_CALLER=schedueld` looks set to whoever typed
 * it, and would otherwise cost an hour of wondering why a job never yields.
 */
test('a misspelled marker is ignored, out loud, and does not become scheduled', () => {
  const out = callerKind({ env: { STARCASTER_CALLER: 'schedueld' } });
  assert.equal(out.kind, 'interactive');
  assert.match(out.why, /schedueld/);
  assert.match(out.why, /ignored/);
});

test('nothing infers the answer from a terminal', () => {
  const src = fs.readFileSync(path.join(SCRIPTS, 'lib', 'clickupCaller.cjs'), 'utf8');
  const code = src.slice(src.indexOf("const KINDS"));
  assert.doesNotMatch(code, /isTTY/, 'a tty answers a different question that merely correlates');
});

// ── The guard the default's cost buys ────────────────────────────────────────

/*
 * Defaulting to `interactive` means a NEW scheduled job that forgets to
 * declare itself silently never yields — the quiet direction, the one nobody
 * notices. `SCHEDULED_LAUNCHERS` is the committed, reviewable list that closes
 * it, exactly the way `lib/nodeRoles.js` is the committed list of exclusive
 * jobs. This test is what makes the list load-bearing rather than decorative.
 */
test('every wrapper launchd runs unattended actually exports the marker', () => {
  for (const [file, row] of Object.entries(SCHEDULED_LAUNCHERS)) {
    const full = path.join(SCRIPTS, file);
    assert.ok(fs.existsSync(full), `${file} is registered as a scheduled launcher but is not in scripts/`);
    const src = fs.readFileSync(full, 'utf8');
    assert.match(
      src,
      /^export STARCASTER_CALLER=scheduled$/m,
      `${file} runs ${row.job} on a schedule but never declares itself — it would spend the reserve `
      + 'kept for the sessions Dane is talking to. Add `export STARCASTER_CALLER=scheduled` near the top.',
    );
  }
});

test('every registered launcher says which job it is and why it counts as scheduled', () => {
  for (const [file, row] of Object.entries(SCHEDULED_LAUNCHERS)) {
    assert.ok(row.job && row.job.length > 2, `${file} has no job name`);
    assert.ok(row.why && row.why.length > 40, `${file} has no reason recorded`);
  }
});

/*
 * The registry has to cover what is actually installed. A wrapper that runs
 * ClickUp work on a schedule but is missing from the table above gets no
 * guard at all — which is the same silence, one level up.
 */
test('no scheduled wrapper in scripts/ is missing from the registry', () => {
  const suspects = fs.readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('.sh'))
    // The installers themselves are not the job — they WRITE the plist that
    // runs the job, and they name their own filename in their own help text,
    // which is why a naive "is it mentioned by an installer" test flags them.
    .filter((f) => !f.startsWith('install_'))
    .filter((f) => {
      const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
      // What makes a file a scheduled ClickUp spender: it reaches ClickUp, and
      // an installer names it inside a ProgramArguments block.
      return /npm run .*(clickup|pulse|heartbeat|throughput|reconcile|repair|report:failure)/.test(src);
    });
  for (const f of suspects) {
    if (!isNamedByAnInstaller(f)) continue;
    assert.ok(
      Object.prototype.hasOwnProperty.call(SCHEDULED_LAUNCHERS, f),
      `${f} is installed as a launchd job and spends ClickUp requests, but is not in SCHEDULED_LAUNCHERS — `
      + 'so nothing checks that it declares itself, and it would never yield.',
    );
  }
});

/**
 * Does an installer put this script into a launchd plist? Scoped to the
 * ProgramArguments block, so a script merely MENTIONED in a comment or a
 * status message is not mistaken for one that is scheduled.
 */
function isNamedByAnInstaller(file) {
  const blocks = readInstallers().match(/<key>ProgramArguments<\/key>[\s\S]{0,600}?<\/array>/g) || [];
  return blocks.some((b) => b.includes(file));
}

/** Every install script's text, concatenated — where plists are written. */
let installerCache = null;
function readInstallers() {
  if (installerCache !== null) return installerCache;
  installerCache = fs.readdirSync(SCRIPTS)
    .filter((f) => f.startsWith('install_') && f.endsWith('.sh'))
    .map((f) => fs.readFileSync(path.join(SCRIPTS, f), 'utf8'))
    .join('\n');
  return installerCache;
}

test('KINDS is the whole vocabulary — a third kind would need a decision, not a string', () => {
  assert.deepEqual(KINDS, ['scheduled', 'interactive']);
});
