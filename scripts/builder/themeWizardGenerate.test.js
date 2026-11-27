'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Two things are pinned here.
 *
 * 1. The model client's failure paths. A refusal arrives as HTTP 200 with an
 *    empty content array (spec §6.6), so code that reads content[0] blindly
 *    throws on a *successful* response. And under zero data retention some
 *    Anthropic models 400 with a message that reads like a bad payload
 *    (hazard 4.5) — worth an hour of someone's life if it isn't named.
 *
 * 2. What each step actually sends. Since SC-898 every step goes through the
 *    AI door, so these read the real door's request to each provider: the
 *    strong tier rather than a model named here, the logo and banner as
 *    images, web pages through the door's page reading.
 */

const generator = require('../../lib/themeWizardGenerator');
const { AI_PROVIDERS } = require('../../lib/aiClient');
const { fakeDoor, anthropicSays, openaiSays } = require('./fixtures/themeWizardDoor');

/** A style brief that fits STYLE_BRIEF_SCHEMA: the door checks every answer against its schema. */
const BRIEF = JSON.stringify({ sector: 'club', audience: 'families', tone: 'warm', formality: 'casual', notes: 'juniors' });

/** Anthropic's reply to a page read: it fetched `url` with its tool, then wrote `text`. */
const anthropicReadPage = (url, text) => ({
  json: {
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    content: [
      { type: 'text', text: "I'll read the page first." },
      { type: 'server_tool_use', id: 'srv_1', name: 'web_fetch', input: { url } },
      { type: 'web_fetch_tool_result', tool_use_id: 'srv_1', content: { type: 'web_fetch_result', url } },
      { type: 'text', text },
    ],
    usage: { input_tokens: 100, output_tokens: 20 },
  },
});

test('a refusal is reported, not thrown past', async (t) => {
  const door = fakeDoor({ answer: () => anthropicSays(null, 'refusal', { stop_details: { category: 'cyber' } }) });
  t.after(door.restore);
  const result = await generator.generateCandidate({ styleBrief: {}, direction: {} });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.error, /Anthropic declined/);
  assert.match(result.error, /Nothing was saved/);
});

test('the zero-retention 400 is named instead of read as a bad request, on the Anthropic path', async (t) => {
  const door = fakeDoor({
    answer: () => ({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'model not available under current data retention configuration' } } }),
  });
  t.after(door.restore);
  const result = await generator.generateCandidate({ styleBrief: {}, direction: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /30-day data retention/);
  assert.match(result.error, /account setting, not a problem with the request/);
});

test('the zero-retention wording is not put on another provider\'s 400', async (t) => {
  // It is an Anthropic account setting; saying it of OpenAI would send Dane
  // to the wrong dashboard.
  const door = fakeDoor({ order: ['openai'], answer: () => ({ status: 400, json: { error: { message: 'retention policy blocks this' } } }) });
  t.after(door.restore);
  const result = await generator.generateCandidate({ styleBrief: {}, direction: {} });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /30-day data retention/);
  assert.match(result.error, /OpenAI refused the request \(400\)/);
});

test('a non-JSON body is an error rather than an exception', async (t) => {
  const door = fakeDoor({ answer: () => anthropicSays('Sure! Here is your theme:') });
  t.after(door.restore);
  const result = await generator.generateCandidate({ styleBrief: {}, direction: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /not valid JSON/);
});

test('candidates and utility calls ask the door for its strong tier, naming no model (SC-898, option B)', async (t) => {
  const door = fakeDoor({ answer: () => anthropicSays('{}') });
  t.after(door.restore);
  await generator.generateCandidate({ styleBrief: {}, direction: {} });
  await generator.deriveDirections({ styleBrief: {} });
  assert.equal(door.sent[0].body.model, AI_PROVIDERS.anthropic.models.strong, 'not claude-fable-5 by name any more');
  assert.equal(door.sent[1].body.model, AI_PROVIDERS.anthropic.models.strong);
  assert.ok(door.sent[0].body.output_config, 'the candidate is held to its schema');
  assert.equal(generator.FEATURE, 'theme_wizard');
});

test('requests carry no sampling knobs', async (t) => {
  // temperature/top_p/top_k are rejected by these models (hazard 4.3).
  const door = fakeDoor({ answer: () => anthropicSays('{}') });
  t.after(door.restore);
  await generator.generateCandidate({ styleBrief: {}, direction: {} });
  const sent = door.sent[0].body;
  assert.equal(sent.temperature, undefined);
  assert.equal(sent.top_p, undefined);
  assert.equal(sent.top_k, undefined);
  assert.equal(sent.thinking, undefined);
});

test('the pinned values are stated in the prompt as hard constraints', async (t) => {
  const door = fakeDoor({ answer: () => anthropicSays('{}') });
  t.after(door.restore);
  await generator.generateCandidate({ styleBrief: {}, direction: {}, lockedValues: { primaryColor: '#1a4d8f' } });
  const prompt = door.sent[0].body.messages[0].content;
  assert.match(prompt, /HARD CONSTRAINTS/);
  assert.match(prompt, /primaryColor = #1a4d8f/);
});

test('earlier directions are quoted back so a round stops repeating itself', async (t) => {
  const door = fakeDoor({ answer: () => anthropicSays('{}') });
  t.after(door.restore);
  await generator.deriveDirections({ styleBrief: {}, priorDirections: ['Warm editorial serif'] });
  assert.match(door.sent[0].body.messages[0].content, /do NOT propose these again/);
  assert.match(door.sent[0].body.messages[0].content, /Warm editorial serif/);
});

/**
 * Phase 5 — the other three starting points (spec §5). Each adapter produces
 * the same style-brief shape, so everything downstream is identical regardless
 * of where the look came from. What differs is the failure modes.
 */

test('a typed brief refuses to run on an empty box', async (t) => {
  const door = fakeDoor({ answer: () => { throw new Error('no request should be made'); } });
  t.after(door.restore);
  const result = await generator.buildStyleBriefFromText({ text: '   ' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  // Caught before a request, so no tokens are spent on an empty prompt.
  assert.match(result.error, /Describe the organisation/);
  assert.equal(door.sent.length, 0);
});

test('a URL seed rejects nonsense before spending anything', async (t) => {
  const door = fakeDoor({ answer: () => { throw new Error('no request should be made'); } });
  t.after(door.restore);
  for (const bad of ['', '   ', 'not a url at all!!', 'ftp://files.example.com']) {
    const result = await generator.buildStyleBriefFromUrl({ url: bad });
    assert.equal(result.ok, false, `${bad} should be rejected`);
    assert.equal(result.status, 400);
  }
  assert.equal(door.sent.length, 0);
});

test('a bare domain is accepted and read over https, by Anthropic\'s own page reader', async (t) => {
  const door = fakeDoor({
    answer: (_def, body) => (body.tools
      ? anthropicReadPage('https://example.com/', 'A tennis club.')
      : anthropicSays(BRIEF)),
  });
  t.after(door.restore);
  const result = await generator.buildStyleBriefFromUrl({ url: 'example.com' });
  assert.equal(result.ok, true, result.error);
  assert.match(door.sent[0].body.messages[0].content, /https:\/\/example\.com/);
  assert.equal(door.sent[0].body.tools[0].name, 'web_fetch', 'the model fetches the page itself');
  // Second call normalises the prose; schema and page reading never ride together.
  assert.equal(door.sent[1].body.tools, undefined);
  assert.ok(door.sent[1].body.output_config, 'the normalising call is schema-constrained');
  assert.match(door.sent[1].body.messages[0].content, /A tennis club\./);
});

test('with Anthropic out of credit, a website seed is read by the door and sent to OpenAI as text', async (t) => {
  const door = fakeDoor({
    order: ['anthropic', 'openai'],
    answer: (def, body) => {
      if (def.id === 'anthropic') return { status: 400, json: { type: 'error', error: { message: 'Your credit balance is too low to access the Anthropic API.' } } };
      return body.response_format ? openaiSays('{"sector":"club","audience":"families","tone":"warm","formality":"casual","notes":"juniors"}') : openaiSays('A tennis club.');
    },
  });
  t.after(door.restore);
  const result = await generator.buildStyleBriefFromUrl({ url: 'example.com' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.providerLabel, 'OpenAI');
  const read = door.sent.find((s) => s.provider === 'openai');
  assert.match(read.body.messages.at(-1).content, /Delray Beach Tennis Center/, 'the page text the door read travels with the request');
});

test('a URL read that comes back empty says which address failed', async (t) => {
  const door = fakeDoor({ answer: () => anthropicSays(null) });
  t.after(door.restore);
  const result = await generator.buildStyleBriefFromUrl({ url: 'https://example.com/x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /empty response|example\.com/);
});

test('the URL adapter reports the tokens from both of its calls', async (t) => {
  // A two-call adapter that reports one call's usage under-bills the session
  // tally, which is the number a future cost throttle reads.
  const door = fakeDoor({
    answer: (_def, body) => (body.tools ? anthropicReadPage('https://example.com/', 'A tennis club.') : anthropicSays(BRIEF)),
  });
  t.after(door.restore);
  const result = await generator.buildStyleBriefFromUrl({ url: 'example.com' });
  assert.equal(generator.sumUsage(result.usage), 240, 'both calls counted');
});

test('a brand-kit seed sends the image as an image, not a description of one', async (t) => {
  const door = fakeDoor({ answer: () => anthropicSays(BRIEF) });
  t.after(door.restore);
  const result = await generator.buildStyleBriefFromImage({ imageUrl: 'https://cdn.example/logo.png' });
  assert.equal(result.ok, true, result.error);
  const blocks = door.sent[0].body.messages[0].content;
  assert.equal(blocks[0].type, 'image');
  assert.equal(blocks[0].source.url, 'https://cdn.example/logo.png');
  assert.equal(blocks[1].type, 'text');
  assert.match(blocks[1].text, /logo or brand artwork/);
});

test('with Anthropic out of credit, the logo still reaches OpenAI as a picture', async (t) => {
  const door = fakeDoor({
    order: ['anthropic', 'openai'],
    answer: (def) => (def.id === 'anthropic'
      ? { status: 400, json: { type: 'error', error: { message: 'Your credit balance is too low to access the Anthropic API.' } } }
      : openaiSays('{"sector":"club","audience":"families","tone":"warm","formality":"casual","notes":"juniors"}')),
  });
  t.after(door.restore);
  const result = await generator.buildStyleBriefFromImage({ imageUrl: 'https://cdn.example/logo.png' });
  assert.equal(result.ok, true, result.error);
  const content = door.sent[1].body.messages.at(-1).content;
  assert.equal(content[0].type, 'image_url');
  assert.equal(content[0].image_url.url, 'https://cdn.example/logo.png');
});

test('a hero banner whose address has no file extension still goes as a picture', async (t) => {
  // Photo-site links ("…/photo-1501?w=1600") carry no extension, and the door
  // refuses a file of no stated type. Before SC-898 Anthropic took these.
  const door = fakeDoor({ answer: () => anthropicSays('{}') });
  t.after(door.restore);
  const result = await generator.generateCandidate({
    styleBrief: {}, direction: {}, heroImage: { url: 'https://images.example.com/photo-1501?w=1600', note: 'dusk court' },
  });
  assert.notEqual(result.status, 400, result.error);
  const blocks = door.sent[0].body.messages[0].content;
  assert.equal(blocks[0].type, 'image');
  assert.equal(blocks[0].source.url, 'https://images.example.com/photo-1501?w=1600');
  assert.match(blocks[1].text, /hero banner this look is keyed to/);
  assert.match(blocks[1].text, /dusk court/);
  assert.match(blocks[1].text, /Produce the theme/, 'the brief rides after the banner words');
});

test('a brand-kit seed with no image refuses before spending anything', async (t) => {
  const door = fakeDoor({ answer: () => { throw new Error('no request should be made'); } });
  t.after(door.restore);
  const result = await generator.buildStyleBriefFromImage({ imageUrl: '' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Pick a logo/);
});

test('a hero reference address is checked like a website seed, and a bare domain read over https', async (t) => {
  const door = fakeDoor({ answer: () => anthropicReadPage('https://example.com/', 'A dark photo with a white headline.') });
  t.after(door.restore);
  const refused = await generator.describeHeroReference({ url: 'ftp://files.example.com' });
  assert.equal(refused.ok, false);
  assert.equal(door.sent.length, 0);
  const read = await generator.describeHeroReference({ url: 'example.com' });
  assert.equal(read.ok, true, read.error);
  assert.match(read.text, /white headline/);
  assert.match(door.sent[0].body.messages[0].content, /https:\/\/example\.com\//);
});
