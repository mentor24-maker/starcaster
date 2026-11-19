'use strict';

/**
 * Which AI keys are in use, which ACCOUNT each one bills, and does it work
 * right now? (ticket 86bcvhfht)
 *
 * On 2026-10-30 Outreach posting and "Write with AI" stopped with "Your credit
 * balance is too low". Dane bought credit in Dane's Individual Org and it still
 * failed: the key Starcaster uses (Doppler prd ANTHROPIC_API_KEY, also copied
 * into the Mini's ~/.openclaw/.env) belongs to a DIFFERENT Anthropic
 * organization. Nothing anywhere said which account a key bills, and nothing
 * raised an alarm when it ran dry — the outreach worker logged CANNOT_TELL for
 * two days.
 *
 * WHY NOT lib/credentialVerify.js. That check asks GET /v1/models, which costs
 * nothing — and answers 200 for a key whose account has no credit at all. It
 * proves the key is a key. This file asks the question that failed: will a
 * real request be served? So it sends the smallest real request there is (one
 * output token from the cheapest model) and reads two things off the answer:
 *   - the verdict, from the status and the error body;
 *   - the account, from the `anthropic-organization-id` header Anthropic puts
 *     on every authenticated reply (OpenAI's equivalent: `openai-organization`).
 * A probe costs a few millionths of a dollar and is metered like any other
 * call (feature `ai-keys-check`), so it shows on Observe › AI spend.
 *
 * NO VALUE IS EVER RENDERED (docs/DOCTRINE.md §4.1). A key is shown as a
 * fingerprint — the first 8 hex characters of its SHA-256 — which tells two
 * keys apart and reveals nothing about either.
 *
 * Five readings, never two (docs/DOCTRINE.md §3.11):
 *   WORKS          the provider served a real request
 *   OUT OF CREDIT  the key is valid; its account cannot pay
 *   INVALID        the provider refused the key itself
 *   CANNOT TELL    no reading could be taken (network, outage, unreadable store)
 *   NOT SET        no key is configured in that place — a fact, not a fault
 *
 * The pure half lives here so it can be tested without a network or a secret;
 * scripts/ai_keys_check.mjs gathers the keys, keeps the alarm state and posts;
 * GET /api/settings/ai-keys runs the same probes on the website's own keys.
 */

const crypto = require('crypto');

const VERDICT = Object.freeze({
  WORKS: 'WORKS',
  OUT_OF_CREDIT: 'OUT OF CREDIT',
  INVALID: 'INVALID',
  CANNOT_TELL: 'CANNOT TELL',
  NOT_SET: 'NOT SET',
});

/** The two readings that mean "this AI feature is down" and earn an alarm. */
const ALARMING = new Set([VERDICT.OUT_OF_CREDIT, VERDICT.INVALID]);

const PROBE_TIMEOUT_MS = 20000;
const ALARM_EVERY_MS = 6 * 60 * 60 * 1000;

// The cheapest model of each provider. One output token is all a probe asks for.
const PROBE_MODEL = Object.freeze({
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
});

/**
 * Account ids Dane has named. Anthropic reports an organization id, never a
 * name, so a name only appears here once somebody writes it down — the id is
 * shown either way. Add a line when Dane says which account an id is.
 */
const ACCOUNT_NAMES = Object.freeze({
  // Measured 2026-10-30: the account the website's and the Mini's
  // ANTHROPIC_API_KEY bill. It is NOT "Dane's Individual Org"; its name is
  // not known yet.
  '33d0ab74-d6bd-4d7d-a525-029a6e4217d1': '',
});

/**
 * Places allowed to hold a different key from the website's, on purpose (for
 * example OpenClaw on its own account). A split listed here is reported as
 * deliberate; a split NOT listed here is reported as a mismatch.
 */
const SEPARATE_ON_PURPOSE = Object.freeze(new Set([]));

/** A short, non-reversible label for a key: tells two keys apart, reveals neither. */
function fingerprint(key) {
  const value = String(key || '').trim();
  if (!value) return '';
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function shortAccount(id) {
  const value = String(id || '').trim();
  if (!value) return '';
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

/** "org 33d0ab74… (Alphire)" — the id always, the name when one is known. */
function describeAccount(id, names = ACCOUNT_NAMES) {
  const value = String(id || '').trim();
  if (!value) return '';
  const name = String(names[value] || '').trim();
  return name ? `${name} (org ${shortAccount(value)})` : `org ${shortAccount(value)} (not named yet)`;
}

function errorText(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  const err = body.error;
  if (typeof err === 'string') return err;
  return String(err?.message || body.message || '');
}

function errorCode(body) {
  if (!body || typeof body !== 'object') return '';
  const err = body.error;
  if (!err || typeof err !== 'object') return '';
  return String(err.code || err.type || err.status || '');
}

// Moonshot (Kimi) answers 429 `exceeded_current_quota_error` / "insufficient balance"
// for an account that cannot pay, so those are caught before the 429 rule below.
const CREDIT_RE = /credit balance is too low|no credits remaining|insufficient[_ ]quota|insufficient[_ ]balance|exceeded[_ ]?(your[_ ])?current[_ ]quota|billing|payment required|plan and billing|account .* is suspended/i;

/**
 * Turn one probe into a reading.
 *   provider — 'anthropic' | 'openai' | 'gemini'
 *   probe    — { status, body, account } when it answered, { error } when it did not
 * Returns { verdict, reason, account }.
 */
function classify(provider, probe) {
  if (!probe || probe.error) {
    return {
      verdict: VERDICT.CANNOT_TELL,
      reason: `no answer from ${provider} (${String(probe?.error || 'no reading')})`,
      account: '',
    };
  }
  const status = Number(probe.status) || 0;
  const message = errorText(probe.body).slice(0, 200);
  const code = errorCode(probe.body);
  const account = String(probe.account || '').trim();
  const said = message ? ` — "${message}"` : '';

  if (status >= 200 && status < 300) {
    return { verdict: VERDICT.WORKS, reason: `${provider} served a request (${status})`, account };
  }
  if (CREDIT_RE.test(message) || CREDIT_RE.test(code) || status === 402) {
    return { verdict: VERDICT.OUT_OF_CREDIT, reason: `${provider} answered ${status}${said}`, account };
  }
  if (status === 401 || code === 'authentication_error' || /API_KEY_INVALID|invalid api key|invalid x-api-key|incorrect api key/i.test(`${message} ${JSON.stringify(probe.body || '')}`)) {
    return { verdict: VERDICT.INVALID, reason: `${provider} refused the key (${status})${said}`, account };
  }
  if (status === 403) {
    // Anthropic answers 403 permission_error for a disabled organization or a
    // key without access; Gemini for a key whose project has the API off.
    return { verdict: VERDICT.INVALID, reason: `${provider} refused the key (${status})${said}`, account };
  }
  if (status === 429) {
    // Rate limited, not out of credit (that case is caught above): the key
    // authenticated and the account can pay; it is just busy right now.
    return { verdict: VERDICT.WORKS, reason: `${provider} accepted the key but is rate-limiting it right now (429)`, account };
  }
  return {
    verdict: VERDICT.CANNOT_TELL,
    reason: `${provider} answered ${status || 'nothing'}${said} — not a reading about the key`,
    account,
  };
}

async function readBody(res) {
  const text = await res.text().catch(() => '');
  try { return JSON.parse(text); } catch { return text; }
}

function networkError(err) {
  const cause = err?.cause?.code || err?.cause?.message || '';
  const msg = err?.name === 'TimeoutError' ? `no answer within ${PROBE_TIMEOUT_MS / 1000}s` : String(err?.message || err);
  return cause ? `${msg}: ${cause}` : msg;
}

// The meter, loaded on first use so requiring this file never touches a database.
function recordAiUsage(args) {
  return require('./aiUsage').recordAiUsage(args);
}

/**
 * Send the smallest real request the provider will charge for, and return the
 * raw reading for classify(). Every served probe is metered through
 * recordAiUsage (feature `ai-keys-check`); tests inject `recordUsage`.
 * Anthropic, OpenAI and Gemini keep their own probes; any other provider is
 * probed from its switch definition (`def`: kind, baseUrl, models).
 */
async function probeKey(provider, key, { fetchImpl = fetch, recordUsage = recordAiUsage, def = null } = {}) {
  const apiKey = String(key || '').trim();
  try {
    if (provider === 'anthropic') {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: PROBE_MODEL.anthropic, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const body = await readBody(res);
      if (res.ok && recordUsage) {
        await recordUsage({ provider: 'anthropic', model: PROBE_MODEL.anthropic, feature: 'ai-keys-check', body });
      }
      return { status: res.status, body, account: res.headers.get('anthropic-organization-id') || '' };
    }
    if (provider === 'openai') {
      const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: PROBE_MODEL.openai, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const body = await readBody(res);
      if (res.ok && recordUsage) {
        await recordUsage({ provider: 'openai', model: PROBE_MODEL.openai, feature: 'ai-keys-check', body });
      }
      return { status: res.status, body, account: res.headers.get('openai-organization') || '' };
    }
    if (provider === 'gemini') {
      // Listing models is free and proves the key. Google bills a Cloud
      // project and does not name it in the reply, so the account column stays
      // empty for Gemini and the reason says why.
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(apiKey)}`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return { status: res.status, body: await readBody(res), account: '' };
    }
    if (def && def.kind) {
      // Every other provider on the switch (Kimi, and any OpenAI-style service
      // added on Settings › APIs): the very request the door in
      // lib/aiClient.js would send, with its fast model and a tiny answer.
      // A thinking model may refuse a one-token cap, so it gets a few.
      const { buildRequest } = require('./aiClient');
      const model = String(def.models?.fast || '').trim();
      if (!model) return { error: `no fast model is set for ${def.label || provider} on Settings › APIs` };
      const req = buildRequest(def, model, apiKey, { messages: 'ok', maxTokens: 16 });
      const res = await fetchImpl(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const body = await readBody(res);
      if (res.ok && recordUsage) {
        const usage = body && typeof body === 'object' ? body.usage : undefined;
        await recordUsage({ provider: def.id || provider, model, feature: 'ai-keys-check', body, usage: usage || undefined });
      }
      return { status: res.status, body, account: res.headers.get('openai-organization') || '' };
    }
    return { error: `unknown provider "${provider}"` };
  } catch (err) {
    return { error: networkError(err) };
  }
}

/**
 * One row per key in use. `entries` is a list of
 *   { id, provider, place, job, key, unreadable }
 * where `unreadable` is a reason the place could not be read at all (that row
 * is CANNOT TELL), and an empty `key` with no `unreadable` is NOT SET.
 * Identical keys are probed once.
 */
async function checkKeys(entries, { probe = probeKey, ...probeOptions } = {}) {
  const cache = new Map();
  const rows = [];
  for (const entry of entries) {
    const key = String(entry.key || '').trim();
    const base = {
      id: entry.id,
      provider: entry.provider,
      label: entry.label || entry.provider,
      place: entry.place,
      job: entry.job,
      source: entry.source || '',
      keyEnv: entry.keyEnv || '',
      fingerprint: fingerprint(key),
      ...(entry.inSwitch ? { inSwitch: true, position: entry.position, enabled: entry.enabled !== false } : {}),
    };
    if (entry.unreadable) {
      rows.push({ ...base, verdict: VERDICT.CANNOT_TELL, reason: entry.unreadable, account: '' });
      continue;
    }
    if (!key) {
      const reason = entry.keyEnv ? `no key is set: add ${entry.keyEnv}` : 'no key is configured here';
      rows.push({ ...base, verdict: VERDICT.NOT_SET, reason, account: '' });
      continue;
    }
    const cacheKey = `${entry.provider}:${base.fingerprint}`;
    if (!cache.has(cacheKey)) {
      const options = entry.def ? { ...probeOptions, def: entry.def } : probeOptions;
      cache.set(cacheKey, Promise.resolve(probe(entry.provider, key, options)).then((p) => classify(base.label, p)));
    }
    rows.push({ ...base, ...(await cache.get(cacheKey)) });
  }
  return rows;
}

/**
 * Places that should hold the same key, and whether they do. A place in
 * SEPARATE_ON_PURPOSE is allowed its own key and is reported as deliberate.
 * Returns [{ a, b, same, sameAccount, deliberate, text }].
 */
function compareKeys(rows, { pairs = [['website-anthropic', 'openclaw-anthropic']], separate = SEPARATE_ON_PURPOSE, names = ACCOUNT_NAMES } = {}) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = [];
  for (const [aId, bId] of pairs) {
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b || !a.fingerprint || !b.fingerprint) continue;
    const same = a.fingerprint === b.fingerprint;
    const sameAccount = Boolean(a.account && b.account && a.account === b.account);
    const deliberate = !same && (separate.has(aId) || separate.has(bId));
    let text;
    if (same) {
      text = `${b.place} holds the SAME key as ${a.place} (${a.fingerprint}).`;
    } else {
      const accounts = a.account && b.account
        ? (sameAccount
          ? ` Both bill ${describeAccount(a.account, names)}.`
          : ` They bill DIFFERENT accounts: ${describeAccount(a.account, names)} and ${describeAccount(b.account, names)}.`)
        : '';
      text = deliberate
        ? `${b.place} has its own key (${b.fingerprint}), separate from ${a.place} (${a.fingerprint}) on purpose.${accounts}`
        : `MISMATCH: ${b.place} holds a DIFFERENT key (${b.fingerprint}) from ${a.place} (${a.fingerprint}), `
          + `and nothing records that as deliberate.${accounts} One of the two copies is probably stale.`;
    }
    out.push({ a: aId, b: bId, same, sameAccount, deliberate, text });
  }
  return out;
}

/**
 * Every provider on the AI switch (Settings › APIs › AI provider, SC-844), in
 * the order the door in lib/aiClient.js tries them, each with whether it is
 * switched on (SC-848). Switched-off providers are listed too, after the
 * order, so the panel and `npm run ai-keys` show every provider the switch
 * knows — Kimi included — and say which ones can actually be used.
 *
 *   settings — the saved row as lib/aiProviderSettingsStore.js reads it
 *              ({ exists, providers, customProviders }), or null when there is
 *              none or it could not be read
 *   env      — where AI_PROVIDER_ORDER / AI_MODEL_* come from when it is null
 *   fallbackReason — why `settings` is null, said on the result
 *
 * Returns { providers: [{ def, enabled }], source, fallbackReason, ignored }.
 * An added service whose key setting breaks the AI_SERVICE_ rule is left out
 * and named in `ignored`, the same as the door does.
 */
function switchProviders({ settings = null, env = {}, fallbackReason = '' } = {}) {
  const { AI_PROVIDERS, CUSTOM_KEY_ENV_RE, envProviderOrder } = require('./aiClient');
  const out = [];
  const seen = new Set();
  const ignored = [];
  let source;
  if (settings && settings.exists) {
    source = 'settings';
    const custom = new Map((settings.customProviders || []).map((c) => [c.id, c]));
    for (const entry of settings.providers || []) {
      if (!entry || seen.has(entry.id)) continue;
      let def = AI_PROVIDERS[entry.id];
      if (!def && custom.has(entry.id)) {
        const c = custom.get(entry.id);
        if (!CUSTOM_KEY_ENV_RE.test(String(c.keyEnv || ''))) { ignored.push(entry.id); continue; }
        def = { id: c.id, label: c.label, kind: 'openai-style', settingsKey: '', keyEnv: c.keyEnv, baseUrl: c.baseUrl, models: {}, custom: true };
      }
      if (!def) { ignored.push(entry.id); continue; }
      seen.add(entry.id);
      const models = {};
      for (const tier of ['fast', 'strong']) models[tier] = entry[tier] || (def.models && def.models[tier]) || '';
      out.push({ def: { ...def, models }, enabled: entry.enabled !== false });
    }
  } else {
    const fromEnv = envProviderOrder({ env });
    source = fromEnv.source;
    ignored.push(...fromEnv.ignored);
    for (const def of fromEnv.providers) {
      seen.add(def.id);
      out.push({ def, enabled: true });
    }
  }
  // A provider the code knows but the order does not name is off (the door
  // never tries it), and still listed so nobody wonders where it went.
  for (const def of Object.values(AI_PROVIDERS)) {
    if (!seen.has(def.id)) out.push({ def, enabled: false });
  }
  return { providers: out, source, fallbackReason: source === 'settings' ? '' : String(fallbackReason || ''), ignored };
}

/** "the order saved on Settings › APIs" / "the default order, because …" — for a heading. */
function orderSourceText({ source, fallbackReason } = {}) {
  if (source === 'settings') return 'the order saved on Settings › APIs';
  const which = source === 'AI_PROVIDER_ORDER' ? 'the AI_PROVIDER_ORDER setting' : 'the default order (Anthropic, OpenAI, Gemini)';
  return fallbackReason ? `${which}, because ${fallbackReason}` : which;
}

/**
 * One check entry per provider on the switch, for checkKeys(). `keyFor(def)`
 * returns { key } / { key: '' } / { unreadable }, and `sourceFor(def)` says
 * where the key was read from. Ids are `${idPrefix}-${provider}`, so the
 * website's three original rows keep the ids their open alarms are filed under.
 */
function switchEntries(order, { keyFor, sourceFor = () => '', place, idPrefix = 'website', jobFor = defaultJob }) {
  return (order.providers || []).map(({ def, enabled }, i) => {
    const read = keyFor(def) || { key: '' };
    return {
      id: `${idPrefix}-${def.id}`,
      provider: def.id,
      label: def.label || def.id,
      def,
      keyEnv: def.keyEnv || '',
      place,
      job: jobFor(def, enabled),
      source: sourceFor(def, read) || '',
      inSwitch: true,
      position: i + 1,
      enabled,
      ...read,
    };
  });
}

function defaultJob(def, enabled) {
  if (!enabled) return `nothing right now: ${def.label || def.id} is not switched on in the provider order`;
  return 'every AI feature on the website, through the AI provider switch';
}

/**
 * What the switch can do right now, from this reading. Only switched-on
 * providers count, because the door never tries the others.
 *   serving — the first switched-on provider that WORKS (the one calls use), or null
 *   outage  — true when no switched-on provider can serve and none is merely
 *             unreadable: every AI feature has stopped
 *   blind   — no provider works, but at least one could not be read, so
 *             "stopped" cannot be said
 */
function switchState(rows) {
  const on = rows.filter((r) => r.inSwitch && r.enabled !== false)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const serving = on.find((r) => r.verdict === VERDICT.WORKS) || null;
  const unreadable = on.some((r) => r.verdict === VERDICT.CANNOT_TELL);
  return { on, serving, outage: !serving && !unreadable, blind: !serving && unreadable };
}

/** 0 every key works (or is simply not set), 1 a key is down, 2 a reading could not be taken. 1 outranks 2. */
function exitCode(rows) {
  if (rows.some((r) => ALARMING.has(r.verdict))) return 1;
  if (rows.some((r) => r.verdict === VERDICT.CANNOT_TELL)) return 2;
  return 0;
}

/**
 * What to say on the bus, given what has already been said.
 *   rows  — this reading
 *   state — { [rowId]: { verdict, at } } for alarms currently open, plus
 *           { ['blind:' + rowId]: { since, postedAt?, reason } } for rows that
 *           have read CANNOT TELL since `since`
 * Returns { post, clear, blind, sighted, next }.
 *
 * Once per 6h per key while it is down, re-posted at once if it goes down in a
 * different way; one all-clear when it WORKS again, sent only if an alarm
 * actually went out. A CANNOT TELL leaves an open alarm open: a network blip is
 * not news, and it is not a recovery either.
 *
 * But a CANNOT TELL that PERSISTS is news (review round 1). If the Mini loses
 * its prd Doppler access, or the probe model is retired, every wake reads
 * CANNOT TELL, and an alarm that only speaks on OUT OF CREDIT would then be
 * silent forever — the exact "logged CANNOT_TELL for two days, nobody told"
 * failure this check was built against. So once a row has been blind for
 * `blindAfterMs` (1h — six relay wakes) it posts that the check is blind and
 * why, once per 6h, and says once that it can see again on the next real
 * reading. The first-seen time is recorded on the first blind wake, so the
 * caller must save `next` whenever it changes, not only when it posts.
 */
const BLIND_AFTER_MS = 60 * 60 * 1000;
const blindKey = (id) => `blind:${id}`;

const OUTAGE_KEY = 'switch:outage';

function planAlarms({ rows, state = {}, now = Date.now(), everyMs = ALARM_EVERY_MS, blindAfterMs = BLIND_AFTER_MS }) {
  const next = { ...state };
  const post = [];
  const clear = [];
  const blind = [];
  const sighted = [];
  for (const row of rows) {
    const open = state[row.id];
    const wasBlind = state[blindKey(row.id)];
    if (row.inSwitch && row.enabled === false) {
      // Switched off: the door never tries it, so its key running dry is not
      // news. Any alarm opened while it was on is closed without a post.
      delete next[row.id];
      delete next[blindKey(row.id)];
      continue;
    }
    if (row.verdict === VERDICT.CANNOT_TELL) {
      const since = Date.parse(wasBlind?.since || '');
      if (!wasBlind || !Number.isFinite(since)) {
        next[blindKey(row.id)] = { since: new Date(now).toISOString(), reason: row.reason || '' };
      } else {
        const postedAt = Date.parse(wasBlind.postedAt || '');
        const due = now - since >= blindAfterMs && (!Number.isFinite(postedAt) || now - postedAt >= everyMs);
        next[blindKey(row.id)] = { ...wasBlind, reason: row.reason || wasBlind.reason || '' };
        if (due) {
          blind.push({ ...row, blindSince: wasBlind.since });
          next[blindKey(row.id)].postedAt = new Date(now).toISOString();
        }
      }
      continue;
    }
    if (wasBlind) {
      if (wasBlind.postedAt) sighted.push(row);
      delete next[blindKey(row.id)];
    }
    if (ALARMING.has(row.verdict)) {
      const then = Date.parse(open?.at || '');
      const fresh = open && open.verdict === row.verdict && Number.isFinite(then) && now - then < everyMs;
      if (!fresh) {
        post.push(row);
        next[row.id] = { verdict: row.verdict, at: new Date(now).toISOString() };
      }
    } else if (open && (row.verdict === VERDICT.WORKS || row.verdict === VERDICT.NOT_SET)) {
      clear.push(row);
      delete next[row.id];
    }
  }
  // The whole switch (SC-848). One provider dry while another works is the
  // per-key notice above; NO switched-on provider able to serve is the moment
  // every AI feature stops, so it is an ALARM (texted), on the same 6h rhythm,
  // with one all-clear when a provider serves again.
  const sw = switchState(rows);
  const anySwitch = rows.some((r) => r.inSwitch);
  let outage = null;
  let restored = null;
  if (anySwitch && sw.outage) {
    const then = Date.parse(state[OUTAGE_KEY]?.at || '');
    if (!(Number.isFinite(then) && now - then < everyMs)) {
      outage = { rows: sw.on };
      next[OUTAGE_KEY] = { at: new Date(now).toISOString() };
    }
  } else if (state[OUTAGE_KEY] && sw.serving) {
    restored = sw.serving;
    delete next[OUTAGE_KEY];
  }
  return { post, clear, blind, sighted, outage, restored, serving: sw.serving, next };
}

function rowLine(row, names = ACCOUNT_NAMES) {
  const account = row.account ? describeAccount(row.account, names) : 'account not reported';
  const key = row.fingerprint ? `key ${row.fingerprint}` : 'no key';
  const off = row.inSwitch && row.enabled === false ? ' [switched off]' : '';
  const at = row.inSwitch && row.position ? `${row.position}. ` : '';
  return `${at}${row.verdict}${off} — ${row.place}, ${row.label || row.provider} (${key}, ${account}). Used by: ${row.job}. ${row.reason}.`;
}

const BILLING_PAGE = {
  anthropic: 'console.anthropic.com → Settings → Billing, after switching to that organization',
  openai: 'platform.openai.com → Settings → Billing, in that organization',
  gemini: 'the Google Cloud project the key belongs to → Billing',
  kimi: 'platform.kimi.ai → Billing, in the account the key was made in',
};

function whatToDo(row) {
  if (row.verdict === VERDICT.NOT_SET) {
    return `${row.label || row.provider} has no key, so it is skipped. Add ${row.keyEnv || 'its key'} to Doppler production, or switch it off on Settings › APIs.`;
  }
  if (row.verdict === VERDICT.OUT_OF_CREDIT) {
    const which = row.account ? 'THE ACCOUNT NAMED ABOVE' : 'the account THIS key was made in (the provider did not name it — check which organization the key is listed under)';
    return `Add credit to ${which} (${BILLING_PAGE[row.provider] || 'that provider\'s billing page'}) — `
      + 'credit bought in a different account does not reach this key. Or replace the key with one from an account that has credit.';
  }
  return 'The key itself was refused — revoked, mistyped, or its organization disabled. '
    + 'Make a new key and put it where this row says it lives.';
}

const VERDICT_WORDS = {
  [VERDICT.OUT_OF_CREDIT]: 'is out of credit',
  [VERDICT.INVALID]: 'refused its key',
  [VERDICT.NOT_SET]: 'has no key',
  [VERDICT.CANNOT_TELL]: 'could not be read',
};

/** "Anthropic is out of credit; calls are using OpenAI." — the sentence the switch earns. */
function switchSentence(row, serving) {
  const what = `${row.label || row.provider} ${VERDICT_WORDS[row.verdict] || `reads ${row.verdict}`}`;
  return serving
    ? `${what}; calls are using ${serving.label || serving.provider}.`
    : `${what}, and no other switched-on provider is answering either.`;
}

function renderMessage({ post = [], clear = [], blind = [], sighted = [], outage = null, restored = null, serving = null, comparisons = [], node, at, names = ACCOUNT_NAMES }) {
  const lines = [];
  // An outage leads, and starts the message with "ALARM:", because the
  // tracker texts Dane only for bus posts that begin with that word.
  if (outage) {
    lines.push('ALARM: 🛑 No AI provider can answer: every AI feature has stopped');
    lines.push('');
    lines.push('Every switched-on provider was tried, in the order Settings › APIs sets:');
    for (const row of outage.rows) {
      lines.push(`• ${rowLine(row, names)}`);
      lines.push(`  What to do: ${whatToDo(row)}`);
    }
    if (!outage.rows.length) lines.push('• No provider is switched on at all. Switch one on in Settings › APIs › AI provider.');
  }
  // Switch rows already listed under the outage are not said twice.
  const keyPosts = outage ? post.filter((r) => !r.inSwitch) : post;
  if (keyPosts.length) {
    if (lines.length) lines.push('');
    lines.push(`[CC-starcaster] 🔴 ${keyPosts.length === 1 ? 'An AI key has' : `${keyPosts.length} AI keys have`} stopped working`);
    lines.push('');
    for (const row of keyPosts) {
      if (row.inSwitch) lines.push(`• ${switchSentence(row, serving)}`);
      lines.push(`${row.inSwitch ? '  ' : '• '}${rowLine(row, names)}`);
      lines.push(`  What to do: ${whatToDo(row)}`);
    }
  }
  if (post.length) {
    const mismatches = comparisons.filter((c) => !c.same && !c.deliberate);
    if (mismatches.length) {
      lines.push('');
      for (const c of mismatches) lines.push(`• ${c.text}`);
    }
  }
  if (restored) {
    if (lines.length) lines.push('');
    lines.push(`[CC-starcaster] ✅ AI features can answer again: calls are using ${restored.label || restored.provider}`);
    lines.push(`• ${rowLine(restored, names)}`);
  }
  if (clear.length) {
    if (lines.length) lines.push('');
    lines.push(`[CC-starcaster] ✅ ${clear.length === 1 ? 'An AI key works' : `${clear.length} AI keys work`} again`);
    for (const row of clear) lines.push(`• ${rowLine(row, names)}`);
  }
  if (blind.length) {
    if (lines.length) lines.push('');
    lines.push(`[CC-starcaster] ⚠️ The AI key check is blind: ${blind.length === 1 ? 'one key has' : `${blind.length} keys have`} not been readable for over an hour`);
    lines.push('Nobody can tell whether these keys work, so a key running dry here would go unannounced:');
    for (const row of blind) lines.push(`• ${row.place}, ${row.label || row.provider} (used by: ${row.job}) — CANNOT TELL since ${row.blindSince}. ${row.reason}.`);
  }
  if (sighted.length) {
    if (lines.length) lines.push('');
    lines.push(`[CC-starcaster] ✅ The AI key check can read ${sighted.length === 1 ? 'a key' : `${sighted.length} keys`} again`);
    for (const row of sighted) lines.push(`• ${rowLine(row, names)}`);
  }
  lines.push('');
  lines.push(`Checked from ${node} at ${at} (npm run ai-keys). Re-posts every 6h while a key stays down or unreadable; one all-clear when it works again.`);
  return lines.join('\n');
}

module.exports = {
  VERDICT,
  BLIND_AFTER_MS,
  ALARMING,
  ACCOUNT_NAMES,
  SEPARATE_ON_PURPOSE,
  PROBE_MODEL,
  fingerprint,
  describeAccount,
  classify,
  probeKey,
  checkKeys,
  compareKeys,
  exitCode,
  planAlarms,
  switchProviders,
  switchEntries,
  switchState,
  orderSourceText,
  switchSentence,
  OUTAGE_KEY,
  rowLine,
  renderMessage,
};
