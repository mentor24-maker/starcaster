'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

/**
 * Reel Spinner 5c (SC-840) — the finished video, made on the Mini.
 *
 * Real SQLite queue, the real store's step rules (videoEditsStore
 * `stepError`), the real download and md5 check (ingest.js), the real card
 * layout and the real music picker. Faked: the catalog, Drive, ffmpeg,
 * ffprobe and the card browser — the fake ffmpeg writes a file where the real
 * one would, so the pass's own file handling (downloaded, kept, deleted) is
 * what is tested. Nothing touches the network.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const pass = require('../../workers/studio/finalRenderPass.js');
const plan = require('../../workers/studio/finalRender.js');
const { stepError } = require('../../lib/videoEditsStore.js');
const { FAILURES } = require('../../workers/studio/proxy.js');
const daemon = require('../../workers/studio/daemon.js');

const PROJECT = 'proj_studio';
const OWNER = 'finalrender-test';
const SRC = 'aaaaaaaa-0000-4000-8000-000000000001';
const EDIT = 'e1000000-0000-4000-8000-000000000001';
const GB = 1024 ** 3;
const RANGES = [{ start_s: 20.1, end_s: 27.3 }, { start_s: 28, end_s: 35.45 }];

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-final-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const SHELF = {
  tracks: [{
    id: 'calm-one', title: 'Calm One', artist: 'Kevin MacLeod', mood: 'calm', lengthS: 200, bpm: 70,
    licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://incompetech.com/x',
    attributionRequired: true, attribution: '"Calm One" Kevin MacLeod', fileName: 'Calm One.mp3', driveFileId: 'drive-music-1',
  }],
};

/** The ffprobe JSON of a 1920 × 1080, 30000/1001 recording. */
const PROBE = { streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001', r_frame_rate: '30000/1001' }] };

function setup(t, { title = 'How the river learned to sing', cachedOriginal = false, edit: editPatch = {} } = {}) {
  const dir = tmp(t);
  let at = Date.parse('2026-11-19T20:00:00Z');
  const queue = openQueue(path.join(dir, 'queue.sqlite'), { clock: () => at });
  t.after(() => queue.close());
  const advance = (ms) => { at += ms; };
  const finishedDir = path.join(dir, 'finished');
  const musicDir = path.join(dir, 'music');
  const cachePath = path.join(dir, 'cache', 'IMG_1962.MOV');
  if (cachedOriginal) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, 'the original, still in the cache');
  }

  const edit = {
    id: EDIT, sourceId: SRC, kind: 'short', momentIndex: 0, keepRanges: RANGES, audioSourceId: null,
    status: 'approved', musicTrack: '', youtubeTitle: title, error: '', updatedAt: '2026-11-19T19:00:00Z', ...editPatch,
  };
  const catalog = {
    edit,
    moves: [],
    refuseMoveTo: '',
    failReadAfterMove: false,
    getEditById: async (id) => (catalog.failReadAfterMove && catalog.moves.length
      ? { ok: false, status: 0, error: 'fetch failed: ECONNRESET' }
      : { ok: true, status: 200, data: id === edit.id ? { ...edit } : null }),
    listEditsByStatus: async (limit, statuses) => ({ ok: true, status: 200, data: statuses.includes(edit.status) ? [{ ...edit }] : [] }),
    listEditsForSource: async () => ({ ok: true, status: 200, data: [{ ...edit }] }),
    moveEdit: async (id, to, patch = {}) => {
      catalog.moves.push({ id, to, patch });
      if (catalog.refuseMoveTo === to) return { ok: false, status: 503, error: 'the catalog did not answer' };
      const refused = stepError(edit.status, to);
      if (refused) return refused;
      edit.status = to;
      if (patch.musicTrack) edit.musicTrack = patch.musicTrack;
      return { ok: true, status: 200, data: { ...edit } };
    },
    getSourceById: async (id) => (id === SRC
      ? { ok: true, status: 200, data: { id: SRC, durationS: 60, fps: 29.97, width: 1920, height: 1080, driveFileId: 'drive-original', localPath: cachePath, proxyPath: path.join(dir, 'proxy.mp4') } }
      : { ok: false, status: 404, error: 'Source not found' }),
    getMomentsBySource: async () => ({ ok: true, status: 200, data: { status: 'done', moments: [{ start_s: 20.1, end_s: 35.45, score: 80, mood: 'calm', project: 'WaveCenter' }] } }),
    listAudioPairsForSource: async () => ({ ok: true, status: 200, data: [] }),
  };

  const files = {
    'drive-original': Buffer.alloc(4096, 7),
    'drive-music-1': Buffer.alloc(512, 3),
  };
  const driveMedia = {
    opened: [],
    badMd5: false,
    originalBytes: null,
    getMetadata: async (id) => {
      const bytes = files[id];
      if (!bytes) return { ok: false, status: 404, error: 'File not found' };
      const md5 = driveMedia.badMd5 && id === 'drive-original' ? 'not-the-md5' : crypto.createHash('md5').update(bytes).digest('hex');
      const size = id === 'drive-original' && driveMedia.originalBytes ? driveMedia.originalBytes : bytes.length;
      return { ok: true, status: 200, data: { id, size: String(size), md5Checksum: md5, trashed: false } };
    },
    openStream: async (id) => {
      driveMedia.opened.push(id);
      return { ok: true, status: 200, rangeHonoured: true, stream: Readable.from([files[id]]) };
    },
  };

  const ffmpegCalls = [];
  const ffmpeg = (args, opts) => {
    ffmpegCalls.push({ args, opts });
    if (args.includes('-version')) return ffmpeg.missing ? { ok: false, reason: FAILURES.FFMPEG_MISSING, detail: 'no ffmpeg' } : { ok: true, ms: 1 };
    // The original must still be on disk while ffmpeg reads it.
    ffmpeg.originalPresent.push(fs.existsSync(args[args.indexOf('-i') + 1]));
    if (ffmpeg.onRender) ffmpeg.onRender();
    ffmpeg.scripts.push(fs.readFileSync(args[args.indexOf('-/filter_complex') + 1], 'utf8'));
    if (ffmpeg.refuse) return { ok: false, reason: FAILURES.FFMPEG_FAILED, detail: ffmpeg.refuse, ms: 5 };
    fs.writeFileSync(args[args.length - 1], Buffer.alloc(2048, 1));
    return { ok: true, ms: 61000 };
  };
  Object.assign(ffmpeg, { scripts: [], originalPresent: [], refuse: '', missing: false, onRender: null });

  const drawn = [];
  const options = {
    queue, owner: OWNER, catalog, driveMedia, ffmpeg,
    env: { STUDIO_PROJECT_ID: PROJECT, STUDIO_FINISHED_DIR: finishedDir, STUDIO_MUSIC_DIR: musicDir },
    probe: () => ({ ok: true, data: PROBE }),
    // The picture runs exactly as long as the cards and the kept stretches, unless a test says otherwise.
    pictureDuration: () => (options.lengthS == null ? plan.expectedLengthS(RANGES) : options.lengthS),
    lengthS: null,
    drawCards: async ({ titleHtml, endHtml, titleCardPath, endCardPath }) => {
      drawn.push({ titleHtml, endHtml });
      fs.writeFileSync(titleCardPath, 'png');
      fs.writeFileSync(endCardPath, 'png');
      return { ok: true };
    },
    readEndCards: async () => ({ ok: true, cards: new Map([['WaveCenter', { project: 'WaveCenter', name: 'WaveCenter', invitation: 'Come and build it with us', address: 'wavecenter.com' }]]) }),
    shelf: SHELF,
    freeBytes: () => ({ ok: true, value: 100 * GB }),
  };
  const run = (extra = {}) => pass.runFinalRender({ ...options, ...extra });
  const paths = pass.finishedPathsFor(finishedDir, EDIT);
  return { queue, catalog, driveMedia, ffmpeg, ffmpegCalls, options, run, advance, now: () => at, finishedDir, musicDir, paths, cachePath, drawn };
}

function renders(calls) {
  return calls.filter((c) => !c.args.includes('-version'));
}

// ── The acceptance criteria ─────────────────────────────────────────────────

test('a short disk stops BEFORE downloading, with the numbers, and leaves the edit approved', async (t) => {
  const s = setup(t);
  s.driveMedia.originalBytes = 3.5 * GB;
  s.options.freeBytes = () => ({ ok: true, value: 6 * GB });
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();

  assert.equal(r.released.length, 1, JSON.stringify(r));
  const reason = r.released[0].reason;
  assert.match(reason, /6\.0 GB free/);
  assert.match(reason, /the original is 3\.5 GB/);
  assert.match(reason, /the finished file about \d+\.\d GB/);
  assert.match(reason, /plus the 5\.0 GB always left free/);
  assert.match(reason, /Nothing was downloaded/);
  assert.deepEqual(s.driveMedia.opened, [], 'not one byte was downloaded');
  assert.equal(renders(s.ffmpegCalls).length, 0);
  assert.equal(s.catalog.edit.status, 'approved');
  const job = s.queue.listJobs({ stage: pass.STAGE_FINAL_RENDER })[0];
  assert.equal(job.attempts, 0, 'a full disk is the machine\'s problem: no attempt is spent');
});

test('an approved edit is rendered from the downloaded original, moves to finished with its music, and the original is deleted', async (t) => {
  const s = setup(t);
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();

  assert.equal(r.finished.length, 1, JSON.stringify(r));
  assert.equal(s.catalog.edit.status, 'finished');
  assert.equal(s.catalog.edit.musicTrack, 'calm-one', 'the picked track is stored on the edit, as its id');
  assert.deepEqual(s.driveMedia.opened, ['drive-original', 'drive-music-1']);
  assert.deepEqual(s.ffmpeg.originalPresent, [true], 'the original was on disk while ffmpeg read it');
  assert.ok(fs.existsSync(s.paths.video), 'the finished file waits in the finished folder for the upload');
  assert.equal(fs.existsSync(s.paths.work), false, 'the downloaded original and the cards are deleted after the render');
  assert.equal(fs.existsSync(path.dirname(s.paths.work)), false, 'and no empty working folder is left behind');
  assert.ok(fs.existsSync(path.join(s.musicDir, 'Calm One.mp3')), 'the music track is kept for the next video');
  const side = JSON.parse(fs.readFileSync(s.paths.sidecar, 'utf8'));
  assert.equal(side.musicTrack, 'calm-one');
  assert.equal(side.endCardProject, 'WaveCenter');
  assert.equal(side.lengthS, plan.expectedLengthS(RANGES));
  assert.match(s.drawn[0].titleHtml, /river/, 'the title card shows the YouTube title');
  assert.match(s.drawn[0].endHtml, /wavecenter\.com/);

  const script = s.ffmpeg.scripts[0];
  assert.match(script, /trim=start=20\.1:end=27\.3/, 'the edit\'s own kept stretches, not a new plan');
  assert.match(script, /trim=start=28:end=35\.45/);
  assert.match(script, /scale=1920:1080/, 'at the original\'s size');
  assert.match(script, /\[kepta\][^\n]*loudnorm=I=-16/, 'the voice is brought to a known loudness');
  assert.match(script, /loudnorm=I=-16[^\n]*volume=0\.1,/, 'and the music to the same loudness, then 20 dB under it');
  assert.match(script, /afade=t=in:st=0:d=2/);
  assert.match(script, new RegExp(`afade=t=out:st=${plan.expectedLengthS(RANGES) - 4}:d=4`));
  const args = renders(s.ffmpegCalls)[0].args;
  assert.ok(args.includes('libx264') && args.includes('high') && args.includes('384k') && args.includes('+faststart'));
  assert.ok(!args.includes('-stream_loop') || args[args.indexOf('-stream_loop') + 1] === '-1', 'a short track loops');
  assert.equal(s.queue.listJobs({ stage: pass.STAGE_FINAL_RENDER })[0].state, 'done');
});

test('the original is deleted after a failed render too, the edit stays approved, and the job retries', async (t) => {
  const s = setup(t);
  s.ffmpeg.refuse = 'Invalid data found when processing input';
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();

  assert.equal(r.failed.length, 1, JSON.stringify(r));
  assert.match(r.failed[0].reason, /ffmpeg could not render it: Invalid data found/);
  assert.equal(fs.existsSync(s.paths.work), false, 'the downloaded original is gone after the failure');
  assert.equal(fs.existsSync(s.paths.video), false, 'and no half-written video is left');
  assert.equal(s.catalog.edit.status, 'approved', 'Dane\'s Approve is kept: failed would send it back to a draft');
  const job = s.queue.listJobs({ stage: pass.STAGE_FINAL_RENDER })[0];
  assert.equal(job.state, 'pending');
  assert.equal(job.attempts, 1, 'a render ffmpeg refuses is the edit\'s: the attempt is spent');
});

test('the finished length is the edit list\'s kept length plus the two cards, to within a frame', async (t) => {
  const kept = (27.3 - 20.1) + (35.45 - 28);
  assert.equal(plan.expectedLengthS(RANGES), Math.round((plan.TITLE_CARD_S + kept + plan.END_CARD_S) * 1000) / 1000);

  const frame = 1001 / 30000;
  const s = setup(t);
  s.options.lengthS = plan.expectedLengthS(RANGES) + frame * 0.9;
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const ok = await s.run();
  assert.equal(ok.finished.length, 1, 'less than a frame off is the right length');
});

test('a finished file of the wrong length is refused and deleted, and the edit stays approved', async (t) => {
  const s = setup(t);
  s.options.lengthS = plan.expectedLengthS(RANGES) + 2;
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].reason, /wrong length: the finished file runs [\d.]+ s, but the cards and the kept stretches add up to [\d.]+ s/);
  assert.equal(fs.existsSync(s.paths.video), false);
  assert.equal(fs.existsSync(s.paths.work), false);
  assert.equal(s.catalog.edit.status, 'approved');
});

// ── The other paths ─────────────────────────────────────────────────────────

test('a download that does not match Drive\'s md5 is deleted and the job fails', async (t) => {
  const s = setup(t);
  s.driveMedia.badMd5 = true;
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].reason, /does not match Drive's md5/);
  assert.equal(renders(s.ffmpegCalls).length, 0);
  assert.equal(fs.existsSync(s.paths.work), false);
});

test('an original still in the cache is used where it is and never deleted', async (t) => {
  const s = setup(t, { cachedOriginal: true });
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();
  assert.equal(r.finished.length, 1, JSON.stringify(r));
  assert.deepEqual(s.driveMedia.opened, ['drive-music-1'], 'only the music was fetched');
  assert.equal(renders(s.ffmpegCalls)[0].args[renders(s.ffmpegCalls)[0].args.indexOf('-i') + 1], s.cachePath);
  assert.ok(fs.existsSync(s.cachePath), 'the cache copy belongs to ingest, not to this job');
});

test('no YouTube title yet: put back for later, nothing downloaded, no attempt spent', async (t) => {
  const s = setup(t, { title: '' });
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();
  assert.equal(r.released.length, 1);
  assert.match(r.released[0].reason, /no YouTube title yet, and the title card shows it/);
  assert.deepEqual(s.driveMedia.opened, []);
  assert.equal(s.queue.listJobs({ stage: pass.STAGE_FINAL_RENDER })[0].attempts, 0);
});

test('no end card for the project: blocked with the reason, before anything is downloaded', async (t) => {
  const s = setup(t);
  s.options.readEndCards = async () => ({ ok: true, cards: new Map() });
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reason, /no end card for WaveCenter in Reel Spinner — end cards/);
  assert.deepEqual(s.driveMedia.opened, []);
});

test('ffmpeg missing: put back with the fix, nothing downloaded', async (t) => {
  const s = setup(t);
  s.ffmpeg.missing = true;
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();
  assert.equal(r.released.length, 1);
  assert.match(r.released[0].reason, /brew install ffmpeg/);
  assert.deepEqual(s.driveMedia.opened, []);
});

test('an edit no longer approved is left alone', async (t) => {
  const s = setup(t, { edit: { status: 'skipped' } });
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();
  assert.equal(r.movedOn.length, 1);
  assert.deepEqual(s.driveMedia.opened, []);
});

test('a render whose catalog write failed is kept, and the retry only writes it', async (t) => {
  const s = setup(t);
  s.catalog.refuseMoveTo = 'finished';
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const first = await s.run();
  assert.equal(first.released.length, 1, JSON.stringify(first));
  assert.ok(fs.existsSync(s.paths.video), 'the finished file is kept');
  assert.equal(fs.existsSync(s.paths.work), false, 'the original still goes');

  s.catalog.refuseMoveTo = '';
  s.advance(pass.RELEASE_HOLD_MS + 1000);
  const again = await s.run();
  assert.equal(again.finished.length, 1, JSON.stringify(again));
  assert.equal(renders(s.ffmpegCalls).length, 1, 'not rendered a second time');
  assert.equal(s.driveMedia.opened.filter((id) => id === 'drive-original').length, 1, 'and not downloaded a second time');
});

// ── The send-back of 2026-11-19 ─────────────────────────────────────────────

test('the lease still covers the whole render after the download has beaten on it', async (t) => {
  const s = setup(t);
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const beats = [];
  const realBeat = s.queue.heartbeat;
  const queue = { ...s.queue, heartbeat: (id, owner, opts) => { beats.push(opts || null); return realBeat(id, owner, opts); } };
  let leftAtRender = null;
  let renderTimeout = null;
  s.ffmpeg.onRender = () => {
    const job = s.queue.listJobs({ stage: pass.STAGE_FINAL_RENDER })[0];
    leftAtRender = job.leaseExpiresAt - s.now();
  };
  const r = await s.run({ queue });
  renderTimeout = renders(s.ffmpegCalls)[0].opts.timeoutMs;

  assert.equal(r.finished.length, 1, JSON.stringify(r));
  assert.ok(beats.length >= 3, `the up-front stretch, a download beat and the pre-render stretch (got ${beats.length})`);
  assert.ok(beats.every((b) => b && Number(b.leaseMs) > 0), 'no beat falls back to the queue\'s five-minute default');
  assert.ok(leftAtRender >= renderTimeout, `when ffmpeg starts the lease has ${leftAtRender} ms left, and the render may take ${renderTimeout}`);
});

test('an edit that moved on while it rendered leaves no finished file behind', async (t) => {
  const s = setup(t);
  s.ffmpeg.onRender = () => { s.catalog.edit.status = 'skipped'; };
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();

  assert.equal(r.movedOn.length, 1, JSON.stringify(r));
  assert.match(r.movedOn[0].reason, /the finished file was deleted/);
  assert.equal(fs.existsSync(s.paths.video), false, 'nothing would ever upload it, so it does not wait on the disk');
  assert.equal(fs.existsSync(s.paths.sidecar), false, 'and neither does its sidecar');
  assert.equal(fs.existsSync(s.paths.work), false, 'the original still goes');
});

test('a render that failed every attempt is not queued again until the edit changes', async (t) => {
  const s = setup(t);
  s.ffmpeg.refuse = 'Output file does not contain any stream';
  await pass.watchApproved({ queue: s.queue, env: s.options.env, catalog: s.catalog, now: s.now });
  for (let n = 0; n < 5; n += 1) {
    await s.run();
    s.advance(24 * 60 * 60 * 1000);
  }
  const job = s.queue.listJobs({ stage: pass.STAGE_FINAL_RENDER })[0];
  assert.equal(job.state, 'blocked', 'five failures is the queue\'s ceiling');
  assert.equal(job.attempts, 5);
  const downloads = s.driveMedia.opened.filter((id) => id === 'drive-original').length;

  s.advance(pass.RETRY_BLOCKED_AFTER_MS * 4);
  const later = await pass.watchApproved({ queue: s.queue, env: s.options.env, catalog: s.catalog, now: s.now });
  assert.equal(later.processed.length, 0, 'a day on, it is still held: retrying would fail the same way');
  assert.match(later.skipped[0].why, /failed all 5 attempts .*not tried again until the edit changes/);
  await s.run();
  assert.equal(s.driveMedia.opened.filter((id) => id === 'drive-original').length, downloads, 'and the original is not downloaded again');

  s.catalog.edit.updatedAt = new Date(s.now()).toISOString();
  const changed = await pass.watchApproved({ queue: s.queue, env: s.options.env, catalog: s.catalog, now: s.now });
  assert.equal(changed.processed.length, 1, 'once the edit changes (sent back and approved again), it is tried again');
});

test('after the edit changes, a later reasoned block retries six hours on, not held for good', async (t) => {
  const s = setup(t);
  // 1. Five failures: the job is blocked with attempts=5.
  s.ffmpeg.refuse = 'Output file does not contain any stream';
  await pass.watchApproved({ queue: s.queue, env: s.options.env, catalog: s.catalog, now: s.now });
  for (let n = 0; n < 5; n += 1) {
    await s.run();
    s.advance(24 * 60 * 60 * 1000);
  }
  assert.equal(s.queue.listJobs({ stage: pass.STAGE_FINAL_RENDER, state: 'blocked' })[0].attempts, 5);

  // 2. The edit changes (sent back, approved again): a new job is queued and
  //    the exhausted one is stood down rather than left to absorb the next block.
  s.ffmpeg.refuse = null;
  s.advance(1000);
  s.catalog.edit.updatedAt = new Date(s.now()).toISOString();
  s.advance(1000);
  const changed = await pass.watchApproved({ queue: s.queue, env: s.options.env, catalog: s.catalog, now: s.now });
  assert.equal(changed.processed.length, 1);

  // 3. The new job meets a reasoned block: no end card.
  const realEndCards = s.options.readEndCards;
  s.options.readEndCards = async () => ({ ok: true, cards: new Map() });
  const blockedRun = await s.run();
  assert.equal(blockedRun.blocked.length, 1, JSON.stringify(blockedRun));
  const blockedNow = s.queue.listJobs({ stage: pass.STAGE_FINAL_RENDER, state: 'blocked' });
  assert.equal(blockedNow.length, 1, 'one blocked row for the edit');
  assert.equal(blockedNow[0].attempts, 0, 'the reasoned block is a fresh row, not the exhausted one with five attempts');

  // 4. The note is fixed and six hours pass: it is queued again.
  s.options.readEndCards = realEndCards;
  s.advance(pass.RETRY_BLOCKED_AFTER_MS + 1000);
  const later = await pass.watchApproved({ queue: s.queue, env: s.options.env, catalog: s.catalog, now: s.now });
  assert.equal(later.processed.length, 1, `fixing the note is enough: ${JSON.stringify(later.skipped)}`);
});

test('a job whose lease was lost leaves the working folder to the new holder', async (t) => {
  const s = setup(t);
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  let stolen = false;
  const realBeat = s.queue.heartbeat;
  const queue = { ...s.queue, heartbeat: (...args) => (stolen ? false : realBeat(...args)) };
  const draw = s.options.drawCards;
  const r = await s.run({ queue, drawCards: async (a) => { const out = await draw(a); stolen = true; return out; } });

  assert.equal(r.lost.length, 1, JSON.stringify(r));
  assert.match(r.lost[0].reason, /lost before the render started/);
  assert.equal(renders(s.ffmpegCalls).length, 0, 'it does not render a job that is not its own');
  assert.ok(fs.existsSync(s.paths.work), 'the folder is named after the edit, so it belongs to whoever holds the job now');
});

test('a read-back that does not answer after a good write is the machine\'s, not the edit\'s', async (t) => {
  const s = setup(t);
  s.catalog.failReadAfterMove = true;
  pass.enqueueFinalRender(s.queue, { editId: EDIT });
  const r = await s.run();

  assert.equal(r.released.length, 1, JSON.stringify(r));
  assert.match(r.released[0].reason, /reading it back failed: fetch failed/);
  const job = s.queue.listJobs({ stage: pass.STAGE_FINAL_RENDER })[0];
  assert.equal(job.attempts, 0, 'no attempt is charged to the edit');
  assert.ok(fs.existsSync(s.paths.video), 'the finished file is kept: the edit IS finished');
});

test('the watcher queues each approved edit once, and leaves a recently blocked one alone', async (t) => {
  const s = setup(t);
  const first = await pass.watchApproved({ queue: s.queue, env: s.options.env, catalog: s.catalog, now: s.now });
  assert.equal(first.processed.length, 1);
  const second = await pass.watchApproved({ queue: s.queue, env: s.options.env, catalog: s.catalog, now: s.now });
  assert.equal(second.processed.length, 0, 'the queue\'s live-job index is the dedupe');

  const job = s.queue.listJobs({ stage: pass.STAGE_FINAL_RENDER })[0];
  s.queue.block({ stage: pass.STAGE_FINAL_RENDER, subjectKind: 'video_edit', subjectId: EDIT, reason: 'no end card', jobId: job.id });
  const held = await pass.watchApproved({ queue: s.queue, env: s.options.env, catalog: s.catalog, now: s.now });
  assert.equal(held.processed.length, 0);
  assert.match(held.skipped[0].why, /blocked: no end card/);
  s.advance(pass.RETRY_BLOCKED_AFTER_MS + 1000);
  const later = await pass.watchApproved({ queue: s.queue, env: s.options.env, catalog: s.catalog, now: s.now });
  assert.equal(later.processed.length, 1, 'six hours on it is tried again, so fixing the note is enough');
});

test('the daemon runs finished videos right behind the YouTube text, ahead of every backlog, and watches for Approve', () => {
  const stages = Object.keys(daemon.STAGE_RUNNERS);
  assert.equal(stages.indexOf(pass.STAGE_FINAL_RENDER), stages.indexOf('youtube_copy') + 1);
  assert.ok(stages.indexOf(pass.STAGE_FINAL_RENDER) < stages.indexOf('cut_marks'));
  assert.equal(daemon.WATCHERS[pass.STAGE_FINAL_RENDER_WATCH].everyMs, 60 * 1000);
});

// ── The plan, on its own ───────────────────────────────────────────────────

test('the frame rate keeps NTSC fractions exact', () => {
  assert.deepEqual(plan.frameRate('30000/1001').rate, '30000/1001');
  assert.equal(plan.frameRate(29.97).rate, '30000/1001');
  assert.equal(plan.frameRate('60/1').fps, 60);
  assert.equal(plan.frameRate('0/0').rate, '30');
});

test('an upright phone recording is measured the way it is shown', () => {
  const turned = plan.pictureFacts({ streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30/1', side_data_list: [{ rotation: -90 }], color_transfer: 'arib-std-b67' }] });
  assert.deepEqual([turned.width, turned.height, turned.hdr], [1080, 1920, true]);
  assert.equal(plan.pictureFacts({ streams: [{ codec_type: 'audio' }] }).ok, false);
});

test('a separate recording\'s sound is input 1, and the cards and music move along one', () => {
  const inputs = plan.inputsFor({ picturePath: 'a.mov', soundPath: 'b.m4a', titleCardPath: 't.png', endCardPath: 'e.png', musicPath: 'm.mp3', rate: '30' });
  assert.deepEqual([inputs.audioInput, inputs.titleInput, inputs.endInput, inputs.musicInput], [1, 2, 3, 4]);
  const script = plan.filterScript({ ranges: RANGES, shiftS: -1.5, width: 1920, height: 1080, rate: '30', inputs });
  assert.match(script, /\[1:a\]asplit=2/);
  assert.match(script, /atrim=start=18\.6:end=25\.8/, 'the sound is shifted onto the picture\'s clock');
  assert.match(script, /\[2:v\]scale=1920:1080:force_original_aspect_ratio=decrease,pad=/);
  assert.match(script, /\[4:a\]aresample/);
  const same = plan.inputsFor({ picturePath: 'a.mov', soundPath: 'a.mov', titleCardPath: 't.png', endCardPath: 'e.png', musicPath: 'm.mp3', rate: '30' });
  assert.deepEqual([same.audioInput, same.titleInput, same.musicInput], [0, 1, 3]);
});

test('the previous edit\'s track is the one before this edit that has one', () => {
  const edits = [{ id: 'a', musicTrack: 'x' }, { id: 'b', musicTrack: '' }, { id: 'c', musicTrack: 'y' }, { id: 'd' }];
  assert.equal(pass.previousTrackOf(edits, 'd'), 'y');
  assert.equal(pass.previousTrackOf(edits, 'b'), 'x');
  assert.equal(pass.previousTrackOf(edits, 'a'), '');
});
