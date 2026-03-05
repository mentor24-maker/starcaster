/**
 * public/js/envConfig.js
 * Environment Configuration settings page.
 *
 * Shows all env vars grouped by category.  Secrets are masked.
 * Each row has an Edit button — clicking it reveals an input and Save.
 * Save calls POST /api/config, which writes to Vercel (prod) or updates
 * process.env in-memory (dev) and advises the user to update .env.
 */

window.App = window.App || {};
App.envConfig = (function () {
  const { api, notify } = App;

  // ── State ────────────────────────────────────────────────────────────────

  let configEntries = [];   // array from GET /api/config
  let editingKey    = null; // schema key currently in edit mode

  // ── DOM helpers ──────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  // ── Fetch config from server ─────────────────────────────────────────────

  async function loadConfig() {
    const container = el('envConfigTable');
    if (!container) return;

    try {
      const data = await api('/api/config');
      configEntries = data.config || [];
      renderTable();
    } catch (err) {
      notify('Failed to load environment configuration: ' + err.message, true);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  function renderTable() {
    const container = el('envConfigTable');
    if (!container) return;

    // Group entries
    const groups = {};
    for (const entry of configEntries) {
      if (!groups[entry.group]) groups[entry.group] = [];
      groups[entry.group].push(entry);
    }

    let html = '';
    for (const [groupName, entries] of Object.entries(groups)) {
      html += `<tr class="env-group-row"><td colspan="4" class="env-group-label">${groupName}</td></tr>`;
      for (const entry of entries) {
        const isEditing = editingKey === entry.key;
        const statusDot = entry.isSet
          ? '<span class="env-dot env-dot--set" title="Set"></span>'
          : '<span class="env-dot env-dot--missing" title="Not set"></span>';

        const valueCell = isEditing
          ? `<td class="env-value-cell">
               <input
                 id="envInput-${entry.key}"
                 class="env-input"
                 type="${entry.secret ? 'password' : 'text'}"
                 placeholder="${entry.secret ? '(hidden — paste new value to update)' : entry.env}"
                 autocomplete="off"
               />
             </td>
             <td class="env-action-cell">
               <button class="btn btn-sm btn-primary" onclick="App.envConfig.save('${entry.key}')">Save</button>
               <button class="btn btn-sm btn-ghost" onclick="App.envConfig.cancelEdit()">Cancel</button>
             </td>`
          : `<td class="env-value-cell">
               <code class="env-value ${entry.isSet ? '' : 'env-value--missing'}">${
                 entry.value || (entry.isSet ? '' : '— not set —')
               }</code>
             </td>
             <td class="env-action-cell">
               <button class="btn btn-sm btn-ghost" onclick="App.envConfig.startEdit('${entry.key}')">Edit</button>
             </td>`;

        html += `
          <tr class="env-row ${isEditing ? 'env-row--editing' : ''}">
            <td class="env-status-cell">${statusDot}</td>
            <td class="env-key-cell">
              <code class="env-key">${entry.env}</code>
              <span class="env-desc">${entry.description}</span>
            </td>
            ${valueCell}
          </tr>
        `;
      }
    }

    container.innerHTML = html;
  }

  // ── Edit / Save ──────────────────────────────────────────────────────────

  function startEdit(key) {
    editingKey = key;
    renderTable();
    const input = el(`envInput-${key}`);
    if (input) input.focus();
  }

  function cancelEdit() {
    editingKey = null;
    renderTable();
  }

  async function save(key) {
    const input = el(`envInput-${key}`);
    if (!input) return;

    const value = input.value.trim();
    if (!value) {
      notify('Value cannot be empty. To unset a variable, remove it from your .env or Vercel dashboard.', true);
      return;
    }

    const btn = input.closest('tr').querySelector('.btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      const result = await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      });

      editingKey = null;

      // Update our local state so the table re-renders with "Set" status
      const entry = configEntries.find(e => e.key === key);
      if (entry) {
        entry.isSet  = true;
        entry.value  = entry.secret ? '***' : value;
      }

      renderTable();

      if (result.note) {
        notify(result.note);
      } else {
        notify(`${result.env} updated successfully.`);
      }
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      notify('Save failed: ' + err.message, true);
    }
  }

  // ── Module interface ─────────────────────────────────────────────────────

  function init() {
    // nothing to wire at boot — page loads data on activation
  }

  function onPageActivated() {
    loadConfig();
  }

  const manifest = {
    id:     'envConfig',
    label:  'Env Config',
    pageId: 'envConfigPage',
  };

  return { init, onPageActivated, loadConfig, startEdit, cancelEdit, save, manifest };
}());
