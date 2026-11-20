'use strict';

/**
 * Which models can this AI provider's key use? (SC-903)
 *
 * Settings › APIs › AI provider offers each provider's models as a list to
 * choose from, so nobody has to type a model name from memory, and a name
 * that is not on the list is visibly not on it. The operator asked for it on
 * 2026-11-19: "selecting the desired model from the Settings area".
 *
 * Listing models is free at every provider here, so it costs nothing and
 * sends no prompt. It runs on the SERVER with the key from the environment;
 * no key value ever reaches the browser (docs/DOCTRINE.md §4.1).
 *
 * Returns { ok: true, models: [id, ...] }
 *      or { ok: false, reason, verdict? }   reason is a sentence for the screen
 */

const TIMEOUT_MS = 15000;
const MAX_PAGES = 5;
const MAX_MODELS = 2000;

function idsFrom(def, body) {
  if (def.kind === 'gemini') {
    // "models/gemini-3.8-flash" → "gemini-3.8-flash", and only models that can
    // write text (the list also holds embedding and image models).
    return (Array.isArray(body?.models) ? body.models : [])
      .filter((m) => !Array.isArray(m?.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => String(m?.name || '').replace(/^models\//, ''));
  }
  // Anthropic and every OpenAI-style service: { data: [{ id }] }.
  return (Array.isArray(body?.data) ? body.data : []).map((m) => String(m?.id || ''));
}

/** The address and headers for one page of the list. Pure, so a test can read them. */
function listRequest(def, key, cursor) {
  if (def.kind === 'anthropic') {
    const q = new URLSearchParams({ limit: '1000' });
    if (cursor) q.set('after_id', cursor);
    return {
      url: `https://api.anthropic.com/v1/models?${q}`,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    };
  }
  if (def.kind === 'gemini') {
    const q = new URLSearchParams({ pageSize: '1000' });
    if (cursor) q.set('pageToken', cursor);
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models?${q}`,
      headers: { 'x-goog-api-key': key },
    };
  }
  return {
    url: `${String(def.baseUrl || '').replace(/\/+$/, '')}/models`,
    headers: key ? { authorization: `Bearer ${key}` } : {},
  };
}

function nextCursor(def, body) {
  if (def.kind === 'anthropic') return body?.has_more && body?.last_id ? String(body.last_id) : '';
  if (def.kind === 'gemini') return body?.nextPageToken ? String(body.nextPageToken) : '';
  return '';
}

async function readBody(res) {
  try {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return null;
  }
}

/**
 * @param {object} def  a provider definition from lib/aiClient.js (or an added service)
 * @param {{ key?: string, fetchImpl?: Function, timeoutMs?: number }} opts
 */
async function listModels(def, { key = '', fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!def || !def.kind) return { ok: false, reason: 'not a provider this screen knows' };
  if (!key && !def.listWithoutKey) {
    return { ok: false, verdict: 'NOT SET', reason: `no key yet: add ${def.keyEnv} to Doppler production, then list again` };
  }
  if (def.kind === 'openai-style' && !/^https:\/\//.test(String(def.baseUrl || ''))) {
    return { ok: false, reason: `${def.label} has no https:// address to ask` };
  }
  const { classify } = require('./aiKeys');
  const seen = new Set();
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const req = listRequest(def, key, cursor);
    let res;
    try {
      res = await fetchImpl(req.url, { headers: req.headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const why = err && err.name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 1000)}s` : String(err && err.message || err);
      return { ok: false, verdict: 'CANNOT TELL', reason: `${def.label} did not answer: ${why}` };
    }
    const body = await readBody(res);
    if (!res.ok) {
      const reading = classify(def.label, { status: res.status, body });
      return { ok: false, verdict: reading.verdict, reason: `${def.label} would not list its models: ${reading.reason}` };
    }
    for (const id of idsFrom(def, body)) if (id) seen.add(id);
    cursor = nextCursor(def, body);
    if (!cursor || seen.size >= MAX_MODELS) break;
  }
  if (!seen.size) return { ok: false, verdict: 'CANNOT TELL', reason: `${def.label} answered, but its list held no models` };
  return { ok: true, models: [...seen].slice(0, MAX_MODELS).sort((a, b) => a.localeCompare(b)) };
}

module.exports = { listModels, listRequest, idsFrom };
