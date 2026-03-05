
/**
 * public/js/settings.js
 * API provider credentials management and database table/field settings.
 */

window.App = window.App || {};
App.settings = (function () {
  const { state, els, api, notify, titleFromKey } = App;

  async function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read logo file'));
      reader.readAsDataURL(file);
    });
  }

  function applyProfileToHeader(profile) {
    state.profile = profile && typeof profile === 'object' ? { ...profile } : {};
    const projectName = String(state.profile.projectName || '').trim();
    const logoDataUrl = String(state.profile.logoDataUrl || '').trim();
    if (els.brandFallback && projectName) {
      els.brandFallback.textContent = projectName;
    }
    if (els.brandProfileLabel) {
      els.brandProfileLabel.textContent = projectName || 'Edit Profile';
      els.brandProfileLabel.classList.toggle('hidden', Boolean(logoDataUrl));
    }
    if (els.brandProfileLogo) {
      const hasLogo = Boolean(logoDataUrl);
      els.brandProfileLogo.classList.toggle('hidden', !hasLogo);
      if (hasLogo) {
        els.brandProfileLogo.src = logoDataUrl;
      } else {
        els.brandProfileLogo.removeAttribute('src');
      }
    }
  }

  function renderProfileForm(profile) {
    if (els.settingsProjectName) els.settingsProjectName.value = String(profile?.projectName || '');
    if (els.settingsContactName) els.settingsContactName.value = String(profile?.contactName || '');
    if (els.settingsProfileEmail) els.settingsProfileEmail.value = String(profile?.email || '');
    if (els.settingsProfilePhone) els.settingsProfilePhone.value = String(profile?.phone || '');
    if (els.settingsProfileWebsite) els.settingsProfileWebsite.value = String(profile?.website || '');
    if (els.settingsProfileLogoDataUrl) els.settingsProfileLogoDataUrl.value = String(profile?.logoDataUrl || '');
    const logoDataUrl = String(profile?.logoDataUrl || '');
    const website = String(profile?.website || '').trim();
    if (els.settingsProfileLogoPreviewWrap && els.settingsProfileLogoPreview) {
      const hasLogo = Boolean(logoDataUrl);
      els.settingsProfileLogoPreviewWrap.classList.toggle('hidden', !hasLogo);
      if (hasLogo) {
        els.settingsProfileLogoPreview.src = logoDataUrl;
      } else {
        els.settingsProfileLogoPreview.removeAttribute('src');
      }
    }
    if (els.settingsProfileLogoLink) {
      const hasWebsite = Boolean(website);
      els.settingsProfileLogoLink.href = hasWebsite ? website : '#';
      els.settingsProfileLogoLink.classList.toggle('is-disabled', !hasWebsite);
      if (!hasWebsite) {
        els.settingsProfileLogoLink.removeAttribute('target');
        els.settingsProfileLogoLink.removeAttribute('rel');
      } else {
        els.settingsProfileLogoLink.setAttribute('target', '_blank');
        els.settingsProfileLogoLink.setAttribute('rel', 'noopener');
      }
    }
  }

  async function refreshProfile() {
    if (!els.settingsProfileForm) return;
    try {
      const res = await api('/api/settings/profile');
      const profile = res.profile || res.data || {};
      renderProfileForm(profile);
      applyProfileToHeader(profile);
    } catch (err) {
      notify(`Could not load profile settings: ${err.message}`, true);
    }
  }

  function getApiToggleBtn() {
    return document.getElementById('apiSettingsToggleBtn');
  }

  function getApiFormTitleEl() {
    return document.getElementById('apiSettingsFormTitle');
  }

  function setApiFormVisible(visible, title) {
    if (els.apiSettingsForm) {
      els.apiSettingsForm.classList.toggle('hidden', !visible);
    }
    const toggleBtn = getApiToggleBtn();
    const titleEl = getApiFormTitleEl();
    if (toggleBtn) toggleBtn.textContent = 'Add API';
    if (titleEl) titleEl.textContent = title || 'Add API';
  }

  function closeApiSettingsForm() {
    clearApiSettingsForm();
    setApiFormVisible(false, 'Add API');
  }

  function openApiSettingsForm(provider, values, title) {
    state.apiFormValues = values && typeof values === 'object' ? { ...values } : {};
    renderApiProviderOptions(provider || els.apiProviderSelect?.value || state.apiSchemas[0]?.provider);
    if (els.apiProviderSelect && provider) {
      els.apiProviderSelect.value = provider;
    }
    renderApiFieldInputs();
    setApiFormVisible(true, title || 'Add API');
  }

  // ---------------------------------------------------------------------------
  // API Settings
  // ---------------------------------------------------------------------------

  function renderApiProviderOptions(selectedProvider) {
    if (!els.apiProviderSelect) return;
    const currentValue = selectedProvider || els.apiProviderSelect.value || state.apiSchemas[0]?.provider || '';
    els.apiProviderSelect.innerHTML = '';
    const sortedSchemas = (state.apiSchemas || []).slice().sort((a, b) => {
      const labelA = String(a?.label || a?.provider || '');
      const labelB = String(b?.label || b?.provider || '');
      return labelA.localeCompare(labelB);
    });
    sortedSchemas.forEach((schema) => {
      const option = document.createElement('option');
      option.value = schema.provider;
      option.textContent = schema.label;
      els.apiProviderSelect.appendChild(option);
    });
    if (currentValue && Array.from(els.apiProviderSelect.options).some((option) => option.value === currentValue)) {
      els.apiProviderSelect.value = currentValue;
    }
  }

  function renderApiFieldInputs() {
    if (!els.apiFieldsContainer) return;
    const provider = els.apiProviderSelect?.value || state.apiSchemas[0]?.provider;
    const schema   = state.apiSchemas.find((s) => s.provider === provider);
    els.apiFieldsContainer.innerHTML = '';
    if (!schema) return;
    schema.fields.forEach((field) => {
      const row   = document.createElement('div');
      row.className = 'form-row';
      const label = document.createElement('label');
      label.setAttribute('for', `api-field-${field.key}`);
      label.textContent = field.required ? `${field.label} *` : field.label;
      const input = document.createElement('input');
      input.id           = `api-field-${field.key}`;
      input.type         = field.secret ? 'password' : 'text';
      input.name         = field.key;
      input.placeholder  = field.label;
      input.autocomplete = 'off';
      if (field.required) input.required = true;
      input.value = String(state.apiFormValues[field.key] || '');
      row.appendChild(label);
      row.appendChild(input);
      els.apiFieldsContainer.appendChild(row);
    });
  }

  function clearApiSettingsForm() {
    state.apiFormValues = {};
    if (els.apiSettingsForm) els.apiSettingsForm.reset();
    renderApiProviderOptions(state.apiSchemas[0]?.provider);
    renderApiFieldInputs();
  }

  async function editApiConfig(provider) {
    const data = await api(`/api/settings/apis/${encodeURIComponent(provider)}`);
    openApiSettingsForm(data.provider, data.values || {}, `Edit API: ${data.label || data.provider}`);
  }

  async function deleteApiConfig(provider) {
    await api(`/api/settings/apis/${encodeURIComponent(provider)}`, { method: 'DELETE' });
  }

  function renderApiConfigsTable() {
    if (!els.apiConfigsTable) return;
    els.apiConfigsTable.innerHTML = '';
    state.apiConfigs.forEach((cfg) => {
      const tr = document.createElement('tr');
      const renderedValues = Object.entries(cfg.values || {})
        .map(([k, v]) => `${k}: ${v || '-'}`).join(' | ');

      const providerTd = document.createElement('td');
      providerTd.textContent = cfg.label || cfg.provider;
      const statusTd = document.createElement('td');
      statusTd.textContent = cfg.configured ? 'Configured' : 'Missing required fields';
      const updatedTd = document.createElement('td');
      updatedTd.textContent = cfg.updatedAt || '-';
      const valuesTd = document.createElement('td');
      valuesTd.textContent = renderedValues || '-';

      const editBtn = App.makeIconButton('edit', 'Edit API', async () => {
        try {
          await editApiConfig(cfg.provider);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          notify(`Loaded ${cfg.label || cfg.provider}`);
        }
        catch (err) { notify(err.message, true); }
      });
      const deleteBtn = App.makeIconButton('delete', 'Delete API', async () => {
        if (!confirm(`Delete API credentials for ${cfg.label || cfg.provider}?`)) return;
        try {
          await deleteApiConfig(cfg.provider);
          clearApiSettingsForm();
          await refreshApiSettings();
          notify(`Deleted ${cfg.label || cfg.provider}`);
        } catch (err) { notify(err.message, true); }
      }, { danger: true, marginLeft: '8px' });

      const actionsTd = document.createElement('td');
      actionsTd.className = 'api-actions-cell';
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);

      [providerTd, statusTd, updatedTd, valuesTd, actionsTd].forEach((td) => tr.appendChild(td));
      els.apiConfigsTable.appendChild(tr);
    });
  }

  async function refreshApiSettings() {
    if (!els.apiProviderSelect || !els.apiConfigsTable) return;
    const currentProvider = els.apiProviderSelect.value || state.apiSchemas[0]?.provider;
    const [schemaRes, configRes] = await Promise.all([
      api('/api/settings/apis/schema'),
      api('/api/settings/apis')
    ]);
    state.apiSchemas = schemaRes.providers || [];
    state.apiConfigs = configRes.configs   || [];
    renderApiProviderOptions(currentProvider);
    renderApiFieldInputs();
    renderApiConfigsTable();
  }

  async function refreshDbConnectionForm() {
    if (!els.dbConnectionForm) return;
    try {
      const cfg = await api('/api/settings/apis/supabase');
      const values = cfg.values || {};
      if (els.dbSupabaseUrl)             els.dbSupabaseUrl.value             = values.url || '';
      if (els.dbSupabaseServiceRoleKey)  els.dbSupabaseServiceRoleKey.value  = values.service_role_key || '';
      if (els.dbContactsTable)           els.dbContactsTable.value           = values.contacts_table || '';
      if (els.dbPromoLeadsTable)         els.dbPromoLeadsTable.value         = values.promo_leads_table || '';
      if (els.dbPromoLeadFieldsTable)    els.dbPromoLeadFieldsTable.value    = values.promo_lead_fields_table || '';
      if (els.dbHarvestYoutubeDetailsTable)  els.dbHarvestYoutubeDetailsTable.value  = values.harvest_youtube_details_table || '';
      if (els.dbHarvestYoutubeCommentsTable) els.dbHarvestYoutubeCommentsTable.value = values.harvest_youtube_comments_table || '';
    } catch (err) {
      notify(`Could not load database connection settings: ${err.message}`, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Database settings
  // ---------------------------------------------------------------------------

  function renderDatabaseTables() {
    if (!els.databaseTableSelect) return;
    els.databaseTableSelect.innerHTML = '';
    state.databaseTables.forEach((table) => {
      const option = document.createElement('option');
      option.value    = table.key;
      option.textContent = `${table.label} (${table.key})${table.supportsFieldCreation ? '' : ' - read only'}`;
      option.disabled = !table.supportsFieldCreation;
      els.databaseTableSelect.appendChild(option);
    });
    const firstEnabled = Array.from(els.databaseTableSelect.options).find((o) => !o.disabled);
    if (firstEnabled) els.databaseTableSelect.value = firstEnabled.value;
    renderDatabaseFieldNameOptions();
  }

  function renderDatabaseFieldsTable() {
    if (!els.databaseFieldsTable) return;
    els.databaseFieldsTable.innerHTML = '';
    state.promoFields.forEach((field) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${field.key}</td><td>${field.label || '-'}</td><td>${field.type || 'text'}</td>
        <td>${field.required ? 'yes' : 'no'}</td><td>${field.is_active === false ? 'no' : 'yes'}</td>
      `;
      els.databaseFieldsTable.appendChild(tr);
    });
  }

  function renderDatabaseFieldNameOptions() {
    if (!els.databaseFieldNameOption) return;
    const table  = els.databaseTableSelect?.value || '';
    const select = els.databaseFieldNameOption;
    select.innerHTML = '';
    const customOption = document.createElement('option');
    customOption.value = '__custom__';
    customOption.textContent = 'Custom field name';
    select.appendChild(customOption);

    if (table.includes('promo_leads')) {
      const existing = new Set([
        ...App.STANDARD_LEAD_COLUMNS,
        ...state.promoFields.map((f) => String(f.key || '').toLowerCase())
      ]);
      App.SUGGESTED_CUSTOM_FIELD_KEYS.filter((k) => !existing.has(k)).forEach((key) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = `${titleFromKey(key)} (${key})`;
        select.appendChild(option);
      });
    }

    select.value = '__custom__';
    if (els.databaseFieldNameInput) {
      els.databaseFieldNameInput.value    = '';
      els.databaseFieldNameInput.disabled = false;
    }
  }

  async function refreshDatabaseTables() {
    if (!els.databaseTableSelect) return;
    const res = await api('/api/settings/database/tables');
    state.databaseTables = res.tables || [];
    renderDatabaseTables();
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  function init() {
    if (els.brandProfileButton) {
      els.brandProfileButton.addEventListener('click', () => {
        App.setActivePage('settingsProfilePage');
      });
    }

    if (els.settingsProfileLogoFile) {
      els.settingsProfileLogoFile.addEventListener('change', async () => {
        const file = els.settingsProfileLogoFile.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await readFileAsDataUrl(file);
          if (els.settingsProfileLogoDataUrl) els.settingsProfileLogoDataUrl.value = dataUrl;
          renderProfileForm({
            ...(state.profile || {}),
            logoDataUrl: dataUrl,
          });
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (els.settingsProfileForm) {
      els.settingsProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(els.settingsProfileForm);
        const projectName = String(formData.get('project_name') || '').trim();
        if (!projectName) return notify('Project name is required', true);
        const payload = {
          project_name: projectName,
          contact_name: String(formData.get('contact_name') || '').trim(),
          email: String(formData.get('email') || '').trim(),
          phone: String(formData.get('phone') || '').trim(),
          website: String(formData.get('website') || '').trim(),
          logo_data_url: String(formData.get('logo_data_url') || '').trim(),
        };
        try {
          const res = await api('/api/settings/profile', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          const profile = res.profile || res.data || payload;
          renderProfileForm(profile);
          applyProfileToHeader(profile);
          if (els.settingsProfileLogoFile) els.settingsProfileLogoFile.value = '';
          notify('Profile saved');
        } catch (err) {
          notify(err.message, true);
        }
      });
      refreshProfile();
    }

    if (els.dbConnectionForm) {
      els.dbConnectionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(els.dbConnectionForm);
        const values = {
          url: String(formData.get('url') || '').trim(),
          service_role_key: String(formData.get('service_role_key') || '').trim(),
          contacts_table: String(formData.get('contacts_table') || '').trim(),
          promo_leads_table: String(formData.get('promo_leads_table') || '').trim(),
          promo_lead_fields_table: String(formData.get('promo_lead_fields_table') || '').trim(),
          harvest_youtube_details_table: String(formData.get('harvest_youtube_details_table') || '').trim(),
          harvest_youtube_comments_table: String(formData.get('harvest_youtube_comments_table') || '').trim(),
        };
        try {
          await api('/api/settings/apis', {
            method: 'POST',
            body: JSON.stringify({ provider: 'supabase', values }),
          });
          notify('Database connection settings saved');
          await refreshDbConnectionForm();
          await refreshApiSettings();
          await refreshDatabaseTables();
          await App.promoLeads.refresh();
        } catch (err) {
          notify(err.message, true);
        }
      });
      refreshDbConnectionForm();
    }

    if (els.databaseFieldForm) {
      els.databaseFieldForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(els.databaseFieldForm);
        const selectedOption = String(formData.get('field_name_option') || '__custom__');
        const key = selectedOption === '__custom__'
          ? String(formData.get('key_custom') || '').trim()
          : selectedOption;
        if (!key) return notify('Field name is required', true);
        const payload = {
          table: formData.get('table'), key,
          label: formData.get('label'), type: formData.get('type'),
          position: Number(formData.get('position') || 0),
          required:  formData.get('required')  === 'on',
          is_active: formData.get('is_active') === 'on',
          options: String(formData.get('optionsText') || '').split(',').map((s) => s.trim()).filter(Boolean)
        };
        try {
          const result = await api('/api/settings/database/fields', { method: 'POST', body: JSON.stringify(payload) });
          notify(result.message || 'Field created');
          els.databaseFieldForm.reset();
          renderDatabaseFieldNameOptions();
          await App.promoLeads.refresh();
          await refreshDatabaseTables();
        } catch (err) { notify(err.message, true); }
      });
      refreshApiSettings();
      refreshDatabaseTables();
    }

    if (els.databaseTableSelect) {
      els.databaseTableSelect.addEventListener('change', () => renderDatabaseFieldNameOptions());
    }

    if (els.databaseFieldNameOption) {
      els.databaseFieldNameOption.addEventListener('change', () => {
        const chosen = els.databaseFieldNameOption.value;
        if (!els.databaseFieldNameInput) return;
        if (chosen === '__custom__') {
          els.databaseFieldNameInput.value    = '';
          els.databaseFieldNameInput.disabled = false;
          els.databaseFieldNameInput.focus();
        } else {
          els.databaseFieldNameInput.value    = chosen;
          els.databaseFieldNameInput.disabled = true;
          if (els.databaseFieldLabelInput && !els.databaseFieldLabelInput.value.trim()) {
            els.databaseFieldLabelInput.value = titleFromKey(chosen);
          }
        }
      });
    }

    if (els.apiProviderSelect) {
      els.apiProviderSelect.addEventListener('change', () => {
        state.apiFormValues = {};
        renderApiFieldInputs();
      });
    }

    const apiToggleBtn = getApiToggleBtn();
    if (apiToggleBtn) {
      apiToggleBtn.addEventListener('click', () => {
        openApiSettingsForm(state.apiSchemas[0]?.provider || '', {}, 'Add API');
      });
    }

    if (els.apiSettingsForm) {
      els.apiSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const provider = els.apiProviderSelect?.value;
        const values   = {};
        els.apiFieldsContainer?.querySelectorAll('input[name]').forEach((input) => {
          values[input.name] = String(input.value || '').trim();
        });
        try {
          await api('/api/settings/apis', { method: 'POST', body: JSON.stringify({ provider, values }) });
          notify('API credentials saved');
          closeApiSettingsForm();
          await refreshApiSettings();
          await App.promoLeads.refresh();
        } catch (err) { notify(err.message, true); }
      });
    }

    closeApiSettingsForm();
  }

  return {
    init,
    manifest: { id: 'settings', label: 'Settings', pageId: 'settingsPage' },
    onPageActivated: async function () {
      await refreshProfile();
      await refreshApiSettings();
      closeApiSettingsForm();
    },
    openApiSettingsForm,
    renderApiFieldInputs,
    refreshApiSettings,
    refreshProfile,
    refreshDbConnectionForm,
    refreshDatabaseTables,
    renderDatabaseFieldsTable,
    renderDatabaseFieldNameOptions
  };
})();
