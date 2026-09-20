'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ANY,
  KNOWN_NODES,
  ROLES,
  checkRole,
  isKnownNode,
  normalizeNodeName,
  roleOwner,
  rolesOwnedBy,
  thisNode,
} = require('../../lib/nodeRoles.js');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'node-roles-'));
const identityFile = (contents) => {
  const file = path.join(scratch, `id-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(file, contents);
  return file;
};
const MISSING = path.join(scratch, 'nothing-is-here');

// --- who am I ---------------------------------------------------------------

test('an explicit identity file beats the hostname', () => {
  const node = thisNode({ identityFile: identityFile('mac-mini\n'), hostname: 'Danes-MacBook-Pro.local' });
  assert.equal(node.name, 'mac-mini');
  assert.equal(node.source, 'file');
});

test('with no identity file, the hostname answers — normalised', () => {
  const node = thisNode({ identityFile: MISSING, hostname: 'Danes-MacBook-Pro.local' });
  assert.equal(node.name, 'danes-macbook-pro');
  assert.equal(node.source, 'hostname');
});

test('the identity file may explain itself in comments and blank lines', () => {
  const file = identityFile('# which machine this is\n\n  Mac Mini  \n');
  assert.equal(thisNode({ identityFile: file, hostname: 'irrelevant' }).name, 'mac-mini');
});

test('an empty identity file falls through to the hostname rather than claiming to be nobody', () => {
  const file = identityFile('\n# nothing declared\n');
  assert.equal(thisNode({ identityFile: file, hostname: 'mac-mini' }).name, 'mac-mini');
});

test('normalising is forgiving about how a name is written, not about which name it is', () => {
  assert.equal(normalizeNodeName('  MAC-MINI\n'), 'mac-mini');
  assert.equal(normalizeNodeName('mac mini'), 'mac-mini');
  assert.equal(normalizeNodeName('mac-mini.local'), 'mac-mini');
  assert.equal(normalizeNodeName('macmini'), 'macmini'); // a DIFFERENT name, not a typo it silently fixes
  assert.equal(normalizeNodeName(null), '');
});

// --- the guard --------------------------------------------------------------

test('the owning machine may run its job', () => {
  const verdict = checkRole('db-refresh', { node: { name: 'macbook-pro', source: 'file', file: MISSING } });
  assert.equal(verdict.verdict, 'owned');
  assert.equal(verdict.owned, true);
});

test('a known machine that is not the owner is told who owns it, and it is not an error', () => {
  const verdict = checkRole('db-refresh', { node: { name: 'mac-mini', source: 'file', file: MISSING } });
  assert.equal(verdict.verdict, 'other-node');
  assert.equal(verdict.owned, false);
  assert.match(verdict.message, /macbook-pro/);
  assert.equal(verdict.owner, 'macbook-pro');
});

// The whole point of the slice. If "I don't know who I am" were folded into
// "I'm not the owner", every job would quietly do nothing on a machine that
// was merely never told its name — a relay that stops relaying and reports
// success. These two cases stay separate forever.
test('a machine that has not been told its name is UNIDENTIFIED, never a quiet non-owner', () => {
  const verdict = checkRole('bus-relay', { homedir: scratch, hostname: 'someones-new-laptop' });
  assert.equal(verdict.verdict, 'unidentified');
  assert.equal(verdict.owned, false);
  assert.notEqual(verdict.verdict, 'other-node');
});

test('the unidentified message says exactly what to type to fix it', () => {
  const verdict = checkRole('bus-relay', { homedir: scratch, hostname: 'someones-new-laptop' });
  assert.match(verdict.message, /echo macbook-pro > /);
  assert.match(verdict.message, /\.alphire-node/);
});

test('a job nobody registered runs nowhere, and says so', () => {
  const verdict = checkRole('deploy-everything', { node: { name: 'mac-mini', source: 'file', file: MISSING } });
  assert.equal(verdict.verdict, 'unknown-role');
  assert.equal(verdict.owned, false);
});

// The spec allows `any` for jobs that genuinely may run anywhere. Nothing in
// the real registry uses it today, so it is exercised against a stand-in
// table rather than left as a branch nobody has ever run.
test('an "any" job runs even on a machine we cannot identify', () => {
  const roles = { 'runs-anywhere': { owner: ANY, why: 'Nothing about it is exclusive to one machine.' } };
  const verdict = checkRole('runs-anywhere', { roles, homedir: scratch, hostname: 'someones-new-laptop' });
  assert.equal(verdict.verdict, 'owned');
  assert.equal(verdict.owned, true);
});

test('an unregistered job is refused even against a stand-in table', () => {
  const roles = { 'runs-anywhere': { owner: ANY, why: 'Nothing about it is exclusive to one machine.' } };
  const verdict = checkRole('deploy-everything', { roles, node: { name: 'mac-mini', source: 'file', file: MISSING } });
  assert.equal(verdict.verdict, 'unknown-role');
  assert.match(verdict.message, /runs-anywhere/);
});

test('role lookup ignores case and stray whitespace', () => {
  assert.equal(roleOwner('  Bus-Relay '), 'mac-mini');
  assert.equal(roleOwner('nope'), null);
});

// --- the registry itself ----------------------------------------------------

test('the three jobs that must never run twice are registered, and none of them is "any"', () => {
  for (const role of ['bus-relay', 'db-refresh', 'loop-build']) {
    assert.ok(ROLES[role], `${role} must be in the registry`);
    assert.notEqual(ROLES[role].owner, ANY, `${role} is exclusive — "any" would defeat the guard`);
  }
});

// A typo in an owner name ("macmini", "macbook pro ") does not fail loudly —
// it makes the job unrunnable on EVERY machine, which reads as "the guard is
// broken" rather than "the table has a typo". Catch it here instead.
test('every registered owner is a machine this system knows, or "any"', () => {
  for (const [role, entry] of Object.entries(ROLES)) {
    assert.ok(
      entry.owner === ANY || isKnownNode(entry.owner),
      `${role} is owned by "${entry.owner}", which is not one of: ${KNOWN_NODES.join(', ')}`,
    );
  }
});

test('every registered job explains why it may only run in one place', () => {
  for (const [role, entry] of Object.entries(ROLES)) {
    assert.ok(String(entry.why || '').length > 20, `${role} needs a plain-English reason`);
  }
});

test('rolesOwnedBy lists what a machine is allowed to do', () => {
  const mini = rolesOwnedBy('mac-mini');
  // `bus-relay` rather than a loop lane: the loops can legitimately move
  // between machines (see the always-on test below), and a test that pins the
  // MECHANISM must not fail because an ownership decision changed. The relay
  // is the stable example — it has never moved and the test below is what
  // would stop it.
  assert.ok(mini.includes('bus-relay'));
  assert.ok(!mini.includes('db-refresh'));
});

test('db-refresh has exactly one owner — the disk-IO budget is one meter', () => {
  const owner = roleOwner('db-refresh');
  assert.notEqual(owner, ANY);
  assert.ok(isKnownNode(owner));
});

// The jobs that carry the operator's own instructions forward have to live on
// the machine that is awake. On 2026-08-23 the relay sat on the laptop, Dane
// answered two tickets at 06:19, and both were still waiting nine hours later
// — nothing errored, the answers just landed where nothing was listening.
// Moving one of these back to a machine with a lid should fail here first.
//
// AMENDED 2026-09-20 (task 86bc3wn1v), and the amendment is the point.
//
// This test caught the loops being moved to the laptop, which is exactly what
// it was written to do. But it was a flat prohibition, and the move was the
// right call: the Mini could not sign in to Claude and could not be reached to
// fix it for eleven days, so "the always-on machine" was running nothing at
// all. A rule that cannot express "deliberately, for now, for this reason"
// gets deleted the first time it is inconvenient — and then it is not there
// for the accidental move it was really written against.
//
// So the guard is now about the RECORD rather than the value. A lane may sit
// on a machine with a lid, but only if `lib/nodeRoles.js` says out loud that
// it is temporary and names the ticket that will move it back. An undocumented
// move still fails here, which is the case from 2026-08-23: the relay sat on
// the laptop, Dane answered two tickets at 06:19, and both were still waiting
// nine hours later — nothing errored, the answers just landed where nothing
// was listening.
//
// `bus-relay` keeps the flat rule. It is the job that carries Dane's own words
// to the machines, it has never moved, and nothing about the Mini being
// unreachable makes the laptop a better place for it.
test('the relay that carries Dane\'s answers forward lives on the always-on machine', () => {
  assert.equal(
    roleOwner('bus-relay'),
    'mac-mini',
    'bus-relay moves the operator\'s instructions along; on a machine that sleeps, it stops',
  );
});

test('a loop lane on a machine with a lid has to say it is temporary and name its way back', () => {
  const ALWAYS_ON = 'mac-mini';
  for (const role of ['loop-build', 'loop-review']) {
    const owner = roleOwner(role);
    if (owner === ALWAYS_ON) continue;

    const why = String(ROLES[role]?.why || '');
    assert.match(
      why,
      /TEMPORARY/,
      `${role} is on ${owner}, which sleeps. That is allowed, but lib/nodeRoles.js has to say `
        + 'TEMPORARY so the next reader knows it is an exception and not the settled answer.',
    );
    assert.match(
      why,
      /\b86[a-z0-9]{7}\b/,
      `${role} is on ${owner} without naming the ticket that moves it back. An exception with no `
        + 'route home is a permanent change wearing the word "temporary".',
    );
    assert.match(
      why,
      new RegExp(`back to ${ALWAYS_ON}`, 'i'),
      `${role} is on ${owner} without saying where it returns to. Name the machine, so restoring `
        + 'it is a lookup rather than an act of memory.',
    );
  }
});
