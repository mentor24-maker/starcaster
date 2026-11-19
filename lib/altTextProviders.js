'use strict';

/**
 * Network glue for the SEO Alt Text extension: a web-search call (Brave, with
 * Google Programmable Search as the built-in fallback) and a plain-text AI call.
 *
 * The AI call goes through the AI door (lib/aiClient.js `generate()`, AI switch
 * 1, SC-843) on the `fast` tier, because it fires once per image: a page of 30
 * images is 30 metered calls. It was the first caller moved onto the door. It
 * used to keep its own Anthropic → OpenAI → Gemini ladder of three hand-rolled
 * fetches, which moved on after ANY failure, including a bad request that would
 * fail the same way, on someone else's bill. The door moves on only when a
 * provider cannot pay or refuses its key, and meters the one that answered.
 *
 * lib/seoAltText.js stays pure and network-free; the route injects these.
 */

const { fetchWebSearchBatch } = require('./webSearch');
const { ALT_SYSTEM_PROMPT } = require('./seoAltText');
const { generate } = require('./aiClient');

const FEATURE = 'seo_alt_text';

const AI_TIMEOUT_MS = 20000;
const ALT_MAX_TOKENS = 128;

/**
 * Run one web search. Returns [{ title, snippet, link }] or [] when search is
 * unconfigured or errors — the caller treats results as optional grounding.
 */
async function searchFor(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const res = await fetchWebSearchBatch(q, 0).catch(() => null);
  if (!res || !res.ok || !Array.isArray(res.items)) return [];
  return res.items.map((item) => ({
    title: item.title || '',
    snippet: item.snippet || '',
    link: item.link || '',
  }));
}

/**
 * Generate alt text for one prompt through the AI door. Throws when no provider
 * could answer, or the one that did returned nothing, so the page loop can note
 * the image was skipped rather than silently write empty alt.
 * `deps` lets a test hand in its own door.
 */
async function generateAlt({ prompt, scope }, { door = generate } = {}) {
  const result = await door({
    feature: FEATURE,
    scope,
    tier: 'fast',
    system: ALT_SYSTEM_PROMPT,
    messages: String(prompt || ''),
    maxTokens: ALT_MAX_TOKENS,
    timeoutMs: AI_TIMEOUT_MS,
  });
  if (!result || !result.ok) {
    throw new Error(`Alt text could not be written: ${result?.error || 'the AI door gave no answer'}`);
  }
  const text = String(result.text || '').trim();
  if (!text) throw new Error(`Alt text could not be written: ${result.providerLabel || result.provider} answered with nothing (finish: ${result.stopReason || 'unknown'})`);
  return text;
}

module.exports = { searchFor, generateAlt };
