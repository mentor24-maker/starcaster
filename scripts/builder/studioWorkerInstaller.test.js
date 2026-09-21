'use strict';

/**
 * scripts/install_studio_worker.sh — the reading that said "not loaded" about a
 * loaded job.
 *
 * `launchctl list | grep -q "$LABEL"` under `set -o pipefail` is wrong 10 times
 * out of 10: `grep -q` exits on the first match, `launchctl` takes SIGPIPE and
 * exits 141, and pipefail hands that 141 to the `if`. The consequence was not
 * cosmetic — the `loaded: yes — PID` line could never print, and the status
 * told a reader on the Mini that a running daemon "has never run on this
 * machine". Round 2 of 86bbjv68y.
 *
 * THESE TESTS RUN THE FILE'S OWN BYTES. The shell functions are cut out of the
 * script by name and evaluated as they are written there — checking a
 * hand-copied version would be checking the copy, which is the mistake the
 * script's own `--print-plist` comment already warns about.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'install_studio_worker.sh');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

/** Cut one `name() { ... }` block out of the script, verbatim. */
function functionBody(name) {
  const start = SOURCE.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name}() is not in ${SCRIPT} — this test is asserting about a function that no longer exists`);
  const end = SOURCE.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name}() has no closing brace at column 0`);
  return SOURCE.slice(start, end + 3);
}

/** Every line that is actually shell, with comments and blanks dropped. */
function codeLines() {
  return SOURCE.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

test('nothing pipes `launchctl list` into grep — that pipe is the false "not loaded"', () => {
  // Anchored on the STRUCTURE (a pipe off launchctl) rather than on any phrase,
  // so a reworded comment cannot silently retire the check and a reintroduced
  // pipe cannot hide behind different spacing.
  // `||` is an OR, not a pipe: it is stripped first so `launchctl list || true`
  // — which starts no second process and can SIGPIPE nothing — is not flagged.
  const offenders = codeLines()
    .map((l) => l.replace(/\|\|/g, ' '))
    .filter((l) => /launchctl\s+list[^|]*\|/.test(l));
  assert.deepEqual(offenders, [],
    'a pipe straight off `launchctl list` SIGPIPEs it, and pipefail turns that into "not loaded"');
});

test('the loaded check asks launchctl about the one label, which takes no pipe', () => {
  const body = functionBody('is_loaded');
  assert.match(body, /launchctl\s+list\s+"\$LABEL"/,
    'it must name the label as an argument — that form exits non-zero when absent and cannot lose a pipe race');
  assert.doesNotMatch(body, /\|/, 'and it must not pipe at all');
});

test('the status output asks is_loaded, in BOTH places, rather than re-rolling the check', () => {
  // Two call sites drifted apart once already (one printed the PID line, the
  // other decided whether "the daemon has never run here" was true).
  const calls = codeLines().filter((l) => /^if is_loaded; then$/.test(l));
  assert.equal(calls.length, 2, 'both readings go through the one function');
});

test('a label that IS loaded reports as loaded — the script\'s own bytes, against a real one', (t) => {
  if (os.platform() !== 'darwin') {
    // Stated, not silent: a skip that does not say why reads as a pass.
    t.skip('launchctl exists only on macOS, so this reading cannot be taken here');
    return;
  }

  const listed = execFileSync('launchctl', ['list'], { encoding: 'utf8' }).split('\n');
  // Column 3 is the label; take one that is genuinely loaded right now.
  const real = listed.slice(1).map((l) => l.split('\t')[2]).find((l) => l && l.startsWith('com.apple.'));
  assert.ok(real, 'this machine has no loaded launchd label to test against');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-installer-'));
  const probe = path.join(dir, 'probe.sh');
  fs.writeFileSync(probe, [
    '#!/bin/bash',
    // The same three options the real script runs under — pipefail is what
    // turned the SIGPIPE into a wrong answer, so testing without it would test
    // nothing.
    'set -euo pipefail',
    `LABEL=${JSON.stringify(real)}`,
    functionBody('is_loaded'),
    functionBody('loaded_row'),
    'hits=0',
    'for _ in 1 2 3 4 5 6 7 8 9 10; do if is_loaded; then hits=$((hits + 1)); fi; done',
    'echo "hits=$hits"',
    'echo "row=$(loaded_row)"',
  ].join('\n'));

  const out = execFileSync('bash', [probe], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });

  assert.match(out, /hits=10/,
    `${real} is loaded right now, so is_loaded must say so every time — the old pipe said no 10/10`);
  assert.ok(out.includes(`row=`) && out.includes(real),
    'and the summary row names the label, so the `loaded: yes — PID` line has something to print');
});
