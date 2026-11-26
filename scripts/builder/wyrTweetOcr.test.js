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

/*
 * SC-896 review: the reading's AI spend is charged to the project the request
 * handler is serving, never to a scope a request body names. The import used
 * to forward the body's `ocr` object straight to the reader as its options,
 * so `{ "ocr": { "scope": { "projectId": "<another project>" } } }` charged
 * another project and every honest read was metered with no project at all.
 */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('rest of a jpeg')]);
const OURS = { projectId: 'our-project', ownerUserId: 'u-1' };
const THEIRS = { projectId: 'another-project', ownerUserId: 'u-2' };

function meteredDoor() {
  const metered = [];
  const sent = [];
  ocr.setDoorDeps({
    order: async () => ({ providers: [AI_PROVIDERS.openai], ignored: [], group: null, orderUsed: 'main' }),
    getKey: () => 'key-openai',
    recordUsage: async (row) => { metered.push(row.scope); },
    postBus: async () => true,
    now: () => Date.now(),
    fetchImpl: async (url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => JSON.stringify(openai(JSON.stringify(CHOICES)).json) };
    },
  });
  return { metered, sent };
}

function stubStores(asset) {
  const assetsStore = require('../../lib/assetsStore');
  const tweetsStore = require('../../lib/messagingTweetsStore');
  assetsStore.listAssets = async () => ({ ok: true, status: 200, data: [asset] });
  assetsStore.rowToAsset = (row) => row;
  tweetsStore.listMessagingTweets = async () => ({ ok: true, status: 200, data: [] });
}

const WYR_ASSET = {
  id: 7,
  assetName: 'Would You Rather fly OR be invisible.jpg',
  assetType: 'image',
  location: `data:image/jpg;base64,${JPEG.toString('base64')}`,
};

test('the image import charges the handler\'s project, and a scope inside the body\'s ocr is ignored', async (t) => {
  t.after(() => ocr.setDoorDeps(null));
  const { metered } = meteredDoor();
  stubStores(WYR_ASSET);
  const { runAssetFieldImport } = require('../../lib/assetFieldImport');
  const out = await runAssetFieldImport({
    fromType: 'image', toType: 'tweet', includes: 'Would You Rather', dryRun: true, engineVersion: 2,
    ocr: { scope: THEIRS },
  }, OURS);
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 400));
  assert.equal(metered.length, 1, 'the picture was read once');
  assert.deepEqual(metered[0], OURS, 'metered under the handler\'s own project');
});

test('the tweet re-sync charges the scope it was called with, not one in its ocr options', async (t) => {
  t.after(() => ocr.setDoorDeps(null));
  const { metered } = meteredDoor();
  const { syncWyrTweetFromImage } = require('../../lib/wyrTweetImageSync');
  const out = await syncWyrTweetFromImage(
    { id: 3, image_asset_id: 7, content: '' },
    new Map([[7, WYR_ASSET]]),
    OURS,
    { dryRun: true, ocr: { scope: THEIRS } },
  );
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 400));
  assert.deepEqual(metered, [OURS]);
});

test('a loosely labelled picture is sent under the type the providers accept (SC-896 review)', async (t) => {
  t.after(() => ocr.setDoorDeps(null));
  const { sent } = meteredDoor();
  for (const label of ['image/jpg', 'application/octet-stream', '', 'IMAGE/JPEG; charset=binary']) {
    const out = await ocr.ocrImageBuffer(JPEG, label, OURS);
    assert.equal(out.ok, true, `${label || '(none)'}: ${JSON.stringify(out)}`);
  }
  const urls = sent.map((b) => b.messages.at(-1).content[0].image_url.url.split(';')[0]);
  assert.deepEqual(urls, Array(4).fill('data:image/jpeg'));
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(ocr.imageTypeFor(PNG_BYTES, 'application/octet-stream'), 'image/png', 'the first bytes decide an unlabelled picture');
  assert.equal(ocr.imageTypeFor(PNG_BYTES, 'image/x-png'), 'image/png');
});
