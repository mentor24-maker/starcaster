'use strict';

window.App = window.App || {};

App.personas = (function() {
  let personasCache = [];

  async function loadPersonas() {
    const res = await App.api('/api/personas');
    if (!res || !res.ok) {
      return App.notify('Failed to load personas', true);
    }
    personasCache = res.data || [];
    renderPersonasTable();
  }

  function renderPersonasTable() {
    const list = document.getElementById('personaProxyTable');
    if (!list) return;
    list.innerHTML = '';
    
    if (personasCache.length === 0) {
      list.innerHTML = '<tr><td colspan="5" class="muted text-center" style="padding: 1rem;">No digital clones provisioned. Establish a new persona explicitly below.</td></tr>';
      return;
    }

    personasCache.forEach(p => {
      const tr = document.createElement('tr');
      
      let statusColor = 'var(--text-color)';
      if (p.status === 'Active') statusColor = 'var(--success)';
      if (p.status === 'Provisioning') statusColor = 'var(--warning)';
      if (p.status === 'Restricted') statusColor = 'var(--danger)';

      const sources = Array.isArray(p.primary_sources) ? p.primary_sources : [];
      let sourcesHtml = sources.length === 0 ? '<span class="muted">-</span>' : sources.map(s => {
          return `<a href="${s}" target="_blank" style="font-size: 0.8rem; text-decoration: none; color: var(--primary-color);">[Source Link]</a>`;
      }).join(' ');

      tr.innerHTML = `
        <td style="font-weight: 500;">${p.base_name || 'Unknown'}</td>
        <td class="muted">${p.clone_handle || '-'}</td>
        <td class="muted">${p.agent_email || '-'}</td>
        <td>${sourcesHtml}</td>
        <td style="font-weight: 500; color: ${statusColor};">${p.status || 'Unknown'}</td>
      `;
      
      const actTd = document.createElement('td');
      actTd.style.textAlign = 'right';
      
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tiny-btn';
      btn.textContent = 'Trigger Proxy';
      btn.onclick = () => App.personas.provisionPersona(p.id);
      if (p.status !== 'Provisioning' && p.status !== 'Restricted') {
         // btn.disabled = true;
      }
      
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'tiny-btn icon-btn icon-btn-danger';
      delBtn.innerHTML = '<span class="icon-btn-glyph">' + (App.ACTION_ICONS?.trash || 'X') + '</span>';
      delBtn.title = 'Delete Persona';
      delBtn.style.marginLeft = '0.5rem';
      delBtn.onclick = async () => {
         if (!confirm('Are you strictly positive you want to completely destroy this proxy persona layout native hook?')) return;
         const d = await App.api(`/api/personas/${p.id}`, { method: 'DELETE' });
         if (!d || !d.ok) return App.notify('Failed to delete hook securely.', true);
         App.notify('Proxy Node erased natively.');
         loadPersonas();
      };
      
      actTd.appendChild(btn);
      actTd.appendChild(delBtn);
      
      tr.appendChild(actTd);
      list.appendChild(tr);
    });
  }

  async function createPersona(e) {
    e.preventDefault();
    const btn = document.getElementById('savePersonaBtn');
    if (btn) btn.disabled = true;

    try {
      const payload = {
        baseName: document.getElementById('newPersonaBaseName').value,
        cloneHandle: document.getElementById('newPersonaCloneHandle').value,
        agentEmail: document.getElementById('newPersonaAgentEmail').value,
      };

      const rawSources = document.getElementById('newPersonaSources').value || '';
      const parts = rawSources.split(',').map(s => s.trim()).filter(Boolean);
      payload.primarySources = parts;

      const res = await App.api('/api/personas', { method: 'POST', body: JSON.stringify(payload) });
      if (!res || !res.ok) {
        throw new Error(res?.error || 'Failed to generate Persona');
      }

      App.notify('Digital Clone persona securely established!');
      
      // reset form natively
      document.getElementById('newPersonaBaseName').value = '';
      document.getElementById('newPersonaCloneHandle').value = '';
      document.getElementById('newPersonaAgentEmail').value = '';
      document.getElementById('newPersonaSources').value = '';

      document.getElementById('addPersonaModal').classList.add('hidden');
      await loadPersonas();
    } catch (err) {
      App.notify(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function provisionPersona(id) {
    if (!confirm('This specifically triggers the robotic web-scraping logic. Proceed natively?')) return;
    try {
        const p = await App.api(`/api/personas/${id}/provision`, { method: 'POST' });
        if (!p || !p.ok) {
           return App.notify(p?.error || 'Proxy orchestrator failure loop.', true);
        }
        App.notify(p.message || 'Orchestration Hook initialized successfully!');
        await loadPersonas();
    } catch (err) {
        App.notify(err.message, true);
    }
  }

  function init() {
    if (document.getElementById('addPersonaForm')) {
       document.getElementById('addPersonaForm').addEventListener('submit', createPersona);
    }
    if (document.getElementById('personaProxyTable')) {
       loadPersonas();
    }
  }

  return { init, loadPersonas, provisionPersona };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (typeof App.whenAuthenticated === 'function') {
    App.whenAuthenticated(() => App.personas.init());
  }
});
