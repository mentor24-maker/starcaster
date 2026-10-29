'use strict';

// Outreach wizard 16/19 (task 86bcrmbtn): YouTube's Find conversations — the
// three-hourly comments read, the ranking of comments, the list grouped by
// video, and Write replies / Comment on the video / Skip / Save as contact.
// Fake stores and a fake YouTube stand in for the database and the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const due = require('../../lib/acquire/YoutubeCommentsReadDue');
const finder = require('../../lib/youtubeConversationFinder');
const ranking = require('../../lib/outreachRanking');
const route = require('../../routes/outreach');

const NOW = Date.parse('2026-10-28T20:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const scope = { projectId: 'p1', userId: 'u1' };
const CH_A = `UC${'a'.repeat(22)}`;
const CH_B = `UC${'b'.repeat(22)}`;
const V1 = 'vid00000001';
const V2 = 'vid00000002';
const V3 = 'vid00000003';

function ok(data, status = 200) { return { ok: true, status, data }; }
function ago(ms) { return new Date(NOW - ms).toISOString(); }

// ── The scheduled read ──────────────────────────────────────────────────────

function upload(videoId, publishedAt, title = videoId) {
  return { snippet: { title, resourceId: { videoId } }, contentDetails: { videoPublishedAt: publishedAt } };
}
function thread(id, { text = 'A comment.', likes = 0, replies = 0, author = 'Ann', channelId = CH_B } = {}) {
  return {
    id,
    snippet: {
      totalReplyCount: replies,
      topLevelComment: {
        id,
        snippet: {
          textOriginal: text, authorDisplayName: `@${author}`, authorChannelUrl: `http://www.youtube.com/@${author}`,
          authorChannelId: { value: channelId }, likeCount: likes, publishedAt: ago(2 * HOUR),
        },
      },
    },
  };
}

test('the read keeps the newest uploads of the last 14 days, and their comments', async () => {
  const calls = [];
  const ytFetch = async (endpoint, params) => {
    calls.push([endpoint, params]);
    if (endpoint === 'playlistItems') {
      assert.equal(params.playlistId, `UU${'a'.repeat(22)}`, 'the uploads list is the channel id with UC turned to UU');
      return ok({ items: [upload(V1, ago(1 * DAY)), upload(V2, ago(20 * DAY)), upload(V3, ago(3 * DAY)), upload('bad', ago(DAY))] });
    }
    if (params.videoId === V3) return { ok: false, status: 403, reason: 'commentsDisabled', error: 'disabled' };
    return ok({ items: [thread('c1', { text: 'Why?', likes: 4, replies: 1 })] });
  };
  const res = await due.readChannel({ channelId: CH_A }, { ytFetch, now: () => NOW });
  assert.equal(res.ok, true);
  assert.deepEqual(res.videos.map((v) => v.videoId), [V1, V3], 'newest first; the 20-day-old one is left out');
  assert.equal(res.videos[1].commentsDisabled, true);
  const c = res.videos[0].comments[0];
  assert.deepEqual(
    { id: c.commentId, text: c.text, name: c.authorName, likes: c.likes, replies: c.replies, ch: c.authorChannelId, url: c.authorChannelUrl },
    { id: 'c1', text: 'Why?', name: 'Ann', likes: 4, replies: 1, ch: CH_B, url: 'https://www.youtube.com/@Ann' },
  );
  assert.equal(calls.filter(([e]) => e === 'commentThreads').length, 2, 'one comments read per video kept');
});

test('a channel that never uploaded is "no videos", not a failure', async () => {
  const res = await due.readChannel({ channelId: CH_A }, {
    ytFetch: async () => ({ ok: false, status: 404, reason: 'playlistNotFound', error: 'not found' }), now: () => NOW,
  });
  assert.deepEqual(res, { ok: true, videos: [] });
});

function readStore(creators) {
  const recorded = [];
  return {
    recorded,
    SQL_FILE: 'docs/SQL/youtube_creators_setup.sql',
    CONVERSATIONS_SQL_FILE: 'docs/SQL/youtube_conversations_setup.sql',
    listCreators: async (limit, sc, options) => {
      assert.equal(typeof limit, 'number', 'limit first (landmine 12)');
      assert.equal(options.status, 'approved');
      return ok(creators);
    },
    recordCommentsRead: async (id, result, sc) => { recorded.push({ id, result, projectId: sc.projectId }); return ok({}); },
  };
}

test('the pass reads every approved channel, longest-unread first, and records what came back', async () => {
  const store = readStore([
    { id: 'recent', name: 'Recent', channelId: CH_A, lastCommentsReadAt: ago(HOUR) },
    { id: 'never', name: 'Never', channelId: CH_B, lastCommentsReadAt: null },
  ]);
  const res = await due.runCommentsReadDue({
    store, apiKey: 'k', now: () => NOW,
    discover: async () => ok([{ projectId: 'p1', userId: 'u1' }]),
    ytFetch: async (endpoint) => (endpoint === 'playlistItems'
      ? ok({ items: [upload(V1, ago(DAY))] })
      : ok({ items: [thread('c1'), thread('c2')] })),
  });
  assert.equal(res.ok, true);
  assert.deepEqual(store.recorded.map((r) => r.id), ['never', 'recent']);
  assert.equal(res.data.read, 2);
  assert.equal(res.data.comments, 4);
  assert.match(due.formatCommentsReadLog(res.data)[0], /channels=2 read=2 comments=4 failed=0/);
});

test('a used-up quota stops the pass, says when it comes back, and keeps the last good list', async () => {
  const store = readStore([
    { id: 'first', name: 'First', channelId: CH_A, lastCommentsReadAt: null },
    { id: 'second', name: 'Second', channelId: CH_B, lastCommentsReadAt: ago(HOUR) },
  ]);
  const res = await due.runCommentsReadDue({
    store, apiKey: 'k', now: () => NOW,
    discover: async () => ok([{ projectId: 'p1', userId: 'u1' }, { projectId: 'p2', userId: 'u2' }]),
    ytFetch: async () => ({ ok: false, status: 403, reason: 'quotaExceeded', error: 'The request cannot be completed because you have exceeded your quota.' }),
  });
  assert.equal(res.ok, true);
  assert.equal(store.recorded.length, 1, 'only the channel being read records anything');
  assert.match(store.recorded[0].result.error, /^Cannot tell — YouTube quota used up until /);
  assert.equal(store.recorded[0].result.videos, undefined, 'an error never replaces the stored list');
  assert.ok(res.data.quota);
  assert.deepEqual(res.data.notReached.map((n) => n.projectId), ['p1', 'p2']);
});

test('the pass refuses by name with no key, or when the creators table cannot be read', async () => {
  const noKey = await due.runCommentsReadDue({ apiKey: '', store: readStore([]) });
  assert.equal(noKey.ok, false);
  assert.match(noKey.error, /YOUTUBE_API_KEY/);
  const noTable = await due.runCommentsReadDue({
    apiKey: 'k', store: readStore([]), discover: async () => ({ ok: false, status: 404, error: 'relation "youtube_creators" does not exist' }),
  });
  assert.equal(noTable.ok, false);
  assert.match(noTable.error, /youtube_creators_setup\.sql and docs\/SQL\/youtube_conversations_setup\.sql/);
});

// ── The ranking ─────────────────────────────────────────────────────────────

test('a comment is ranked on room to add something, likes, recency and canon — and says so', () => {
  const asks = ranking.scoreConversation({
    kind: 'comment', text: 'Has anyone measured where our attention actually goes when the feed never ends?', likes: 12, replies: 0, postedAt: ago(3 * HOUR),
  }, { terms: ['attention'], now: NOW });
  assert.equal(asks.reason, 'Asks a question nobody has answered yet, posted 3 hours ago, mentions "attention" from your canon, 12 likes.');
  assert.ok('room' in asks.parts && !('source' in asks.parts));

  const crowded = ranking.scoreConversation({ kind: 'comment', text: 'Great video', likes: 0, replies: 9, postedAt: ago(3 * HOUR) }, { now: NOW });
  assert.match(crowded.reason, /^Already has 9 replies, so a reply adds less/);
  assert.ok(asks.score > crowded.score);

  // Substack's Notes are scored exactly as before.
  const note = ranking.scoreConversation({ text: 'x', approved: true, replies: 2, likes: 3, postedAt: ago(HOUR / 2) }, { now: NOW });
  assert.equal(note.reason, 'From a writer you approved, posted within the hour, already has 2 replies and 3 likes.');
});

// ── The list ────────────────────────────────────────────────────────────────

function comment(commentId, over = {}) {
  return {
    commentId, text: 'Nice video', authorName: `Person ${commentId}`, authorChannelUrl: `https://www.youtube.com/@p${commentId}`,
    authorChannelId: '', likes: 0, replies: 0, publishedAt: ago(2 * HOUR), ...over,
  };
}

function listDeps({ creators, targets = [], rows = [], skipped = [], extra = {} } = {}) {
  const calls = { created: [], updated: [], drafted: [], feedback: [], contacts: [] };
  const deps = {
    now: () => NOW,
    canonDocs: [{ docKey: 'THESIS', body: 'attention attention attention' }],
    creatorsStore: { listCreators: async () => ok(creators) },
    targetsStore: {
      DEFAULT_ACCOUNT: 'dane_of_earth',
      listTargets: async (limit) => { assert.equal(typeof limit, 'number'); return ok(targets); },
      createTarget: async (input, sc) => {
        calls.created.push(input);
        return ok({ id: 'new-target', videoId: V1, replyToCommentId: input.replyToCommentId || '', commentPlacement: input.commentPlacement }, 201);
      },
      updateTarget: async (id, patch) => { calls.updated.push({ id, patch }); return ok({ id, replyToCommentId: patch.replyToCommentId || '', commentPlacement: patch.commentPlacement }); },
    },
    commentsStore: {
      STATUS_WORDS: { draft: 'waiting for approval', approved: 'approved', posting: 'being posted', posted: 'posted' },
      listComments: async () => ok(rows),
      writeDraftForTarget: async (targetId, sc, options) => { calls.drafted.push({ targetId, options }); return ok({ id: 'draft-1', status: 'draft' }, 201); },
    },
    feedbackStore: {
      listDecidedItemIds: async (q) => { assert.deepEqual(q, { channel: 'youtube', itemKind: 'conversation' }); return ok(skipped); },
      readRejectInput: (b) => ({ ok: true, data: { reasons: b.reasons || [], note: b.note || '' } }),
      recordFeedback: async (entry) => { calls.feedback.push(entry); return ok({}); },
    },
    ...extra,
  };
  return { deps, calls };
}

const fresh = { lastCommentsReadAt: ago(HOUR), commentsReadError: '' };

test('comments are grouped by video, best video first, each ranked with a reason', async () => {
  const { deps } = listDeps({
    creators: [{
      id: 'cr1', name: 'Channel A', channelId: CH_A, channelUrl: 'https://www.youtube.com/@a', ...fresh,
      recentVideos: [
        { videoId: V1, title: 'Dull', publishedAt: ago(DAY), comments: [comment('d1'), comment('old', { publishedAt: ago(81 * DAY) })] },
        { videoId: V2, title: 'Lively', publishedAt: ago(2 * DAY), comments: [comment('l1', { text: 'Where does attention go? Asking for real here.', likes: 30 }), comment('l2')] },
        { videoId: V3, title: 'Quiet', publishedAt: ago(3 * DAY), comments: [] },
      ],
    }],
    skipped: ['l2'],
  });
  const res = await finder.listYoutubeConversations(scope, deps);
  assert.equal(res.ok, true);
  const { videos, newCount, reading } = res.data;
  assert.deepEqual(videos.map((v) => v.videoId), [V2, V1, V3], 'best comment first; the video with none goes last');
  assert.deepEqual(videos[0].comments.map((c) => c.commentId), ['l1'], 'a skipped comment is left out');
  assert.deepEqual(videos[1].comments.map((c) => c.commentId), ['d1'], 'a months-old comment on a "new" video is left out');
  assert.equal(newCount, 2);
  assert.equal(reading.state, 'current');
  const top = videos[0].comments[0];
  assert.equal(top.author.name, 'Person l1');
  assert.equal(top.author.channelUrl, 'https://www.youtube.com/@pl1');
  assert.equal(top.url, `https://www.youtube.com/watch?v=${V2}&lc=l1`);
  assert.match(top.reason, /^Asks a question nobody has answered yet/);
  for (const v of videos) for (const c of v.comments) assert.ok(c.reason.length > 10, `${c.commentId} has no reason`);
});

test('an empty list is "Cannot tell" while a channel is unread or its read failed — never "0 found"', async () => {
  const { deps } = listDeps({
    creators: [
      { id: 'a', name: 'Never Read', channelId: CH_A, lastCommentsReadAt: null, commentsReadError: '', recentVideos: [] },
      { id: 'b', name: 'Refused', channelId: CH_B, lastCommentsReadAt: ago(DAY * 2), commentsReadError: 'Cannot tell — YouTube quota used up until Oct 29.', recentVideos: [] },
    ],
  });
  const res = await finder.listYoutubeConversations(scope, deps);
  assert.equal(res.data.reading.state, 'cannot_tell');
  assert.match(res.data.reading.sentence, /Never Read/);
  assert.match(res.data.reading.sentence, /Refused did not come back \(Cannot tell — YouTube quota used up until Oct 29\)/);
  const none = await finder.listYoutubeConversations(scope, listDeps({ creators: [] }).deps);
  assert.equal(none.data.reading.state, 'no_creators');
});

test('a video already commented on leaves the list; one with a reply waiting holds its other comments', async () => {
  const creators = [{
    id: 'cr1', name: 'A', channelId: CH_A, ...fresh,
    recentVideos: [
      { videoId: V1, title: 'Done', comments: [comment('x1')] },
      { videoId: V2, title: 'Waiting', comments: [comment('w1'), comment('w2')] },
    ],
  }];
  const targets = [
    { id: 't1', videoId: V1, status: 'active', commentPlacement: 'reply_specific', replyToCommentId: 'x1' },
    { id: 't2', videoId: V2, status: 'active', commentPlacement: 'reply_specific', replyToCommentId: 'w1' },
  ];
  const rows = [{ targetId: 't1', status: 'posted' }, { targetId: 't2', status: 'draft' }];
  const { deps, calls } = listDeps({ creators, targets, rows });
  const res = await finder.listYoutubeConversations(scope, deps);
  assert.deepEqual(res.data.videos.map((v) => v.videoId), [V2]);
  assert.equal(res.data.commentedCount, 1);
  const v = res.data.videos[0];
  assert.equal(v.state, 'waiting');
  assert.equal(v.waitingOn, 'w1');
  assert.match(v.blocked, /A reply to Person w1's comment is waiting for approval/);
  assert.equal(v.comments.find((c) => c.commentId === 'w1').replyStatus, 'draft');

  const second = await finder.writeRepliesFor({ commentId: 'w2' }, scope, deps);
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.match(second.error, /Finish or reject it/);
  const reopen = await finder.writeRepliesFor({ commentId: 'w1' }, scope, deps);
  assert.deepEqual(reopen.data, { targetId: 't2', created: false, drafted: false, status: 'draft' }, 'the waiting draft is opened, not written twice');
  assert.equal(calls.drafted.length, 0);
});

test('Write replies makes a target whose replyToCommentId IS the comment clicked, then writes three options', async () => {
  const creators = [{ id: 'cr1', name: 'A', channelId: CH_A, ...fresh, recentVideos: [{ videoId: V1, title: 'T', comments: [comment('Ugz-abc_123')] }] }];
  const { deps, calls } = listDeps({ creators });
  const res = await finder.writeRepliesFor({ commentId: 'Ugz-abc_123' }, scope, deps);
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(calls.created, [{
    videoUrl: `https://www.youtube.com/watch?v=${V1}`, source: 'search', commentPlacement: 'reply_specific', replyToCommentId: 'Ugz-abc_123',
  }]);
  assert.equal(res.data.replyToCommentId, 'Ugz-abc_123');
  assert.equal(calls.drafted[0].targetId, 'new-target');
  assert.equal(calls.drafted[0].options.onlyIfNoneWaiting, true);
});

test('Write replies re-points a video whose target has nothing waiting; Comment on the video makes it top-level', async () => {
  const creators = [{ id: 'cr1', name: 'A', channelId: CH_A, ...fresh, recentVideos: [{ videoId: V1, title: 'T', comments: [comment('c1'), comment('c2')] }] }];
  const targets = [{ id: 't1', videoId: V1, status: 'active', commentPlacement: 'reply_specific', replyToCommentId: 'c1' }];
  const { deps, calls } = listDeps({ creators, targets, rows: [{ targetId: 't1', status: 'rejected' }] });
  const res = await finder.writeRepliesFor({ commentId: 'c2' }, scope, deps);
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(calls.updated, [{ id: 't1', patch: { commentPlacement: 'reply_specific', replyToCommentId: 'c2' } }]);
  assert.equal(calls.created.length, 0);

  const video = await finder.commentOnVideo({ videoId: V1 }, scope, deps);
  assert.equal(video.ok, true, video.error);
  assert.deepEqual(calls.updated[1], { id: 't1', patch: { commentPlacement: 'top_level' } });
});

test('Skip records why under the comment id; a comment not listed is refused by name', async () => {
  const creators = [{ id: 'cr1', name: 'A', channelId: CH_A, ...fresh, recentVideos: [{ videoId: V1, title: 'T', comments: [comment('c1')] }] }];
  const { deps, calls } = listDeps({ creators });
  const res = await finder.skipConversation({ commentId: 'c1', reasons: ['off-topic'] }, scope, deps);
  assert.equal(res.ok, true);
  assert.deepEqual(
    { ch: calls.feedback[0].channel, id: calls.feedback[0].itemId, kind: calls.feedback[0].itemKind, reasons: calls.feedback[0].reasons },
    { ch: 'youtube', id: 'c1', kind: 'conversation', reasons: ['off-topic'] },
  );
  const gone = await finder.skipConversation({ commentId: 'nope' }, scope, deps);
  assert.equal(gone.status, 404);
  assert.match(gone.error, /not on the list any more/);
});

test('Save as contact adds the commenter once, source youtube_outreach, matched on their channel', async () => {
  const creators = [{ id: 'cr1', name: 'Channel A', channelId: CH_A, ...fresh, recentVideos: [{ videoId: V1, title: 'T', comments: [comment('c1')] }] }];
  const made = [];
  let stored = [];
  const contactsStore = {
    listContacts: async (opts) => { assert.equal(opts.scope, scope, 'scoped to the project'); return ok(stored); },
    rowToContact: (r) => r,
    createContact: async (c, sc) => { assert.equal(sc, scope); made.push(c); stored = [c]; return ok([c], 201); },
  };
  const { deps } = listDeps({ creators, extra: { contactsStore } });
  const first = await finder.saveCommenterAsContact({ commentId: 'c1' }, scope, deps);
  assert.equal(first.data.mode, 'created');
  assert.equal(made[0].source, 'youtube_outreach');
  assert.equal(made[0].youtube, 'https://www.youtube.com/@pc1');
  assert.equal(made[0].firstName, 'Person c1');
  const again = await finder.saveCommenterAsContact({ commentId: 'c1' }, scope, deps);
  assert.equal(again.data.mode, 'existing');
  assert.equal(made.length, 1);
});

// ── The routes and the schedule ─────────────────────────────────────────────

function fakeRes() {
  return {
    statusCode: 0, body: '', headers: {},
    setHeader(k, v) { this.headers[k] = v; }, writeHead(code) { this.statusCode = code; },
    end(b) { this.body = b || ''; },
  };
}

test('the read runs only on the schedule, which is every three hours', async () => {
  let ran = 0;
  const yt = { readDue: () => ({ runCommentsReadDue: async () => { ran += 1; return ok({}); }, formatCommentsReadLog: () => [] }), finder: () => ({}) };
  const res = fakeRes();
  await route.handle({ method: 'GET', headers: {}, cronPublish: false }, res, '/api/outreach/youtube/conversations/read-due', 'GET', { youtubeConversations: yt });
  assert.equal(res.statusCode, 403);
  assert.equal(ran, 0);

  const root = path.join(__dirname, '..', '..');
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const cron = vercel.crons.find((c) => c.path === '/api/outreach/youtube/conversations/read-due');
  assert.ok(cron, 'vercel.json schedules the read');
  assert.match(cron.schedule, /^\d+ \*\/3 \* \* \*$/);
  assert.match(fs.readFileSync(path.join(root, 'routes', 'index.js'), 'utf8'), /'\/api\/outreach\/youtube\/conversations\/read-due'/, 'and routes/index.js lets the cron in');
});
