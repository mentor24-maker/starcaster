'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * SC-884: the three outreach reply writers go through the AI door.
 *
 * On 2026-11-18 "Write replies" in the Outreach wizard failed with Anthropic's
 * "credit balance is too low", although the door (lib/aiClient.js generate,
 * SC-843) moves on to OpenAI in exactly that case. The writers called
 * queryAnthropic by name, so the door never saw them.
 *
 * Each writer's default AI call is driven here through the REAL door, with
 * the network replaced: Anthropic answers "out of credit", OpenAI answers
 * with text. The writer must get OpenAI's text back.
 */

const aiClient = require('../../lib/aiClient');

const realGenerate = aiClient.generate;
const calls = [];

function fakeDoorDeps() {
  return {
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.includes('anthropic.com')) {
        return new Response(JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' },
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        model: 'gpt-5.5',
        choices: [{ message: { content: 'written by openai' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    recordUsage: async () => {},
    postBus: async () => ({ ok: true }),
    getKey: () => 'test-key',
    order: () => aiClient.getAiProviderOrder({ env: { AI_PROVIDER_ORDER: 'anthropic,openai' } }),
    now: () => 0,
  };
}

// The writers take `generate` off aiClient when they load, so the stand-in
// must be in place first, and each writer loaded fresh.
aiClient.generate = (opts) => realGenerate(opts, fakeDoorDeps());
for (const name of ['youtubeOutreachDrafter', 'substackNotesDrafter', 'redditCommentDrafter']) {
  delete require.cache[require.resolve(`../../lib/${name}`)];
}
const writers = {
  'youtube-outreach-draft': require('../../lib/youtubeOutreachDrafter'),
  'substack-notes-draft': require('../../lib/substackNotesDrafter'),
  'reddit-comment-draft': require('../../lib/redditCommentDrafter'),
};
test.after(() => { aiClient.generate = realGenerate; aiClient._resetNoticeMemory(); });

for (const [feature, writer] of Object.entries(writers)) {
  test(`${feature}: Anthropic out of credit, OpenAI writes the reply`, async () => {
    calls.length = 0;
    aiClient._resetNoticeMemory();
    const reply = await writer.defaultGenerate({ projectId: 'p1' })('the system prompt', 'the ask');
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.text, 'written by openai');
    assert.equal(reply.provider, 'openai');
    assert.deepEqual(calls.map((c) => (c.url.includes('anthropic.com') ? 'anthropic' : 'openai')), ['anthropic', 'openai']);
    // The prompt reaches the provider that answered.
    const sent = JSON.stringify(calls[1].body);
    assert.ok(sent.includes('the system prompt') && sent.includes('the ask'), sent);
  });
}
