'use strict';

/**
 * public/js/observe.js
 * Handles operations within the Observe module, primarily the API Quotas dashboard.
 */

window.App = window.App || {};

App.manifests = App.manifests || [];
App.manifests.push({
  id: 'observe',
  label: 'Observe',
  pageId: 'observeQuotasPage',
  onPageActivated: function(pageId) {
    if (pageId === 'observeQuotasPage') {
      App.loadUsageReports();
    }
    if (pageId === 'observeReportsPage') {
      App.loadObserveReports();
    }
  }
});

// Hardcoded Phase 1 industry-average pricing constants resolving mathematically
App.PricingMatrix = {
  vercel: { metric: 'api_request', rate: 0.000002 },          // $2.00 per 1M hits
  openai: { metric: 'llm_tokens', rate: 0.000010 },           // ~$10.00 per 1M tokens blended
  anthropic: { metric: 'llm_tokens', rate: 0.000009 },        // ~$9.00 per 1M tokens blended
  gemini: { metric: 'llm_tokens', rate: 0.000003 },           // ~$3.00 per 1M tokens blended
  vertex_veo: { metric: 'video_generation_job', rate: 0.50 }  // ~$0.50 per standard clip
};

App.loadUsageReports = async function() {
  const container = document.getElementById('usageAnalyticsContainer');
  if (!container) return;

  container.innerHTML = `<div style="text-align: center; padding: 2rem;"><span class="spinner"></span> Loading telemetry...</div>`;

  try {
    const res = await App.api('/api/observe/usage-reports');
    if (!res.ok) throw new Error(res.error || 'Failed to fetch telemetry');

    const metrics = res.data?.byProvider || {};
    const providers = Object.keys(metrics);

    if (providers.length === 0) {
      container.innerHTML = `<div style="color: var(--muted); text-align: center; padding: 2rem;">No telemetry recorded yet in this scope.</div>`;
      return;
    }

    let html = `<div class="card-grid" style="grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));">`;
    
    for (const p of providers) {
      const data = metrics[p];
      let typeList = '';
      for (const [t, c] of Object.entries(data.byType || {})) {
        typeList += `<div style="display:flex; justify-content:space-between; padding: 4px 0; border-bottom: 1px dashed var(--border);">
                       <span style="color:var(--muted); text-transform:capitalize;">${t.replace(/_/g, ' ')}</span>
                       <strong>${c.toLocaleString()}</strong>
                     </div>`;
      }

      html += `
        <div class="card">
          <h3 style="margin-top:0; text-transform:uppercase; letter-spacing:0.5px; font-size:1rem;">${p}</h3>
          <div style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--muted);">
             <strong>${data.totalQueries}</strong> recent telemetry logs
          </div>
          <div style="background: var(--bg-body); padding: 0.5rem; border-radius: 6px; font-size: 0.9rem;">
            ${typeList}
          </div>
        </div>
      `;
    }
    
    html += `</div>`;
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div style="color: #d32f2f; padding: 1rem;">Error loading reports: ${e.message}</div>`;
  }
};

App.loadObserveReports = async function() {
  const container = document.getElementById('observeCfoDashboard');
  if (!container) return;

  container.innerHTML = `<div style="text-align: center; padding: 4rem;"><span class="spinner" style="width: 32px; height: 32px;"></span><br><br>Calculating usage estimations...</div>`;

  try {
    const res = await App.api('/api/observe/usage-reports');
    if (!res.ok) throw new Error(res.error || 'Failed to fetch telemetry');

    const metrics = res.data?.byProvider || {};
    const providers = Object.keys(metrics);

    let totalGlobalCost = 0;
    let providerCardsHtml = '';

    for (const p of Object.keys(App.PricingMatrix)) {
      const data = metrics[p] || { byType: {}, totalQueries: 0 };
      const config = App.PricingMatrix[p];
      
      const usageCount = data.byType[config.metric] || 0;
      const estimatedCost = usageCount * config.rate;
      totalGlobalCost += estimatedCost;

      // Only render card if there is usage, or it's a primary system
      if (usageCount > 0 || ['vercel', 'openai', 'gemini'].includes(p)) {
        providerCardsHtml += `
          <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <h3 style="margin-top:0; text-transform:uppercase; letter-spacing:0.5px; font-size:1rem; border-bottom:1px solid var(--border); padding-bottom: 0.5rem;">${p}</h3>
              <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <span style="color: var(--muted); text-transform: capitalize;">${config.metric.replace(/_/g, ' ')}</span>
                <strong>${usageCount.toLocaleString()}</strong>
              </div>
            </div>
            <div style="margin-top: 1rem; padding: 0.75rem; background: var(--bg-body); border-radius: 6px; text-align: center;">
              <span style="font-size: 0.85rem; color: var(--muted); display: block; margin-bottom: 0.25rem;">Estimated Cost</span>
              <span style="font-size: 1.5rem; font-weight: bold; color: var(--ink);">$${estimatedCost.toFixed(4)}</span>
            </div>
          </div>
        `;
      }
    }

    container.innerHTML = `
      <div style="margin-bottom: 2rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 2rem; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <h2 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; color: var(--muted); text-transform: uppercase; letter-spacing: 1px;">Total Aggregate Burn</h2>
        <div style="font-size: 3.5rem; font-weight: 800; color: var(--ink); line-height: 1;">$${totalGlobalCost.toFixed(3)}</div>
        <p style="margin: 1rem 0 0 0; font-size: 0.9rem; color: var(--muted); max-width: 600px; margin-left: auto; margin-right: auto;">
          Estimated cumulative cost based on standard industry averages mapped perfectly against your raw logical telemetry. This represents lifetime structural footprint spanning all physical vendor dependencies.
        </p>
      </div>

      <div class="card-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
        ${providerCardsHtml || '<div style="grid-column: 1/-1; text-align: center; color: var(--muted); padding: 2rem;">No cost telemetry generated yet.</div>'}
      </div>
    `;

  } catch (e) {
    container.innerHTML = `<div style="color: #d32f2f; padding: 2rem; text-align: center;"><strong>Cost Processing Error:</strong> ${e.message}</div>`;
  }
};

function updateQuotaCard(apiName, statusObj) {
  const statusEl = document.getElementById(`quotaStatus${apiName}`);
  const errorEl = document.getElementById(`quotaError${apiName}`);
  const btnEl = document.getElementById(`ping${apiName}Btn`);
  
  if (!statusEl || !errorEl || !btnEl) return;
  
  // Reset
  errorEl.style.display = 'none';
  errorEl.innerHTML = '';
  
  if (statusObj === 'pinging') {
    statusEl.textContent = 'Pinging...';
    statusEl.style.background = '#eef2ff';
    statusEl.style.color = '#4f46e5';
    btnEl.disabled = true;
    return;
  }
  
  btnEl.disabled = false;
  
  if (statusObj.status === 'healthy') {
    statusEl.textContent = 'Healthy';
    statusEl.style.background = '#dcfce7'; // green-100
    statusEl.style.color = '#166534'; // green-800
  } else if (statusObj.status === 'exhausted') {
    statusEl.textContent = 'Exhausted (Quota Met)';
    statusEl.style.background = '#fee2e2'; // red-100
    statusEl.style.color = '#991b1b'; // red-800
    errorEl.style.display = 'block';
    errorEl.textContent = statusObj.message;
  } else if (statusObj.status === 'error') {
    statusEl.textContent = 'Error';
    statusEl.style.background = '#fef08a'; // yellow-200
    statusEl.style.color = '#854d0e'; // yellow-800
    errorEl.style.display = 'block';
    errorEl.textContent = statusObj.message;
  }
}

App.pingYoutubeQuota = async function() {
  updateQuotaCard('Youtube', 'pinging');
  try {
    const res = await App.api('/api/observe/ping-youtube', { method: 'POST' });
    updateQuotaCard('Youtube', res.data);
  } catch (err) {
    updateQuotaCard('Youtube', { status: 'error', message: err.message });
  }
};

App.pingOpenaiQuota = async function() {
  updateQuotaCard('Openai', 'pinging');
  try {
    const res = await App.api('/api/observe/ping-openai', { method: 'POST' });
    updateQuotaCard('Openai', res.data);
  } catch (err) {
    updateQuotaCard('Openai', { status: 'error', message: err.message });
  }
};

App.pingOpenclawQuota = async function() {
  updateQuotaCard('Openclaw', 'pinging');
  try {
    const res = await App.api('/api/observe/ping-openclaw', { method: 'POST' });
    updateQuotaCard('Openclaw', res.data);
  } catch (err) {
    updateQuotaCard('Openclaw', { status: 'error', message: err.message });
  }
};

App.pingGeminiQuota = async function() {
  updateQuotaCard('Gemini', 'pinging');
  try {
    const res = await App.api('/api/observe/ping-gemini', { method: 'POST' });
    updateQuotaCard('Gemini', res.data);
  } catch (err) {
    updateQuotaCard('Gemini', { status: 'error', message: err.message });
  }
};
