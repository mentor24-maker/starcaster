'use strict';

/**
 * AI token metering — one place where every model call records what it cost.
 *
 * Why this exists as its own module rather than inside a client:
 *
 * Token logging used to live in `queryAgentPersona()` in lib/rogerClient.js and
 * was removed with the Dev Agent on 2026-08-17 (PR #300). The obvious repair —
 * put logUsage() back inside lib/aiClient.js — would have metered **2 of the 15
 * places this repo calls a model**. The other thirteen hand-rolled their own
 * fetch() because `queryGemini()` forces JSON responses, so a meter at the
 * client layer reports a few percent of the bill while looking complete.
 * That is the failure this module is shaped to avoid: the meter lives beside the
 * `fetch`, not beside the convenience wrapper, and `npm run check:ai-metering`
 * fails the build when a generation call appears without one.
 *
 * Design notes:
 *
 *  - **One row per call, not one per token type.** `observe_usage_logs` has no
 *    retention rule and already reads almost entirely off disk; repeated
 *    production dumps of tables like it exhausted the project's Disk IO budget
 *    on 2026-08-16 and took both client sites down. The prompt/completion/cache
 *    split goes in `metadata` instead, which costs no extra rows.
 *  - **Cache tokens are counted.** They bill at a different rate, not at zero,
 *    so a tally that drops them under-reports the call. Cost per rate is a
 *    later slice's job; this layer records quantities and the model that ran,
 *    which is everything that computation needs.
 *  - **Never throws, never blocks.** A telemetry failure must not fail the
 *    feature the operator was actually using.
 *
 * `usage_type` is always `llm_tokens`. The column comment in
 * docs/SQL/observe_usage_logs_setup.sql suggests `LLM_prompt_token` /
 * `LLM_completion_token`; that was aspirational and never written by any code.
 * Note that logUsage() lowercases the value, so those names could never have
 * round-tripped as written.
 */

const { logUsage } = require('./observeStore');

/** Every generation call gets one of these, so spend can be attributed. */
const USAGE_TYPE = 'llm_tokens';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalise one provider's usage block into a single shape.
 *
 * Returns `null` when the response carries no usage information at all — an
 * error body, a stubbed fetch in a test, a streamed response whose final frame
 * was dropped. `null` means "nothing to record", which is deliberately
 * different from a real zero.
 *
 * @param {string} provider 'gemini' | 'anthropic' | 'openai'
 * @param {object} body Parsed JSON response body from the provider
 * @returns {{promptTokens:number, completionTokens:number, cachedTokens:number, totalTokens:number}|null}
 */
function extractUsage(provider, body) {
  if (!body || typeof body !== 'object') return null;
  const key = String(provider || '').trim().toLowerCase();

  if (key === 'gemini') {
    const u = body.usageMetadata;
    if (!u || typeof u !== 'object') return null;
    const prompt = num(u.promptTokenCount);
    const completion = num(u.candidatesTokenCount) + num(u.thoughtsTokenCount);
    const cached = num(u.cachedContentTokenCount);
    // Gemini's own total already includes thoughts and cached content.
    const total = num(u.totalTokenCount) || prompt + completion + cached;
    return { promptTokens: prompt, completionTokens: completion, cachedTokens: cached, totalTokens: total };
  }

  if (key === 'anthropic') {
    const u = body.usage;
    if (!u || typeof u !== 'object') return null;
    const prompt = num(u.input_tokens);
    const completion = num(u.output_tokens);
    const cached = num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
    // Anthropic reports no total; cache tokens are billed on top of input.
    return {
      promptTokens: prompt,
      completionTokens: completion,
      cachedTokens: cached,
      totalTokens: prompt + completion + cached,
    };
  }

  if (key === 'openai') {
    const u = body.usage;
    if (!u || typeof u !== 'object') return null;
    // Chat Completions says prompt_/completion_tokens; the Responses API says
    // input_/output_tokens. routes/acquire.js uses the latter.
    const prompt = num(u.prompt_tokens) || num(u.input_tokens);
    const completion = num(u.completion_tokens) || num(u.output_tokens);
    const cached = num(u.prompt_tokens_details?.cached_tokens)
      || num(u.input_tokens_details?.cached_tokens);
    const total = num(u.total_tokens) || prompt + completion;
    return { promptTokens: prompt, completionTokens: completion, cachedTokens: cached, totalTokens: total };
  }

  return null;
}

/**
 * Record what one model call cost. Fire-and-forget: await it if convenient,
 * ignore it if not — it resolves either way and never rejects.
 *
 * @param {object} args
 * @param {string} args.provider 'gemini' | 'anthropic' | 'openai'
 * @param {string} args.model Model id that actually ran, e.g. 'claude-sonnet-5'
 * @param {string} args.feature Which part of the app spent this, e.g. 'crm_contact_enrich'
 * @param {object} [args.body] Raw parsed provider response; usage is read from it
 * @param {object} [args.usage] Pre-extracted usage, if the caller already has one
 * @param {object} [args.scope] Project scope ({ projectId, userId }) when available
 * @returns {Promise<{recorded: boolean, totalTokens: number}>}
 */
async function recordAiUsage({ provider, model, feature, body, usage, scope } = {}) {
  try {
    const counts = usage && typeof usage === 'object' && !Array.isArray(usage)
      ? {
        promptTokens: num(usage.promptTokens ?? usage.input_tokens ?? usage.prompt_tokens),
        completionTokens: num(usage.completionTokens ?? usage.output_tokens ?? usage.completion_tokens),
        cachedTokens: num(usage.cachedTokens),
        totalTokens: num(usage.totalTokens),
      }
      : extractUsage(provider, body);

    if (!counts) return { recorded: false, totalTokens: 0 };

    const totalTokens = counts.totalTokens
      || counts.promptTokens + counts.completionTokens + counts.cachedTokens;

    await logUsage(provider, USAGE_TYPE, totalTokens, scope || null, {
      model: String(model || 'unknown'),
      feature: String(feature || 'unknown'),
      prompt_tokens: counts.promptTokens,
      completion_tokens: counts.completionTokens,
      cached_tokens: counts.cachedTokens,
    });

    return { recorded: true, totalTokens };
  } catch (err) {
    // Telemetry must never break the caller. observeStore already swallows its
    // own failures; this catches anything thrown before it is reached.
    console.warn('[AiUsage] metering failed for', provider, err && err.message);
    return { recorded: false, totalTokens: 0 };
  }
}

module.exports = { extractUsage, recordAiUsage, USAGE_TYPE };
