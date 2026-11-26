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

  const model = extraOptions.model || 'gemini-3.1-pro-preview';
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
 * Moonshot's own docs (platform.kimi.ai/docs/api/chat) that day. Gemini's 2.5 models
 * were retired for this key by 2026-11-18 (Google answered 404 "no longer
 * available" and named these replacements; checked against its model list).
 */
/** The four picture types Anthropic and OpenAI both read. */
const WEB_IMAGES = Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const BOTH_BY_ADDRESS = Object.freeze(['image', 'pdf']);
const IMAGES_BY_ADDRESS = Object.freeze(['image']);
const NONE_BY_ADDRESS = Object.freeze([]);

/*
 * `reads` (SC-895) says which files a provider can be sent with a prompt:
 * `images` the picture types, `pdf` PDFs, `byAddress` which of those
 * kinds it can be given by web address rather than as bytes. A provider with no `reads` reads text only.
 * It is deliberately what each one is KNOWN to take: a provider marked unable
 * is skipped with a plain reason and the next one answers, which costs a
 * fall-through; one wrongly marked able would turn a good request into a 400
 * that stops the call. DeepSeek, Groq's gpt-oss and OpenRouter's DeepSeek
 * defaults read text only; Mistral's picture shape differs from OpenAI's, so
 * it stays text-only until someone checks it.
 */
const AI_PROVIDERS = Object.freeze({
  anthropic: Object.freeze({
    id: 'anthropic', label: 'Anthropic', kind: 'anthropic', settingsKey: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY',
    reads: Object.freeze({ images: WEB_IMAGES, pdf: true, byAddress: BOTH_BY_ADDRESS }),
    models: Object.freeze({ fast: 'claude-haiku-4-5', strong: 'claude-sonnet-5-5' }),
  }),
  openai: Object.freeze({
    id: 'openai', label: 'OpenAI', kind: 'openai-style', settingsKey: 'openai', keyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    // A PDF goes as a `file` part carrying its bytes; chat completions takes no PDF address.
    reads: Object.freeze({ images: WEB_IMAGES, pdf: true, byAddress: IMAGES_BY_ADDRESS }),
    models: Object.freeze({ fast: 'gpt-5.4-mini', strong: 'gpt-5.5' }),
  }),
  gemini: Object.freeze({
    id: 'gemini', label: 'Google Gemini', kind: 'gemini', settingsKey: 'gemini', keyEnv: 'GEMINI_API_KEY',
    // inlineData only: a file by web address needs Google's own upload first.
    reads: Object.freeze({ images: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']), pdf: true, byAddress: NONE_BY_ADDRESS }),
    models: Object.freeze({ fast: 'gemini-3.8-flash', strong: 'gemini-3.1-pro-preview' }),
  }),
  // Kimi (Moonshot AI), asked for by Dane on 2026-11-17. Off unless named in the order.
  kimi: Object.freeze({
    id: 'kimi', label: 'Kimi', kind: 'openai-style', settingsKey: '', keyEnv: 'MOONSHOT_API_KEY',
    baseUrl: 'https://api.moonshot.ai/v1',
    // Pictures as OpenAI-style image_url parts; no PDF reading in its chat API.
    reads: Object.freeze({ images: WEB_IMAGES, pdf: false, byAddress: IMAGES_BY_ADDRESS }),
    models: Object.freeze({ fast: 'kimi-k3.1-pro-highspeed', strong: 'kimi-k3.1-pro' }),
  }),
  // ── Added 2026-11-19 (SC-903): "DeepSeek and the various other API models".
  // All off unless switched on. Every address, key name, model id and request
  // quirk below was read that day from the provider's own docs:
  //   `tokenParam`  the length setting it takes. DeepSeek, OpenRouter and
  //                 Mistral document only `max_tokens`; Mistral refuses unknown
  //                 fields and OpenRouter silently drops them, so the newer
  //                 `max_completion_tokens` would be refused or ignored.
  //   `tierExtras`  fields sent with one tier's requests only.
  deepseek: Object.freeze({
    id: 'deepseek', label: 'DeepSeek', kind: 'openai-style', settingsKey: '', keyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    tokenParam: 'max_tokens',
    // deepseek-flash tracks V4.1 Flash; deepseek-v4-pro tracks the newest Pro
    // (api-docs.deepseek.com/updates, 2026-09-10 and 2026-08-13). Its two
    // legacy names were discontinued 2026-07-24; check:models blocks them.
    models: Object.freeze({ fast: 'deepseek-flash', strong: 'deepseek-v4-pro' }),
    // DeepSeek thinks by default, at high effort: a "fast" call that reasons
    // first is neither fast nor cheap, so the fast tier switches it off.
    tierExtras: Object.freeze({ fast: Object.freeze({ thinking: Object.freeze({ type: 'disabled' }) }) }),
  }),
  // One key, hundreds of models from many companies (DeepSeek, Grok, Llama,
  // Qwen, Claude, Gemini...). Ids are vendor/model; a "~...-latest" id always
  // resolves to the newest model in that family.
  openrouter: Object.freeze({
    id: 'openrouter', label: 'OpenRouter', kind: 'openai-style', settingsKey: '', keyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    tokenParam: 'max_tokens',
    listWithoutKey: true, // its model list is public, so "List models" works before a key is added
    models: Object.freeze({ fast: '~deepseek/deepseek-flash-latest', strong: '~deepseek/deepseek-pro-latest' }),
    // Reasoning text is returned beside the answer by default; the door only
    // reads the answer, so do not pay to download the rest.
    tierExtras: Object.freeze({
      fast: Object.freeze({ reasoning: Object.freeze({ exclude: true }) }),
      strong: Object.freeze({ reasoning: Object.freeze({ exclude: true }) }),
    }),
  }),
  xai: Object.freeze({
    id: 'xai', label: 'xAI (Grok)', kind: 'openai-style', settingsKey: '', keyEnv: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1',
    reads: Object.freeze({ images: Object.freeze(['image/jpeg', 'image/png']), pdf: false, byAddress: IMAGES_BY_ADDRESS }),
    // grok-4.3 is its cheapest text model; grok-4.7 its most capable (docs.x.ai/developers/models).
    models: Object.freeze({ fast: 'grok-4.3', strong: 'grok-4.7' }),
  }),
  mistral: Object.freeze({
    id: 'mistral', label: 'Mistral', kind: 'openai-style', settingsKey: '', keyEnv: 'MISTRAL_API_KEY',
    // The native address, not /openai/v1, which Mistral calls a preview whose
    // parameters "can change".
    baseUrl: 'https://api.mistral.ai/v1',
    tokenParam: 'max_tokens',
    // Mistral Large 4 always reasons and then answers as a LIST of pieces;
    // readReply joins the text pieces.
    models: Object.freeze({ fast: 'mistral-small-latest', strong: 'mistral-large-latest' }),
  }),
  groq: Object.freeze({
    id: 'groq', label: 'Groq', kind: 'openai-style', settingsKey: '', keyEnv: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    // Groq has no "latest" names; its Llama models were withdrawn from
    // self-serve accounts on 2026-08-16 and these are its named replacements.
    models: Object.freeze({ fast: 'openai/gpt-oss-20b', strong: 'openai/gpt-oss-120b' }),
  }),
});

/** Today's behaviour: Anthropic first, then the two the alt-text ladder already used. */
const DEFAULT_PROVIDER_ORDER = Object.freeze(['anthropic', 'openai', 'gemini']);
const TIERS = Object.freeze(['fast', 'strong']);
// The ONLY key settings an added OpenAI-style service may read (SC-844
// review). An added service sends its key to an address someone typed, so it
// must never be able to name a setting that already holds a key: a built-in
// provider's, an alias of one (GOOGLE_GEMINI_API_KEY), or an unrelated secret
// (YOUTUBE_API_KEY). No existing setting starts AI_SERVICE_, so the namespace
// itself is the guard. Checked on save AND again here on read, so a row
// written before this rule, or edited by hand, cannot get round it.
const CUSTOM_KEY_ENV_RE = /^AI_SERVICE_[A-Z0-9][A-Z0-9_]{0,39}_API_KEY$/;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_TOKENS = 4096;
const NOTICE_EVERY_MS = 6 * 60 * 60 * 1000;
/** The skip verdict for a provider that cannot read the files sent (SC-895). */
const CANNOT_READ = 'CANNOT READ';

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
      if (!CUSTOM_KEY_ENV_RE.test(String(c.keyEnv || ''))) { ignored.push(entry.id); continue; }
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
let settingsCache = null; // { at, value } or { at, pending }: one reading of the row, shared by every group

/** One reading of the row as { res } or { thrown }, never a rejection. */
async function safeRead(read) {
  try {
    return { res: await read() };
  } catch (err) {
    return { thrown: String(err && err.message || err) };
  }
}

async function readSettingsCached({ readSettings, now, fresh }) {
  if (typeof readSettings === 'function') return safeRead(readSettings);
  if (!fresh && settingsCache && now - settingsCache.at < ORDER_CACHE_MS) {
    return settingsCache.pending ? settingsCache.pending : settingsCache.value;
  }
  const pending = safeRead(() => require('./aiProviderSettingsStore').readSettings());
  settingsCache = { at: now, pending };
  const value = await pending;
  if (settingsCache && settingsCache.pending === pending) settingsCache = { at: now, value };
  return value;
}

/**
 * Which providers to try, in order, and which model each uses per tier.
 * Settings › APIs first (read at most once a minute per process, so a change
 * reaches the website and the Mini within about a minute with no redeploy);
 * the environment when that row is missing or cannot be read. Never "no
 * providers" because a read failed: the fallback is today's behaviour, and
 * `fallbackReason` says why it was used so the screen can show it.
 *
 * With `feature` (AI provider groups 1, SC-872): the feature's group
 * (lib/aiFeatureGroups.js) uses its own saved order when it has one, the main
 * order otherwise. `orderUsed` says which; `groupNote` says why a group that
 * might have had its own order is on the main one (unreadable, nothing left
 * switched on, or the feature is in no group).
 *
 * Returns { providers, source: 'settings' | 'AI_PROVIDER_ORDER' | 'default', ignored,
 *           fallbackReason?, readAt, group: { id, label } | null, orderUsed: 'group' | 'main', groupNote? }.
 */
async function getAiProviderOrder({ env = process.env, readSettings, now = Date.now(), fresh = false, feature } = {}) {
  const reading = await readSettingsCached({ readSettings, now, fresh });
  const readAt = new Date(now).toISOString();
  const { res, thrown } = reading;
  const settings = res && res.ok && res.data && res.data.exists ? res.data : null;
  // A row can exist with no main order in it: saving a group's own order
  // first writes only group_orders, and Postgres fills providers with [].
  // That is "the main order was never saved", not "Dane switched every
  // provider off" (the screen refuses that), so it falls back like no row
  // at all. Reading it as an order of nothing switched AI off for every
  // group without its own order (SC-872 review).
  // The flag is lib/aiProviderSettingsStore.js normaliseRow's; an injected
  // reading that predates it is worked out the same way.
  const mainSaved = Boolean(settings && (settings.mainSaved !== undefined
    ? settings.mainSaved
    : Array.isArray(settings.providers) && settings.providers.length));

  let main;
  if (mainSaved) {
    const { providers, ignored } = orderFromSettings(settings);
    main = { providers, source: 'settings', ignored, readAt };
  } else {
    const fallbackReason = thrown !== undefined
      ? `the saved setting could not be read (${thrown})`
      : settings ? 'the main order on Settings › APIs has not been saved yet (only feature groups have been)'
        : res && res.ok ? 'nothing has been saved on Settings › APIs yet' : `the saved setting could not be read (${(res && res.error) || 'no answer'})`;
    main = { ...envProviderOrder({ env }), fallbackReason, readAt };
  }

  if (feature === undefined) return { ...main, group: null, orderUsed: 'main' };

  const { groupForFeature } = require('./aiFeatureGroups');
  const group = groupForFeature(feature);
  if (!group) {
    return { ...main, group: null, orderUsed: 'main', groupNote: `"${feature}" is in no feature group, so it uses the main order` };
  }
  const named = { id: group.id, label: group.label };
  const readable = settings || (res && res.ok && res.data && !res.data.exists);
  if (!readable) {
    return { ...main, group: named, orderUsed: 'main', groupNote: `could not read whether ${group.label} has its own order, so it uses the main order` };
  }
  const groupError = settings && settings.groupErrors && settings.groupErrors[group.id];
  if (groupError) {
    return { ...main, group: named, orderUsed: 'main', groupNote: `${group.label}'s own order could not be read (${groupError}), so it uses the main order` };
  }
  const own = settings && settings.groupOrders && settings.groupOrders[group.id];
  if (!own) return { ...main, group: named, orderUsed: 'main' };
  const { providers, ignored } = orderFromSettings({ providers: own, customProviders: settings.customProviders });
  if (!providers.length) {
    return { ...main, group: named, orderUsed: 'main', groupNote: `${group.label}'s own order has no provider this door can use switched on, so it uses the main order` };
  }
  return { providers, source: 'settings', ignored, readAt, group: named, orderUsed: 'group' };
}

/** Forget the cached reading, so the next call reads the row again (after a save in this process). */
function forgetProviderOrder() {
  settingsCache = null;
}

/** A provider's key: Settings › APIs first, then the environment. Never logged. */
function providerKeyFor(def, { env = process.env } = {}) {
  let stored = '';
  if (def.settingsKey) {
    try { stored = String((getProviderValues(def.settingsKey) || {}).api_key || ''); } catch { stored = ''; }
  }
  return String(stored || env[def.keyEnv] || '').trim();
}

/**
 * messages: a string, or [{ role, content | text, files? }] — the shape every
 * old helper took, plus `files` (SC-895): [{ mimeType, base64 }] for a file's
 * bytes, or [{ url, mimeType? }] for a file at a web address. A message with
 * no files comes out exactly as before, so a text-only request is unchanged.
 */
function normaliseMessages(messages) {
  if (!Array.isArray(messages)) return [{ role: 'user', content: String(messages || '') }];
  return messages.map((m) => {
    const out = {
      role: m && (m.role === 'assistant' || m.role === 'model') ? 'assistant' : 'user',
      content: String((m && (m.content ?? m.text)) || ''),
    };
    if (m && Array.isArray(m.files) && m.files.length) out.files = m.files.map(normaliseFile);
    return out;
  });
}

/** Guess a file's type from its address when the caller did not say. */
function mimeFromUrl(url) {
  const ext = String(url || '').split(/[?#]/)[0].split('.').pop().toLowerCase();
  return {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  }[ext] || '';
}

function normaliseFile(f) {
  const file = f || {};
  const url = typeof file.url === 'string' ? file.url.trim() : '';
  const mimeType = String(file.mimeType || (url ? mimeFromUrl(url) : '') || '').trim().toLowerCase();
  const kind = mimeType === 'application/pdf' ? 'pdf' : mimeType.startsWith('image/') ? 'image' : '';
  return url ? { kind, mimeType, url } : { kind, mimeType, base64: file.base64 };
}

const KIND_WORD = { image: 'images', pdf: 'PDFs' };

/**
 * Every file the messages carry, checked before anything is sent: { files } or
 * { error } naming the first file the door cannot send to anyone.
 */
function filesIn(messages) {
  if (!Array.isArray(messages)) return { files: [] };
  const files = [];
  for (const [i, m] of messages.entries()) {
    if (!m || !Array.isArray(m.files) || !m.files.length) continue;
    if (m.role === 'assistant' || m.role === 'model') {
      return { error: `message ${i + 1} is the AI's own reply; only the asker's messages can carry files` };
    }
    for (const [j, raw] of m.files.entries()) {
      const where = `message ${i + 1}, file ${j + 1}`;
      const f = normaliseFile(raw);
      const hasBytes = raw && raw.base64 !== undefined;
      if (raw && raw.url !== undefined && hasBytes) return { error: `${where} gives both bytes and an address; send one` };
      if (raw && raw.url !== undefined) {
        if (!/^https?:\/\//i.test(f.url || '')) return { error: `${where}: the address must start with http:// or https://` };
      } else if (typeof f.base64 !== 'string' || !f.base64.trim()) {
        return { error: `${where} has no bytes: give base64 (a string) or url` };
      }
      if (!f.kind) {
        return { error: `${where} is ${f.mimeType ? `"${f.mimeType}"` : 'of no stated type'}; the door sends images and PDFs only` };
      }
      files.push(f);
    }
  }
  return { files };
}

/** Why this provider cannot be sent these files, in plain words, or '' when it can. */
function cannotRead(def, files) {
  if (!files.length) return '';
  const reads = def.reads || {};
  for (const f of files) {
    if (f.kind === 'pdf' && !reads.pdf) return `${def.label} cannot read PDFs`;
    if (f.kind === 'image' && !(reads.images || []).length) return `${def.label} cannot read images`;
    if (f.kind === 'image' && !reads.images.includes(f.mimeType)) return `${def.label} cannot read ${f.mimeType} images`;
    if (f.url && !(reads.byAddress || []).includes(f.kind)) {
      return `${def.label} cannot fetch ${KIND_WORD[f.kind]} from a web address (send the file's bytes instead)`;
    }
  }
  return '';
}

/** One file as each provider kind wants it. */
function anthropicFilePart(f) {
  const source = f.url ? { type: 'url', url: f.url } : { type: 'base64', media_type: f.mimeType, data: f.base64 };
  return { type: f.kind === 'pdf' ? 'document' : 'image', source };
}

function openaiFilePart(f) {
  if (f.kind === 'pdf') {
    return { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${f.base64}` } };
  }
  return { type: 'image_url', image_url: { url: f.url || `data:${f.mimeType};base64,${f.base64}` } };
}

/** A message's content: the plain string when it has no files; files first, then the words, when it does. */
function contentWithFiles(m, filePart, textPart) {
  if (!m.files) return m.content;
  return [...m.files.map(filePart), ...(m.content ? [textPart(m.content)] : [])];
}

const JSON_INSTRUCTION = 'Reply with a single JSON object and nothing else: no prose, no code fences.';

function systemFor(system, json) {
  const base = String(system || '').trim();
  if (!json) return base;
  return base ? `${base}\n\n${JSON_INSTRUCTION}` : JSON_INSTRUCTION;
}

/** Build one provider's request. Pure, so a test can read exactly what would be sent. */
function buildRequest(def, model, key, { system, messages, json, maxTokens, tier }) {
  const sys = systemFor(system, json);
  const msgs = normaliseMessages(messages);
  if (def.kind === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      // No temperature: newer Claude models refuse it with a 400.
      body: {
        model,
        max_tokens: maxTokens,
        ...(sys ? { system: sys } : {}),
        messages: msgs.map((m) => (m.files
          ? { role: m.role, content: contentWithFiles(m, anthropicFilePart, (text) => ({ type: 'text', text })) }
          : m)),
      },
    };
  }
  if (def.kind === 'gemini') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: {
        ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
        contents: msgs.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: m.files
            ? contentWithFiles(m, (f) => ({ inlineData: { mimeType: f.mimeType, data: f.base64 } }), (text) => ({ text }))
            : [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
      },
    };
  }
  // openai-style: OpenAI itself, Kimi, and anything else that copies its chat API.
  // max_completion_tokens unless the provider says otherwise: OpenAI's newer
  // models, Kimi's K3, xAI and Groq all deprecate max_tokens, while DeepSeek,
  // OpenRouter and Mistral take only max_tokens (`tokenParam`). No
  // temperature, for the same reason as Claude.
  const extras = (tier && def.tierExtras && def.tierExtras[tier]) || {};
  return {
    url: `${def.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: {
      model,
      [def.tokenParam || 'max_completion_tokens']: maxTokens,
      messages: [
        ...(sys ? [{ role: 'system', content: sys }] : []),
        ...msgs.map((m) => (m.files
          ? { role: m.role, content: contentWithFiles(m, openaiFilePart, (text) => ({ type: 'text', text })) }
          : m)),
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...extras,
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
  const content = choice?.message?.content;
  // Usually a string. A reasoning model at Mistral answers with a list of
  // pieces instead, a "thinking" piece then "text" pieces: the answer is the
  // text pieces, never the thinking.
  const text = Array.isArray(content)
    ? content.filter((part) => part && part.type === 'text').map((part) => String(part.text || '')).join('')
    : String(content || '');
  return { text, stopReason: choice?.finish_reason || null, model: body?.model || requestedModel };
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
    order: (feature) => getAiProviderOrder({ feature }),
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
 * @param {string|Array} opts.messages  a prompt, or [{ role, content, files? }]
 *   files: [{ mimeType, base64 }] or [{ url, mimeType? }], images and PDFs only.
 *   A provider in the order that cannot read them is skipped with verdict
 *   'CANNOT READ' and a reason naming the provider and the file type.
 * @param {boolean} [opts.json]     true: ask for JSON and parse it; false: plain prose
 * @param {'fast'|'strong'} [opts.tier]  default 'strong'
 * @param {number} [opts.maxTokens] default 4096
 * @param {number} [opts.timeoutMs] default 60000
 * @returns {Promise<object>}
 *   { ok: true, text, json?, provider, providerLabel, model, usage, stopReason, skipped, group, groupLabel, orderUsed, orderNote? }
 *   { ok: false, code, error, status?, provider?, skipped, group, groupLabel, orderUsed, orderNote? }
 *   `group` is the feature's group id (lib/aiFeatureGroups.js) or null when it
 *   is in none; `orderUsed` is 'group' when the group's own order was used,
 *   'main' otherwise; `orderNote` says why, when the order was not the obvious one.   code: 'no_provider' | 'provider_error' | 'no_answer' | 'bad_json' | 'bad_request'
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
  const { files, error: fileError } = filesIn(opts.messages);
  if (fileError) return { ok: false, code: 'bad_request', error: `The files sent with this request: ${fileError}.`, skipped: [] };

  const ordered = await d.order(feature);
  const { providers, ignored } = ordered;
  // Which feature group asked, and which order it got (AI provider groups 1, SC-872).
  // An injected order that predates groups says nothing about them: work the group out here.
  const groupInfo = ordered.group !== undefined ? ordered.group : (() => {
    const g = require('./aiFeatureGroups').groupForFeature(feature);
    return g ? { id: g.id, label: g.label } : null;
  })();
  const routing = {
    group: groupInfo ? groupInfo.id : null,
    groupLabel: groupInfo ? groupInfo.label : null,
    orderUsed: ordered.orderUsed || 'main',
    ...(ordered.groupNote ? { orderNote: ordered.groupNote } : ordered.fallbackReason ? { orderNote: `main order from ${ordered.source === 'default' ? 'the built-in default' : ordered.source}: ${ordered.fallbackReason}` } : {}),
  };
  const skipped = [];
  for (const name of ignored || []) {
    skipped.push({ provider: name, label: name, verdict: 'UNKNOWN', reason: `"${name}" in the provider order is not a provider this door knows` });
  }

  for (const def of providers) {
    // A provider that cannot read the files is passed over like one out of
    // credit, without a request, and is never news for the bus.
    const unreadable = cannotRead(def, files);
    if (unreadable) {
      skipped.push({ provider: def.id, label: def.label, verdict: CANNOT_READ, reason: unreadable });
      continue;
    }
    const key = d.getKey(def);
    if (!key) {
      skipped.push({ provider: def.id, label: def.label, verdict: VERDICT.NOT_SET, reason: `no key set (add ${def.keyEnv})` });
      continue;
    }
    const model = def.models[tier];
    const req = buildRequest(def, model, key, { system: opts.system, messages: opts.messages, json, maxTokens, tier });
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
      return { ok: false, code: 'no_answer', provider: def.id, error: `${def.label} did not answer: ${why}`, skipped, ...routing };
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
        ...routing,
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
      ...routing,
    };
    if (json) {
      const parsed = parseJsonReply(reply.text);
      if (!parsed.ok) {
        return { ok: false, code: 'bad_json', provider: def.id, model: reply.model, text: reply.text, error: `${def.label} answered, but not with JSON (${parsed.error})`, skipped, ...routing };
      }
      out.json = parsed.value;
    }
    return out;
  }

  const reasons = skipped.map((s) => `${s.label}: ${s.reason}`).join('; ');
  const fileNote = files.length && skipped.some((s) => s.verdict === CANNOT_READ)
    ? ` No provider in the order could both read ${files.length === 1 ? 'the file' : 'the files'} sent and answer.`
    : '';
  return {
    ok: false,
    code: 'no_provider',
    error: providers.length
      ? `No AI provider could answer.${fileNote} ${reasons}.`
      : `No AI provider is set up${ignored && ignored.length ? ` (${reasons})` : ''}. Switch a provider on in Settings › APIs › AI provider, or add a provider key.`,
    skipped,
    ...routing,
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
  cannotRead,
  readReply,
  parseJsonReply,
  noticeText,
  AI_PROVIDERS,
  DEFAULT_PROVIDER_ORDER,
  TIERS,
  CUSTOM_KEY_ENV_RE,
  ORDER_CACHE_MS,
  NOTICE_EVERY_MS,
  CANNOT_READ,
  _resetNoticeMemory,
};
