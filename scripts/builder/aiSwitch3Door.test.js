'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * SC-845 (AI switch 3): five more features go through the AI door.
 *
 * Subreddit suggestions, wider Substack keywords, Substack/YouTube decision
 * suggestions, font auto-tagging and outreach lessons all called
 * queryAnthropic by name, so they could only ever spend Anthropic's credit.
 * They now call generate() (lib/aiClient.js, SC-843), which uses whichever
 * provider comes first on Settings › APIs › AI provider.
 *
 * Each feature's default AI call is driven here through the REAL door, with
 * the network replaced by a recorded reply from Anthropic and then from
 * OpenAI. Whichever answers, the feature's own reader must get a usable
 * result out of it, the model must be the one for the feature's tier, and
 * the spend must be metered under the feature's name.
 */

const aiClient = require('../../lib/aiClient');

const realGenerate = aiClient.generate;
let calls = [];
let metered = [];
let firstProvider = 'anthropic';

function anthropicReply(text, model) {
  return { model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
}
function openaiReply(text, model) {
  return { model, choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
}

function fakeDoorDeps(replyText) {
  return {
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      const json = url.includes('anthropic.com') ? anthropicReply(replyText, body.model) : openaiReply(replyText, body.model);
      return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    recordUsage: async (entry) => { metered.push(entry); },
    postBus: async () => ({ ok: true }),
    getKey: () => 'test-key',
    order: () => aiClient.getAiProviderOrder({
      env: { AI_PROVIDER_ORDER: firstProvider === 'anthropic' ? 'anthropic,openai' : 'openai,anthropic' },
      // Nothing saved on Settings › APIs, so the order above is the one used.
      readSettings: async () => ({ ok: true, data: { exists: false } }),
    }),
    now: () => 0,
  };
}

// The recorded reply the stand-in network serves, set per test.
let replyText = '';
// Four of the five take `generate` off aiClient when they load, so the
// stand-in must be in place first, and each loaded fresh.
aiClient.generate = (opts) => realGenerate(opts, fakeDoorDeps(replyText));
const MODULES = ['acquire/RedditSubredditSuggest', 'acquire/SubstackKeywordsGrow', 'acquire/SubstackSuggestRun', 'fontAutoTag', 'outreachLessons'];
for (const name of MODULES) delete require.cache[require.resolve(`../../lib/${name}`)];
const reddit = require('../../lib/acquire/RedditSubredditSuggest');
const grow = require('../../lib/acquire/SubstackKeywordsGrow');
const suggest = require('../../lib/acquire/SubstackSuggestRun');
const fonts = require('../../lib/fontAutoTag');
const lessons = require('../../lib/outreachLessons');
test.after(() => {
  aiClient.generate = realGenerate;
  aiClient._resetNoticeMemory();
  for (const name of MODULES) delete require.cache[require.resolve(`../../lib/${name}`)];
});

const SCOPE = { projectId: 'p1' };
const MODELS = {
  anthropic: { fast: 'claude-haiku-5-5', strong: 'claude-sonnet-5-5' },
  openai: { fast: 'gpt-5.4-mini', strong: 'gpt-5.5' },
};

const FEATURES = [
  {
    feature: reddit.FEATURE,
    tier: 'strong',
    reply: '{"subreddits":[{"name":"tennis","why":"players talk about coaching"}]}',
    run: async () => reddit.parseSuggestions((await reddit.defaultGenerate(SCOPE)('sys', 'ask')).text),
    usable: (out) => assert.deepEqual(out, [{ name: 'tennis', why: 'players talk about coaching' }]),
  },
  {
    feature: 'substack-miner-keywords-grow',
    tier: 'strong',
    reply: '```json\n{"topics":[{"topic":"junior tennis","writers":["ace"]}]}\n```',
    run: async () => grow.parseTopics((await grow.defaultGenerate(SCOPE)('sys', 'ask')).text),
    usable: (out) => assert.deepEqual(out, [{ topic: 'junior tennis', writers: ['ace'] }]),
  },
  {
    feature: suggest.SUBSTACK.feature,
    tier: 'strong',
    reply: '{"action":"approve","reasons":["on topic"],"confidence":"high","why":"writes about coaching"}',
    run: async () => suggest.parseSuggestion((await suggest.defaultGenerate(SCOPE, suggest.SUBSTACK.feature)('sys', 'ask')).text),
    usable: (out) => assert.equal(out.action, 'approve'),
  },
  {
    feature: suggest.YOUTUBE.feature,
    tier: 'strong',
    reply: '{"action":"reject","reasons":["off topic"],"confidence":"low","why":"cooking channel"}',
    run: async () => suggest.parseSuggestion((await suggest.defaultGenerate(SCOPE, suggest.YOUTUBE.feature)('sys', 'ask')).text),
    usable: (out) => assert.equal(out.action, 'reject'),
  },
  {
    feature: fonts.FEATURE,
    tier: 'fast',
    reply: '["retro", "playful", "vintage", "friendly"]',
    // The whole feature, with only the AI call left at its default.
    run: async () => fonts.suggestFontTags({ family: 'Test Sans', category: 'sans-serif' }, { scope: SCOPE }),
    sent: ['You label typefaces', 'Font family: Test Sans'],
    usable: (out) => {
      assert.equal(out.ok, true, out.error);
      assert.ok(out.tags.includes('retro') && out.tags.includes('playful'), JSON.stringify(out.tags));
    },
  },
  {
    feature: 'outreach-lessons',
    tier: 'strong',
    reply: '{"lessons":[{"text":"Keep the first line under ten words.","from":["F1"]}]}',
    run: async () => {
      const parsed = lessons.parseSuggestions((await lessons.defaultGenerate(SCOPE)('sys', 'ask')).text);
      return lessons.checkSuggestions(parsed, [{ action: 'rejected', reasons: ['too long'] }], []);
    },
    usable: (out) => assert.deepEqual(out.kept.map((k) => k.text), ['Keep the first line under ten words.']),
  },
];

for (const f of FEATURES) {
  const { feature } = f;
  for (const provider of ['anthropic', 'openai']) {
    test(`${feature}: a usable result when ${provider} answers`, async () => {
      calls = [];
      metered = [];
      firstProvider = provider;
      replyText = f.reply;
      aiClient._resetNoticeMemory();
      const out = await f.run();
      f.usable(out);
      assert.equal(calls.length, 1, 'one request, to the first provider');
      assert.equal(calls[0].url.includes('anthropic.com') ? 'anthropic' : 'openai', provider);
      assert.equal(calls[0].body.model, MODELS[provider][f.tier], `the ${f.tier} model`);
      // Nothing a current model refuses.
      for (const refused of ['temperature', 'top_p', 'top_k']) assert.equal(refused in calls[0].body, false, refused);
      const sent = JSON.stringify(calls[0].body);
      // The prompt reaches the provider that answered.
      for (const words of f.sent || ['sys', 'ask']) assert.ok(sent.includes(words), `${words} in ${sent}`);
      assert.ok(JSON.stringify(metered).includes(feature), `metered under ${feature}: ${JSON.stringify(metered)}`);
    });
  }
}
