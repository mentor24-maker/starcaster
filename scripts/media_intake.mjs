#!/usr/bin/env node
/**
 * Media intake — send new Zoom recordings (ticket 86bcfgyxp) and the videos in
 * the Apple Photos album "Studio" (ticket 86bcfgyy6) to the Studio Inbox.
 *
 *   npm run media:intake                               the scheduled pass (launchd runs this every 15 min):
 *                                                      Zoom first, then the Photos album
 *   npm run media:intake -- --backfill zoom            DRY RUN: every older recording, sizes and totals
 *   npm run media:intake -- --backfill zoom --apply    send history, oldest first, at most 5 GB per run
 *
 * The scheduled pass runs on the machine that owns the `media-intake` role
 * (lib/nodeRoles.js — the MacBook, the only machine signed in to the iCloud
 * Drive Zoom writes to). On any other machine it says so and exits 0. Sending
 * history with --apply is Dane's call, asked on an operator card; it is never
 * run by a schedule.
 *
 * Exit: 0 the pass finished and nothing failed; 1 something failed (named) —
 * including CANNOT READ PHOTOS, which is never reported as "0 new videos";
 * 2 usage; 3 skipped — another run holds the lock. scripts/run_media_intake.sh
 * turns 0 into a heartbeat, 3 into nothing at all (a skipped pass is not a
 * clean one, so it must not beat — a lock that never lets go then shows up as
 * a role gone quiet), and anything else into a bus post.
 *
 * Settings (all optional):
 *   MEDIA_INTAKE_ZOOM_ROOT    the Zoom folder            (default: iCloud Drive › Documents › Zoom)
 *   MEDIA_INTAKE_STATE_DIR    ledger + lock folder       (default: ~/Library/Application Support/starcaster-media-intake)
 *   MEDIA_INTAKE_REMOTE       the rclone remote          (default: gdrive: — mentorofaio's Drive)
 *   STUDIO_DRIVE_INBOX_FOLDER_ID                         (default: the Inbox id in docs/STUDIO.md)
 *   RCLONE_BIN                                           (default: rclone on PATH)
 *   MEDIA_INTAKE_PHOTOS_LIBRARY  the Photos library      (default: ~/Pictures/Photos Library.photoslibrary)
 *   OSXPHOTOS_BIN                                        (default: osxphotos on PATH, else ~/.local/bin/osxphotos — where pipx puts it)
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
const photosLibrary = env('MEDIA_INTAKE_PHOTOS_LIBRARY', intake.defaultPhotosLibrary());
// launchd's PATH does not include ~/.local/bin, which is where pipx installs.
const pipxOsxphotos = path.join(os.homedir(), '.local', 'bin', 'osxphotos');
const onPath = spawnSync('/bin/sh', ['-c', 'command -v osxphotos'], { encoding: 'utf8' }).stdout.trim();
const osxphotosBin = env('OSXPHOTOS_BIN', onPath || (fs.existsSync(pipxOsxphotos) ? pipxOsxphotos : 'osxphotos'));

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

// A time limit, because osxphotos was measured hanging silently with no
// output at all when macOS blocks the library (2026-10-09).
function runProcess(bin, args, { timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ status: 127, stdout: '', stderr: String(err && err.message) });
      return;
    }
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs) : null;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ status: err && err.code === 'ENOENT' ? 127 : 1, stdout, stderr: `${stderr}${err && err.message}` });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ status: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

const runRclone = (args) => runProcess(rcloneBin, args);

const uploader = intake.rcloneUploader({
  run: runRclone,
  remote: env('MEDIA_INTAKE_REMOTE', 'gdrive:'),
  folderId: env('STUDIO_DRIVE_INBOX_FOLDER_ID', intake.DEFAULT_INBOX_FOLDER_ID),
});

let lock = { ok: true, release() {} };
if (!backfill || flag('apply')) {
  lock = intake.acquireLock(stateDir);
  if (!lock.ok) {
    say(`SKIPPED — another media-intake run (pid ${lock.holder}) is still going; leaving this pass to it.`);
    process.exit(3);
  }
  if (lock.tookOver) say(`took over a leftover lock from pid ${lock.tookOver.holder}: ${lock.tookOver.why}.`);
  // launchd stops a job with SIGTERM (at shutdown, or on --uninstall), and
  // node's default for that signal exits without reaching the `finally` below.
  for (const [signal, status] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) {
    process.once(signal, () => {
      lock.release();
      say(`stopped by ${signal} — lock released; the next pass carries on from the ledger.`);
      process.exit(status);
    });
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
    // Two sources, one after the other (they share the ledger). A failure in
    // one does not stop the other; either one makes the pass exit 1.
    try {
      const report = await intake.runPass({ root, ledgerFile, uploader });
      say(intake.renderPass(report).split('\n').join(`\n[${stamp()}] `));
      if (report.failed.length) code = 1;
    } catch (err) {
      console.error(`[${stamp()}] media-intake Zoom FAILED: ${err && err.message}`);
      code = 1;
    }
    try {
      const report = await intake.runPhotos({
        photos: intake.osxphotosAdapter({ run: runProcess, library: photosLibrary, bin: osxphotosBin }),
        ledgerFile,
        uploader,
        stagingDir: path.join(stateDir, 'photos-export'),
      });
      say(intake.renderPhotos(report).split('\n').join(`\n[${stamp()}] `));
      if (report.failed.length) code = 1;
    } catch (err) {
      // PhotosUnreadable already reads "CANNOT READ PHOTOS — <why>" and carries the fix.
      console.error(`[${stamp()}] ${err && err.fix ? '' : 'media-intake Photos FAILED: '}${err && err.message}`);
      if (err && err.fix) console.error(`[${stamp()}]   FIX: ${err.fix}`);
      code = 1;
    }
  }
} catch (err) {
  console.error(`[${stamp()}] media-intake FAILED: ${err && err.message}`);
  code = 1;
} finally {
  lock.release();
}
process.exit(code);
