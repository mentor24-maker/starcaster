'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Reel Spinner 4b (SC-834) — the rough-cut pass on the Mini.
 *
 * Real SQLite queue, real edit-list rules (editList.js) and the real store's
 * step rules (videoEditsStore `stepError`), so an edit can only move the way
 * production lets it. Faked: the catalog, Drive and ffmpeg — the fake ffmpeg
 * writes a file where the real one would, so the pass's own file handling
 * (kept, reused, deleted) is what is tested. Nothing touches the network.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const {
  runRoughCut, enqueueRoughCut, soundShift, filterScript, renderArgs, driveFileName,
  localPathsFor, STAGE_ROUGH_CUT, ROUGH_CUTS_FOLDER, STUDIO_FOLDER_ID,
} = require('../../workers/studio/roughCutPass.js');
const { stepError, keepRangesOrError, UPLOAD_PROBLEM_PREFIX } = require('../../lib/videoEditsStore.js');
const { FAILURES } = require('../../workers/studio/proxy.js');
const daemon = require('../../workers/studio/daemon.js');
const { planBackfill, runBackfill, report: backfillReport } = require('../studio_backfill_roughcuts.cjs');
const { uploadFileResumable } = require('../../lib/googleDrive.js');
const { limitOrError } = require('../../lib/reelSpinnerInput.js');

const PROJECT = 'proj_studio';
const OWNER = 'roughcut-test';
const SRC = 'aaaaaaaa-0000-4000-8000-000000000001';
const ZOOM = 'bbbbbbbb-0000-4000-8000-000000000002';
const GB = 1024 ** 3;

/** A 60-second recording: a word every half second, with a 4-second pause at 10-14 s. */
function recording() {
  const words = [];
  for (let t = 0.1; t < 59.5; t += 0.5) {
    if (t > 10 && t < 14) continue;
    words.push({ start: Math.round(t * 1000) / 1000, end: Math.round((t + 0.35) * 1000) / 1000, word: 'word' });
  }
  return {
    words,
    marks: [{ start: 10, end: 14, kind: 'pause', keep_s: 0.5 }],
    moments: [
      { start_s: 20.1, end_s: 35.45, score: 80, mood: 'calm', quote: 'a good bit' },
      { start_s: 40.1, end_s: 50.45, score: 30, mood: 'calm' },
    ],
  };
}

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-roughcut-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setup(t, { pair = null, momentsStatus = 'done' } = {}) {
  const dir = tmp(t);
  let at = Date.parse('2026-11-18T20:00:00Z');
  const queue = openQueue(path.join(dir, 'queue.sqlite'), { clock: () => at });
  t.after(() => queue.close());
  const advance = (ms) => { at += ms; };
  const derivedDir = path.join(dir, 'derived');
  const proxy = path.join(dir, 'proxy.mp4');
  fs.writeFileSync(proxy, 'picture');
  const zoomProxy = path.join(dir, 'zoom.mp4');
  fs.writeFileSync(zoomProxy, 'sound');
  const rec = recording();
  const edits = [];
  let n = 0;
  const catalog = {
    edits,
    creates: 0,
    getSourceById: async (id) => {
      if (id === SRC) return { ok: true, status: 200, data: { id: SRC, durationS: 60, fps: 30, proxyPath: proxy, localPath: '/cache/Photos - IMG_1962.MOV' } };
      if (id === ZOOM) return { ok: true, status: 200, data: { id: ZOOM, durationS: 70, proxyPath: zoomProxy } };
      return { ok: false, status: 404, error: 'Source not found' };
    },
    getTranscriptBySource: async () => ({ ok: true, status: 200, data: { state: 'done', words: rec.words } }),
    getCutMarksBySource: async () => ({ ok: true, status: 200, data: { state: 'done', marks: rec.marks, durationS: 60 } }),
    getMomentsBySource: async () => ({ ok: true, status: 200, data: { status: momentsStatus, moments: rec.moments } }),
    listAudioPairsForSource: async () => ({ ok: true, status: 200, data: pair ? [pair] : [] }),
    listEditsForSource: async () => ({ ok: true, status: 200, data: edits.map((e) => ({ ...e })) }),
    createEdit: async (sourceId, input) => {
      catalog.creates += 1;
      const ranges = keepRangesOrError(input.keepRanges);
      if (!ranges.ok) return ranges;
      if (edits.some((e) => e.kind === input.kind && (input.kind === 'full' || e.momentIndex === input.momentIndex))) {
        return { ok: false, status: 409, error: 'duplicate key' };
      }
      n += 1;
      const edit = {
        id: `e${n}000000-0000-4000-8000-00000000000${n}`, sourceId, kind: input.kind,
        momentIndex: input.kind === 'short' ? input.momentIndex : null, keepRanges: ranges.value,
        audioSourceId: input.audioSourceId || null, status: 'draft', roughCutDriveFileId: '', error: '',
      };
      edits.push(edit);
      return { ok: true, status: 200, data: { ...edit } };
    },
    refuseMoveTo: '',
    moveEdit: async (id, to, patch = {}) => {
      if (catalog.refuseMoveTo === to) {
        catalog.refuseMoveTo = '';
        return { ok: false, status: 503, error: 'the catalog did not answer' };
      }
      const edit = edits.find((e) => e.id === id);
      if (!edit) return { ok: false, status: 404, error: 'That edit does not exist in this project' };
      const refused = stepError(edit.status, to);
      if (refused) return refused;
      if (to === 'failed' && !patch.error) return { ok: false, status: 400, error: 'error is required' };
      edit.status = to;
      edit.error = to === 'failed' ? patch.error : '';
      if (patch.roughCutDriveFileId) edit.roughCutDriveFileId = patch.roughCutDriveFileId;
      return { ok: true, status: 200, data: { ...edit } };
    },
    getEditById: async (id) => ({ ok: true, status: 200, data: { ...(edits.find((e) => e.id === id) || null) } }),
  };

  const drive = {
    folders: new Map(),
    files: [],
    uploads: 0,
    refuseUpload: '',
    getAccessToken: async () => ({ ok: true, data: { accessToken: 'tok' } }),
    findFolderByName: async (token, parent, name) => ({ ok: true, data: drive.folders.get(`${parent}/${name}`) || null }),
    createFolder: async (token, parent, name) => {
      const made = { id: `folder-${drive.folders.size + 1}`, name };
      drive.folders.set(`${parent}/${name}`, made);
      return { ok: true, data: made };
    },
    // Like real Drive: `size` comes back only when the caller asks for it
    // (lib/googleDrive.js findFileByName's `withSize`). The fake once always
    // returned it, which hid a retry that re-uploaded every time (SC-834 review).
    findFileByName: async (token, parent, name, opts = {}) => {
      const found = drive.files.find((f) => f.parent === parent && f.name === name);
      if (!found) return { ok: true, data: null };
      return { ok: true, data: opts.withSize ? { id: found.id, name: found.name, size: found.size } : { id: found.id, name: found.name } };
    },
    upload: async ({ folderId, fileName, filePath }) => {
      drive.uploads += 1;
      if (drive.refuseUpload) return { ok: false, status: 403, error: drive.refuseUpload };
      const file = { id: `drive-${drive.uploads}`, name: fileName, parent: folderId, size: String(fs.statSync(filePath).size) };
      drive.files.push(file);
      return { ok: true, status: 200, data: file };
    },
  };

  const ffmpegCalls = [];
  const ffmpeg = (args, opts) => {
    ffmpegCalls.push({ args, opts });
    if (args.includes('-version')) return { ok: true, ms: 1 };
    if (ffmpeg.refuse) return { ok: false, reason: FAILURES.FFMPEG_FAILED, detail: ffmpeg.refuse, ms: 5 };
    const out = args[args.length - 1];
    const script = args[args.indexOf('-/filter_complex') + 1];
    ffmpeg.scripts.push(fs.readFileSync(script, 'utf8'));
    fs.writeFileSync(out, Buffer.alloc(1234, 1));
    return { ok: true, ms: 4200 };
  };
  ffmpeg.scripts = [];
  ffmpeg.refuse = '';

  const options = {
    queue, owner: OWNER, catalog, drive, ffmpeg,
    env: { STUDIO_PROJECT_ID: PROJECT, STUDIO_DERIVED_DIR: derivedDir },
    probeDuration: () => 12.5,
    freeBytes: () => ({ ok: true, value: 100 * GB }),
  };
  const run = (extra = {}) => runRoughCut({ ...options, ...extra });
  return { queue, catalog, drive, ffmpeg, ffmpegCalls, options, run, advance, derivedDir, proxy, zoomProxy };
}

function renders(ffmpegCalls) {
  return ffmpegCalls.filter((c) => !c.args.includes('-version'));
}

// ── The acceptance criteria ─────────────────────────────────────────────────

test('edit rows are created once per recording: a full edit and the shorts above the score, and a second run creates none', async (t) => {
  const s = setup(t);
  enqueueRoughCut(s.queue, { sourceId: SRC });
  const first = await s.run();

  assert.equal(first.done.length, 1, JSON.stringify(first));
  assert.equal(first.done[0].created, 2, 'one full edit and one short (the second moment scored 30, under 60)');
  assert.deepEqual(s.catalog.edits.map((e) => [e.kind, e.momentIndex, e.status]), [['full', null, 'review'], ['short', 0, 'review']]);
  assert.equal(s.drive.uploads, 2);
  assert.ok(s.catalog.edits.every((e) => e.roughCutDriveFileId.startsWith('drive-')), 'each edit carries its Drive file id');

  const createsBefore = s.catalog.creates;
  enqueueRoughCut(s.queue, { sourceId: SRC, why: 'again' });
  const second = await s.run();
  assert.equal(second.done.length, 1);
  assert.equal(second.done[0].created, 0, 'a second run creates no edit rows');
  assert.equal(s.catalog.creates, createsBefore, 'and does not even try to');
  assert.equal(s.drive.uploads, 2, 'and renders and uploads nothing: both are already in review');
  assert.equal(renders(s.ffmpegCalls).length, 2);
});

test('the rough cuts go into a Rough cuts folder made inside the Studio folder, named after the recording', async (t) => {
  const s = setup(t);
  enqueueRoughCut(s.queue, { sourceId: SRC });
  await s.run();
  assert.deepEqual([...s.drive.folders.keys()], [`${STUDIO_FOLDER_ID}/${ROUGH_CUTS_FOLDER}`]);
  const names = s.drive.files.map((f) => f.name);
  assert.match(names[0], /^Photos - IMG_1962 — full edit \(e1000000\)\.mp4$/);
  assert.match(names[1], /^Photos - IMG_1962 — short from 0m20s, score 80 \(e2000000\)\.mp4$/);
});

test('the local file is deleted after a confirmed upload', async (t) => {
  const s = setup(t);
  enqueueRoughCut(s.queue, { sourceId: SRC });
  await s.run();
  const dir = path.join(s.derivedDir, 'rough-cuts');
  assert.deepEqual(fs.readdirSync(dir), [], 'no render, sidecar or filter script is left behind');
});

test('a failed render writes failed with the reason, and the job fails so the queue retries it', async (t) => {
  const s = setup(t);
  s.ffmpeg.refuse = 'Invalid data found when processing input';
  enqueueRoughCut(s.queue, { sourceId: SRC });
  const r = await s.run();

  assert.equal(r.failed.length, 1);
  for (const e of s.catalog.edits) {
    assert.equal(e.status, 'failed');
    assert.match(e.error, /ffmpeg could not render it: Invalid data found when processing input/);
  }
  assert.equal(s.drive.uploads, 0);
  const job = s.queue.listJobs({ stage: STAGE_ROUGH_CUT })[0];
  assert.equal(job.state, 'pending', 'retried on the queue backoff');
  assert.equal(job.attempts, 1, 'the attempt was spent: this is the edit\'s fault');
  assert.match(job.lastError, /Invalid data found/);
  assert.deepEqual(fs.readdirSync(path.join(s.derivedDir, 'rough-cuts')), [], 'a failed render leaves no half-written file');
});

test('a failed upload keeps the local render, and the retry uploads it without rendering again', async (t) => {
  const s = setup(t);
  s.drive.refuseUpload = 'The user\'s Drive storage quota has been exceeded.';
  enqueueRoughCut(s.queue, { sourceId: SRC });
  const r = await s.run();

  assert.equal(r.failed.length, 1);
  const full = s.catalog.edits.find((e) => e.kind === 'full');
  assert.equal(full.status, 'failed');
  assert.match(full.error, /rendered, but not uploaded: Drive refused the upload: The user's Drive storage quota/);
  const paths = localPathsFor(s.derivedDir, full.id);
  assert.ok(fs.existsSync(paths.video), 'the render is kept for the next try');
  assert.equal(s.catalog.edits.find((e) => e.kind === 'short').status, 'draft', 'it stopped: a Drive that refused one would refuse the rest');
  assert.equal(renders(s.ffmpegCalls).length, 1);

  // The retry, after the queue's backoff: Drive works again.
  s.drive.refuseUpload = '';
  s.advance(24 * 3600 * 1000);
  const again = await s.run();
  assert.equal(again.done.length, 1, JSON.stringify(again));
  assert.deepEqual(s.catalog.edits.map((e) => e.status), ['review', 'review']);
  assert.equal(renders(s.ffmpegCalls).length, 2, 'the full edit was NOT rendered again — only the short was rendered');
  assert.ok(!fs.existsSync(paths.video), 'and once it was confirmed on Drive, the kept render was deleted');
});

test('an upload whose move to review failed is found on the retry, not uploaded a second time', async (t) => {
  const s = setup(t);
  s.catalog.refuseMoveTo = 'review';
  enqueueRoughCut(s.queue, { sourceId: SRC });
  const r = await s.run();
  assert.equal(r.failed.length, 1, JSON.stringify(r));
  assert.match(r.failed[0].reason, /uploaded to Drive as drive-1, but the edit could not be marked for review/);
  assert.equal(s.drive.uploads, 2, 'the full edit and the short each uploaded once');
  const full = s.catalog.edits.find((e) => e.kind === 'full');
  assert.ok(fs.existsSync(localPathsFor(s.derivedDir, full.id).video), 'the render is kept until the row says review');

  s.advance(24 * 3600 * 1000);
  const again = await s.run();
  assert.equal(again.done.length, 1, JSON.stringify(again));
  assert.equal(s.drive.uploads, 2, 'the retry found its own upload on Drive and sent nothing');
  assert.equal(s.drive.files.length, 2, 'one file per edit in Rough cuts — no second copy');
  assert.equal(full.status, 'review');
  assert.equal(full.roughCutDriveFileId, 'drive-1', 'pointing at the first, and only, upload');
  assert.ok(!fs.existsSync(localPathsFor(s.derivedDir, full.id).video), 'and the kept render went once it was confirmed');
});

test('a partner recording the catalog cannot read releases the job before any edit row is made', async (t) => {
  const pair = {
    sourceAId: SRC, sourceBId: ZOOM, offsetS: -2.5, status: 'done', audioSourceId: ZOOM, chosenBy: 'measured',
  };
  const s = setup(t, { pair });
  const real = s.catalog.getSourceById;
  s.catalog.getSourceById = async (id) => (id === ZOOM ? { ok: false, status: 503, error: 'the catalog did not answer' } : real(id));
  enqueueRoughCut(s.queue, { sourceId: SRC });
  const r = await s.run();
  assert.equal(r.released.length, 1, JSON.stringify(r));
  assert.match(r.released[0].reason, /partner recording .* could not be read: the catalog did not answer/);
  assert.equal(s.catalog.creates, 0, 'no permanent edit row was planned without the partner\'s length');
  assert.equal(renders(s.ffmpegCalls).length, 0);
});

test('findFileByName asks Drive for the size only when told to, so the weekly report\'s request is unchanged', async (t) => {
  const { findFileByName } = require('../../lib/googleDrive.js');
  const seen = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    seen.push(new URL(url).searchParams.get('fields'));
    return { ok: true, status: 200, text: async () => JSON.stringify({ files: [{ id: 'f1', name: 'a.mp4', size: '1234' }] }) };
  };
  t.after(() => { global.fetch = realFetch; });
  const plain = await findFileByName('tok', 'folder', 'a.mp4');
  const sized = await findFileByName('tok', 'folder', 'a.mp4', { withSize: true });
  assert.deepEqual(seen, ['files(id,name)', 'files(id,name,size)']);
  assert.equal(plain.ok, true);
  assert.equal(sized.data.size, '1234');
});

test('a disk too full to render into stops the job without spending an attempt, and leaves the edits as they were', async (t) => {
  const s = setup(t);
  enqueueRoughCut(s.queue, { sourceId: SRC });
  const r = await s.run({ freeBytes: () => ({ ok: true, value: 2 * GB }) });

  assert.equal(r.released.length, 1);
  assert.match(r.released[0].reason, /the disk is too full to render a rough cut: 2\.0 GB free/);
  assert.deepEqual(s.catalog.edits.map((e) => e.status), ['draft', 'draft']);
  assert.equal(renders(s.ffmpegCalls).length, 0);
  const job = s.queue.listJobs({ stage: STAGE_ROUGH_CUT })[0];
  assert.equal(job.attempts, 0);
});

test('an edit left in rendering by a run that died is rendered again rather than stuck', async (t) => {
  const s = setup(t);
  enqueueRoughCut(s.queue, { sourceId: SRC });
  s.ffmpeg.refuse = 'killed';
  await s.run();
  // Simulate a crash mid-render: one edit sits in `rendering`.
  s.catalog.edits[0].status = 'rendering';
  s.ffmpeg.refuse = '';
  s.advance(24 * 3600 * 1000);
  const rep = await s.run();
  const r = rep.done[0] || rep;
  assert.equal(r.outcome, 'done', JSON.stringify(r));
  assert.deepEqual(s.catalog.edits.map((e) => e.status), ['review', 'review']);
});

test('an approved video the upload stopped is never rendered again by a later rough-cut job (SC-842)', async (t) => {
  const s = setup(t);
  enqueueRoughCut(s.queue, { sourceId: SRC });
  await s.run();
  assert.deepEqual(s.catalog.edits.map((e) => e.status), ['review', 'review']);
  // The short was approved, finished, and then YouTube refused it; the full
  // edit was sent back and waits to be re-cut (a draft again).
  const [full, short] = s.catalog.edits;
  const reason = `${UPLOAD_PROBLEM_PREFIX}YouTube refused it (invalid title). Nothing more happens to this video on its own`;
  Object.assign(short, { status: 'failed', error: reason });
  full.status = 'draft';
  const before = renders(s.ffmpegCalls).length;

  s.advance(1000);
  enqueueRoughCut(s.queue, { sourceId: SRC });
  const rep = await s.run();
  const r = rep.done[0] || rep;
  assert.equal(r.outcome, 'done', JSON.stringify(r));
  assert.equal(renders(s.ffmpegCalls).length - before, 1, 'only the draft sibling is rendered');
  assert.deepEqual(r.edits.map((e) => e.editId), [full.id]);
  assert.equal(full.status, 'review');
  assert.equal(short.status, 'failed', 'the refused video stays where the upload left it');
  assert.equal(short.error, reason, 'and its reason is not erased');
});

test('the lease is stretched to cover the render before ffmpeg runs', async (t) => {
  const s = setup(t);
  enqueueRoughCut(s.queue, { sourceId: SRC });
  const leases = [];
  const realHeartbeat = s.queue.heartbeat.bind(s.queue);
  s.queue.heartbeat = (id, owner, opts) => { leases.push(opts.leaseMs); return realHeartbeat(id, owner, opts); };
  await s.run();
  assert.equal(leases.length, 2, 'once per edit');
  assert.ok(leases.every((ms) => ms >= 30 * 60 * 1000), 'at least the 15-minute render floor plus the upload allowance');
});

test('no scored moments, or no working copy on disk, is blocked with the fix', async (t) => {
  const s = setup(t, { momentsStatus: 'failed' });
  enqueueRoughCut(s.queue, { sourceId: SRC });
  const r = await s.run();
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reason, /no scored moments.*Fix: score it/);

  const s2 = setup(t);
  fs.rmSync(s2.proxy);
  enqueueRoughCut(s2.queue, { sourceId: SRC });
  const r2 = await s2.run();
  assert.match(r2.blocked[0].reason, /no working copy on this disk.*Fix: re-run its proxy step/);
  assert.equal(s2.catalog.edits.length, 0);
});

// ── Sound from the other recording ──────────────────────────────────────────

test('an edit using the Zoom recording\'s sound renders it from the Zoom proxy, shifted onto its clock', async (t) => {
  // Zoom started 2.5 s before the iPhone, and runs past its end.
  const pair = {
    sourceAId: SRC, sourceBId: ZOOM, offsetS: -2.5, status: 'done', audioSourceId: ZOOM, chosenBy: 'measured',
  };
  const s = setup(t, { pair });
  enqueueRoughCut(s.queue, { sourceId: SRC });
  const r = await s.run();
  assert.equal(r.done.length, 1, JSON.stringify(r));
  const full = s.catalog.edits.find((e) => e.kind === 'full');
  assert.equal(full.audioSourceId, ZOOM);
  const call = renders(s.ffmpegCalls)[0];
  assert.deepEqual(call.args.filter((a, i) => call.args[i - 1] === '-i'), [s.proxy, s.zoomProxy]);
  const script = s.ffmpeg.scripts[0];
  assert.match(script, /\[1:a\]asplit=/, 'the sound comes from the second input');
  const first = full.keepRanges[0];
  assert.ok(script.includes(`atrim=start=${Math.round((first.start_s + 2.5) * 1000) / 1000}:`), 'on the Zoom clock: Zoom started 2.5 s earlier, so 2.5 s later on it');
});

test('soundShift reads the line-up both ways round, and refuses a sound it cannot place', () => {
  const pair = { sourceAId: SRC, sourceBId: ZOOM, offsetS: 2.5, status: 'done' };
  assert.deepEqual(soundShift(SRC, SRC, [pair]), { ok: true, shiftS: 0 });
  assert.deepEqual(soundShift(SRC, null, []), { ok: true, shiftS: 0 });
  assert.deepEqual(soundShift(SRC, ZOOM, [pair]), { ok: true, shiftS: -2.5 });
  assert.deepEqual(soundShift(ZOOM, SRC, [pair]), { ok: true, shiftS: 2.5 });
  assert.match(soundShift(SRC, ZOOM, []).why, /no line-up with it exists/);
  assert.match(soundShift(SRC, ZOOM, [{ ...pair, status: 'failed', offsetS: null }]).why, /line-up is failed/);
});

test('the filter graph joins every kept stretch, picture and sound in step', () => {
  const script = filterScript({ ranges: [{ start_s: 0, end_s: 1.5 }, { start_s: 3, end_s: 4.25 }] });
  assert.equal(script, [
    '[0:v]split=2[v0][v1];',
    '[0:a]asplit=2[a0][a1];',
    '[v0]trim=start=0:end=1.5,setpts=PTS-STARTPTS[pv0];',
    '[a0]atrim=start=0:end=1.5,asetpts=PTS-STARTPTS[pa0];',
    '[v1]trim=start=3:end=4.25,setpts=PTS-STARTPTS[pv1];',
    '[a1]atrim=start=3:end=4.25,asetpts=PTS-STARTPTS[pa1];',
    '[pv0][pa0][pv1][pa1]concat=n=2:v=1:a=1[outv][outa]',
  ].join('\n'));
  assert.throws(() => filterScript({ ranges: [] }), /no kept stretches/);
  const args = renderArgs({ picturePath: 'p.mp4', soundPath: 'p.mp4', scriptPath: 's.txt', outPath: 'o.mp4' });
  assert.equal(args.filter((a) => a === '-i').length, 1, 'one input when the sound is the picture\'s own');
  assert.ok(args.includes('+faststart'), 'so Drive can play it before it has all downloaded');
});

test('driveFileName names the recording and ends in the edit id', () => {
  const src = { id: SRC, localPath: '/x/IMG_1962.MOV' };
  assert.equal(driveFileName(src, { id: 'abcdef12-zzz', kind: 'full' }), 'IMG_1962 — full edit (abcdef12).mp4');
  assert.equal(driveFileName(src, { id: 'abcdef12-zzz', kind: 'short' }, { start_s: 125.4, score: 77 }), 'IMG_1962 — short from 2m05s, score 77 (abcdef12).mp4');
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test('the daemon runs rough cuts last of all its stages', () => {
  const stages = Object.keys(daemon.STAGE_RUNNERS);
  assert.equal(stages[stages.length - 1], STAGE_ROUGH_CUT);
});

test('the moments pass queues a rough cut when it writes done moments', async (t) => {
  const { momentsJob, enqueueMoments, STAGE_MOMENTS } = require('../../workers/studio/momentsPass.js');
  const dir = tmp(t);
  const queue = openQueue(path.join(dir, 'queue.sqlite'));
  t.after(() => queue.close());
  enqueueMoments(queue, { sourceId: SRC });
  const job = queue.claim(OWNER, { stages: [STAGE_MOMENTS] });
  const rec = recording();
  let saved = null;
  const catalog = {
    getSourceById: async () => ({ ok: true, data: { id: SRC, durationS: 60 } }),
    getTranscriptBySource: async () => ({ ok: true, data: { state: 'done', words: rec.words } }),
    getCutMarksBySource: async () => ({ ok: true, data: { state: 'done', marks: rec.marks, durationS: 60 } }),
    upsertMoments: async (id, data) => { saved = data; return { ok: true, data }; },
    getMomentsBySource: async () => ({ ok: true, data: { ...saved } }),
  };
  const r = await momentsJob({
    queue, job, owner: OWNER, catalog, env: { STUDIO_PROJECT_ID: PROJECT },
    readBrief: async () => ({ ok: true, data: { text: 'brief', fingerprint: 'fp' } }),
    score: async () => ({ state: 'done', moments: rec.moments, summary: 's', briefFingerprint: 'fp', model: 'm' }),
    clearAlarm: () => {},
  });
  assert.equal(r.outcome, 'done', JSON.stringify(r));
  assert.ok(r.roughCut && r.roughCut.created, 'a rough-cut job was queued');
  const queued = queue.listJobs({ stage: STAGE_ROUGH_CUT });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].subjectId, SRC);
});

// ── The backfill ────────────────────────────────────────────────────────────

test('the backfill queues scored recordings with work left, once, and a dry run writes nothing', async (t) => {
  const dir = tmp(t);
  const queue = openQueue(path.join(dir, 'queue.sqlite'));
  t.after(() => queue.close());
  const sources = [
    { id: 's-new', localPath: '/x/new.MOV' },
    { id: 's-half', localPath: '/x/half.MOV' },
    { id: 's-done', localPath: '/x/done.MOV' },
    { id: 's-unscored', localPath: '/x/unscored.MOV' },
  ];
  const catalog = {
    listSources: async () => ({ ok: true, data: sources }),
    listMomentStates: async () => ({ ok: true, data: { 's-new': { status: 'done' }, 's-half': { status: 'done' }, 's-done': { status: 'done' }, 's-unscored': { status: 'failed' } } }),
    // The real store's limit rule: a limit it refuses is a read that never happened.
    listEditsByStatus: async (limit) => (limitOrError(limit, 'listEditsByStatus').ok ? { ok: true, data: [
      { sourceId: 's-half', status: 'review' }, { sourceId: 's-half', status: 'failed' },
      { sourceId: 's-done', status: 'review' },
    ] } : limitOrError(limit, 'listEditsByStatus')),
    editStatuses: ['draft'],
  };
  const dry = await runBackfill({ queue, catalog, scope: { projectId: PROJECT } });
  assert.deepEqual(dry.plan.enqueue.map((e) => e.id), ['s-new', 's-half']);
  assert.equal(queue.listJobs({ stage: STAGE_ROUGH_CUT }).length, 0, 'a dry run queues nothing');
  assert.match(backfillReport(dry), /Would queue 2 rough-cut job\(s\)/);

  const applied = await runBackfill({ queue, catalog, scope: { projectId: PROJECT }, apply: true });
  assert.equal(applied.enqueued.length, 2);
  const again = await runBackfill({ queue, catalog, scope: { projectId: PROJECT }, apply: true });
  assert.equal(again.enqueued.length, 0, 'a second --apply queues nothing');
  assert.equal(queue.listJobs({ stage: STAGE_ROUGH_CUT }).length, 2);
});

test('planBackfill lists a blocked rough-cut job with its reason rather than as waiting', () => {
  const plan = planBackfill({
    sources: [{ id: 's1' }],
    scored: new Map([['s1', 'done']]),
    edits: new Map(),
    queued: new Map([['s1', { state: 'blocked', jobId: 'j1', lastError: 'no working copy' }]]),
  });
  assert.deepEqual(plan.blocked, [{ id: 's1', name: 's1', jobId: 'j1', why: 'no working copy' }]);
  assert.equal(plan.enqueue.length, 0);
});

// ── The resumable upload ────────────────────────────────────────────────────

function fakeDriveUpload({ dropAt = -1 } = {}) {
  const held = { length: 0, chunks: [] };
  let failedOnce = false;
  const calls = [];
  const res = (status, { headers = {}, body = {} } = {}) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  });
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, range: init.headers['Content-Range'] });
    if (init.method === 'POST') return res(200, { headers: { location: 'https://upload/session' } });
    const range = init.headers['Content-Range'];
    const total = Number(range.split('/')[1]);
    const have = held.length;
    if (range.startsWith('bytes */')) return have === total ? res(200, { body: { id: 'f1', size: String(total) } }) : res(308, { headers: have ? { range: `bytes=0-${have - 1}` } : {} });
    const [from] = range.slice(6).split('-').map(Number);
    if (from === dropAt && !failedOnce) {
      failedOnce = true;
      throw new Error('socket hang up');
    }
    if (from !== have) return res(308, { headers: have ? { range: `bytes=0-${have - 1}` } : {} });
    held.chunks.push(Buffer.from(init.body));
    held.length += init.body.length;
    if (held.length === total) return res(200, { body: { id: 'f1', size: String(total) } });
    return res(308, { headers: { range: `bytes=0-${held.length - 1}` } });
  };
  return { fetchImpl, calls, held };
}

test('uploadFileResumable sends a file in pieces and returns Drive\'s record', async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'cut.mp4');
  const bytes = Buffer.alloc(256 * 1024 * 2 + 1000, 7);
  fs.writeFileSync(file, bytes);
  const fake = fakeDriveUpload();
  const up = await uploadFileResumable({ token: 't', folderId: 'f', fileName: 'cut.mp4', mimeType: 'video/mp4', filePath: file, chunkBytes: 256 * 1024, fetchImpl: fake.fetchImpl });
  assert.equal(up.ok, true, JSON.stringify(up));
  assert.equal(up.data.id, 'f1');
  assert.equal(fake.held.length, bytes.length);
  assert.equal(fake.calls.filter((c) => c.method === 'PUT').length, 3, 'three pieces of 256 KB');
});

test('uploadFileResumable resumes from what Drive kept after a dropped piece', async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'cut.mp4');
  fs.writeFileSync(file, Buffer.alloc(256 * 1024 * 3, 9));
  const fake = fakeDriveUpload({ dropAt: 256 * 1024 });
  const up = await uploadFileResumable({ token: 't', folderId: 'f', fileName: 'cut.mp4', mimeType: 'video/mp4', filePath: file, chunkBytes: 256 * 1024, fetchImpl: fake.fetchImpl });
  assert.equal(up.ok, true, JSON.stringify(up));
  assert.equal(fake.held.length, 256 * 1024 * 3, 'every byte once — nothing sent twice into the file');
  assert.ok(fake.calls.some((c) => c.range === `bytes */${256 * 1024 * 3}`), 'it asked Drive how much it had');
});

test('uploadFileResumable reports a refusal rather than retrying it', async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'cut.mp4');
  fs.writeFileSync(file, Buffer.alloc(100, 1));
  const fetchImpl = async (url, init) => (init.method === 'POST'
    ? { ok: true, status: 200, headers: { get: () => 'https://upload/s' }, json: async () => ({}) }
    : { ok: false, status: 403, headers: { get: () => null }, json: async () => ({ error: { message: 'storageQuotaExceeded' } }) });
  const up = await uploadFileResumable({ token: 't', folderId: 'f', fileName: 'c', mimeType: 'video/mp4', filePath: file, fetchImpl });
  assert.deepEqual([up.ok, up.status, up.error], [false, 403, 'storageQuotaExceeded']);
});
