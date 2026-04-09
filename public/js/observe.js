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
      // Optional: auto-ping if we want, but user requested manual pings.
    }
  }
});

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
