'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Reddit comments 2/4 (86bch3jp3) — reading a Reddit post, writing a comment
 * on it in Dane's voice from his canon, and his approve / reject.
 *
 * The fake database reads its schema from the Reddit SQL files, in the order
 * they are run. The Reddit read, the Mini's sign-in check and the AI call are
 * stand-ins: every test says exactly what "Reddit" answered and what the
 * "model" wrote, so a rule can be shown to catch it.
 *
 * Since Outreach wizard 17/19 (86bcrmbuv) Add does not read Reddit itself: it
 * queues the read for the Mini's browser while the Mini is signed in, and the
 * worker writes the post back with markRead / markReadFailed.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SQL_FILES = ['reddit_comments_setup.sql', 'reddit_comments_posting.sql', 'reddit_comments_browser_read.sql'];
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const storePath = require.resolve('../../lib/redditCommentsStore.js');
const canonStorePath = require.resolve('../../lib/canonStore.js');
const reader = require('../../lib/redditPostReader.js');
const drafter = require('../../lib/redditCommentDrafter.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const POST_URL = 'https://www.reddit.com/r/Meditation/comments/1abc2de/how_do_you_keep_going/';
const COMMENT_URL = 'https://www.reddit.com/r/Meditation/comments/1abc2de/how_do_you_keep_going/kx9yz12/';
const GOOD = 'I lost the thread for most of a year and came back by sitting for two minutes, not twenty. The length mattered less than not skipping a day.';

/** The real format of wiki/aiism-blocklist.md (abridged): the parser is tested on its shape. */
const BLOCKLIST_MD = [
  '# AIism Blocklist',
  '',
  '## FENCE — never emit',
  '',
  '| Entry | Why it reads as machine |',
  '|---|---|',
  '| "load-bearing work" (and the "lives in / rests on" metaphor family) | Stock AI weight-metaphor. |',
  '| "Read that again." | LinkedIn-guru imperative. |',
  '| "deceptively simple" | Stock adjective pair. |',
  '| "...that matters" / "the X that matters" | Significance-flag. |',
  '| Balanced antithesis pairs ("more interesting than the hype, and more interesting than the doom") | Tic. |',
  '',
  '## RESTRICTED VOCABULARY',
  '',
  '| Word | Rule |',
  '|---|---|',
  '| "honest" | Use only when deception is the subject. |',
  '| "genuinely" | Sincerity-hedge. |',
  '',
  '## RATION',
  '',
  '| Entry | Allowance |',
  '|---|---|',
  '| "it turns out" | Once per episode, ever. |',
].join('\n');

const CANON = [
  { docKey: 'VOICE', title: 'Voice', body: '# Voice\nShort declaratives. Every sentence gets its predicate.', syncedAt: '2026-10-12T23:27:39.644Z' },
  { docKey: 'AIISM-BLOCKLIST', title: 'AIism Blocklist', body: BLOCKLIST_MD, syncedAt: '2026-10-12T22:47:41.063Z' },
  { docKey: 'DANE-OF-EARTH', title: 'Dane of Earth', body: '# Dane of Earth\nA stewardship ethic.', syncedAt: '2026-10-12T22:47:41.047Z' },
  { docKey: 'DEO', title: 'DEO', body: '# DEO\nThe organism thesis.', syncedAt: '2026-10-12T22:47:41.066Z' },
];

/** The SQL files, minus each one's trailing grant to the read-only login, which is not schema. */
function schemaText() {
  const grant = /\ndo \$\$[\s\S]*?end \$\$;\s*$/i;
  return SQL_FILES.map((file) => fs.readFileSync(path.join(SQL_DIR, file), 'utf8').replace(grant, '\n')).join('\n');
}

/**
 * `canonRows` is what 1/4's canon_documents table answers. It is a stub, not
 * the schema fake: that table's own tests are scripts/builder/canonStore.test.js,
 * and the fake does not parse its table-level unique constraint.
 */
function withDb({ canonRows = [] } = {}) {
  const db = createFakeDb(parseSchemaText(schemaText()));
  const canonQueries = [];
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ redditCommentItems: 'reddit_comment_items', canonDocuments: 'canon_documents' }),
    sbQuery: async (req) => {
      if (req.table !== 'canon_documents') return db.sbQuery(req);
      canonQueries.push(req);
      return { ok: true, status: 200, data: canonRows };
    },
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of [storePath, canonStorePath]) delete require.cache[p];
  const store = require(storePath);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of [storePath, canonStorePath]) delete require.cache[p];
  }
  return { db, store, restore, canonQueries };
}

/** A Response-like answer for the reader's fetch seam. */
function answer(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, text: async () => text, headers: { get: (k) => headers[k.toLowerCase()] || null } };
}

function listing({ title = 'How do you keep going?', selftext = 'I keep quitting after a week.', comments = [], extra = {} } = {}) {
  return [
    { kind: 'Listing', data: { children: [{ kind: 't3', data: { title, selftext, author: 'quietpond', subreddit: 'Meditation', permalink: '/r/Meditation/comments/1abc2de/how_do_you_keep_going/', ...extra } }] } },
    { kind: 'Listing', data: { children: comments.map((c) => ({ kind: 't1', data: c })) } },
  ];
}

function fakeReddit(response) {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push({ url, init });
    return typeof response === 'function' ? response(url) : response;
  };
  return { fetch, asked };
}

/** A "model" that answers with each of `replies` in turn, recording what it was asked. */
function scripted(...replies) {
  const asked = [];
  const generate = async (system, prompt) => {
    asked.push({ system, prompt });
    const next = replies[Math.min(asked.length - 1, replies.length - 1)];
    return typeof next === 'string' ? { ok: true, text: JSON.stringify({ text: next }) } : next;
  };
  return { generate, asked };
}

/** The Mini's last Reddit sign-in check, as getBrowserCheck answers it. */
function miniCheck(state = 'signed_in', { minutesAgo = 10, message = 'Signed in to Reddit as u/DaneOfEarth' } = {}) {
  const checkedAt = new Date(Date.now() - minutesAgo * 60000).toISOString();
  return async () => ({ ok: true, status: 200, data: { accountKey: 'dane_of_earth', state, message, checkedAt, signedInAt: checkedAt } });
}
const SIGNED_IN = { browserCheck: miniCheck() };

/** The post as the Mini's browser reads it (workers/youtube-outreach/adapters/reddit.js). */
const READ_POST = {
  subreddit: 'Meditation',
  title: 'How do you keep going?',
  body: 'I keep quitting after a week.',
  author: 'quietpond',
  comment: null,
  topComments: [{ id: 'c1', author: 'a', body: 'Two minutes a day.', score: 40 }],
};

/** Add a link while the Mini is signed in, then let "the Mini" read it. */
async function addFromReddit(store, scope = SCOPE_A, post = READ_POST) {
  const added = await store.addItem({ url: POST_URL }, scope, SIGNED_IN);
  assert.equal(added.ok, true, added.error);
  assert.equal(added.data.readState, 'reading');
  const read = await store.markRead(added.data.id, post, { projectId: scope.projectId });
  assert.equal(read.ok, true, read.error);
  return read.data;
}

// ── Reading the link ───────────────────────────────────────────────────────

test('parseRedditLink reads the post and comment ids from every Reddit link shape', () => {
  assert.deepEqual(reader.parseRedditLink(POST_URL).data, { postId: '1abc2de', commentId: '', subreddit: 'Meditation' });
  assert.deepEqual(reader.parseRedditLink(COMMENT_URL).data, { postId: '1abc2de', commentId: 'kx9yz12', subreddit: 'Meditation' });
  assert.equal(reader.parseRedditLink('old.reddit.com/r/Meditation/comments/1abc2de/x').data.postId, '1abc2de');
  assert.equal(reader.parseRedditLink('https://redd.it/1abc2de').data.postId, '1abc2de');

  const share = reader.parseRedditLink('https://www.reddit.com/r/Meditation/s/AbCdEf123');
  assert.equal(share.ok, false);
  assert.equal(share.code, 'SHARE_LINK');
  assert.match(share.error, /share link/);
  assert.match(reader.parseRedditLink('https://example.com/r/x/comments/1abc2de').error, /not a Reddit link/);
  assert.match(reader.parseRedditLink('https://www.reddit.com/r/Meditation/').error, /not to a post/);
});

test('readRedditPost returns the subreddit, title, body, author and top comments', async () => {
  const reddit = fakeReddit(answer(200, listing({ comments: [
    { id: 'c1', author: 'a', body: 'Two minutes a day.', score: 40 },
    { id: 'c2', author: 'b', body: '[removed]', score: 3 },
  ] })));
  const read = await reader.readRedditPost(POST_URL, { fetch: reddit.fetch });
  assert.equal(read.ok, true, read.error);
  assert.equal(read.data.subreddit, 'Meditation');
  assert.equal(read.data.title, 'How do you keep going?');
  assert.equal(read.data.body, 'I keep quitting after a week.');
  assert.equal(read.data.author, 'quietpond');
  assert.deepEqual(read.data.topComments, [{ author: 'a', body: 'Two minutes a day.', score: 40 }]);
  assert.match(reddit.asked[0].url, /^https:\/\/www\.reddit\.com\/comments\/1abc2de\.json\?raw_json=1/);
  assert.match(reddit.asked[0].init.headers['User-Agent'], /starcaster/);
});

test('readRedditPost reads the comment a comment link points at', async () => {
  const reddit = fakeReddit(answer(200, listing({ comments: [{ id: 'kx9yz12', author: 'replyto', body: 'I tried apps, none stuck.', score: 2 }] })));
  const read = await reader.readRedditPost(COMMENT_URL, { fetch: reddit.fetch });
  assert.equal(read.ok, true, read.error);
  assert.deepEqual(read.data.comment, { author: 'replyto', body: 'I tried apps, none stuck.', score: 2 });
  assert.match(reddit.asked[0].url, /\/comments\/1abc2de\/_\/kx9yz12\.json/);
});

test('every refusal from Reddit is a plain sentence naming which one it was', async () => {
  const cases = [
    [answer(403, '<html>You\'ve been blocked by network security.</html>'), 'REDDIT_BLOCKED', /blocked this server/],
    [answer(404, { message: 'Not Found', error: 404 }), 'REDDIT_NOT_FOUND', /no such post \(404\)/],
    [answer(403, { reason: 'private', message: 'Forbidden' }), 'REDDIT_PRIVATE', /subreddit is private/],
    [answer(429, 'Too Many Requests'), 'REDDIT_RATE_LIMITED', /rate-limiting/],
    [answer(302, '', { location: 'https://www.reddit.com/login/?dest=x' }), 'REDDIT_LOGIN_REQUIRED', /without a login/],
    [answer(200, listing({ selftext: '[removed]', extra: { removed_by_category: 'moderator' } })), 'REDDIT_REMOVED', /removed \(by moderator\)/],
    [answer(200, listing({ selftext: '[deleted]', extra: { author: '[deleted]' } })), 'REDDIT_DELETED', /deleted by its author/],
    [answer(200, '<html>not json</html>'), 'REDDIT_NOT_A_POST', /not with a post/],
  ];
  for (const [response, code, message] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const read = await reader.readRedditPost(POST_URL, { fetch: fakeReddit(response).fetch });
    assert.equal(read.ok, false, code);
    assert.equal(read.code, code);
    assert.match(read.error, message);
  }
  const down = await reader.readRedditPost(POST_URL, { fetch: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal(down.code, 'REDDIT_UNREACHABLE');
  assert.match(down.error, /could not be reached \(ENOTFOUND\)/);
});

// ── Adding ─────────────────────────────────────────────────────────────────

test('adding a link while the Mini is signed in saves it as reading; the Mini\'s read fills in the post, with both tenant columns', async () => {
  const { db, store, restore } = withDb();
  try {
    const queued = await store.addItem({ url: POST_URL }, SCOPE_A, SIGNED_IN);
    assert.equal(queued.ok, true, queued.error);
    assert.equal(queued.status, 201);
    assert.equal(queued.data.readState, 'reading');
    assert.equal(queued.data.postTitle, '', 'nothing is read on the server');
    assert.ok(queued.data.readRequestedAt);
    assert.deepEqual((await store.listPendingReads(10, { projectId: 'proj_a' })).data.map((i) => i.id), [queued.data.id]);
    assert.equal((await store.listPendingReads(10, { projectId: 'proj_b' })).data.length, 0, 'another project\'s reads are not offered');
    const early = await store.writeDraftForItem(queued.data.id, SCOPE_A, { generate: scripted(GOOD).generate, canonDocs: CANON });
    assert.equal(early.status, 409);
    assert.match(early.error, /still reading this post/);

    const read = await store.markRead(queued.data.id, READ_POST, { projectId: 'proj_a' });
    assert.equal(read.ok, true, read.error);
    const item = read.data;
    assert.equal(item.readState, '');
    assert.ok(item.readFinishedAt);
    assert.deepEqual(item.topComments, [{ id: 'c1', author: 'a', body: 'Two minutes a day.', score: 40 }]);
    assert.equal((await store.listPendingReads(10, { projectId: 'proj_a' })).data.length, 0);
    assert.equal((await store.markRead(item.id, READ_POST, { projectId: 'proj_a' })).status, 409, 'a read lands once');
    assert.equal(item.status, 'idea');
    assert.equal(item.subreddit, 'Meditation');
    assert.equal(item.postTitle, 'How do you keep going?');
    assert.equal(item.postBody, 'I keep quitting after a week.');
    assert.equal(item.postReadFrom, 'reddit');
    assert.equal(item.targetUrl, 'https://www.reddit.com/r/Meditation/comments/1abc2de/');
    const [row] = db.data.get('reddit_comment_items');
    assert.equal(row.project_id, 'proj_a');
    assert.equal(row.owner_user_id, 'user_1');

    // Another project cannot see it.
    assert.equal((await store.getItemById(item.id, SCOPE_B)).status, 404);
    assert.equal((await store.listItems(50, SCOPE_B)).data.length, 0);
    assert.equal((await store.listItems(50, SCOPE_A)).data.length, 1);
  } finally {
    restore();
  }
});

test('BREAK TEST: with the Mini signed out, Add saves nothing, says so, and accepts the post pasted by hand', async () => {
  const { store, restore } = withDb();
  try {
    let asked = 0;
    const signedOut = miniCheck('signed_out', { message: 'The Mini\'s Reddit browser is signed out' });
    const browserCheck = async () => { asked += 1; return signedOut(); };
    const refused = await store.addItem({ url: POST_URL }, SCOPE_A, { browserCheck });
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 409);
    assert.equal(refused.code, 'POST_TEXT_NEEDED');
    assert.equal(refused.readerCode, 'MINI_SIGNED_OUT');
    assert.match(refused.error, /^The Mini is not signed in to Reddit \(The Mini's Reddit browser is signed out\), so it cannot read the post\. Paste the post's title and text instead\.$/);
    assert.equal((await store.listItems(50, SCOPE_A)).data.length, 0, 'nothing is saved while the Mini cannot read');

    const pasted = await store.addItem({ url: POST_URL, postTitle: 'How do you keep going?', postBody: 'I keep quitting.' }, SCOPE_A, { browserCheck });
    assert.equal(pasted.ok, true, pasted.error);
    assert.equal(pasted.data.postReadFrom, 'pasted');
    assert.equal(pasted.data.readState, '');
    assert.equal(pasted.data.subreddit, 'Meditation');
    assert.equal(asked, 1, 'a pasted post does not ask the Mini');

    const commentNoParent = await store.addItem({ url: COMMENT_URL, postTitle: 'T', postBody: 'B' }, SCOPE_A, { browserCheck });
    assert.match(commentNoParent.error, /paste the comment being replied to/);
  } finally {
    restore();
  }
});

test('Add refuses a missing project or user before reading anything', async () => {
  const { store, restore } = withDb();
  try {
    let read = 0;
    const browserCheck = async () => { read += 1; return { ok: false }; };
    assert.match((await store.addItem({ url: POST_URL }, { projectId: 'proj_a' }, { browserCheck })).error, /both tenant columns/);
    assert.match((await store.addItem({ url: POST_URL }, { userId: 'u' }, { browserCheck })).error, /No project/);
    assert.equal(read, 0);
  } finally {
    restore();
  }
});

test('the Mini is only asked to read when its last check says signed in, recently — every other answer names why', async () => {
  const { store, restore } = withDb();
  try {
    const cases = [
      [miniCheck('signed_in', { minutesAgo: 30 }), null],
      [miniCheck('signed_in', { minutesAgo: 3 * 60 }), /last checked its Reddit sign-in 3 hours ago, so its worker may have stopped/],
      [miniCheck('wrong_account', { message: 'Signed in as u/someoneelse.' }), /not signed in to Reddit \(Signed in as u\/someoneelse\)/],
      [miniCheck('gateway_down', { message: 'OpenClaw did not answer' }), /not signed in to Reddit \(OpenClaw did not answer\)/],
      [async () => ({ ok: true, data: { state: '', checkedAt: null } }), /has never checked its Reddit sign-in — its worker may not be running/],
      [async () => ({ ok: false, error: 'relation "reddit_comment_settings" does not exist' }), /could not be read \(relation "reddit_comment_settings" does not exist\)/],
    ];
    for (const [browserCheck, refusal] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const verdict = await store.miniCanRead(SCOPE_A, { browserCheck });
      if (!refusal) assert.equal(verdict.ok, true);
      else {
        assert.equal(verdict.ok, false);
        assert.match(verdict.error, refusal);
        assert.match(verdict.error, /Paste the post's title and text instead\.$/);
      }
    }
  } finally {
    restore();
  }
});

test('a removed post says "Reddit says this post was removed"; the post can then be pasted onto it, or read again', async () => {
  const { store, restore } = withDb();
  try {
    const added = await store.addItem({ url: POST_URL }, SCOPE_A, SIGNED_IN);
    const failed = await store.markReadFailed(added.data.id, { code: 'REDDIT_REMOVED', error: 'Reddit says this post was removed (by moderators), so there is nothing to answer.' }, { projectId: 'proj_a' });
    assert.equal(failed.ok, true, failed.error);
    assert.equal(failed.data.readState, 'failed');
    assert.equal(failed.data.readCode, 'REDDIT_REMOVED');
    assert.match(failed.data.readError, /^Reddit says this post was removed/);
    assert.match((await store.writeDraftForItem(added.data.id, SCOPE_A, { generate: scripted(GOOD).generate, canonDocs: CANON })).error, /could not read this post/);

    // Try again: only while the Mini is signed in, and only from failed.
    const stillOut = await store.readAgain(added.data.id, SCOPE_A, { browserCheck: miniCheck('signed_out') });
    assert.equal(stillOut.code, 'POST_TEXT_NEEDED');
    const again = await store.readAgain(added.data.id, SCOPE_A, SIGNED_IN);
    assert.equal(again.ok, true, again.error);
    assert.equal(again.data.readState, 'reading');
    assert.equal(again.data.readError, '');
    assert.equal((await store.readAgain(added.data.id, SCOPE_A, SIGNED_IN)).status, 409);

    // Pasted while the Mini is still reading: the paste wins, and the late read is refused.
    assert.match((await store.pasteForItem(added.data.id, {}, SCOPE_A)).error, /title or its text/);
    const pasted = await store.pasteForItem(added.data.id, { postTitle: 'How do you keep going?', postBody: 'I keep quitting.' }, SCOPE_A);
    assert.equal(pasted.ok, true, pasted.error);
    assert.equal(pasted.data.readState, '');
    assert.equal(pasted.data.postReadFrom, 'pasted');
    assert.equal(pasted.data.postTitle, 'How do you keep going?');
    assert.equal((await store.markRead(added.data.id, READ_POST, { projectId: 'proj_a' })).status, 409, 'the Mini does not overwrite a paste');
    assert.equal((await store.pasteForItem(added.data.id, { postTitle: 'x' }, SCOPE_A)).status, 409);
    assert.equal((await store.pasteForItem(added.data.id, { postTitle: 'x' }, SCOPE_B)).status, 404, 'another project cannot paste onto it');

    // A comment link needs the comment pasted too.
    const reply = await store.addItem({ url: COMMENT_URL }, SCOPE_A, SIGNED_IN);
    assert.match((await store.pasteForItem(reply.data.id, { postTitle: 'T', postBody: 'B' }, SCOPE_A)).error, /paste the comment being replied to/);
    const replyPasted = await store.pasteForItem(reply.data.id, { postTitle: 'T', postBody: 'B', parentCommentText: 'I tried apps.' }, SCOPE_A);
    assert.equal(replyPasted.data.parentCommentText, 'I tried apps.');
  } finally {
    restore();
  }
});

// ── The rules, on their own ────────────────────────────────────────────────

test('parseBlocklist reads the FENCE and RESTRICTED phrases and nothing else', () => {
  assert.deepEqual(drafter.parseBlocklist(BLOCKLIST_MD), [
    'load-bearing work', 'Read that again', 'deceptively simple', 'that matters', 'honest', 'genuinely',
  ]);
});

test('checkCommentText catches links and every project name, in any spacing, unless Dane added them', () => {
  const blocked = drafter.parseBlocklist(BLOCKLIST_MD);
  assert.equal(drafter.checkCommentText(GOOD, { blocked }).ok, true);
  for (const bad of ['Check out Dane of Earth', 'see daneofearth on youtube', 'DEO explains it', 'I use Star Caster', 'isitas', 'WaveCenter', 'Alphire built it']) {
    const checked = drafter.checkCommentText(bad, { blocked });
    assert.deepEqual(checked.problems.map((p) => p.rule), ['self_promotion'], bad);
    assert.match(checked.problems[0].message, /never mention Dane's own projects/);
    assert.equal(drafter.checkCommentText(bad, { blocked, allowSelfPromotion: true }).ok, true, bad);
  }
  const link = drafter.checkCommentText('More at example.com', { blocked });
  assert.match(link.problems[0].message, /contains a link \(example\.com\)/);
  // Whole words only: "video" is not "DEO", "rodeo" is not "DEO".
  assert.equal(drafter.checkCommentText('A rodeo video, deodorant too.', { blocked }).ok, true);

  const aiism = drafter.checkCommentText('It is deceptively simple and genuinely hard.', { blocked });
  assert.deepEqual(aiism.problems.map((p) => p.rule), ['aiism']);
  assert.match(aiism.problems[0].message, /"deceptively simple", "genuinely", which are on the AI-ism blocklist/);

  const long = drafter.checkCommentText('a'.repeat(10001), { blocked });
  assert.match(long.problems[0].message, /10001 characters, and Reddit allows at most 10000/);
});

test('the prompt carries the voice and blocklist as rules, the rest as background, and the post itself', () => {
  const canon = drafter.prepareCanon(CANON);
  const { system, prompt } = drafter.buildPrompt({ post: { subreddit: 'Meditation', title: 'How?', body: 'I quit.', author: 'q', topComments: [{ author: 'a', body: 'Two minutes.' }] }, canon });
  assert.match(system, /HOW DANE WRITES[\s\S]*Every sentence gets its predicate/);
  assert.match(system, /deceptively simple/);
  assert.match(system, /background only[\s\S]*answers THIS post/);
  assert.match(system, /A stewardship ethic/);
  assert.match(system, /No links/);
  assert.match(prompt, /r\/Meditation/);
  assert.match(prompt, /Post title: How\?/);
  assert.match(prompt, /u\/a: Two minutes\./);
  assert.match(prompt, /top-level comment/);
});

// ── Drafting ───────────────────────────────────────────────────────────────

test('a draft records which canon documents it was written from, and their sync dates', async () => {
  const { store, restore } = withDb();
  try {
    const item = await addFromReddit(store);
    const model = scripted(GOOD);
    const drafted = await store.writeDraftForItem(item.id, SCOPE_A, { generate: model.generate, canonDocs: CANON });
    assert.equal(drafted.ok, true, drafted.error);
    assert.equal(drafted.data.status, 'draft');
    assert.equal(drafted.data.draftText, GOOD);
    assert.deepEqual(drafted.data.canonUsed, CANON.map((d) => ({ docKey: d.docKey, syncedAt: d.syncedAt })));
    // Read back from the database, not the write's echo.
    assert.deepEqual((await store.getItemById(item.id, SCOPE_A)).data.canonUsed.map((d) => d.docKey), ['VOICE', 'AIISM-BLOCKLIST', 'DANE-OF-EARTH', 'DEO']);
  } finally {
    restore();
  }
});

test('BREAK TEST: a model that says "check out Dane of Earth" twice is refused with that rule named, and nothing is saved', async () => {
  const { store, restore } = withDb();
  try {
    const item = await addFromReddit(store);
    const model = scripted('Great question! check out Dane of Earth', 'Really, check out Dane of Earth');
    const drafted = await store.writeDraftForItem(item.id, SCOPE_A, { generate: model.generate, canonDocs: CANON });
    assert.equal(drafted.ok, false);
    assert.equal(drafted.status, 422);
    assert.match(drafted.error, /names Dane of Earth.*no self-promotion unless Dane adds it/);
    assert.equal(model.asked.length, 2, 'one retry, then refused');
    assert.match(model.asked[1].prompt, /Your last draft broke these rules: it names Dane of Earth/);
    const after = (await store.getItemById(item.id, SCOPE_A)).data;
    assert.equal(after.status, 'idea');
    assert.equal(after.draftText, '');
  } finally {
    restore();
  }
});

test('a model that uses a blocklisted phrase twice is refused with the phrase named, and nothing is saved (Outreach wizard 8/19)', async () => {
  const { store, restore } = withDb();
  try {
    const item = await addFromReddit(store);
    const model = scripted('It is deceptively simple to sit still.');
    const drafted = await store.writeDraftForItem(item.id, SCOPE_A, { generate: model.generate, canonDocs: CANON });
    assert.equal(drafted.status, 422);
    assert.match(drafted.error, /"deceptively simple", which is on the AI-ism blocklist/);
    assert.equal(model.asked.length, 2, 'one retry, then refused');
    assert.equal((await store.getItemById(item.id, SCOPE_A)).data.status, 'idea');
  } finally {
    restore();
  }
});

test('a draft that breaks a rule once and keeps them the second time is kept', async () => {
  const { store, restore } = withDb();
  try {
    const item = await addFromReddit(store);
    const model = scripted('Read more at daneofearth.org', GOOD);
    const drafted = await store.writeDraftForItem(item.id, SCOPE_A, { generate: model.generate, canonDocs: CANON });
    assert.equal(drafted.ok, true, drafted.error);
    assert.equal(drafted.data.draftText, GOOD);
  } finally {
    restore();
  }
});

test('with no canon copied, no draft is written and the AI is never asked', async () => {
  const { store, restore } = withDb();
  try {
    const item = await addFromReddit(store);
    const model = scripted(GOOD);
    const empty = await store.writeDraftForItem(item.id, SCOPE_A, { generate: model.generate, canonDocs: [] });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /no canon copied yet — run npm run canon:sync/);
    const noVoice = await store.writeDraftForItem(item.id, SCOPE_A, { generate: model.generate, canonDocs: CANON.filter((d) => d.docKey !== 'VOICE') });
    assert.match(noVoice.error, /no VOICE document/);
    assert.equal(model.asked.length, 0);

    // The real canon read: an empty canon_documents table is the same refusal.
    const fromDb = await store.writeDraftForItem(item.id, SCOPE_A, { generate: model.generate });
    assert.match(fromDb.error, /no canon copied yet — run npm run canon:sync/);
  } finally {
    restore();
  }
});

// ── Approval ───────────────────────────────────────────────────────────────

async function draftedItem(store) {
  const item = await addFromReddit(store);
  const drafted = await store.writeDraftForItem(item.id, SCOPE_A, { generate: scripted(GOOD).generate, canonDocs: CANON });
  assert.equal(drafted.ok, true, drafted.error);
  return drafted.data;
}

test('approving Dane\'s edit that adds a link and a project name is accepted — he added it', async () => {
  const { store, restore } = withDb();
  try {
    const item = await draftedItem(store);
    const text = `${GOOD} I wrote about it on Dane of Earth: https://daneofearth.org/sitting`;
    const approved = await store.approveItem(item.id, { text }, SCOPE_A, { canonDocs: CANON });
    assert.equal(approved.ok, true, approved.error);
    assert.equal(approved.data.status, 'approved');
    assert.equal(approved.data.finalText, text);
    assert.equal(approved.data.approvedBy, 'user_1');
    assert.ok(approved.data.approvedAt);
  } finally {
    restore();
  }
});

test('approving an edit with a blocklisted phrase is refused with the phrase named, and it stays a draft', async () => {
  const { store, restore } = withDb();
  try {
    const item = await draftedItem(store);
    const refused = await store.approveItem(item.id, { text: `${GOOD} It is deceptively simple.` }, SCOPE_A, { canonDocs: CANON });
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 422);
    assert.match(refused.error, /Not approved: it uses "deceptively simple", which is on the AI-ism blocklist/);
    assert.equal((await store.getItemById(item.id, SCOPE_A)).data.status, 'draft');
  } finally {
    restore();
  }
});

test('approve without text approves the draft; reject keeps the draft; the status path is enforced', async () => {
  const { store, restore } = withDb();
  try {
    const item = await draftedItem(store);
    const approved = await store.approveItem(item.id, {}, SCOPE_A, { canonDocs: CANON });
    assert.equal(approved.data.finalText, GOOD);
    const again = await store.approveItem(item.id, {}, SCOPE_A, { canonDocs: CANON });
    assert.equal(again.status, 409);

    const rejected = await store.rejectItem(item.id, SCOPE_A);
    assert.equal(rejected.data.status, 'rejected');
    assert.equal(rejected.data.draftText, GOOD);
    assert.equal(rejected.data.approvedBy, '');
    assert.equal((await store.rejectItem(item.id, SCOPE_A)).status, 409);

    const idea = await addFromReddit(store);
    assert.match((await store.approveItem(idea.id, {}, SCOPE_A, { canonDocs: CANON })).error, /is idea, not a draft/);
    const skip = await store.moveIfStatus(idea, { status: 'posted' }, SCOPE_A);
    assert.match(skip.error, /cannot move from idea to posted — from idea it can go to draft, rejected/);
  } finally {
    restore();
  }
});

test('drafting reads the canon from the database, scoped to the project', async () => {
  const canonRows = CANON.map((d) => ({ id: d.docKey, project_id: 'proj_a', owner_user_id: 'user_1', doc_key: d.docKey, title: d.title, body: d.body, synced_at: d.syncedAt }));
  const { store, restore, canonQueries } = withDb({ canonRows });
  try {
    const item = await addFromReddit(store);
    const drafted = await store.writeDraftForItem(item.id, SCOPE_A, { generate: scripted(GOOD).generate });
    assert.equal(drafted.ok, true, drafted.error);
    assert.deepEqual(drafted.data.canonUsed[0], { docKey: 'VOICE', syncedAt: '2026-10-12T23:27:39.644Z' });
    assert.match(canonQueries[0].query, /project_id=eq\.proj_a/);
  } finally {
    restore();
  }
});
