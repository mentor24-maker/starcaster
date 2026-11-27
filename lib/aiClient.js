'use strict';

/**
 * Shared AI client: the door every AI generation call goes through.
 *
 * **`generate()`** (AI switch 1, SC-843). Callers say WHAT they want
 * (`feature`, `tier: 'fast'|'strong'`, `json`), never which provider or model.
 * The door walks an ordered list of providers and uses the first one that can
 * pay. It exists because about twenty features asked for Anthropic by name, so
 * when that one account ran out of credit (2026-10-30 onward) they all stopped
 * at once, while a funded OpenAI key sat unused.
 *
 * It falls through to the next provider ONLY when a provider cannot serve
 * anyone: out of credit, key refused, or no key set, classified by the same
 * rules as `npm run ai-keys` (lib/aiKeys.js `classify`). Any other failure (a
 * bad request, a timeout, a rate limit, a retired model) is returned to the
 * caller, never retried on the next provider's bill. JSON is opt-in (`json`).
 *
 * The older one-provider helpers (`queryGemini`, `queryAnthropic`,
 * `queryOpenAI`) were deleted in SC-922 once AI switch 3 to 5 (SC-845 to
 * SC-847) had moved every caller onto the door. `npm run check:ai-door` still
 * refuses those names, so they cannot come back.
 *
 * Every call is metered through lib/aiUsage.js (`recordAiUsage`), beside the
 * fetch, under the provider and model that ACTUALLY answered.
 * `npm run check:ai-metering` fails a file that calls a model without one.
 *
 * Callers pass `feature` (what is spending) and `scope` (which tenant).
 */

const { getProviderValues } = require('./apiSettings');
const { recordAiUsage } = require('./aiUsage');

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
 * defaults read text only.
 *
 * Mistral (SC-924), read 2026-11-27 from docs.mistral.ai/capabilities/vision/
 * and the model cards docs.mistral.ai/models/mistral-small-4-0-26-03 and
 * docs.mistral.ai/models/mistral-large-4-0: a picture part is
 * `{ type: 'image_url', image_url: '<address or data: URL>' }`, the address a
 * plain STRING where OpenAI wraps it as `{ url }` (`imageUrlAsString`); the
 * page shows both a base64 data: URL and a public https address. It lists PNG,
 * JPEG, WEBP and single-frame GIF, at most 10 MB and 8 pictures a request.
 * GIF is left out here: the door cannot tell an animated GIF from a still one,
 * and an animated one would be a 400. mistral-small-latest is Small 4 (its
 * card names that alias) and Large 4 is the model the door's
 * mistral-large-latest answers as (its replies carry the reasoning-list shape
 * readReply handles); both cards list image input. The vision page's
 * "Recommended" list names Large 4 but not Small 4, and no page read names
 * the mistral-large-latest alias outright; Large 3 reads pictures too, so
 * either resolution is safe. PDFs go through Mistral's separate OCR service,
 * not the chat call, so `pdf` stays false.
 */
const AI_PROVIDERS = Object.freeze({
  anthropic: Object.freeze({
    id: 'anthropic', label: 'Anthropic', kind: 'anthropic', settingsKey: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY',
    reads: Object.freeze({ images: WEB_IMAGES, pdf: true, byAddress: BOTH_BY_ADDRESS }),
    // SC-897: reads a named web page itself (its web fetch tool), and holds an
    // answer to a JSON Schema itself (output_config).
    fetchesPages: true, holdsSchema: true,
    models: Object.freeze({ fast: 'claude-haiku-5-5', strong: 'claude-sonnet-5-5' }),
  }),
  openai: Object.freeze({
    id: 'openai', label: 'OpenAI', kind: 'openai-style', settingsKey: 'openai', keyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    // A PDF goes as a `file` part carrying its bytes; chat completions takes no PDF address.
    reads: Object.freeze({ images: WEB_IMAGES, pdf: true, byAddress: IMAGES_BY_ADDRESS }),
    holdsSchema: true, // response_format json_schema
    models: Object.freeze({ fast: 'gpt-5.4-mini', strong: 'gpt-5.5' }),
  }),
  gemini: Object.freeze({
    id: 'gemini', label: 'Google Gemini', kind: 'gemini', settingsKey: 'gemini', keyEnv: 'GEMINI_API_KEY',
    // inlineData only: a file by web address needs Google's own upload first.
    reads: Object.freeze({ images: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']), pdf: true, byAddress: NONE_BY_ADDRESS }),
    holdsSchema: true, // generationConfig.responseJsonSchema
    models: Object.freeze({ fast: 'gemini-3.8-flash', strong: 'gemini-3.1-pro-preview' }),
  }),
  // `fetchesPages` / `holdsSchema` (SC-897), like `reads`, mark only what a
  // provider is KNOWN to do. One without `fetchesPages` is sent the page's text,
  // read by the door; one without `holdsSchema` is asked for plain JSON with
  // the schema in its instructions, and the door checks the answer. Both still
  // work; marking one able that is not would turn every such call into a 400.
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
    // Pictures only, as a plain-string image_url (see the note above AI_PROVIDERS).
    reads: Object.freeze({ images: Object.freeze(['image/jpeg', 'image/png', 'image/webp']), pdf: false, byAddress: IMAGES_BY_ADDRESS }),
    imageUrlAsString: true,
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
/** The skip verdict for a provider the door could not read a page for, passed over for one that reads pages itself (SC-897). */
const CANNOT_READ_PAGE = 'CANNOT READ PAGE';

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

/** Mistral's picture part: the same image_url, but the address is a plain string (SC-924). */
function plainAddressImagePart(f) {
  return { type: 'image_url', image_url: f.url || `data:${f.mimeType};base64,${f.base64}` };
}

/** A message's content: the plain string when it has no files; files first, then the words, when it does. */
function contentWithFiles(m, filePart, textPart) {
  if (!m.files) return m.content;
  return [...m.files.map(filePart), ...(m.content ? [textPart(m.content)] : [])];
}

const JSON_INSTRUCTION = 'Reply with a single JSON object and nothing else: no prose, no code fences.';

function systemFor(system, json, schemaInPrompt) {
  const base = String(system || '').trim();
  if (!json) return base;
  // A provider that cannot be handed the schema is told it in words (SC-897);
  // the door checks the answer against it either way.
  const instruction = schemaInPrompt
    ? `${JSON_INSTRUCTION}\nThe JSON object must match this JSON Schema exactly:\n${JSON.stringify(schemaInPrompt)}`
    : JSON_INSTRUCTION;
  return base ? `${base}\n\n${instruction}` : instruction;
}

/** The name OpenAI-style structured answers carry (letters, digits, _ and - only). */
const SCHEMA_NAME = 'answer';

/** The tool a provider that fetches pages itself is given (Anthropic's web fetch, as the Theme Wizard uses it). */
const ANTHROPIC_WEB_FETCH = 'web_fetch_20260209';

/**
 * The words added to the asker's last message for `pages` (SC-897): the
 * addresses, for a provider that reads them itself; each page's text, read by
 * the door, for one that cannot.
 */
function pagesNote(def, pages) {
  if (def.fetchesPages) {
    return `Read ${pages.length === 1 ? 'this web page' : 'these web pages'} with your web fetch tool before answering:\n`
      + pages.map((p) => `- ${p.url}`).join('\n');
  }
  return pages.map((p) => {
    if (typeof p.text !== 'string') throw new Error(`buildRequest: ${def.label} cannot fetch ${p.url} itself, so the page's text must be given`);
    const from = p.finalUrl && p.finalUrl !== p.url ? ` (it moved to ${p.finalUrl})` : '';
    const cut = p.truncated ? `\n[The page was longer; only its first ${p.text.length} characters are shown.]` : '';
    return `The text of the web page ${p.url}${from}, read for you:\n<<<PAGE\n${quotedPage(p.text)}\nPAGE>>>${cut}`;
  }).join('\n\n');
}

/** A page's text with the quote markers it could otherwise use to end its own quote broken up. */
function quotedPage(text) {
  return String(text).replace(/<<<PAGE/g, '<<< PAGE').replace(/PAGE>>>/g, 'PAGE >>>');
}

/** The messages with `note` added to the asker's last message (or as a new one when there is none). */
function withNote(msgs, note) {
  if (!note) return msgs;
  const out = msgs.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i].role === 'user') {
      out[i].content = out[i].content ? `${out[i].content}\n\n${note}` : note;
      return out;
    }
  }
  return [...out, { role: 'user', content: note }];
}

/**
 * Build one provider's request. Pure, so a test can read exactly what would be sent.
 * `schema` (a JSON Schema) implies `json`. `pages` is [{ url }] for a provider
 * that fetches pages itself, [{ url, text, finalUrl?, truncated? }] otherwise.
 * With neither, the request is byte-for-byte what it was before SC-897.
 */
function buildRequest(def, model, key, { system, messages, json, maxTokens, tier, schema, pages }) {
  const wantsJson = Boolean(json || schema);
  const sys = systemFor(system, wantsJson, schema && !def.holdsSchema ? schema : null);
  const msgs = withNote(normaliseMessages(messages), pages && pages.length ? pagesNote(def, pages) : '');
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
        ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
        // A couple of spare fetches, for a page that redirects or links on.
        ...(pages && pages.length ? { tools: [{ type: ANTHROPIC_WEB_FETCH, name: 'web_fetch', max_uses: pages.length + 2 }] } : {}),
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
        // responseJsonSchema, not responseSchema: responseSchema takes Google's
        // OpenAPI subset and refuses `additionalProperties`, which every schema
        // written for Claude's or OpenAI's strict answers carries.
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(wantsJson ? { responseMimeType: 'application/json' } : {}),
          ...(schema ? { responseJsonSchema: schema } : {}),
        },
      },
    };
  }
  // openai-style: OpenAI itself, Kimi, and anything else that copies its chat API.
  // max_completion_tokens unless the provider says otherwise: OpenAI's newer
  // models, Kimi's K3, xAI and Groq all deprecate max_tokens, while DeepSeek,
  // OpenRouter and Mistral take only max_tokens (`tokenParam`). No
  // temperature, for the same reason as Claude.
  const extras = (tier && def.tierExtras && def.tierExtras[tier]) || {};
  const responseFormat = schema && def.holdsSchema
    ? { type: 'json_schema', json_schema: { name: SCHEMA_NAME, schema, strict: true } }
    : wantsJson ? { type: 'json_object' } : null;
  return {
    url: `${def.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: {
      model,
      [def.tokenParam || 'max_completion_tokens']: maxTokens,
      messages: [
        ...(sys ? [{ role: 'system', content: sys }] : []),
        ...msgs.map((m) => (m.files
          ? { role: m.role, content: contentWithFiles(m, def.imageUrlAsString ? plainAddressImagePart : openaiFilePart, (text) => ({ type: 'text', text })) }
          : m)),
      ],
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...extras,
    },
  };
}

/** What one provider's successful reply said: text, finish reason and the model that ran. */
function readReply(def, body, requestedModel) {
  if (def.kind === 'anthropic') {
    const blocks = Array.isArray(body?.content) ? body.content : [];
    // A turn that ran a server tool (the page reader) usually opens with a
    // sentence BEFORE the tool call ("I'll read the page first.") and gives
    // its answer AFTER the result. Joining both glued that sentence onto the
    // JSON and every pages+json answer failed as bad_json (SC-897 review).
    // The answer is the text after the last tool result; a reply with no
    // tool blocks reads exactly as before.
    let lastTool = -1;
    blocks.forEach((part, i) => {
      if (part && typeof part.type === 'string' && (part.type === 'server_tool_use' || part.type.endsWith('_tool_result'))) lastTool = i;
    });
    const text = blocks.slice(lastTool + 1)
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

// ── Holding an answer to a JSON Schema (SC-897) ───────────────────────────

/** A JSON value's type in a schema's words. */
function jsonTypeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(type, v) {
  const actual = jsonTypeOf(v);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return type === actual;
}

function pathPlus(path, key) {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

/**
 * The part of `root` a local $ref names: `#` is the whole schema, `#/a/b` a
 * JSON Pointer into it. null when it names nothing here (a remote address, or
 * a pointer that leads nowhere), and the caller leaves that part unchecked.
 */
function resolveRef(ref, root) {
  const s = String(ref || '');
  if (s === '#' || s === '#/') return root && typeof root === 'object' ? root : null;
  if (!s.startsWith('#/')) return null;
  let at = root;
  for (const raw of s.slice(2).split('/')) {
    let key;
    try { key = decodeURIComponent(raw); } catch { key = raw; }
    key = key.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!at || typeof at !== 'object' || !Object.prototype.hasOwnProperty.call(at, key)) return null;
    at = at[key];
  }
  return at === undefined ? null : at;
}

/**
 * The first way `value` does not fit `schema`, naming the field, or '' when it
 * fits. Covers the JSON Schema a structured answer uses: type, enum, const,
 * properties, required, additionalProperties, items, anyOf/oneOf/allOf, local
 * $ref (to the root `#` or any `#/...` pointer), and the length, size and
 * pattern limits. An unknown keyword (format, say), or a $ref that names
 * nothing in this schema, is not checked, never treated as a failure.
 */
function schemaMismatch(schema, value, path = '', root = schema, depth = 0) {
  const where = path || 'the answer';
  if (schema === true || schema === undefined || schema === null) return '';
  if (schema === false) return `${where} is not allowed`;
  if (typeof schema !== 'object' || depth > 64) return '';
  if (schema.$ref) {
    const target = resolveRef(schema.$ref, root);
    if (target === null) return '';
    return schemaMismatch(target, value, path, root, depth + 1);
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, value))) return `${where} should be ${types.join(' or ')}, but is ${jsonTypeOf(value)}`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    return `${where} should be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}, but is ${JSON.stringify(value)}`;
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    return `${where} should be ${JSON.stringify(schema.const)}, but is ${JSON.stringify(value)}`;
  }
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      const bad = schemaMismatch(sub, value, path, root, depth + 1);
      if (bad) return bad;
    }
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((sub) => !schemaMismatch(sub, value, path, root, depth + 1))) {
    return `${where} fits none of the shapes allowed for it`;
  }
  if (Array.isArray(schema.oneOf)) {
    const fits = schema.oneOf.filter((sub) => !schemaMismatch(sub, value, path, root, depth + 1)).length;
    if (fits !== 1) return `${where} should fit exactly one of the shapes allowed for it, but fits ${fits}`;
  }
  const t = jsonTypeOf(value);
  if (t === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) return `${where} is shorter than ${schema.minLength} characters`;
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) return `${where} is longer than ${schema.maxLength} characters`;
    if (typeof schema.pattern === 'string') {
      let re = null;
      try { re = new RegExp(schema.pattern, 'u'); } catch { re = null; }
      if (re && !re.test(value)) return `${where} does not match the pattern ${schema.pattern}`;
    }
  }
  if (t === 'number' || t === 'integer') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${where} is below ${schema.minimum}`;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${where} is above ${schema.maximum}`;
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return `${where} should be above ${schema.exclusiveMinimum}`;
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return `${where} should be below ${schema.exclusiveMaximum}`;
  }
  if (t === 'array') {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) return `${where} has ${value.length} item(s), fewer than ${schema.minItems}`;
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) return `${where} has ${value.length} item(s), more than ${schema.maxItems}`;
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      for (const [i, item] of value.entries()) {
        const bad = schemaMismatch(schema.items, item, pathPlus(path, i), root, depth + 1);
        if (bad) return bad;
      }
    }
  }
  if (t === 'object') {
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.prototype.hasOwnProperty.call(value, name)) return `${pathPlus(path, name)} is missing`;
    }
    for (const [name, v] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(props, name)) {
        const bad = schemaMismatch(props[name], v, pathPlus(path, name), root, depth + 1);
        if (bad) return bad;
      } else if (schema.additionalProperties === false) {
        return `${pathPlus(path, name)} is not a field the shape allows`;
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const bad = schemaMismatch(schema.additionalProperties, v, pathPlus(path, name), root, depth + 1);
        if (bad) return bad;
      }
    }
  }
  return '';
}

// ── Reading a named web page (SC-897) ──────────────────────────────────────
//
// For a provider that cannot fetch a page itself, the door reads it and sends
// the text. That makes the server fetch an address a caller named, so: http and
// https only, never a private network address (checked before the request AND
// at connect time, so a name that changes its answer between the two cannot get
// round it), every redirect checked the same way, a size cap and a time limit.

const PAGE_MAX_COUNT = 5;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const PAGE_MAX_CHARS = 60000;
const PAGE_TIMEOUT_MS = 15000;
const PAGE_MAX_REDIRECTS = 5;
const PAGE_TEXT_TYPES = /^(text\/[a-z.+-]+|application\/(xhtml\+xml|xml|json|ld\+json))$/;

const net = require('net');
const BLOCKED_ADDRESSES = (() => {
  const list = new net.BlockList();
  for (const [a, bits] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ]) list.addSubnet(a, bits, 'ipv4');
  for (const [a, bits] of [
    // ::/96 is the old "IPv4-compatible" range (it holds :: and ::1 too), and
    // ::ffff:0:0:0/96 the "IPv4-translated" one: neither is a public web host.
    ['::', 96], ['::ffff:0:0:0', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
    ['2001:db8::', 32], ['64:ff9b::', 96], ['100::', 64], ['2002::', 16],
  ]) list.addSubnet(a, bits, 'ipv6');
  return list;
})();

/** An IPv6 address as its eight 16-bit numbers, however it is written (`::`, a dotted tail, hex). */
function ipv6Groups(v6) {
  let s = String(v6).toLowerCase();
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    s = `${s.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split('::');
  const left = head ? head.split(':') : [];
  const right = rest === undefined ? [] : (rest ? rest.split(':') : []);
  const fill = rest === undefined ? [] : Array(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((g) => parseInt(g, 16));
}

/**
 * The IPv4 address an IPv4-mapped IPv6 one (::ffff:a.b.c.d, in dotted or hex
 * form) stands for, or ''. The other forms that carry one (::a.b.c.d and
 * ::ffff:0:a.b.c.d) are blocked whole in BLOCKED_ADDRESSES.
 */
function embeddedIpv4(v6) {
  const g = ipv6Groups(v6);
  if (g.length !== 8 || g.some((n) => !Number.isInteger(n))) return '';
  if (g.slice(0, 5).some((n) => n !== 0) || g[5] !== 0xffff) return '';
  return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
}

/** True for any address a public web page cannot be on: loopback, private, link-local, reserved. */
function isPrivateAddress(address) {
  const a = String(address || '').replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(a);
  if (family === 4) return BLOCKED_ADDRESSES.check(a, 'ipv4');
  if (family === 6) {
    const v4 = embeddedIpv4(a);
    if (v4) return BLOCKED_ADDRESSES.check(v4, 'ipv4');
    return BLOCKED_ADDRESSES.check(a, 'ipv6');
  }
  return true; // not an address at all: never something to connect to
}

function privateError(host, address) {
  const err = new Error(`${host} is on a private network (${address}); the door reads public pages only`);
  err.code = 'PRIVATE_ADDRESS';
  return err;
}

/** A dns.lookup that refuses a name with any private address, for the page request's own connect. */
function guardedLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : (typeof options === 'number' ? { family: options } : options || {});
  require('dns').lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    if (!addresses || !addresses.length) return cb(new Error(`${hostname} has no address`));
    const bad = addresses.find((x) => isPrivateAddress(x.address));
    if (bad) return cb(privateError(hostname, bad.address));
    if (opts.all) return cb(null, addresses);
    return cb(null, addresses[0].address, addresses[0].family);
  });
}

/**
 * The live page request: node's http/https with guardedLookup, so the address
 * that is checked is the address that is connected to. Follows no redirect
 * (the door checks each one) and stops reading past `maxBytes`.
 */
function livePageFetch(url, { signal, maxBytes = PAGE_MAX_BYTES, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? require('https') : require('http');
    const req = mod.request(u, { method: 'GET', headers, lookup: guardedLookup, signal }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error(`the page is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: { get: (name) => { const v = res.headers[String(name).toLowerCase()]; return Array.isArray(v) ? v.join(', ') : (v ?? null); } },
          text: async () => text,
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, code.toLowerCase()) ? ENTITIES[code.toLowerCase()] : whole;
  });
}

/** A web page's readable words: its title and description, then the body text with the markup taken out. */
function pageText(body, contentType) {
  const raw = String(body || '');
  if (!/html|xml/.test(contentType) && !/^\s*<(!doctype html|html)\b/i.test(raw)) return raw.replace(/\r\n?/g, '\n').trim();
  const title = (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(raw) || [])[1] || '';
  const desc = (/<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i.exec(raw) || [''])[0];
  const descMatch = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(desc) || [];
  const descText = descMatch[1] || descMatch[2] || '';
  const text = raw
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|section|article|header|footer|main|nav|aside|li|ul|ol|h[1-6]|tr|table|blockquote|pre|form)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const clean = (s) => decodeEntities(s).replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return [title && `Title: ${clean(title)}`, descText && `Description: ${clean(descText)}`, clean(text)].filter(Boolean).join('\n\n');
}

/** Refuse an address the door must not read, before any request: { ok } or { ok: false, error }. */
async function checkPageAddress(url, lookup) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, error: 'is not a web address' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'is not an http or https address' };
  if (u.username || u.password) return { ok: false, error: 'carries a user name or password; the door reads public pages only' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    return isPrivateAddress(host) ? { ok: false, error: privateError(host, host).message } : { ok: true };
  }
  let addresses;
  try {
    addresses = await lookup(host);
  } catch (err) {
    return { ok: false, error: `could not be looked up (${err && err.code || err && err.message || err})` };
  }
  if (!Array.isArray(addresses) || !addresses.length) return { ok: false, error: `${host} has no address` };
  const bad = addresses.find((x) => isPrivateAddress(x && x.address));
  return bad ? { ok: false, error: privateError(host, bad.address).message } : { ok: true };
}

/**
 * Read one page for a provider that cannot: { ok: true, url, finalUrl, text, truncated }
 * or { ok: false, url, error }. Never an empty page sent as if it were read.
 */
async function readPage(url, { fetchImpl, lookup, timeoutMs = PAGE_TIMEOUT_MS }) {
  // ONE deadline for the whole page, lookups and every redirect included, so
  // a chain of slow hops cannot stretch one page into minutes.
  const deadline = Date.now() + timeoutMs;
  const late = () => ({ ok: false, url, error: `${url} could not be read: no answer within ${Math.round(timeoutMs / 1000)}s` });
  const timedLookup = (host) => {
    const left = deadline - Date.now();
    if (left <= 0) return Promise.reject(Object.assign(new Error('timed out'), { code: 'ETIMEOUT' }));
    let timer;
    return Promise.race([
      Promise.resolve().then(() => lookup(host)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'ETIMEOUT' })), left); }),
    ]).finally(() => clearTimeout(timer));
  };
  let at = url;
  for (let hop = 0; hop <= PAGE_MAX_REDIRECTS; hop += 1) {
    const allowed = await checkPageAddress(at, timedLookup);
    if (!allowed.ok) return Date.now() >= deadline ? late() : { ok: false, url, error: `${at} ${allowed.error}` };
    const left = deadline - Date.now();
    if (left <= 0) return late();
    let res;
    const signal = AbortSignal.timeout(left);
    try {
      res = await fetchImpl(at, {
        method: 'GET',
        redirect: 'manual',
        headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1', 'user-agent': 'StarCaster-AI-door/1.0 (reads one page it was asked to)' },
        maxBytes: PAGE_MAX_BYTES,
        signal,
      });
    } catch (err) {
      const timedOut = signal.aborted || (err && (err.name === 'TimeoutError' || err.name === 'AbortError'));
      const why = timedOut ? `no answer within ${Math.round(timeoutMs / 1000)}s` : String(err && err.message || err);
      return { ok: false, url, error: `${at} could not be read: ${why}` };
    }
    const location = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : null;
    if (res.status >= 300 && res.status < 400 && location) {
      try { at = new URL(location, at).href; } catch { return { ok: false, url, error: `${at} redirected to an address that is not one (${location})` }; }
      continue;
    }
    if (!res.ok) return { ok: false, url, error: `${at} answered ${res.status}` };
    const type = String((res.headers && typeof res.headers.get === 'function' && res.headers.get('content-type')) || '').split(';')[0].trim().toLowerCase();
    if (type && !PAGE_TEXT_TYPES.test(type)) {
      return { ok: false, url, error: `${at} is ${type}, not a web page${type === 'application/pdf' || type.startsWith('image/') ? ' (send it as a file instead)' : ''}` };
    }
    let body;
    try { body = await res.text(); } catch (err) { return { ok: false, url, error: `${at} could not be read: ${err && err.message || err}` }; }
    if (Buffer.byteLength(body, 'utf8') > PAGE_MAX_BYTES) return { ok: false, url, error: `${at} is larger than ${PAGE_MAX_BYTES / 1024 / 1024} MB` };
    const full = pageText(body, type);
    if (!full) return { ok: false, url, error: `${at} has no readable text` };
    const truncated = full.length > PAGE_MAX_CHARS;
    return { ok: true, url, finalUrl: at, text: truncated ? full.slice(0, PAGE_MAX_CHARS) : full, truncated };
  }
  return { ok: false, url, error: `${url} redirected more than ${PAGE_MAX_REDIRECTS} times` };
}

/** The pages asked for, checked before anything is sent: { pages: [url] } or { error }. */
function pagesIn(raw) {
  if (raw === undefined || raw === null) return { pages: [] };
  if (!Array.isArray(raw)) return { error: 'pages must be a list of web addresses' };
  if (raw.length > PAGE_MAX_COUNT) return { error: `at most ${PAGE_MAX_COUNT} pages can be read in one request, not ${raw.length}` };
  const pages = [];
  for (const [i, p] of raw.entries()) {
    const url = typeof p === 'string' ? p.trim() : '';
    let u = null;
    try { u = new URL(url); } catch { u = null; }
    if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return { error: `page ${i + 1} must be an address starting with http:// or https://` };
    pages.push(u.href);
  }
  return { pages };
}

/** An address reduced to what two spellings of one page share: no scheme, no www., no #part, no trailing /. */
function samePageKey(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return String(url || '').trim().toLowerCase(); }
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.hostname.replace(/^www\./, '')}${u.port ? `:${u.port}` : ''}${path}${u.search}`;
}

/**
 * What a provider that fetched the pages itself (Anthropic) did with each page
 * it was asked to read: a page counts as read only when a fetch of THAT page
 * (by the address asked for, or the one it landed on) came back with the page.
 * Any page left unread fails the call, as it does when the door reads them:
 * a reply must never say a page was read when it was not.
 */
function providerPageReads(body, pages) {
  const blocks = Array.isArray(body?.content) ? body.content : [];
  const asked = new Map();
  for (const b of blocks) {
    if (b && b.type === 'server_tool_use' && b.name === 'web_fetch') asked.set(b.id, b.input && b.input.url);
  }
  const okKeys = new Set();
  const errorsByKey = new Map();
  const errors = [];
  for (const b of blocks) {
    if (!b || b.type !== 'web_fetch_tool_result' || !b.content) continue;
    const requested = asked.get(b.tool_use_id);
    // ONLY `web_fetch_result` is a page that was read. The API names a failure
    // `web_fetch_tool_result_error` (SC-897 review 3: the door looked for
    // `web_fetch_tool_error` and so counted every real failure as a read), and
    // any type this door does not know is a failure too, never a read.
    if (b.content.type === 'web_fetch_result') {
      if (requested) okKeys.add(samePageKey(requested));
      if (b.content.url) okKeys.add(samePageKey(b.content.url));
    } else {
      const code = b.content.error_code || `unrecognised fetch result ${JSON.stringify(String(b.content.type || '(no type)'))}`;
      errors.push(code);
      if (requested) errorsByKey.set(samePageKey(requested), code);
    }
  }
  const unread = [];
  const perPage = pages.map((url) => {
    const key = samePageKey(url);
    if (okKeys.has(key)) return { url, readBy: 'provider' };
    const error = errorsByKey.get(key) || 'not read';
    unread.push({ url, error });
    return { url, readBy: 'provider', error };
  });
  return { perPage, unread, errors };
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

// The six-hour limit on fall-through notices (SC-925). The limit that counts is
// SHARED: one row per provider (docs/SQL/ai_fall_through_notices_setup.sql,
// lib/aiProviderSettingsStore.js claimFallThroughNotice), so every copy of the
// server, on Vercel and on the Mini, posts one notice between them and a cold
// start forgets nothing.
//
// This Map is one process's memory: provider id -> { at, shared }. `at` is
// when this copy last knew the notice to have been posted, so a copy that has
// already seen the stamp does not ask the database again for six hours (one
// store call per copy per six hours, not one per AI call during an outage).
// `shared` says the stamp is in the shared row, so a provider that answers
// again clears it there too. When the shared row cannot be read or written,
// the Map alone limits the notice, as it did before the row existed, and the
// door logs that it fell back (landmine 15: never reported as a shared save).
const noticeMemory = new Map();
/** How long a store call may hold up an AI reply before the door stops waiting for it. */
const NOTICE_STORE_TIMEOUT_MS = 3000;
let warnedNoDatabase = false;

function noticeText(skipped, answered, feature) {
  const why = skipped.map((s) => `${s.label} ${s.verdict === 'NOT SET' ? 'has no key' : s.verdict === 'INVALID' ? 'refused its key' : 'is out of credit'}`);
  return `AI calls are using ${answered.label}: ${why.join('; ')}. (First seen on "${feature}". It says so again in 6 hours if it is still true.)`;
}

/** One store call as its envelope, never a rejection and never longer than the bound. */
async function noticeStoreCall(fn, timeoutMs = NOTICE_STORE_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, status: 504, error: `no answer within ${timeoutMs / 1000} seconds` }), timeoutMs); }),
    ]);
  } catch (err) {
    return { ok: false, status: 500, error: String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function warnNoticeFallback(provider, res) {
  // A copy with no database at all (a test, a fresh folder) says so once, not on every fall-through.
  if (res && res.status === 503) {
    if (warnedNoDatabase) return;
    warnedNoDatabase = true;
  }
  console.warn(`[AI door] the shared six-hour limit on the fall-through notice could not be used for ${provider} (${(res && res.error) || 'no answer'}); falling back to this server copy's own memory, so other copies may post the same notice.`);
}

/**
 * Is this provider's notice due, and may this copy post it? Asks the shared
 * row only when this copy's own memory does not already know a notice went out
 * inside the six hours. Returns { due, stamp? } (`stamp` when the shared row
 * was claimed, so a notice that fails to deliver can give it back).
 */
async function claimNotice(provider, { now, store, memory, timeoutMs }) {
  const known = memory.get(provider);
  if (known && now - known.at < NOTICE_EVERY_MS) return { due: false };
  if (store && typeof store.claim === 'function') {
    const res = await noticeStoreCall(() => store.claim(provider, { now, everyMs: NOTICE_EVERY_MS }), timeoutMs);
    if (res && res.ok && res.data && res.data.claimed) {
      memory.set(provider, { at: now, shared: true });
      return { due: true, stamp: res.data.stamp };
    }
    if (res && res.ok && res.data) {
      // Another copy posted it inside the six hours: remember when, and leave it.
      const at = Number.isFinite(res.data.lastPostedAt) && res.data.lastPostedAt <= now ? res.data.lastPostedAt : now;
      memory.set(provider, { at, shared: true });
      return { due: false };
    }
    warnNoticeFallback(provider, res);
  } else {
    warnNoticeFallback(provider, { status: 503, error: 'no shared store was given to the door' });
  }
  memory.set(provider, { at: now, shared: false });
  return { due: true };
}

async function announceFallThrough({ skipped, answered, feature, now, postBus, store, memory = noticeMemory, timeoutMs }) {
  const { VERDICT } = require('./aiKeys');
  if (typeof postBus !== 'function') return { posted: false };
  // Only a provider that is out of credit or refused its key is news. One with
  // no key is a setting, and one that cannot read the file sent (CANNOT READ)
  // is working perfectly: announcing it as "out of credit" would be false, and
  // stamping its clock would hide a real outage of it for six hours.
  const news = skipped.filter((s) => s.verdict === VERDICT.OUT_OF_CREDIT || s.verdict === VERDICT.INVALID);
  const due = [];
  for (const s of news) {
    const claim = await claimNotice(s.provider, { now, store, memory, timeoutMs });
    if (claim.due) due.push({ ...s, stamp: claim.stamp });
  }
  if (!due.length) return { posted: false };
  try {
    const sent = await postBus(noticeText(due, answered, feature));
    if (sent && sent.ok === false) throw new Error(sent.why || 'not delivered');
    return { posted: true };
  } catch (err) {
    // Not delivered: forget the stamp, here and in the shared row, so the next fall-through tries again.
    for (const s of due) {
      memory.delete(s.provider);
      if (s.stamp && store && typeof store.release === 'function') {
        const res = await noticeStoreCall(() => store.release(s.provider, s.stamp), timeoutMs);
        if (!res || !res.ok) console.warn(`[AI door] the shared notice stamp for ${s.provider} could not be cleared after a failed post (${(res && res.error) || 'no answer'}); it clears itself in 6 hours.`);
      }
    }
    console.warn('[AI door] the fall-through notice was not delivered:', err && err.message);
    return { posted: false };
  }
}

/**
 * A provider answered: a later fall-through away from it is news again. Writes
 * to the shared row only when this copy knows a stamp is set there, so an
 * ordinary successful call costs no database write.
 */
async function forgetNotice(provider, { store, memory = noticeMemory, timeoutMs }) {
  const known = memory.get(provider);
  if (!known) return;
  memory.delete(provider);
  if (!known.shared || !store || typeof store.clear !== 'function') return;
  // Clears only the stamp this copy knows of (or an older one): a newer stamp
  // another copy wrote for a fresh outage stays, so its notice is not repeated.
  const res = await noticeStoreCall(() => store.clear(provider, new Date(known.at).toISOString()), timeoutMs);
  if (!res || !res.ok) console.warn(`[AI door] the shared notice stamp for ${provider} could not be cleared now that it answers (${(res && res.error) || 'no answer'}); it clears itself in 6 hours.`);
}

function liveNoticeStore() {
  const store = () => require('./aiProviderSettingsStore');
  return {
    claim: (provider, opts) => store().claimFallThroughNotice(provider, opts),
    release: (provider, stamp) => store().releaseFallThroughNotice(provider, stamp),
    clear: (provider, stamp) => store().clearFallThroughNotice(provider, stamp),
  };
}

function liveDoorDeps() {
  return {
    fetchImpl: (...args) => fetch(...args),
    recordUsage: (args) => recordAiUsage(args),
    postBus: (text) => require('./miniAiLimit').postBusFor()(text),
    // The shared six-hour limit on the fall-through notice (SC-925), and this copy's own memory of it.
    noticeStore: liveNoticeStore(),
    noticeMemory,
    noticeStoreTimeoutMs: NOTICE_STORE_TIMEOUT_MS,
    getKey: (def) => providerKeyFor(def),
    order: (feature) => getAiProviderOrder({ feature }),
    pageFetchImpl: livePageFetch,
    lookup: (host) => require('dns').promises.lookup(host, { all: true }),
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
 * @param {object} [opts.schema]    a JSON Schema the answer must fit (implies json). Handed to the
 *   provider as its own structured-answer setting where it has one (`holdsSchema`), written into
 *   the instructions where it does not; the answer is checked against it either way, and one that
 *   does not fit is `bad_json` naming the field. `schemaBy` says 'provider' or 'door'.
 * @param {string[]} [opts.pages]   web pages (http/https, at most 5) the AI reads before answering.
 *   A provider that fetches pages itself (`fetchesPages`) is given the addresses and its fetch tool;
 *   for any other the door reads each page (public addresses only, 2 MB, 15s) and sends its text.
 *   `pages` on the reply is [{ url, readBy: 'provider' | 'door', ... }]. A page that cannot be read
 *   is `page_unreadable`, never sent empty.
 * @param {'fast'|'strong'} [opts.tier]  default 'strong'
 * @param {number} [opts.maxTokens] default 4096
 * @param {number} [opts.timeoutMs] default 60000
 * @returns {Promise<object>}
 *   { ok: true, text, json?, provider, providerLabel, model, usage, stopReason, skipped, group, groupLabel, orderUsed, orderNote? }
 *   { ok: false, code, error, status?, provider?, skipped, group, groupLabel, orderUsed, orderNote? }
 *   (code 'bad_json' also carries providerLabel, text and stopReason, so a caller can tell a reply
 *   cut off at its length limit from one that was simply not JSON)
 *   `group` is the feature's group id (lib/aiFeatureGroups.js) or null when it
 *   is in none; `orderUsed` is 'group' when the group's own order was used,
 *   'main' otherwise; `orderNote` says why, when the order was not the obvious one.
 *   code: 'no_provider' | 'provider_error' | 'no_answer' | 'bad_json' | 'bad_request' | 'page_unreadable'
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
  const schema = opts.schema === undefined || opts.schema === null ? null : opts.schema;
  if (schema !== null && (typeof schema !== 'object' || Array.isArray(schema))) {
    return { ok: false, code: 'bad_request', error: 'schema must be a JSON Schema object', skipped: [] };
  }
  const wantsJson = json || Boolean(schema);
  const { pages, error: pageError } = pagesIn(opts.pages);
  if (pageError) return { ok: false, code: 'bad_request', error: `The pages asked for: ${pageError}.`, skipped: [] };
  // An injected fetch is the test seam for pages too, so a test never reaches the network.
  const pageFetch = deps.pageFetchImpl || (deps.fetchImpl ? deps.fetchImpl : d.pageFetchImpl);
  let doorPages = null; // read once, the first time a provider that cannot fetch pages is reached
  let doorPageFailure = null; // set when the door could not read a page; later providers that cannot fetch are passed over

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

  for (const [index, def] of providers.entries()) {
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
    if (pages.length && !def.fetchesPages && !doorPages && !doorPageFailure) {
      const reads = [];
      for (const url of pages) {
        const page = await readPage(url, { fetchImpl: pageFetch, lookup: d.lookup });
        if (!page.ok) {
          doorPageFailure = {
            error: page.error,
            pages: [
              ...reads.map((p) => ({ url: p.url, readBy: 'door', finalUrl: p.finalUrl, chars: p.text.length, truncated: p.truncated })),
              { url, readBy: 'door', error: page.error },
              ...pages.slice(reads.length + 1).map((u) => ({ url: u, readBy: 'door', error: 'not tried (an earlier page could not be read)' })),
            ],
          };
          break;
        }
        reads.push(page);
      }
      if (!doorPageFailure) doorPages = reads;
    }
    if (pages.length && !def.fetchesPages && doorPageFailure) {
      // The door cannot read the page, so no provider that relies on the door
      // can be sent it. A provider later in the order that reads pages itself
      // (Anthropic) may still get through where this server was refused.
      const later = providers.slice(index + 1).find((p) => p.fetchesPages && !cannotRead(p, files));
      if (later) {
        skipped.push({ provider: def.id, label: def.label, verdict: CANNOT_READ_PAGE, reason: `the page could not be read for it (${doorPageFailure.error}); trying ${later.label}, which reads pages itself` });
        continue;
      }
      // Nobody was asked: the page, not a provider, is what failed.
      return { ok: false, code: 'page_unreadable', provider: null, error: `The page could not be read: ${doorPageFailure.error}.`, pages: doorPageFailure.pages, skipped, ...routing };
    }
    const model = def.models[tier];
    const sendPages = pages.length ? (def.fetchesPages ? pages.map((url) => ({ url })) : doorPages) : undefined;
    const req = buildRequest(def, model, key, { system: opts.system, messages: opts.messages, json: wantsJson, maxTokens, tier, ...(schema ? { schema } : {}), ...(sendPages ? { pages: sendPages } : {}) });
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
    await forgetNotice(def.id, { store: d.noticeStore, memory: d.noticeMemory, timeoutMs: d.noticeStoreTimeoutMs });

    const providerReads = pages.length && def.fetchesPages ? providerPageReads(body, pages) : null;
    const pagesRead = !pages.length ? undefined : def.fetchesPages
      ? providerReads.perPage
      : doorPages.map((p) => ({ url: p.url, readBy: 'door', finalUrl: p.finalUrl, chars: p.text.length, truncated: p.truncated }));
    const pageInfo = pagesRead ? { pages: pagesRead } : {};
    if (pages.length && def.fetchesPages) {
      // Anthropic runs its fetch tool inside the one request; it can stop
      // part-way (pause_turn) or answer without ever reading a page.
      if (reply.stopReason === 'pause_turn') {
        return { ok: false, code: 'no_answer', provider: def.id, model: reply.model, error: `${def.label} stopped before finishing (it was still reading the pages)`, ...pageInfo, skipped, ...routing };
      }
      if (providerReads.unread.length) {
        const all = providerReads.unread.length === pages.length;
        const named = providerReads.unread.map((p) => (p.error === 'not read' ? p.url : `${p.url} (${p.error})`)).join(', ');
        const why = all && !providerReads.errors.length
          ? 'it did not read any of them'
          : all && providerReads.unread.every((p) => p.error !== 'not read')
            ? `its page reader failed (${[...new Set(providerReads.unread.map((p) => p.error))].join(', ')})`
            : `it did not read ${named}`;
        return { ok: false, code: 'page_unreadable', provider: def.id, model: reply.model, text: reply.text, error: `${def.label} was asked to read ${pages.join(', ')}, but ${why}`, ...pageInfo, skipped, ...routing };
      }
    }
    // Announced only once the pages are known to have been read, so the bus is
    // never told "<provider> answered" for a call that then failed as page_unreadable.
    if (skipped.some((s) => s.verdict === VERDICT.OUT_OF_CREDIT || s.verdict === VERDICT.INVALID)) {
      await announceFallThrough({ skipped, answered: def, feature, now: d.now(), postBus: d.postBus, store: d.noticeStore, memory: d.noticeMemory, timeoutMs: d.noticeStoreTimeoutMs });
    }
    const schemaInfo = schema ? { schemaBy: def.holdsSchema ? 'provider' : 'door' } : {};

    const out = {
      ok: true,
      text: reply.text,
      provider: def.id,
      providerLabel: def.label,
      model: reply.model,
      usage,
      stopReason: reply.stopReason,
      ...pageInfo,
      ...schemaInfo,
      skipped,
      ...routing,
    };
    if (wantsJson) {
      const parsed = parseJsonReply(reply.text);
      if (!parsed.ok) {
        return { ok: false, code: 'bad_json', provider: def.id, providerLabel: def.label, model: reply.model, text: reply.text, stopReason: reply.stopReason, error: `${def.label} answered, but not with JSON (${parsed.error})`, ...pageInfo, ...schemaInfo, skipped, ...routing };
      }
      if (schema) {
        const mismatch = schemaMismatch(schema, parsed.value);
        if (mismatch) {
          return { ok: false, code: 'bad_json', provider: def.id, providerLabel: def.label, model: reply.model, text: reply.text, stopReason: reply.stopReason, field: mismatch, error: `${def.label} answered, but not in the shape asked for: ${mismatch}`, ...pageInfo, ...schemaInfo, skipped, ...routing };
        }
      }
      out.json = parsed.value;
    }
    return out;
  }

  const reasons = skipped.map((s) => `${s.label}: ${s.reason}`).join('; ');
  if (doorPageFailure) {
    // The door could not read a page and every provider that reads pages
    // itself was passed over too: the page is still what failed.
    return { ok: false, code: 'page_unreadable', provider: null, error: `The page could not be read: ${doorPageFailure.error}. ${reasons}.`, pages: doorPageFailure.pages, skipped, ...routing };
  }
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
  warnedNoDatabase = false;
}

module.exports = {
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
  schemaMismatch,
  isPrivateAddress,
  readPage,
  livePageFetch,
  pageText,
  noticeText,
  AI_PROVIDERS,
  DEFAULT_PROVIDER_ORDER,
  TIERS,
  CUSTOM_KEY_ENV_RE,
  ORDER_CACHE_MS,
  NOTICE_EVERY_MS,
  CANNOT_READ,
  CANNOT_READ_PAGE,
  _resetNoticeMemory,
};
