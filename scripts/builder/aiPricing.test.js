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

test('honours an introductory rate, and expires it on schedule', () => {
  const during = priceCall({
    provider: 'anthropic', model: 'claude-sonnet-5',
    promptTokens: MILLION, completionTokens: MILLION, onDate: '2026-08-17',
  });
  assert.equal(during.costUsd, 12); // intro $2 + $10
  assert.equal(during.note, 'introductory rate');

  const after = priceCall({
    provider: 'anthropic', model: 'claude-sonnet-5',
    promptTokens: MILLION, completionTokens: MILLION, onDate: '2026-09-01',
  });
  // The window closing must raise the estimate on its own. A hardcoded intro
  // rate would keep under-reporting from September onward and never say so.
  assert.equal(after.costUsd, 18); // standard $3 + $15
  assert.equal(after.note, '');
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
