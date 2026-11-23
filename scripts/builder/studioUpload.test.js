'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Reel Spinner 6c (SC-842) — a finished video goes up to YouTube as Private.
 *
 * Real SQLite queue, the real store's step rules (videoEditsStore
 * `stepError`), the real YouTube client (workers/studio/youtubeUpload.js) and
 * its resumable loop. Faked: the catalog, the end-cards note, and YouTube
 * itself — a fake `fetch` that plays Google's token endpoint and YouTube's
 * resumable-upload protocol (308 + Range, 200 with the video), so the client's
 * own reading of those answers is what is tested. Nothing touches the network.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const pass = require('../../workers/studio/uploadPass.js');
const yt = require('../../workers/studio/youtubeUpload.js');
const { stepError, UPLOAD_PROBLEM_PREFIX } = require('../../lib/videoEditsStore.js');
const { roughCutsView } = require('../../lib/studioRoughCuts.js');
const daemon = require('../../workers/studio/daemon.js');

const PROJECT = 'proj_studio';
const OWNER = 'upload-test';
const EDIT = 'e1000000-0000-4000-8000-000000000001';
const SRC = 'aaaaaaaa-0000-4000-8000-000000000001';
const KB = 1024;
const CHUNK = 256 * KB;
const FILE_BYTES = 3 * CHUNK + 1000;

const SHELF = {
  tracks: [{ id: 'calm-one', title: 'Calm One', attributionRequired: true, attribution: '"Calm One" Kevin MacLeod' }],
};
const CARD = { invitation: 'Come and play at WaveCenter.', address: 'wavecenter.com' };
const BARE_ENDING = 'Come and play at WaveCenter.\nhttps://wavecenter.com';

function headers(map = {}) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => (name.toLowerCase() in lower ? lower[name.toLowerCase()] : null) };
}

function reply(status, body = {}, extra = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: headers(extra), text: async () => raw };
}

/**
 * A fake YouTube. `keepShort` makes it keep fewer bytes than a piece carried
 * (YouTube may), `dropAfterPieces` makes the network fail after that many
 * pieces, `failToken` / `quota` / `refuseInsert` make it say no.
 */
function fakeYoutube({ channel = 'Dane of Earth' } = {}) {
  const yt = {
    channel,
    sessions: new Map(),
    videos: new Map(),
    received: Buffer.alloc(0),
    starts: 0,
    pieces: [],
    queries: 0,
    channelReads: 0,
    noRange: false,
    keepShort: 0,
    dropAfterPieces: Infinity,
    failToken: false,
    quota: false,
    refuseInsert: '',
    videoReadMisses: 0,
    uploadStatus: 'uploaded',
    metadata: null,
  };
  yt.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const h = Object.fromEntries(Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (yt.failToken) return reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return reply(200, { access_token: 'tok' });
    }
    if (url.includes('/channels?')) { yt.channelReads += 1; return reply(200, { items: [{ snippet: { title: yt.channel } }] }); }
    if (url.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
      // The channel's daily cap, as YouTube really sends it: a 400, not a 403
      // (videos.insert error table: badRequest (400) uploadLimitExceeded).
      if (yt.quota) return reply(400, { error: { message: 'The user has exceeded the number of videos they may upload.', errors: [{ reason: 'uploadLimitExceeded' }] } });
      if (yt.refuseInsert) return reply(400, { error: { message: yt.refuseInsert, errors: [{ reason: 'invalidTitle' }] } });
      yt.starts += 1;
      yt.metadata = JSON.parse(options.body);
      const sessionUrl = `https://upload.example/session/${yt.starts}`;
      yt.sessions.set(sessionUrl, { total: Number(h['x-upload-content-length']), have: Buffer.alloc(0), video: null });
      return reply(200, {}, { Location: sessionUrl });
    }
    if (url.startsWith('https://upload.example/session/')) {
      const s = yt.sessions.get(url);
      if (!s) return reply(404, { error: { message: 'session not found' } });
      const range = String(h['content-range']);
      const status = () => (s.have.length && !yt.noRange ? reply(308, '', { Range: `bytes=0-${s.have.length - 1}` }) : reply(308, ''));
      if (range.startsWith('bytes */')) {
        yt.queries += 1;
        return s.video ? reply(200, s.video) : status();
      }
      if (yt.pieces.length >= yt.dropAfterPieces) throw new Error('socket hang up');
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range);
      const start = Number(m[1]);
      if (yt.noRange) { yt.pieces.push({ start, length: Buffer.from(options.body).length }); return status(); }
      assert.equal(start, s.have.length, 'a piece must start at the byte YouTube has');
      let body = Buffer.from(options.body);
      if (yt.keepShort && start + body.length < s.total) body = body.subarray(0, body.length - yt.keepShort);
      yt.pieces.push({ start, length: Buffer.from(options.body).length });
      s.have = Buffer.concat([s.have, body]);
      if (s.have.length >= s.total) {
        const id = `vid${yt.videos.size + 1}`;
        s.video = { id, status: { privacyStatus: 'private', uploadStatus: 'uploaded' } };
        yt.videos.set(id, { bytes: s.have });
        yt.received = s.have;
        return reply(200, s.video);
      }
      return status();
    }
    if (url.includes('/youtube/v3/videos?part=status')) {
      const id = decodeURIComponent(/id=([^&]+)/.exec(url)[1]);
      if (yt.videoReadMisses > 0) { yt.videoReadMisses -= 1; return reply(200, { items: [] }); }
      if (!yt.videos.has(id)) return reply(200, { items: [] });
      return reply(200, { items: [{ id, status: { privacyStatus: 'private', uploadStatus: yt.uploadStatus, rejectionReason: yt.uploadStatus === 'rejected' ? 'duplicate' : undefined } }] });
    }
    throw new Error(`fake YouTube was asked something it does not know: ${method} ${url}`);
  };
  return yt;
}

function setup(t, { status = 'finished', edit: editPatch = {}, channel } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-upload-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let at = Date.parse('2026-11-22T20:00:00Z');
  const queue = openQueue(path.join(dir, 'queue.sqlite'), { clock: () => at });
  t.after(() => queue.close());
  const finishedDir = path.join(dir, 'finished');
  fs.mkdirSync(finishedDir, { recursive: true });
  const paths = pass.uploadPathsFor(finishedDir, EDIT);
  const bytes = Buffer.alloc(FILE_BYTES);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
  fs.writeFileSync(paths.video, bytes);
  fs.writeFileSync(paths.sidecar, JSON.stringify({ endCardProject: 'WaveCenter' }));

  const edit = {
    id: EDIT, sourceId: SRC, kind: 'short', momentIndex: 0, status, musicTrack: 'calm-one',
    youtubeTitle: 'How the river learned to sing', youtubeDescription: `A short about rivers.\n\n${BARE_ENDING}`,
    youtubeTags: ['river', 'river', 'tennis'], youtubeVideoId: '', error: '', ...editPatch,
  };
  const catalog = {
    edit,
    moves: [],
    refuseMoveTo: '',
    getEditById: async (id) => ({ ok: true, status: 200, data: id === edit.id ? { ...edit } : null }),
    listEditsByStatus: async (limit, statuses) => ({ ok: true, status: 200, data: statuses.includes(edit.status) ? [{ ...edit }] : [] }),
    getMomentsBySource: async () => ({ ok: true, status: 200, data: { moments: [{ project: 'WaveCenter' }] } }),
    moveEdit: async (id, to, patch = {}) => {
      catalog.moves.push({ to, patch });
      if (catalog.refuseMoveTo === to) return { ok: false, status: 503, error: 'the catalog did not answer' };
      const refused = stepError(edit.status, to);
      if (refused) return refused;
      edit.status = to;
      if (patch.youtubeVideoId) edit.youtubeVideoId = patch.youtubeVideoId;
      if (patch.error) edit.error = patch.error;
      return { ok: true, status: 200, data: { ...edit } };
    },
  };
  const youtube = fakeYoutube({ channel });
  const env = { STUDIO_PROJECT_ID: PROJECT, YOUTUBE_UPLOAD_REFRESH_TOKEN: 'refresh', GOOGLE_DRIVE_CLIENT_ID: 'id', GOOGLE_DRIVE_CLIENT_SECRET: 'secret' };
  const alarms = [];
  let cleared = 0;
  const run = async (extra = {}) => {
    const { job } = pass.enqueueUpload(queue, { editId: EDIT });
    const claimed = queue.claim(OWNER, { stages: [pass.STAGE_UPLOAD] });
    assert.ok(claimed, 'the job could be claimed');
    const result = await pass.uploadJob({
      queue, job: claimed, owner: OWNER, catalog, env,
      client: yt.createYoutubeClient({ env, fetchImpl: youtube.fetch }),
      options: { finishedDir }, shelf: SHELF, chunkBytes: CHUNK,
      readEndCards: async () => ({ ok: true, cards: new Map([['WaveCenter', CARD]]) }),
      alarm: (reason) => { alarms.push(reason); return { said: 'posted' }; },
      clearAlarm: () => { cleared += 1; },
      sleep: async () => {}, clock: () => at,
      ...extra,
    });
    return { result, job: queue.listJobs({ stage: pass.STAGE_UPLOAD }).find((j) => j.id === job.id) };
  };
  return { queue, catalog, youtube, paths, bytes, finishedDir, run, alarms, cleared: () => cleared, advance: (ms) => { at += ms; } };
}

test('a finished video goes up as Private with its text, the edit reads on_youtube, and only then is the file deleted', async (t) => {
  const s = setup(t);
  const { result, job } = await s.run();
  assert.equal(result.outcome, 'uploaded', result.reason);
  assert.equal(job.state, 'done');
  assert.deepEqual(s.catalog.moves.map((m) => m.to), ['uploading', 'on_youtube']);
  assert.equal(s.catalog.edit.youtubeVideoId, 'vid1');
  assert.ok(s.youtube.received.equals(s.bytes), 'YouTube got every byte, in order');
  assert.equal(s.youtube.pieces.length, 4, 'three 256 KB pieces and the rest');

  const meta = s.youtube.metadata;
  assert.equal(meta.status.privacyStatus, 'private');
  assert.equal(meta.snippet.title, 'How the river learned to sing');
  assert.deepEqual(meta.snippet.tags, ['river', 'tennis']);
  // The credit the track needs is added, and the invitation is not there twice.
  assert.ok(meta.snippet.description.endsWith(`${BARE_ENDING}\n\nMusic:\n"Calm One" Kevin MacLeod`), meta.snippet.description);
  assert.equal(meta.snippet.description.split('Come and play').length, 2);

  for (const f of [s.paths.video, s.paths.sidecar, s.paths.session]) assert.equal(fs.existsSync(f), false, `${f} deleted`);
  assert.equal(s.cleared(), 1, 'a good sign-in clears the alarm');
});

test('a resumed upload carries on from the byte YouTube reports, not from the start', async (t) => {
  const s = setup(t);
  // YouTube keeps 1000 bytes short of each piece, and the line drops after two pieces.
  s.youtube.keepShort = 1000;
  s.youtube.dropAfterPieces = 2;
  const first = await s.run();
  assert.equal(first.result.outcome, 'outage', first.result.reason);
  assert.equal(first.job.attempts, 0, 'a dropped line is not charged to the video');
  assert.equal(s.catalog.edit.status, 'uploading');
  assert.ok(fs.existsSync(s.paths.video), 'the finished file is kept');
  const saved = JSON.parse(fs.readFileSync(s.paths.session, 'utf8'));
  assert.ok(saved.sessionUrl, 'the session address was saved before the first byte');
  const have = 2 * (CHUNK - 1000);

  s.youtube.dropAfterPieces = Infinity;
  s.youtube.keepShort = 0;
  s.advance(pass.RELEASE_HOLD_MS + 1);
  const second = await s.run();
  assert.equal(second.result.outcome, 'uploaded', second.result.reason);
  assert.equal(second.result.resumedFrom, have, 'it asked YouTube and resumed from the byte it reported');
  assert.equal(s.youtube.starts, 1, 'one upload session, never a second one');
  assert.equal(s.youtube.pieces[2].start, have, 'the next piece began where YouTube had got to');
  assert.ok(s.youtube.received.equals(s.bytes), 'the file arrived whole and in order');
  assert.equal(fs.existsSync(s.paths.video), false);
});

test('a quota refusal waits until the allowance resets, without using an attempt; the file is kept', async (t) => {
  const s = setup(t);
  s.youtube.quota = true;
  const { result, job } = await s.run();
  assert.equal(result.outcome, 'waiting', result.reason);
  assert.match(result.reason, /daily upload allowance is used up.*midnight Pacific/);
  assert.equal(job.state, 'pending');
  assert.equal(job.attempts, 0, 'no attempt counted');
  assert.ok(job.runAfter - Date.parse('2026-11-22T20:00:00Z') > 60 * 60 * 1000, 'held until the reset, not 15 minutes');
  assert.ok(fs.existsSync(s.paths.video));
  assert.equal(s.alarms.length, 0, 'a used-up allowance is not an alarm');
});

test('msUntilQuotaReset lands just after midnight Pacific', () => {
  // 20:00 UTC on 2026-11-22 is 12:00 PST: twelve hours to midnight, plus five minutes.
  assert.equal(yt.msUntilQuotaReset(Date.parse('2026-11-22T20:00:00Z')), (12 * 60 + 5) * 60 * 1000);
});

test('an unconfirmed upload keeps the file, and the retry never uploads twice', async (t) => {
  const s = setup(t);
  s.youtube.videoReadMisses = 100;
  const first = await s.run();
  assert.equal(first.result.outcome, 'outage', first.result.reason);
  assert.match(first.result.reason, /does not show it yet/);
  assert.ok(fs.existsSync(s.paths.video), 'the file is kept until YouTube shows the video');
  assert.equal(JSON.parse(fs.readFileSync(s.paths.session, 'utf8')).videoId, 'vid1', 'the id is on the disk');

  s.youtube.videoReadMisses = 0;
  s.advance(pass.RELEASE_HOLD_MS + 1);
  const second = await s.run();
  assert.equal(second.result.outcome, 'uploaded', second.result.reason);
  assert.equal(second.result.uploadReused, true);
  assert.equal(s.youtube.starts, 1, 'uploaded once');
  assert.equal(s.catalog.edit.youtubeVideoId, 'vid1');
  assert.equal(fs.existsSync(s.paths.video), false);
});

test('a catalog write that fails after the upload keeps the file; the retry only does the write', async (t) => {
  const s = setup(t);
  s.catalog.refuseMoveTo = 'on_youtube';
  const first = await s.run();
  assert.equal(first.result.outcome, 'outage');
  assert.ok(fs.existsSync(s.paths.video));
  s.catalog.refuseMoveTo = '';
  s.advance(pass.RELEASE_HOLD_MS + 1);
  const second = await s.run();
  assert.equal(second.result.outcome, 'uploaded', second.result.reason);
  assert.equal(s.youtube.starts, 1);
  assert.equal(fs.existsSync(s.paths.video), false);
});

test('a refused upload marks the edit failed with YouTube\'s reason, and keeps the file', async (t) => {
  const s = setup(t);
  s.youtube.refuseInsert = 'The request metadata specifies an invalid video title.';
  const { result } = await s.run();
  assert.equal(result.outcome, 'failed');
  assert.equal(s.catalog.edit.status, 'failed');
  assert.ok(s.catalog.edit.error.startsWith(UPLOAD_PROBLEM_PREFIX));
  assert.match(s.catalog.edit.error, /invalid video title/);
  assert.ok(fs.existsSync(s.paths.video), 'never deleted before YouTube confirms it');
});

test('a video YouTube rejects after it arrives is failed too, and the file is kept', async (t) => {
  const s = setup(t);
  s.youtube.uploadStatus = 'rejected';
  const { result } = await s.run();
  assert.equal(result.outcome, 'failed', result.reason);
  assert.match(s.catalog.edit.error, /rejected video vid1.*duplicate/);
  assert.ok(fs.existsSync(s.paths.video));
  // The note held the rejected id: kept, every later try would skip the upload,
  // read the same rejection back and fail again.
  assert.equal(fs.existsSync(s.paths.session), false, 'the rejected video id is not kept for a retry');
});

test('a failed upload says what will happen next, which is nothing on its own, and never names a step the screen lacks', async (t) => {
  const s = setup(t);
  s.youtube.refuseInsert = 'The request metadata specifies an invalid video title.';
  await s.run();
  assert.match(s.catalog.edit.error, /^Not uploaded to YouTube: YouTube refused it \(/);
  assert.match(s.catalog.edit.error, /Nothing more happens to this video on its own/);
});

test('a missing finished file is said as a missing file, not as YouTube refusing it', async (t) => {
  const s = setup(t);
  fs.rmSync(s.paths.video);
  const { result } = await s.run();
  assert.equal(result.outcome, 'failed', result.reason);
  assert.ok(s.catalog.edit.error.startsWith(UPLOAD_PROBLEM_PREFIX));
  assert.match(s.catalog.edit.error, /finished video is not on the Mac Mini/);
  assert.match(s.catalog.edit.error, /YouTube was not asked/);
  assert.doesNotMatch(s.catalog.edit.error, /refused|send the cut back/i);
  assert.equal(s.youtube.starts, 0);
});

test('when a saved session has expired, the channel is checked before the new one opens', async (t) => {
  const s = setup(t, { channel: 'Somebody Else', status: 'uploading' });
  // A session note from an earlier try, which YouTube no longer knows (404).
  fs.writeFileSync(s.paths.session, JSON.stringify({ sessionUrl: 'https://upload.example/session/gone', bytes: FILE_BYTES }));
  const { result } = await s.run();
  assert.equal(result.outcome, 'outage', result.reason);
  assert.equal(s.youtube.channelReads, 1, 'the channel was asked before a new session');
  assert.equal(s.youtube.starts, 0, 'no new session opened for another channel');
  assert.match(s.alarms[0], /"Somebody Else", not "Dane of Earth"/);
  assert.ok(fs.existsSync(s.paths.video));
});

test('the channel is asked once per job, not again for a session it already checked', async (t) => {
  const s = setup(t);
  const { result } = await s.run();
  assert.equal(result.outcome, 'uploaded', result.reason);
  assert.equal(s.youtube.channelReads, 1);
});

test('answers that give no ground stop the upload instead of rewinding forever', async (t) => {
  const s = setup(t);
  s.youtube.noRange = true;
  const { result, job } = await s.run();
  assert.equal(result.outcome, 'outage', result.reason);
  assert.match(result.reason, /without taking any of them/);
  assert.equal(s.youtube.pieces.length, yt.MAX_NO_PROGRESS, 'it stopped after the cap, not later');
  assert.equal(job.attempts, 0, 'YouTube misbehaving is not charged to the video');
  assert.ok(fs.existsSync(s.paths.video));
});

test('a refused sign-in stops, alarms with the fix, spends no attempt and leaves the edit finished', async (t) => {
  const s = setup(t);
  s.youtube.failToken = true;
  const { result, job } = await s.run();
  assert.equal(result.outcome, 'outage');
  assert.equal(job.attempts, 0);
  assert.equal(s.alarms.length, 1);
  assert.match(s.alarms[0], /studio:youtube-login/);
  assert.doesNotMatch(s.alarms[0], /refresh|secret/i, 'no credential in the alarm');
  assert.equal(s.catalog.edit.status, 'finished', 'nothing moved: it was never going up');
  assert.ok(fs.existsSync(s.paths.video));
});

test('a sign-in for another channel uploads nothing', async (t) => {
  const s = setup(t, { channel: 'Somebody Else' });
  const { result } = await s.run();
  assert.equal(result.outcome, 'outage');
  assert.match(s.alarms[0], /"Somebody Else", not "Dane of Earth"/);
  assert.equal(s.youtube.starts, 0);
  assert.equal(s.catalog.edit.status, 'finished');
});

test('an edit no longer finished is left alone', async (t) => {
  const s = setup(t, { status: 'approved' });
  const { result } = await s.run();
  assert.equal(result.outcome, 'moved_on');
  assert.equal(s.youtube.starts, 0);
  assert.ok(fs.existsSync(s.paths.video));
});

test('the watcher queues finished and half-uploaded edits, once each', async (t) => {
  const s = setup(t);
  const env = { STUDIO_PROJECT_ID: PROJECT };
  const first = await pass.watchFinished({ queue: s.queue, env, catalog: s.catalog });
  assert.equal(first.processed.length, 1);
  const again = await pass.watchFinished({ queue: s.queue, env, catalog: s.catalog });
  assert.equal(again.processed.length, 0);
  assert.equal(again.skipped.length, 1);
  s.catalog.edit.status = 'uploading';
  const s2 = setup(t, { status: 'uploading' });
  const mid = await pass.watchFinished({ queue: s2.queue, env, catalog: s2.catalog });
  assert.equal(mid.processed.length, 1, 'an upload a restart interrupted is picked up again');
});

test('a video already on YouTube only needs its catalog write: a shelf or end card changed since does not block it', async (t) => {
  const s = setup(t);
  s.youtube.videoReadMisses = 100;
  const first = await s.run();
  assert.equal(first.result.outcome, 'outage', first.result.reason);
  assert.equal(JSON.parse(fs.readFileSync(s.paths.session, 'utf8')).videoId, 'vid1', 'the video is up; only the writes are left');

  // Since then the track left the shelf and the end card was switched off.
  s.youtube.videoReadMisses = 0;
  s.advance(pass.RELEASE_HOLD_MS + 1);
  const second = await s.run({ shelf: { tracks: [] }, readEndCards: async () => ({ ok: true, cards: new Map() }) });
  assert.equal(second.result.outcome, 'uploaded', second.result.reason);
  assert.equal(s.catalog.edit.status, 'on_youtube');
  assert.equal(s.catalog.edit.youtubeVideoId, 'vid1');
  assert.equal(s.youtube.starts, 1, 'uploaded once');
  assert.equal(fs.existsSync(s.paths.video), false, 'and the file goes, as it should');
});

test('a rejected video whose failed write did not land keeps its note, so the retry never uploads it again', async (t) => {
  const s = setup(t);
  s.youtube.uploadStatus = 'rejected';
  s.catalog.refuseMoveTo = 'failed';
  const first = await s.run();
  assert.equal(first.result.outcome, 'outage', first.result.reason);
  assert.equal(s.catalog.edit.status, 'uploading');
  assert.equal(JSON.parse(fs.readFileSync(s.paths.session, 'utf8')).videoId, 'vid1', 'the note is kept until the edit reads failed');

  s.catalog.refuseMoveTo = '';
  s.advance(pass.RELEASE_HOLD_MS + 1);
  const second = await s.run();
  assert.equal(second.result.outcome, 'failed', second.result.reason);
  assert.equal(s.youtube.starts, 1, 'the whole file was not sent a second time');
  assert.equal(fs.existsSync(s.paths.session), false, 'now the edit reads failed, the rejected id goes');
  assert.ok(fs.existsSync(s.paths.video));
});

test('a wrong-channel sign-in on a resumed, expired session does not clear the alarm\'s throttle', async (t) => {
  const s = setup(t, { channel: 'Somebody Else', status: 'uploading' });
  fs.writeFileSync(s.paths.session, JSON.stringify({ sessionUrl: 'https://upload.example/session/gone', bytes: FILE_BYTES }));
  const { result } = await s.run();
  assert.equal(result.outcome, 'outage', result.reason);
  assert.equal(s.alarms.length, 1);
  assert.equal(s.cleared(), 0, 'a token that only refreshed proves nothing about the channel');
});

test('a resumed upload that finishes clears the alarm once, with no channel read needed', async (t) => {
  const s = setup(t);
  s.youtube.dropAfterPieces = 1;
  await s.run();
  const clearedAfterFirst = s.cleared();
  s.youtube.dropAfterPieces = Infinity;
  s.advance(pass.RELEASE_HOLD_MS + 1);
  const second = await s.run();
  assert.equal(second.result.outcome, 'uploaded', second.result.reason);
  assert.equal(s.cleared() - clearedAfterFirst, 1, 'YouTube showing the video is the proof');
});

test('an upload that failed every attempt is not queued again every six hours, only once the edit changes', async (t) => {
  const s = setup(t);
  const env = { STUDIO_PROJECT_ID: PROJECT };
  s.catalog.edit.updatedAt = new Date(Date.parse('2026-11-22T19:00:00Z')).toISOString();
  for (let n = 0; n < 5; n += 1) {
    await pass.watchFinished({ queue: s.queue, env, catalog: s.catalog, now: () => Date.parse('2026-11-22T20:00:00Z') + n * 86400000 });
    const job = s.queue.claim(OWNER, { stages: [pass.STAGE_UPLOAD] });
    assert.ok(job, `attempt ${n + 1} could be claimed`);
    s.queue.fail(job.id, OWNER, 'uploading this edit threw an error: boom');
    s.advance(24 * 60 * 60 * 1000);
  }
  const job = s.queue.listJobs({ stage: pass.STAGE_UPLOAD })[0];
  assert.equal(job.state, 'blocked', 'five failures is the queue\'s ceiling');
  assert.equal(job.attempts, 5);

  let at = Date.parse('2026-11-22T20:00:00Z') + 10 * 86400000;
  const later = await pass.watchFinished({ queue: s.queue, env, catalog: s.catalog, now: () => at });
  assert.equal(later.processed.length, 0, 'days on, it is still held: it would only fail the same way');
  assert.match(later.skipped[0].why, /failed all 5 attempts .*not tried again until the edit changes/);

  at += 1000;
  s.catalog.edit.updatedAt = new Date(at).toISOString(); // sent back and approved again
  const changed = await pass.watchFinished({ queue: s.queue, env, catalog: s.catalog, now: () => at });
  assert.equal(changed.processed.length, 1, 'once the edit changes, it is tried again');
});

test('the daemon runs the upload stage and its watcher, and says what the watch did', () => {
  assert.equal(typeof daemon.STAGE_RUNNERS[pass.STAGE_UPLOAD].run, 'function');
  assert.equal(daemon.WATCHERS[pass.STAGE_UPLOAD_WATCH].everyMs, pass.UPLOAD_WATCH_EVERY_MS);
  const line = daemon.formatWatch({ stage: pass.STAGE_UPLOAD_WATCH, label: 'upload watch', result: { ok: true, processed: [1], skipped: [] } });
  assert.equal(line, 'upload watch OK: 1 finished edit(s) queued to upload, 0 already waiting or blocked');
  // Each read takes the same first 200, so "the rest are read next minute" was not true.
  const full = daemon.formatWatch({ stage: pass.STAGE_UPLOAD_WATCH, label: 'upload watch', result: { ok: true, processed: [], skipped: [], truncated: true } });
  assert.match(full, /CANNOT TELL about finished edits past the first 200/);
  assert.doesNotMatch(full, /next minute/);
});

test('Rough cuts: an edit on YouTube links to YouTube Studio; a refused upload stays under Approved with its reason', () => {
  const view = roughCutsView({
    edits: [
      { id: 'a', sourceId: SRC, kind: 'short', status: 'on_youtube', youtubeVideoId: 'vid9', keepRanges: [] },
      { id: 'b', sourceId: SRC, kind: 'short', status: 'failed', error: `${UPLOAD_PROBLEM_PREFIX}invalid title`, keepRanges: [] },
      { id: 'c', sourceId: SRC, kind: 'short', status: 'failed', error: 'ffmpeg could not render it', keepRanges: [] },
    ],
  });
  assert.deepEqual(view.edits.map((e) => e.id).sort(), ['a', 'b']);
  assert.equal(view.counts.approved, 2);
  const a = view.edits.find((e) => e.id === 'a');
  assert.equal(a.youtubeUrl, 'https://studio.youtube.com/video/vid9/edit');
  const b = view.edits.find((e) => e.id === 'b');
  assert.equal(b.group, 'approved');
  assert.match(b.uploadProblem, /invalid title/);
  assert.equal(b.youtubeUrl, '');
});

test('the client reads YouTube\'s answers: Range header, and whose problem each refusal is', () => {
  assert.equal(yt.nextByteFrom('bytes=0-8388607'), 8388608);
  assert.equal(yt.nextByteFrom(null), 0);
  assert.equal(yt.classify({ status: 403, json: { error: { errors: [{ reason: 'quotaExceeded' }] } } }), 'quota');
  // YouTube's daily upload cap is a 400 (SC-842 send-back): waiting, never "this video is bad".
  assert.equal(yt.classify({ status: 400, json: { error: { errors: [{ reason: 'uploadLimitExceeded' }] } } }), 'quota');
  assert.equal(yt.classify({ status: 429, json: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } }), 'quota');
  assert.equal(yt.classify({ status: 401, json: {} }), 'auth');
  assert.equal(yt.classify({ status: 503, json: {} }), 'machine');
  assert.equal(yt.classify({ status: 0, json: {} }), 'machine');
  assert.equal(yt.classify({ status: 400, json: { error: { errors: [{ reason: 'invalidTitle' }] } } }), 'refused');
  assert.equal(yt.classify({ status: 404, json: {} }, { session: true }), 'expired');
});
