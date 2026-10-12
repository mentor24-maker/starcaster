#!/usr/bin/env node
/**
 * The IO half of scripts/builder/loopPolicy.js — one Claude limit shared by
 * every loop lane on this machine and by Dane (task 86bcgjbfk).
 *
 *   node scripts/loop_policy.mjs check --lane <name>
 *       prints ONE line: `<run|quiet|stand-down> <seconds> <sentence>`.
 *       The runner reads it with `read -r action seconds line`.
 *   node scripts/loop_policy.mjs stand-down --lane <name> --seconds <n> [--reason "..."]
 *       record a usage limit this lane just read, so the other lanes sleep
 *       until it resets instead of hitting it themselves. Never shortens a
 *       stand-down another lane already wrote.
 *   node scripts/loop_policy.mjs status
 *       the `policy:` line install_loop_runner.sh --status shows.
 *
 * The files live in ~/loop-logs because that is the one folder BOTH repos'
 * runners already write to (LOOP_POLICY_DIR overrides it, for tests):
 *
 *   ~/loop-logs/loops.policy     {"quietWindow": {"days":"weekdays","start":"08:00","end":"18:00"}}
 *                                ({"quietWindow": null} turns the window off)
 *   ~/loop-logs/loops.standdown  written by the lanes; delete it to lift a stand-down
 *
 * NOTHING HERE MAY FAIL THE RUNNER. Every problem prints a note to stderr
 * (which the runner appends to its log) and `check` answers `run 0` — the
 * rule is failure-open, because a bug that silences two repos' loops is worse
 * than four lanes sharing a limit badly. Exit is always 0.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const policy = require('./builder/loopPolicy.js');

const DIR = process.env.LOOP_POLICY_DIR || path.join(os.homedir(), 'loop-logs');
const POLICY_FILE = path.join(DIR, 'loops.policy');
const MARKER_FILE = path.join(DIR, 'loops.standdown');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? '' : String(process.argv[i + 1] || '');
}

/** File text, null when absent; an unreadable file is a note and null. */
function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[loop-policy] could not read ${file} (${err.message}) — treating it as absent`);
    return null;
  }
}

function nowMs() {
  // LOOP_POLICY_NOW lets the by-hand proof in the ticket ("set the window to
  // now and watch one cycle") be rehearsed without waiting for a real hour.
  const forced = Date.parse(process.env.LOOP_POLICY_NOW || '');
  return Number.isFinite(forced) ? forced : Date.now();
}

const cmd = process.argv[2] || '';
try {
  if (cmd === 'check') {
    const v = policy.policyVerdict({ policyText: readOrNull(POLICY_FILE), markerText: readOrNull(MARKER_FILE), nowMs: nowMs() });
    for (const n of v.notes) console.error(`[loop-policy] ${n}`);
    console.log(v.line ? `${v.action} ${v.sleepSeconds} ${v.line}` : `${v.action} ${v.sleepSeconds}`);
  } else if (cmd === 'stand-down') {
    const lane = arg('lane') || 'an unnamed lane';
    const text = policy.standDownText({
      lane, sleepSeconds: Number(arg('seconds')), reason: arg('reason'),
      existingText: readOrNull(MARKER_FILE), nowMs: nowMs(),
    });
    if (!text) {
      console.error('[loop-policy] a stand-down at least this long is already recorded (or no time was given) — leaving it');
    } else {
      fs.mkdirSync(DIR, { recursive: true });
      // Write-then-rename, so a lane reading at the same instant sees the old
      // marker or the new one, never half of one.
      const tmp = `${MARKER_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, MARKER_FILE);
      const until = Date.parse(JSON.parse(text).until);
      console.error(`[loop-policy] recorded a stand-down for every lane until ${policy.instantText(until)} (set by ${lane})`);
    }
  } else if (cmd === 'status') {
    console.log(policy.describePolicy({ policyText: readOrNull(POLICY_FILE), markerText: readOrNull(MARKER_FILE), nowMs: nowMs() }));
  } else {
    console.error('usage: loop_policy.mjs check --lane <name> | stand-down --lane <name> --seconds <n> [--reason ...] | status');
  }
} catch (err) {
  console.error(`[loop-policy] failed (${err?.message || err}) — answering "run 0": an unreadable rule runs the loops as before`);
  if (cmd === 'check') console.log('run 0');
}
process.exit(0);
