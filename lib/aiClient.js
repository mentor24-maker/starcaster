'use strict';

/**
 * Shared AI client. Two layers live here:
 *
 *  1. **`generate()` — the door every AI call should go through** (AI switch 1,
 *     SC-843). Callers say WHAT they want (`feature`, `tier: 'fast'|'strong'`,
 *     `json`), never which provider or model. The door walks an ordered list of
 *     providers and uses the first one that can pay. It exists because about
 *     twenty features asked for Anthropic by name, so when that one account ran
 *     out of credit (2026-10-30 onward) they all stopped at once, while a funded
 *     OpenAI key sat unused.
 *
 *     It falls through to the next provider ONLY when a provider cannot serve
 *     anyone: out of credit, key refused, or no key set, classified by the same
 *     rules as `npm run ai-keys` (lib/aiKeys.js `classify`). Any other failure
 *     (a bad request, a timeout, a rate limit, a retired model) is returned to
 *     the caller, never retried on the next provider's bill.
 *
 *  2. **The older `queryGemini` / `queryAnthropic` / `queryOpenAI` helpers.**
 *     Kept until AI switch 3 to 5 (SC-845 to SC-847) move their callers onto
 *     the door. `queryGemini()` hardcodes `responseMimeType:
 *     "application/json"`, which is why so many features hand-rolled their own
 *     fetch() rather than reuse this file; `generate()` makes JSON opt-in.
 *
 * Every call is metered through lib/aiUsage.js (`recordAiUsage`), beside the
 * fetch, under the provider and model that ACTUALLY answered.
 * `npm run check:ai-metering` fails a file that calls a model without one.
 *
 * Callers pass `feature` (what is spending) and `scope` (which tenant).
 */

const { getProviderValues } = require('./apiSettings');
const { recordAiUsage } = require('./aiUsage');

async function queryGemini(systemPrompt, messagesOrPrompt, extraOptions = {}) {
  const cfg = getProviderValues('gemini');
  const apiKey = String(cfg.api_key || process.env.GEMINI_API_KEY || '').trim();
  
  if (!apiKey) {
    return { ok: false, error: "Missing Gemini API Key. Configure it in Settings > APIs > Google Gemini AI." };
  }

  const model = extraOptions.model || 'gemini-2.5-pro';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let contents = [];
  if (Array.isArray(messagesOrPrompt)) {
    contents = messagesOrPrompt.map(msg => {
      const parts = [{ text: String(msg.text || msg.content || '') }];
      if (msg.inlineData) {
        parts.push({ inlineData: msg.inlineData });
      }
      return {
        role: msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user',
        parts
      };
    });
  } else {
    contents = [
      {
        role: 'user',
        parts: [{ text: String(messagesOrPrompt || '') }]
      }
    ];
  }

  const payload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      responseMimeType: "application/json"
    }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  const data = await res.json();
  
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || "Gemini API error", status: res.status };
  }

  const outputText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const tokens = data?.usageMetadata?.totalTokenCount || 0;
  await recordAiUsage({
    provider: 'gemini',
    model,
    feature: extraOptions.feature,
    body: data,
    scope: extraOptions.scope,
  });
  return { ok: true, text: outputText, tokens, provider: 'gemini' };
}

async function queryAnthropic(systemPrompt, messagesOrPrompt, extraOptions = {}) {
  const cfg = getProviderValues('anthropic');
  const apiKey = String(cfg.api_key || process.env.ANTHROPIC_API_KEY || '').trim();
  
  if (!apiKey) {
    return { ok: false, error: "Missing Anthropic API Key for fallback. Configure it in Settings > APIs." };
  }

  const model = extraOptions.anthropicModel || 'claude-opus-4-8';
  const endpoint = `https://api.anthropic.com/v1/messages`;

  const messages = [];

  if (Array.isArray(messagesOrPrompt)) {
    messagesOrPrompt.forEach(msg => {
      messages.push({
        role: msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : 'user',
        content: String(msg.text || msg.content || '')
      });
    });
  } else {
    messages.push({ role: 'user', content: String(messagesOrPrompt || '') });
  }

  const payload = {
    model,
    system: systemPrompt,
    messages,
    // NOTE: temperature is intentionally omitted. Opus 4.7/4.8 reject any
    // temperature/top_p/top_k with a 400 — steer via prompting instead.
    max_tokens: Number.isInteger(extraOptions.maxTokens) && extraOptions.maxTokens > 0
      ? extraOptions.maxTokens
      : 4096
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(
      Number.isInteger(extraOptions.timeoutMs) && extraOptions.timeoutMs > 0 ? extraOptions.timeoutMs : 60000
    )
  });

  const data = await res.json();
  
  if (!res.ok) {
    const errorDetails = data && data.error ? JSON.stringify(data.error) : JSON.stringify(data);
    return { ok: false, error: errorDetails || "Anthropic API error", status: res.status };
  }

  const outputText = data?.content?.[0]?.text || '';
  const tokens = (data?.usage?.input_tokens || 0) + (data?.usage?.output_tokens || 0);
  await recordAiUsage({
    provider: 'anthropic',
    model,
    feature: extraOptions.feature,
    body: data,
    scope: extraOptions.scope,
  });
  // `usage`, `model` and `stopReason` are for callers that price a call or
  // must tell a finished answer from one cut off at max_tokens.
  return {
    ok: true,
    text: outputText,
    tokens,
    provider: 'anthropic',
    model: data?.model || model,
    usage: data?.usage || null,
    stopReason: data?.stop_reason || null,
  };
}

async function queryOpenAI(systemPrompt, messagesOrPrompt, extraOptions = {}) {
  const cfg = getProviderValues('openai');
  const apiKey = String(cfg.api_key || process.env.OPENAI_API_KEY || '').trim();
  
  if (!apiKey) {
    return { ok: false, error: "Missing OpenAI API Key for fallback. Configure it in Settings > APIs." };
  }

  const model = 'gpt-4o';
  const endpoint = `https://api.openai.com/v1/chat/completions`;

  const messages = [];
  messages.push({ role: 'system', content: systemPrompt });

  if (Array.isArray(messagesOrPrompt)) {
    messagesOrPrompt.forEach(msg => {
      messages.push({
        role: msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : 'user',
        content: String(msg.text || msg.content || '')
      });
    });
  } else {
    messages.push({ role: 'user', content: String(messagesOrPrompt || '') });
  }

  const payload = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: 8192,
    response_format: { type: "json_object" }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  const data = await res.json();
  
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || "OpenAI API error", status: res.status };
  }

  const outputText = data?.choices?.[0]?.message?.content || '';
  const tokens = data?.usage?.total_tokens || 0;
  await recordAiUsage({
    provider: 'openai',
    model,
    feature: extraOptions.feature,
    body: data,
    scope: extraOptions.scope,
  });
  return { ok: true, text: outputText, tokens, provider: 'openai' };
}

// ── The door: generate() ───────────────────────────────────────────────────

/**
 * Every provider the door knows. `kind` picks the adapter: `openai-style` is
 * any service that copies OpenAI's chat API (a base address, a key setting,
 * models), so adding one is a table entry, not code. Model ids are current as
 * of 2026-11-18 and must pass `npm run check:models`; Kimi's were read from
 * Moonshot's own docs (platform.kimi.ai/docs/api/chat) that day.
 */
const AI_PROVIDERS = Object.freeze({
  anthropic: Object.freeze({
    id: 'anthropic', label: 'Anthropic', kind: 'anthropic', settingsKey: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY',
    models: Object.freeze({ fast: 'claude-haiku-4-5', strong: 'claude-sonnet-5-5' }),
  }),
  openai: Object.freeze({
    id: 'openai', label: 'OpenAI', kind: 'openai-style', settingsKey: 'openai', keyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    models: Object.freeze({ fast: 'gpt-5.4-mini', strong: 'gpt-5.5' }),
  }),
  gemini: Object.freeze({
    id: 'gemini', label: 'Google Gemini', kind: 'gemini', settingsKey: 'gemini', keyEnv: 'GEMINI_API_KEY',
    models: Object.freeze({ fast: 'gemini-2.5-flash', strong: 'gemini-2.5-pro' }),
  }),
  // Kimi (Moonshot AI), asked for by Dane on 2026-11-17. Off unless named in the order.
  kimi: Object.freeze({
    id: 'kimi', label: 'Kimi', kind: 'openai-style', settingsKey: '', keyEnv: 'MOONSHOT_API_KEY',
    baseUrl: 'https://api.moonshot.ai/v1',
    models: Object.freeze({ fast: 'kimi-k3.1-pro-highspeed', strong: 'kimi-k3.1-pro' }),
  }),
});

/** Today's behaviour: Anthropic first, then the two the alt-text ladder already used. */
const DEFAULT_PROVIDER_ORDER = Object.freeze(['anthropic', 'openai', 'gemini']);
const TIERS = Object.freeze(['fast', 'strong']);
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_TOKENS = 4096;
const NOTICE_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * The order the environment gives: the fallback whenever the Settings screen's
 * row (AI switch 2, SC-844) is missing or cannot be read. Two kinds of setting:
 *   AI_PROVIDER_ORDER              e.g. "openai,anthropic" (unknown names are reported, not used)
 *   AI_MODEL_<PROVIDER>_<TIER>     e.g. AI_MODEL_OPENAI_FAST=gpt-5.4-mini
 * Returns { providers: [{ ...definition, models }], source, ignored }.
 */
function envProviderOrder({ env = process.env } = {}) {
  const raw = String(env.AI_PROVIDER_ORDER || '').trim();
  const names = raw ? raw.split(',').map((n) => n.trim().toLowerCase()).filter(Boolean) : [...DEFAULT_PROVIDER_ORDER];
  const ignored = [];
  const seen = new Set();
  const providers = [];
  for (const name of names) {
    const def = AI_PROVIDERS[name];
    if (!def) { ignored.push(name); continue; }
    if (seen.has(name)) continue;
    seen.add(name);
    const models = {};
    for (const tier of TIERS) {
      models[tier] = String(env[`AI_MODEL_${name.toUpperCase()}_${tier.toUpperCase()}`] || '').trim() || def.models[tier];
    }
    providers.push({ ...def, models });
  }
  return { providers, source: raw ? 'AI_PROVIDER_ORDER' : 'default', ignored };
}

/**
 * The order Settings › APIs saved, as the door's provider list: switched-off
 * providers left out, each one's models from the screen, and each added
 * OpenAI-style service built from its address and key setting NAME.
 * A provider the code knows but the saved list does not name stays off (it
 * was added after the save, the way Kimi is off until switched on).
 */
function orderFromSettings(settings) {
  const custom = new Map((settings.customProviders || []).map((c) => [c.id, c]));
  const providers = [];
  const ignored = [];
  for (const entry of settings.providers || []) {
    if (!entry.enabled) continue;
    let def = AI_PROVIDERS[entry.id];
    if (!def && custom.has(entry.id)) {
      const c = custom.get(entry.id);
      def = { id: c.id, label: c.label, kind: 'openai-style', settingsKey: '', keyEnv: c.keyEnv, baseUrl: c.baseUrl, models: {}, custom: true };
    }
    if (!def) { ignored.push(entry.id); continue; }
    const models = {};
    for (const tier of TIERS) models[tier] = entry[tier] || (def.models && def.models[tier]) || '';
    providers.push({ ...def, models });
  }
  return { providers, ignored };
}

/** How long one reading of the Settings row is used before it is read again. */
const ORDER_CACHE_MS = 60 * 1000;
let orderCache = null; // { at, value } or { at, pending }

/**
 * Which providers to try, in order, and which model each uses per tier.
 * Settings › APIs first (read at most once a minute per process, so a change
 * reaches the website and the Mini within about a minute with no redeploy);
 * the environment when that row is missing or cannot be read. Never "no
 * providers" because a read failed: the fallback is today's behaviour, and
 * `fallbackReason` says why it was used so the screen can show it.
 *
 * Returns { providers, source: 'settings' | 'AI_PROVIDER_ORDER' | 'default', ignored, fallbackReason?, readAt }.
 */
async function getAiProviderOrder({ env = process.env, readSettings, now = Date.now(), fresh = false } = {}) {
  const injected = typeof readSettings === 'function';
  if (!injected && !fresh && orderCache && now - orderCache.at < ORDER_CACHE_MS) {
    return orderCache.pending ? orderCache.pending : orderCache.value;
  }
  const read = injected ? readSettings : () => require('./aiProviderSettingsStore').readSettings();
  const pending = (async () => {
    let fallbackReason = '';
    try {
      const res = await read();
      if (res && res.ok && res.data && res.data.exists) {
        const { providers, ignored } = orderFromSettings(res.data);
        return { providers, source: 'settings', ignored, readAt: new Date(now).toISOString() };
      }
      fallbackReason = res && res.ok ? 'nothing has been saved on Settings › APIs yet' : `the saved setting could not be read (${(res && res.error) || 'no answer'})`;
    } catch (err) {
      fallbackReason = `the saved setting could not be read (${String(err && err.message || err)})`;
    }
    return { ...envProviderOrder({ env }), fallbackReason, readAt: new Date(now).toISOString() };
  })();
  if (injected) return pending;
  orderCache = { at: now, pending };
  const value = await pending;
  if (orderCache && orderCache.pending === pending) orderCache = { at: now, value };
  return value;
}

/** Forget the cached order, so the next call reads the row again (after a save in this process). */
function forgetProviderOrder() {
  orderCache = null;
}

/** A provider's key: Settings › APIs first, then the environment. Never logged. */
function providerKeyFor(def, { env = process.env } = {}) {
  let stored = '';
  if (def.settingsKey) {
    try { stored = String((getProviderValues(def.settingsKey) || {}).api_key || ''); } catch { stored = ''; }
  }
  return String(stored || env[def.keyEnv] || '').trim();
}

/** messages: a string, or [{ role, content | text }] — the shape every old helper took. */
function normaliseMessages(messages) {
  if (!Array.isArray(messages)) return [{ role: 'user', content: String(messages || '') }];
  return messages.map((m) => ({
    role: m && (m.role === 'assistant' || m.role === 'model') ? 'assistant' : 'user',
    content: String((m && (m.content ?? m.text)) || ''),
  }));
}

const JSON_INSTRUCTION = 'Reply with a single JSON object and nothing else: no prose, no code fences.';

function systemFor(system, json) {
  const base = String(system || '').trim();
  if (!json) return base;
  return base ? `${base}\n\n${JSON_INSTRUCTION}` : JSON_INSTRUCTION;
}

/** Build one provider's request. Pure, so a test can read exactly what would be sent. */
function buildRequest(def, model, key, { system, messages, json, maxTokens }) {
  const sys = systemFor(system, json);
  const msgs = normaliseMessages(messages);
  if (def.kind === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      // No temperature: newer Claude models refuse it with a 400.
      body: { model, max_tokens: maxTokens, ...(sys ? { system: sys } : {}), messages: msgs },
    };
  }
  if (def.kind === 'gemini') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: {
        ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
        contents: msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
      },
    };
  }
  // openai-style: OpenAI itself, Kimi, and anything else that copies its chat API.
  return {
    url: `${def.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    // max_completion_tokens, not max_tokens: both OpenAI's newer models and
    // Kimi's K3 deprecate the old name. No temperature, for the same reason as Claude.
    body: {
      model,
      max_completion_tokens: maxTokens,
      messages: [...(sys ? [{ role: 'system', content: sys }] : []), ...msgs],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    },
  };
}

/** What one provider's successful reply said: text, finish reason and the model that ran. */
function readReply(def, body, requestedModel) {
  if (def.kind === 'anthropic') {
    const text = (Array.isArray(body?.content) ? body.content : [])
      .filter((part) => part && part.type === 'text').map((part) => part.text || '').join('');
    return { text, stopReason: body?.stop_reason || null, model: body?.model || requestedModel };
  }
  if (def.kind === 'gemini') {
    const cand = body?.candidates?.[0];
    const text = (cand?.content?.parts || []).map((part) => part?.text || '').join('');
    return { text, stopReason: cand?.finishReason || null, model: body?.modelVersion || requestedModel };
  }
  const choice = body?.choices?.[0];
  return { text: String(choice?.message?.content || ''), stopReason: choice?.finish_reason || null, model: body?.model || requestedModel };
}

/** The usage block lib/aiUsage.js understands, for adapters whose provider name it does not know. */
function usageFor(def, body) {
  const { extractUsage } = require('./aiUsage');
  const shape = def.kind === 'openai-style' ? 'openai' : def.kind;
  return extractUsage(shape, body);
}

/** JSON as asked for: tolerate code fences, refuse anything else by name. */
function parseJsonReply(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function readBodySafe(res) {
  const text = await res.text().catch(() => '');
  try { return JSON.parse(text); } catch { return text; }
}

function errorMessageOf(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 300);
  const err = body.error;
  if (typeof err === 'string') return err.slice(0, 300);
  return String(err?.message || body.message || '').slice(0, 300);
}

// One process's memory of fall-through notices: provider id -> when it was last posted.
// Per process, not shared: a limit shared by every copy needs a database row,
// which arrives with the Settings screen (SC-844).
const noticeMemory = new Map();

function noticeText(skipped, answered, feature) {
  const why = skipped.map((s) => `${s.label} ${s.verdict === 'NOT SET' ? 'has no key' : s.verdict === 'INVALID' ? 'refused its key' : 'is out of credit'}`);
  return `AI calls are using ${answered.label}: ${why.join('; ')}. (First seen on "${feature}". It says so again in 6 hours if it is still true.)`;
}

async function announceFallThrough({ skipped, answered, feature, now, postBus }) {
  const due = skipped.filter((s) => s.verdict !== 'NOT SET').filter((s) => {
    const last = noticeMemory.get(s.provider);
    return !last || now - last >= NOTICE_EVERY_MS;
  });
  if (!due.length || typeof postBus !== 'function') return { posted: false };
  for (const s of due) noticeMemory.set(s.provider, now);
  try {
    const sent = await postBus(noticeText(due, answered, feature));
    if (sent && sent.ok === false) throw new Error(sent.why || 'not delivered');
    return { posted: true };
  } catch (err) {
    // Not delivered: forget the stamp so the next fall-through tries again.
    for (const s of due) noticeMemory.delete(s.provider);
    console.warn('[AI door] the fall-through notice was not delivered:', err && err.message);
    return { posted: false };
  }
}

function liveDoorDeps() {
  return {
    fetchImpl: (...args) => fetch(...args),
    recordUsage: (args) => recordAiUsage(args),
    postBus: (text) => require('./miniAiLimit').postBusFor()(text),
    getKey: (def) => providerKeyFor(def),
    order: () => getAiProviderOrder(),
    now: () => Date.now(),
  };
}

/**
 * Send one AI request through the first provider in the order that can pay.
 *
 * @param {object} opts
 * @param {string} opts.feature     what is spending, e.g. 'seo_alt_text' (metered under it)
 * @param {object} [opts.scope]     tenant scope for the meter
 * @param {string} [opts.system]    system prompt
 * @param {string|Array} opts.messages  a prompt, or [{ role, content }]
 * @param {boolean} [opts.json]     true: ask for JSON and parse it; false: plain prose
 * @param {'fast'|'strong'} [opts.tier]  default 'strong'
 * @param {number} [opts.maxTokens] default 4096
 * @param {number} [opts.timeoutMs] default 60000
 * @returns {Promise<object>}
 *   { ok: true, text, json?, provider, providerLabel, model, usage, stopReason, skipped }
 *   { ok: false, code, error, status?, provider?, skipped }   code: 'no_provider' | 'provider_error' | 'no_answer' | 'bad_json' | 'bad_request'
 */
async function generate(opts = {}, deps = {}) {
  const d = { ...liveDoorDeps(), ...deps };
  const feature = String(opts.feature || '').trim() || 'unknown';
  const tier = opts.tier === undefined ? 'strong' : opts.tier;
  if (!TIERS.includes(tier)) {
    return { ok: false, code: 'bad_request', error: `tier must be "fast" or "strong", not "${tier}"`, skipped: [] };
  }
  const json = Boolean(opts.json);
  const maxTokens = Number.isInteger(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : DEFAULT_MAX_TOKENS;
  const timeoutMs = Number.isInteger(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const { classify, VERDICT } = require('./aiKeys');

  const { providers, ignored } = await d.order();
  const skipped = [];
  for (const name of ignored || []) {
    skipped.push({ provider: name, label: name, verdict: 'UNKNOWN', reason: `"${name}" in the provider order is not a provider this door knows` });
  }

  for (const def of providers) {
    const key = d.getKey(def);
    if (!key) {
      skipped.push({ provider: def.id, label: def.label, verdict: VERDICT.NOT_SET, reason: `no key set (add ${def.keyEnv})` });
      continue;
    }
    const model = def.models[tier];
    const req = buildRequest(def, model, key, { system: opts.system, messages: opts.messages, json, maxTokens });
    let res;
    try {
      res = await d.fetchImpl(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // No answer at all says nothing about whether this provider can pay, so
      // it is not a reason to spend on the next one.
      const why = err && err.name === 'TimeoutError' ? `no answer within ${Math.round(timeoutMs / 1000)}s` : String(err && err.message || err);
      return { ok: false, code: 'no_answer', provider: def.id, error: `${def.label} did not answer: ${why}`, skipped };
    }
    const body = await readBodySafe(res);
    if (!res.ok) {
      const reading = classify(def.id, { status: res.status, body });
      if (reading.verdict === VERDICT.OUT_OF_CREDIT || reading.verdict === VERDICT.INVALID) {
        skipped.push({ provider: def.id, label: def.label, verdict: reading.verdict, reason: reading.reason });
        continue;
      }
      const said = errorMessageOf(body);
      return {
        ok: false,
        code: 'provider_error',
        status: res.status,
        provider: def.id,
        error: `${def.label} refused the request (${res.status})${said ? `: ${said}` : ''}`,
        skipped,
      };
    }

    const reply = readReply(def, body, model);
    const usage = usageFor(def, body);
    await d.recordUsage({ provider: def.id, model: reply.model, feature, body, usage: usage || undefined, scope: opts.scope });
    // This provider works: a later fall-through away from it is news again.
    noticeMemory.delete(def.id);
    if (skipped.some((s) => s.verdict === VERDICT.OUT_OF_CREDIT || s.verdict === VERDICT.INVALID)) {
      await announceFallThrough({ skipped, answered: def, feature, now: d.now(), postBus: d.postBus });
    }

    const out = {
      ok: true,
      text: reply.text,
      provider: def.id,
      providerLabel: def.label,
      model: reply.model,
      usage,
      stopReason: reply.stopReason,
      skipped,
    };
    if (json) {
      const parsed = parseJsonReply(reply.text);
      if (!parsed.ok) {
        return { ok: false, code: 'bad_json', provider: def.id, model: reply.model, text: reply.text, error: `${def.label} answered, but not with JSON (${parsed.error})`, skipped };
      }
      out.json = parsed.value;
    }
    return out;
  }

  const reasons = skipped.map((s) => `${s.label}: ${s.reason}`).join('; ');
  return {
    ok: false,
    code: 'no_provider',
    error: providers.length
      ? `No AI provider could answer. ${reasons}.`
      : `No AI provider is set up${ignored && ignored.length ? ` (${reasons})` : ''}. Switch a provider on in Settings › APIs › AI provider, or add a provider key.`,
    skipped,
  };
}

/** Test seam: forget every fall-through notice this process has posted. */
function _resetNoticeMemory() {
  noticeMemory.clear();
}

module.exports = {
  queryGemini,
  queryAnthropic,
  queryOpenAI,
  generate,
  getAiProviderOrder,
  envProviderOrder,
  orderFromSettings,
  forgetProviderOrder,
  providerKeyFor,
  buildRequest,
  readReply,
  parseJsonReply,
  noticeText,
  AI_PROVIDERS,
  DEFAULT_PROVIDER_ORDER,
  TIERS,
  ORDER_CACHE_MS,
  NOTICE_EVERY_MS,
  _resetNoticeMemory,
};
