/**
 * public/js/crm.js
 * CRM module — per-project contact tables, lead-capture forms, and field config.
 */

window.App = window.App || {};
App.crm = (function () {
  const { api, notify, setActivePage } = App;

  // ── Shared state ────────────────────────────────────────────────────────────
  let currentConfig = null;   // the active CRM config for this project
  let currentContacts = [];
  let currentForms = [];
  let editingContactId = null;
  let editingFormId = null;
  let setupCustomFields = [];  // custom fields being built in setup / field-config form
  let configCustomFields = []; // custom fields in the field-config tab

  // ── Standard field definitions ──────────────────────────────────────────────
  const STANDARD_FIELDS = [
    { key: 'first_name',  label: 'First Name',       type: 'text'     },
    { key: 'last_name',   label: 'Last Name',        type: 'text'     },
    { key: 'phone',       label: 'Phone Number',     type: 'tel'      },
    { key: 'company',     label: 'Company',          type: 'text'     },
    { key: 'job_title',   label: 'Job Title',        type: 'text'     },
    { key: 'city',        label: 'City',             type: 'text'     },
    { key: 'state',       label: 'State / Province', type: 'text'     },
    { key: 'zip',         label: 'Zip / Postal Code',type: 'text'     },
    { key: 'country',     label: 'Country',          type: 'text'     },
    { key: 'website',     label: 'Website',          type: 'url'      },
    { key: 'notes',       label: 'Notes',            type: 'textarea' },
    { key: 'source',      label: 'Source',           type: 'text'     },
    { key: 'tags',        label: 'Tags',             type: 'text'     },
  ];

  // All fields the config has enabled (standard + custom), ordered
  function allConfigFields(config) {
    if (!config) return [];
    const stdKeys = new Set(Array.isArray(config.standardFields) ? config.standardFields : []);
    const stdFields = STANDARD_FIELDS.filter((f) => stdKeys.has(f.key));
    const emailField = { key: 'email', label: 'Email Address', type: 'email' };
    const customFields = Array.isArray(config.customFields) ? config.customFields : [];
    return [emailField, ...stdFields, ...customFields];
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function showPanel(panelId) {
    ['crmContactsPanel', 'crmFormsPanel', 'crmFieldsPanel'].forEach((id) => {
      const p = el(id);
      if (p) p.classList.toggle('hidden', id !== panelId);
    });
    document.querySelectorAll('.crm-tab-btn').forEach((btn) => {
      const tab = btn.dataset.crmTab;
      const isActive = (
        (tab === 'contacts' && panelId === 'crmContactsPanel') ||
        (tab === 'forms'    && panelId === 'crmFormsPanel')    ||
        (tab === 'fields'   && panelId === 'crmFieldsPanel')
      );
      btn.classList.toggle('active', isActive);
      btn.style.color = isActive ? 'var(--accent-color)' : 'var(--text-secondary)';
      btn.style.borderBottomColor = isActive ? 'var(--accent-color)' : 'transparent';
    });
  }

  function renderStandardFieldGrid(containerId, selectedKeys) {
    const container = el(containerId);
    if (!container) return;
    const selected = new Set(Array.isArray(selectedKeys) ? selectedKeys : []);
    container.innerHTML = STANDARD_FIELDS.map((f) => `
      <label style="display:flex; align-items:center; gap:0.4rem; cursor:pointer;">
        <input type="checkbox" name="stdField" value="${f.key}" ${selected.has(f.key) ? 'checked' : ''} />
        ${f.label}
      </label>
    `).join('');
  }

  function collectCheckedStandardFields(containerId) {
    const container = el(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[name="stdField"]:checked')).map((cb) => cb.value);
  }

  // ── Custom field builder ────────────────────────────────────────────────────
  function renderCustomFieldsList(containerId, fields, onDelete) {
    const container = el(containerId);
    if (!container) return;
    if (!fields.length) {
      container.innerHTML = '<p class="meta">No custom fields added yet.</p>';
      return;
    }
    container.innerHTML = fields.map((f, i) => `
      <div class="card" style="padding:0.75rem 1rem; margin-bottom:0.5rem; display:flex; align-items:center; justify-content:space-between; gap:0.75rem;">
        <div>
          <strong>${f.label || f.key}</strong>
          <span class="meta" style="margin-left:0.5rem;">(${f.key}) · ${f.type}${f.required ? ' · required' : ''}</span>
        </div>
        <button type="button" class="btn" data-delete-custom-idx="${i}"
          style="padding:0.25rem 0.6rem; font-size:0.8rem;">Remove</button>
      </div>
    `).join('');
    container.querySelectorAll('[data-delete-custom-idx]').forEach((btn) => {
      btn.addEventListener('click', () => onDelete(Number(btn.dataset.deleteCustomIdx)));
    });
  }

  function openAddCustomFieldModal(onAdd) {
    const key = prompt('Field key (lowercase, underscores only — e.g. linkedin_url):');
    if (!key) return;
    const sanitizedKey = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!sanitizedKey) return;
    const label = prompt(`Display label for "${sanitizedKey}":`, sanitizedKey.replace(/_/g, ' '));
    if (!label) return;
    const typeOptions = 'text, email, tel, url, number, textarea, select';
    const type = prompt(`Field type (${typeOptions}):`, 'text') || 'text';
    const required = confirm('Is this field required?');
    let options = [];
    if (type === 'select') {
      const optStr = prompt('Enter select options (comma-separated):');
      options = optStr ? optStr.split(',').map((o) => o.trim()).filter(Boolean) : [];
    }
    onAdd({ key: sanitizedKey, label: label.trim(), type: type.trim(), required, options });
  }

  // ── Load / render ────────────────────────────────────────────────────────────
  async function loadPage() {
    try {
      const res = await api('/api/crm/configs');
      const configs = App.normalizeApiArray(res, 'configs');
      currentConfig = configs.length ? configs[0] : null;
    } catch (err) {
      notify(`CRM load failed: ${err.message}`, true);
      currentConfig = null;
    }
    renderPage();
  }

  function renderPage() {
    const emptyState = el('crmEmptyState');
    const activeState = el('crmActiveState');
    if (!emptyState || !activeState) return;

    if (!currentConfig) {
      emptyState.classList.remove('hidden');
      activeState.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    activeState.classList.remove('hidden');

    const title = el('crmActiveTitle');
    if (title) title.textContent = currentConfig.name || 'CRM';

    const actions = el('crmActiveActions');
    if (actions) {
      actions.innerHTML = `
        <button type="button" class="btn" id="crmSettingsBtn">Settings</button>
      `;
      el('crmSettingsBtn')?.addEventListener('click', openFieldsView);
    }

    // Wire tab buttons
    document.querySelectorAll('.crm-tab-btn').forEach((btn) => {
      btn.onclick = () => {
        const tab = btn.dataset.crmTab;
        if (tab === 'contacts') openContactsView();
        else if (tab === 'forms') openFormsView();
        else if (tab === 'fields') openFieldsView();
      };
    });

    openContactsView();
  }

  // ── Contacts view ───────────────────────────────────────────────────────────
  async function openContactsView() {
    showPanel('crmContactsPanel');

    const btn = el('crmAddContactBtn');
    if (btn) btn.onclick = () => openAddEditContact(null);

    if (!currentConfig) return;

    try {
      const res = await api(`/api/crm/contacts?configId=${encodeURIComponent(currentConfig.id)}`);
      currentContacts = App.normalizeApiArray(res, 'contacts');
    } catch (err) {
      notify(`Failed to load contacts: ${err.message}`, true);
      currentContacts = [];
    }

    renderContactsTable();
  }

  function renderContactsTable() {
    const head = el('crmContactsTableHead');
    const body = el('crmContactsTableBody');
    if (!head || !body) return;

    const fields = allConfigFields(currentConfig);

    head.innerHTML = `<tr>
      ${fields.slice(0, 6).map((f) => `<th>${f.label}</th>`).join('')}
      <th>Source</th>
      <th>Added</th>
      <th>Actions</th>
    </tr>`;

    if (!currentContacts.length) {
      body.innerHTML = `<tr><td colspan="${fields.slice(0,6).length + 3}" style="text-align:center; padding:2rem; color:var(--text-secondary);">No contacts yet. Add one or set up a form to start capturing leads.</td></tr>`;
      return;
    }

    body.innerHTML = currentContacts.map((c) => {
      const cols = fields.slice(0, 6).map((f) => {
        const val = f.key === 'email' ? (c.email || '') : (c.data?.[f.key] || '');
        return `<td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(String(val))}</td>`;
      }).join('');
      const added = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—';
      return `<tr>
        ${cols}
        <td>${escHtml(c.source || '')}</td>
        <td>${added}</td>
        <td>
          <button class="btn" data-edit-contact="${c.id}" style="padding:0.2rem 0.5rem; font-size:0.8rem; margin-right:0.25rem;">Edit</button>
          <button class="btn" data-delete-contact="${c.id}" style="padding:0.2rem 0.5rem; font-size:0.8rem;">Delete</button>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-edit-contact]').forEach((btn) => {
      btn.onclick = () => {
        const contact = currentContacts.find((c) => c.id === btn.dataset.editContact);
        if (contact) openAddEditContact(contact);
      };
    });
    body.querySelectorAll('[data-delete-contact]').forEach((btn) => {
      btn.onclick = () => deleteContact(btn.dataset.deleteContact);
    });
  }

  function openAddEditContact(contact) {
    editingContactId = contact ? contact.id : null;
    const titleEl = el('crmContactPageTitle');
    if (titleEl) {
      titleEl.innerHTML = `<a href="#" class="page-heading-back-link" onclick="App.crm.openPage(); return false;">CRM</a>: ${contact ? 'Edit' : 'Add'} Contact`;
    }

    const fields = allConfigFields(currentConfig);
    const fieldsContainer = el('crmContactFormFields');
    if (fieldsContainer) {
      fieldsContainer.innerHTML = fields.map((f) => {
        const val = f.key === 'email'
          ? escHtml(contact?.email || '')
          : escHtml(String(contact?.data?.[f.key] || ''));
        const inputHtml = f.type === 'textarea'
          ? `<textarea id="crmCtField_${f.key}" name="${f.key}" rows="3">${val}</textarea>`
          : `<input id="crmCtField_${f.key}" name="${f.key}" type="${f.type}" value="${val}" />`;
        return `<label>${f.label}</label>${inputHtml}`;
      }).join('');
    }

    const cancelBtn = el('crmContactCancelBtn');
    if (cancelBtn) cancelBtn.onclick = () => { openPage(); };

    const form = el('crmContactForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await saveContact(fields);
      };
    }

    setActivePage('crmAddEditContactPage');
  }

  async function saveContact(fields) {
    const email = el('crmCtField_email')?.value.trim().toLowerCase() || null;
    const data = {};
    fields.forEach((f) => {
      if (f.key === 'email') return;
      const input = el(`crmCtField_${f.key}`);
      if (input) data[f.key] = input.value.trim();
    });

    try {
      if (editingContactId) {
        await api(`/api/crm/contacts/${encodeURIComponent(editingContactId)}`, {
          method: 'PUT',
          body: JSON.stringify({ email, data }),
        });
        notify('Contact updated.');
      } else {
        await api('/api/crm/contacts', {
          method: 'POST',
          body: JSON.stringify({ crmConfigId: currentConfig.id, email, data, source: 'manual' }),
        });
        notify('Contact added.');
      }
      openPage();
    } catch (err) {
      notify(err.message || 'Failed to save contact.', true);
    }
  }

  async function deleteContact(id) {
    if (!confirm('Delete this contact? This cannot be undone.')) return;
    try {
      await api(`/api/crm/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('Contact deleted.');
      await openContactsView();
    } catch (err) {
      notify(err.message || 'Failed to delete contact.', true);
    }
  }

  // ── Forms view ──────────────────────────────────────────────────────────────
  async function openFormsView() {
    showPanel('crmFormsPanel');

    const btn = el('crmCreateFormBtn');
    if (btn) btn.onclick = () => openFormEditor(null);

    if (!currentConfig) return;

    try {
      const res = await api(`/api/crm/forms?configId=${encodeURIComponent(currentConfig.id)}`);
      currentForms = App.normalizeApiArray(res, 'forms');
    } catch (err) {
      notify(`Failed to load forms: ${err.message}`, true);
      currentForms = [];
    }

    renderFormsList();
  }

  function renderFormsList() {
    const container = el('crmFormsList');
    if (!container) return;

    if (!currentForms.length) {
      container.innerHTML = `<p class="meta" style="margin-top:1rem;">No forms yet. Create one to generate an embed code for any page.</p>`;
      return;
    }

    container.innerHTML = currentForms.map((f) => `
      <div class="card" style="padding:1rem 1.25rem; margin-bottom:0.75rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap;">
          <div>
            <strong style="font-size:1.05rem;">${escHtml(f.name)}</strong>
            ${f.heading ? `<span class="meta" style="margin-left:0.5rem;">— ${escHtml(f.heading)}</span>` : ''}
            <div class="meta" style="margin-top:0.2rem;">${f.fields.length} field${f.fields.length !== 1 ? 's' : ''} · Submit: "${escHtml(f.submitLabel)}"</div>
          </div>
          <div style="display:flex; gap:0.5rem; flex-shrink:0;">
            <button class="btn" data-view-embed="${f.id}" style="padding:0.25rem 0.6rem; font-size:0.8rem;">Embed Code</button>
            <button class="btn" data-edit-form="${f.id}" style="padding:0.25rem 0.6rem; font-size:0.8rem;">Edit</button>
            <button class="btn" data-delete-form="${f.id}" style="padding:0.25rem 0.6rem; font-size:0.8rem;">Delete</button>
          </div>
        </div>
        <div class="crm-embed-block" data-form-id="${f.id}" style="display:none; margin-top:0.75rem;">
          <textarea rows="6" readonly style="width:100%; font-family:monospace; font-size:0.75rem; padding:0.5rem; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:4px; resize:vertical;">${escHtml(buildEmbedCode(f))}</textarea>
          <button class="btn" data-copy-embed="${f.id}" style="margin-top:0.4rem; padding:0.25rem 0.6rem; font-size:0.8rem;">Copy</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-view-embed]').forEach((btn) => {
      btn.onclick = () => {
        const block = container.querySelector(`.crm-embed-block[data-form-id="${btn.dataset.viewEmbed}"]`);
        if (block) block.style.display = block.style.display === 'none' ? 'block' : 'none';
      };
    });
    container.querySelectorAll('[data-copy-embed]').forEach((btn) => {
      btn.onclick = () => {
        const block = container.querySelector(`.crm-embed-block[data-form-id="${btn.dataset.copyEmbed}"]`);
        const ta = block?.querySelector('textarea');
        if (ta) { ta.select(); document.execCommand('copy'); notify('Embed code copied.'); }
      };
    });
    container.querySelectorAll('[data-edit-form]').forEach((btn) => {
      const form = currentForms.find((f) => f.id === btn.dataset.editForm);
      if (form) btn.onclick = () => openFormEditor(form);
    });
    container.querySelectorAll('[data-delete-form]').forEach((btn) => {
      btn.onclick = () => deleteForm(btn.dataset.deleteForm);
    });
  }

  function buildEmbedCode(form) {
    if (!form?.id) return '';
    const origin = window.location.origin;
    const configId = currentConfig?.id || '';
    const projectId = (typeof App.projectContext?.getSessionProjectId === 'function')
      ? App.projectContext.getSessionProjectId()
      : (App.state?.currentProjectId || '');
    const color = form.accentColor || '#0b3d7a';
    const fields = Array.isArray(form.fields) ? form.fields : [];
    const fieldHtml = fields.map((f) => {
      const inputEl = f.type === 'textarea'
        ? `<textarea name="${f.key}" id="crmf_${f.key}" placeholder="${escHtml(f.label)}"${f.required ? ' required' : ''}></textarea>`
        : `<input type="${f.type}" name="${f.key}" id="crmf_${f.key}" placeholder="${escHtml(f.label)}"${f.required ? ' required' : ''} />`;
      return `  <label for="crmf_${f.key}">${escHtml(f.label)}</label>\n  ${inputEl}`;
    }).join('\n');

    return `<!-- CRM Form: ${escHtml(form.name)} -->
<form id="crmForm_${form.id}" style="max-width:480px; font-family:sans-serif;">
  <input type="hidden" name="crmConfigId" value="${configId}" />
  <input type="hidden" name="projectId" value="${projectId}" />
  <input type="hidden" name="_trap" value="" aria-hidden="true" style="display:none;" />
${fieldHtml}
  <button type="submit" style="background:${color}; color:#fff; padding:0.6rem 1.5rem; border:none; border-radius:4px; cursor:pointer; font-size:1rem;">${escHtml(form.submitLabel || 'Submit')}</button>
  <p id="crmMsg_${form.id}" style="margin-top:0.5rem;"></p>
</form>
<script>
(function(){
  var form=document.getElementById('crmForm_${form.id}');
  var msg=document.getElementById('crmMsg_${form.id}');
  if(!form)return;
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var data={};
    new FormData(form).forEach(function(v,k){data[k]=v;});
    fetch('${origin}/api/crm/contact-submit',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({crmConfigId:data.crmConfigId,projectId:data.projectId,_trap:data._trap||'',email:data.email||'',data:data,source:'form'})
    }).then(function(r){return r.json();}).then(function(){
      if(msg)msg.textContent='${escHtml(form.successMessage || 'Thank you!')}';
      form.reset();
    }).catch(function(){if(msg)msg.textContent='${escHtml(form.errorMessage || 'Something went wrong.')}';});
  });
})();
<\/script>`;
  }

  function openFormEditor(form) {
    editingFormId = form ? form.id : null;
    const titleEl = el('crmFormEditorTitle');
    if (titleEl) {
      titleEl.innerHTML = `<a href="#" class="page-heading-back-link" onclick="App.crm.openPage(); return false;">CRM</a>: ${form ? 'Edit' : 'Create'} Form`;
    }

    if (el('crmFormEditorName'))        el('crmFormEditorName').value       = form?.name || '';
    if (el('crmFormEditorHeading'))     el('crmFormEditorHeading').value    = form?.heading || '';
    if (el('crmFormEditorSubmitLabel')) el('crmFormEditorSubmitLabel').value = form?.submitLabel || 'Submit';
    if (el('crmFormEditorSuccessMsg'))  el('crmFormEditorSuccessMsg').value  = form?.successMessage || 'Thank you! Your information has been saved.';
    if (el('crmFormEditorErrorMsg'))    el('crmFormEditorErrorMsg').value    = form?.errorMessage || 'Something went wrong. Please try again.';
    if (el('crmFormEditorAccentColor')) el('crmFormEditorAccentColor').value = form?.accentColor || '#0b3d7a';

    // Render field checkboxes (all available fields in the CRM)
    const allFields = allConfigFields(currentConfig);
    const selectedKeys = new Set(
      form?.fields?.map((f) => f.key) || allFields.map((f) => f.key)
    );
    const fieldsContainer = el('crmFormEditorFields');
    if (fieldsContainer) {
      fieldsContainer.innerHTML = allFields.map((f) => `
        <label style="display:flex; align-items:center; gap:0.4rem; cursor:pointer;">
          <input type="checkbox" name="formField" value="${f.key}" ${selectedKeys.has(f.key) ? 'checked' : ''} />
          ${escHtml(f.label)}
        </label>
      `).join('');
    }

    // Embed code preview (for existing forms)
    const embedTa = el('crmFormEmbedCode');
    const embedNote = el('crmFormEmbedNote');
    if (form && embedTa) {
      embedTa.value = buildEmbedCode(form);
      if (embedNote) embedNote.style.display = 'none';
    } else if (embedTa) {
      embedTa.value = '';
      if (embedNote) embedNote.style.display = '';
    }

    const cancelBtn = el('crmFormEditorCancelBtn');
    if (cancelBtn) cancelBtn.onclick = () => openPage();

    const copyBtn = el('crmFormCopyEmbedBtn');
    if (copyBtn) copyBtn.onclick = () => {
      const ta = el('crmFormEmbedCode');
      if (ta?.value) { ta.select(); document.execCommand('copy'); notify('Embed code copied.'); }
    };

    const editorForm = el('crmFormEditorForm');
    if (editorForm) {
      editorForm.onsubmit = async (e) => {
        e.preventDefault();
        await saveForm(allFields);
      };
    }

    setActivePage('crmFormEditorPage');
  }

  async function saveForm(allFields) {
    const name = el('crmFormEditorName')?.value.trim() || '';
    if (!name) { notify('Form name is required.', true); return; }

    const checkedKeys = new Set(
      Array.from(document.querySelectorAll('#crmFormEditorFields input[name="formField"]:checked')).map((cb) => cb.value)
    );
    const fields = allFields
      .filter((f) => checkedKeys.has(f.key))
      .map((f) => ({ key: f.key, label: f.label, type: f.type, required: Boolean(f.required) }));

    const payload = {
      crmConfigId: currentConfig.id,
      name,
      heading: el('crmFormEditorHeading')?.value.trim() || '',
      submitLabel: el('crmFormEditorSubmitLabel')?.value.trim() || 'Submit',
      successMessage: el('crmFormEditorSuccessMsg')?.value.trim() || 'Thank you! Your information has been saved.',
      errorMessage: el('crmFormEditorErrorMsg')?.value.trim() || 'Something went wrong. Please try again.',
      accentColor: el('crmFormEditorAccentColor')?.value || '#0b3d7a',
      fields,
    };

    try {
      let saved;
      if (editingFormId) {
        const res = await api(`/api/crm/forms/${encodeURIComponent(editingFormId)}`, {
          method: 'PUT', body: JSON.stringify(payload),
        });
        saved = res.form || res.data || res;
        notify('Form saved.');
      } else {
        const res = await api('/api/crm/forms', {
          method: 'POST', body: JSON.stringify(payload),
        });
        saved = res.form || res.data || res;
        editingFormId = saved?.id || null;
        notify('Form created.');
      }
      // Refresh embed code
      if (saved && el('crmFormEmbedCode')) {
        // Update currentForms to use saved form
        const idx = currentForms.findIndex((f) => f.id === saved.id);
        if (idx >= 0) currentForms[idx] = saved; else currentForms.unshift(saved);
        el('crmFormEmbedCode').value = buildEmbedCode(saved);
        if (el('crmFormEmbedNote')) el('crmFormEmbedNote').style.display = 'none';
      }
    } catch (err) {
      notify(err.message || 'Failed to save form.', true);
    }
  }

  async function deleteForm(id) {
    if (!confirm('Delete this form? This cannot be undone.')) return;
    try {
      await api(`/api/crm/forms/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('Form deleted.');
      await openFormsView();
    } catch (err) {
      notify(err.message || 'Failed to delete form.', true);
    }
  }

  // ── Fields config view ───────────────────────────────────────────────────────
  function openFieldsView() {
    showPanel('crmFieldsPanel');

    configCustomFields = currentConfig
      ? JSON.parse(JSON.stringify(Array.isArray(currentConfig.customFields) ? currentConfig.customFields : []))
      : [];

    renderStandardFieldGrid('crmStandardFieldsGrid', currentConfig?.standardFields || []);
    renderCustomFieldsList('crmCustomFieldsList', configCustomFields, (idx) => {
      configCustomFields.splice(idx, 1);
      renderCustomFieldsList('crmCustomFieldsList', configCustomFields, arguments.callee);
    });

    const addBtn = el('crmAddCustomFieldBtn');
    if (addBtn) {
      addBtn.onclick = () => openAddCustomFieldModal((field) => {
        configCustomFields.push(field);
        renderCustomFieldsList('crmCustomFieldsList', configCustomFields, (idx) => {
          configCustomFields.splice(idx, 1);
          renderCustomFieldsList('crmCustomFieldsList', configCustomFields, addBtn.onclick);
        });
      });
    }

    const form = el('crmFieldConfigForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await saveFieldConfig();
      };
    }
  }

  async function saveFieldConfig() {
    const standardFields = collectCheckedStandardFields('crmStandardFieldsGrid');
    try {
      const res = await api(`/api/crm/configs/${encodeURIComponent(currentConfig.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ standardFields, customFields: configCustomFields }),
      });
      currentConfig = res.config || res.data || currentConfig;
      notify('Field configuration saved.');
      openContactsView();
    } catch (err) {
      notify(err.message || 'Failed to save field configuration.', true);
    }
  }

  // ── Setup page ───────────────────────────────────────────────────────────────
  function openSetupPage() {
    setupCustomFields = [];
    renderStandardFieldGrid('crmSetupStandardFields', ['first_name', 'last_name', 'phone']);
    renderCustomFieldsList('crmSetupCustomFields', setupCustomFields, (idx) => {
      setupCustomFields.splice(idx, 1);
      renderCustomFieldsList('crmSetupCustomFields', setupCustomFields, arguments.callee);
    });

    const addBtn = el('crmSetupAddCustomFieldBtn');
    if (addBtn) {
      addBtn.onclick = () => openAddCustomFieldModal((field) => {
        setupCustomFields.push(field);
        renderCustomFieldsList('crmSetupCustomFields', setupCustomFields, (idx) => {
          setupCustomFields.splice(idx, 1);
          renderCustomFieldsList('crmSetupCustomFields', setupCustomFields, addBtn.onclick);
        });
      });
    }

    const cancelBtn = el('crmSetupCancelBtn');
    if (cancelBtn) cancelBtn.onclick = () => setActivePage('crmPage');

    const form = el('crmSetupForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await generateCrm();
      };
    }

    setActivePage('crmSetupPage');
  }

  async function generateCrm() {
    const name = el('crmSetupName')?.value.trim() || 'CRM';
    const standardFields = collectCheckedStandardFields('crmSetupStandardFields');

    try {
      const res = await api('/api/crm/configs', {
        method: 'POST',
        body: JSON.stringify({ name, standardFields, customFields: setupCustomFields }),
      });
      currentConfig = res.config || res.data || null;
      notify(`CRM "${name}" generated.`);
      setActivePage('crmPage');
      renderPage();
      openContactsView();
    } catch (err) {
      notify(err.message || 'Failed to generate CRM.', true);
    }
  }

  // ── Public navigation helpers ────────────────────────────────────────────────
  function openPage() {
    setActivePage('crmPage');
    loadPage();
  }

  // ── Utility ──────────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    // Wire "Set Up CRM" button
    const setupBtn = el('crmOpenSetupBtn');
    if (setupBtn) setupBtn.onclick = openSetupPage;
  }

  // Run init after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    openPage,
    openContactsView: () => { setActivePage('crmPage'); loadPage().then(() => openContactsView()); },
    openFormsView:    () => { setActivePage('crmPage'); loadPage().then(() => openFormsView()); },
    openFieldsView:   () => { setActivePage('crmPage'); loadPage().then(() => openFieldsView()); },
    init,
  };
})();
