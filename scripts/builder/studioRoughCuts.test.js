'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Reel Spinner 4c (SC-835) — the Rough cuts screen's server half.
 *
 * The pure view (lib/studioRoughCuts.js) is tested directly; the route
 * (routes/studioRoughCuts.js, through routes/studio.js) is driven end to end
 * against the fake database that reads its schema FROM the setup SQL, so the
 * tenant columns are the real ones. Verdicts are checked on the stored ROW,
 * never trusted from the answer.
 */

const { roughCutsView, savedSeconds } = require('../../lib/studioRoughCuts');

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SQL_TEXT = ['video_studio_setup.sql', 'video_transcripts_setup.sql', 'video_cut_marks_setup.sql', 'video_reel_spinner_setup.sql']
  .map((file) => fs.readFileSync(path.join(SQL_DIR, file), 'utf8'))
  .join('\n');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const contextForPath = require.resolve('../../lib/contextFor.js');
const MODULES = [
  '../../lib/projectScope.js',
  '../../lib/videoSessionsStore.js',
  '../../lib/videoSourcesStore.js',
  '../../lib/videoTranscriptsStore.js',
  '../../lib/videoCutMarksStore.js',
  '../../lib/videoMomentsStore.js',
  '../../lib/videoAudioPairsStore.js',
  '../../lib/videoEditsStore.js',
  '../../routes/studioMoments.js',
  '../../routes/studioPairs.js',
  '../../routes/studioRoughCuts.js',
  '../../routes/studio.js',
].map((p) => require.resolve(p));

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

// ── the pure view ───────────────────────────────────────────────────────────

function edit(id, extra = {}) {
  return {
    id, sourceId: 's1', kind: 'full', momentIndex: null, status: 'review',
    keepRanges: [{ start_s: 0, end_s: 60 }, { start_s: 70, end_s: 100 }],
    roughCutDriveFileId: `rc-${id}`, daneNote: '', recutCount: 0, updatedAt: '', ...extra,
  };
}

test('time saved: a full edit is the recording minus what it keeps; a short, the gaps inside it', () => {
  assert.equal(savedSeconds(edit('f'), { durationS: 120 }), 30);
  assert.equal(savedSeconds(edit('f'), { durationS: null }), null, 'unknown length is said as unknown, never 0');
  assert.equal(savedSeconds(edit('s', { kind: 'short', keepRanges: [{ start_s: 40, end_s: 50 }, { start_s: 52, end_s: 60 }] }), null), 2);
});

test('groups: approved holds every step after it; drafts are counted as being made, never shown; failed is neither', () => {
  const view = roughCutsView({
    edits: [
      edit('a', { status: 'review' }),
      edit('b', { status: 'finished' }),
      edit('c', { status: 'skipped' }),
      edit('d', { status: 'sent_back', daneNote: 'shorter' }),
      edit('e', { status: 'rendering' }),
      edit('f', { status: 'failed' }),
    ],
    sources: [{ id: 's1', durationS: 120 }],
  });
  assert.deepEqual(view.counts, { waiting: 1, approved: 1, skipped: 1, sent_back: 1, making: 1 });
  assert.deepEqual(view.edits.map((e) => e.id), ['a', 'b', 'c', 'd']);
  assert.equal(view.edits[1].group, 'approved');
  assert.equal(view.edits[0].watchUrl, 'https://drive.google.com/file/d/rc-a/view');
});

test('newest recording first, then the full edit, then shorts in moment order; a short carries its moment', () => {
  const view = roughCutsView({
    edits: [
      edit('old', { sourceId: 's-old' }),
      edit('short1', { kind: 'short', momentIndex: 1 }),
      edit('short0', { kind: 'short', momentIndex: 0 }),
      edit('full', {}),
    ],
    sources: [
      { id: 's-old', recordedAt: '2026-10-01T00:00:00Z', localPath: '/m/IMG_0001.MOV' },
      { id: 's1', recordedAt: '2026-11-01T00:00:00Z', localPath: '/m/IMG_1962.MOV' },
    ],
    momentsBySource: {
      s1: { moments: [{ start_s: 10, end_s: 20, score: 91, reasons: ['warm'] }, { start_s: 30, end_s: 40, score: 70 }] },
    },
  });
  assert.deepEqual(view.edits.map((e) => e.id), ['full', 'short0', 'short1', 'old']);
  assert.equal(view.edits[0].recordingName, 'IMG_1962.MOV');
  assert.equal(view.edits[1].moment.score, 91);
  assert.deepEqual(view.edits[1].moment.reasons, ['warm']);
  assert.equal(view.edits[0].moment, null);
});

// ── the route, end to end ──────────────────────────────────────────────────

function withRoute() {
  const db = createFakeDb(parseSchemaText(SQL_TEXT));
  const saved = {};
  const swap = (p, exports) => {
    saved[p] = require.cache[p];
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  };
  swap(supabasePath, {
    isConfigured: () => true,
    tableConfig: () => ({
      videoSessions: 'video_sessions',
      videoSources: 'video_sources',
      videoTranscripts: 'video_transcripts',
      videoCutMarks: 'video_cut_marks',
      videoMoments: 'video_moments',
      videoAudioPairs: 'video_audio_pairs',
      videoEdits: 'video_edits',
    }),
    sbQuery: (args) => (db.refuse && db.refuse(args)) || db.sbQuery(args),
  });
  swap(contextForPath, { readContextFor: async () => ({ ok: true, status: 200, data: null }) });
  for (const p of MODULES) delete require.cache[p];
  const [, sessions, sources, , , moments, , edits] = MODULES.slice(0, 8).map((p) => require(p));
  const route = require(MODULES[MODULES.length - 1]);
  const restore = () => {
    for (const [p, entry] of Object.entries(saved)) {
      if (entry) require.cache[p] = entry; else delete require.cache[p];
    }
    for (const p of MODULES) delete require.cache[p];
  };
  return { db, route, sessions, sources, moments, edits, restore };
}

function call(route, url, scope, method = 'GET', body = undefined) {
  const req = {
    url, method, body,
    headers: { host: 'localhost' },
    projectContext: { project: { id: scope.projectId } },
    authUser: { id: scope.userId },
  };
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, headers) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers || {})) this.headers[k.toLowerCase()] = v;
    },
    end(chunk) { this.body = chunk; },
  };
  const pathname = new URL(url, 'http://localhost').pathname;
  return route.handle(req, res, pathname, method).then((handled) => ({ handled, res, json: () => JSON.parse(String(res.body)) }));
}

/** A recording with one rough cut waiting for review, the way the Mini leaves it. */
async function waitingEdit(ctx, scope, input = {}) {
  const session = await ctx.sessions.createSession({ title: 'A talk' }, scope);
  assert.equal(session.ok, true, session.error);
  const source = await ctx.sources.createSource({ sessionId: session.data.id, durationS: 149, ...input }, scope);
  assert.equal(source.ok, true, source.error);
  const made = await ctx.edits.createEdit(source.data.id, { kind: 'full', keepRanges: [{ start_s: 0, end_s: 123 }] }, scope);
  assert.equal(made.ok, true, made.error);
  for (const [to, patch] of [['rendering', {}], ['review', { roughCutDriveFileId: `rc-${made.data.id}` }]]) {
    const moved = await ctx.edits.moveEdit(made.data.id, to, patch, scope);
    assert.equal(moved.ok, true, moved.error);
  }
  return { sourceId: source.data.id, editId: made.data.id };
}

async function storedStatus(ctx, editId, scope) {
  const row = await ctx.edits.getEditById(editId, scope);
  assert.equal(row.ok, true, row.error);
  return row.data;
}

test('GET /api/studio/rough-cuts lists this project only — another project\'s edits never appear', async () => {
  const ctx = withRoute();
  try {
    const mine = await waitingEdit(ctx, SCOPE_A);
    const theirs = await waitingEdit(ctx, SCOPE_B);
    const { res, json } = await call(ctx.route, '/api/studio/rough-cuts', SCOPE_A);
    assert.equal(res.statusCode, 200, res.body);
    const data = json().data;
    assert.deepEqual(data.edits.map((e) => e.id), [mine.editId]);
    assert.equal(data.counts.waiting, 1);
    assert.equal(data.edits[0].lengthS, 123);
    assert.equal(data.edits[0].savedS, 26);
    assert.equal(data.edits[0].watchUrl, `https://drive.google.com/file/d/rc-${mine.editId}/view`);
    assert.ok(!JSON.stringify(data).includes(theirs.editId));
  } finally {
    ctx.restore();
  }
});

test('each verdict writes that status to the stored row', async () => {
  for (const status of ['approved', 'skipped']) {
    const ctx = withRoute();
    try {
      const { editId } = await waitingEdit(ctx, SCOPE_A);
      const { res, json } = await call(ctx.route, `/api/studio/rough-cuts/${editId}/review`, SCOPE_A, 'POST', { status });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(json().data.status, status);
      assert.equal((await storedStatus(ctx, editId, SCOPE_A)).status, status);
      const list = (await call(ctx.route, '/api/studio/rough-cuts', SCOPE_A)).json().data;
      assert.equal(list.counts.waiting, 0);
      assert.equal(list.counts[status], 1);
    } finally {
      ctx.restore();
    }
  }
});

test('send back stores the note with it, and without a note is refused with nothing written', async () => {
  const ctx = withRoute();
  try {
    const { editId } = await waitingEdit(ctx, SCOPE_A);
    const bare = await call(ctx.route, `/api/studio/rough-cuts/${editId}/review`, SCOPE_A, 'POST', { status: 'sent_back', daneNote: '  ' });
    assert.equal(bare.res.statusCode, 400, bare.res.body);
    assert.equal((await storedStatus(ctx, editId, SCOPE_A)).status, 'review');

    const sent = await call(ctx.route, `/api/studio/rough-cuts/${editId}/review`, SCOPE_A, 'POST', { status: 'sent_back', daneNote: 'cut the weather' });
    assert.equal(sent.res.statusCode, 200, sent.res.body);
    const row = await storedStatus(ctx, editId, SCOPE_A);
    assert.equal(row.status, 'sent_back');
    assert.equal(row.daneNote, 'cut the weather');
  } finally {
    ctx.restore();
  }
});

test('a verdict out of order, on another project\'s edit, or touching another field is refused', async () => {
  const ctx = withRoute();
  try {
    const { editId } = await waitingEdit(ctx, SCOPE_A);
    const theirs = await waitingEdit(ctx, SCOPE_B);

    const cross = await call(ctx.route, `/api/studio/rough-cuts/${theirs.editId}/review`, SCOPE_A, 'POST', { status: 'approved' });
    assert.equal(cross.res.statusCode, 404, cross.res.body);
    assert.equal((await storedStatus(ctx, theirs.editId, SCOPE_B)).status, 'review');

    const extra = await call(ctx.route, `/api/studio/rough-cuts/${editId}/review`, SCOPE_A, 'POST', { status: 'approved', youtubeTitle: 'x' });
    assert.equal(extra.res.statusCode, 400, extra.res.body);
    const machine = await call(ctx.route, `/api/studio/rough-cuts/${editId}/review`, SCOPE_A, 'POST', { status: 'finished' });
    assert.equal(machine.res.statusCode, 400, machine.res.body);
    assert.equal((await storedStatus(ctx, editId, SCOPE_A)).status, 'review');

    await call(ctx.route, `/api/studio/rough-cuts/${editId}/review`, SCOPE_A, 'POST', { status: 'skipped' });
    const twice = await call(ctx.route, `/api/studio/rough-cuts/${editId}/review`, SCOPE_A, 'POST', { status: 'approved' });
    assert.equal(twice.res.statusCode, 409, twice.res.body);
    assert.equal((await storedStatus(ctx, editId, SCOPE_A)).status, 'skipped');
  } finally {
    ctx.restore();
  }
});

test('a failed read is an error, never "no rough cuts yet"', async () => {
  const ctx = withRoute();
  try {
    ctx.db.refuse = (req) => (req.table === 'video_edits'
      ? Promise.resolve({ ok: false, status: 503, error: 'the database is resting' })
      : null);
    const { res } = await call(ctx.route, '/api/studio/rough-cuts', SCOPE_A);
    assert.equal(res.statusCode, 503);
    assert.match(String(res.body), /Could not read the rough cuts: the database is resting/);
  } finally {
    ctx.restore();
  }
});

test('a waiting rough cut is shown even when the project has more edits than one read takes', async () => {
  const ctx = withRoute();
  try {
    const { editId } = await waitingEdit(ctx, SCOPE_A);
    const rows = ctx.db.data.get('video_edits');
    const waitingRow = rows.find((r) => r.id === editId);
    const { EDIT_READ_LIMIT } = require('../../routes/studioRoughCuts.js');
    // More answered edits than the read limit, all updated BEFORE the waiting
    // one, so a single oldest-first read of every status stops before it.
    for (let i = 0; i < EDIT_READ_LIMIT + 5; i += 1) {
      rows.push({
        ...waitingRow,
        id: `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        kind: 'short',
        moment_index: i,
        status: 'skipped',
        updated_at: new Date(Date.UTC(2020, 0, 1) + i * 1000).toISOString(),
      });
    }
    const { res, json } = await call(ctx.route, '/api/studio/rough-cuts', SCOPE_A);
    assert.equal(res.statusCode, 200, res.body);
    const data = json().data;
    assert.equal(data.counts.waiting, 1, 'the cut waiting on Dane must never be the one cut off');
    assert.ok(data.edits.some((e) => e.id === editId && e.group === 'waiting'));
    assert.equal(data.truncated, true, 'the answered counts are a minimum, and the answer says so');
    assert.equal(data.waitingTruncated, false);
  } finally {
    ctx.restore();
  }
});

test('each rough cut names its music in words, and says when none was picked', async () => {
  const ctx = withRoute();
  try {
    const picked = await waitingEdit(ctx, SCOPE_A);
    const none = await waitingEdit(ctx, SCOPE_A);
    const row = ctx.db.data.get('video_edits').find((r) => r.id === picked.editId);
    row.music_track = 'inspired';
    const data = (await call(ctx.route, '/api/studio/rough-cuts', SCOPE_A)).json().data;
    const byId = Object.fromEntries(data.edits.map((e) => [e.id, e]));
    assert.deepEqual(byId[picked.editId].music, { trackId: 'inspired', label: 'Inspired, Kevin MacLeod' });
    assert.deepEqual(byId[none.editId].music, { trackId: '', label: 'No music picked' });
  } finally {
    ctx.restore();
  }
});

test('a note that is not text is refused, never saved as "[object Object]"', async () => {
  const ctx = withRoute();
  try {
    const { editId } = await waitingEdit(ctx, SCOPE_A);
    for (const daneNote of [{}, ['cut it'], 42]) {
      const { res } = await call(ctx.route, `/api/studio/rough-cuts/${editId}/review`, SCOPE_A, 'POST', { status: 'sent_back', daneNote });
      assert.equal(res.statusCode, 400, `${JSON.stringify(daneNote)}: ${res.body}`);
    }
    const row = await storedStatus(ctx, editId, SCOPE_A);
    assert.equal(row.status, 'review');
    assert.equal(row.daneNote, '');
  } finally {
    ctx.restore();
  }
});

test('a rough cut id that is not a valid address is a 400, not a crash', async () => {
  const ctx = withRoute();
  try {
    const { res } = await call(ctx.route, '/api/studio/rough-cuts/%E0%A4%A/review', SCOPE_A, 'POST', { status: 'approved' });
    assert.equal(res.statusCode, 400, res.body);
    assert.match(String(res.body), /not a valid address/);
  } finally {
    ctx.restore();
  }
});
