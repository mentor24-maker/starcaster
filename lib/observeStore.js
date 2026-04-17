'use strict';

const { sbQuery, scopedInsertRow, scopedListQuery, tableConfig } = require('./supabase');

function t() { return tableConfig(); }

/**
 * Log usage metrics into the generic Observe table natively.
 * Fire-and-forget; handles isolation dynamically.
 * 
 * @param {string} provider 'vercel' | 'openai' | 'gemini' | 'youtube' | 'vertex_veo'
 * @param {string} usageType 'api_request' | 'tokens' | 'compute_seconds'
 * @param {number} usageCount Optional numeric float value representing count (default 1)
 * @param {object} scope Must contain projectContext resolving back to current scope
 */
async function logUsage(provider, usageType, usageCount = 1, scope = null) {
  // Graceful degradation - do not block pipelines if telemetry fails
  try {
    const payload = {
      provider: String(provider || 'unknown').trim().toLowerCase(),
      usage_type: String(usageType || 'api_request').trim().toLowerCase(),
      usage_count: Number(usageCount) || 1
    };

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

module.exports = {
  logUsage,
  getUsageAnalytics
};
