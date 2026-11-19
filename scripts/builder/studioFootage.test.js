'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

/**
 * Studio Phase 1 · 8 of 8 (86bbjv68z) — the Footage screen's server half.
 *
 * Two layers. lib/studioFootage.js is pure, so its grouping, ordering and
 * filter rules are tested directly. routes/studio.js is then driven end to end
 * against the SQL-backed fake database the catalog tests use, so the tenant
 * boundary is tested through the real stores rather than asserted about them.
 */

const fs = require('fs');
const {
  buildFootage, readFilters, effectiveDate, transcriptStateFor, cutMarksStateFor, cutsViewFor, momentsViewFor,
  buildSearchResults, clockOf, SEARCH_MOMENTS_PER_FILE,
  NO_SESSION_TITLE, UNREAD_SESSION_TITLE, UNKNOWN_LANE,
} = require('../../lib/studioFootage');

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SQL_TEXT = ['video_studio_setup.sql', 'video_transcripts_setup.sql', 'video_cut_marks_setup.sql', 'video_reel_spinner_setup.sql']
  .map((file) => fs.readFileSync(path.join(SQL_DIR, file), 'utf8'))
  .join('\n');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const sessionsStorePath = require.resolve('../../lib/videoSessionsStore.js');
const sourcesStorePath = require.resolve('../../lib/videoSourcesStore.js');
const transcriptsStorePath = require.resolve('../../lib/videoTranscriptsStore.js');
const cutMarksStorePath = require.resolve('../../lib/videoCutMarksStore.js');
const googleDrivePath = require.resolve('../../lib/googleDrive.js');
const momentsStorePath = require.resolve('../../lib/videoMomentsStore.js');
const contextForPath = require.resolve('../../lib/contextFor.js');
const momentsRoutePath = require.resolve('../../routes/studioMoments.js');
const pairsStorePath = require.resolve('../../lib/videoAudioPairsStore.js');
const pairsRoutePath = require.resolve('../../routes/studioPairs.js');
const routePath = require.resolve('../../routes/studio.js');

// ── the pure view ───────────────────────────────────────────────────────────

const S1 = { id: 's1', title: 'Monday shoot', recordedAt: '2026-09-01T15:00:00Z', state: 'new' };
const S2 = { id: 's2', title: 'Friday talk', recordedAt: '2026-09-05T15:00:00Z', state: 'new' };

function src(id, extra = {}) {
  return { id, sessionId: 's1', layerRole: 'subject', state: 'probed', createdAt: '2026-09-10T00:00:00Z', ...extra };
}

test('sessions come newest first; files inside a session in recording order', () => {
  const view = buildFootage({
    sessions: [S1, S2],
    sources: [
      src('late', { recordedAt: '2026-09-01T15:30:00Z' }),
      src('early', { recordedAt: '2026-09-01T15:05:00Z' }),
      src('fri', { sessionId: 's2', recordedAt: '2026-09-05T15:01:00Z' }),
    ],
  });
  assert.deepEqual(view.sessions.map((s) => s.id), ['s2', 's1']);
  assert.deepEqual(view.sessions[1].sources.map((s) => s.id), ['early', 'late']);
  assert.equal(view.totalSources, 3);
  assert.equal(view.shownSources, 3);
});

test('a file with no session, or whose session was not read, is still shown — last, and named apart', () => {
  const view = buildFootage({
    sessions: [S1],
    sources: [src('a'), src('orphan', { sessionId: '' }), src('lost', { sessionId: 'missing' })],
  });
  assert.equal(view.shownSources, 3);
  assert.deepEqual(view.sessions.map((s) => s.id).slice(0, 1), ['s1']);
  const unread = view.sessions[view.sessions.length - 2];
  const none = view.sessions[view.sessions.length - 1];
  // A session id that matches nothing read is a session PAST THE READ (the
  // foreign key cascades on delete), never a file with no session — saying
  // "Not in a session yet" for it was a false claim (review round 1).
  assert.equal(unread.title, UNREAD_SESSION_TITLE);
  assert.deepEqual(unread.sources.map((s) => s.id), ['lost']);
  assert.equal(none.title, NO_SESSION_TITLE);
  assert.deepEqual(none.sources.map((s) => s.id), ['orphan']);
});

test('the date a file is filed under says which clock it came from', () => {
  assert.equal(effectiveDate({ recordedAt: '2026-09-01T00:00:00Z' }, S2).dateSource, 'recorded');
  assert.equal(effectiveDate({ createdAt: '2026-09-10T00:00:00Z' }, S2).dateSource, 'session');
  assert.equal(effectiveDate({ createdAt: '2026-09-10T00:00:00Z' }, null).dateSource, 'added');
  assert.equal(effectiveDate({}, null).dateSource, 'none');
});

test('lane filter keeps only that lane; a file with no lane is the "unknown" lane', () => {
  const sources = [src('a', { deviceLane: 'iPhone' }), src('b', { deviceLane: 'ipad' }), src('c')];
  const view = buildFootage({ sessions: [S1], sources, filters: { lane: 'iphone' } });
  assert.deepEqual(view.sessions.flatMap((s) => s.sources.map((f) => f.id)), ['a']);
  // The lane list is read from EVERY file, not the filtered ones, so picking a
  // lane never makes the other lanes vanish from the dropdown.
  assert.deepEqual(view.lanes.map((l) => l.lane), ['ipad', 'iphone', UNKNOWN_LANE]);
  const unknown = buildFootage({ sessions: [S1], sources, filters: { lane: UNKNOWN_LANE } });
  assert.deepEqual(unknown.sessions.flatMap((s) => s.sources.map((f) => f.id)), ['c']);
});

test('date range is inclusive, and an undated file is left out but counted', () => {
  const sources = [
    src('in', { recordedAt: '2026-09-03T12:00:00Z' }),
    src('edge', { recordedAt: '2026-09-04T00:00:00Z' }),
    src('out', { recordedAt: '2026-09-09T12:00:00Z' }),
    { id: 'undated', sessionId: '', state: 'new' },
  ];
  const view = buildFootage({
    sessions: [],
    sources,
    filters: { fromMs: Date.parse('2026-09-03T00:00:00Z'), toMs: Date.parse('2026-09-04T00:00:00Z') },
  });
  assert.deepEqual(view.sessions.flatMap((s) => s.sources.map((f) => f.id)).sort(), ['edge', 'in']);
  assert.equal(view.undated, 1);
  assert.equal(view.totalSources, 4);
});

test('a session with nothing left after filtering is dropped, not shown empty', () => {
  const view = buildFootage({
    sessions: [S1, S2],
    sources: [src('a', { deviceLane: 'iphone' }), src('b', { sessionId: 's2', deviceLane: 'ipad' })],
    filters: { lane: 'ipad' },
  });
  assert.deepEqual(view.sessions.map((s) => s.id), ['s2']);
});

test('readFilters refuses a date it cannot read, rather than dropping the filter', () => {
  assert.equal(readFilters({ from: 'yesterday-ish' }).ok, false);
  assert.equal(readFilters({ from: '2026-09-05T00:00:00Z', to: '2026-09-01T00:00:00Z' }).ok, false);
  const ok = readFilters({ lane: ' iPhone ', from: '2026-09-01T00:00:00Z' });
  assert.equal(ok.ok, true);
  assert.equal(ok.filters.lane, 'iphone');
  assert.equal(ok.filters.toMs, null);
});

test('hasDriveFile tells the screen whether a preview is even possible', () => {
  const view = buildFootage({ sessions: [S1], sources: [src('a', { driveFileId: 'drv1' }), src('b')] });
  const byId = Object.fromEntries(view.sessions[0].sources.map((s) => [s.id, s]));
  assert.equal(byId.a.hasDriveFile, true);
  assert.equal(byId.b.hasDriveFile, false);
});

test('driveUrl opens the original in Drive\'s player; no Drive file is null, never a dead link (86bcdejzy)', () => {
  const view = buildFootage({
    sessions: [S1],
    sources: [src('a', { driveFileId: '1AbC-d_9' }), src('b'), src('c', { driveFileId: '   ' })],
  });
  const byId = Object.fromEntries(view.sessions[0].sources.map((s) => [s.id, s]));
  assert.equal(byId.a.driveUrl, 'https://drive.google.com/file/d/1AbC-d_9/view');
  assert.equal(byId.b.driveUrl, null);
  assert.equal(byId.c.driveUrl, null);
});

test('fileName is the Drive name ingest saved the download under; ingest\'s id fallback is not a name', () => {
  const view = buildFootage({
    sessions: [S1],
    sources: [
      src('named', { driveFileId: 'drv1', localPath: '/srv/studio-cache/iphone/drv1/IMG_1962.MOV' }),
      src('unnamed', { driveFileId: 'drv2', localPath: '/srv/studio-cache/inbox/drv2/drv2.media' }),
      src('notyet', { driveFileId: 'drv3' }),
    ],
  });
  const byId = Object.fromEntries(view.sessions[0].sources.map((s) => [s.id, s]));
  assert.equal(byId.named.fileName, 'IMG_1962.MOV');
  assert.equal(byId.unnamed.fileName, '');
  assert.equal(byId.notyet.fileName, '');
});

test('transcript state: the row\'s verdict, else plates are never transcribed, else not yet — never "working" (86bcdek0e)', () => {
  const states = {
    done: { state: 'done', reason: '' },
    bad: { state: 'failed', reason: 'whisper-cli exited 1' },
    quiet: { state: 'no_audio', reason: '' },
    plated: { state: 'done', reason: '' },
  };
  assert.deepEqual(transcriptStateFor({ id: 'DONE' }, states), { state: 'done', reason: '' },
    'ids are matched lower-cased, the way listTranscriptStates keys them');
  assert.deepEqual(transcriptStateFor({ id: 'bad' }, states), { state: 'failed', reason: 'whisper-cli exited 1' });
  assert.equal(transcriptStateFor({ id: 'quiet' }, states).state, 'no_audio');
  assert.equal(transcriptStateFor({ id: 'p', layerRole: 'plate' }, states).state, 'plate');
  assert.equal(transcriptStateFor({ id: 'plated', layerRole: 'plate' }, states).state, 'done',
    'a plate that WAS transcribed says so — the row is the truth');
  // The job queue is a file on the Mac Mini, so no row means "not yet", not "working".
  assert.equal(transcriptStateFor({ id: 'new', layerRole: 'subject' }, states).state, 'not_yet');
  // Could not read the states at all is its own answer, never "not yet".
  assert.equal(transcriptStateFor({ id: 'done' }, null).state, 'unknown');

  const view = buildFootage({ sessions: [S1], sources: [src('done'), src('x')], transcripts: states });
  const byId = Object.fromEntries(view.sessions[0].sources.map((f) => [f.id, f.transcript.state]));
  assert.deepEqual(byId, { done: 'done', x: 'not_yet' });
});

// ── the route, against the fake database ────────────────────────────────────

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

const ROUTE_MODULES = [
  projectScopePath, sessionsStorePath, sourcesStorePath, transcriptsStorePath, cutMarksStorePath,
  momentsStorePath, momentsRoutePath, pairsStorePath, pairsRoutePath, routePath,
];

/** What readContextFor answers in these tests: one note, fingerprint 'fp-now'. */
const NOTES_NOW = {
  ok: true,
  status: 200,
  data: { text: '## Channel\n\nGood tennis.', fingerprint: 'fp-now', entries: [{ id: 'n1' }], unreadable: [], reason: '' },
};

function withRoute({ drive, failTranscripts = false, failCutMarks = false, notes = NOTES_NOW } = {}) {
  const db = createFakeDb(parseSchemaText(SQL_TEXT));
  const missing = new Set([
    ...(failTranscripts ? ['video_transcripts'] : []),
    ...(failCutMarks ? ['video_cut_marks'] : []),
  ]);
  const sbQuery = (args) => (missing.has(args.table)
    ? Promise.resolve({ ok: false, status: 404, error: `relation "${args.table}" does not exist` })
    : db.sbQuery(args));
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
    }),
    sbQuery,
  });
  if (drive) swap(googleDrivePath, drive);
  const notesAsked = [];
  swap(contextForPath, {
    readContextFor: async (args) => { notesAsked.push(args); return typeof notes === 'function' ? notes(args) : notes; },
  });
  for (const p of ROUTE_MODULES) delete require.cache[p];
  const route = require(routePath);
  const sessions = require(sessionsStorePath);
  const sources = require(sourcesStorePath);
  const transcripts = require(transcriptsStorePath);
  const cutMarks = require(cutMarksStorePath);
  const moments = require(momentsStorePath);
  const pairs = require(pairsStorePath);
  const restore = () => {
    for (const [p, entry] of Object.entries(saved)) {
      if (entry) require.cache[p] = entry; else delete require.cache[p];
    }
    for (const p of ROUTE_MODULES) delete require.cache[p];
  };
  return { route, sessions, sources, transcripts, cutMarks, moments, pairs, notesAsked, db, restore };
}

function call(route, url, scope, method = 'GET', body = undefined) {
  const req = {
    url,
    method,
    body,
    headers: { host: 'localhost' },
    projectContext: { project: { id: scope.projectId, name: scope.name || '' } },
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
  return route.handle(req, res, pathname, method).then((handled) => ({ handled, res }));
}

/** A source needs a session to belong to; make one and read the id back. */
async function sourceIn(stores, scope, input = {}) {
  const session = await stores.sessions.createSession({ title: 'Holding' }, scope);
  assert.equal(session.ok, true, session.error);
  const made = await stores.sources.createSource({ sessionId: session.data.id, ...input }, scope);
  assert.equal(made.ok, true, made.error);
  return made.data;
}

function json(res) {
  return JSON.parse(String(res.body));
}

test('GET /api/studio/footage lists this project only, grouped by session', async () => {
  const { route, sessions, sources, restore } = withRoute();
  try {
    const a = await sessions.createSession({ title: 'A shoot', recordedAt: '2026-09-01T10:00:00Z' }, SCOPE_A);
    assert.equal(a.ok, true, a.error);
    const b = await sessions.createSession({ title: 'B shoot' }, SCOPE_B);
    assert.equal(b.ok, true, b.error);
    for (const [scope, sessionId, lane] of [[SCOPE_A, a.data.id, 'iphone'], [SCOPE_A, a.data.id, 'ipad'], [SCOPE_B, b.data.id, 'iphone']]) {
      const made = await sources.createSource({ sessionId, deviceLane: lane }, scope);
      assert.equal(made.ok, true, made.error);
    }

    const { handled, res } = await call(route, '/api/studio/footage', SCOPE_A);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = json(res);
    assert.equal(body.ok, true);
    assert.equal(body.data.totalSources, 2, 'project B\'s file must not appear under project A');
    assert.deepEqual(body.data.sessions.map((s) => s.title), ['A shoot']);
    assert.equal(body.data.truncated, false);

    const filtered = json((await call(route, '/api/studio/footage?lane=ipad', SCOPE_A)).res);
    assert.equal(filtered.data.shownSources, 1);
    assert.equal(filtered.data.sessions[0].sources[0].lane, 'ipad');
  } finally {
    restore();
  }
});

test('GET /api/studio/footage carries each file\'s name and Drive link through the real store (86bcdejzy)', async () => {
  const stores = withRoute();
  const { route, restore } = stores;
  try {
    await sourceIn(stores, SCOPE_A, {
      driveFileId: 'drv-play',
      localPath: '/srv/studio-cache/iphone/drv-play/IMG_1962.MOV',
    });
    const body = json((await call(route, '/api/studio/footage', SCOPE_A)).res);
    const file = body.data.sessions[0].sources[0];
    assert.equal(file.fileName, 'IMG_1962.MOV');
    assert.equal(file.driveUrl, 'https://drive.google.com/file/d/drv-play/view');
  } finally {
    restore();
  }
});

test('GET /api/studio/footage answers 400 for an unreadable date', async () => {
  const { route, restore } = withRoute();
  try {
    const { res } = await call(route, '/api/studio/footage?from=not-a-date', SCOPE_A);
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).ok, false);
  } finally {
    restore();
  }
});

test('thumbnail: a file with no Drive id is a 404 the screen turns into a placeholder', async () => {
  const stores = withRoute();
  const { route, restore } = stores;
  try {
    const made = { data: await sourceIn(stores, SCOPE_A) };
    const { res } = await call(route, `/api/studio/sources/${made.data.id}/thumbnail`, SCOPE_A);
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error.code, 'NO_THUMBNAIL');
  } finally {
    restore();
  }
});

test('thumbnail: another project\'s file is not found, and Drive is never asked', async () => {
  let asked = 0;
  const drive = { getAccessToken: async () => { asked += 1; return { ok: true, data: { accessToken: 't' } }; } };
  const stores = withRoute({ drive });
  const { route, restore } = stores;
  try {
    const made = { data: await sourceIn(stores, SCOPE_B, { driveFileId: 'drv-b' }) };
    const { res } = await call(route, `/api/studio/sources/${made.data.id}/thumbnail`, SCOPE_A);
    assert.equal(res.statusCode, 404);
    assert.equal(asked, 0);
  } finally {
    restore();
  }
});

test('thumbnail: Drive\'s preview is passed through as an image; no preview yet is a 404', async () => {
  const drive = { getAccessToken: async () => ({ ok: true, data: { accessToken: 'tok' } }) };
  const stores = withRoute({ drive });
  const { route, restore } = stores;
  const realFetch = global.fetch;
  const seen = [];
  let hasThumbnail = true;
  global.fetch = async (url, opts) => {
    seen.push({ url: String(url), auth: opts?.headers?.Authorization });
    if (String(url).startsWith('https://www.googleapis.com/drive/v3/files/')) {
      return new Response(JSON.stringify(hasThumbnail
        ? { hasThumbnail: true, thumbnailLink: 'https://lh3.example/thumb=s220' }
        : { hasThumbnail: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const made = { data: await sourceIn(stores, SCOPE_A, { driveFileId: 'drv-a' }) };
    const url = `/api/studio/sources/${made.data.id}/thumbnail`;
    const { res } = await call(route, url, SCOPE_A);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.match(String(res.headers['cache-control']), /max-age=\d+/);
    assert.equal(Buffer.from(res.body).length, 3);
    assert.ok(seen.every((s) => s.auth === 'Bearer tok'), 'every Drive call carries the server\'s token');
    assert.ok(seen[0].url.includes('/files/drv-a?'));

    hasThumbnail = false;
    const none = (await call(route, url, SCOPE_A)).res;
    assert.equal(none.statusCode, 404);
    assert.equal(json(none).error.code, 'NO_THUMBNAIL');
  } finally {
    global.fetch = realFetch;
    restore();
  }
});

test('thumbnail: previews arriving together share ONE token refresh', async () => {
  let minted = 0;
  const drive = { getAccessToken: async () => {
    minted += 1;
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true, data: { accessToken: `tok-${minted}` } };
  } };
  const stores = withRoute({ drive });
  const { route, restore } = stores;
  const realFetch = global.fetch;
  global.fetch = async (url) => (String(url).includes('/drive/v3/files/')
    ? new Response(JSON.stringify({ hasThumbnail: true, thumbnailLink: 'https://lh3.example/t' }), { status: 200 })
    : new Response(Buffer.from([1]), { status: 200, headers: { 'content-type': 'image/png' } }));
  try {
    const ids = [];
    for (let i = 0; i < 4; i += 1) ids.push((await sourceIn(stores, SCOPE_A, { driveFileId: `drv-${i}` })).id);
    const results = await Promise.all(ids.map((id) => call(route, `/api/studio/sources/${id}/thumbnail`, SCOPE_A)));
    assert.deepEqual(results.map((r) => r.res.statusCode), [200, 200, 200, 200]);
    assert.equal(minted, 1, 'four previews at once must not mint four tokens');
  } finally {
    global.fetch = realFetch;
    restore();
  }
});

test('thumbnail: an expired token is replaced and the SAME request succeeds', async () => {
  let minted = 0;
  const drive = { getAccessToken: async () => { minted += 1; return { ok: true, data: { accessToken: `tok-${minted}` } }; } };
  const stores = withRoute({ drive });
  const { route, restore } = stores;
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const auth = opts?.headers?.Authorization;
    if (auth === 'Bearer tok-1') return new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 });
    if (String(url).includes('/drive/v3/files/')) {
      return new Response(JSON.stringify({ hasThumbnail: true, thumbnailLink: 'https://lh3.example/t' }), { status: 200 });
    }
    return new Response(Buffer.from([1]), { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    const made = await sourceIn(stores, SCOPE_A, { driveFileId: 'drv-x' });
    const { res } = await call(route, `/api/studio/sources/${made.id}/thumbnail`, SCOPE_A);
    assert.equal(res.statusCode, 200, 'the request that discovers the expiry must not be the one that fails');
    assert.equal(minted, 2);
  } finally {
    global.fetch = realFetch;
    restore();
  }
});

// ── transcripts (86bcdek0e) ─────────────────────────────────────────────────

const SEGMENTS = [
  { start: 0, end: 4.2, text: 'Hello and welcome.' },
  { start: 4.2, end: 9, text: 'Today we talk about pricing.' },
];

test('transcript: the right project gets the transcript; words only when asked for', async () => {
  const stores = withRoute();
  const { route, transcripts, restore } = stores;
  try {
    const made = await sourceIn(stores, SCOPE_A);
    const saved = await transcripts.upsertTranscript(made.id, {
      state: 'done',
      language: 'en',
      text: 'Hello and welcome. Today we talk about pricing.',
      segments: SEGMENTS,
      words: [{ start: 0, end: 0.4, word: 'Hello', p: 0.9 }],
    }, SCOPE_A);
    assert.equal(saved.ok, true, saved.error);

    const { handled, res } = await call(route, `/api/studio/sources/${made.id}/transcript`, SCOPE_A);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = json(res).data;
    assert.equal(body.state, 'done');
    assert.equal(body.language, 'en');
    assert.deepEqual(body.segments, SEGMENTS);
    assert.equal(body.words, undefined, 'words are left out unless ?words=1');

    const withWords = json((await call(route, `/api/studio/sources/${made.id}/transcript?words=1`, SCOPE_A)).res);
    assert.equal(withWords.data.words.length, 1);
  } finally {
    restore();
  }
});

test('transcript: another project\'s source is a 404, never its transcript', async () => {
  const stores = withRoute();
  const { route, transcripts, restore } = stores;
  try {
    const theirs = await sourceIn(stores, SCOPE_B);
    const saved = await transcripts.upsertTranscript(theirs.id, {
      state: 'done', text: 'Project B secrets', segments: [{ start: 0, end: 1, text: 'Project B secrets' }],
    }, SCOPE_B);
    assert.equal(saved.ok, true, saved.error);

    const { res } = await call(route, `/api/studio/sources/${theirs.id}/transcript`, SCOPE_A);
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error.code, 'NOT_FOUND');
    assert.doesNotMatch(String(res.body), /Project B secrets/);
  } finally {
    restore();
  }
});

test('transcript: our own source with no transcript yet is a 404 coded NO_TRANSCRIPT', async () => {
  const stores = withRoute();
  const { route, restore } = stores;
  try {
    const made = await sourceIn(stores, SCOPE_A);
    const { res } = await call(route, `/api/studio/sources/${made.id}/transcript`, SCOPE_A);
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error.code, 'NO_TRANSCRIPT');
  } finally {
    restore();
  }
});

test('GET /api/studio/footage carries each file\'s transcript state, this project\'s only', async () => {
  const stores = withRoute();
  const { route, transcripts, restore } = stores;
  try {
    const done = await sourceIn(stores, SCOPE_A, { driveFileId: 'd1' });
    const failed = await sourceIn(stores, SCOPE_A, { driveFileId: 'd2' });
    const plate = await sourceIn(stores, SCOPE_A, { driveFileId: 'd3', layerRole: 'plate' });
    const fresh = await sourceIn(stores, SCOPE_A, { driveFileId: 'd4' });
    for (const [id, data] of [
      [done.id, { state: 'done', segments: SEGMENTS }],
      [failed.id, { state: 'failed', reason: 'the audio track could not be decoded' }],
    ]) {
      const saved = await transcripts.upsertTranscript(id, data, SCOPE_A);
      assert.equal(saved.ok, true, saved.error);
    }
    const body = json((await call(route, '/api/studio/footage', SCOPE_A)).res);
    assert.equal(body.data.transcriptsError, '');
    const byId = Object.fromEntries(body.data.sessions.flatMap((s) => s.sources).map((f) => [f.id, f.transcript]));
    assert.deepEqual(byId[done.id], { state: 'done', reason: '' });
    assert.deepEqual(byId[failed.id], { state: 'failed', reason: 'the audio track could not be decoded' });
    assert.equal(byId[plate.id].state, 'plate');
    assert.equal(byId[fresh.id].state, 'not_yet');
  } finally {
    restore();
  }
});

test('GET /api/studio/footage still lists the files when the transcript states cannot be read', async () => {
  const stores = withRoute({ failTranscripts: true });
  const { route, restore } = stores;
  try {
    const made = await sourceIn(stores, SCOPE_A);
    const { res } = await call(route, '/api/studio/footage', SCOPE_A);
    assert.equal(res.statusCode, 200);
    const body = json(res).data;
    assert.match(body.transcriptsError, /video_transcripts/);
    assert.equal(body.sessions[0].sources[0].id, made.id);
    assert.equal(body.sessions[0].sources[0].transcript.state, 'unknown',
      'a failed read is "could not tell", never "not transcribed yet"');
  } finally {
    restore();
  }
});

// ── the words Reel Spinner would cut (Reel Spinner 1d, 86bcwaw8e) ───────────

test('cut-marks state: the row\'s verdict, else not checked yet; an unread map is "could not tell"', () => {
  const states = {
    done1: { state: 'done', reason: '', cutS: 190.5 },
    fail1: { state: 'failed', reason: 'the model timed out' },
  };
  assert.deepEqual(cutMarksStateFor({ id: 'DONE1' }, states), { state: 'done', reason: '', cutS: 190.5 });
  assert.deepEqual(cutMarksStateFor({ id: 'fail1' }, states), { state: 'failed', reason: 'the model timed out', cutS: null });
  assert.equal(cutMarksStateFor({ id: 'other' }, states).state, 'not_yet');
  assert.equal(cutMarksStateFor({ id: 'done1' }, null).state, 'unknown',
    'a map that could not be read is never "not checked yet"');
});

test('cutsViewFor: no row is not_yet with nothing in it; a row keeps its words and marks', () => {
  assert.deepEqual(cutsViewFor('src1', null), {
    sourceId: 'src1', state: 'not_yet', reason: '', durationS: null,
    verbatimWords: [], marks: [], cutS: 0, updatedAt: '',
  });
  const view = cutsViewFor('src1', {
    sourceId: 'src1', state: 'done', reason: '', durationS: 60, cutS: 0.3,
    verbatimWords: [{ start: 0, end: 0.3, word: 'uh', p: null }],
    marks: [{ start: 0, end: 0.3, kind: 'filler', keep_s: 0, words: 'uh', why: '' }],
    updatedAt: '2026-11-01T00:00:00Z', verbatimText: 'uh', model: 'x', projectId: 'proj_a',
  });
  assert.equal(view.state, 'done');
  assert.equal(view.marks.length, 1);
  assert.equal(view.verbatimWords[0].word, 'uh');
  assert.equal(view.projectId, undefined, 'only what the screen shows is sent');
});

const CUT_WORDS = [
  { start: 0, end: 0.3, word: 'So' },
  { start: 0.4, end: 0.6, word: 'uh' },
  { start: 0.7, end: 1, word: 'right' },
];
const CUT_MARKS = [{ start: 0.35, end: 0.65, kind: 'filler', keep_s: 0, words: 'uh', why: 'filler word' }];

test('cuts: the right project gets its marks and the word-for-word transcript', async () => {
  const stores = withRoute();
  const { route, cutMarks, restore } = stores;
  try {
    const made = await sourceIn(stores, SCOPE_A);
    const saved = await cutMarks.upsertCutMarks(made.id, {
      state: 'done', durationS: 61, verbatimText: 'So uh right', verbatimWords: CUT_WORDS, marks: CUT_MARKS,
    }, SCOPE_A);
    assert.equal(saved.ok, true, saved.error);

    const { handled, res } = await call(route, `/api/studio/sources/${made.id}/cuts`, SCOPE_A);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = json(res).data;
    assert.equal(body.state, 'done');
    assert.equal(body.durationS, 61);
    assert.equal(body.cutS, 0.3);
    assert.deepEqual(body.verbatimWords.map((w) => w.word), ['So', 'uh', 'right']);
    assert.deepEqual(body.marks.map((m) => m.kind), ['filler']);
  } finally {
    restore();
  }
});

test('cuts: our own file not checked yet is a 200 saying not_yet, never a 404', async () => {
  const stores = withRoute();
  const { route, restore } = stores;
  try {
    const made = await sourceIn(stores, SCOPE_A);
    const { res } = await call(route, `/api/studio/sources/${made.id}/cuts`, SCOPE_A);
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).data.state, 'not_yet');
  } finally {
    restore();
  }
});

test('cuts: another project\'s file is a 404, never its marks', async () => {
  const stores = withRoute();
  const { route, cutMarks, restore } = stores;
  try {
    const theirs = await sourceIn(stores, SCOPE_B);
    const saved = await cutMarks.upsertCutMarks(theirs.id, {
      state: 'done', verbatimText: 'Project B secrets', verbatimWords: [{ start: 0, end: 1, word: 'Project B secrets' }],
      marks: [],
    }, SCOPE_B);
    assert.equal(saved.ok, true, saved.error);
    const { res } = await call(route, `/api/studio/sources/${theirs.id}/cuts`, SCOPE_A);
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error.code, 'NOT_FOUND');
    assert.doesNotMatch(String(res.body), /Project B secrets/);
  } finally {
    restore();
  }
});

test('cuts: a database that cannot read the marks says so, never "not checked yet"', async () => {
  const stores = withRoute({ failCutMarks: true });
  const { route, restore } = stores;
  try {
    const made = await sourceIn(stores, SCOPE_A);
    const { res } = await call(route, `/api/studio/sources/${made.id}/cuts`, SCOPE_A);
    assert.notEqual(res.statusCode, 200);
    assert.match(json(res).error.message, /Could not read the cut marks: .*video_cut_marks/);
  } finally {
    restore();
  }
});

test('GET /api/studio/footage carries each file\'s cut-marks state, this project\'s only', async () => {
  const stores = withRoute();
  const { route, cutMarks, restore } = stores;
  try {
    const done = await sourceIn(stores, SCOPE_A, { driveFileId: 'c1' });
    const failed = await sourceIn(stores, SCOPE_A, { driveFileId: 'c2' });
    const fresh = await sourceIn(stores, SCOPE_A, { driveFileId: 'c3' });
    for (const [id, data] of [
      [done.id, { state: 'done', verbatimWords: CUT_WORDS, marks: CUT_MARKS }],
      [failed.id, { state: 'failed', reason: 'the model timed out' }],
    ]) {
      const saved = await cutMarks.upsertCutMarks(id, data, SCOPE_A);
      assert.equal(saved.ok, true, saved.error);
    }
    const body = json((await call(route, '/api/studio/footage', SCOPE_A)).res);
    assert.equal(body.data.cutMarksError, '');
    const byId = Object.fromEntries(body.data.sessions.flatMap((s) => s.sources).map((f) => [f.id, f.cutMarks]));
    assert.deepEqual(byId[done.id], { state: 'done', reason: '', cutS: 0.3 });
    assert.deepEqual(byId[failed.id], { state: 'failed', reason: 'the model timed out', cutS: null });
    assert.equal(byId[fresh.id].state, 'not_yet');
  } finally {
    restore();
  }
});

test('GET /api/studio/footage still lists the files when the cut-marks table is missing', async () => {
  const stores = withRoute({ failCutMarks: true });
  const { route, restore } = stores;
  try {
    const made = await sourceIn(stores, SCOPE_A);
    const { res } = await call(route, '/api/studio/footage', SCOPE_A);
    assert.equal(res.statusCode, 200, 'a table nobody has created yet must not take the screen down');
    const body = json(res).data;
    assert.match(body.cutMarksError, /video_cut_marks/);
    assert.equal(body.transcriptsError, '');
    assert.equal(body.sessions[0].sources[0].id, made.id);
    assert.equal(body.sessions[0].sources[0].cutMarks.state, 'unknown');
  } finally {
    restore();
  }
});

// ── search what you said (86bcdek0z) ────────────────────────────────────────

test('clockOf is m:ss, h:mm:ss past an hour, floored', () => {
  assert.equal(clockOf(0), '0:00');
  assert.equal(clockOf(59.9), '0:59');
  assert.equal(clockOf(754.2), '12:34');
  assert.equal(clockOf(3725.4), '1:02:05');
  assert.equal(clockOf(NaN), '0:00');
});

test('search results name the file and session, keep the first few moments, and count the rest', () => {
  const matches = Array.from({ length: 8 }, (_, i) => ({ start: 60 * i + 5, end: 60 * i + 9, text: `pricing ${i}` }));
  const view = buildSearchResults({
    hits: [
      { sourceId: 'A1', matches },
      { sourceId: 'gone', matches: [{ start: 1, end: 2, text: 'pricing' }] },
    ],
    sources: [src('a1', { driveFileId: 'drv-1', localPath: '/c/iphone/drv-1/IMG_1962.MOV', recordedAt: '2026-09-01T15:05:00Z' })],
    sessions: [S1],
    transcribedCount: 4,
  });
  const [hit, unread] = view.results;
  assert.equal(hit.fileName, 'IMG_1962.MOV');
  assert.equal(hit.driveUrl, 'https://drive.google.com/file/d/drv-1/view');
  assert.equal(hit.sessionTitle, 'Monday shoot');
  assert.equal(hit.dateSource, 'recorded');
  assert.equal(hit.matchCount, 8);
  assert.equal(hit.moments.length, SEARCH_MOMENTS_PER_FILE);
  assert.deepEqual(hit.moments.slice(0, 2).map((m) => m.time), ['0:05', '1:05']);
  assert.equal(unread.found, false, 'a hit past the read ceiling is kept, and says it was not read');
  assert.equal(unread.moments[0].time, '0:01');
  assert.equal(view.transcribedCount, 4);
  assert.equal(buildSearchResults({ transcribedCount: null }).transcribedCount, null, 'could not count is null, never 0');
});

async function transcribed(stores, scope, segments, extra = {}) {
  const made = await sourceIn(stores, scope, extra);
  const saved = await stores.transcripts.upsertTranscript(made.id, {
    state: 'done',
    language: 'en',
    text: segments.map((s) => s.text).join(' '),
    segments,
  }, scope);
  assert.equal(saved.ok, true, saved.error);
  return made;
}

test('GET /api/studio/search finds the file and the minute a word was said', async () => {
  const stores = withRoute();
  const { route, restore } = stores;
  try {
    const mine = await transcribed(stores, SCOPE_A, [
      { start: 0, end: 4, text: 'Hello and welcome.' },
      { start: 754.2, end: 760, text: 'Now, about the pricing of lessons.' },
    ], { driveFileId: 'drv-1962', localPath: '/c/iphone/drv-1962/IMG_1962.MOV' });
    await transcribed(stores, SCOPE_A, [{ start: 3, end: 5, text: 'Nothing relevant here.' }]);

    const { handled, res } = await call(route, '/api/studio/search?q=Pricing', SCOPE_A);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = json(res).data;
    assert.equal(body.query, 'Pricing');
    assert.equal(body.results.length, 1);
    const [hit] = body.results;
    assert.equal(hit.sourceId, mine.id);
    assert.equal(hit.fileName, 'IMG_1962.MOV');
    assert.equal(hit.driveUrl, 'https://drive.google.com/file/d/drv-1962/view');
    assert.equal(hit.sessionTitle, 'Holding');
    assert.deepEqual(hit.moments, [{ start: 754.2, time: '12:34', text: 'Now, about the pricing of lessons.' }]);
    assert.equal(body.transcribedCount, 2);
    assert.equal(body.countError, '');

    const none = json((await call(route, '/api/studio/search?q=zebra', SCOPE_A)).res).data;
    assert.deepEqual(none.results, []);
    assert.equal(none.transcribedCount, 2, 'no match still says how many recordings were searched');
  } finally {
    restore();
  }
});

test('GET /api/studio/search never searches another project\'s transcripts', async () => {
  const stores = withRoute();
  const { route, restore } = stores;
  try {
    await transcribed(stores, SCOPE_B, [{ start: 1, end: 2, text: 'Our secret pricing.' }]);
    const body = json((await call(route, '/api/studio/search?q=pricing', SCOPE_A)).res).data;
    assert.deepEqual(body.results, []);
    assert.equal(body.transcribedCount, 0, 'project B\'s transcript is not counted under project A either');
  } finally {
    restore();
  }
});

test('GET /api/studio/search refuses an empty, 1-character or wordless query — never every file', async () => {
  const stores = withRoute();
  const { route, restore } = stores;
  try {
    await transcribed(stores, SCOPE_A, [{ start: 1, end: 2, text: 'a b c pricing' }]);
    for (const url of ['/api/studio/search', '/api/studio/search?q=', '/api/studio/search?q=%20%20', '/api/studio/search?q=a']) {
      const { res } = await call(route, url, SCOPE_A);
      assert.equal(res.statusCode, 400, url);
      const body = json(res);
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'QUERY_TOO_SHORT', url);
      assert.match(body.error.message, /at least 2 characters/);
    }
    const one = json((await call(route, '/api/studio/search?q=a', SCOPE_A)).res);
    assert.match(one.error.message, /"a" is too short/, 'the refusal names what was typed');

    const punct = await call(route, '/api/studio/search?q=!!', SCOPE_A);
    assert.equal(punct.res.statusCode, 400);
    assert.equal(json(punct.res).error.code, 'QUERY_HAS_NO_WORDS');
  } finally {
    restore();
  }
});

test('GET /api/studio/search: a database that refuses the search says so — never an empty list', async () => {
  const stores = withRoute({ failTranscripts: true });
  const { route, restore } = stores;
  try {
    const { res } = await call(route, '/api/studio/search?q=pricing', SCOPE_A);
    assert.equal(res.statusCode, 404);
    assert.match(json(res).error.message, /Could not search the transcripts/);
  } finally {
    restore();
  }
});

test('the route ignores paths and methods it does not own', async () => {
  const { route, restore } = withRoute();
  try {
    const { handled } = await call(route, '/api/studio/elsewhere', SCOPE_A);
    assert.equal(handled, false);
  } finally {
    restore();
  }
});

// ── Reel Spinner 2e (SC-830): a recording's scored moments ─────────────────

const NOTES_ROW = (fingerprint) => ({
  sourceId: 'm1', status: 'done', summary: 'A good talk.', briefFingerprint: fingerprint, model: 'x',
  rescoreRequestedAt: '', error: '', updatedAt: '2026-11-17T10:00:00Z',
  moments: [
    { start_s: 10, end_s: 25.5, score: 60, reasons: ['funny'], project: 'Delray', mood: 'light', quote: 'Low' },
    { start_s: 90, end_s: 120, score: 91, reasons: ['clear', ' '], project: 'Delray', mood: '', quote: 'High' },
    { start_s: 5, end_s: 9, score: 60, reasons: [], project: '', mood: '', quote: 'Tie, said first' },
  ],
});

test('moments view: best first, ties in the order said, with each length', () => {
  const view = momentsViewFor({ sourceId: 'm1', driveFileId: 'd1', row: NOTES_ROW('fp-now'), notes: NOTES_NOW, projectName: 'Dane of Earth' });
  assert.equal(view.state, 'done');
  assert.deepEqual(view.moments.map((m) => m.quote), ['High', 'Tie, said first', 'Low']);
  assert.equal(view.moments[2].lengthS, 15.5);
  assert.deepEqual(view.moments[0].reasons, ['clear']);
  assert.equal(view.driveUrl, 'https://drive.google.com/file/d/d1/view');
  assert.equal(view.notesState, 'current');
  assert.equal(view.notesMissing, '');
});

test('moments view: scored against older notes reads as stale and can be scored again', () => {
  const view = momentsViewFor({ sourceId: 'm1', row: NOTES_ROW('fp-old'), notes: NOTES_NOW });
  assert.equal(view.notesState, 'stale');
  assert.equal(view.canRescore, true);
});

test('moments view: a score that never recorded its notes is "unrecorded", never "current"', () => {
  const view = momentsViewFor({ sourceId: 'm1', row: NOTES_ROW(''), notes: NOTES_NOW });
  assert.equal(view.notesState, 'unrecorded');
});

test('moments view: notes that could not be read are "unknown", never "current" or "stale"', () => {
  const view = momentsViewFor({ sourceId: 'm1', row: NOTES_ROW('fp-now'), notes: { ok: false, status: 503, error: 'used_by missing' } });
  assert.equal(view.notesState, 'unknown');
  assert.match(view.notesError, /used_by missing/);
  assert.equal(view.notesMissing, '', 'could not read is not "nothing switched on"');
});

test('moments view: not scored yet is its own answer, with nothing to rescore', () => {
  const view = momentsViewFor({ sourceId: 'm1', row: null, notes: NOTES_NOW });
  assert.equal(view.state, 'not_yet');
  assert.equal(view.canRescore, false);
  assert.equal(view.notesState, 'not_scored');
  assert.deepEqual(view.moments, []);
});

test('moments view: a failed score carries its reason', () => {
  const view = momentsViewFor({ sourceId: 'm1', row: { ...NOTES_ROW('fp-now'), status: 'failed', error: 'the model timed out', moments: [] }, notes: NOTES_NOW });
  assert.equal(view.state, 'failed');
  assert.equal(view.error, 'the model timed out');
  assert.equal(view.canRescore, true);
});

test('moments view: no notes switched on names the project; unreadable ones say why', () => {
  const none = { ok: true, data: { text: '', fingerprint: 'f', entries: [], unreadable: [], reason: 'No Context entry…' } };
  assert.equal(
    momentsViewFor({ sourceId: 'm1', row: null, notes: none, projectName: 'Dane of Earth' }).notesMissing,
    'No Reel Spinner notes are switched on in Dane of Earth.'
  );
  const unreadable = { ok: true, data: { text: '', fingerprint: 'f', entries: [], unreadable: [{ id: 'x' }], reason: 'Every Context entry switched on for Reel Spinner is one it cannot read (see unreadable).' } };
  assert.match(momentsViewFor({ sourceId: 'm1', row: null, notes: unreadable }).notesMissing, /cannot read/);
});

const SCORED = (fingerprint) => ({
  status: 'done',
  summary: 'Two good bits.',
  briefFingerprint: fingerprint,
  runStartedAt: new Date(Date.now() - 1000).toISOString(),
  moments: [
    { start_s: 10, end_s: 20, score: 40, reasons: ['ok'], project: 'Delray', mood: '', quote: 'second' },
    { start_s: 30, end_s: 50, score: 88, reasons: ['great'], project: 'Delray', mood: '', quote: 'first' },
  ],
});

test('GET moments: this project\'s row, best first, compared with this project\'s notes', async () => {
  const stores = withRoute();
  const { route, moments, notesAsked, restore } = stores;
  try {
    const made = await sourceIn(stores, SCOPE_A, { driveFileId: 'dm1' });
    const saved = await moments.upsertMoments(made.id, SCORED('fp-old'), SCOPE_A);
    assert.equal(saved.ok, true, saved.error);
    const { handled, res } = await call(route, `/api/studio/sources/${made.id}/moments`, { ...SCOPE_A, name: 'Dane of Earth' });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = json(res).data;
    assert.deepEqual(body.moments.map((m) => m.quote), ['first', 'second']);
    assert.equal(body.notesState, 'stale');
    assert.equal(body.projectName, 'Dane of Earth');
    assert.deepEqual(notesAsked.map((a) => [a.projectId, a.use]), [['proj_a', 'reel-spinner']]);
  } finally {
    restore();
  }
});

test('GET moments: our own recording not scored yet is a 200 saying not_yet', async () => {
  const stores = withRoute();
  try {
    const made = await sourceIn(stores, SCOPE_A);
    const { res } = await call(stores.route, `/api/studio/sources/${made.id}/moments`, SCOPE_A);
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).data.state, 'not_yet');
  } finally {
    stores.restore();
  }
});

test('GET moments: another project\'s recording is a 404, never its moments', async () => {
  const stores = withRoute();
  try {
    const theirs = await sourceIn(stores, SCOPE_B);
    const saved = await stores.moments.upsertMoments(theirs.id, { ...SCORED('fp'), summary: 'Project B secrets' }, SCOPE_B);
    assert.equal(saved.ok, true, saved.error);
    const { res } = await call(stores.route, `/api/studio/sources/${theirs.id}/moments`, SCOPE_A);
    assert.equal(res.statusCode, 404);
    assert.doesNotMatch(String(res.body), /Project B secrets/);
  } finally {
    stores.restore();
  }
});

test('POST rescore: stamps our own row and reads it back; the next GET says it is waiting', async () => {
  const stores = withRoute();
  try {
    const made = await sourceIn(stores, SCOPE_A);
    assert.equal((await stores.moments.upsertMoments(made.id, SCORED('fp-old'), SCOPE_A)).ok, true);
    const { res } = await call(stores.route, `/api/studio/sources/${made.id}/moments/rescore`, SCOPE_A, 'POST');
    assert.equal(res.statusCode, 200);
    assert.ok(json(res).data.rescoreRequestedAt);
    const again = json((await call(stores.route, `/api/studio/sources/${made.id}/moments`, SCOPE_A)).res).data;
    assert.ok(again.rescoreRequestedAt, 'the request must be on the row the screen reads');
  } finally {
    stores.restore();
  }
});

test('POST rescore: another project\'s recording is a 404 and its row is left alone', async () => {
  const stores = withRoute();
  try {
    const theirs = await sourceIn(stores, SCOPE_B);
    assert.equal((await stores.moments.upsertMoments(theirs.id, SCORED('fp'), SCOPE_B)).ok, true);
    const { res } = await call(stores.route, `/api/studio/sources/${theirs.id}/moments/rescore`, SCOPE_A, 'POST');
    assert.equal(res.statusCode, 404);
    const row = await stores.moments.getMomentsBySource(theirs.id, SCOPE_B);
    assert.equal(row.ok, true, row.error);
    assert.equal(row.data.rescoreRequestedAt, '', 'project A must not be able to stamp project B\'s row');
  } finally {
    stores.restore();
  }
});

test('POST rescore: a recording never scored says there is nothing to score again', async () => {
  const stores = withRoute();
  try {
    const made = await sourceIn(stores, SCOPE_A);
    const { res } = await call(stores.route, `/api/studio/sources/${made.id}/moments/rescore`, SCOPE_A, 'POST');
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error.code, 'NOT_SCORED');
  } finally {
    stores.restore();
  }
});

test('GET on the rescore address is refused, not run', async () => {
  const stores = withRoute();
  try {
    const made = await sourceIn(stores, SCOPE_A);
    const { handled, res } = await call(stores.route, `/api/studio/sources/${made.id}/moments/rescore`, SCOPE_A, 'GET');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 405);
  } finally {
    stores.restore();
  }
});

// ── Reel Spinner 3b (SC-832): recorded together with ─────────────────────────

test('pairsViewFor: each file sees its partner, whose sound is used, and whether it was Dane', () => {
  const { pairsViewFor, buildFootage } = require('../../lib/studioFootage');
  const names = new Map([['src_a', 'IMG_1.MOV'], ['src_b', 'zoom.mp4']]);
  const pairs = [{ id: 'p1', sourceAId: 'src_a', sourceBId: 'src_b', status: 'done', offsetS: 20, driftS: 0, audioSourceId: 'src_b', chosenBy: 'measured' }];
  const [fromA] = pairsViewFor('src_a', pairs, names);
  assert.equal(fromA.partnerName, 'zoom.mp4');
  assert.equal(fromA.soundFromName, 'zoom.mp4');
  assert.equal(fromA.soundIsThisFile, false);
  assert.equal(fromA.offsetS, 20);
  const [fromB] = pairsViewFor('src_b', pairs, names);
  assert.equal(fromB.partnerName, 'IMG_1.MOV');
  assert.equal(fromB.soundIsThisFile, true);
  assert.equal(fromB.offsetS, -20, 'the offset is said from this file\'s side');
  assert.deepEqual(pairsViewFor('src_c', pairs, names), []);

  const view = buildFootage({
    sources: [{ id: 'src_a', localPath: '/c/IMG_1.MOV' }, { id: 'src_b', localPath: '/c/zoom.mp4' }],
    pairs,
  });
  const files = view.sessions.flatMap((s) => s.sources);
  assert.equal(files.find((f) => f.id === 'src_a').pairs[0].partnerName, 'zoom.mp4');
});

test('pairsViewFor: a refused pair says why in words, drift with how far', () => {
  const { pairsViewFor, pairReasonText } = require('../../lib/studioFootage');
  const [drift] = pairsViewFor('src_a', [{ id: 'p', sourceAId: 'src_a', sourceBId: 'src_b', status: 'failed', error: 'drift', driftS: -0.25 }]);
  assert.equal(drift.status, 'failed');
  assert.match(drift.reason, /clocks drift apart \(0\.25 s by the end\)/);
  assert.equal(pairReasonText('no_match'), 'their sound did not match anywhere');
  assert.match(pairReasonText('audio_could_not_be_read: the sound file is not on disk at /x.wav'), /could not be read — the sound file is not on disk/);
  assert.equal(pairReasonText('something_new'), 'something_new', 'an unknown code is shown, never dropped');
  assert.equal(pairReasonText(''), 'no reason was recorded');
});

test('GET /api/studio/footage shows each recording its partner, and POST …/sound is Dane\'s switch', async () => {
  const stores = withRoute();
  const { route, pairs, restore } = stores;
  try {
    const zoom = await sourceIn(stores, SCOPE_A, { deviceLane: 'zoom', localPath: '/c/zoom/call.mp4' });
    const phone = await sourceIn(stores, SCOPE_A, { deviceLane: 'iphone', localPath: '/c/iphone/IMG_2001.MOV' });
    const saved = await pairs.upsertAudioPair(zoom.id, phone.id, {
      status: 'done', offsetS: 20, driftS: 0.01, confidence: 0.9, audioSourceId: zoom.id,
    }, SCOPE_A);
    assert.equal(saved.ok, true, saved.error);

    const listed = json((await call(route, '/api/studio/footage', SCOPE_A)).res);
    assert.equal(listed.data.pairsError, '');
    const files = listed.data.sessions.flatMap((g) => g.sources);
    const onPhone = files.find((f) => f.id === phone.id).pairs;
    assert.equal(onPhone.length, 1);
    assert.equal(onPhone[0].partnerName, 'call.mp4');
    assert.equal(onPhone[0].soundFromName, 'call.mp4');
    assert.equal(onPhone[0].chosenBy, 'measured');

    // The switch: the phone's sound, then reload — it stays switched.
    const chose = await call(route, `/api/studio/pairs/${saved.data.id}/sound`, SCOPE_A, 'POST', { audioSourceId: phone.id });
    assert.equal(chose.res.statusCode, 200, chose.res.body);
    assert.equal(json(chose.res).data.chosenBy, 'dane');
    const again = json((await call(route, '/api/studio/footage', SCOPE_A)).res).data.sessions.flatMap((g) => g.sources);
    const after = again.find((f) => f.id === zoom.id).pairs[0];
    assert.equal(after.soundIsThisFile, false);
    assert.equal(after.soundFromName, 'IMG_2001.MOV');
    assert.equal(after.chosenBy, 'dane');

    // Another project cannot reach the pair; a stranger's sound is refused; GET is not the switch.
    const foreign = await call(route, `/api/studio/pairs/${saved.data.id}/sound`, SCOPE_B, 'POST', { audioSourceId: phone.id });
    assert.equal(foreign.res.statusCode, 404);
    const stranger = await call(route, `/api/studio/pairs/${saved.data.id}/sound`, SCOPE_A, 'POST', { audioSourceId: 'src_nobody' });
    assert.equal(stranger.res.statusCode, 400);
    const empty = await call(route, `/api/studio/pairs/${saved.data.id}/sound`, SCOPE_A, 'POST', {});
    assert.equal(empty.res.statusCode, 400);
    const get = await call(route, `/api/studio/pairs/${saved.data.id}/sound`, SCOPE_A, 'GET');
    assert.equal(get.res.statusCode, 405);
  } finally {
    restore();
  }
});

test('GET /api/studio/footage: pairs that cannot be read keep the list up and say so', async () => {
  const stores = withRoute();
  const { route, db, restore } = stores;
  try {
    await sourceIn(stores, SCOPE_A, { deviceLane: 'zoom' });
    const real = db.sbQuery.bind(db);
    db.sbQuery = (args) => (args.table === 'video_audio_pairs'
      ? Promise.resolve({ ok: false, status: 404, error: 'relation "video_audio_pairs" does not exist' })
      : real(args));
    const body = json((await call(route, '/api/studio/footage', SCOPE_A)).res);
    assert.equal(body.ok, true);
    assert.equal(body.data.totalSources, 1);
    assert.match(body.data.pairsError, /video_audio_pairs/);
  } finally {
    restore();
  }
});
