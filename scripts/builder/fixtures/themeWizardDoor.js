'use strict';

/**
 * A faked AI door for the Theme Wizard tests (SC-898). The REAL door runs,
 * `generate()` in lib/aiClient.js, with its network, keys and provider order
 * swapped for fakes through the generator's setDoorDeps seam, so a test reads
 * exactly the request each provider would have been sent.
 *
 *   order   the provider order, e.g. ['anthropic', 'openai']
 *   keys    which providers have a key (default: all in the order)
 *   answer  (def, body) => { status?, json } : what that provider sends back
 */

const { AI_PROVIDERS } = require('../../../lib/aiClient');
const generator = require('../../../lib/themeWizardGenerator');

function providerFor(url) {
  return Object.values(AI_PROVIDERS).find((d) => (d.kind === 'anthropic' ? url.startsWith('https://api.anthropic.com')
    : d.kind === 'gemini' ? url.includes('generativelanguage') : url.startsWith(d.baseUrl)));
}

function fakeDoor({ order = ['anthropic'], keys = order, answer }) {
  const sent = [];
  const usage = [];
  generator.setDoorDeps({
    order: async () => ({ providers: order.map((id) => AI_PROVIDERS[id]), ignored: [], group: null, orderUsed: 'main' }),
    getKey: (def) => (keys.includes(def.id) ? `key-${def.id}` : ''),
    recordUsage: async (row) => { usage.push(row); },
    postBus: async () => true,
    now: () => Date.now(),
    // A page the door reads itself (for a provider with no web fetch of its own).
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    pageFetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (h) => (h === 'content-type' ? 'text/html' : null) },
      text: async () => '<html><body><h1>Delray Beach Tennis Center</h1><p>Junior and adult programs.</p></body></html>',
    }),
    fetchImpl: async (url, init) => {
      const def = providerFor(url);
      const body = JSON.parse(init.body);
      sent.push({ url, provider: def.id, body });
      const { status = 200, json } = answer(def, body);
      return { ok: status < 400, status, text: async () => JSON.stringify(json) };
    },
  });
  return { sent, usage, restore: () => generator.setDoorDeps(null) };
}

/** Anthropic's reply carrying `text`, stopped for `stop`. */
const anthropicSays = (text, stop = 'end_turn', extra = {}) => ({
  json: { model: 'claude-sonnet-5-5', stop_reason: stop, content: text === null ? [] : [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 20 }, ...extra },
});

/** OpenAI's reply carrying `text`. */
const openaiSays = (text, finish = 'stop') => ({
  json: { model: 'gpt-5.5', choices: [{ message: { content: text }, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
});

/** What Anthropic answers when the account is out of credit. */
const ANTHROPIC_OUT_OF_CREDIT = {
  status: 400,
  json: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } },
};

module.exports = { fakeDoor, anthropicSays, openaiSays, ANTHROPIC_OUT_OF_CREDIT };
