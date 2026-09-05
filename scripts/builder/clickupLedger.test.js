'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ledger = require('../lib/clickupLedger.cjs');

const NOW = 1_757_000_000_000; // a fixed millisecond clock; nothing here reads the wall clock

/** A fresh ledger file per case, and a fresh module latch with it. */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clickup-ledger-'));
  ledger._resetForTests();
  return { env: { CLICKUP_LEDGER_PATH: path.join(dir, 'ledger.jsonl') }, dir };
}

// ── The acceptance criteria, one test each ───────────────────────────────────

/*
 * "Two processes on one machine see each other's spend within the same
 * minute." This is the whole reason the record is a file rather than a
 * counter, so it is pinned first. The second `record` call stands in for the
 * second process — the ledger has no notion of who is writing, deliberately,
 * because the budget does not either.
 */
test('two processes on one machine see each other spend within the same minute', () => {
  const { env } = fixture();
  for (let i = 0; i < 30; i += 1) ledger.record({ now: NOW + i, env });
  const seen = ledger.headroom({ now: NOW + 100, env });
  assert.equal(seen.known, true);
  assert.equal(seen.spent, 30);
  assert.equal(seen.remaining, 70);
});

test('spend older than a minute has stopped counting', () => {
  const { env } = fixture();
  for (let i = 0; i < 40; i += 1) ledger.record({ now: NOW - 90_000 + i, env });
  ledger.record({ now: NOW, env });
  const seen = ledger.headroom({ now: NOW + 10, env });
  assert.equal(seen.spent, 1, 'only the recent request is inside the window');
  assert.equal(seen.remaining, 99);
});

/*
 * ClickUp's own header outranks this machine's count, because it is the only
 * reading that can see the OTHER MACHINE. The ledger says 3 spent here; the
 * header says 40 left; the answer must be 40-minus-what-we-spent-since, not
 * 97.
 */
test("ClickUp's own remaining count outranks the local tally, and sees the other machine", () => {
  const { env } = fixture();
  const reset = Math.floor(NOW / 1000) + 30;
  ledger.record({ now: NOW, env, rem: 40, reset, limit: 100 });
  ledger.record({ now: NOW + 1, env });
  ledger.record({ now: NOW + 2, env });
  const seen = ledger.headroom({ now: NOW + 3, env });
  assert.equal(seen.source, 'clickup-header');
  assert.equal(seen.remaining, 38, '40 as ClickUp saw it, minus the 2 requests since');
  assert.notEqual(seen.remaining, 97);
});

test('a header reading from a window that has already reset is not reused', () => {
  const { env } = fixture();
  // The reset instant is in the PAST relative to the reading, so that
  // observation belongs to a minute that is over.
  const reset = Math.floor(NOW / 1000) - 5;
  ledger.record({ now: NOW - 10_000, env, rem: 3, reset, limit: 100 });
  const seen = ledger.headroom({ now: NOW, env });
  assert.equal(seen.source, 'ledger-count');
  assert.equal(seen.remaining, 99, 'one recorded request, and a fresh minute');
});

// ── Fail-safe ────────────────────────────────────────────────────────────────

/*
 * "A stale or unreadable ledger fails SAFE — treat it as budget unknown, do
 * not spend into the reserve." Matching the pipeline pause switch, where an
 * unreadable flag counts as paused.
 */
test('an unreadable ledger is UNKNOWN, and a scheduled job yields on it', () => {
  const { env, dir } = fixture();
  // A directory where the file should be: readFileSync fails with EISDIR,
  // which is neither "missing" nor parseable.
  fs.mkdirSync(env.CLICKUP_LEDGER_PATH);
  const seen = ledger.headroom({ now: NOW, env });
  assert.equal(seen.known, false);
  assert.match(seen.reason, /could not be read/);
  assert.equal(ledger.shouldYield({ kind: 'scheduled', now: NOW, env }).yield, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a ledger holding a request from the future is UNKNOWN — the machine's clock moved", () => {
  const { env } = fixture();
  ledger.record({ now: NOW + 60_000, env });
  const seen = ledger.headroom({ now: NOW, env });
  assert.equal(seen.known, false);
  assert.match(seen.reason, /clock moved/);
});

test('a rate-limit reset minutes into the future is UNKNOWN, not a windfall', () => {
  const { env } = fixture();
  ledger.record({ now: NOW, env, rem: 99, reset: Math.floor(NOW / 1000) + 3600, limit: 100 });
  const seen = ledger.headroom({ now: NOW + 1, env });
  assert.equal(seen.known, false);
});

/*
 * A ledger that cannot be WRITTEN is unknown too, and this is the subtle half:
 * a job that cannot record its own spend does not merely mis-report itself, it
 * makes every other process on the machine read a number that is too small.
 * That is the unsafe direction, so it yields.
 */
test('a ledger that cannot be written makes THIS process unknown', () => {
  const { env, dir } = fixture();
  const nowhere = { CLICKUP_LEDGER_PATH: path.join(dir, 'ledger.jsonl', 'nested', 'x.jsonl') };
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), '');
  const wrote = ledger.record({ now: NOW, env: nowhere });
  assert.equal(wrote.ok, false);
  assert.equal(ledger.headroom({ now: NOW, env }).known, false, 'the latch is per-process, not per-file');
  fs.rmSync(dir, { recursive: true, force: true });
});

/*
 * An ABSENT ledger is NOT unknown. It is the ordinary state of the first
 * process after every reset, and treating it as unknown would make the first
 * scheduled job of every minute yield — the "yields incorrectly, so the relay
 * never completes" failure the ticket's Risk section names.
 */
test('an absent ledger is a full budget, not an unknown one', () => {
  const { env } = fixture();
  const seen = ledger.headroom({ now: NOW, env });
  assert.equal(seen.known, true);
  assert.equal(seen.remaining, ledger.DEFAULT_LIMIT);
  assert.equal(ledger.shouldYield({ kind: 'scheduled', now: NOW, env }).yield, false);
});

test('a torn half-written line costs one request, not the whole reading', () => {
  const { env } = fixture();
  ledger.record({ now: NOW, env });
  fs.appendFileSync(env.CLICKUP_LEDGER_PATH, '{"t":' );
  ledger.record({ now: NOW + 1, env });
  const seen = ledger.headroom({ now: NOW + 2, env });
  assert.equal(seen.known, true);
  assert.equal(seen.spent, 2);
});

// ── Who yields ───────────────────────────────────────────────────────────────

test('a scheduled job yields once the remaining budget reaches the reserve', () => {
  const { env } = fixture();
  for (let i = 0; i < 75; i += 1) ledger.record({ now: NOW + i, env });
  const gate = ledger.shouldYield({ kind: 'scheduled', now: NOW + 80, env });
  assert.equal(gate.yield, true);
  assert.match(gate.why, /25 of 100 ClickUp requests left/);
});

test('one request short of the reserve, a scheduled job keeps going', () => {
  const { env } = fixture();
  for (let i = 0; i < 74; i += 1) ledger.record({ now: NOW + i, env });
  assert.equal(ledger.shouldYield({ kind: 'scheduled', now: NOW + 80, env }).yield, false);
});

/*
 * The operator's decision, and the one thing this whole slice is for: "You are
 * never blocked by a background job."
 */
test('an interactive session is never blocked, however little is left', () => {
  const { env } = fixture();
  for (let i = 0; i < 99; i += 1) ledger.record({ now: NOW + i, env });
  assert.equal(ledger.shouldYield({ kind: 'interactive', now: NOW + 100, env }).yield, false);
  // Not even when the reading cannot be taken at all.
  ledger.record({ now: NOW + 500_000, env });
  assert.equal(ledger.headroom({ now: NOW + 100, env }).known, false);
  assert.equal(ledger.shouldYield({ kind: 'interactive', now: NOW + 100, env }).yield, false);
});

// ── The break-test the ticket asks for, as a permanent test ──────────────────

/*
 * The ticket: "Break-test the reserve: set it to 0, watch the yielding test
 * fail; set it to 100, watch the interactive test fail."
 *
 * Both halves were run by hand and both failed as predicted (recorded in the
 * closing note). They live here as well so the break-test is not a one-time
 * ceremony somebody has to remember to repeat — the reserve is the only thing
 * standing between the two behaviours, and a test that passes with the reserve
 * removed is not testing the reserve.
 */
test('WITH THE RESERVE AT 0 the yielding behaviour disappears — the reserve is what causes it', () => {
  const { env } = fixture();
  for (let i = 0; i < 75; i += 1) ledger.record({ now: NOW + i, env });
  const withReserve = ledger.shouldYield({ kind: 'scheduled', now: NOW + 80, env });
  const without = ledger.shouldYield({ kind: 'scheduled', now: NOW + 80, env: { ...env, CLICKUP_RESERVE: '0' } });
  assert.equal(withReserve.yield, true);
  assert.equal(without.yield, false, 'reserve 0 means a scheduled job spends to the last request');
});

test('WITH THE RESERVE AT 100 nothing scheduled may spend, and interactive is still untouched', () => {
  const { env } = fixture();
  const all = { ...env, CLICKUP_RESERVE: '100' };
  assert.equal(ledger.shouldYield({ kind: 'scheduled', now: NOW, env: all }).yield, true);
  assert.equal(ledger.shouldYield({ kind: 'interactive', now: NOW, env: all }).yield, false);
});

test('an unparseable reserve override falls back to the measured one, never to zero', () => {
  assert.equal(ledger.reserveSize({ CLICKUP_RESERVE: 'lots' }), ledger.DEFAULT_RESERVE);
  assert.equal(ledger.reserveSize({ CLICKUP_RESERVE: '-5' }), ledger.DEFAULT_RESERVE);
  assert.equal(ledger.reserveSize({ CLICKUP_RESERVE: '0' }), 0, 'zero IS a deliberate choice, and is honoured');
});

// ── Housekeeping ─────────────────────────────────────────────────────────────

/*
 * Two bounds, and BOTH are needed. Time alone does not bound a burst: these
 * 6,000 records all land inside a few simulated seconds, so every one of them
 * is "recent" and the age filter drops none. The count bound is what actually
 * holds the file down here.
 */
test('the ledger does not grow without bound, even in one long burst', () => {
  const { env } = fixture();
  for (let i = 0; i < 6000; i += 1) {
    ledger.record({ now: NOW - 3_600_000 + i, env, kind: 'scheduled' });
  }
  const size = fs.statSync(env.CLICKUP_LEDGER_PATH).size;
  assert.ok(size <= ledger.MAX_BYTES, `ledger grew to ${size} bytes, past the ${ledger.MAX_BYTES} cap`);
});

/*
 * And a caller cannot defeat that reasoning by handing in a long `kind`: it is
 * the only free-text field on a record, so it is the only thing that could
 * make MAX_ENTRIES and MAX_BYTES disagree about the file's ceiling.
 */
test('a record cannot be inflated by its caller', () => {
  const { env } = fixture();
  ledger.record({ now: NOW, env, kind: 'x'.repeat(5000) });
  const size = fs.statSync(env.CLICKUP_LEDGER_PATH).size;
  assert.ok(size < 200, `one record took ${size} bytes`);
});

/*
 * The honest limit has to be findable by the next reader, at the definition —
 * the ticket made it an acceptance criterion because a machine-local ledger
 * read as a cross-machine guarantee is a worse bug than no ledger at all.
 */
test('the machine-local limitation is stated where the ledger is defined', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'clickupLedger.cjs'), 'utf8');
  const header = src.slice(0, src.indexOf('const fs ='));
  assert.match(header, /CANNOT SEE THE OTHER MACHINE/);
  assert.match(header, /share no filesystem/);
});
