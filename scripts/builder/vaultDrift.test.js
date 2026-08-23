'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanCitations, checkVaultDrift } = require('./vaultDrift.js');

// ── the pure citation scanner ──────────────────────────────────────────────

test('a dangling citation is flagged, naming the citing file and the missing name', () => {
  const out = scanCitations(
    [{ path: 'doctrine/BOOTSTRAP-CAPACITY.md', content: 'per QUOTA.md and FAKE-DOCTRINE.md' }],
    new Set(['BOOTSTRAP-CAPACITY.md', 'QUOTA.md']),
  );
  assert.deepEqual(out, [{ file: 'doctrine/BOOTSTRAP-CAPACITY.md', missing: 'FAKE-DOCTRINE.md' }]);
});

test('a citation that resolves in the vault is not flagged', () => {
  assert.deepEqual(scanCitations([{ path: 'a.md', content: 'see NODES.md' }], new Set(['NODES.md'])), []);
});

test('a path-prefixed reference is exempt (it belongs to another repo)', () => {
  assert.deepEqual(scanCitations([{ path: 'a.md', content: 'see docs/DOCTRINE.md and lib/X.md' }], new Set()), []);
});

test('known external bare doc names are exempt; unknown bare names are flagged', () => {
  const out = scanCitations(
    [{ path: 'a.md', content: 'LOOP_ENGINEERING.md, SKILL.md, MEMORY.md, and MYSTERY.md' }],
    new Set(),
  );
  assert.deepEqual(out.map((d) => d.missing), ['MYSTERY.md']);
});

test('lowercase and mixed-case names are not treated as doctrine references', () => {
  assert.deepEqual(scanCitations([{ path: 'a.md', content: 'see readme.md and Notes.md' }], new Set()), []);
});

// ── checkVaultDrift against real temp fixture vaults ────────────────────────

function tempVault({ withRemote = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const g = (...args) => execFileSync('git', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'ignore'] });
  g('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'doctrine'));
  fs.writeFileSync(path.join(dir, 'doctrine', 'NODES.md'), '# Nodes\nsee BOOTSTRAP-CAPACITY.md\n');
  fs.writeFileSync(path.join(dir, 'doctrine', 'BOOTSTRAP-CAPACITY.md'), '# Bootstrap\n');
  g('add', '-A'); g('commit', '-q', '-m', 'init');
  let remote;
  if (withRemote) {
    remote = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote], { env });
    g('remote', 'add', 'origin', remote);
    g('push', '-q', '-u', 'origin', 'main');
  }
  return { dir, g, remote, cleanup: () => { fs.rmSync(dir, { recursive: true, force: true }); if (remote) fs.rmSync(remote, { recursive: true, force: true }); } };
}

test('a clean fixture explicitly reports OK (a silent pass is indistinguishable from a check that did not run)', () => {
  const v = tempVault({ withRemote: true });
  try {
    const r = checkVaultDrift(v.dir);
    assert.equal(r.checked, true);
    assert.equal(r.ok, true, `expected clean, got findings: ${r.findings.join(' | ')} / cannotTell: ${r.cannotTell.join(' | ')}`);
    assert.deepEqual(r.findings, []);
  } finally { v.cleanup(); }
});

test('a dangling citation in the real fixture is flagged', () => {
  const v = tempVault({ withRemote: true });
  try {
    fs.writeFileSync(path.join(v.dir, 'doctrine', 'QUOTA.md'), 'grounded in MISSING-CANON.md\n');
    v.g('add', '-A'); v.g('commit', '-q', '-m', 'add quota');
    v.g('push', '-q');
    const r = checkVaultDrift(v.dir);
    assert.ok(r.findings.some((f) => /MISSING-CANON\.md/.test(f) && /QUOTA\.md/.test(f)), r.findings.join(' | '));
  } finally { v.cleanup(); }
});

test('an uncommitted edit is flagged', () => {
  const v = tempVault({ withRemote: true });
  try {
    fs.writeFileSync(path.join(v.dir, 'doctrine', 'NODES.md'), '# Nodes edited, uncommitted\n');
    const r = checkVaultDrift(v.dir);
    assert.ok(r.findings.some((f) => /uncommitted change/.test(f)), r.findings.join(' | '));
  } finally { v.cleanup(); }
});

test('an unpushed commit is flagged', () => {
  const v = tempVault({ withRemote: true });
  try {
    fs.writeFileSync(path.join(v.dir, 'doctrine', 'NEW.md'), '# new canon\n');
    v.g('add', '-A'); v.g('commit', '-q', '-m', 'unpushed canon');
    const r = checkVaultDrift(v.dir);
    assert.ok(r.findings.some((f) => /never sent to GitHub/.test(f)), r.findings.join(' | '));
  } finally { v.cleanup(); }
});

test('no upstream configured is CANNOT TELL, not a pass', () => {
  const v = tempVault({ withRemote: false }); // committed but no remote/upstream
  try {
    const r = checkVaultDrift(v.dir);
    assert.ok(r.cannotTell.some((c) => /no upstream/.test(c)), r.cannotTell.join(' | '));
  } finally { v.cleanup(); }
});

test('a nonexistent vault is CANNOT TELL and never a pass', () => {
  const r = checkVaultDrift('/nonexistent/vault/path/xyz');
  assert.equal(r.checked, false);
  assert.equal(r.ok, false);
  assert.equal(r.findings.length, 0);
  assert.ok(r.cannotTell.some((c) => /not found/.test(c)));
});
