'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Reel Spinner 6a (SC-839) — each rough cut's YouTube title, description and
 * tags, written on the Mini.
 *
 * The AI's answers are RECORDED replies in the AI door's own shape
 * (lib/aiClient.js `generate`), handed in through the `door` seam. The edit
 * rows live in the REAL store (lib/videoEditsStore.js) over the schema-reading
 * fake database, so "Dane's edit is never overwritten" is proved against the
 * guarded writes production runs, not against a hand-written stand-in. The
 * queue is the real SQLite one. Nothing touches the network.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SQL_TEXT = ['video_studio_setup.sql', 'video_reel_spinner_setup.sql']
  .map((file) => fs.readFileSync(path.join(SQL_DIR, file), 'utf8'))
  .join('\n');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
const { openQueue } = require('../../workers/studio/queue.js');
const copy = require('../../workers/studio/youtubeCopy.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const STORE_PATHS = [
  '../../lib/projectScope.js',
  '../../lib/videoSessionsStore.js',
  '../../lib/videoSourcesStore.js',
  '../../lib/videoEditsStore.js',
  '../../workers/studio/youtubeCopyPass.js',
].map((p) => require.resolve(p));

const PROJECT = 'proj_studio';
const SCOPE = { projectId: PROJECT, userId: 'user_1' };
const ENV = { STUDIO_PROJECT_ID: PROJECT };

/** The end-cards note, read (cards.js readEndCards shape). */
const CARDS = new Map([
  ['WaveCenter', { project: 'WaveCenter', name: 'WaveCenter', invitation: 'Come and build it with us', address: 'wavecenter.com' }],
]);
const BRIEF = 'To attract collaborators to my various projects, especially WaveCenter and the DEO movement.';

/** A 60-second talk: a word every half second. The full edit keeps 0-30 s. */
const WORDS = [];
for (let i = 0; i < 120; i += 1) WORDS.push({ start: i * 0.5, end: i * 0.5 + 0.4, word: i < 60 ? `kept${i}` : `cut${i}` });
const MOMENTS = [{ start_s: 2, end_s: 28, score: 90, project: 'WaveCenter', mood: 'hopeful', quote: 'Every kid can play.' }];

const SHELF = {
  tracks: [
    { id: 'inspired', title: 'Inspired', artist: 'Kevin MacLeod', attributionRequired: true,
      attribution: '"Inspired" Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttps://creativecommons.org/licenses/by/4.0/' },
    { id: 'free', title: 'Free', artist: 'Someone', attributionRequired: false, attribution: '' },
  ],
};

function reply(json, extra = {}) {
  return {
    ok: true, provider: 'anthropic', providerLabel: 'Anthropic', model: 'claude-opus-5-5', stopReason: 'end_turn',
    usage: { inputTokens: 900, outputTokens: 220 }, skipped: [], text: JSON.stringify(json), ...extra,
  };
}

/** A recorded reply: what the door returned for a real WaveCenter talk, shortened. */
const GOOD = reply({
  title: 'Why a tennis court can be the start of a neighbourhood',
  description: 'Dane talks about WaveCenter: what it is for, and who it needs.\n\nIt is for people who want to build places where kids and grown-ups learn together.',
  tags: ['WaveCenter', 'community building', 'youth tennis', 'Delray Beach', 'WaveCenter'],
});

function withStore() {
  const db = createFakeDb(parseSchemaText(SQL_TEXT));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ videoSessions: 'video_sessions', videoSources: 'video_sources', videoEdits: 'video_edits' }),
    sbQuery: (req) => db.sbQuery(req),
  };
  const real = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of STORE_PATHS) delete require.cache[p];
  const [, sessions, sources, edits, pass] = STORE_PATHS.map((p) => require(p));
  const restore = () => {
    if (real) require.cache[supabasePath] = real; else delete require.cache[supabasePath];
    for (const p of STORE_PATHS) delete require.cache[p];
  };
  return { db, sessions, sources, edits, pass, restore };
}

async function setup(t, { musicTrack = null, kind = 'full' } = {}) {
  const ctx = withStore();
  t.after(() => ctx.restore());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ytcopy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const queue = openQueue(path.join(dir, 'queue.sqlite'));
  t.after(() => queue.close());
  const session = await ctx.sessions.createSession({ title: 'A talk' }, SCOPE);
  const source = await ctx.sources.createSource({ sessionId: session.data.id }, SCOPE);
  const made = await ctx.edits.createEdit(source.data.id, {
    kind, ...(kind === 'short' ? { momentIndex: 0 } : {}), keepRanges: [{ start_s: 0, end_s: 30 }],
  }, SCOPE);
  assert.equal(made.ok, true, JSON.stringify(made));
  const id = made.data.id;
  assert.equal((await ctx.edits.moveEdit(id, 'rendering', {}, SCOPE)).ok, true);
  const moved = await ctx.edits.moveEdit(id, 'review', { roughCutDriveFileId: 'drive-1', ...(musicTrack ? { musicTrack } : {}) }, SCOPE);
  assert.equal(moved.ok, true, JSON.stringify(moved));
  const catalog = {
    getEditById: ctx.edits.getEditById,
    listEditsByStatus: ctx.edits.listEditsByStatus,
    fillYoutubeCopy: ctx.edits.fillYoutubeCopy,
    noteYoutubeCopyProblem: ctx.edits.noteYoutubeCopyProblem,
    clearYoutubeCopyProblem: ctx.edits.clearYoutubeCopyProblem,
    getTranscriptBySource: async () => ({ ok: true, status: 200, data: { state: 'done', words: WORDS } }),
    getMomentsBySource: async () => ({ ok: true, status: 200, data: { status: 'done', moments: MOMENTS } }),
  };
  const asked = [];
  const alarms = [];
  const run = (overrides = {}) => ctx.pass.runYoutubeCopy({
    queue, env: ENV, catalog, shelf: SHELF,
    readBrief: async () => ({ ok: true, data: { text: BRIEF, fingerprint: 'f1' } }),
    readEndCards: async () => ({ ok: true, cards: CARDS, problems: [] }),
    door: async (req) => { asked.push(req); return overrides.answer || GOOD; },
    alarm: (reason) => { alarms.push(reason); return { said: 'posted' }; },
    clearAlarm: () => {},
    ...overrides,
  });
  const stored = async () => (await ctx.edits.getEditById(id, SCOPE)).data;
  return { ctx, queue, catalog, id, run, asked, alarms, stored };
}

// ── The rules ─────────────────────────────────────────────────────────────

test('a recorded answer becomes a title within 100 characters and a description within 5,000, ending on the end card', () => {
  const card = CARDS.get('WaveCenter');
  const long = copy.checkAnswer({
    title: `${'A very long and honest title about building things together '.repeat(4)}`,
    description: 'Paragraph. '.repeat(900),
    tags: ['one', 'two'],
  }, { card, attribution: SHELF.tracks[0].attribution });
  assert.equal(long.ok, true, long.reason);
  assert.ok(long.title.length <= copy.TITLE_MAX, `title is ${long.title.length}`);
  assert.ok(!/\s$/.test(long.title), 'cut at a word, never mid-space');
  assert.ok(long.description.length <= copy.DESCRIPTION_MAX, `description is ${long.description.length}`);
  // The ending is never what gives way.
  assert.ok(long.description.endsWith(`Come and build it with us\nhttps://wavecenter.com\n\nMusic:\n${SHELF.tracks[0].attribution}`));
});

test('the attribution line is there when the licence needs one, and absent when it does not', () => {
  const card = CARDS.get('WaveCenter');
  const need = copy.attributionFor('inspired', SHELF);
  assert.equal(need.ok, true);
  assert.match(copy.composeDescription('Body.', card, need.attribution), /Licensed under Creative Commons: By Attribution 4\.0/);
  const free = copy.attributionFor('free', SHELF);
  assert.equal(free.attribution, '');
  assert.doesNotMatch(copy.composeDescription('Body.', card, free.attribution), /Music:/);
  // A track the shelf does not know is a refusal, never a video with no credit.
  assert.equal(copy.attributionFor('nowhere', SHELF).ok, false);
  // Composing twice does not add the ending twice.
  const once = copy.composeDescription('Body.', card, need.attribution);
  assert.equal(copy.composeDescription(once, card, need.attribution), once);
});

test('clickbait is refused by name, and so is a shouted title', () => {
  const card = CARDS.get('WaveCenter');
  const beg = copy.checkAnswer({ title: 'Building courts', description: 'Smash that like button!', tags: ['a'] }, { card });
  assert.equal(beg.ok, false);
  assert.match(beg.reason, /Smash that like/);
  const caps = copy.checkAnswer({ title: 'THIS CHANGES EVERYTHING FOREVER', description: 'Fine.', tags: ['a'] }, { card });
  assert.equal(caps.ok, false);
  assert.match(caps.reason, /capitals/);
});

test('tags stay within YouTube\'s 500 characters, without repeats or commas', () => {
  const tags = copy.cleanTags(['tennis', 'Tennis', 'a,b', ...Array.from({ length: 40 }, (_, i) => `tag number ${i}`)]);
  assert.deepEqual(tags.slice(0, 2), ['tennis', 'a b']);
  assert.ok(tags.length <= 15);
  assert.ok(tags.join(',').length <= copy.TAGS_TOTAL_MAX);
});

test('the prompt carries only the words the edit KEEPS, Dane\'s brief and the project', () => {
  const said = copy.keptWords(WORDS, [{ start_s: 0, end_s: 30 }]);
  assert.equal(said.length, 60);
  assert.ok(said.every((w) => w.startsWith('kept')));
  const { system, user } = copy.buildPrompt({ kind: 'full', said, brief: BRIEF, project: 'WaveCenter', invitation: 'Come and build it with us' });
  assert.ok(system.includes(BRIEF));
  assert.match(system, /not a "content creator"/);
  assert.ok(!user.includes('cut60'));
});

// ── The pass ──────────────────────────────────────────────────────────────

test('a rough cut in review gets its title, description and tags, through the door at tier strong', async (t) => {
  const s = await setup(t, { musicTrack: 'inspired' });
  const watched = await s.ctx.pass.watchYoutubeCopy({ queue: s.queue, env: ENV, catalog: s.catalog });
  assert.equal(watched.processed.length, 1);
  const report = await s.run();
  assert.equal(report.written.length, 1, JSON.stringify(report));
  assert.equal(s.asked.length, 1);
  assert.equal(s.asked[0].tier, 'strong');
  assert.equal(s.asked[0].feature, 'studio_youtube_copy');
  const row = await s.stored();
  assert.equal(row.youtubeTitle, 'Why a tennis court can be the start of a neighbourhood');
  assert.ok(row.youtubeDescription.endsWith(`Come and build it with us\nhttps://wavecenter.com\n\nMusic:\n${SHELF.tracks[0].attribution}`));
  assert.deepEqual(row.youtubeTags, ['WaveCenter', 'community building', 'youth tennis', 'Delray Beach']);
  // Nothing is left to do: the next watch queues nothing.
  const again = await s.ctx.pass.watchYoutubeCopy({ queue: s.queue, env: ENV, catalog: s.catalog });
  assert.equal(again.processed.length, 0);
});

test('a field Dane edited is never overwritten — not even by an answer that lands after he typed', async (t) => {
  const s = await setup(t);
  // He types a title while the Mini is still waiting on the AI.
  const late = async (req) => {
    s.asked.push(req);
    const typed = await s.ctx.edits.reviewEdit(s.id, { youtubeTitle: 'My own title' }, SCOPE);
    assert.equal(typed.ok, true, JSON.stringify(typed));
    return GOOD;
  };
  s.ctx.pass.enqueueYoutubeCopy(s.queue, { editId: s.id });
  const report = await s.run({ door: late });
  assert.equal(report.written.length, 1, JSON.stringify(report));
  assert.deepEqual(report.written[0].kept, ['youtubeTitle']);
  const row = await s.stored();
  assert.equal(row.youtubeTitle, 'My own title');
  assert.match(row.youtubeDescription, /^Dane talks about WaveCenter/);

  // A later run, with every box filled, pays for nothing and changes nothing.
  s.ctx.pass.enqueueYoutubeCopy(s.queue, { editId: s.id });
  const before = s.asked.length;
  await s.run();
  assert.equal(s.asked.length, before);
  assert.equal((await s.stored()).youtubeTitle, 'My own title');

  // A box he clears is filled again on the next pass.
  await s.ctx.edits.reviewEdit(s.id, { youtubeTitle: '' }, SCOPE);
  const watched = await s.ctx.pass.watchYoutubeCopy({ queue: s.queue, env: ENV, catalog: s.catalog });
  assert.equal(watched.processed.length, 1);
  await s.run();
  assert.equal((await s.stored()).youtubeTitle, 'Why a tennis court can be the start of a neighbourhood');
});

test('no provider able to pay: nothing written, the card says why, the bus hears, and no attempt is spent', async (t) => {
  const s = await setup(t);
  s.ctx.pass.enqueueYoutubeCopy(s.queue, { editId: s.id });
  const noProvider = {
    ok: false, code: 'no_provider', error: 'No AI provider could answer. Anthropic: out of credit.',
    skipped: [{ provider: 'anthropic', label: 'Anthropic', verdict: 'OUT_OF_CREDIT', reason: 'out of credit' }],
  };
  const report = await s.run({ answer: noProvider });
  assert.equal(report.released.length, 1, JSON.stringify(report));
  assert.match(s.alarms[0], /no AI provider can pay\. Anthropic: out of credit/);
  const row = await s.stored();
  assert.equal(row.youtubeTitle, '');
  assert.match(row.error, /^YouTube text not written yet: no AI provider can pay right now/);
  const job = s.queue.listJobs({ stage: 'youtube_copy' })[0];
  assert.equal(job.state, 'pending');
  assert.equal(job.attempts, 0);

  // Once a provider can pay, the text is written and the reason comes off the
  // card. (The held job is set aside so this test need not wait out the hour.)
  s.queue.block({ stage: 'youtube_copy', subjectKind: 'video_edit', subjectId: s.id, reason: 'set aside by the test', jobId: job.id });
  s.ctx.pass.enqueueYoutubeCopy(s.queue, { editId: s.id });
  await s.run();
  const after = await s.stored();
  assert.equal(after.youtubeTitle, 'Why a tennis court can be the start of a neighbourhood');
  assert.equal(after.error, '');
});

test('no end card for its project: blocked BEFORE the AI is paid, with the reason on the card', async (t) => {
  const s = await setup(t);
  s.ctx.pass.enqueueYoutubeCopy(s.queue, { editId: s.id });
  const report = await s.run({ readEndCards: async () => ({ ok: true, cards: new Map(), problems: [] }) });
  assert.equal(report.blocked.length, 1, JSON.stringify(report));
  assert.equal(s.asked.length, 0);
  assert.match((await s.stored()).error, /^YouTube text not written yet: no end card for WaveCenter/);
  // The watcher leaves it for six hours rather than re-reading the same note every five minutes.
  const watched = await s.ctx.pass.watchYoutubeCopy({ queue: s.queue, env: ENV, catalog: s.catalog });
  assert.equal(watched.processed.length, 0);
  assert.equal(watched.skipped.length, 1);
});

test('a re-cut\'s hand-back reason on the card is never written over', async (t) => {
  const s = await setup(t);
  const noted = await s.ctx.edits.noteYoutubeCopyProblem(s.id, 'first reason', SCOPE);
  assert.equal(noted.ok, true);
  // Simulate a hand-back reason by sending it back and handing back unchanged.
  await s.ctx.edits.reviewEdit(s.id, { status: 'sent_back', daneNote: 'make it purple' }, SCOPE);
  await s.ctx.edits.moveEdit(s.id, 'review', { error: 'could not re-cut from your note: colour is not an edit' }, SCOPE);
  const again = await s.ctx.edits.noteYoutubeCopyProblem(s.id, 'second reason', SCOPE);
  assert.equal(again.noted, false);
  assert.equal((await s.stored()).error, 'could not re-cut from your note: colour is not an edit');
  const cleared = await s.ctx.edits.clearYoutubeCopyProblem(s.id, SCOPE);
  assert.equal(cleared.cleared, false);
  assert.equal((await s.stored()).error, 'could not re-cut from your note: colour is not an edit');
});

test('clickbait from the AI is refused and never reaches the row', async (t) => {
  const s = await setup(t);
  s.ctx.pass.enqueueYoutubeCopy(s.queue, { editId: s.id });
  const bait = reply({ title: 'You won\'t believe this court', description: 'Wow.', tags: ['x'] });
  const report = await s.run({ answer: bait });
  assert.equal(report.failed.length, 1, JSON.stringify(report));
  const row = await s.stored();
  assert.equal(row.youtubeTitle, '');
  assert.match(row.error, /the AI's answer was refused: the answer asked for clicks/);
});

test('an edit that is uploading is left alone', async (t) => {
  const s = await setup(t);
  await s.ctx.edits.reviewEdit(s.id, { status: 'approved' }, SCOPE);
  await s.ctx.edits.moveEdit(s.id, 'finished', {}, SCOPE);
  await s.ctx.edits.moveEdit(s.id, 'uploading', {}, SCOPE);
  s.ctx.pass.enqueueYoutubeCopy(s.queue, { editId: s.id });
  const report = await s.run();
  assert.equal(report.movedOn.length, 1, JSON.stringify(report));
  assert.equal(s.asked.length, 0);
  const filled = await s.ctx.edits.fillYoutubeCopy(s.id, { youtubeTitle: 'late' }, SCOPE);
  assert.deepEqual(filled.written, []);
});
