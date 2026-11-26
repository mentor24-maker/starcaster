'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * The Would You Rather import reads two choices off a post image through the
 * AI door (SC-896). Before, it called Gemini alone with a retired model, so it
 * stopped whenever that one account did. The door's network, keys and order
 * are faked here, so no test spends money.
 */

const { AI_PROVIDERS } = require('../../lib/aiClient');
const ocr = require('../../lib/wyrTweetOcr');

function fakeDoor({ order, keys = order, answer }) {
  const sent = [];
  ocr.setDoorDeps({
    order: async () => ({ providers: order.map((id) => AI_PROVIDERS[id]), ignored: [], group: null, orderUsed: 'main' }),
    getKey: (def) => (keys.includes(def.id) ? `key-${def.id}` : ''),
    recordUsage: async () => {},
    postBus: async () => true,
    now: () => Date.now(),
    fetchImpl: async (url, init) => {
      const def = url.includes('generativelanguage') ? AI_PROVIDERS.gemini
        : url.includes('anthropic') ? AI_PROVIDERS.anthropic : AI_PROVIDERS.openai;
      sent.push({ provider: def.id, url, body: JSON.parse(init.body) });
      const { status = 200, json } = answer(def);
      return { ok: status < 400, status, text: async () => JSON.stringify(json) };
    },
  });
  return sent;
}

const IMAGE = Buffer.from('fake jpeg bytes');
const CHOICES = { phraseA: 'Fly', phraseB: 'Be invisible', rawText: 'Would you rather Fly OR Be invisible' };
const openai = (text) => ({ json: { model: 'gpt-5.4-mini', choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: {} } });

test('with Gemini out of credit, the post image still reaches the next provider and is read', async (t) => {
  t.after(() => ocr.setDoorDeps(null));
  const sent = fakeDoor({
    order: ['gemini', 'openai'],
    answer: (def) => (def.id === 'gemini'
      ? { status: 429, json: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, please check your plan and billing details.' } } }
      : openai(JSON.stringify(CHOICES))),
  });
  const out = await ocr.ocrImageBuffer(IMAGE, 'image/jpeg; charset=binary');
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.data, CHOICES);
  assert.equal(out.provider, 'openai');
  assert.deepEqual(sent.map((r) => r.provider), ['gemini', 'openai']);
  const part = sent[1].body.messages.at(-1).content[0];
  assert.equal(part.image_url.url, `data:image/jpeg;base64,${IMAGE.toString('base64')}`, 'the picture itself is sent, under its bare type');
  assert.equal(sent[1].body.model, AI_PROVIDERS.openai.models.fast, 'the fast tier, never a model named by hand');
});

test('a reply that is words rather than JSON is still read for the two choices', async (t) => {
  t.after(() => ocr.setDoorDeps(null));
  fakeDoor({ order: ['openai'], answer: () => openai('Would you rather fly OR be invisible?') });
  const out = await ocr.ocrImageBuffer(IMAGE, 'image/png');
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(out.data.phraseA && out.data.phraseB);
});

test('no provider able to read the picture says so, and sends nothing', async (t) => {
  t.after(() => ocr.setDoorDeps(null));
  const sent = fakeDoor({ order: ['deepseek', 'openai'], keys: ['deepseek'], answer: () => openai('{}') });
  const out = await ocr.ocrImageBuffer(IMAGE, 'image/png');
  assert.equal(out.ok, false);
  assert.equal(out.status, 503);
  assert.match(out.error, /No AI provider could answer/);
  assert.equal(sent.length, 0);
});
