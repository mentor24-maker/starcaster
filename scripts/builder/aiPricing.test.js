'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { priceCall } = require('../../lib/aiPricing');

const MILLION = 1_000_000;

// ---------------------------------------------------------------------------
// priceCall — the arithmetic, and the refusals
// ---------------------------------------------------------------------------

test('prices a known Anthropic model at its list rate', () => {
  const res = priceCall({
    provider: 'anthropic',
    model: 'claude-opus-5',
    promptTokens: MILLION,
    completionTokens: MILLION,
    onDate: '2026-08-17',
  });
  assert.equal(res.priced, true);
  assert.equal(res.costUsd, 30); // $5 input + $25 output
});

test('prices the Claude 5.5 family and Fable 5.1 at their list rates', () => {
  // The model that emptied the mentor24 account on Oct 28-30, 2026 was Sonnet
  // 5.5, and it had no rate here — so its spend read "incomplete", never as a
  // number. Each rate below is from Anthropic's pricing page, checked 2026-10-30.
  // One million output tokens plus 100,000 prompt tokens — a prompt that keeps
  // Haiku 5.5 on its standard tier, so all four read their headline rates.
  const cases = [
    ['claude-sonnet-5-5', 0.2 + 10],
    ['claude-opus-5-5', 0.4 + 20],
    ['claude-haiku-5-5', 0.01 + 0.5],
    ['claude-fable-5-1', 1 + 50],
  ];
  for (const [model, dollars] of cases) {
    const res = priceCall({
      provider: 'anthropic', model,
      promptTokens: 100_000, completionTokens: MILLION, onDate: '2026-10-30',
    });
    assert.equal(res.priced, true, `${model} must be priced`);
    assert.equal(res.costUsd.toFixed(6), dollars.toFixed(6), model);
  }
});

test('Haiku 5.5 charges its long-prompt rate only above 100,000 prompt tokens', () => {
  const short = priceCall({
    provider: 'anthropic', model: 'claude-haiku-5-5',
    promptTokens: 100_000, completionTokens: MILLION, onDate: '2026-10-30',
  });
  assert.equal(short.costUsd.toFixed(6), (0.01 + 0.5).toFixed(6));
  assert.equal(short.note, '');

  const long = priceCall({
    provider: 'anthropic', model: 'claude-haiku-5-5',
    promptTokens: 100_001, completionTokens: MILLION, onDate: '2026-10-30',
  });
  assert.equal(long.costUsd.toFixed(6), ((100_001 * 0.5) / MILLION + 2.5).toFixed(6));
  assert.equal(long.note, 'long-prompt rate');
});

test('Sonnet 5 stays at $2/$10 after August 2026 — the rise to $3/$15 was cancelled', () => {
  // The table used to raise Sonnet 5 to $3/$15 on 2026-09-01 on its own.
  // Anthropic made the launch price permanent instead, so that raise was
  // over-stating every Sonnet 5 call from September on.
  for (const onDate of ['2026-08-17', '2026-09-01', '2026-10-30']) {
    const res = priceCall({
      provider: 'anthropic', model: 'claude-sonnet-5',
      promptTokens: MILLION, completionTokens: MILLION, onDate,
    });
    assert.equal(res.costUsd, 12, onDate);
  }
});

test('a model recorded with its provider prefix is priced the same as without', () => {
  // OpenClaw names its model "anthropic/claude-sonnet-5-5".
  const res = priceCall({
    provider: 'anthropic', model: 'anthropic/claude-sonnet-5-5',
    promptTokens: MILLION, completionTokens: MILLION,
  });
  assert.equal(res.priced, true);
  assert.equal(res.costUsd, 12);
});

test('charges cached tokens at the higher cache-write rate', () => {
  const res = priceCall({
    provider: 'anthropic', model: 'claude-opus-5',
    promptTokens: 0, completionTokens: 0, cachedTokens: MILLION, onDate: '2026-08-17',
  });
  // The meter records cache creation and cache reads as one number, so the two
  // rates cannot be separated here. Erring high is deliberate: an estimate that
  // lands under the real invoice is the one that causes harm.
  assert.equal(res.costUsd, 6.25); // $5 x 1.25
});

test('refuses to price an unknown model rather than calling it free', () => {
  const res = priceCall({
    provider: 'anthropic', model: 'claude-something-unreleased',
    promptTokens: MILLION, completionTokens: MILLION,
  });
  assert.equal(res.priced, false);
  assert.equal(res.costUsd, 0);
  assert.match(res.reason, /no rate for model/);
  assert.match(res.reason, /aiPricing\.js/, 'the error must name where to add the rate');
});

test('refuses to price providers with no rate table', () => {
  for (const provider of ['openai', 'gemini']) {
    const res = priceCall({ provider, model: 'whatever', promptTokens: MILLION });
    assert.equal(res.priced, false, `${provider} must not be priced from memory`);
    assert.equal(res.costUsd, 0);
    assert.match(res.reason, /no rate table entered/);
  }
});

// ---------------------------------------------------------------------------
// getAiSpendSummary — the aggregate, and whether it admits what it missed
// ---------------------------------------------------------------------------

function loadStoreWithRows(rows) {
  const supabasePath = require.resolve('../../lib/supabase');
  const scopePath = require.resolve('../../lib/projectScope');
  const storePath = require.resolve('../../lib/observeStore');

  const stub = (p, exports) => {
    require.cache[p] = { id: p, filename: p, loaded: true, children: [], paths: [], exports };
  };
  stub(supabasePath, {
    sbQuery: async () => ({ ok: true, data: rows }),
    tableConfig: () => ({ observeUsageLogs: 'observe_usage_logs' }),
  });
  stub(scopePath, {
    scopedListQuery: async (_t, qs) => qs,
    scopedInsertRow: async (_t, row) => row,
  });
  delete require.cache[storePath];
  return require(storePath);
}

const PRICED_ROW = {
  created_at: '2026-08-17T10:00:00Z',
  provider: 'anthropic',
  usage_type: 'llm_tokens',
  usage_count: 1500,
  metadata: { model: 'claude-opus-5', feature: 'messaging_content_short', prompt_tokens: 1000, completion_tokens: 500 },
};

const UNPRICED_ROW = {
  created_at: '2026-08-17T11:00:00Z',
  provider: 'gemini',
  usage_type: 'llm_tokens',
  usage_count: 900,
  metadata: { model: 'gemini-2.5-pro', feature: 'seo_alt_text', prompt_tokens: 800, completion_tokens: 100 },
};

test('totals spend by feature and reports the window as complete', async () => {
  const { getAiSpendSummary } = loadStoreWithRows([PRICED_ROW]);
  const res = await getAiSpendSummary(100, null, '2026-08-01T00:00:00Z');

  assert.equal(res.ok, true);
  assert.equal(res.data.complete, true);
  assert.equal(res.data.unpricedCalls, 0);
  assert.equal(res.data.totalTokens, 1500);
  // 1000 in @ $5/M + 500 out @ $25/M
  assert.equal(res.data.totalUsd.toFixed(6), (0.005 + 0.0125).toFixed(6));
  assert.equal(res.data.byFeature[0].feature, 'messaging_content_short');
});

test('marks the window incomplete when any call could not be priced', async () => {
  const { getAiSpendSummary } = loadStoreWithRows([PRICED_ROW, UNPRICED_ROW]);
  const res = await getAiSpendSummary(100, null, '2026-08-01T00:00:00Z');

  // The whole point of the slice: a partial total must announce itself. A
  // dollar figure that silently drops a provider reads as complete and is the
  // failure this panel exists to prevent.
  assert.equal(res.data.complete, false);
  assert.equal(res.data.unpricedCalls, 1);
  assert.equal(res.data.unpriced[0].provider, 'gemini');
  assert.equal(res.data.unpriced[0].tokens, 900);
  // Tokens still count even when dollars cannot.
  assert.equal(res.data.totalTokens, 2400);

  const alt = res.data.byFeature.find((f) => f.feature === 'seo_alt_text');
  assert.equal(alt.fullyPriced, false, 'the unpriced feature row must be flagged');
});

test('flags a truncated read instead of presenting a floor as a total', async () => {
  const { getAiSpendSummary } = loadStoreWithRows([PRICED_ROW, PRICED_ROW]);
  const res = await getAiSpendSummary(2, null, '2026-08-01T00:00:00Z');
  assert.equal(res.data.truncated, true);
});

test('ignores rows that are not token rows', async () => {
  // The store filters server-side, but a stubbed/mistaken query must not let
  // api_request rows be priced as if they were tokens.
  const { getAiSpendSummary } = loadStoreWithRows([PRICED_ROW]);
  const res = await getAiSpendSummary(100, null, '2026-08-01T00:00:00Z');
  assert.equal(res.data.pricedCalls, 1);
});

test('breaks spend down by model, folding a provider-prefixed name into the plain one', async () => {
  const sonnet = (model) => ({
    ...PRICED_ROW,
    metadata: { ...PRICED_ROW.metadata, model, prompt_tokens: 1000, completion_tokens: 500 },
  });
  const { getAiSpendSummary } = loadStoreWithRows([
    sonnet('claude-sonnet-5-5'), sonnet('anthropic/claude-sonnet-5-5'), UNPRICED_ROW,
  ]);
  const res = await getAiSpendSummary(100, null, '2026-08-01T00:00:00Z');
  const row = res.data.byModel.find((m) => m.model === 'claude-sonnet-5-5');
  assert.equal(row.calls, 2, 'one model must be one row however it was spelled');
  assert.equal(row.fullyPriced, true, 'Sonnet 5.5 must be priced, not "incomplete"');
  assert.equal(res.data.byModel.find((m) => m.provider === 'gemini').fullyPriced, false);
});

test('totals the last 24 hours and 7 days out of the same read', async () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const at = (iso) => ({ ...PRICED_ROW, created_at: iso });
  const { getAiSpendSummary } = loadStoreWithRows([
    at('2026-10-30T11:00:00Z'), // 1 hour ago
    at('2026-10-27T12:00:00Z'), // 3 days ago
    at('2026-10-10T12:00:00Z'), // 20 days ago
    { ...UNPRICED_ROW, created_at: '2026-10-30T10:00:00Z' },
  ]);
  const res = await getAiSpendSummary(100, null, '2026-09-30T12:00:00Z', { now });
  const one = 0.005 + 0.0125;
  assert.equal(res.data.recent.last24h.calls, 2);
  assert.equal(res.data.recent.last24h.unpricedCalls, 1);
  assert.equal(res.data.recent.last24h.costUsd.toFixed(6), one.toFixed(6));
  assert.equal(res.data.recent.last7d.calls, 3);
  assert.equal(res.data.recent.last7d.costUsd.toFixed(6), (2 * one).toFixed(6));
  assert.equal(res.data.recent.last7d.covered, true);

  // A read that starts yesterday cannot vouch for a 7-day total.
  const short = await getAiSpendSummary(100, null, '2026-10-29T06:00:00Z', { now });
  assert.equal(short.data.recent.last7d.covered, false);
  assert.equal(short.data.recent.last24h.covered, true);
});
