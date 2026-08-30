'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readLedgerFile, writeLedgerFile, saveLedgerIfReadable } = require('./autoMergeLedgerFile');
const { asLedger, ledgerAfterSwitch, killSwitchState, switchSignalsFromLedger } = require('./autoMergeLane');

/**
 * Review round 2 on task 86bbkw2au (2026-08-30): a corrupt ledger was being
 * replaced with an empty one at the end of the pass, which erased a persisted
 * "stop auto-merging" — so the lane halted for one pass and came back ON the
 * next. These tests are the ones that would have caught it.
 */

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'auto-merge-ledger-'));
const T0 = 1_756_000_000_000;

test('a missing ledger is a first run; a corrupt one is a fault', () => {
  const file = path.join(dir(), 'ledger.json');
  const missing = readLedgerFile(file);
  assert.equal(missing.ok, true);
  assert.equal(missing.fresh, true);

  fs.writeFileSync(file, '{"merges": [');
  const corrupt = readLedgerFile(file);
  assert.equal(corrupt.ok, false);
  assert.match(corrupt.why, /could not be read/);
  assert.deepEqual(corrupt.ledger, asLedger(null), 'an unreadable ledger reads as empty — and must therefore never be written back');

  assert.equal(readLedgerFile(null).ok, false, 'no path is a fault too');
});

test('a write is atomic and round-trips', () => {
  const file = path.join(dir(), 'ledger.json');
  const ledger = ledgerAfterSwitch(asLedger(null), { kind: 'stop', at: T0, where: 'on the party line' });
  assert.equal(writeLedgerFile(ledger, file).ok, true);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['ledger.json'], 'no temp file is left behind');
  assert.deepEqual(readLedgerFile(file).ledger, ledger);
  assert.equal(writeLedgerFile(ledger, path.join(file, 'not-a-dir', 'x.json')).ok, false, 'a failed write reports, never throws');
});

test('THE FAIL-SAFE: a corrupt ledger is not overwritten, so a persisted stop survives the pass', () => {
  const file = path.join(dir(), 'ledger.json');
  // Someone said stop. It was written down.
  const stopped = ledgerAfterSwitch(asLedger(null), { kind: 'stop', at: T0, where: 'on ticket 86bbkw2au' });
  assert.equal(writeLedgerFile(stopped, file).ok, true);
  const before = fs.readFileSync(file, 'utf8');

  // A torn write, a stray byte, whatever: the file no longer parses.
  fs.writeFileSync(file, `${before}garbage`);
  const read = readLedgerFile(file);
  assert.equal(read.ok, false);

  // The pass runs on the empty ledger it got back and tries to save it.
  const saved = saveLedgerIfReadable(read, read.ledger);
  assert.equal(saved.ok, false);
  assert.equal(saved.skipped, true);
  assert.match(saved.why, /NOT written/);
  assert.equal(fs.readFileSync(file, 'utf8'), `${before}garbage`, 'the corrupt file is left for a hand to look at, not replaced');

  // And the switch that pass computes from an unreadable ledger is OFF — the
  // pure module's side of the same promise.
  assert.equal(killSwitchState({ signals: switchSignalsFromLedger(read.ledger), readable: read.ok }).state, 'off');
});

test('a clean read saves normally, and a missing path is refused', () => {
  const file = path.join(dir(), 'ledger.json');
  const read = readLedgerFile(file);
  const ledger = ledgerAfterSwitch(asLedger(null), { kind: 'resume', at: T0 });
  assert.equal(saveLedgerIfReadable(read, ledger).ok, true);
  assert.deepEqual(readLedgerFile(file).ledger, ledger);
  assert.equal(saveLedgerIfReadable({ ok: true, file: null }, ledger).ok, false);
});
