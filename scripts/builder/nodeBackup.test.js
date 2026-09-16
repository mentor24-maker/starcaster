'use strict';

/**
 * Tests for lib/nodeBackup.js — the node backup inventory and its verdicts.
 *
 * Everything under test is a pure function over data the caller read, so these
 * drive every branch with no machine, no clock, no network and no token.
 *
 * The tests that matter most here are the REFUSALS. A backup tool's dangerous
 * failure is not crashing — it is answering "fine" about a machine it did not
 * look at, or letting a credential into an archive. Both are graded below.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BACKUP_REPO,
  CAPTURE,
  EXCLUDED,
  STALE_AFTER_MS,
  backupDue,
  freshnessReport,
  humanBytes,
  nodeFolder,
  renderManifest,
  scanForSecrets,
  tailWithNotice,
} = require('../../lib/nodeBackup.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// --- the inventory itself ---------------------------------------------------

test('every capture item states why it cannot simply be rebuilt', () => {
  // The `why` field is the whole gate on this list growing. An item that cannot
  // say why it is irreplaceable belongs in GitHub, Doppler or Supabase, and
  // adding it here instead is how a backup grows until nobody reads its
  // manifest — which is the same as not having one.
  for (const item of CAPTURE) {
    assert.ok(item.id, 'every item needs an id');
    assert.ok(item.title, `${item.id} needs a title a person can read`);
    assert.ok(item.why && item.why.length > 60, `${item.id} needs a real reason it is irreplaceable`);
  }
});

test('every capture item that matches by pattern also says so in plain words', () => {
  // A manifest that prints a regular expression at a reader has stopped
  // explaining itself. The operator is the reader.
  for (const item of CAPTURE.filter((i) => i.kind === 'glob')) {
    assert.ok(item.matchText, `${item.id} matches by pattern and must describe it in words`);
    assert.ok(!/[\\^$*+?()[\]{}|]/.test(item.matchText), `${item.id}'s description reads like a pattern, not a sentence`);
  }
});

test('every excluded credential names the command that replaces it', () => {
  // The cost of the secrets boundary is four logins somebody types. That cost
  // is only acceptable if the archive SAYS which four — a known gap is a plan,
  // an unstated one is a surprise on the worst morning.
  for (const e of EXCLUDED) {
    assert.ok(e.what, 'every exclusion names what is missing');
    assert.ok(e.instead, `${e.id} must say what to do instead`);
    assert.ok(e.why && e.why.length > 30, `${e.id} must say why it is not carried`);
  }
});

test('each machine gets its own folder, so two machines can never collide', () => {
  assert.equal(nodeFolder('mac-mini'), 'nodes/mac-mini');
  assert.notEqual(nodeFolder('mac-mini'), nodeFolder('macbook-pro'));
  assert.ok(BACKUP_REPO.includes('/'), 'the backup repo is an owner/name pair');
});

// --- the secret scan --------------------------------------------------------

test('the scan catches the credential shapes that actually exist in this system', () => {
  const cases = [
    ['-----BEGIN OPENSSH PRIVATE KEY-----\nabc', 'a private key block'],
    ['export ANTHROPIC_API_KEY=sk-ant-api03-AAAAbbbbCCCCdddd', 'an Anthropic API key'],
    ['GH_TOKEN=ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'a GitHub token'],
    ['token: dp.pt.AbCdEfGhIjKlMnOp', 'a Doppler token'],
    ['SUPABASE_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig', 'a JSON web token'],
    ['xoxb-1234567890-abcdefghij', 'a Slack token'],
    ['key=AIzaSyA1234567890abcdefghijklmnopqrstuv', 'a Google API key'],
  ];
  for (const [text, expected] of cases) {
    const hits = scanForSecrets(text);
    assert.ok(hits.length, `should have caught ${expected} in ${JSON.stringify(text.slice(0, 40))}`);
    assert.ok(hits.some((h) => h.name === expected), `expected ${expected}, got ${hits.map((h) => h.name).join(', ')}`);
  }
});

test('the scan never reproduces the secret it found', () => {
  // A finding that quotes the value has moved the value into a log, a manifest
  // and an agent session's transcript. Position only, deliberately.
  const secret = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  const hits = scanForSecrets(`GH_TOKEN=${secret}`);
  assert.ok(hits.length);
  const serialized = JSON.stringify(hits);
  assert.ok(!serialized.includes(secret), 'the matched text must never leave the scanner');
});

test('the scan does not fire on the shapes that are NOT secrets', () => {
  // False positives cost a line in the manifest and a person's attention, and a
  // scan that cries wolf gets routed around. These are the ones that came up
  // while building it.
  const clean = [
    'SUPABASE_SERVICE_KEY=',                                   // an empty .env.example line
    'export PATH="/opt/homebrew/bin:$PATH"',
    '# set your API_KEY in Doppler, never here',
    'const TOKEN_RE = /token/;',
    'SESSION_SECRET: process.env.SESSION_SECRET',              // a reference, not a value
  ];
  for (const text of clean) {
    assert.deepEqual(scanForSecrets(text), [], `should not have fired on ${JSON.stringify(text)}`);
  }
});

test('the scan handles nothing at all without throwing', () => {
  assert.deepEqual(scanForSecrets(''), []);
  assert.deepEqual(scanForSecrets(null), []);
  assert.deepEqual(scanForSecrets(undefined), []);
});

// --- freshness: three states, never two -------------------------------------

test('a machine that has never been backed up says so', () => {
  const r = freshnessReport({ stamp: null, node: 'mac-mini' });
  assert.equal(r.state, 'NEVER');
  assert.ok(r.fix);
});

test('a recent backup is FRESH', () => {
  const now = Date.now();
  const r = freshnessReport({ stamp: { node: 'mac-mini', at: new Date(now - 2 * HOUR).toISOString(), items: 9 }, now, node: 'mac-mini' });
  assert.equal(r.state, 'FRESH');
});

test('one missed nightly run is NOT an alarm, three are', () => {
  const now = Date.now();
  const stampAt = (ms) => ({ node: 'mac-mini', at: new Date(now - ms).toISOString() });
  // A single missed run is ordinary — a machine asleep, a network blip — and an
  // alarm on the ordinary case is one that gets filtered.
  assert.equal(freshnessReport({ stamp: stampAt(30 * HOUR), now, node: 'mac-mini' }).state, 'FRESH');
  assert.equal(freshnessReport({ stamp: stampAt(STALE_AFTER_MS + HOUR), now, node: 'mac-mini' }).state, 'STALE');
});

test('an unreadable stamp is CANNOT TELL — not fresh, and not an alarm either', () => {
  const r = freshnessReport({ stamp: { node: 'mac-mini', at: 'whenever' }, node: 'mac-mini' });
  assert.equal(r.state, 'CANNOT TELL');
});

test("another machine's stamp says nothing about this machine", () => {
  // The likeliest way a stamp is sitting here at all is a folder copied between
  // Macs. lib/nodeRebootTest.js refuses that record for the same reason.
  const now = Date.now();
  const r = freshnessReport({ stamp: { node: 'macbook-pro', at: new Date(now).toISOString() }, now, node: 'mac-mini' });
  assert.equal(r.state, 'CANNOT TELL');
  assert.ok(r.text.includes('macbook-pro'));
});

test('a stamp that does not say whose it is gets the same refusal', () => {
  // Less claim on this machine than one naming the wrong machine, not more.
  const now = Date.now();
  const r = freshnessReport({ stamp: { at: new Date(now).toISOString() }, now, node: 'mac-mini' });
  assert.equal(r.state, 'CANNOT TELL');
});

test('an unidentified machine gets no verdict at all', () => {
  const now = Date.now();
  const r = freshnessReport({ stamp: { node: 'kitchen-imac', at: new Date(now).toISOString() }, now, node: 'kitchen-imac' });
  assert.equal(r.state, 'CANNOT TELL');
  assert.ok(r.fix.includes('.alphire-node'));
});

test('freshness never answers FRESH for a reading it could not take', () => {
  // The property, stated once over every bad input, because this is the failure
  // that matters: a backup tool reporting health it did not measure.
  const bad = [
    { stamp: null },
    { stamp: {} },
    { stamp: { at: 'nonsense' } },
    { stamp: { node: 'macbook-pro', at: new Date().toISOString() } },
  ];
  for (const input of bad) {
    assert.notEqual(freshnessReport({ ...input, node: 'mac-mini' }).state, 'FRESH');
  }
});

// --- the daily throttle -----------------------------------------------------

test('never backed up is always due', () => {
  assert.equal(backupDue({ lastAt: null }).due, true);
});

test('the relay wakes every ten minutes and the backup runs once a day', () => {
  const now = Date.now();
  assert.equal(backupDue({ lastAt: new Date(now - 10 * 60 * 1000).toISOString(), now }).due, false);
  assert.equal(backupDue({ lastAt: new Date(now - 21 * HOUR).toISOString(), now }).due, true);
});

test('an unreadable last-run stamp is treated as absent, so the backup happens', () => {
  // Failing toward "take a backup" rather than "skip it": a needless backup
  // costs a commit, a skipped one costs the machine.
  assert.equal(backupDue({ lastAt: 'not a date' }).due, true);
});

test('a stamp from the future does not cause a backup on every wake', () => {
  const now = Date.now();
  const r = backupDue({ lastAt: new Date(now + DAY).toISOString(), now });
  assert.equal(r.due, false);
  assert.ok(r.why.includes('clock'));
});

// --- the manifest -----------------------------------------------------------

test('the manifest states what was NOT captured, with a reason, above what was', () => {
  // A sweep that reports only its successes reads as a pass while covering
  // nothing (docs/DOCTRINE.md §3.11). The ordering is part of the contract:
  // the gaps are the part a reader must not scroll past.
  const md = renderManifest({
    node: 'mac-mini',
    takenAt: '2026-09-15T20:00:00.000Z',
    captured: [{ title: 'The machine identity file', files: 1, bytes: 12 }],
    skipped: [{ title: 'The loops’ own logs (recent)', why: 'the folder is not on this machine' }],
    totalBytes: 12,
  });
  assert.ok(md.indexOf('## Not captured, and why') < md.indexOf('## Captured'));
  assert.ok(md.includes('the folder is not on this machine'));
});

test('a manifest with no gaps still has the gaps heading, answered', () => {
  // Otherwise "no skipped section" is ambiguous between nothing missed and the
  // check not having run.
  const md = renderManifest({ node: 'mac-mini', takenAt: 'now', captured: [], skipped: [], totalBytes: 0 });
  assert.ok(md.includes('## Not captured, and why'));
  assert.ok(md.includes('Nothing on the inventory was missed'));
});

test('the manifest always lists the credentials it deliberately does not hold', () => {
  const md = renderManifest({ node: 'mac-mini', takenAt: 'now', captured: [], totalBytes: 0 });
  for (const e of EXCLUDED) assert.ok(md.includes(e.what), `${e.id} must appear in every manifest`);
});

test('the manifest names branches whose commits were on one disk only', () => {
  const md = renderManifest({
    node: 'mac-mini',
    takenAt: 'now',
    captured: [],
    totalBytes: 0,
    gitBundles: [{ repo: 'starcaster', branch: 'studio-drive-watcher', commits: 8 }],
  });
  assert.ok(md.includes('studio-drive-watcher'));
  assert.ok(md.includes('8 commits'));
});

// --- sizes ------------------------------------------------------------------

test('an unmeasured size says so rather than claiming zero', () => {
  // A dry run does not write the git bundles, so it has no size for them. The
  // first version printed that as "0 B", which is not "unmeasured" — it is a
  // specific and wrong claim that there is nothing there.
  assert.equal(humanBytes(null), 'size not measured');
  assert.equal(humanBytes(undefined), 'size not measured');
  assert.equal(humanBytes(0), '0 B');
  assert.equal(humanBytes(1536), '1.5 KB');
});

// --- keeping the backup repo cloneable -------------------------------------

test('a file under the cap is kept whole and is not labelled', () => {
  const r = tailWithNotice('a short log\n', 1024, { name: 'x.log' });
  assert.equal(r.truncated, false);
  assert.equal(r.text, 'a short log\n');
});

test('a file over the cap keeps its RECENT end, not its start', () => {
  // The value in these logs is entirely in the recent end — check A1 of
  // `npm run pulse` reads the last few passes, not the last few months.
  const body = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
  const r = tailWithNotice(body, 2048, { name: 'loop-build.log' });
  assert.equal(r.truncated, true);
  assert.ok(r.text.includes('line 4999'), 'the newest line must survive');
  assert.ok(!r.text.includes('\nline 0\n'), 'the oldest lines are the ones dropped');
});

test('a truncated file SAYS it is truncated, and says how big the original was', () => {
  // A truncated log that looks like a whole log misleads its reader about what
  // they are holding — they scroll to the top and conclude the job started
  // there. Same defect class as a check that could not run reporting a pass.
  const body = 'x'.repeat(200000);
  const r = tailWithNotice(body, 1024, { name: 'loop-review.log' });
  assert.ok(r.truncated);
  assert.ok(r.text.startsWith('***'), 'the notice must be the first thing a reader sees');
  assert.ok(r.text.includes('NOT THE WHOLE FILE'));
  assert.ok(r.text.includes('loop-review.log'), 'the notice names the file');
  assert.ok(/195(\.\d)? KB/.test(r.text), `the notice states the original size, got: ${r.text.slice(0, 300)}`);
});

test('the surviving text starts at a line boundary', () => {
  const body = Array.from({ length: 500 }, (_, i) => `a line of log number ${i}`).join('\n');
  const r = tailWithNotice(body, 300, { name: 'x.log' });
  const firstRealLine = r.text.split('\n').find((l) => !l.startsWith('***') && l.length);
  assert.ok(/^a line of log number \d+$/.test(firstRealLine), `got a mid-line start: ${JSON.stringify(firstRealLine)}`);
});

test('the log item declares a cap, because an uncapped one grows the repo without limit', () => {
  // loop-build.log and loop-review.log are appended to and never rotated. A
  // nightly whole-file copy stores a new multi-megabyte blob every night — about
  // 1.8 GB a year — in the repo whose job is to be cloned quickly onto a
  // replacement Mac. A backup that makes its own recovery slower every day is
  // working against itself.
  const logs = CAPTURE.find((c) => c.id === 'loop-logs');
  assert.ok(logs.tailBytes > 0, 'the loop-logs item must cap what it captures');
  assert.ok(logs.tailBytes <= 1024 * 1024, 'the cap has to actually bound nightly growth');
});

test('tailWithNotice survives nothing at all', () => {
  assert.equal(tailWithNotice(null, 100).text, '');
  assert.equal(tailWithNotice('', 100).truncated, false);
  assert.equal(tailWithNotice('abc', 0).truncated, false);
});
