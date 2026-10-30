'use strict';

/**
 * What Anthropic actually billed — the one number that cannot miss a call
 * (AI Quota 2/5, task 86bcvj7v0).
 *
 * Starcaster's own meter (lib/observeStore.js getAiSpendSummary) is an
 * estimate built from the calls the website makes itself. On Oct 28-30, 2026
 * the Mac Mini spent about $35 that the meter never saw. Anthropic's bill sees
 * everything on the organization, so putting it NEXT TO the meter turns the gap
 * between them into the alarm.
 *
 * Two reports, both raw HTTP (they are not in the SDK), both needing an Admin
 * key (`sk-ant-admin...`) in ANTHROPIC_ADMIN_KEY — server-side only:
 *
 *  - cost_report: daily dollars, grouped by description so model and token
 *    type come back. Amounts arrive as decimal strings in CENTS.
 *  - usage_report/messages: daily tokens grouped by api_key_id and model, so
 *    spend splits by key (the website and the Mini can hold separate keys).
 *    It carries tokens, not dollars, so the per-key figure is priced at list
 *    rates and labelled an estimate; the per-day and per-model figures are the
 *    bill itself.
 *
 * Rules, the same three lib/aiPricing.js keeps:
 *  - No key is "not connected", never $0.
 *  - A failed read is "could not read" with the reason, never $0.
 *  - A result is cached for 15 minutes, so opening the page repeatedly does not
 *    hammer Anthropic's reporting API.
 */

const { ANTHROPIC_RATES, modelKey } = require('./aiPricing');

const API_BASE = 'https://api.anthropic.com/v1/organizations';
const ANTHROPIC_VERSION = '2023-06-01';
const CACHE_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 15000;
const MAX_PAGES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const MILLION = 1_000_000;

/** The bill is "well above" the meter when it exceeds it by more than this. */
const GAP_THRESHOLD = 0.2;

const cache = new Map();

function adminKey() {
  return String(process.env.ANTHROPIC_ADMIN_KEY || '').trim();
}

/** UTC midnight of the day containing `ms`. Anthropic's daily buckets are UTC days. */
function utcMidnight(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * The window both readings cover: `days` finished UTC days plus today so far.
 * `finishedUntil` is today's midnight — the meter-versus-bill comparison only
 * uses days before it, because today's bill is still filling in.
 */
function billingWindow(days, now = Date.now()) {
  const today = utcMidnight(now);
  return {
    startingAt: new Date(today - days * DAY_MS).toISOString(),
    finishedUntil: new Date(today).toISOString(),
  };
}

function cents(value) {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * GET one report, following `next_page` until `has_more` is false. Returns
 * every bucket, or `{ ok: false }` with a reason a person can act on.
 */
async function readReport(path, params, { key, fetchImpl }) {
  const buckets = [];
  let page = '';
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams();
    for (const [name, value] of params) qs.append(name, value);
    if (page) qs.set('page', page);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(`${API_BASE}/${path}?${qs.toString()}`, {
        method: 'GET',
        headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
        signal: controller.signal,
      });
    } catch (err) {
      const why = err && err.name === 'AbortError' ? `no answer in ${TIMEOUT_MS / 1000}s` : String(err?.message || err);
      return { ok: false, error: `Anthropic's ${path} could not be reached: ${why}` };
    } finally {
      clearTimeout(timer);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body?.error?.message || `HTTP ${res.status}`;
      const hint = res.status === 401 || res.status === 403
        ? ' — the key in ANTHROPIC_ADMIN_KEY was refused; it must be an Admin key (sk-ant-admin…), not an ordinary API key'
        : '';
      return { ok: false, error: `Anthropic's ${path} refused the read: ${detail}${hint}` };
    }
    if (!body || !Array.isArray(body.data)) {
      return { ok: false, error: `Anthropic's ${path} answered without a data list` };
    }
    buckets.push(...body.data);
    if (!body.has_more || !body.next_page) return { ok: true, buckets };
    page = String(body.next_page);
  }
  return { ok: false, error: `Anthropic's ${path} kept paging past ${MAX_PAGES} pages — refusing a partial total` };
}

/**
 * List-price estimate for one usage-report row. Cache writes bill at 1.25x
 * input (5-minute) or 2x (1-hour), cache reads at 0.1x. Null when the model
 * has no rate — the caller says so rather than counting it as $0.
 */
function estimateUsageUsd(row) {
  const rates = ANTHROPIC_RATES[modelKey(row.model)];
  if (!rates) return null;
  const cache5m = num(row.cache_creation?.ephemeral_5m_input_tokens);
  const cache1h = num(row.cache_creation?.ephemeral_1h_input_tokens);
  return (
    num(row.uncached_input_tokens) * rates.input
    + cache5m * rates.input * 1.25
    + cache1h * rates.input * 2
    + num(row.cache_read_input_tokens) * rates.input * 0.1
    + num(row.output_tokens) * rates.output
  ) / MILLION;
}

function usageTokens(row) {
  return num(row.uncached_input_tokens)
    + num(row.cache_creation?.ephemeral_5m_input_tokens)
    + num(row.cache_creation?.ephemeral_1h_input_tokens)
    + num(row.cache_read_input_tokens)
    + num(row.output_tokens);
}

/** Fold the cost report into dollars by day and by model. */
function summariseCost(buckets, finishedUntil) {
  const byDay = [];
  const byModel = {};
  let totalUsd = 0;
  let finishedUsd = 0;
  for (const bucket of buckets) {
    const day = String(bucket.starting_at || '').slice(0, 10);
    // Compared as instants, not strings: Anthropic writes `...00Z`, this file
    // writes `...00.000Z`, and the two do not sort the same as text.
    const finished = Date.parse(bucket.ending_at) <= Date.parse(finishedUntil);
    let dayUsd = 0;
    for (const row of Array.isArray(bucket.results) ? bucket.results : []) {
      const usd = cents(row.amount) / 100;
      dayUsd += usd;
      const model = modelKey(row.model) || String(row.description || 'other charges');
      byModel[model] = (byModel[model] || 0) + usd;
    }
    byDay.push({ day, costUsd: dayUsd, finished });
    totalUsd += dayUsd;
    if (finished) finishedUsd += dayUsd;
  }
  byDay.sort((a, b) => a.day.localeCompare(b.day));
  return {
    byDay,
    byModel: Object.entries(byModel)
      .map(([model, costUsd]) => ({ model, costUsd }))
      .sort((a, b) => b.costUsd - a.costUsd),
    totalUsd,
    finishedUsd,
  };
}

/** Fold the usage report into tokens and estimated dollars by API key. */
function summariseUsageByKey(buckets, keyNames = {}) {
  const byKey = {};
  for (const bucket of buckets) {
    for (const row of Array.isArray(bucket.results) ? bucket.results : []) {
      // A null key id is usage from the Console Workbench or other keyless
      // surfaces — still on the bill, so it gets its own row.
      const id = row.api_key_id ? String(row.api_key_id) : '';
      if (!byKey[id]) {
        byKey[id] = {
          apiKeyId: id,
          name: id ? (keyNames[id] || '') : 'No API key (Console / Workbench)',
          tokens: 0,
          estimatedUsd: 0,
          unpricedModels: [],
          models: {},
        };
      }
      const entry = byKey[id];
      const model = modelKey(row.model) || 'unknown';
      entry.tokens += usageTokens(row);
      entry.models[model] = (entry.models[model] || 0) + usageTokens(row);
      const usd = estimateUsageUsd(row);
      if (usd === null) {
        if (!entry.unpricedModels.includes(model)) entry.unpricedModels.push(model);
      } else {
        entry.estimatedUsd += usd;
      }
    }
  }
  return Object.values(byKey).sort((a, b) => b.estimatedUsd - a.estimatedUsd || b.tokens - a.tokens);
}

/**
 * The meter-versus-bill verdict. `unseenUsd` is set only when the bill is more
 * than GAP_THRESHOLD above the meter — that is the sentence the page exists to
 * say. A bill BELOW the meter is not an alarm: the meter deliberately rounds
 * cached tokens up (lib/aiPricing.js rule 3).
 */
function compareMeterToBill(meterUsd, billedUsd) {
  const meter = Number(meterUsd) || 0;
  const billed = Number(billedUsd) || 0;
  const gap = billed - meter;
  const alarm = billed > 0 && billed > meter * (1 + GAP_THRESHOLD);
  return { meterUsd: meter, billedUsd: billed, unseenUsd: alarm ? gap : 0, alarm };
}

/**
 * Today's bill so far, split by model, and by key when the usage report came
 * back (null when it did not). `costUsd` is 0 for a day with no bucket yet —
 * that is a real zero: the cost report was read and holds nothing for today.
 */
function summariseToday(costBuckets, usageBuckets, keyNames, now) {
  const day = new Date(utcMidnight(now)).toISOString().slice(0, 10);
  const onToday = (bucket) => String(bucket?.starting_at || '').slice(0, 10) === day;
  const cost = summariseCost(costBuckets.filter(onToday), new Date(utcMidnight(now)).toISOString());
  return {
    day,
    costUsd: cost.totalUsd,
    byModel: cost.byModel,
    byKey: usageBuckets ? summariseUsageByKey(usageBuckets.filter(onToday), keyNames) : null,
  };
}

async function readKeyNames({ key, fetchImpl }) {
  const res = await readReport('api_keys', [['limit', '100']], { key, fetchImpl });
  if (!res.ok) return {};
  const names = {};
  for (const k of res.buckets) if (k && k.id) names[String(k.id)] = String(k.name || '');
  return names;
}

/**
 * The bill for the last `days` finished UTC days plus today so far.
 *
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string}>}
 *   data.status is 'not-connected' (no key) or 'ok'.
 */
async function getAnthropicBilling({ days = 30, now = Date.now(), fetchImpl = globalThis.fetch, useCache = true } = {}) {
  const key = adminKey();
  if (!key) return { ok: true, data: { status: 'not-connected' } };

  const span = billingWindow(days, now);
  const cacheKey = `${days}:${span.startingAt}`;
  const hit = useCache ? cache.get(cacheKey) : null;
  if (hit && now - hit.at < CACHE_MS) return { ok: true, data: { ...hit.data, cached: true } };

  const limit = String(Math.min(31, days + 1));
  const [cost, usage, keyNames] = await Promise.all([
    readReport('cost_report', [
      ['starting_at', span.startingAt],
      ['bucket_width', '1d'],
      ['group_by[]', 'description'],
      ['limit', limit],
    ], { key, fetchImpl }),
    readReport('usage_report/messages', [
      ['starting_at', span.startingAt],
      ['bucket_width', '1d'],
      ['group_by[]', 'api_key_id'],
      ['group_by[]', 'model'],
      ['limit', limit],
    ], { key, fetchImpl }),
    readKeyNames({ key, fetchImpl }),
  ]);
  if (!cost.ok) return { ok: false, error: cost.error };

  const data = {
    status: 'ok',
    startingAt: span.startingAt,
    finishedUntil: span.finishedUntil,
    ...summariseCost(cost.buckets, span.finishedUntil),
    // The per-key split is a second report; its failure must not hide the bill.
    byKey: usage.ok ? summariseUsageByKey(usage.buckets, keyNames) : null,
    byKeyError: usage.ok ? '' : usage.error,
    // Today alone, so the spending alarm (AI Quota 4/5) can name who spent it.
    today: summariseToday(cost.buckets, usage.ok ? usage.buckets : null, keyNames, now),
    readAt: new Date(now).toISOString(),
    cached: false,
  };
  cache.set(cacheKey, { at: now, data });
  return { ok: true, data };
}

function clearBillingCache() {
  cache.clear();
}

module.exports = {
  getAnthropicBilling,
  compareMeterToBill,
  summariseCost,
  summariseUsageByKey,
  summariseToday,
  estimateUsageUsd,
  billingWindow,
  clearBillingCache,
  GAP_THRESHOLD,
};
