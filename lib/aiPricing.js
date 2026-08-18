'use strict';

/**
 * What an AI call cost, in dollars.
 *
 * Slice 1 (PR #316) records tokens. This turns tokens into money, which is the
 * number the operator actually needs: the card that pays these bills is the
 * same one he buys groceries with.
 *
 * Three rules follow from that, and they are the whole design:
 *
 *  1. **An unknown model is never $0.** It is `priced: false`, and the caller
 *     must surface the gap. A total that silently omits a provider is worse
 *     than no total, because it invites trust it has not earned.
 *  2. **Rates are dated and sourced.** Every entry says where the number came
 *     from and when it was checked. Model pricing moves; a stale rate that
 *     looks authoritative is the same failure as an unknown model priced at
 *     zero, just slower.
 *  3. **Estimates round up, never down.** Where this layer cannot tell two
 *     rates apart, it charges the higher one (see cached tokens below). An
 *     estimate that comes in under the real bill is the one that hurts.
 *
 * These are LIST rates for direct API use. They do not describe Claude Code,
 * Claude.ai subscriptions, or anything bought through Bedrock/Vertex, which
 * bill separately and are not metered here at all.
 */

/** Rates in dollars per million tokens. */
const MILLION = 1_000_000;

/**
 * Anthropic list pricing. Source: Anthropic model documentation, checked
 * 2026-08-17. `intro` windows carry an end date because promotional rates
 * expire on their own and would otherwise under-report from that day on.
 */
const ANTHROPIC_RATES = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': {
    input: 3,
    output: 15,
    // Introductory pricing runs through 2026-08-31. After that the standard
    // rate applies automatically — no code change, no silent under-report.
    intro: { input: 2, output: 10, until: '2026-08-31' },
  },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/**
 * Rates we do NOT have. Listed explicitly rather than omitted, so the panel can
 * say "OpenAI is unpriced" instead of quietly reporting less spend than
 * happened. Fill these in from each provider's own pricing page — and put the
 * date you checked in the comment, the way the Anthropic block does.
 *
 * Deliberately left empty rather than filled from memory: a wrong rate here
 * produces a confident wrong number, which is the exact failure this file is
 * shaped to avoid.
 */
const UNPRICED_PROVIDERS = {
  openai: 'no rate table entered — add OpenAI list prices to lib/aiPricing.js',
  gemini: 'no rate table entered — add Google Gemini list prices to lib/aiPricing.js',
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Pick the rate in effect on `onDate` (ISO yyyy-mm-dd), honouring intro windows. */
function ratesFor(model, onDate) {
  const entry = ANTHROPIC_RATES[String(model || '').trim()];
  if (!entry) return null;
  if (entry.intro && String(onDate || '') <= entry.intro.until) {
    return { input: entry.intro.input, output: entry.intro.output, note: 'introductory rate' };
  }
  return { input: entry.input, output: entry.output, note: '' };
}

/**
 * Price one metered call.
 *
 * @param {object} row
 * @param {string} row.provider 'anthropic' | 'openai' | 'gemini'
 * @param {string} row.model Model id recorded by lib/aiUsage.js
 * @param {number} row.promptTokens
 * @param {number} row.completionTokens
 * @param {number} row.cachedTokens Cache creation + cache reads, combined
 * @param {string} [row.onDate] ISO date the call happened (defaults to today)
 * @returns {{priced: boolean, costUsd: number, reason: string, note: string}}
 */
function priceCall({ provider, model, promptTokens, completionTokens, cachedTokens, onDate } = {}) {
  const key = String(provider || '').trim().toLowerCase();
  const day = String(onDate || new Date().toISOString().slice(0, 10));

  if (UNPRICED_PROVIDERS[key]) {
    return { priced: false, costUsd: 0, reason: UNPRICED_PROVIDERS[key], note: '' };
  }

  const rates = ratesFor(model, day);
  if (!rates) {
    return {
      priced: false,
      costUsd: 0,
      reason: `no rate for model "${model}" — add it to lib/aiPricing.js`,
      note: '',
    };
  }

  const input = num(promptTokens);
  const output = num(completionTokens);
  const cached = num(cachedTokens);

  // Cache creation bills at 1.25x input and cache reads at ~0.1x, but the meter
  // records only their sum, so the two cannot be told apart here. Charge the
  // higher rate: this over-states a cache-heavy call rather than under-stating
  // it, and erring high is the whole point (rule 3 above).
  const costUsd = (input * rates.input + output * rates.output + cached * rates.input * 1.25) / MILLION;

  return { priced: true, costUsd, reason: '', note: rates.note };
}

/** Every model this file can price — for the panel's "rates as of" footer. */
function pricedModels() {
  return Object.keys(ANTHROPIC_RATES).sort();
}

module.exports = { priceCall, pricedModels, ANTHROPIC_RATES, UNPRICED_PROVIDERS };
