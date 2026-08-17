'use strict';

/**
 * Network glue for the SEO Alt Text extension: a web-search call (Brave, with
 * Google Programmable Search as the built-in fallback) and a plain-text AI call.
 *
 * This is separate from lib/aiClient.js (formerly rogerClient.js) for a reason
 * that is now historical: that client's queryGemini() hardcodes
 * responseMimeType "application/json" and its persona wrapper forced every call
 * through the archived Tri-Agent JSON envelope — both wrong for "write one
 * sentence of alt text". So the SEO tool got its own clean call here, ordered
 * Anthropic → OpenAI → Gemini (the operator's chosen order), using a fast/cheap
 * model tier because it fires once per image.
 *
 * That fork is why AI spend here is invisible: aiClient.js is the only caller
 * that reports tokens to logUsage(). Folding these providers back into a shared
 * client — with JSON as an opt-in per call rather than a hardcoded default — is
 * tracked work, not a rewrite to attempt alongside an unrelated change.
 *
 * lib/seoAltText.js stays pure and network-free; the route injects these.
 */

const { getProviderValues } = require('./apiSettings');
const { fetchWebSearchBatch } = require('./webSearch');
const { ALT_SYSTEM_PROMPT } = require('./seoAltText');

const AI_TIMEOUT_MS = 20000;
const ALT_MAX_TOKENS = 128;

// Fast/cheap current-model tier — this runs once per image, so intelligence
// matters less than latency and cost. Bump these up if alt-text quality needs it.
const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const OPENAI_MODEL = 'gpt-4o-mini';
const GEMINI_MODEL = 'gemini-2.5-flash';

function providerKey(provider, envVar) {
  const cfg = getProviderValues(provider) || {};
  return String(cfg.api_key || process.env[envVar] || '').trim();
}

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

async function queryAnthropicPlain(prompt) {
  const apiKey = providerKey('anthropic', 'ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      system: ALT_SYSTEM_PROMPT,
      max_tokens: ALT_MAX_TOKENS,
      messages: [{ role: 'user', content: String(prompt || '') }],
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.content?.[0]?.text || '';
}

async function queryOpenAIPlain(prompt) {
  const apiKey = providerKey('openai', 'OPENAI_API_KEY');
  if (!apiKey) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: ALT_MAX_TOKENS,
      messages: [
        { role: 'system', content: ALT_SYSTEM_PROMPT },
        { role: 'user', content: String(prompt || '') },
      ],
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function queryGeminiPlain(prompt) {
  const apiKey = providerKey('gemini', 'GEMINI_API_KEY');
  if (!apiKey) return null;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: ALT_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: String(prompt || '') }] }],
      generationConfig: { maxOutputTokens: ALT_MAX_TOKENS },
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Generate alt text for one prompt, trying Anthropic → OpenAI → Gemini.
 * Throws only when every configured provider fails (so the page loop can note
 * the image was skipped rather than silently write empty alt).
 */
async function generateAlt({ prompt }) {
  const providers = [queryAnthropicPlain, queryOpenAIPlain, queryGeminiPlain];
  let lastErr = null;
  for (const call of providers) {
    try {
      const text = await call(prompt);
      if (text && text.trim()) return text.trim();
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('No AI provider is configured for alt text (set an Anthropic, OpenAI, or Gemini key in Settings → APIs).');
}

module.exports = { searchFor, generateAlt };
