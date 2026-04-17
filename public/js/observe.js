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
  }
});

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
             <strong>${data.totalQueries}</strong> structural hits
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
