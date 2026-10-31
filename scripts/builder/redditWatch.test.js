'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Outreach wizard 18/19 (task 86bcrmbwm) — Reddit finds conversations on its
 * own: the subreddit list, the Mini's four-hourly watch, the ranked list with
 * its reasons and promotion rules, and the stage that says "signed out"
 * rather than "0 found".
 *
 * The fake database reads its schema FROM docs/SQL/reddit_watch_setup.sql, so
 * a column dropped from the SQL — owner_user_id included (landmine 12) — fails
 * here.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const ALL = [
  '../../lib/redditWatchStore.js', '../../lib/redditConversations.js',
  '../../lib/acquire/RedditWatchDue.js', '../../lib/acquire/RedditSubredditSuggest.js',
  '../../lib/outreachOverview.js', '../../routes/outreach.js',
].map((p) => require.resolve(p));

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };
const OTHER = { projectId: 'proj_b', userId: 'user_2' };
const NOW = Date.parse('2026-10-28T15:00:00Z');
const HOUR = 60 * 60 * 1000;
const CANON = [{ docKey: 'DANE-OF-EARTH', title: 'Thesis', body: 'polymath polymath polymath curiosity curiosity curiosity renaissance renaissance renaissance' }];

function withDb() {
  const sql = fs.readFileSync(path.join(SQL_DIR, 'reddit_watch_setup.sql'), 'utf8');
  const db = createFakeDb(parseSchemaText(sql));
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      isConfigured: () => true,
      tableConfig: () => ({ redditWatchSubreddits: 'reddit_watch_subreddits', redditWatchPosts: 'reddit_watch_posts' }),
      sbQuery: db.sbQuery,
    },
  };
  for (const p of ALL) delete require.cache[p];
  const store = require('../../lib/redditWatchStore.js');
  const due = require('../../lib/acquire/RedditWatchDue.js');
  const conv = require('../../lib/redditConversations.js');
  const suggest = require('../../lib/acquire/RedditSubredditSuggest.js');
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of ALL) delete require.cache[p];
  }
  return { db, store, due, conv, suggest, restore };
}

async function approve(store, names, scope = SCOPE) {
  const added = await store.addSubreddits(names, scope);
  assert.equal(added.ok, true, added.error);
  for (const s of added.data.added) {
    // eslint-disable-next-line no-await-in-loop
    const d = await store.decideSubreddit(s.id, 'approved', scope);
    assert.equal(d.ok, true, d.error);
  }
  return added.data.added;
}

/** A stand-in OpenClaw: the listing visit and the post visit, by what they ask for. */
function fakeBrowser({ signedIn = true, listing, comments } = {}) {
  const calls = [];
  return {
    calls,
    callOpenClaw: async (req) => {
      calls.push(req.input);
      if (/\/new\/ and wait/.test(req.input)) {
        if (!signedIn) return { ok: true, text: '{"signedIn": false}' };
        const sub = req.input.match(/\/r\/([a-z0-9_]+)\/new\//)[1];
        return { ok: true, text: JSON.stringify(listing ? listing(sub) : { signedIn: true, found: true, promotionRule: '', new: [], rising: [] }) };
      }
      return { ok: true, text: JSON.stringify(comments || { signedIn: true, found: true, title: 'x', body: '', author: 'a', topComments: [] }) };
    },
    extractJson: (raw) => { try { return JSON.parse(raw); } catch { return null; } },
  };
}

function stubComments(items = []) {
  return { listItems: async () => ({ ok: true, data: items }) };
}
function stubFeedback(skipped = []) {
  return {
    listDecidedItemIds: async () => ({ ok: true, data: skipped }),
    readRejectInput: (x) => ({ ok: true, data: { reasons: x.reasons || [], note: x.note || '' } }),
    recordFeedback: async (row) => { skipped.push(row.itemId); return { ok: true, data: row }; },
  };
}

test('subredditName accepts r/, links and bare names, and refuses what Reddit would not', () => {
  const { store, restore } = withDb();
  try {
    assert.equal(store.subredditName('r/Philosophy'), 'philosophy');
    assert.equal(store.subredditName('https://www.reddit.com/r/AskHistorians/'), 'askhistorians');
    assert.equal(store.subredditName('slatestarcodex'), 'slatestarcodex');
    assert.equal(store.subredditName('a'), '');
    assert.equal(store.subredditName('has space'), '');
  } finally { restore(); }
});

test('subreddits: added with both tenant columns, decisions stick, and a re-suggestion never undoes a rejection', async () => {
  const { db, store, restore } = withDb();
  try {
    const added = await store.addSubreddits([{ name: 'r/polymath', why: 'fits' }, 'philosophy', 'not a name!'], SCOPE, { suggestedBy: 'ai' });
    assert.equal(added.ok, true, added.error);
    assert.equal(added.data.added.length, 2);
    assert.equal(added.data.refused.length, 1);
    const rows = db.data.get('reddit_watch_subreddits');
    assert.ok(rows.every((r) => r.project_id === 'proj_a' && r.owner_user_id === 'user_1'), 'both tenant columns stamped');

    const phil = added.data.added.find((s) => s.name === 'philosophy');
    const rejected = await store.decideSubreddit(phil.id, 'rejected', SCOPE);
    assert.equal(rejected.data.status, 'rejected');
    const again = await store.addSubreddits(['philosophy'], SCOPE, { suggestedBy: 'ai' });
    assert.deepEqual(again.data.kept, ['philosophy']);
    const listed = await store.listSubreddits(100, SCOPE);
    assert.equal(listed.data.find((s) => s.name === 'philosophy').status, 'rejected');

    // Another project sees none of it.
    const other = await store.listSubreddits(100, OTHER);
    assert.equal(other.data.length, 0);
    const cross = await store.decideSubreddit(phil.id, 'approved', OTHER);
    assert.equal(cross.ok, false);
  } finally { restore(); }
});

test('the watch keeps keyword and canon matches, records the promotion rule, and reads the best posts\' comments', async () => {
  const { store, due, restore } = withDb();
  try {
    await approve(store, ['polymath', 'philosophy', 'zen']);
    const browser = fakeBrowser({
      listing: (sub) => ({
        signedIn: true,
        found: true,
        promotionRule: sub === 'polymath' ? 'No self-promotion more than 1 in 10 posts.' : '',
        new: [
          { id: `${sub}1`.slice(0, 12), title: 'How do generalists learn?', body: 'Being a generalist in tech', author: 'u/alice', postedAt: new Date(NOW - 2 * HOUR).toISOString(), score: 12, comments: 8 },
          { id: `${sub}2`.slice(0, 12), title: 'Cat picture', body: '', author: 'bob', postedAt: new Date(NOW - HOUR).toISOString(), score: 900, comments: 50 },
          { id: `${sub}3`.slice(0, 12), title: 'Polymath curiosity', body: 'renaissance thinking', author: 'carol', postedAt: null, score: 3, comments: 1 },
        ],
        rising: [],
      }),
      comments: { signedIn: true, found: true, title: 'x', body: '', author: 'alice', topComments: [{ id: 'c1', author: 'dave', body: 'Great question', score: 40 }, { id: 'c2', author: 'erin', body: 'I agree', score: 5 }] },
    });
    const run = await due.runRedditWatchDue({
      callOpenClaw: browser.callOpenClaw,
      extractJson: browser.extractJson,
      readKeywords: async () => ({ ok: true, data: ['generalist'] }),
      canonDocs: CANON,
      now: () => NOW,
    });
    assert.equal(run.ok, true, run.error);
    assert.equal(run.data.read, 2, 'two subreddits a pass, never all of them');
    assert.equal(run.data.failed, 0);

    const subs = (await store.listSubreddits(100, SCOPE)).data;
    const poly = subs.find((s) => s.name === 'polymath');
    assert.equal(poly.lastReadState, 'read');
    assert.equal(poly.lastReadSeen, 3);
    assert.equal(poly.lastReadKept, 2, 'the cat picture matches nothing and is not kept');
    assert.equal(poly.promotionRule, 'No self-promotion more than 1 in 10 posts.');
    assert.equal(subs.filter((s) => s.lastReadState === '').length, 1, 'the third waits for the next pass');

    const posts = (await store.listPosts(100, SCOPE)).data;
    assert.equal(posts.length, 4);
    assert.ok(posts.some((p) => p.keyword === 'generalist'));
    assert.ok(posts.some((p) => p.topComments.length === 2 && p.topComments[0].author === 'dave'), 'strongest comment first, with its author');

    // The next pass reads the one left over first.
    const second = await due.runRedditWatchDue({
      callOpenClaw: browser.callOpenClaw, extractJson: browser.extractJson,
      readKeywords: async () => ({ ok: true, data: ['generalist'] }), canonDocs: CANON, now: () => NOW + 4 * HOUR,
    });
    assert.equal(second.data.read, 2);
    assert.equal((await store.listSubreddits(100, SCOPE)).data.find((s) => s.name === 'zen').lastReadState, 'read');
  } finally { restore(); }
});

test('signed out is a failure recorded on the subreddit, and the rest of the project\'s pass stops', async () => {
  const { store, due, restore } = withDb();
  try {
    await approve(store, ['polymath', 'philosophy']);
    const browser = fakeBrowser({ signedIn: false });
    const run = await due.runRedditWatchDue({
      callOpenClaw: browser.callOpenClaw, extractJson: browser.extractJson,
      readKeywords: async () => ({ ok: true, data: ['x'] }), canonDocs: CANON, now: () => NOW,
    });
    assert.equal(run.data.read, 0);
    assert.equal(run.data.failed, 1);
    assert.equal(browser.calls.length, 1, 'one signed-out answer is enough; the second read would say the same');
    const subs = (await store.listSubreddits(100, SCOPE)).data;
    assert.equal(subs.filter((s) => s.lastReadState === 'signed_out').length, 1);
    assert.match(due.formatWatchLog(run.data), /SIGNED OUT/);
  } finally { restore(); }
});

/**
 * OpenClaw behind the REAL daily-limit gate (lib/openclawResponsesClient.js →
 * lib/miniAiLimit.js checkRequest), with today's count already at the limit.
 * Anything that slips past the gate reaches `fetch` and fails the test.
 */
function limitReached() {
  const client = require('../../lib/openclawResponsesClient.js');
  const posts = [];
  const limitDeps = {
    node: 'mac-mini',
    readAlarm: async () => ({ ok: true, data: { exists: true, miniDailyRequests: 1 } }),
    readCalls: async () => ({ ok: true, data: [{ created_at: new Date().toISOString(), metadata: { job: 'starcaster:openclaw-smoke' } }] }),
    claimPost: async () => ({ ok: true, data: posts.length === 0 }),
    releasePost: async () => ({ ok: true }),
    postBus: async (t) => { posts.push(t); return { ok: true }; },
  };
  return { posts, callOpenClaw: (req) => client.callOpenClawResponses({ ...req, limitDeps }) };
}

test('THE MINI\'S DAILY AI LIMIT stops the watch: nothing is marked failed, the last good reading stays, and it is not counted as a failure', async () => {
  const { store, due, restore } = withDb();
  const savedFetch = global.fetch;
  global.fetch = async () => { throw new Error('the limit should have refused this before it was sent'); };
  try {
    await approve(store, ['polymath', 'philosophy', 'zen']);
    // A good reading first, so there is something the limit must not replace.
    const browser = fakeBrowser();
    const first = await due.runRedditWatchDue({
      callOpenClaw: browser.callOpenClaw, extractJson: browser.extractJson,
      readKeywords: async () => ({ ok: true, data: ['x'] }), canonDocs: CANON, now: () => NOW,
    });
    assert.equal(first.data.read, 2, first.error);
    const before = (await store.listSubreddits(100, SCOPE)).data;

    const gate = limitReached();
    const run = await due.runRedditWatchDue({
      callOpenClaw: gate.callOpenClaw, extractJson: browser.extractJson,
      readKeywords: async () => ({ ok: true, data: ['x'] }), canonDocs: CANON, now: () => NOW + 4 * HOUR,
    });
    assert.equal(run.ok, true, run.error);
    assert.equal(run.data.read, 0);
    assert.equal(run.data.failed, 0, 'the brake is not a broken job: no "reddit-watch failed" alarm');
    assert.match(run.data.stoppedForToday, /^Stopped for today: the Mini's AI limit \(1 request\)/);
    assert.deepEqual(run.data.projects[0].subreddits, [], 'no subreddit is reported as read or failed');
    assert.deepEqual((await store.listSubreddits(100, SCOPE)).data, before, 'nothing written to any subreddit');
    assert.equal(gate.posts.length, 1, 'the limit posts its own one line');
    const log = due.formatWatchLog(run.data);
    assert.match(log, /STOPPED — Stopped for today/);
    assert.match(log, /No subreddit was marked failed/);
    assert.doesNotMatch(log, /READ FAILED|no beat is recorded/);
  } finally { global.fetch = savedFetch; restore(); }
});

test('THE MINI\'S DAILY AI LIMIT reached while reading comments: the subreddit read is kept and the pass stops there', async () => {
  const { store, due, restore } = withDb();
  try {
    await approve(store, ['polymath', 'philosophy']);
    const browser = fakeBrowser({
      listing: (sub) => ({
        signedIn: true, found: true, promotionRule: '', rising: [],
        new: [{ id: `${sub}1`.slice(0, 12), title: 'How do generalists learn?', body: 'a generalist', author: 'a', postedAt: new Date(NOW - HOUR).toISOString(), score: 5, comments: 3 }],
      }),
    });
    const sentence = 'Stopped for today: the Mini\'s AI limit (40 requests) was reached at 3:12 AM.';
    const calls = [];
    const callOpenClaw = async (req) => {
      calls.push(req.input);
      // The listing goes through; the limit is reached on the comments read.
      return calls.length === 1 ? browser.callOpenClaw(req) : { ok: false, status: 429, code: 'MINI_AI_LIMIT', error: sentence };
    };
    const run = await due.runRedditWatchDue({
      callOpenClaw, extractJson: browser.extractJson,
      readKeywords: async () => ({ ok: true, data: ['generalist'] }), canonDocs: CANON, now: () => NOW,
    });
    assert.equal(run.data.read, 1, 'the listing was really read, and is recorded');
    assert.equal(run.data.failed, 0);
    assert.equal(run.data.stoppedForToday, sentence);
    assert.equal(calls.length, 2, 'the second subreddit is not asked for: it would be refused too');
    const subs = (await store.listSubreddits(100, SCOPE)).data;
    assert.equal(subs.filter((s) => s.lastReadState === 'read').length, 1);
    assert.equal(subs.filter((s) => s.lastReadState === 'failed').length, 0);
    assert.equal(subs.filter((s) => s.lastReadState === '').length, 1, 'the other waits for tomorrow');
  } finally { restore(); }
});

test('reddit_watch_due exits 5 (no beat, no failure post) when the limit stopped it, and run_reddit_watch.sh treats 5 like 4', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'reddit_watch_due.mjs'), 'utf8');
  assert.match(script, /const STOPPED_FOR_TODAY = 5;/);
  assert.match(script, /process\.exit\(run\.data\.stoppedForToday \? STOPPED_FOR_TODAY : NOTHING_READ\)/);
  const runner = fs.readFileSync(path.join(__dirname, '..', 'run_reddit_watch.sh'), 'utf8');
  const branch = runner.match(/elif \[ "\$status" -eq 5 \]; then\n([^\n]*)\n/);
  assert.ok(branch, 'run_reddit_watch.sh has its own branch for exit 5');
  assert.doesNotMatch(branch[1], /report:failure|heartbeat/);
});

test('a pass with no watched project reads nothing and says no beat is recorded', async () => {
  const { due, restore } = withDb();
  try {
    const run = await due.runRedditWatchDue({ now: () => NOW, callOpenClaw: async () => { throw new Error('must not be called'); } });
    assert.equal(run.data.read, 0);
    assert.equal(run.data.failed, 0);
    assert.match(due.formatWatchLog(run.data), /no beat is recorded/);
  } finally { restore(); }
});

test('the ranked list: best first, a reason on every item, the promotion rule, and skipped or replied posts left out', async () => {
  const { store, conv, restore } = withDb();
  try {
    const [poly] = await approve(store, ['polymath']);
    await store.recordRead(poly.id, { state: 'read', seen: 3, kept: 3, promotionRule: 'No self-promotion.' }, SCOPE);
    await store.savePosts([
      { postId: 'aaa1', subreddit: 'polymath', title: 'Being a generalist', body: 'polymath curiosity', author: 'alice', postedAt: new Date(NOW - HOUR).toISOString(), score: 20, numComments: 9, keyword: 'generalist' },
      { postId: 'bbb2', subreddit: 'polymath', title: 'Old thread', body: '', author: 'bob', postedAt: new Date(NOW - 20 * 24 * HOUR).toISOString(), score: 1, numComments: 0 },
      { postId: 'ccc3', subreddit: 'polymath', title: 'Renaissance minds', body: 'renaissance curiosity', author: 'carol', postedAt: new Date(NOW - 3 * 24 * HOUR).toISOString(), score: 2, numComments: 1 },
      { postId: 'ddd4', subreddit: 'polymath', title: 'Skipped one', body: 'polymath', author: 'dan', postedAt: new Date(NOW - HOUR).toISOString() },
      { postId: 'eee5', subreddit: 'polymath', title: 'Already answered', body: 'polymath', author: 'eve', postedAt: new Date(NOW - HOUR).toISOString() },
    ], SCOPE);
    const list = await conv.listRedditConversations(SCOPE, {
      commentsStore: stubComments([{ id: 'r1', postId: 'eee5', status: 'posted' }, { id: 'r2', postId: 'aaa1', status: 'draft' }]),
      feedbackStore: stubFeedback(['ddd4']),
      canonDocs: CANON,
      now: () => NOW,
    });
    assert.equal(list.ok, true, list.error);
    const ids = list.data.items.map((i) => i.postId);
    assert.deepEqual(ids, ['aaa1', 'ccc3'], 'too old, skipped and already-answered posts are left out; best first');
    assert.equal(list.data.newCount, 2);
    for (const item of list.data.items) {
      assert.ok(item.reason && item.reason.length > 10, 'every item names why it ranked');
      assert.equal(item.promotionRule, 'No self-promotion.');
    }
    assert.match(list.data.items[0].reason, /keyword "generalist"/);
    assert.match(list.data.items[0].reason, /9 comments and 20 points/, 'Reddit words, not replies and likes');
    assert.equal(list.data.items[0].replyStatus, 'draft', 'a reply still open keeps the post listed');
    assert.equal(list.data.reading.state, 'current');
  } finally { restore(); }
});

test('reading verdict: signed out and never-read are "cannot tell", never "0 found"', () => {
  const { conv, restore } = withDb();
  try {
    assert.equal(conv.readingVerdict([], NOW).state, 'no_subreddits');
    const signedOut = conv.readingVerdict([
      { name: 'polymath', lastReadState: 'signed_out', lastReadAt: new Date(NOW - HOUR).toISOString() },
      { name: 'philosophy', lastReadState: 'read', lastReadAt: new Date(NOW - HOUR).toISOString() },
    ], NOW);
    assert.equal(signedOut.state, 'signed_out');
    assert.match(signedOut.sentence, /signed out of Reddit/);
    assert.doesNotMatch(signedOut.sentence, /\b0 found\b/);
    const unread = conv.readingVerdict([{ name: 'polymath', lastReadState: '', lastReadAt: null }], NOW);
    assert.equal(unread.state, 'cannot_tell');
    assert.match(unread.sentence, /r\/polymath has not been read yet/);
    const overdue = conv.readingVerdict([{ name: 'polymath', lastReadState: 'read', lastReadAt: new Date(NOW - 30 * HOUR).toISOString() }], NOW);
    assert.equal(overdue.state, 'cannot_tell');
    // More subreddits, each read less often: the window grows with them.
    assert.ok(conv.overdueAfterMs(10) > conv.overdueAfterMs(2));
  } finally { restore(); }
});

test('the overview stage: signed out says so even with no posts; current and empty says "nothing new"', async () => {
  const { conv, restore } = withDb();
  try {
    const overview = require('../../lib/outreachOverview.js');
    const fake = (reading, items = []) => ({ listRedditConversations: async () => ({ ok: true, data: { items, newCount: items.length, reading } }) });
    const out = await overview.redditConversationsStage(fake(conv.readingVerdict([{ name: 'p', lastReadState: 'signed_out', lastReadAt: new Date(NOW).toISOString() }], NOW)), SCOPE);
    assert.equal(out.state, 'cannot_tell');
    assert.match(out.sentence, /signed out/);
    assert.doesNotMatch(out.sentence, /0 new posts/);
    const done = await overview.redditConversationsStage(fake({ state: 'current', sentence: 'All read.' }), SCOPE);
    assert.equal(done.state, 'done');
    assert.match(done.sentence, /Nothing new/);
    const some = await overview.redditConversationsStage(fake({ state: 'current', sentence: '' }, [{ postId: 'a' }]), SCOPE);
    assert.equal(some.state, 'needs_you');
    assert.equal(some.inline, true);

    const subs = overview.subredditsStage([{ status: 'candidate' }, { status: 'approved' }]);
    assert.equal(subs.state, 'needs_you');
    assert.match(subs.sentence, /1 subreddit waiting/);
    assert.equal(overview.subredditsStage([]).state, 'not_started');
  } finally { restore(); }
});

test('Write replies lines up the comment from what was read, to the post or to a comment; Skip and Save contact', async () => {
  const { store, conv, restore } = withDb();
  try {
    const [poly] = await approve(store, ['polymath']);
    await store.recordRead(poly.id, { state: 'read' }, SCOPE);
    await store.savePosts([{ postId: 'aaa1', subreddit: 'polymath', title: 'Being a generalist', body: 'polymath', author: 'alice', postedAt: new Date(NOW).toISOString() }], SCOPE);
    await store.saveComments('aaa1', [{ id: 'c1', author: 'dave', body: 'Great question', score: 4 }], SCOPE);

    const added = [];
    const drafted = [];
    const commentsStore = {
      listItems: async () => ({ ok: true, data: [] }),
      addItem: async (input) => { added.push(input); return { ok: true, data: { id: `item${added.length}` } }; },
      writeDraftForItem: async (id) => { drafted.push(id); return { ok: true, data: { status: 'draft' } }; },
    };
    const deps = { commentsStore, feedbackStore: stubFeedback([]), canonDocs: CANON, now: () => NOW };

    const toPost = await conv.writeRepliesFor({ postId: 'aaa1' }, SCOPE, deps);
    assert.equal(toPost.ok, true, toPost.error);
    assert.equal(added[0].url, 'https://www.reddit.com/r/polymath/comments/aaa1/');
    assert.equal(added[0].postTitle, 'Being a generalist');
    assert.equal(added[0].parentCommentText, undefined);

    const toComment = await conv.writeRepliesFor({ postId: 'aaa1', commentId: 'c1' }, SCOPE, deps);
    assert.equal(toComment.ok, true, toComment.error);
    assert.equal(added[1].url, 'https://www.reddit.com/r/polymath/comments/aaa1/comment/c1/');
    assert.equal(added[1].parentCommentText, 'Great question');
    assert.deepEqual(drafted, ['item1', 'item2']);

    const bad = await conv.writeRepliesFor({ postId: 'aaa1', commentId: 'nope' }, SCOPE, deps);
    assert.equal(bad.status, 404);

    const contacts = [];
    const contactsStore = {
      listContacts: async () => ({ ok: true, data: contacts }),
      rowToContact: (r) => r,
      createContact: async (c) => { contacts.push(c); return { ok: true, data: c }; },
    };
    const saved = await conv.saveContact({ postId: 'aaa1', author: 'dave' }, SCOPE, { ...deps, contactsStore });
    assert.equal(saved.ok, true, saved.error);
    assert.equal(saved.data.created, true);
    assert.equal(contacts[0].customFields.reddit, 'https://www.reddit.com/user/dave');
    assert.deepEqual(contacts[0].tags, ['reddit', 'outreach']);
    const twice = await conv.saveContact({ postId: 'aaa1', author: 'dave' }, SCOPE, { ...deps, contactsStore });
    assert.equal(twice.data.created, false, 'not saved twice');
    const stranger = await conv.saveContact({ postId: 'aaa1', author: 'mallory' }, SCOPE, { ...deps, contactsStore });
    assert.equal(stranger.ok, false);

    const skipped = [];
    const skip = await conv.skipConversation({ postId: 'aaa1', reasons: ['Off topic'] }, SCOPE, { ...deps, feedbackStore: stubFeedback(skipped) });
    assert.equal(skip.ok, true, skip.error);
    assert.deepEqual(skipped, ['aaa1']);
  } finally { restore(); }
});

test('a reply to a comment does not block replying to the post, and repeat clicks reuse the open reply (one item, one draft)', async () => {
  const { store, conv, restore } = withDb();
  try {
    const [poly] = await approve(store, ['polymath']);
    await store.recordRead(poly.id, { state: 'read' }, SCOPE);
    await store.savePosts([{ postId: 'aaa1', subreddit: 'polymath', title: 'Being a generalist', body: 'polymath', author: 'alice', postedAt: new Date(NOW).toISOString() }], SCOPE);
    await store.saveComments('aaa1', [{ id: 'c1', author: 'dave', body: 'Great question', score: 4 }], SCOPE);

    // A comments store that remembers what was lined up, the way the real one does.
    const items = [];
    const generated = [];
    const commentsStore = {
      listItems: async () => ({ ok: true, data: items.map((i) => ({ ...i })) }),
      addItem: async (input) => {
        const m = input.url.match(/\/comments\/([a-z0-9]+)\/(?:comment\/([a-z0-9]+)\/)?/);
        const item = { id: `item${items.length + 1}`, postId: m[1], parentCommentId: m[2] || '', status: 'idea' };
        items.push(item);
        return { ok: true, data: item };
      },
      writeDraftForItem: async (id) => { generated.push(id); items.find((i) => i.id === id).status = 'draft'; return { ok: true, data: { status: 'draft' } }; },
    };
    const deps = { commentsStore, feedbackStore: stubFeedback([]), canonDocs: CANON, now: () => NOW };

    const toComment = await conv.writeRepliesFor({ postId: 'aaa1', commentId: 'c1' }, SCOPE, deps);
    assert.equal(toComment.ok, true, toComment.error);
    const again = await conv.writeRepliesFor({ postId: 'aaa1', commentId: 'c1' }, SCOPE, deps);
    assert.equal(again.ok, true, again.error);
    assert.equal(again.data.itemId, toComment.data.itemId, 'the second click reuses the first reply');
    assert.equal(again.data.drafted, false, 'an existing draft is left alone');
    assert.equal(items.length, 1, 'one item for one comment, however many clicks');
    assert.equal(generated.length, 1, 'one paid draft, however many clicks');

    const listed = await conv.listRedditConversations(SCOPE, deps);
    const post = listed.data.items[0];
    assert.equal(post.replyStatus, '', 'a reply to a comment is not a reply to the post');
    assert.equal(post.topComments[0].replyStatus, 'draft', 'the comment carries its own reply');

    const toPost = await conv.writeRepliesFor({ postId: 'aaa1' }, SCOPE, deps);
    assert.equal(toPost.ok, true, toPost.error);
    assert.equal(toPost.data.created, true, 'the post gets a reply of its own');
    assert.notEqual(toPost.data.itemId, toComment.data.itemId);
    assert.equal(items.length, 2);
    assert.equal(items[1].parentCommentId, '');

    items[0].status = 'posted';
    const sent = await conv.writeRepliesFor({ postId: 'aaa1', commentId: 'c1' }, SCOPE, deps);
    assert.equal(sent.status, 409, 'a comment already answered is not written again');
    const stillListed = await conv.listRedditConversations(SCOPE, deps);
    assert.deepEqual(stillListed.data.items.map((i) => i.postId), ['aaa1'], 'a sent reply to a comment does not hide the post');
  } finally { restore(); }
});

test('reading verdict: a successful read AFTER the newest signed-out try means not signed out now', () => {
  const { conv, restore } = withDb();
  try {
    const at = (h) => new Date(NOW - h * HOUR).toISOString();
    // Signed out 10h ago on two subreddits; Dane signed back in and two others were read 2h ago.
    const later = conv.readingVerdict([
      { name: 'polymath', lastReadState: 'signed_out', lastReadAt: at(10) },
      { name: 'philosophy', lastReadState: 'signed_out', lastReadAt: at(10) },
      { name: 'generalist', lastReadState: 'read', lastReadAt: at(2) },
      { name: 'curiosity', lastReadState: 'read', lastReadAt: at(2) },
    ], NOW);
    assert.notEqual(later.state, 'signed_out');
    assert.doesNotMatch(later.sentence, /signed out of Reddit when/);
    assert.equal(later.state, 'cannot_tell', 'the two tried while signed out have not been read since');
    assert.match(later.sentence, /not been read since the Mini was signed back in/);
    // The other order: read first, signed out after — that IS signed out now.
    const now = conv.readingVerdict([
      { name: 'polymath', lastReadState: 'read', lastReadAt: at(10) },
      { name: 'philosophy', lastReadState: 'signed_out', lastReadAt: at(2) },
    ], NOW);
    assert.equal(now.state, 'signed_out');
  } finally { restore(); }
});

test('the watch says when the canon could not be read, and a failed save is recorded on the subreddit', async () => {
  const { store, due, restore } = withDb();
  try {
    const canonPath = require.resolve('../../lib/canonStore.js');
    const realCanon = require.cache[canonPath];
    require.cache[canonPath] = { id: canonPath, filename: canonPath, loaded: true, exports: { listCanon: async () => ({ ok: false, status: 502, error: 'canon table unreachable' }) } };
    try {
      await approve(store, ['polymath']);
      const noKeywords = await due.runRedditWatchDue({
        callOpenClaw: async () => { throw new Error('must not read with nothing to match'); },
        extractJson: () => null,
        readKeywords: async () => ({ ok: true, data: [] }), now: () => NOW,
      });
      assert.match(noKeywords.data.projects[0].error, /canon could not be read/);
      assert.doesNotMatch(noKeywords.data.projects[0].error, /Save keywords/);

      const browser = fakeBrowser({ listing: () => ({ signedIn: true, found: true, promotionRule: '', new: [{ id: 'aaa1', title: 'Being a generalist', body: '', author: 'a', postedAt: new Date(NOW).toISOString(), score: 1, comments: 0 }], rising: [] }) });
      const realSave = store.savePosts;
      store.savePosts = async () => ({ ok: false, status: 500, error: 'disk full' });
      let run;
      try {
        run = await due.runRedditWatchDue({
          callOpenClaw: browser.callOpenClaw, extractJson: browser.extractJson,
          readKeywords: async () => ({ ok: true, data: ['generalist'] }), now: () => NOW,
        });
      } finally { store.savePosts = realSave; }
      const log = due.formatWatchLog(run.data);
      assert.match(log, /NOTE: Matched on keywords only: the canon could not be read/);
      assert.equal(run.data.failed, 1);
      const [sub] = (await store.listSubreddits(100, SCOPE)).data;
      assert.equal(sub.lastReadState, 'failed', 'the wizard shows the save failure, not the previous good read');
      assert.match(sub.lastReadError, /disk full/);
    } finally {
      if (realCanon) require.cache[canonPath] = realCanon; else delete require.cache[canonPath];
    }
  } finally { restore(); }
});

test('Find subreddits for my topics: proposals land as candidates, known ones are not re-proposed, nothing to go on is refused', async () => {
  const { store, suggest, restore } = withDb();
  try {
    await approve(store, ['philosophy']);
    let prompt = '';
    const res = await suggest.suggestSubreddits(SCOPE, {
      keywords: ['polymath'],
      canonDocs: CANON,
      generate: async (_s, p) => { prompt = p; return { ok: true, text: 'Here: {"subreddits": [{"name": "r/polymath", "why": "Generalists talk here."}, {"name": "philosophy", "why": "x"}]}' }; },
    });
    assert.equal(res.ok, true, res.error);
    assert.match(prompt, /do NOT suggest these again: r\/philosophy/);
    assert.equal(res.data.added.length, 1);
    assert.equal(res.data.added[0].suggestedBy, 'ai');
    assert.equal(res.data.added[0].why, 'Generalists talk here.');
    assert.deepEqual(res.data.kept, ['philosophy']);

    const nothing = await suggest.suggestSubreddits(SCOPE, { keywords: [], canonDocs: [], generate: async () => assert.fail('no call') });
    assert.equal(nothing.ok, false);
    assert.match(nothing.error, /no keywords and no canon/);

    const garbled = await suggest.suggestSubreddits(SCOPE, { keywords: ['x'], canonDocs: [], generate: async () => ({ ok: true, text: 'sorry' }) });
    assert.equal(garbled.ok, false);
  } finally { restore(); }
});

test('routes: the Reddit watch endpoints answer through the outreach router', async () => {
  const { restore } = withDb();
  try {
    const route = require('../../routes/outreach.js');
    const calls = [];
    const reddit = {
      store: () => ({ listSubreddits: async () => { calls.push('list'); return { ok: true, data: [] }; } }),
      conversations: () => ({ listRedditConversations: async () => { calls.push('conv'); return { ok: true, data: { items: [] } }; } }),
      suggest: async () => ({ ok: true, data: {} }),
    };
    const res = () => {
      const r = { statusCode: 0, body: '', headersSent: false, setHeader() {}, writeHead(c) { r.statusCode = c; }, end(b) { r.body = b; } };
      return r;
    };
    const req = { projectContext: { project: { id: 'proj_a' } }, authUser: { id: 'user_1' }, headers: {} };
    const r1 = res();
    assert.equal(await route.handle(req, r1, '/api/outreach/reddit/subreddits', 'GET', { reddit }), true);
    const r2 = res();
    assert.equal(await route.handle(req, r2, '/api/outreach/reddit/conversations', 'GET', { reddit }), true);
    assert.deepEqual(calls, ['list', 'conv']);
    const r3 = res();
    await route.handle(req, r3, '/api/outreach/reddit/nowhere', 'GET', { reddit });
    assert.equal(r3.statusCode, 404);
  } finally { restore(); }
});
