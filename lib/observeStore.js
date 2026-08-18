'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedInsertRow, scopedListQuery } = require('./projectScope');

function t() { 
  const conf = tableConfig();
  conf.observePageViews = 'observe_page_views';
  return conf;
}

/**
 * Log usage metrics into the generic Observe table natively.
 * Fire-and-forget; handles isolation dynamically.
 * 
 * @param {string} provider 'vercel' | 'openai' | 'gemini' | 'youtube' | 'vertex_veo'
 * @param {string} usageType 'api_request' | 'llm_tokens' | 'compute_seconds'
 * @param {number} usageCount Optional numeric float value representing count (default 1)
 * @param {object} scope Must contain projectContext resolving back to current scope
 * @param {object} metadata Optional detail written to the metadata jsonb column —
 *        for token rows this carries the model, the feature that spent it, and
 *        the prompt/completion/cache split (see lib/aiUsage.js)
 */
async function logUsage(provider, usageType, usageCount = 1, scope = null, metadata = null) {
  // Graceful degradation - do not block pipelines if telemetry fails
  try {
    // `Number(x) || 1` was here, which silently turned a real zero into a 1.
    // Harmless while every caller counted whole requests; wrong the moment
    // token counts arrived, where 0 is a legitimate and meaningful value.
    const parsedCount = Number(usageCount);
    const payload = {
      provider: String(provider || 'unknown').trim().toLowerCase(),
      usage_type: String(usageType || 'api_request').trim().toLowerCase(),
      usage_count: Number.isFinite(parsedCount) ? parsedCount : 1
    };

    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      payload.metadata = metadata;
    }

    if (scope && scope.projectId) {
       payload.project_id = scope.projectId;
       payload.user_id = scope.userId || null;
    }

    const { ok, error } = await sbQuery({
      method: 'POST',
      table: t().observeUsageLogs,
      body: [payload],
      schema: 'public'
    });

    if (!ok && error) {
      console.warn(`[Telemetry] Failed dropping usage log for ${provider}:`, error.message || error);
    }
  } catch (err) {
    console.warn(`[Telemetry] Telemetry exception swallowed for ${provider}:`, err);
  }
}

/**
 * Retrieve aggregated usage analytics dynamically over the scoped projects.
 * Returns summarized groupings by provider, day, and usage type natively.
 */
async function getUsageAnalytics(scope = null) {
  // Use scopedListQuery to enforce RLS natively
  const qs = 'select=created_at,provider,usage_type,usage_count&limit=100000&order=created_at.desc';
  const query = await scopedListQuery(t().observeUsageLogs, qs, scope);

  const { ok, data, error } = await sbQuery({
    method: 'GET',
    table: t().observeUsageLogs,
    query: query,
    schema: 'public'
  });

  if (!ok) return { ok: false, error: 'Log extraction failed: ' + (error?.message || String(error)) };

  const rows = Array.isArray(data) ? data : [];
  
  // Aggregate into structural UI-ready buckets mapping explicitly onto D3-style consumption rendering
  const metrics = {
     byProvider: {},
     history: []
  };

  rows.forEach(row => {
     const p = row.provider || 'unknown';
     const t = row.usage_type || 'unknown';
     const c = Number(row.usage_count) || 0;
     
     if (!metrics.byProvider[p]) metrics.byProvider[p] = { totalQueries: 0, byType: {} };
     
     metrics.byProvider[p].totalQueries++;
     if (!metrics.byProvider[p].byType[t]) metrics.byProvider[p].byType[t] = 0;
     metrics.byProvider[p].byType[t] += c;
  });

  metrics.history = rows.slice(0, 100); // Send just top 100 logs back if they want a physical list

  return { ok: true, data: metrics };
}

/**
 * What AI has cost since `sinceIso`, broken down by the feature that spent it.
 *
 * Reads only the token rows lib/aiUsage.js writes (`usage_type = llm_tokens`),
 * prices each one through lib/aiPricing.js, and reports what it could NOT price
 * alongside what it could — a total that hides an unpriced provider would read
 * as "this is what you spent" when it is really "this is part of what you
 * spent". Follows the house signature: limit first, then scope.
 *
 * @param {number} limit Max rows to read
 * @param {object} scope Project scope
 * @param {string} sinceIso ISO timestamp; defaults to the last 30 days
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function getAiSpendSummary(limit = 20000, scope = null, sinceIso = null) {
  const { priceCall } = require('./aiPricing');
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20000, 100000));
  const since = sinceIso || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const qs = `select=created_at,provider,usage_type,usage_count,metadata`
    + `&usage_type=eq.llm_tokens`
    + `&created_at=gte.${encodeURIComponent(since)}`
    + `&order=created_at.desc&limit=${safeLimit}`;
  const query = await scopedListQuery(t().observeUsageLogs, qs, scope);

  const { ok, data, error } = await sbQuery({
    method: 'GET',
    table: t().observeUsageLogs,
    query,
    schema: 'public'
  });

  if (!ok) return { ok: false, error: 'AI spend read failed: ' + (error?.message || String(error)) };

  const rows = Array.isArray(data) ? data : [];
  const byFeature = {};
  const byDay = {};
  const unpriced = {};
  let totalUsd = 0;
  let totalTokens = 0;
  let pricedCalls = 0;
  let unpricedCalls = 0;

  for (const row of rows) {
    const meta = (row && typeof row.metadata === 'object' && row.metadata) || {};
    const day = String(row.created_at || '').slice(0, 10);
    const feature = String(meta.feature || 'unattributed');
    const model = String(meta.model || 'unknown');
    const tokens = Number(row.usage_count) || 0;

    const priced = priceCall({
      provider: row.provider,
      model,
      promptTokens: meta.prompt_tokens,
      completionTokens: meta.completion_tokens,
      cachedTokens: meta.cached_tokens,
      onDate: day,
    });

    totalTokens += tokens;
    if (priced.priced) {
      totalUsd += priced.costUsd;
      pricedCalls++;
    } else {
      unpricedCalls++;
      const key = `${row.provider || 'unknown'}:${model}`;
      if (!unpriced[key]) unpriced[key] = { provider: row.provider || 'unknown', model, calls: 0, tokens: 0, reason: priced.reason };
      unpriced[key].calls++;
      unpriced[key].tokens += tokens;
    }

    if (!byFeature[feature]) byFeature[feature] = { feature, calls: 0, tokens: 0, costUsd: 0, models: {}, fullyPriced: true };
    byFeature[feature].calls++;
    byFeature[feature].tokens += tokens;
    byFeature[feature].costUsd += priced.costUsd;
    byFeature[feature].models[model] = (byFeature[feature].models[model] || 0) + 1;
    if (!priced.priced) byFeature[feature].fullyPriced = false;

    if (!byDay[day]) byDay[day] = { day, calls: 0, tokens: 0, costUsd: 0 };
    byDay[day].calls++;
    byDay[day].tokens += tokens;
    byDay[day].costUsd += priced.costUsd;
  }

  return {
    ok: true,
    data: {
      since,
      totalUsd,
      totalTokens,
      pricedCalls,
      unpricedCalls,
      // True only when every call in the window carried a known rate. The panel
      // leads with this: a total is either complete or it is labelled partial.
      complete: unpricedCalls === 0,
      byFeature: Object.values(byFeature).sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens),
      byDay: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
      unpriced: Object.values(unpriced).sort((a, b) => b.tokens - a.tokens),
      rowsRead: rows.length,
      // Reported so a truncated window can never masquerade as the full picture.
      truncated: rows.length >= safeLimit,
    },
  };
}

async function recordPageView(pageId, scope = null) {
  try {
    const payload = { page_id: String(pageId || 'unknown').trim() };
    if (scope && scope.projectId) {
       payload.project_id = scope.projectId;
       payload.user_id = scope.userId || null;
    }
    const { ok, error } = await sbQuery({
      method: 'POST',
      table: t().observePageViews,
      body: [payload],
      schema: 'public'
    });
    if (!ok && error) console.warn(`[Telemetry] Failed recording page view for ${pageId}:`, error.message || error);
  } catch (err) {
    console.warn(`[Telemetry] exception swallowed for page view ${pageId}:`, err);
  }
}

async function listPageViews(limit = 1000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 10000));
  const qs = `select=id,page_id,created_at&limit=${safeLimit}&order=created_at.desc`;
  const query = await scopedListQuery(t().observePageViews, qs, scope);

  const { ok, data, error } = await sbQuery({
    method: 'GET',
    table: t().observePageViews,
    query: query,
    schema: 'public'
  });

  if (!ok) return { ok: false, error: 'Page views extraction failed: ' + (error?.message || String(error)) };
  return { ok: true, data: Array.isArray(data) ? data : [] };
}

module.exports = {
  logUsage,
  getUsageAnalytics,
  getAiSpendSummary,
  recordPageView,
  listPageViews
};
