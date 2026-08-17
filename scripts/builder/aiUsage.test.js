'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Stub the storage layer before requiring anything that reaches for it, so the
// tests never need Supabase credentials or a network.
// ---------------------------------------------------------------------------

const observePath = require.resolve('../../lib/observeStore');
const supabasePath = require.resolve('../../lib/supabase');
const scopePath = require.resolve('../../lib/projectScope');

const logged = [];
let logUsageImpl = async (...args) => { logged.push(args); };

function stub(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath, filename: modulePath, loaded: true, children: [], paths: [], exports,
  };
}

// observeStore stub, for the aiUsage tests.
stub(observePath, { logUsage: (...args) => logUsageImpl(...args) });

const { extractUsage, recordAiUsage, USAGE_TYPE } = require('../../lib/aiUsage');

function reset() {
  logged.length = 0;
  logUsageImpl = async (...args) => { logged.push(args); };
}

// ---------------------------------------------------------------------------
// extractUsage — one shape per provider, and they disagree about every key
// ---------------------------------------------------------------------------

test('extractUsage reads Gemini usageMetadata, counting thoughts as output', () => {
  const got = extractUsage('gemini', {
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 40,
      thoughtsTokenCount: 10,
      cachedContentTokenCount: 25,
      totalTokenCount: 175,
    },
  });
  assert.deepEqual(got, {
    promptTokens: 100, completionTokens: 50, cachedTokens: 25, totalTokens: 175,
  });
});

test('extractUsage falls back to a sum when Gemini omits totalTokenCount', () => {
  const got = extractUsage('gemini', {
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });
  assert.equal(got.totalTokens, 15);
});

test('extractUsage counts Anthropic cache tokens in the total', () => {
  const got = extractUsage('anthropic', {
    usage: {
      input_tokens: 200,
      output_tokens: 60,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 10,
    },
  });
  // Cache tokens bill at a different rate, not at zero. Dropping them here is
  // how a running tally quietly under-reports a long conversation.
  assert.deepEqual(got, {
    promptTokens: 200, completionTokens: 60, cachedTokens: 40, totalTokens: 300,
  });
});

test('extractUsage reads the OpenAI Chat Completions shape', () => {
  const got = extractUsage('openai', {
    usage: {
      prompt_tokens: 80,
      completion_tokens: 20,
      total_tokens: 100,
      prompt_tokens_details: { cached_tokens: 16 },
    },
  });
  assert.deepEqual(got, {
    promptTokens: 80, completionTokens: 20, cachedTokens: 16, totalTokens: 100,
  });
});

test('extractUsage reads the OpenAI Responses shape, which renames every key', () => {
  // routes/acquire.js calls /v1/responses, where the keys are input_/output_.
  // Reading only prompt_/completion_ here would have logged 0 for that path.
  const got = extractUsage('openai', {
    usage: { input_tokens: 300, output_tokens: 70, total_tokens: 370 },
  });
  assert.deepEqual(got, {
    promptTokens: 300, completionTokens: 70, cachedTokens: 0, totalTokens: 370,
  });
});

test('extractUsage returns null when a body carries no usage at all', () => {
  assert.equal(extractUsage('anthropic', { error: { message: 'overloaded' } }), null);
  assert.equal(extractUsage('gemini', {}), null);
  assert.equal(extractUsage('openai', null), null);
  assert.equal(extractUsage('mystery-provider', { usage: { total_tokens: 5 } }), null);
});

// ---------------------------------------------------------------------------
// recordAiUsage — what actually reaches the ledger
// ---------------------------------------------------------------------------

test('recordAiUsage writes one row carrying the model and the spending feature', async () => {
  reset();
  const res = await recordAiUsage({
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    feature: 'messaging_content_suggestions',
    body: { usage: { input_tokens: 1000, output_tokens: 200 } },
    scope: { projectId: 'delray-beach-tennis-center', userId: 'u1' },
  });

  assert.deepEqual(res, { recorded: true, totalTokens: 1200 });
  // One row per call, not one per token type: observe_usage_logs has no
  // retention rule and its disk reads already hurt.
  assert.equal(logged.length, 1);

  const [provider, usageType, count, scope, metadata] = logged[0];
  assert.equal(provider, 'anthropic');
  assert.equal(usageType, USAGE_TYPE);
  assert.equal(count, 1200);
  assert.equal(scope.projectId, 'delray-beach-tennis-center');
  assert.equal(metadata.model, 'claude-sonnet-5');
  assert.equal(metadata.feature, 'messaging_content_suggestions');
  assert.equal(metadata.prompt_tokens, 1000);
  assert.equal(metadata.completion_tokens, 200);
});

test('recordAiUsage records nothing when the response has no usage block', async () => {
  reset();
  const res = await recordAiUsage({
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    feature: 'alt_text',
    body: { error: { message: 'quota exceeded' } },
  });
  assert.deepEqual(res, { recorded: false, totalTokens: 0 });
  assert.equal(logged.length, 0);
});

test('recordAiUsage never throws when the ledger write fails', async () => {
  reset();
  logUsageImpl = async () => { throw new Error('supabase unreachable'); };
  const res = await recordAiUsage({
    provider: 'openai',
    model: 'gpt-4o',
    feature: 'tag_import',
    body: { usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } },
  });
  // A telemetry outage must not fail the feature the operator was using.
  assert.deepEqual(res, { recorded: false, totalTokens: 0 });
});

test('recordAiUsage accepts a pre-extracted usage object', async () => {
  reset();
  const res = await recordAiUsage({
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    feature: 'theme_wizard',
    usage: { input_tokens: 10, output_tokens: 4 },
  });
  assert.equal(res.recorded, true);
  assert.equal(res.totalTokens, 14);
});

// ---------------------------------------------------------------------------
// observeStore.logUsage — the zero-token regression this slice had to fix
// ---------------------------------------------------------------------------

test('logUsage writes a real zero instead of coercing it to 1', async () => {
  const posted = [];
  stub(supabasePath, {
    sbQuery: async (args) => { posted.push(args); return { ok: true }; },
    tableConfig: () => ({ observeUsageLogs: 'observe_usage_logs' }),
  });
  stub(scopePath, {
    scopedInsertRow: async (_t, row) => row,
    scopedListQuery: async (_t, qs) => qs,
  });
  delete require.cache[observePath];
  const { logUsage } = require(observePath);

  await logUsage('anthropic', 'llm_tokens', 0, null, { model: 'claude-sonnet-5' });

  assert.equal(posted.length, 1);
  const row = posted[0].body[0];
  // `Number(usageCount) || 1` used to make this 1 — an invented token that
  // nothing in the ledger could distinguish from a real one.
  assert.equal(row.usage_count, 0);
  assert.equal(row.metadata.model, 'claude-sonnet-5');

  await logUsage('vercel', 'api_request');
  assert.equal(posted[1].body[0].usage_count, 1, 'an omitted count still defaults to 1');

  // Put the aiUsage stub back for any test that runs after this one.
  stub(observePath, { logUsage: (...args) => logUsageImpl(...args) });
});
