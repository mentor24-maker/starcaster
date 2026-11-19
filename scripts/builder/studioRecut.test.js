'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Reel Spinner 4d (SC-836) — a sent-back rough cut, re-cut from Dane's note.
 *
 * Real SQLite queue, real edit-list rules, and the real store's step rules
 * (videoEditsStore `stepError`), so an edit only moves the way production lets
 * it. The AI's answers are RECORDED replies in the door's own shape
 * (lib/aiClient.js `generate`), handed in through the `query` seam; the
 * catalog, Drive and ffmpeg are faked as in studioRoughCutPass.test.js.
 * Nothing touches the network.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const {
  runRecut, enqueueRecut, watchSentBack, capReason, cardReason, CARD_REASON_MAX, STAGE_RECUT, STAGE_RECUT_WATCH, ALARM_JOB,
} = require('../../workers/studio/recutPass.js');
const {
  checkRecut, buildRecutPrompt, spokenStretches, parseRecutAnswer, recutFromNote, MAX_RECUTS, FEATURE,
} = require('../../workers/studio/recut.js');
const { fullEdit, soundingWords } = require('../../workers/studio/editList.js');
const { STAGE_ROUGH_CUT } = require('../../workers/studio/roughCutPass.js');
const { stepError } = require('../../lib/videoEditsStore.js');
const { FAILURES } = require('../../workers/studio/proxy.js');
const daemon = require('../../workers/studio/daemon.js');

const PROJECT = 'proj_studio';
const OWNER = 'recut-test';
const SRC = 'aaaaaaaa-0000-4000-8000-000000000001';
const EDIT = 'e1000000-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const THIRD = 'cccccccc-0000-4000-8000-000000000003';
const GB = 1024 ** 3;

/** A 60-second recording: a word every half second, with a 4-second pause at 10-14 s. */
function recording() {
  const words = [];
  for (let t = 0.1; t < 59.5; t += 0.5) {
    if (t > 10 && t < 14) continue;
    words.push({ start: Math.round(t * 1000) / 1000, end: Math.round((t + 0.35) * 1000) / 1000, word: `w${Math.round(t * 10)}` });
  }
  return { words, marks: [{ start: 10, end: 14, kind: 'pause', keep_s: 0.5 }], durationS: 60 };
}

const REC = recording();
const FIRST_CUT = fullEdit({ words: REC.words, marks: REC.marks, durationS: 60, fps: 30, sourceId: SRC })
  .ranges.map((r) => ({ start_s: r.start, end_s: r.end }));

/** Recorded replies, in the shape the AI door returns them. */
const REPLY = {
  startLater: {
    ok: true, provider: 'anthropic', providerLabel: 'Anthropic', model: 'claude-opus-5-5', stopReason: 'end_turn',
    usage: { inputTokens: 1800, outputTokens: 40 }, skipped: [],
    text: '{"keep":[{"start_s":2.1,"end_s":60}],"changed":"The edit now starts two seconds later."}',
    json: { keep: [{ start_s: 2.1, end_s: 60 }], changed: 'The edit now starts two seconds later.' },
  },
  pastTheEnd: {
    ok: true, provider: 'anthropic', model: 'claude-opus-5-5', stopReason: 'end_turn', usage: null, skipped: [],
    json: { keep: [{ start_s: 2.1, end_s: 600 }], changed: 'Starts later.' },
  },
  cannot: {
    ok: true, provider: 'anthropic', model: 'claude-opus-5-5', stopReason: 'end_turn', usage: null, skipped: [],
    json: { cannot: 'the note asks for music, which is not a choice of what to keep' },
  },
  noProvider: {
    ok: false, code: 'no_provider', error: 'No AI provider could answer. Anthropic: no key set.',
    skipped: [{ provider: 'anthropic', label: 'Anthropic', verdict: 'NOT SET', reason: 'no key set' }],
  },
};

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-recut-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setup(t, {
  recutCount = 0, note = 'start two seconds later', reply = REPLY.startLater,
  kind = 'full', momentIndex = null, audioSourceId = null, pairs = [], moments = [],
} = {}) {
  const dir = tmp(t);
  const queue = openQueue(path.join(dir, 'queue.sqlite'), { clock: () => Date.parse('2026-11-19T17:00:00Z') });
  t.after(() => queue.close());
  const derivedDir = path.join(dir, 'derived');
  const proxy = path.join(dir, 'proxy.mp4');
  fs.writeFileSync(proxy, 'picture');
  const otherProxy = path.join(dir, 'other.mp4');
  fs.writeFileSync(otherProxy, 'sound');
  const sources = {
    [SRC]: { id: SRC, durationS: 60, fps: 30, proxyPath: proxy, localPath: '/cache/IMG_1962.MOV' },
    [OTHER]: { id: OTHER, durationS: 60, fps: 30, proxyPath: otherProxy, localPath: '/cache/ZOOM0001.WAV' },
  };
  const edit = {
    id: EDIT, sourceId: SRC, kind, momentIndex, keepRanges: FIRST_CUT.map((r) => ({ ...r })),
    audioSourceId, status: 'sent_back', roughCutDriveFileId: 'drive-old', daneNote: note,
    recutCount, error: '', updatedAt: '2026-11-19T16:59:00Z',
  };
  const edits = [edit];
  const catalog = {
    edits,
    getSourceById: async (id) => (sources[id]
      ? { ok: true, status: 200, data: { ...sources[id] } }
      : { ok: false, status: 404, error: 'Source not found' }),
    getTranscriptBySource: async () => ({ ok: true, status: 200, data: { state: 'done', words: REC.words } }),
    getCutMarksBySource: async () => ({ ok: true, status: 200, data: { state: 'done', marks: REC.marks, durationS: 60 } }),
    getMomentsBySource: async () => ({ ok: true, status: 200, data: { status: 'done', moments } }),
    listAudioPairsForSource: async () => ({ ok: true, status: 200, data: pairs }),
    listEditsForSource: async () => ({ ok: true, status: 200, data: edits.map((e) => ({ ...e })) }),
    listEditsByStatus: async (limit, statuses) => ({ ok: true, status: 200, data: edits.filter((e) => statuses.includes(e.status)).map((e) => ({ ...e })) }),
    createEdit: async () => ({ ok: false, status: 409, error: 'duplicate key' }),
    // The store's own rules, as lib/videoEditsStore.js moveEdit applies them.
    moveEdit: async (id, to, patch = {}) => {
      const e = edits.find((x) => x.id === id);
      if (!e) return { ok: false, status: 404, error: 'That edit does not exist in this project' };
      const refused = stepError(e.status, to);
      if (refused) return refused;
      const handBack = e.status === 'sent_back' && to === 'review';
      if ((to === 'failed' || handBack) && !patch.error) return { ok: false, status: 400, error: 'error is required' };
      // The store's length rule (reelSpinnerInput optionalText, 2000).
      if (patch.error && String(patch.error).trim().length > 2000) {
        return { ok: false, status: 400, error: `error must be 2000 characters or fewer (got ${String(patch.error).trim().length})` };
      }
      if (e.status === 'sent_back' && to === 'rendering') e.recutCount += 1;
      e.status = to;
      e.error = to === 'failed' || handBack ? patch.error : '';
      if (patch.keepRanges) e.keepRanges = patch.keepRanges;
      if (patch.roughCutDriveFileId) e.roughCutDriveFileId = patch.roughCutDriveFileId;
      if ('audioSourceId' in patch) e.audioSourceId = patch.audioSourceId;
      return { ok: true, status: 200, data: { ...e } };
    },
    getEditById: async (id) => ({ ok: true, status: 200, data: edits.find((e) => e.id === id) ? { ...edits.find((e) => e.id === id) } : null }),
  };

  const drive = {
    files: [],
    uploads: 0,
    getAccessToken: async () => ({ ok: true, data: { accessToken: 'tok' } }),
    findFolderByName: async () => ({ ok: true, data: { id: 'folder-rc' } }),
    createFolder: async () => ({ ok: true, data: { id: 'folder-rc' } }),
    findFileByName: async () => ({ ok: true, data: null }),
    upload: async ({ fileName, filePath }) => {
      drive.uploads += 1;
      const file = { id: `drive-new-${drive.uploads}`, name: fileName, size: String(fs.statSync(filePath).size) };
      drive.files.push(file);
      return { ok: true, status: 200, data: file };
    },
  };

  const ffmpegCalls = [];
  const ffmpeg = (args) => {
    ffmpegCalls.push(args);
    if (args.includes('-version')) return { ok: true, ms: 1 };
    if (ffmpeg.refuse) return { ok: false, reason: FAILURES.FFMPEG_FAILED, detail: ffmpeg.refuse, ms: 5 };
    fs.writeFileSync(args[args.length - 1], Buffer.alloc(2048, 1));
    return { ok: true, ms: 3100 };
  };
  ffmpeg.refuse = '';

  const asked = [];
  const query = async (system, user, opts) => {
    asked.push({ system, user, opts });
    return typeof reply === 'function' ? reply() : reply;
  };
  const alarms = [];
  const options = {
    queue, owner: OWNER, catalog, drive, ffmpeg, query,
    env: { STUDIO_PROJECT_ID: PROJECT, STUDIO_DERIVED_DIR: derivedDir },
    probeDuration: () => 55,
    freeBytes: () => ({ ok: true, value: 100 * GB }),
    alarm: (reason) => { alarms.push(reason); return { said: 'posted' }; },
    clearAlarm: () => {},
  };
  enqueueRecut(queue, { editId: EDIT });
  const run = () => runRecut(options);
  return { queue, catalog, drive, ffmpeg, ffmpegCalls, asked, alarms, run, options, edit: () => edits[0] };
}

const renders = (calls) => calls.filter((a) => !a.includes('-version'));
const kept = (ranges) => ranges.reduce((s, r) => s + (r.end_s - r.start_s), 0);

// ── The acceptance criteria ─────────────────────────────────────────────────

test('a valid answer is re-rendered and goes back to review, counted as a re-cut, with its before and after lengths', async (t) => {
  const s = setup(t);
  const report = await s.run();

  assert.equal(report.recut.length, 1, JSON.stringify(report));
  const e = s.edit();
  assert.equal(e.status, 'review');
  assert.equal(e.recutCount, 1);
  assert.equal(e.error, '', 'a re-cut carries no problem line');
  assert.equal(e.roughCutDriveFileId, 'drive-new-1', 'the card now points at the NEW rough cut');
  assert.ok(e.keepRanges[0].start_s >= 2.1, `it starts two seconds later (${e.keepRanges[0].start_s})`);
  assert.ok(!e.keepRanges.some((r) => r.start_s < 12 && r.end_s > 12), 'the pause the first cut took out stays out');
  assert.equal(renders(s.ffmpegCalls).length, 1);
  assert.match(s.drive.files[0].name, /full edit, re-cut 1 \(e1000000\)\.mp4$/, 'Drive tells the re-cut from the cut he sent back');

  const r = report.recut[0];
  assert.equal(r.beforeS, Math.round(kept(FIRST_CUT) * 1000) / 1000);
  assert.ok(r.afterS < r.beforeS - 1.9, `after (${r.afterS} s) is about two seconds shorter than before (${r.beforeS} s)`);
  assert.match(r.reason, /re-cut from the note: .* s → .* s \(The edit now starts two seconds later\.\)/);
  assert.equal(r.jobAction, 'completed');

  // The question went through the door's strong tier, carrying the note.
  assert.equal(s.asked.length, 1);
  assert.equal(s.asked[0].opts.tier, 'strong');
  assert.match(s.asked[0].user, /"start two seconds later"/);
});

test('an invalid answer goes back to review UNCHANGED with the reason — no render, no upload, not counted', async (t) => {
  const s = setup(t, { reply: REPLY.pastTheEnd });
  const report = await s.run();

  assert.equal(report.handedBack.length, 1, JSON.stringify(report));
  const e = s.edit();
  assert.equal(e.status, 'review');
  assert.match(e.error, /^could not re-cut from your note: stretch 1 of the AI's answer ends at 600 s, past the end of the 60\.00-second recording$/);
  assert.equal(e.recutCount, 0);
  assert.deepEqual(e.keepRanges, FIRST_CUT, 'the edit is exactly the one he sent back');
  assert.equal(e.roughCutDriveFileId, 'drive-old', 'and so is its rough cut');
  assert.equal(renders(s.ffmpegCalls).length, 0);
  assert.equal(s.drive.uploads, 0);
});

test('a note the AI says it cannot do goes back unchanged, with its reason', async (t) => {
  const s = setup(t, { note: 'add some music', reply: REPLY.cannot });
  await s.run();
  assert.equal(s.edit().status, 'review');
  assert.equal(s.edit().error, 'could not re-cut from your note: the AI says the note asks for music, which is not a choice of what to keep');
});

test('the fourth send-back stops: handed back with the cap sentence, and the AI is not asked', async (t) => {
  const s = setup(t, { recutCount: MAX_RECUTS, note: 'still too long' });
  const report = await s.run();

  assert.equal(report.handedBack.length, 1);
  assert.equal(report.handedBack[0].outcome, 'stopped');
  assert.equal(s.edit().status, 'review');
  assert.equal(s.edit().error, 're-cut 3 times; tell an agent session what is still wrong');
  assert.equal(s.edit().error, capReason(3));
  assert.equal(s.edit().recutCount, 3, 'stopping is not another re-cut');
  assert.equal(s.asked.length, 0, 'no AI call is paid for');
  assert.equal(renders(s.ffmpegCalls).length, 0);
});

test('three re-cuts in a row, then the fourth send-back stops', async (t) => {
  // A different answer each time, so none of them is "the same as before".
  let n = 0;
  const s = setup(t, { reply: () => {
    n += 1;
    return { ...REPLY.startLater, json: { keep: [{ start_s: 2.1 + n, end_s: 60 }], changed: `try ${n}` } };
  } });
  for (let round = 1; round <= MAX_RECUTS; round += 1) {
    if (round > 1) {
      Object.assign(s.edit(), { status: 'sent_back', daneNote: `try ${round}` });
      enqueueRecut(s.queue, { editId: EDIT });
    }
    const one = await s.run();
    assert.equal(one.recut.length, 1, `re-cut ${round}: ${JSON.stringify(one)}`);
    assert.equal(s.edit().recutCount, round);
  }
  Object.assign(s.edit(), { status: 'sent_back', daneNote: 'one more' });
  enqueueRecut(s.queue, { editId: EDIT });
  const fourth = await s.run();
  assert.equal(fourth.handedBack[0].outcome, 'stopped', JSON.stringify(fourth));
  assert.equal(s.edit().error, capReason(3));
  assert.equal(n, 3, 'the AI was asked three times, never a fourth');
});

// ── Review round 1 (SC-836): reasons that cannot fit, line-ups, Drive names ──

test('an AI reason too long for the card is shortened to fit, and the AI is paid once, not on every retry', async (t) => {
  const long = `the note ${'cannot be done because '.repeat(110)}end`;
  assert.ok(long.length > 2400);
  const s = setup(t, { reply: { ...REPLY.cannot, json: { cannot: long } } });
  const first = await s.run();
  assert.equal(first.handedBack.length, 1, JSON.stringify(first));
  const e = s.edit();
  assert.equal(e.status, 'review');
  assert.ok(e.error.length <= CARD_REASON_MAX, `the card's reason fits (${e.error.length})`);
  assert.match(e.error, /^could not re-cut from your note: the AI says the note cannot be done/);
  assert.match(e.error, /…$/, 'and says it was shortened');
  const again = await s.run();
  assert.equal(again.handedBack.length + again.released.length + again.failed.length, 0, 'nothing is left to retry');
  assert.equal(s.asked.length, 1, 'one AI call, not several');
});

test('a hand-back the catalog refuses with a 400 blocks the job with the reason instead of retrying it', async (t) => {
  const s = setup(t, { reply: REPLY.cannot });
  const real = s.catalog.moveEdit;
  s.catalog.moveEdit = async (id, to, patch) => (to === 'review'
    ? { ok: false, status: 400, error: 'error must be text' }
    : real(id, to, patch));
  const report = await s.run();
  assert.equal(report.blocked.length, 1, JSON.stringify(report));
  assert.match(report.blocked[0].reason, /catalog refused it: error must be text/);
  assert.match(report.blocked[0].reason, /the note asks for music/);
  assert.equal(s.queue.listJobs({ stage: STAGE_RECUT })[0].state, 'blocked');
  assert.equal(s.edit().status, 'sent_back');
  // The watcher shows the block instead of queueing the edit again.
  const watch = await watchSentBack({ queue: s.queue, env: { STUDIO_PROJECT_ID: PROJECT }, catalog: s.catalog });
  assert.equal(watch.processed.length, 0);
  assert.match(watch.skipped[0].why, /is blocked/);
});

test('cardReason leaves a short reason alone and cuts a long one at a word', () => {
  assert.equal(cardReason('  fine  '), 'fine');
  const cut = cardReason('word '.repeat(1000));
  assert.ok(cut.length <= 2000);
  assert.match(cut, /word…$/);
});

test('the line-up checked is the one the render uses: this recording with the sound\'s, not the sound with a third', async (t) => {
  const pairs = [
    // Listed first, so "any line-up the sound is part of" picks it.
    { sourceAId: OTHER, sourceBId: THIRD, status: 'done', offsetS: 30, audioSourceId: OTHER },
    { sourceAId: SRC, sourceBId: OTHER, status: 'done', offsetS: 0, audioSourceId: OTHER },
  ];
  const s = setup(t, { audioSourceId: OTHER, pairs });
  const report = await s.run();
  assert.equal(report.recut.length, 1, JSON.stringify(report));
  assert.equal(s.edit().audioSourceId, OTHER, 'the re-cut keeps the other recording\'s sound');
  const render = renders(s.ffmpegCalls)[0];
  assert.ok(render.some((a) => String(a).endsWith('other.mp4')), 'and the render is given that sound');
});

test('a re-cut short is named on Drive with its moment, the same name the rough-cut retry would use', async (t) => {
  const moments = [{ start_s: 0, end_s: 30, score: 7 }, { start_s: 2, end_s: 60, score: 9 }];
  const s = setup(t, { kind: 'short', momentIndex: 1, moments });
  const report = await s.run();
  assert.equal(report.recut.length, 1, JSON.stringify(report));
  const { driveFileName } = require('../../workers/studio/roughCutPass.js');
  const expected = driveFileName({ id: SRC, localPath: '/cache/IMG_1962.MOV' }, { ...s.edit() }, moments[1]);
  assert.equal(s.drive.files[0].name, expected);
  assert.match(s.drive.files[0].name, /short from 0m02s, score 9/);
});

test('an error thrown after the AI was paid hands the edit back with the reason, and the AI is not paid again', async (t) => {
  const s = setup(t);
  const report = await runRecut({ ...s.options, freeBytes: () => { throw new Error('statfs exploded'); } });
  assert.equal(report.handedBack.length, 1, JSON.stringify(report));
  assert.match(s.edit().error, /getting the render ready failed \(statfs exploded\)/);
  assert.equal(s.edit().status, 'review');
  await s.run();
  assert.equal(s.asked.length, 1);
});

// ── The machine's faults are not the edit's ─────────────────────────────────

test('no AI provider able to pay: the job waits an hour, the edit stays sent back, the bus is told', async (t) => {
  const s = setup(t, { reply: REPLY.noProvider });
  const report = await s.run();

  assert.equal(report.released.length, 1, JSON.stringify(report));
  assert.equal(report.released[0].jobAction, 'released');
  assert.equal(s.edit().status, 'sent_back', 'exactly as he left it');
  assert.equal(s.edit().error, '');
  assert.equal(s.alarms.length, 1);
  assert.match(s.alarms[0], /re-cuts are stopped: no AI provider can pay\. Anthropic: no key\./);
  assert.equal(s.queue.listJobs({ stage: STAGE_RECUT })[0].attempts, 0, 'no attempt spent');
  assert.equal(ALARM_JOB, 'reel-spinner-recut');
});

test('ffmpeg missing is checked BEFORE the AI is paid', async (t) => {
  const s = setup(t);
  s.ffmpeg.refuse = '';
  const missing = () => ({ ok: false, reason: FAILURES.FFMPEG_MISSING, detail: 'not found' });
  const report = await runRecut({ queue: s.queue, owner: OWNER, catalog: s.catalog, drive: s.drive, ffmpeg: missing,
    query: async () => { throw new Error('must not be asked'); }, env: { STUDIO_PROJECT_ID: PROJECT } });
  assert.equal(report.released.length, 1);
  assert.match(report.released[0].reason, /ffmpeg is not installed/);
  assert.equal(s.edit().status, 'sent_back');
});

test('a render ffmpeg refuses: the edit fails with the reason, its new ranges are kept, and a rough-cut job re-renders it', async (t) => {
  const s = setup(t);
  s.ffmpeg.refuse = 'Invalid argument';
  const report = await s.run();

  assert.equal(report.failed.length, 1, JSON.stringify(report));
  assert.equal(s.edit().status, 'failed');
  assert.match(s.edit().error, /ffmpeg could not render the re-cut: Invalid argument/);
  assert.ok(s.edit().keepRanges[0].start_s >= 2.1, 'the AI\'s decision is saved, never paid for twice');
  const retry = s.queue.listJobs({ stage: STAGE_ROUGH_CUT });
  assert.equal(retry.length, 1);
  assert.equal(retry[0].subjectId, SRC);
});

test('a throw while rendering or uploading fails the edit and queues a re-render, never leaving it in "rendering"', async (t) => {
  const s = setup(t);
  s.drive.getAccessToken = async () => { throw new Error('keychain locked'); };
  s.drive.upload = async () => { throw new Error('socket hang up'); };
  const report = await s.run();

  assert.equal(report.failed.length, 1, JSON.stringify(report));
  assert.equal(s.edit().status, 'failed', 'not stuck in rendering');
  assert.match(s.edit().error, /threw an error/);
  const retry = s.queue.listJobs({ stage: STAGE_ROUGH_CUT });
  assert.equal(retry.length, 1, 'a rough-cut job renders it again');
  assert.equal(s.asked.length, 1, 'the AI was paid once');
});

test('an edit that is no longer sent back is left alone', async (t) => {
  const s = setup(t);
  s.edit().status = 'approved';
  const report = await s.run();
  assert.equal(report.movedOn.length, 1);
  assert.equal(s.asked.length, 0);
});

// ── The watcher ─────────────────────────────────────────────────────────────

test('the watcher queues one re-cut per sent-back edit, and a second watch queues nothing new', async (t) => {
  const s = setup(t);
  // setup queued one already; a fresh queue shows the watcher doing it alone.
  const q = openQueue(':memory:');
  t.after(() => q.close());
  const env = { STUDIO_PROJECT_ID: PROJECT };
  const first = await watchSentBack({ queue: q, env, catalog: s.catalog });
  assert.deepEqual(first.processed.map((p) => p.editId), [EDIT]);
  const second = await watchSentBack({ queue: q, env, catalog: s.catalog });
  assert.equal(second.processed.length, 0);
  assert.match(second.skipped[0].why, /already waiting/);
  assert.equal(q.listJobs({ stage: STAGE_RECUT }).length, 1);

  const off = await watchSentBack({ queue: q, env: {}, catalog: s.catalog });
  assert.match(off.notConfigured, /STUDIO_PROJECT_ID/);
  const blind = await watchSentBack({ queue: q, env, catalog: { listEditsByStatus: async () => ({ ok: false, error: '503' }) } });
  assert.equal(blind.ok, false);
  assert.match(blind.error, /sent-back edits could not be read: 503/);
});

test('the daemon runs re-cuts right behind transcription, and watches for send-backs once a minute', () => {
  const stages = Object.keys(daemon.STAGE_RUNNERS);
  assert.ok(daemon.STAGE_RUNNERS[STAGE_RECUT]);
  assert.equal(stages.indexOf(STAGE_RECUT), stages.indexOf('transcribe') + 1);
  assert.ok(stages.indexOf(STAGE_RECUT) < stages.indexOf('rough_cut'));
  assert.equal(daemon.WATCHERS[STAGE_RECUT_WATCH].everyMs, 60 * 1000);
  const line = (r) => daemon.formatWatch({ stage: STAGE_RECUT_WATCH, label: 're-cut watch', result: r });
  assert.match(line({ ok: true, processed: [{}], skipped: [] }), /re-cut watch OK: 1 re-cut\(s\) queued/);
  assert.match(line({ ok: false, error: 'x' }), /COULD NOT TELL/);
  assert.match(line({ ok: true, notConfigured: 'STUDIO_PROJECT_ID is not set' }), /OFF/);
});

// ── The rules (recut.js) ────────────────────────────────────────────────────

const INPUT = { kind: 'full', keepRanges: FIRST_CUT, words: REC.words, marks: REC.marks, durationS: 60, fps: 30, sourceId: SRC };

test('the AI is shown the edit as spoken stretches: the cut marks\' gaps are joined over', () => {
  const sounding = soundingWords(REC.words, REC.marks);
  const stretches = spokenStretches(FIRST_CUT.map((r) => ({ start: r.start_s, end: r.end_s })), sounding);
  assert.ok(FIRST_CUT.length >= 2, 'the first cut has the pause taken out');
  assert.equal(stretches.length, 1, 'but no word is cut, so it reads as one stretch');
  const { user, system } = buildRecutPrompt({ ...INPUT, note: 'start two seconds later' });
  assert.match(user, /The current edit keeps these spoken stretches:\n {2}0\.00-60\.00: w1 w6/);
  assert.match(user, /\[0\.10-/);
  assert.match(system, /Answer ONLY with JSON/);
});

test('a boundary inside a word is moved to the word\'s edge, so the word is kept whole', () => {
  // w21 is said 2.1-2.45 s; 2.3 s is inside it.
  const checked = checkRecut({ keep: [{ start_s: 2.3, end_s: 60 }] }, INPUT);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.ranges[0].start_s, 2.1);
  assert.match(checked.notes[0], /2\.30 s was inside "w21", so the stretch starts at 2\.10 s/);
});

test('two stretches the AI kept apart are not refused when widening to a word makes them touch', () => {
  // w201 is said 20.1-20.45 s. The AI keeps [15, 20.3] and [20.4, 40]: they do
  // not overlap, but 20.3 s is inside the word, so the first stretch's end
  // widens to 20.45 s, past where the second starts. That is the rules' own
  // widening, not the AI asking for an overlap, so the two are joined.
  const checked = checkRecut({ keep: [{ start_s: 15, end_s: 20.3 }, { start_s: 20.4, end_s: 40 }] }, INPUT);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.ok(checked.ranges.some((r) => r.start_s <= 20.1 && r.end_s >= 20.45), 'the word is kept whole, in one stretch');
  for (let i = 1; i < checked.ranges.length; i += 1) {
    assert.ok(checked.ranges[i].start_s > checked.ranges[i - 1].end_s, 'the stretches stay in order and apart');
  }
});

test('the rules refuse what they cannot check, each naming the stretch and why', () => {
  const reason = (keep) => checkRecut({ keep }, INPUT).reason;
  assert.match(reason([{ start_s: 'two', end_s: 5 }]), /stretch 1 .* not a pair of numbers/);
  assert.match(reason([{ start_s: 5, end_s: 4 }]), /ends \(4 s\) before it starts \(5 s\)/);
  assert.match(reason([{ start_s: 70, end_s: 80 }]), /starts at 70 s, outside the 60\.00-second recording/);
  assert.match(reason([{ start_s: 20, end_s: 30 }, { start_s: 25, end_s: 40 }]), /stretch 2 .* starts at 25 s, before the stretch before it ends \(30 s\)/);
  assert.match(reason([]), /keeps nothing/);
  assert.match(reason([{ start_s: 10.5, end_s: 13.5 }]), /once the pauses and fillers were taken out, the AI's stretches kept nothing/);
  assert.match(checkRecut({}, INPUT).reason, /neither a list of stretches/);
  // The whole recording again is the first cut again.
  assert.match(reason([{ start_s: 0, end_s: 60 }]), /came out the same as the one you sent back/);
  // A hair past the end is trimmed, not refused.
  assert.equal(checkRecut({ keep: [{ start_s: 2.1, end_s: 60.3 }] }, INPUT).ok, true);
});

test('the door\'s answer is read from its JSON, or from a fenced block of text', () => {
  assert.deepEqual(parseRecutAnswer({ json: { keep: [] } }).value, { keep: [] });
  assert.deepEqual(parseRecutAnswer({ text: '```json\n{"cannot":"no"}\n```' }).value, { cannot: 'no' });
  assert.match(parseRecutAnswer({ text: 'sure!' }).reason, /not JSON/);
});

test('through the AI door under its own feature name, never a provider by name', async () => {
  const calls = [];
  const door = async (opts) => { calls.push(opts); return REPLY.startLater; };
  const { queryThroughDoor } = require('../../workers/studio/recut.js');
  const out = await recutFromNote({ ...INPUT, note: 'start later' }, {
    query: (system, user, opts) => queryThroughDoor(system, user, opts, door),
    config: { tier: 'strong', maxTokens: 2000, timeoutMs: 1000 },
  });
  assert.equal(out.state, 'done');
  assert.equal(calls[0].feature, FEATURE);
  assert.equal(calls[0].json, true);
  assert.equal(calls[0].tier, 'strong');
  assert.ok(!('provider' in calls[0]));
  // A cut-off answer is refused, not half-used.
  const cut = await recutFromNote({ ...INPUT, note: 'x' }, { query: async () => ({ ...REPLY.startLater, stopReason: 'max_tokens' }), config: { maxTokens: 2000 } });
  assert.equal(cut.state, 'refused');
  assert.match(cut.reason, /cut off at the 2000-token limit/);
  // The door's own "not JSON" is a refusal (the note's), not a machine fault.
  const bad = await recutFromNote({ ...INPUT, note: 'x' }, { query: async () => ({ ok: false, code: 'bad_json', error: 'Anthropic answered, but not with JSON' }), config: {} });
  assert.equal(bad.state, 'refused');
});
