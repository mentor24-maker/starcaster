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

const CREDIT_RE = /credit balance is too low|no credits remaining|insufficient[_ ]quota|exceeded your current quota|billing|payment required|plan and billing/i;

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
  if (CREDIT_RE.test(message) || code === 'insufficient_quota' || status === 402) {
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
 */
async function probeKey(provider, key, { fetchImpl = fetch, recordUsage = recordAiUsage } = {}) {
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
      place: entry.place,
      job: entry.job,
      source: entry.source || '',
      fingerprint: fingerprint(key),
    };
    if (entry.unreadable) {
      rows.push({ ...base, verdict: VERDICT.CANNOT_TELL, reason: entry.unreadable, account: '' });
      continue;
    }
    if (!key) {
      rows.push({ ...base, verdict: VERDICT.NOT_SET, reason: 'no key is configured here', account: '' });
      continue;
    }
    const cacheKey = `${entry.provider}:${base.fingerprint}`;
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, Promise.resolve(probe(entry.provider, key, probeOptions)).then((p) => classify(entry.provider, p)));
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

/** 0 every key works (or is simply not set), 1 a key is down, 2 a reading could not be taken. 1 outranks 2. */
function exitCode(rows) {
  if (rows.some((r) => ALARMING.has(r.verdict))) return 1;
  if (rows.some((r) => r.verdict === VERDICT.CANNOT_TELL)) return 2;
  return 0;
}

/**
 * What to say on the bus, given what has already been said.
 *   rows  — this reading
 *   state — { [rowId]: { verdict, at } } for alarms currently open
 * Returns { post: rows, clear: rows, next: state }.
 *
 * Once per 6h per key while it is down, re-posted at once if it goes down in a
 * different way; one all-clear when it WORKS again, sent only if an alarm
 * actually went out. A CANNOT TELL leaves an open alarm open and says nothing:
 * a network blip is not news, and it is not a recovery either.
 */
function planAlarms({ rows, state = {}, now = Date.now(), everyMs = ALARM_EVERY_MS }) {
  const next = { ...state };
  const post = [];
  const clear = [];
  for (const row of rows) {
    const open = state[row.id];
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
  return { post, clear, next };
}

function rowLine(row, names = ACCOUNT_NAMES) {
  const account = row.account ? describeAccount(row.account, names) : 'account not reported';
  const key = row.fingerprint ? `key ${row.fingerprint}` : 'no key';
  return `${row.verdict} — ${row.place}, ${row.provider} (${key}, ${account}). Used by: ${row.job}. ${row.reason}.`;
}

const BILLING_PAGE = {
  anthropic: 'console.anthropic.com → Settings → Billing, after switching to that organization',
  openai: 'platform.openai.com → Settings → Billing, in that organization',
  gemini: 'the Google Cloud project the key belongs to → Billing',
};

function whatToDo(row) {
  if (row.verdict === VERDICT.OUT_OF_CREDIT) {
    const which = row.account ? 'THE ACCOUNT NAMED ABOVE' : 'the account THIS key was made in (the provider did not name it — check which organization the key is listed under)';
    return `Add credit to ${which} (${BILLING_PAGE[row.provider] || 'that provider\'s billing page'}) — `
      + 'credit bought in a different account does not reach this key. Or replace the key with one from an account that has credit.';
  }
  return 'The key itself was refused — revoked, mistyped, or its organization disabled. '
    + 'Make a new key and put it where this row says it lives.';
}

function renderMessage({ post = [], clear = [], comparisons = [], node, at, names = ACCOUNT_NAMES }) {
  const lines = [];
  if (post.length) {
    lines.push(`[CC-starcaster] 🔴 ${post.length === 1 ? 'An AI key has' : `${post.length} AI keys have`} stopped working`);
    lines.push('');
    for (const row of post) {
      lines.push(`• ${rowLine(row, names)}`);
      lines.push(`  What to do: ${whatToDo(row)}`);
    }
    const mismatches = comparisons.filter((c) => !c.same && !c.deliberate);
    if (mismatches.length) {
      lines.push('');
      for (const c of mismatches) lines.push(`• ${c.text}`);
    }
  }
  if (clear.length) {
    if (lines.length) lines.push('');
    lines.push(`[CC-starcaster] ✅ ${clear.length === 1 ? 'An AI key works' : `${clear.length} AI keys work`} again`);
    for (const row of clear) lines.push(`• ${rowLine(row, names)}`);
  }
  lines.push('');
  lines.push(`Checked from ${node} at ${at} (npm run ai-keys). Re-posts every 6h while a key stays down; one all-clear when it works again.`);
  return lines.join('\n');
}

module.exports = {
  VERDICT,
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
  rowLine,
  renderMessage,
};
