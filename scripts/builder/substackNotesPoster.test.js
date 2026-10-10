'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Notes 6/7 (86bcet7qr) — the Substack adapter for the Mini's one
 * posting worker (workers/youtube-outreach/poster.js).
 *
 * The whole worker runs here against the SQL-backed fake database, a stand-in
 * OpenClaw and a stand-in Substack reader. Nothing reaches the network. The
 * one real post waits for Dane to sign the Mini's browser in to Substack
 * (Substack Notes 7/7).
 *
 * The rules each test pins: the limits count all four kinds together; a row
 * left `posting` is never retried; a Note or reply with no link — or whose
 * link shows other words — is failed, never posted; a restack or like whose
 * page does not show it done is failed; a Note already liked is never liked
 * again (the button is a toggle, so a second click undoes the first).
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'substack_notes_setup.sql');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/substackNotesStore.js');

const poster = require('../../workers/youtube-outreach/poster.js');
const substack = require('../../workers/youtube-outreach/adapters/substack.js');

const PROJECT = 'proj_doe';
const SCOPE = { projectId: PROJECT, userId: 'user_dane' };
const WORDS = 'Scheduling posts made me write for a calendar instead of for a reader. I stopped, and the writing got shorter and truer.';
const OTHER_WORDS = 'The part about rereading a draft out loud is the whole trick. I hear every sentence I would never say to a friend.';
const THEIR_NOTE = 'https://substack.com/@someone/note/c-12345';
const OTHER_NOTE = 'https://substack.com/@other/note/c-67890';

const MINUTE = 60 * 1000;

function withDb() {
  const db = createFakeDb(parseSchemaText(fs.readFileSync(SQL_PATH, 'utf8')));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      substackNotesItems: 'substack_notes_items',
      substackNotesSettings: 'substack_notes_settings',
    }),
    sbQuery: db.sbQuery,
  };
  const real = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of [projectScopePath, storePath]) delete require.cache[p];
  const store = require(storePath);
  return {
    db,
    store,
    restore() {
      if (real) require.cache[supabasePath] = real;
      else delete require.cache[supabasePath];
      for (const p of [projectScopePath, storePath]) delete require.cache[p];
    },
  };
}

/** Open all day, no gap: only the rule a test sets can hold anything. */
const OPEN = { activeStartHour: 0, activeEndHour: 24, minMinutesBetween: 0, jitterMinutes: 0, timeZone: 'UTC', maxActionsPerDay: 10 };

async function setLimits(store, overrides = {}) {
  const saved = await store.saveSettings({ ...OPEN, ...overrides }, SCOPE);
  assert.equal(saved.ok, true, saved.error);
}

/** One approved item of `kind`. A Note or reply goes idea → draft → approved. */
async function approved(store, kind, { words = WORDS, targetUrl = THEIR_NOTE } = {}) {
  const input = kind === 'note'
    ? { kind, source: 'jotted', ideaText: 'Why I stopped scheduling posts' }
    : { kind, source: 'target', targetUrl };
  const made = await store.createItem(input, SCOPE);
  assert.equal(made.ok, true, made.error);
  if (kind === 'note' || kind === 'reply') {
    const drafted = await store.updateItem(made.data.id, { status: 'draft', draftText: words }, SCOPE);
    assert.equal(drafted.ok, true, drafted.error);
  }
  const done = await store.approveItem(made.data.id, {}, SCOPE);
  assert.equal(done.ok, true, done.error);
  return done.data;
}

/**
 * A stand-in OpenClaw that "posts" by writing the Note into a stand-in
 * Substack, or "clicks" by remembering the Note was liked/restacked, unless
 * told to misbehave. `calls` records every request.
 */
function standIns({ behave = 'ok' } = {}) {
  const notes = new Map(); // note id on "Substack" -> text
  const calls = [];
  let seq = 900;
  const answer = (body) => ({ ok: true, status: 200, text: JSON.stringify(body) });
  const callOpenClaw = async (request) => {
    calls.push(request);
    const open = request.input.lastIndexOf('<note>');
    const words = open >= 0 ? request.input.slice(open + '<note>'.length, request.input.indexOf('</note>', open)) : '';
    const clicking = /"liked"|"restacked"/.test(request.input);
    const state = /"liked"/.test(request.input) ? 'liked' : 'restacked';
    seq += 1;
    const url = `https://substack.com/@daneofearth/note/c-${seq}`;
    switch (behave) {
      case 'ok':
      case 'reader-down':
        if (clicking) return answer({ done: true, [state]: true, alreadyDone: false, screenshotPath: '/tmp/openclaw-shot.png', problem: null });
        notes.set(String(seq), words);
        return answer({ done: true, noteUrl: url, screenshotPath: '/tmp/openclaw-shot.png', problem: null });
      case 'success-no-link':
        // The 2026-07-19 shape: the agent says it worked and shows nothing.
        return answer({ done: true, noteUrl: null, screenshotPath: null, problem: null });
      case 'link-to-nothing':
        return answer({ done: true, noteUrl: url, screenshotPath: null, problem: null });
      case 'wrong-words':
        notes.set(String(seq), 'Something else entirely, which the agent wrote instead.');
        return answer({ done: true, noteUrl: url, screenshotPath: null, problem: null });
      case 'returns-target':
        notes.set('12345', 'Their own Note, which says something else.');
        return answer({ done: true, noteUrl: THEIR_NOTE, screenshotPath: null, problem: null });
      case 'click-not-shown':
        return answer({ done: true, [state]: false, alreadyDone: false, screenshotPath: null, problem: 'The button did not change.' });
      case 'said-no':
        return answer({ done: false, noteUrl: null, screenshotPath: null, problem: 'The Note box would not open.' });
      case 'said-no-with-shot':
        // The picture of the refusal is the one Dane most needs (a signed-out page).
        return answer({ done: false, noteUrl: null, screenshotPath: '/tmp/openclaw-signed-out.png', problem: 'The browser is signed out of Substack.' });
      case 'already-on':
        if (clicking) return answer({ done: true, [state]: true, alreadyDone: true, screenshotPath: '/tmp/openclaw-shot.png', problem: null });
        notes.set(String(seq), words);
        return answer({ done: true, noteUrl: url, screenshotPath: '/tmp/openclaw-shot.png', problem: null });
      case 'timeout':
        return { ok: false, status: 504, error: 'OpenClaw /v1/responses timed out after 300000ms' };
      case 'hang':
        return new Promise(() => {}); // the worker is "killed" while waiting here
      default:
        throw new Error(`unknown behaviour ${behave}`);
    }
  };
  const readNote = async (noteId) => {
    if (behave === 'reader-down') return { ok: false, error: 'Substack answered 503' };
    return notes.has(noteId) ? { ok: true, found: true, text: notes.get(noteId) } : { ok: true, found: false };
  };
  const uploads = [];
  const upload = async (args) => {
    uploads.push(args);
    return { ok: true, data: { location: `https://blob.example/${args.fileName}` } };
  };
  return { callOpenClaw, readNote, upload, uploads, calls, notes };
}

function adapterFor(env, ins, extra = {}) {
  return substack.createSubstackAdapter({
    projectId: PROJECT,
    store: env.store,
    callOpenClaw: ins.callOpenClaw,
    readNote: ins.readNote,
    upload: ins.upload,
    readFile: () => Buffer.from('png bytes'),
    statFile: () => ({ size: 9 }),
    sleep: async () => {},
    ...extra,
  });
}

async function readRow(env, id) {
  const res = await env.store.getItemById(id, SCOPE);
  assert.equal(res.ok, true, res.error);
  return res.data;
}

// ── The schema ──────────────────────────────────────────────────────────────

test('the poster\'s columns exist on substack_notes_items, and the file still applies cleanly twice', () => {
  const body = fs.readFileSync(SQL_PATH, 'utf8');
  const columns = parseSchemaText(body).tables.get('substack_notes_items').columns;
  for (const name of ['posting_started_at', 'post_note', 'wait_reason', 'wait_checked_at', 'already_done', 'posted_url', 'screenshot_url', 'error']) {
    assert.ok(columns.get(name), `substack_notes_items.${name} is missing`);
  }
  const twice = parseSchemaText(`${body}\n${body}`);
  assert.deepEqual([...twice.tables.get('substack_notes_items').columns.keys()], [...columns.keys()]);
});

test('the worker lists the Substack adapter beside YouTube, on the same project setting', () => {
  assert.deepEqual(poster.ADAPTERS.map((a) => a.name), ['youtube', 'substack']);
  const built = poster.buildAdapters({ YOUTUBE_OUTREACH_PROJECT_ID: PROJECT });
  assert.deepEqual(built.adapters.map((a) => a.name), ['youtube', 'substack'], built.problems.join('; '));
  const off = poster.buildAdapters({});
  assert.ok(off.problems.some((p) => /^substack: .*projectId/.test(p)), off.problems.join('; '));
});

// ── The instructions ────────────────────────────────────────────────────────

test('the browser is told the exact words, the profile, and never to click a like that is already on', () => {
  const note = substack.buildPostInstructions({ item: { kind: 'note', text: WORDS }, profile: 'dane-of-earth', accountName: 'Dane of Earth' });
  assert.match(note, /profile "dane-of-earth"/);
  assert.ok(note.includes(`<note>${WORDS}</note>`));
  assert.match(note, /"Dane of Earth"/);
  const reply = substack.buildPostInstructions({ item: { kind: 'reply', text: WORDS, targetUrl: THEIR_NOTE }, profile: 'p', accountName: 'A' });
  assert.ok(reply.includes(`Open ${THEIR_NOTE}`));
  assert.match(reply, /NOT the address of the Note you replied to/);
  const like = substack.buildPostInstructions({ item: { kind: 'like', targetUrl: THEIR_NOTE }, profile: 'p', accountName: 'A' });
  assert.match(like, /already shows the Note liked/);
  assert.match(like, /"liked": true or false/);
  assert.doesNotMatch(like, /<note>/, 'a like carries no words');
  const restack = substack.buildPostInstructions({ item: { kind: 'restack', targetUrl: THEIR_NOTE }, profile: 'p', accountName: 'A' });
  assert.match(restack, /never "Restack with quote"/);
  assert.match(restack, /"restacked": true or false/);
});

test('a Note link is read for its id; anything else is not a Note', () => {
  assert.deepEqual(substack.parseNoteLink('https://substack.com/@daneofearth/note/c-901'), { ok: true, noteId: '901' });
  assert.deepEqual(substack.parseNoteLink('https://substack.com/note/c-77/'), { ok: true, noteId: '77' });
  assert.equal(substack.parseNoteLink('https://daneofearth.substack.com/p/a-post').ok, false);
  assert.equal(substack.parseNoteLink('https://evil.example/@x/note/c-1').ok, false);
  assert.equal(substack.parseNoteLink('not a link').ok, false);
});

// ── The whole worker against the stand-ins ─────────────────────────────────

test('an approved Note posts, is proven against Substack, and its row reads posted with a link and a screenshot', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    const note = await approved(env.store, 'note');
    const ins = standIns();
    const pass = await poster.runPass({ adapters: [adapterFor(env, ins)] });
    assert.equal(pass.reports[0].posted.outcome, 'posted', JSON.stringify(pass.reports[0]));

    const row = await readRow(env, note.id);
    assert.equal(row.status, 'posted');
    assert.match(row.postedUrl, /^https:\/\/substack\.com\/@daneofearth\/note\/c-\d+$/);
    assert.ok(row.postedAt);
    assert.equal(row.screenshotUrl, `https://blob.example/note-${note.id}.png`);
    assert.equal(ins.calls.length, 1);
    assert.ok(ins.calls[0].input.includes(`<note>${WORDS}</note>`), 'the exact approved words, nothing else');
  } finally {
    env.restore();
  }
});

test('a reply posts to the Note it answers and is proven the same way', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    const reply = await approved(env.store, 'reply', { words: OTHER_WORDS });
    const ins = standIns();
    await poster.runPass({ adapters: [adapterFor(env, ins)] });
    const row = await readRow(env, reply.id);
    assert.equal(row.status, 'posted', row.error);
    assert.ok(ins.calls[0].input.includes(`Open ${THEIR_NOTE}`));
  } finally {
    env.restore();
  }
});

test('a like and a restack are done when the page shows them done, and keep the Note acted on as their link', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    const like = await approved(env.store, 'like');
    const restack = await approved(env.store, 'restack', { targetUrl: OTHER_NOTE });
    const ins = standIns();
    const adapter = adapterFor(env, ins);
    await poster.runPass({ adapters: [adapter] });
    await poster.runPass({ adapters: [adapter] });
    const liked = await readRow(env, like.id);
    assert.equal(liked.status, 'posted', liked.error);
    assert.equal(liked.postedUrl, THEIR_NOTE);
    assert.equal(liked.screenshotUrl, `https://blob.example/like-${like.id}.png`);
    const restacked = await readRow(env, restack.id);
    assert.equal(restacked.status, 'posted', restacked.error);
    assert.equal(restacked.postedUrl, OTHER_NOTE);
  } finally {
    env.restore();
  }
});

test('NO LINK MEANS FAILED: the browser says it posted a Note but returns no link, and the row is failed, not posted', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    const note = await approved(env.store, 'note');
    await poster.runPass({ adapters: [adapterFor(env, standIns({ behave: 'success-no-link' }))] });
    const row = await readRow(env, note.id);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /returned no link/);
    assert.equal(row.postedUrl, '');
  } finally {
    env.restore();
  }
});

test('TEXT NOT FOUND MEANS FAILED: the link shows other words, or no Note at all', async () => {
  for (const behave of ['wrong-words', 'link-to-nothing']) {
    const env = withDb();
    try {
      await setLimits(env.store);
      const note = await approved(env.store, 'note');
      await poster.runPass({ adapters: [adapterFor(env, standIns({ behave }))] });
      const row = await readRow(env, note.id);
      assert.equal(row.status, 'failed', behave);
      assert.match(row.error, behave === 'wrong-words' ? /does not say what was approved/ : /no Note at it/, behave);
    } finally {
      env.restore();
    }
  }
});

test('a reply whose "proof" is the Note it replied to is failed — that link proves nothing', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    const reply = await approved(env.store, 'reply');
    await poster.runPass({ adapters: [adapterFor(env, standIns({ behave: 'returns-target' }))] });
    const row = await readRow(env, reply.id);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /the Note being replied to/);
  } finally {
    env.restore();
  }
});

test('NO "DONE" STATE MEANS FAILED: a like whose page does not show it liked is failed, with OpenClaw\'s own words', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    const like = await approved(env.store, 'like');
    await poster.runPass({ adapters: [adapterFor(env, standIns({ behave: 'click-not-shown' }))] });
    const row = await readRow(env, like.id);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /does not show the Note liked/);
    assert.match(row.error, /The button did not change/);
  } finally {
    env.restore();
  }
});

test('OpenClaw saying no is failed in its own words; a timeout or an unreadable Substack is left for a hand check', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    const a = await approved(env.store, 'note');
    await poster.runPass({ adapters: [adapterFor(env, standIns({ behave: 'said-no' }))] });
    const no = await readRow(env, a.id);
    assert.equal(no.status, 'failed');
    assert.match(no.error, /The Note box would not open/);

    const b = await approved(env.store, 'note', { words: OTHER_WORDS });
    await poster.runPass({ adapters: [adapterFor(env, standIns({ behave: 'timeout' }))] });
    const timedOut = await readRow(env, b.id);
    assert.equal(timedOut.status, 'posting');
    assert.equal(timedOut.needsHandCheck, true);

    const c = await approved(env.store, 'note');
    await poster.runPass({ adapters: [adapterFor(env, standIns({ behave: 'reader-down' }))] });
    const unread = await readRow(env, c.id);
    assert.equal(unread.status, 'posting');
    assert.equal(unread.needsHandCheck, true);
    assert.match(unread.error, /could not be checked/);
  } finally {
    env.restore();
  }
});

test('a Substack item whose request timed out is left for a hand check that names Substack, never "the video"', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    const note = await approved(env.store, 'note');
    await poster.runPass({ adapters: [adapterFor(env, standIns({ behave: 'timeout' }))] });
    const row = await readRow(env, note.id);
    assert.equal(row.status, 'posting');
    assert.equal(row.needsHandCheck, true);
    assert.match(row.error, /Check Substack by hand\./);
    assert.doesNotMatch(row.error, /video/i);
  } finally {
    env.restore();
  }
});

test('a refusal keeps its screenshot: OpenClaw saying no with a picture gives a failed row with that picture', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    const note = await approved(env.store, 'note');
    const ins = standIns({ behave: 'said-no-with-shot' });
    await poster.runPass({ adapters: [adapterFor(env, ins)] });
    const row = await readRow(env, note.id);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /signed out of Substack/);
    assert.equal(row.screenshotUrl, `https://blob.example/note-${note.id}.png`);
    assert.equal(ins.uploads.length, 1);
  } finally {
    env.restore();
  }
});

test('a like that was already on clicks nothing, says so, and uses none of the daily maximum', async () => {
  const env = withDb();
  try {
    await setLimits(env.store, { maxActionsPerDay: 1 });
    const like = await approved(env.store, 'like');
    const note = await approved(env.store, 'note');
    const adapter = adapterFor(env, standIns({ behave: 'already-on' }));
    await poster.runPass({ adapters: [adapter] });
    await poster.runPass({ adapters: [adapter] });
    const liked = await readRow(env, like.id);
    assert.equal(liked.status, 'posted', liked.error);
    assert.equal(liked.alreadyDone, true);
    assert.match(liked.postNote, /already liked from this account, so nothing was clicked/);
    const posted = await readRow(env, note.id);
    assert.equal(posted.status, 'posted', posted.waitReason || posted.error);
    assert.equal(posted.alreadyDone, false);
    // ...and it still counts as liked: a second like of that Note is refused.
    const again = await approved(env.store, 'like');
    await poster.runPass({ adapters: [adapter] });
    assert.match((await readRow(env, again.id)).waitReason, /already liked from here/);
  } finally {
    env.restore();
  }
});

test('NEVER TWICE: a row left `posting` (worker killed mid-post) is never offered again', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    const note = await approved(env.store, 'note');
    const hung = standIns({ behave: 'hang' });
    // The pass never finishes: the browser call hangs, as when launchd kills the worker.
    void poster.runPass({ adapters: [adapterFor(env, hung)] });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(hung.calls.length, 1);
    assert.equal((await readRow(env, note.id)).status, 'posting');

    const fresh = standIns();
    const pass = await poster.runPass({ adapters: [adapterFor(env, fresh)] });
    assert.equal(fresh.calls.length, 0, 'the restarted worker must not ask the browser again');
    assert.equal(pass.reports[0].posted, null);
    assert.equal((await readRow(env, note.id)).status, 'posting');
  } finally {
    env.restore();
  }
});

test('LIMITS ACROSS KINDS: with a daily maximum of 2, a Note and a like use it up and the reply waits for tomorrow\'s allowance', async () => {
  const env = withDb();
  try {
    await setLimits(env.store, { maxActionsPerDay: 2 });
    const note = await approved(env.store, 'note');
    const like = await approved(env.store, 'like');
    const reply = await approved(env.store, 'reply', { words: OTHER_WORDS, targetUrl: OTHER_NOTE });
    const ins = standIns();
    const adapter = adapterFor(env, ins);
    for (let i = 0; i < 4; i += 1) await poster.runPass({ adapters: [adapter] });

    assert.equal((await readRow(env, note.id)).status, 'posted');
    assert.equal((await readRow(env, like.id)).status, 'posted');
    const waiting = await readRow(env, reply.id);
    assert.equal(waiting.status, 'approved');
    assert.match(waiting.waitReason, /tomorrow's allowance — 2 of 2 actions a day/);
    assert.ok(waiting.waitCheckedAt);
    assert.equal(ins.calls.length, 2);
  } finally {
    env.restore();
  }
});

test('with the daily maximum at 1, a second approved item waits and says so', async () => {
  const env = withDb();
  try {
    await setLimits(env.store, { maxActionsPerDay: 1 });
    await approved(env.store, 'note');
    const second = await approved(env.store, 'note', { words: OTHER_WORDS });
    const adapter = adapterFor(env, standIns());
    await poster.runPass({ adapters: [adapter] });
    await poster.runPass({ adapters: [adapter] });
    const row = await readRow(env, second.id);
    assert.equal(row.status, 'approved');
    assert.match(row.waitReason, /Waiting for tomorrow's allowance — 1 of 1 action a day already posted today/);
  } finally {
    env.restore();
  }
});

test('the gap and the active hours hold Substack items too, in actions', async () => {
  const env = withDb();
  try {
    await setLimits(env.store, { minMinutesBetween: 90 });
    await approved(env.store, 'note');
    const second = await approved(env.store, 'like');
    const adapter = adapterFor(env, standIns());
    await poster.runPass({ adapters: [adapter] });
    await poster.runPass({ adapters: [adapter], now: Date.now() + 5 * MINUTE });
    assert.match((await readRow(env, second.id)).waitReason, /gap between actions/);
  } finally {
    env.restore();
  }
  const env2 = withDb();
  try {
    await setLimits(env2.store, { activeStartHour: 8, activeEndHour: 22 });
    const item = await approved(env2.store, 'like');
    await poster.runPass({ adapters: [adapterFor(env2, standIns())], now: Date.parse('2026-10-09T03:00:00Z') });
    assert.match((await readRow(env2, item.id)).waitReason, /actions only go out between 8am and 10pm/);
  } finally {
    env2.restore();
  }
});

test('a Note already liked from here is never liked again — the second click would undo the first', async () => {
  const env = withDb();
  try {
    await setLimits(env.store);
    await approved(env.store, 'like');
    const again = await approved(env.store, 'like');
    const restack = await approved(env.store, 'restack');
    const ins = standIns();
    const adapter = adapterFor(env, ins);
    for (let i = 0; i < 3; i += 1) await poster.runPass({ adapters: [adapter] });
    const held = await readRow(env, again.id);
    assert.equal(held.status, 'approved');
    assert.match(held.waitReason, /already liked from here/);
    // An item's own hold holds only it: the restack of the same Note still goes.
    assert.equal((await readRow(env, restack.id)).status, 'posted');
    assert.equal(ins.calls.length, 2);
  } finally {
    env.restore();
  }
});

test('the posting moves are guarded: a row can be taken from approved once, and settled from posting once', async () => {
  const env = withDb();
  try {
    const note = await approved(env.store, 'note');
    assert.equal((await env.store.markPosting(note.id, SCOPE)).ok, true);
    const second = await env.store.markPosting(note.id, SCOPE);
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
    assert.equal((await env.store.markPosted(note.id, { url: 'https://substack.com/note/c-1' }, SCOPE)).ok, true);
    assert.equal((await env.store.markFailed(note.id, { error: 'late' }, SCOPE)).status, 409, 'a posted row is never re-settled');
    assert.equal((await readRow(env, note.id)).status, 'posted');
  } finally {
    env.restore();
  }
});

test('a `posting` row reads as a hand check once it is stale, or once the worker wrote why it could not tell', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  const fresh = { status: 'posting', posting_started_at: new Date(now - MINUTE).toISOString(), error: '' };
  assert.equal(require('../../lib/substackNotesStore.js').needsHandCheck(fresh, now), false);
  const stale = { ...fresh, posting_started_at: new Date(now - 11 * MINUTE).toISOString() };
  assert.equal(require('../../lib/substackNotesStore.js').needsHandCheck(stale, now), true);
  assert.equal(require('../../lib/substackNotesStore.js').needsHandCheck({ ...fresh, error: 'could not tell' }, now), true);
  assert.equal(require('../../lib/substackNotesStore.js').needsHandCheck({ ...stale, status: 'posted' }, now), false);
});
