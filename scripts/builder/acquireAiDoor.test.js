'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * SC-846 (AI switch 4): five Acquire and outreach features called Anthropic's
 * servers with their own hand-written code, so the provider switch on
 * Settings › APIs › AI provider could not reach them. They now go through the
 * AI door (lib/aiClient.js generate).
 *
 * Each feature is driven here through the REAL door with the network replaced
 * by recorded replies, once with Anthropic answering and once with OpenAI
 * answering, and must get a usable result from both. A feature still calling
 * api.anthropic.com by hand would reach the real network (or never see the
 * OpenAI reply) and fail.
 */

const aiClient = require('../../lib/aiClient');

const realGenerate = aiClient.generate;
let calls = [];
let replyText = '';
let answering = 'anthropic';

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// The shape each provider really answers with (recorded from their APIs).
function recordedReply(url) {
  if (url.includes('anthropic.com')) {
    return json(200, {
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: replyText }],
      stop_reason: 'end_turn', usage: { input_tokens: 40, output_tokens: 60 },
    });
  }
  return json(200, {
    id: 'chatcmpl-1', object: 'chat.completion', model: 'gpt-5.5',
    choices: [{ index: 0, message: { role: 'assistant', content: replyText }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 40, completion_tokens: 60, total_tokens: 100 },
  });
}

function fakeDoorDeps() {
  return {
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return recordedReply(url);
    },
    recordUsage: async () => {},
    postBus: async () => ({ ok: true }),
    getKey: () => 'test-key',
    order: async () => aiClient.envProviderOrder({ env: { AI_PROVIDER_ORDER: answering } }),
    now: () => 0,
  };
}

// The features read aiClient.generate at call time, so the stand-in can go in now.
aiClient.generate = (opts) => realGenerate(opts, fakeDoorDeps());
const realFetch = global.fetch;
// Anything that still calls a provider by hand would land here, not on the door.
global.fetch = async (url) => { throw new Error(`unexpected direct network call to ${url}`); };
test.after(() => { aiClient.generate = realGenerate; global.fetch = realFetch; aiClient._resetNoticeMemory(); });

const { generateYoutubeCommentSuggestions } = require('../../lib/acquire/YoutubeCommentSuggestions');
const bluesky = require('../../lib/blueskyReplyCandidates');
const reddit = require('../../lib/redditReplyCandidates');
const { rerankKeywordCandidatesWithAi } = require('../../lib/directAcquire');
const { generateContentHandler } = require('../../lib/acquire/contentHandlerGenerate');

const scope = { projectId: 'p1' };
const candidates = JSON.stringify({
  replies: [
    { text: 'That is a really thoughtful point about the drills.', tone: 'warm', why: 'agrees' },
    { text: 'We tried something similar last season and it helped.', tone: 'personal', why: 'shares' },
  ],
});

const FEATURES = [
  {
    feature: 'youtube_comment_suggestions',
    reply: JSON.stringify({ comments: ['Loved the way you broke down the footwork here.', 'This finally made the serve toss click for me.', 'Great pacing, the examples really helped.'] }),
    run: () => generateYoutubeCommentSuggestions({ title: 'Serve basics', description: 'How to serve.' }, scope),
    check: (r) => { assert.equal(r.ok, true, r.error); assert.equal(r.data.length, 3); },
  },
  {
    feature: 'bluesky_reply_candidates',
    reply: candidates,
    run: () => bluesky.generateReplyCandidates({ post: { text: 'Drills matter.' }, replies: [], scope }),
    check: (r) => { assert.equal(r.ok, true, r.error); assert.equal(r.data.length, 2); },
  },
  {
    feature: 'reddit_reply_candidates',
    reply: candidates,
    run: () => reddit.generateReplyCandidates({ post: { title: 'Drills', selftext: 'Drills matter.' }, comments: [], scope }),
    check: (r) => { assert.equal(r.ok, true, r.error); assert.equal(r.data.length, 2); },
  },
  {
    feature: 'direct_acquire_keyword_rerank',
    reply: JSON.stringify({ keywords: ['junior tennis', 'serve drills'] }),
    run: () => rerankKeywordCandidatesWithAi({ sourceUrl: 'https://example.com', pages: [], exclusions: [], candidates: [{ keyword: 'junior tennis' }, { keyword: 'serve drills' }] }),
    check: (r) => { assert.equal(r.ok, true, r.error); assert.deepEqual(r.data, ['junior tennis', 'serve drills']); },
  },
  {
    feature: 'acquire_content_handler_generate',
    reply: '```json\n{"name":"Underline to H2","type":"promote-h2","tag":"u","pattern":"","replacement":"","flags":"gi","description":"Turns underlined text into headings."}\n```',
    run: () => generateContentHandler({ description: 'underlined text is a heading', scope }),
    check: (r) => { assert.equal(r.ok, true, r.error); assert.equal(r.handler.type, 'promote-h2'); },
  },
];

for (const f of FEATURES) {
  for (const provider of ['anthropic', 'openai']) {
    test(`${f.feature}: answered by ${provider} through the door`, async () => {
      calls = [];
      replyText = f.reply;
      answering = provider;
      aiClient._resetNoticeMemory();
      const result = await f.run();
      f.check(result);
      assert.equal(calls.length, 1, 'exactly one AI request');
      assert.ok(calls[0].url.includes(provider === 'anthropic' ? 'anthropic.com' : 'openai.com'), calls[0].url);
      if (result.provider !== undefined) assert.equal(result.provider, provider);
    });
  }
}

test('a door with no provider set up answers 400, not a crash', async () => {
  const saved = aiClient.generate;
  aiClient.generate = (opts) => realGenerate(opts, { ...fakeDoorDeps(), getKey: () => '' });
  try {
    const r = await generateYoutubeCommentSuggestions({ description: 'x' }, scope);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.error, /No AI provider/);
  } finally {
    aiClient.generate = saved;
  }
});
