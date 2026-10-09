#!/usr/bin/env node
/**
 * Media intake — send new Zoom recordings to the Studio Inbox (ticket 86bcfgyxp).
 *
 *   npm run media:intake                               the scheduled pass (launchd runs this every 15 min)
 *   npm run media:intake -- --backfill zoom            DRY RUN: every older recording, sizes and totals
 *   npm run media:intake -- --backfill zoom --apply    send history, oldest first, at most 5 GB per run
 *
 * The scheduled pass runs on the machine that owns the `media-intake` role
 * (lib/nodeRoles.js — the MacBook, the only machine signed in to the iCloud
 * Drive Zoom writes to). On any other machine it says so and exits 0. Sending
 * history with --apply is Dane's call, asked on an operator card; it is never
 * run by a schedule.
 *
 * Exit: 0 the pass finished and nothing failed; 1 something failed (named);
 * 2 usage. scripts/run_media_intake.sh turns 0 into a heartbeat and anything
 * else into a bus post.
 *
 * Settings (all optional):
 *   MEDIA_INTAKE_ZOOM_ROOT    the Zoom folder            (default: iCloud Drive › Documents › Zoom)
 *   MEDIA_INTAKE_STATE_DIR    ledger + lock folder       (default: ~/Library/Application Support/starcaster-media-intake)
 *   MEDIA_INTAKE_REMOTE       the rclone remote          (default: gdrive: — mentorofaio's Drive)
 *   STUDIO_DRIVE_INBOX_FOLDER_ID                         (default: the Inbox id in docs/STUDIO.md)
 *   RCLONE_BIN                                           (default: rclone on PATH)
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const intake = require('../lib/mediaIntake.js');
const nodeRoles = require('../lib/nodeRoles.js');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const backfill = arg('backfill');
if (flag('backfill') && backfill !== 'zoom') {
  console.error('--backfill takes one source, and the only one built is: zoom');
  process.exit(2);
}
if (flag('apply') && !backfill) {
  console.error('--apply only means something with --backfill zoom. The scheduled pass always sends.');
  process.exit(2);
}

const env = (k, d) => (String(process.env[k] || '').trim() || d);
const root = env('MEDIA_INTAKE_ZOOM_ROOT', intake.defaultZoomRoot());
const stateDir = env('MEDIA_INTAKE_STATE_DIR', intake.defaultStateDir());
const ledgerFile = path.join(stateDir, 'ledger.json');
const rcloneBin = env('RCLONE_BIN', 'rclone');

const stamp = () => new Date().toISOString();
const say = (line) => console.log(`[${stamp()}] ${line}`);

// The role guard applies to the scheduled pass and to --apply: both write the
// ledger and upload. A dry run only reads, so it may run anywhere.
if (!backfill || flag('apply')) {
  const verdict = nodeRoles.checkRole(intake.ROLE);
  if (verdict.verdict === 'other-node') {
    say(verdict.message.split('\n')[0]);
    process.exit(0);
  }
  if (!verdict.owned) {
    console.error(verdict.message);
    process.exit(1);
  }
}

function runRclone(args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(rcloneBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ status: 127, stdout: '', stderr: String(err && err.message) });
      return;
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => resolve({ status: 127, stdout, stderr: `${stderr}${err && err.message}` }));
    child.on('close', (code) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}

const uploader = intake.rcloneUploader({
  run: runRclone,
  remote: env('MEDIA_INTAKE_REMOTE', 'gdrive:'),
  folderId: env('STUDIO_DRIVE_INBOX_FOLDER_ID', intake.DEFAULT_INBOX_FOLDER_ID),
});

let lock = { ok: true, release() {} };
if (!backfill || flag('apply')) {
  lock = intake.acquireLock(stateDir);
  if (!lock.ok) {
    say(`another media-intake run (pid ${lock.holder}) is still going — leaving this pass to it.`);
    process.exit(0);
  }
}

let code = 0;
try {
  if (backfill) {
    const plan = await intake.runBackfill({
      root,
      ledgerFile,
      uploader,
      apply: flag('apply'),
      // `brctl download` asks iCloud to fetch the bytes and returns at once; a
      // later run sends the file once it is all here.
      requestDownload: (p) => spawnSync('brctl', ['download', p], { stdio: 'ignore' }),
    });
    console.log(intake.renderBackfill(plan));
    if (plan.failed.length) code = 1;
  } else {
    const report = await intake.runPass({ root, ledgerFile, uploader });
    say(intake.renderPass(report).split('\n').join(`\n[${stamp()}] `));
    if (report.failed.length) code = 1;
  }
} catch (err) {
  console.error(`[${stamp()}] media-intake FAILED: ${err && err.message}`);
  code = 1;
} finally {
  lock.release();
}
process.exit(code);
