'use strict';

/**
 * Which provider answered each feature group's LAST AI call (AI provider
 * groups 2, SC-876), so Settings › APIs can show that Outreach is on OpenAI
 * rather than leave Dane to assume it.
 *
 * Read from the AI usage meter: lib/aiUsage.js writes one `llm_tokens` row to
 * `observe_usage_logs` for every call, carrying the provider that answered and
 * the feature that asked (`metadata.feature`). The feature is mapped to its
 * group by lib/aiFeatureGroups.js, the one list of groups.
 *
 * ONE read, bounded the same way Settings › AI Quota's already is: the
 * `llm_tokens` rows of the last WINDOW_DAYS, newest first, at most ROW_LIMIT.
 * The table is the largest in the database and disk reads are a shared
 * budget (docs/runbook-supabase-capacity.md), so this never scans its whole
 * history to prove a group has never been used. That is why a group with no
 * row says "none in the last 30 days", and, when the read hit its limit,
 * says it may simply be further back.
 *
 * The bill is the platform's, so the read is not project-scoped: the screen
 * is platform-admin only (routes/aiProviders.js isAdmin).
 *
 * A read that fails is `{ ok: false, error }` and the screen says so on every
 * row; it is never "No AI calls yet" (acceptance criterion 3).
 */

const WINDOW_DAYS = 30;
const ROW_LIMIT = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure: the newest row per group. `rows` are newest first, each
 * `{ created_at, provider, metadata: { feature, model } }`.
 * Returns `{ <groupId>: { provider, model, feature, at } | null }` for every group.
 */
function lastCallPerGroup(rows) {
  const { AI_FEATURE_GROUPS, groupForFeature } = require('./aiFeatureGroups');
  const out = {};
  for (const g of AI_FEATURE_GROUPS) out[g.id] = null;
  let left = AI_FEATURE_GROUPS.length;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!left) break;
    const meta = (row && typeof row.metadata === 'object' && row.metadata) || {};
    const group = groupForFeature(meta.feature);
    if (!group || out[group.id]) continue;
    out[group.id] = {
      provider: String(row.provider || 'unknown'),
      model: String(meta.model || ''),
      feature: String(meta.feature),
      at: row.created_at || null,
    };
    left -= 1;
  }
  return out;
}

/**
 * Read the meter once and answer for every group.
 * Returns `{ ok: true, data: { groups, windowDays, rowLimit, truncated, since } }`
 * or `{ ok: false, error }`.
 */
async function readLastCalls({ now = Date.now(), sbQuery, table } = {}) {
  const supabase = require('./supabase');
  const query = sbQuery || supabase.sbQuery;
  if (!sbQuery && !supabase.isConfigured()) {
    return { ok: false, error: 'the database is not configured here' };
  }
  const since = new Date(now - WINDOW_DAYS * DAY_MS).toISOString();
  const qs = 'select=created_at,provider,metadata'
    + '&usage_type=eq.llm_tokens'
    + `&created_at=gte.${encodeURIComponent(since)}`
    + `&order=created_at.desc&limit=${ROW_LIMIT}`;
  let res;
  try {
    res = await query({ method: 'GET', table: table || supabase.tableConfig().observeUsageLogs, query: qs, schema: 'public' });
  } catch (err) {
    return { ok: false, error: `the AI usage meter could not be read (${String(err && err.message || err)})` };
  }
  if (!res || !res.ok) {
    const why = res && res.error ? (res.error.message || res.error) : `HTTP ${res && res.status}`;
    return { ok: false, error: `the AI usage meter could not be read (${why})` };
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  return {
    ok: true,
    data: {
      groups: lastCallPerGroup(rows),
      windowDays: WINDOW_DAYS,
      rowLimit: ROW_LIMIT,
      truncated: rows.length >= ROW_LIMIT,
      since,
    },
  };
}

module.exports = { lastCallPerGroup, readLastCalls, WINDOW_DAYS, ROW_LIMIT };
