
/**
 * public/js/settings.js
 * API provider credentials management and database table/field settings.
 */

window.App = window.App || {};
App.settings = (function () {
  const { state, els, api, notify, titleFromKey } = App;
  const CHANNEL_CONNECTION_ROWS = [
    { key: 'x', label: 'X', provider: 'x', coreFields: 'api_key, api_secret, access_token, access_token_secret' },
    { key: 'facebook', label: 'Facebook', provider: 'meta', coreFields: 'app_id, app_secret' },
    { key: 'instagram', label: 'Instagram', provider: 'instagram', coreFields: 'app_id, app_secret, access_token' },
    { key: 'linkedin', label: 'LinkedIn', provider: 'linkedin', coreFields: 'client_id, client_secret' },
    { key: 'threads', label: 'Threads', provider: 'threads', coreFields: 'app_id, app_secret' },
    { key: 'bluesky', label: 'Bluesky', provider: 'bluesky', coreFields: 'identifier, app_password' },
    { key: 'pinterest', label: 'Pinterest', provider: 'pinterest', coreFields: 'app_id, app_secret' },
    { key: 'reddit', label: 'Reddit', provider: 'reddit', coreFields: 'client_id, client_secret, refresh_token' },
    { key: 'telegram', label: 'Telegram', provider: 'telegram', coreFields: 'bot_token, chat_id' },
    { key: 'youtube', label: 'YouTube', provider: 'youtube', coreFields: 'api_key' },
    { key: 'quora', label: 'Quora', provider: 'quora', coreFields: 'client_id, client_secret' },
    { key: 'substack', label: 'Substack', provider: 'substack', coreFields: 'publication_url' },
    { key: 'medium', label: 'Medium', provider: 'medium', coreFields: 'integration_token' },
    { key: 'patreon', label: 'Patreon', provider: 'patreon', coreFields: 'client_id, client_secret' },
  ];
  const connectionOpsState = {
    platform: '',
    data: null,
    supported: [],
    byPlatform: {},
  };
  const PROJECT_LOGO_STORAGE_KEY = 'alphire.projectLogoMap';
  let activeChannelLabel = '';

  function byId(id) {
    return document.getElementById(id);
  }

  function setProjectsCreateVisible(visible) {
    const panel = byId('settingsProjectsCreatePanel');
    if (panel) panel.classList.toggle('hidden', !visible);
  }

  function refreshCurrentPageAfterProjectChange() {
    const activePage = String(App.state?.activePage || '').trim();
    if (!activePage || typeof App.setActivePage !== 'function') return;
    window.setTimeout(() => {
      App.setActivePage(activePage, { persist: false });
    }, 0);
  }

  function openProjectsPage() {
    setProjectsCreateVisible(false);
    App.setActivePage('settingsProjectsPage');
    refreshProjectContext().catch((err) => notify(err.message || 'Could not load projects', true));
    window.setTimeout(() => {
      refreshProjectContext().catch(() => {});
    }, 250);
  }

  function openProjectsCreate() {
    setProjectsCreateVisible(true);
    App.setActivePage('settingsProjectsPage');
    if (els.settingsNewProjectName) els.settingsNewProjectName.value = '';
    if (els.settingsNewProjectDescription) els.settingsNewProjectDescription.value = '';
    const panel = byId('settingsProjectsCreatePanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function refreshPromoLeadsIfAvailable() {
    if (App.promoLeads && typeof App.promoLeads.refresh === 'function') {
      await App.promoLeads.refresh();
    }
  }

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
    if (els.brandFallback && projectName) {
      els.brandFallback.textContent = projectName;
    }
    applyProjectToHeader();
  }

  function applyProjectToHeader() {
    const projects = Array.isArray(state.projects) ? state.projects : [];
    const activeProject = projects.find((project) => String(project?.id || '') === String(state.currentProjectId || '')) || null;
    const projectLogo = getProjectLogoDataUrl(activeProject);
    const hasActiveProject = Boolean(activeProject);
    const hasLogo = hasActiveProject && Boolean(projectLogo);

    if (els.brandProfileButton) {
      els.brandProfileButton.classList.toggle('has-logo', hasLogo);
      els.brandProfileButton.title = hasActiveProject ? 'Project details' : 'Projects';
    }
    if (els.brandProfileLabel) {
      if (!hasActiveProject) {
        els.brandProfileLabel.textContent = 'Projects';
      } else {
        const activeName = String(activeProject?.name || activeProject?.slug || '').trim();
        els.brandProfileLabel.textContent = activeName || 'Project';
      }
      els.brandProfileLabel.classList.toggle('hidden', hasLogo);
    }
    if (els.brandProfileLogo) {
      els.brandProfileLogo.classList.toggle('hidden', !hasLogo);
      if (hasLogo) {
        els.brandProfileLogo.src = projectLogo;
      } else {
        els.brandProfileLogo.removeAttribute('src');
      }
    }
  }

  function readProjectLogoMap() {
    try {
      const raw = String(window.localStorage.getItem(PROJECT_LOGO_STORAGE_KEY) || '').trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeProjectLogoMap(map) {
    try {
      window.localStorage.setItem(PROJECT_LOGO_STORAGE_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function getProjectLogoDataUrl(project) {
    const id = String(project?.id || '').trim();
    if (!id) return '';
    const map = readProjectLogoMap();
    const mapped = String(map[id] || '').trim();
    if (mapped) return mapped;
    const fromProject = String(project?.logoDataUrl || project?.logo_data_url || '').trim();
    if (fromProject) return fromProject;
    return String(state.profile?.logoDataUrl || '').trim();
  }

  function setProjectLogoDataUrl(projectIdInput, dataUrlInput) {
    const projectId = String(projectIdInput || '').trim();
    const dataUrl = String(dataUrlInput || '').trim();
    if (!projectId) return;
    const map = readProjectLogoMap();
    if (!dataUrl) {
      delete map[projectId];
    } else {
      map[projectId] = dataUrl;
    }
    writeProjectLogoMap(map);
  }

  function formatDateLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return raw;
    return dt.toLocaleString();
  }

  function renderProjectLists() {
    const projects = Array.isArray(state.projects) ? state.projects : [];
    if (els.settingsProfileProjectsList) {
      els.settingsProfileProjectsList.innerHTML = '';
      if (!projects.length) {
        els.settingsProfileProjectsList.textContent = 'No projects found.';
      } else {
        const labels = projects.map((project) => {
          const id = String(project?.id || '').trim();
          const name = String(project?.name || project?.slug || id || 'Untitled').trim();
          const role = String(project?.membership?.role || 'member').trim();
          const marker = id === String(state.currentProjectId || '') ? ' (active)' : '';
          return `${name}${marker} - ${role}`;
        });
        els.settingsProfileProjectsList.innerHTML = labels.map((label) => `<div>${label}</div>`).join('');
      }
    }
    const renderInto = (container) => {
      if (!container) return;
      container.innerHTML = '';
      if (!projects.length) {
        const empty = document.createElement('div');
        empty.className = 'meta';
        empty.textContent = 'No projects found.';
        container.appendChild(empty);
        return;
      }
      projects.forEach((project) => {
        const id = String(project?.id || '').trim();
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'settings-project-list-item';
        row.classList.toggle('is-active', id === String(state.currentProjectId || ''));
        row.innerHTML = `
          <div class="settings-project-list-item-name">${String(project?.name || project?.slug || id || 'Untitled')}</div>
          <div class="settings-project-list-item-meta">${String(project?.membership?.role || 'member')} • ${String(project?.slug || id)}</div>
        `;
        row.addEventListener('click', () => {
          if (!id) return;
          state.currentProjectId = id;
          window.localStorage.setItem(App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId', id);
          renderProjectSelector();
          renderProjectLists();
          renderProjectDetails();
          applyProjectToHeader();
          refreshCurrentPageAfterProjectChange();
          notify('Active project updated');
        });
        container.appendChild(row);
      });
    };
    renderInto(els.settingsProjectsList);
  }

  function renderProjectsTable() {
    const body = byId('settingsProjectsTableBody');
    if (!body) return;
    const projects = Array.isArray(state.projects) ? state.projects : [];
    if (!projects.length) {
      body.innerHTML = '<tr><td colspan="6" class="meta">No projects found.</td></tr>';
      return;
    }
    body.innerHTML = '';
    projects.forEach((project) => {
      const id = String(project?.id || '').trim();
      const row = document.createElement('tr');
      const isActive = id && id === String(state.currentProjectId || '');
      row.innerHTML = `
        <td>${String(project?.name || project?.slug || id || 'Untitled')}</td>
        <td>${String(project?.slug || '-')}</td>
        <td>${String(project?.membership?.role || 'member')}</td>
        <td>${String(project?.description || '')}</td>
        <td>${formatDateLabel(project?.createdAt || project?.created_at || '') || '-'}</td>
        <td class="settings-projects-actions-cell actions-col"></td>
      `;
      const actionsCell = row.querySelector('.settings-projects-actions-cell');
      if (actionsCell) {
        const selectProject = () => {
          if (!id) return;
          state.currentProjectId = id;
          window.localStorage.setItem(App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId', id);
          renderProjectSelector();
          renderProjectLists();
          renderProjectsTable();
          renderProjectDetails();
          applyProjectToHeader();
          refreshCurrentPageAfterProjectChange();
        };
        const activateBtn = App.makeIconButton(
          'approve',
          isActive ? 'Active' : 'Set Active',
          () => {
            selectProject();
            notify('Active project updated');
          },
          { disabled: isActive }
        );
        if (isActive) activateBtn.classList.add('settings-project-active-btn');
        const detailsBtn = App.makeIconButton('view', 'Details', () => {
          selectProject();
          const panel = els.settingsProjectDetailsPanel;
          if (panel && typeof panel.scrollIntoView === 'function') {
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        actionsCell.appendChild(activateBtn);
        actionsCell.appendChild(detailsBtn);
      }
      body.appendChild(row);
    });
  }

  function renderProjectDetails() {
    const projects = Array.isArray(state.projects) ? state.projects : [];
    const active = projects.find((project) => String(project?.id || '') === String(state.currentProjectId || '')) || null;

    if (!els.settingsProjectDetailsPanel || !els.settingsProjectDetailsEmpty) return;
    const showPanel = Boolean(active);
    els.settingsProjectDetailsPanel.classList.toggle('hidden', !showPanel);
    els.settingsProjectDetailsEmpty.classList.toggle('hidden', showPanel);
    if (!showPanel) return;

    if (els.settingsProjectDetailsName) {
      els.settingsProjectDetailsName.value = String(active?.name || '');
    }
    if (els.settingsProjectDetailsSlug) {
      els.settingsProjectDetailsSlug.value = String(active?.slug || '');
    }
    if (els.settingsProjectDetailsDescription) {
      els.settingsProjectDetailsDescription.value = String(active?.description || '');
    }
    if (els.settingsProjectDetailsRole) {
      els.settingsProjectDetailsRole.value = String(active?.membership?.role || 'member');
    }
    if (els.settingsProjectDetailsCreatedAt) {
      els.settingsProjectDetailsCreatedAt.value = formatDateLabel(active?.createdAt || active?.created_at || '');
    }
    const logoDataUrl = getProjectLogoDataUrl(active);
    if (els.settingsProjectLogoPreview) {
      const hasLogo = Boolean(logoDataUrl);
      els.settingsProjectLogoPreview.classList.toggle('hidden', !hasLogo);
      if (hasLogo) {
        els.settingsProjectLogoPreview.src = logoDataUrl;
      } else {
        els.settingsProjectLogoPreview.removeAttribute('src');
      }
    }
    if (els.settingsProjectLogoPlaceholder) {
      els.settingsProjectLogoPlaceholder.classList.toggle('hidden', Boolean(logoDataUrl));
    }
  }

  function getAccountIdentity(profile) {
    const fromAuth = App.auth?.user || {};
    const fromProfile = profile && typeof profile === 'object' ? profile.account || {} : {};
    return {
      name: String(fromAuth.name || fromProfile.name || '').trim(),
      email: String(fromAuth.email || fromProfile.email || '').trim().toLowerCase(),
    };
  }

  function renderProfileForm(profile) {
    const account = getAccountIdentity(profile);
    if (els.settingsAccountName) els.settingsAccountName.value = account.name;
    if (els.settingsAccountEmail) els.settingsAccountEmail.value = account.email;
    if (els.settingsContactName) {
      const contactName = String(profile?.contactName || '').trim() || account.name;
      els.settingsContactName.value = contactName;
    }
    if (els.settingsProfileEmail) {
      const contactEmail = String(profile?.email || '').trim() || account.email;
      els.settingsProfileEmail.value = contactEmail;
    }
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
      profile.account = profile.account || getAccountIdentity(profile);
      renderProfileForm(profile);
      applyProfileToHeader(profile);
    } catch (err) {
      notify(`Could not load profile settings: ${err.message}`, true);
    }
  }

  function renderProjectSelector() {
    if (!els.settingsProjectSelector) return;
    els.settingsProjectSelector.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Select Project --';
    els.settingsProjectSelector.appendChild(placeholder);
    const projects = Array.isArray(state.projects) ? state.projects : [];
    projects.forEach((project) => {
      const option = document.createElement('option');
      option.value = String(project?.id || '').trim();
      option.textContent = String(project?.name || project?.slug || option.value || 'Untitled');
      els.settingsProjectSelector.appendChild(option);
    });
    if (state.currentProjectId && projects.some((project) => String(project?.id || '') === state.currentProjectId)) {
      els.settingsProjectSelector.value = state.currentProjectId;
    } else {
      els.settingsProjectSelector.value = '';
    }
    renderProjectLists();
    renderProjectsTable();
    renderProjectDetails();
  }

  async function refreshProjectContext() {
    try {
      const current = await api('/api/projects/current', { method: 'GET' });
      const projectsRes = await api('/api/projects', { method: 'GET' });
      state.projects = Array.isArray(projectsRes.projects) ? projectsRes.projects : (projectsRes.data || []);
      const currentProject = current.project || null;
      if (currentProject?.id) {
        state.currentProjectId = String(currentProject.id);
        window.localStorage.setItem(App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId', state.currentProjectId);
      } else {
        state.currentProjectId = '';
        window.localStorage.removeItem(App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId');
      }
      renderProjectSelector();
      applyProjectToHeader();
    } catch (err) {
      notify(`Could not load projects: ${err.message}`, true);
    }
  }

  function getApiToggleBtn() {
    return document.getElementById('apiSettingsToggleBtn');
  }

  function getApiAllBtn() {
    return document.getElementById('apiSettingsAllBtn');
  }

  function getApiFormTitleEl() {
    return document.getElementById('apiSettingsFormTitle');
  }

  function getApiFormContextEl() {
    return document.getElementById('apiSettingsFormContext');
  }

  function getApiProviderHelpEl() {
    return document.getElementById('apiProviderHelp');
  }

  function setSettingsApisHeadingChannel(channelLabel) {
    const heading = document.getElementById('settingsApisHeading');
    if (!heading) return;
    const text = String(channelLabel || '').trim();
    heading.textContent = text ? `Settings: APIs — Channel: ${text}` : 'Settings: APIs';
  }

  function refreshSettingsApisHeadingFromUi() {
    const editorVisible = !!(els.apiSettingsForm && !els.apiSettingsForm.classList.contains('hidden'));
    if (editorVisible && activeChannelLabel) {
      setSettingsApisHeadingChannel(activeChannelLabel);
    } else {
      setSettingsApisHeadingChannel('');
    }
  }

  function setApiFormVisible(visible, title) {
    if (els.apiSettingsForm) {
      els.apiSettingsForm.classList.toggle('hidden', !visible);
    }
    const toggleBtn = getApiToggleBtn();
    const titleEl = getApiFormTitleEl();
    const contextEl = getApiFormContextEl();
    if (toggleBtn) toggleBtn.textContent = 'Add API';
    if (titleEl) titleEl.textContent = 'Credentials';
    if (contextEl) contextEl.textContent = visible ? String(title || '').trim() : '';
    refreshSettingsApisHeadingFromUi();
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
    setApiFormVisible(true, title || '');
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
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
      if (provider === 'bluesky' && field.key === 'service_url') {
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'service_url';
        hidden.value = String(state.apiFormValues.service_url || 'https://bsky.social');
        els.apiFieldsContainer.appendChild(hidden);
        return;
      }
      const row   = document.createElement('div');
      row.className = 'form-row';
      const label = document.createElement('label');
      label.setAttribute('for', `api-field-${field.key}`);
      const helpText = getApiFieldHelpText(provider, field.key, field.label);
      label.textContent = field.required ? `${field.label} *` : field.label;
      if (helpText) label.title = helpText;
      const isMultiline = field.multiline === true;
      const input = isMultiline ? document.createElement('textarea') : document.createElement('input');
      input.id = `api-field-${field.key}`;
      input.name = field.key;
      input.placeholder = field.label;
      if (provider === 'bluesky' && field.key === 'identifier') {
        input.placeholder = 'Handle or email (e.g., name.bsky.social)';
      }
      if (provider === 'bluesky' && field.key === 'app_password') {
        input.placeholder = 'App password from Bluesky settings';
      }
      input.autocomplete = 'off';
      if (!isMultiline) {
        input.type = field.secret ? 'password' : 'text';
      } else {
        input.rows = Number(field.rows || 6) || 6;
      }
      if (field.required) input.required = true;
      input.value = String(state.apiFormValues[field.key] || '');
      row.appendChild(label);
      row.appendChild(input);
      // Add Show/Hide toggle for secret fields
      if (field.secret && !isMultiline) {
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.textContent = 'Show';
        toggleBtn.style.cssText = 'margin-left:8px; padding:4px 10px; font-size:0.8rem; cursor:pointer; border:1px solid #555; border-radius:4px; background:#333; color:#ccc;';
        toggleBtn.addEventListener('click', () => {
          if (input.type === 'password') {
            input.type = 'text';
            toggleBtn.textContent = 'Hide';
          } else {
            input.type = 'password';
            toggleBtn.textContent = 'Show';
          }
        });
        row.appendChild(toggleBtn);
      }
      els.apiFieldsContainer.appendChild(row);
    });
    renderApiProviderHelp(provider);
  }

  function getApiFieldHelpText(provider, fieldKey, fieldLabel) {
    const p = String(provider || '').trim().toLowerCase();
    const k = String(fieldKey || '').trim().toLowerCase();

    const byProvider = {
      meta: {
        app_id: 'Meta App ID (numeric), not the app name. Find it in Meta App Dashboard > App Settings > Basic.',
        app_secret: 'Meta App Secret for this app. Copy from App Settings > Basic > App Secret.',
        access_token: 'Use a Page access token (long-lived preferred) from Graph API Explorer / Access Token tools.',
        page_id: 'Facebook Page ID (numeric). Query /me/accounts in Graph API Explorer to find your page id.',
      },
      instagram: {
        app_id: 'Meta App ID (numeric), not the app name.',
        app_secret: 'Meta App Secret for the app tied to Instagram Graph access.',
        access_token: 'Instagram Graph access token with content publish permissions.',
        business_account_id: 'Instagram Business Account ID (numeric), not @handle. Can be retrieved via Graph API.',
      },
      threads: {
        app_id: 'Meta App ID (numeric), not the app name.',
        app_secret: 'Meta App Secret for the app with Threads API access.',
        access_token: 'Threads user access token with required publish scopes.',
        user_id: 'Threads User ID (numeric/string id from Threads Graph API), not @username.',
      },
      x: {
        api_key: 'X API Key (Consumer Key) from the X app in Developer Portal.',
        api_secret: 'X API Secret (Consumer Secret) paired with the API Key.',
        access_token: 'User Access Token for the account that will post.',
        access_token_secret: 'User Access Token Secret paired with Access Token.',
      },
      bluesky: {
        identifier: 'Use full handle or login email. Example: yourname.bsky.social (no @).',
        app_password: 'Use an app password generated in Bluesky Settings > App Passwords (not your main account password).',
      },
      telegram: {
        bot_token: 'Bot token from @BotFather (looks like 123456:ABC...).',
        chat_id: 'Target chat/channel id. Get it from getUpdates after messaging the bot.',
      },
      reddit: {
        client_id: 'Reddit app ID (under app name on reddit.com/prefs/apps).',
        client_secret: 'Reddit app secret from the same app card.',
        refresh_token: 'OAuth refresh token minted for your Reddit app/scopes.',
      },
    };

    const providerHelp = byProvider[p] || {};
    if (providerHelp[k]) return providerHelp[k];

    if (k.includes('token')) return 'Paste the API/OAuth token value exactly as provided by the platform (no extra quotes/spaces).';
    if (k.includes('secret')) return 'Paste the secret exactly as issued by the provider. Keep this private.';
    if (k.includes('client_id') || k === 'app_id') return 'Use the provider-issued ID value (often numeric/string id), not the display name.';
    if (k.endsWith('_id') || k === 'user_id' || k === 'page_id') return 'Use the platform object ID value, not a username/handle unless explicitly stated.';
    if (k.includes('base_url') || k.includes('service_url') || k === 'url') return 'Endpoint URL for API calls. Leave default unless you use a custom/self-hosted endpoint.';
    return `Enter the value for "${fieldLabel}" from the provider dashboard.`;
  }

  function renderApiProviderHelp(provider) {
    const helpEl = getApiProviderHelpEl();
    if (!helpEl) return;
    helpEl.innerHTML = '';

    const PROVIDER_HELP = {
      openclaw:  { logo: 'https://cdn.simpleicons.org/openai/0b82d4', setupUrl: 'https://github.com/openclaw/openclaw', title: 'OpenClaw Gateway' },
      supabase:  { logo: 'https://cdn.simpleicons.org/supabase/3ecf8e', setupUrl: 'https://supabase.com/dashboard/project/_/settings/api', title: 'Supabase' },
      resend:    { logo: 'https://cdn.simpleicons.org/resend/000000', setupUrl: 'https://resend.com/api-keys', title: 'Resend' },
      x:         { logo: 'https://cdn.simpleicons.org/x/000000', setupUrl: 'https://developer.x.com/en/portal/projects-and-apps', title: 'X' },
      meta:      { logo: 'https://cdn.simpleicons.org/meta/0866ff', setupUrl: 'https://developers.facebook.com/apps/', title: 'Meta' },
      instagram: { logo: 'https://cdn.simpleicons.org/instagram/e4405f', setupUrl: 'https://developers.facebook.com/docs/instagram-platform/get-started', title: 'Instagram' },
      threads:   { logo: 'https://cdn.simpleicons.org/threads/000000', setupUrl: 'https://developers.facebook.com/docs/threads', title: 'Threads' },
      linkedin:  { logo: 'https://cdn.simpleicons.org/linkedin/0a66c2', setupUrl: 'https://www.linkedin.com/developers/apps', title: 'LinkedIn' },
      reddit:    { logo: 'https://cdn.simpleicons.org/reddit/ff4500', setupUrl: 'https://www.reddit.com/prefs/apps', title: 'Reddit' },
      pinterest: { logo: 'https://cdn.simpleicons.org/pinterest/bd081c', setupUrl: 'https://developers.pinterest.com/apps/', title: 'Pinterest' },
      telegram:  { logo: 'https://cdn.simpleicons.org/telegram/26a5e4', setupUrl: 'https://core.telegram.org/bots', title: 'Telegram' },
      youtube:   { logo: 'https://cdn.simpleicons.org/youtube/ff0000', setupUrl: 'https://console.cloud.google.com/apis/credentials', title: 'YouTube' },
      bluesky:   { logo: 'https://cdn.simpleicons.org/bluesky/0285ff', setupUrl: 'https://bsky.app/settings/app-passwords', title: 'Bluesky' },
      medium:    { logo: 'https://cdn.simpleicons.org/medium/000000', setupUrl: 'https://help.medium.com/hc/en-us/articles/213480228-API-Importing', title: 'Medium' },
      substack:  { logo: 'https://cdn.simpleicons.org/substack/ff6719', setupUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSe71I98Od4wyv23cHozydPxsT4x7AxfrXR1w2ZIpUiAHJK2VQ/viewform', title: 'Substack' },
      quora:     { logo: 'https://cdn.simpleicons.org/quora/b92b27', setupUrl: 'https://www.quora.com/business', title: 'Quora' },
      patreon:   { logo: 'https://cdn.simpleicons.org/patreon/ff424d', setupUrl: 'https://www.patreon.com/portal/registration/register-clients', title: 'Patreon' },
      discord:   { logo: 'https://cdn.simpleicons.org/discord/5865f2', setupUrl: 'https://discord.com/developers/applications', title: 'Discord' },
      exa:       { logo: 'https://cdn.simpleicons.org/exa/0b82d4', setupUrl: 'https://dashboard.exa.ai/', title: 'Exa' },
      openai:    { logo: 'https://cdn.simpleicons.org/openai/000000', setupUrl: 'https://platform.openai.com/api-keys', title: 'OpenAI' },
      anthropic: { logo: 'https://cdn.simpleicons.org/anthropic/191919', setupUrl: 'https://console.anthropic.com/settings/keys', title: 'Anthropic' },
      brave:     { logo: 'https://cdn.simpleicons.org/brave/fb542b', setupUrl: 'https://api.search.brave.com/app/keys', title: 'Brave Search' },
      transcriptapi: { logo: 'https://cdn.simpleicons.org/json/0b82d4', setupUrl: 'https://transcriptapi.com', title: 'TranscriptAPI' },
      google_drive: { logo: 'https://cdn.simpleicons.org/googledrive/4285f4', setupUrl: 'https://console.cloud.google.com/apis/credentials', title: 'Google Drive' },
      google_business_profile: { logo: 'https://cdn.simpleicons.org/google/4285f4', setupUrl: 'https://console.cloud.google.com/apis/credentials', title: 'Google Business Profile' },
      whatsapp_business: { logo: 'https://cdn.simpleicons.org/whatsapp/25d366', setupUrl: 'https://developers.facebook.com/apps/', title: 'WhatsApp Business' },
      mastodon:  { logo: 'https://cdn.simpleicons.org/mastodon/6364ff', setupUrl: 'https://docs.joinmastodon.org/api/', title: 'Mastodon' },
    };

    const info = PROVIDER_HELP[provider] || {
      logo: 'https://cdn.simpleicons.org/internetarchive/0b82d4',
      setupUrl: '',
      title: provider || 'Provider',
    };
    const label = String(
      state.apiSchemas.find((s) => s.provider === provider)?.label
      || info.title
      || provider
      || 'Provider'
    );
    const guideHtml = getProviderGuideHtml(provider);

    helpEl.innerHTML = `
      <h4>${label} Setup</h4>
      <a class="api-provider-logo-link ${info.setupUrl ? '' : 'is-disabled'}" href="${info.setupUrl || '#'}" target="${info.setupUrl ? '_blank' : ''}" rel="${info.setupUrl ? 'noopener' : ''}">
        <img class="api-provider-logo" src="${info.logo}" alt="${label} logo" />
      </a>
      <p>Open the provider portal to obtain credentials for this form.</p>
      <ul>
        <li><a class="${info.setupUrl ? '' : 'is-disabled'}" href="${info.setupUrl || '#'}" target="${info.setupUrl ? '_blank' : ''}" rel="${info.setupUrl ? 'noopener' : ''}">Open ${label} Setup Portal</a></li>
      </ul>
      ${guideHtml}
      ${provider === 'openclaw' ? '<p class="api-help-note">If you only have a <code>.pem</code> file, that is server access only. You still need the running gateway URL and optional API key from that server config.</p>' : ''}
    `;
    helpEl.classList.remove('hidden');
  }

  function getProviderGuideHtml(provider) {
    const p = String(provider || '').trim().toLowerCase();
    if (p === 'meta') {
      return `
        <div class="api-help-note">
          <strong>Exact Field Mapping (Facebook):</strong>
          <ol>
            <li>In Graph API Explorer run <code>GET /me/accounts</code>.</li>
            <li>Find the object where <code>name</code> equals your target page name.</li>
            <li><code>Page ID</code> in APP = that object's <code>id</code> value.</li>
            <li><code>Access Token</code> in APP = that object's <code>access_token</code> value.</li>
            <li><code>App ID</code> in APP = numeric App ID from Meta App Settings (not app name).</li>
          </ol>
          <p>Note: <code>paging</code> in the API response is cursor metadata, not Page ID.</p>
          <p>In-app reference: see <strong>Docs &gt; Settings &gt; Meta Quickstart (No Guessing)</strong>.</p>
        </div>
      `;
    }
    if (p === 'instagram') {
      return `
        <div class="api-help-note">
          <strong>Exact Field Mapping (Instagram):</strong>
          <ol>
            <li><code>Business Account ID</code> is the Instagram Graph user id (numeric/string id), not your @handle.</li>
            <li><code>Access Token</code> is the token granted for Instagram Graph publish scopes.</li>
            <li>Instagram posting in APP requires a campaign primary image.</li>
          </ol>
          <p>In-app reference: see <strong>Docs &gt; Settings &gt; Instagram Account ID Mapping</strong>.</p>
        </div>
      `;
    }
    if (p === 'threads') {
      return `
        <div class="api-help-note">
          <strong>Exact Field Mapping (Threads):</strong>
          <ol>
            <li><code>User ID</code> is the Threads API user id, not your @username.</li>
            <li><code>Access Token</code> is the Threads token with publish scope.</li>
          </ol>
          <p>In-app reference: see <strong>Docs &gt; Settings &gt; Meta Family (Facebook, Instagram, Threads)</strong>.</p>
        </div>
      `;
    }
    return '';
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
    const body = document.getElementById('apiChannelsTableBody');
    if (!body) return;
    body.innerHTML = '';
    const byProvider = new Map((state.apiConfigs || []).map((cfg) => [String(cfg.provider || ''), cfg]));
    const currentPlatform = String(connectionOpsState.platform || '').trim().toLowerCase();
    const gateSource = connectionOpsState.byPlatform[currentPlatform] || connectionOpsState.data || null;
    const gateList = Array.isArray(gateSource?.gates) ? gateSource.gates : [];

    for (let i = 0; i < 5; i += 1) {
      const head = document.getElementById(`channelGateHeader${i}`);
      if (!head) continue;
      const gate = gateList[i] || null;
      head.textContent = `Gate ${i + 1}`;
      head.title = gate?.label ? String(gate.label) : '';
    }

    CHANNEL_CONNECTION_ROWS.forEach((row) => {
      const cfg = byProvider.get(row.provider) || null;
      const tr = document.createElement('tr');
      tr.className = cfg?.configured ? 'api-config-row-complete' : 'api-config-row-incomplete';

      const channelTd = document.createElement('td');
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = row.label;
      link.addEventListener('click', async (event) => {
        event.preventDefault();
        await openChannelConnection(row.key);
      });
      channelTd.appendChild(link);
      tr.appendChild(channelTd);

      const coreTd = document.createElement('td');
      const savedKeys = cfg && cfg.values
        ? Object.entries(cfg.values).filter(([_, value]) => String(value || '').trim().length > 0).map(([key]) => key)
        : [];
      const staleFlags = Array.isArray(cfg?.staleCheck?.flags) ? cfg.staleCheck.flags : [];
      const topFlag = staleFlags[0] ? String(staleFlags[0].message || '').trim() : '';
      coreTd.innerHTML = `<div>${row.coreFields}</div><div class="meta">${savedKeys.length ? `Saved: ${savedKeys.join(', ')}` : 'Saved: -'}</div>${topFlag ? `<div class="meta" style="color:#8a1d2b;">Warning: ${topFlag}</div>` : ''}`;
      tr.appendChild(coreTd);

      const opsData = connectionOpsState.byPlatform[row.key] || null;
      const opsGates = Array.isArray(opsData?.gates) ? opsData.gates : [];
      for (let i = 0; i < 5; i += 1) {
        const td = document.createElement('td');
        td.className = 'channel-gate-cell';
        const gate = opsGates[i] || null;
        if (!gate) {
          td.textContent = '-';
        } else {
          const icon = document.createElement('span');
          icon.className = gate.done ? 'channel-gate-icon channel-gate-icon-done' : 'channel-gate-icon channel-gate-icon-todo';
          icon.textContent = gate.done ? '✓' : '○';
          icon.title = String(gate.label || '');
          td.appendChild(icon);
        }
        tr.appendChild(td);
      }

      const actionsTd = document.createElement('td');
      actionsTd.className = 'api-actions-cell';
      const editBtn = App.makeIconButton('edit', 'Open Channel Form', async () => {
        await openChannelConnection(row.key);
      });
      actionsTd.appendChild(editBtn);
      if (cfg) {
        const deleteBtn = App.makeIconButton('delete', `Delete ${row.label} API`, async () => {
          if (!confirm(`Delete API credentials for ${row.label}?`)) return;
          try {
            await deleteApiConfig(row.provider);
            clearApiSettingsForm();
            await refreshApiSettings();
            notify(`Deleted ${row.label} API credentials`);
          } catch (err) {
            notify(err.message || 'Could not delete API credentials', true);
          }
        }, { danger: true, marginLeft: '8px' });
        actionsTd.appendChild(deleteBtn);
      }
      tr.appendChild(actionsTd);
      body.appendChild(tr);
    });
  }

  function setConnectionOpsStatus(message, isError = false) {
    const el = document.getElementById('connectionOpsStatus');
    if (!el) return;
    el.textContent = String(message || '').trim();
    el.style.color = isError ? '#b00020' : '';
  }

  function initConnectionOpsSectionToggles() {
    const toggles = Array.from(document.querySelectorAll('.accordion-header[data-ops-target]'));
    toggles.forEach((toggle) => {
      if (toggle.dataset.bound === '1') return;
      toggle.dataset.bound = '1';
      toggle.addEventListener('click', () => {
        const targetId = String(toggle.dataset.opsTarget || '').trim();
        if (!targetId) return;
        const body = document.getElementById(targetId);
        if (!body) return;
        const expanded = toggle.getAttribute('aria-expanded') !== 'false';
        const nextExpanded = !expanded;
        toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        body.classList.toggle('hidden', !nextExpanded);
      });
    });
  }

  function setConnectionOpsPanelVisible(visible) {
    const panel = document.getElementById('connectionOpsPanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
  }

  function isConnectionOpsSupported(channelKey) {
    const key = String(channelKey || '').trim().toLowerCase();
    return Array.isArray(connectionOpsState.supported) && connectionOpsState.supported.includes(key);
  }

  function formatDateTime(value) {
    const text = String(value || '').trim();
    if (!text) return '-';
    const ts = Date.parse(text);
    if (!Number.isFinite(ts)) return text;
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return text;
    }
  }

  function formatStatus(value) {
    const text = String(value || '').replace(/_/g, ' ').trim();
    if (!text) return '-';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function renderConnectionOpsSummary(data) {
    const wrap = document.getElementById('connectionOpsSummary');
    if (!wrap) return;
    if (!data) {
      wrap.innerHTML = '';
      return;
    }
    const readiness = data.readiness || {};
    const level = String(readiness.level || 'red');
    const badgeClass = `connection-ops-level connection-ops-level-${level}`;
    const score = Number(readiness.score || 0);
    const latestAttempt = data.latestAttempt || null;
    const platform = String(data?.platform || connectionOpsState.platform || '').trim().toLowerCase();
    const supportsTest = platform === 'bluesky'
      || platform === 'telegram'
      || platform === 'reddit'
      || platform === 'x'
      || platform === 'facebook'
      || platform === 'instagram'
      || platform === 'threads';
    const testLabel = platform === 'bluesky'
      ? 'Run Bluesky Auth Test'
      : (platform === 'reddit'
        ? 'Run Reddit Auth Test'
        : (platform === 'x'
          ? 'Run X Auth Test'
          : (platform === 'facebook'
            ? 'Run Facebook Auth Test'
            : (platform === 'instagram'
              ? 'Run Instagram Auth Test'
              : (platform === 'threads' ? 'Run Threads Auth Test' : 'Run Channel Test')))));
    wrap.innerHTML = `
      <div><strong>Readiness</strong><br><span class="${badgeClass}">${String(level).toUpperCase()} (${score})</span></div>
      <div><strong>Required Fields</strong><br>${readiness.reqPct || 0}%</div>
      <div><strong>Human Gates</strong><br>${readiness.completedGates || 0}/${readiness.totalGates || 0}</div>
      <div><strong>Next Action</strong><br>${String(data.nextAction || '-')}</div>
      <div><strong>Latest Attempt</strong><br>${latestAttempt ? `${formatStatus(latestAttempt.status)} · ${formatDateTime(latestAttempt.createdAt)}` : 'No attempts logged'}</div>
      <div><strong>Quick Test</strong><br>${supportsTest ? '<button id="connectionOpsRunTestBtn" type="button" class="btn btn-connection-ops-quick-test">Run Test</button>' : '-'}</div>
    `;
    const testBtn = document.getElementById('connectionOpsRunTestBtn');
    if (supportsTest && testBtn) {
      testBtn.textContent = testLabel;
      testBtn.addEventListener('click', async () => {
        try {
          await runConnectionOpsTest();
        } catch (err) {
          notify(err.message || 'Connection test failed', true);
        }
      });
    }
  }

  function parseSocialAuthTestResponse(res) {
    const payload = (res && typeof res.data === 'object' && res.data !== null) ? res.data : (res || {});
    const authOk = payload.authOk === true || res?.authOk === true;
    const errText = String(
      payload.error
      || res?.error
      || payload.auth?.error
      || ''
    ).trim();
    return { authOk, error: errText, payload, raw: res };
  }

  async function runConnectionOpsTest() {
    const platform = String(connectionOpsState.platform || '').trim().toLowerCase();
    if (!platform) return;
    setConnectionOpsStatus(`Running ${platform} test...`);

    let testOk = false;
    let summary = '';
    let details = '';
    let blockerCode = '';

    if (platform === 'bluesky') {
      const parsed = parseSocialAuthTestResponse(await api('/api/engage/social/bluesky/auth-test'));
      testOk = parsed.authOk;
      summary = testOk ? 'Bluesky auth test passed' : `Bluesky auth test failed: ${parsed.error || 'unknown error'}`;
      details = JSON.stringify(parsed.raw || {}, null, 2);
      blockerCode = testOk ? '' : 'BLUESKY_401';
    } else if (platform === 'x') {
      const parsed = parseSocialAuthTestResponse(await api('/api/engage/social/x/auth-test'));
      testOk = parsed.authOk;
      summary = testOk ? 'X auth test passed' : `X auth test failed: ${parsed.error || 'unknown error'}`;
      details = JSON.stringify(parsed.raw || {}, null, 2);
      blockerCode = testOk ? '' : 'X_AUTH_FAILED';
    } else if (platform === 'facebook') {
      const parsed = parseSocialAuthTestResponse(await api('/api/engage/social/facebook/auth-test'));
      testOk = parsed.authOk;
      summary = testOk ? 'Facebook auth test passed' : `Facebook auth test failed: ${parsed.error || 'unknown error'}`;
      details = JSON.stringify(parsed.raw || {}, null, 2);
      blockerCode = testOk ? '' : 'FACEBOOK_401';
    } else if (platform === 'instagram') {
      const parsed = parseSocialAuthTestResponse(await api('/api/engage/social/instagram/auth-test'));
      testOk = parsed.authOk;
      summary = testOk ? 'Instagram auth test passed' : `Instagram auth test failed: ${parsed.error || 'unknown error'}`;
      details = JSON.stringify(parsed.raw || {}, null, 2);
      blockerCode = testOk ? '' : 'INSTAGRAM_401';
    } else if (platform === 'threads') {
      const parsed = parseSocialAuthTestResponse(await api('/api/engage/social/threads/auth-test'));
      testOk = parsed.authOk;
      summary = testOk ? 'Threads auth test passed' : `Threads auth test failed: ${parsed.error || 'unknown error'}`;
      details = JSON.stringify(parsed.raw || {}, null, 2);
      blockerCode = testOk ? '' : 'THREADS_401';
    } else if (platform === 'telegram') {
      const res = await api('/api/engage/social/telegram/status');
      testOk = res?.configured === true;
      summary = testOk ? 'Telegram config test passed' : 'Telegram config test failed (missing bot token/chat id)';
      details = JSON.stringify(res || {}, null, 2);
      blockerCode = testOk ? '' : 'CHAT_ID_NOT_FOUND';
    } else if (platform === 'reddit') {
      const res = await api('/api/engage/reddit/status');
      testOk = res?.authOk === true;
      summary = testOk ? 'Reddit auth test passed' : `Reddit auth test failed: ${String(res?.auth?.error || 'unknown error')}`;
      details = JSON.stringify(res || {}, null, 2);
      blockerCode = testOk ? '' : 'REDDIT_401';
    } else {
      throw new Error('No test handler for this platform yet');
    }

    await api(`/api/settings/connection-ops/${encodeURIComponent(platform)}/attempts`, {
      method: 'POST',
      body: JSON.stringify({
        status: testOk ? 'success' : 'blocked',
        blocker_code: blockerCode,
        summary,
        details,
      }),
    });
    await refreshConnectionOps(platform);
    setConnectionOpsStatus(testOk ? `${platform} test passed.` : `${platform} test failed. Check latest attempt.`);
    notify(testOk ? 'Connection test passed' : summary || 'Connection test failed', !testOk);
  }

  function renderConnectionOpsSetupLinks(data) {
    const host = document.getElementById('connectionOpsSetupLinks');
    if (!host) return;
    const platform = String(data?.platform || connectionOpsState.platform || '').trim().toLowerCase();
    const links = [];
    if (platform === 'telegram') {
      links.push({ label: 'Create/Register Bot', url: 'https://t.me/BotFather' });
      links.push({ label: 'Telegram Bot API Docs', url: 'https://core.telegram.org/bots/api' });
      links.push({ label: 'Get Updates Pattern', url: 'https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates' });
    } else if (platform === 'x') {
      links.push({ label: 'X Developer Portal', url: 'https://developer.x.com/en/portal/dashboard' });
      links.push({ label: 'X Product Access', url: 'https://developer.x.com/en/portal/product' });
      links.push({ label: 'X API Docs', url: 'https://developer.x.com/en/docs/x-api' });
    } else if (platform === 'facebook') {
      links.push({ label: 'Meta App Dashboard', url: 'https://developers.facebook.com/apps/' });
      links.push({ label: 'Graph API Explorer', url: 'https://developers.facebook.com/tools/explorer/' });
      links.push({ label: 'Facebook Pages API Docs', url: 'https://developers.facebook.com/docs/pages-api/' });
    } else if (platform === 'instagram') {
      links.push({ label: 'Meta App Dashboard', url: 'https://developers.facebook.com/apps/' });
      links.push({ label: 'Instagram Content Publishing Docs', url: 'https://developers.facebook.com/docs/instagram-platform/content-publishing' });
      links.push({ label: 'Graph API Explorer', url: 'https://developers.facebook.com/tools/explorer/' });
    } else if (platform === 'threads') {
      links.push({ label: 'Meta App Dashboard', url: 'https://developers.facebook.com/apps/' });
      links.push({ label: 'Threads API Docs', url: 'https://developers.facebook.com/docs/threads' });
      links.push({ label: 'Graph API Explorer', url: 'https://developers.facebook.com/tools/explorer/' });
    } else if (platform === 'reddit') {
      links.push({ label: 'Create/Register App', url: 'https://www.reddit.com/prefs/apps' });
      links.push({ label: 'Reddit API Docs', url: 'https://www.reddit.com/dev/api/' });
      links.push({ label: 'OAuth Refresh Token Guide', url: 'https://github.com/reddit-archive/reddit/wiki/OAuth2' });
    } else if (platform === 'bluesky') {
      links.push({ label: 'Create App Password', url: 'https://bsky.app/settings/app-passwords' });
      links.push({ label: 'Account Settings', url: 'https://bsky.app/settings' });
      links.push({ label: 'AT Protocol Docs', url: 'https://docs.bsky.app/' });
    }
    const playbook = Array.isArray(data?.playbook) ? data.playbook : [];
    playbook.forEach((item) => {
      const url = String(item?.portalUrl || '').trim();
      if (!url) return;
      const label = String(item?.title || item?.code || 'Portal').trim();
      links.push({ label, url });
    });
    const dedup = [];
    const seen = new Set();
    links.forEach((item) => {
      const key = `${item.label}|${item.url}`;
      if (seen.has(key)) return;
      seen.add(key);
      dedup.push(item);
    });
    if (!dedup.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = `<strong>Setup Links:</strong> ${dedup.map((item) => `<a href="${item.url}" target="_blank" rel="noopener">${item.label}</a>`).join(' | ')}`;
  }

  function renderConnectionOpsGates(data) {
    const host = document.getElementById('connectionOpsGates');
    if (!host) return;
    host.innerHTML = '';
    const gates = Array.isArray(data?.gates) ? data.gates : [];
    if (!gates.length) {
      host.textContent = 'No gates configured.';
      return;
    }
    gates.forEach((gate) => {
      const row = document.createElement('label');
      row.className = 'checkbox-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = gate.done === true;
      input.addEventListener('change', async () => {
        try {
          await api(`/api/settings/connection-ops/${encodeURIComponent(connectionOpsState.platform)}/gates/${encodeURIComponent(gate.key)}`, {
            method: 'PATCH',
            body: JSON.stringify({ done: input.checked === true }),
          });
          await refreshConnectionOps();
        } catch (err) {
          notify(err.message || 'Could not update gate', true);
          input.checked = !input.checked;
        }
      });
      row.appendChild(input);
      row.appendChild(document.createTextNode(` ${String(gate.label || gate.key)}`));
      host.appendChild(row);
    });
  }

  function renderConnectionOpsPlaybook(data) {
    const body = document.getElementById('connectionOpsPlaybookBody');
    if (!body) return;
    body.innerHTML = '';
    const items = Array.isArray(data?.playbook) ? data.playbook : [];
    if (!items.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4">No playbook entries.</td>';
      body.appendChild(tr);
      return;
    }
    items.forEach((item) => {
      const tr = document.createElement('tr');
      const fixes = Array.isArray(item.fixSteps) ? item.fixSteps.map((step) => `<div>${step}</div>`).join('') : '-';
      const portal = String(item.portalUrl || '').trim()
        ? `<a href="${item.portalUrl}" target="_blank" rel="noopener">Open</a>`
        : '-';
      tr.innerHTML = `
        <td><code>${String(item.code || '-')}</code></td>
        <td>${String(item.likelyCause || '-')}</td>
        <td>${fixes}</td>
        <td>${portal}</td>
      `;
      body.appendChild(tr);
    });
  }

  function renderConnectionOpsAttempts(data) {
    const body = document.getElementById('connectionOpsAttemptsBody');
    if (!body) return;
    body.innerHTML = '';
    const attempts = Array.isArray(data?.attempts) ? data.attempts : [];
    if (!attempts.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4">No attempts logged.</td>';
      body.appendChild(tr);
      return;
    }
    attempts.slice(0, 30).forEach((attempt) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDateTime(attempt.createdAt)}</td>
        <td>${formatStatus(attempt.status)}</td>
        <td>${String(attempt.blockerCode || '-')}</td>
        <td title="${String(attempt.details || '').replace(/"/g, '&quot;')}">${String(attempt.summary || '-')}</td>
      `;
      body.appendChild(tr);
    });
  }

  async function refreshConnectionOps(platformInput) {
    const platform = String(platformInput || connectionOpsState.platform || '').trim().toLowerCase();
    if (!platform) return;
    connectionOpsState.platform = platform;
    try {
      setConnectionOpsStatus(`Loading ${platform} readiness...`);
      const res = await api(`/api/settings/connection-ops/${encodeURIComponent(platform)}`);
      const data = res.connectionOps || res.data || res || null;
      connectionOpsState.data = data;
      connectionOpsState.byPlatform[platform] = data;
      renderConnectionOpsSetupLinks(data);
      renderConnectionOpsSummary(data);
      renderConnectionOpsGates(data);
      renderConnectionOpsPlaybook(data);
      renderConnectionOpsAttempts(data);
      setConnectionOpsStatus(`Loaded ${String(data?.label || platform)} connection ops.`);
      renderApiConfigsTable();
    } catch (err) {
      setConnectionOpsStatus(err.message || 'Could not load Connection Ops', true);
      renderConnectionOpsSetupLinks(null);
    }
  }

  async function refreshConnectionOpsPlatforms() {
    try {
      const res = await api('/api/settings/connection-ops/platforms');
      const items = Array.isArray(res?.platforms) ? res.platforms : [];
      connectionOpsState.supported = items.map((item) => String(item?.key || '').trim().toLowerCase()).filter(Boolean);
      if (!items.length) connectionOpsState.supported = ['telegram'];
    } catch {
      connectionOpsState.supported = ['telegram'];
    }
  }

  async function preloadConnectionOpsSnapshots() {
    const keys = Array.isArray(connectionOpsState.supported) ? connectionOpsState.supported.slice() : [];
    if (!keys.length) return;
    await Promise.all(keys.map(async (platform) => {
      try {
        const res = await api(`/api/settings/connection-ops/${encodeURIComponent(platform)}`);
        const data = res.connectionOps || res.data || res || null;
        if (data) connectionOpsState.byPlatform[platform] = data;
      } catch {
        // ignore per-platform preload failures
      }
    }));
    renderApiConfigsTable();
  }

  async function openChannelConnection(channelKey) {
    const row = CHANNEL_CONNECTION_ROWS.find((item) => item.key === String(channelKey || '').trim().toLowerCase());
    if (!row) return;
    try {
      await editApiConfig(row.provider);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      notify(err.message || 'Could not open channel form', true);
      return;
    }

    setConnectionOpsPanelVisible(true);
    activeChannelLabel = row.label;
    const channelLabel = document.getElementById('connectionOpsChannelLabel');
    if (channelLabel) channelLabel.textContent = `Channel: ${row.label}`;
    refreshSettingsApisHeadingFromUi();
    connectionOpsState.platform = row.key;
    renderConnectionOpsSetupLinks({ platform: row.key, playbook: [] });
    try {
      await refreshConnectionOps(row.key);
    } catch {
      setConnectionOpsStatus(`Connection Ops is not configured for ${row.label} yet.`);
      renderConnectionOpsSetupLinks(null);
      renderConnectionOpsSummary(null);
      renderConnectionOpsGates(null);
      renderConnectionOpsPlaybook(null);
      renderConnectionOpsAttempts(null);
    }
  }

  async function refreshApiSettings() {
    if (!els.apiProviderSelect) return;
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
      if (els.dbAcquireYoutubeDetailsTable)  els.dbAcquireYoutubeDetailsTable.value  = values.acquire_youtube_details_table || '';
      if (els.dbAcquireYoutubeCommentsTable) els.dbAcquireYoutubeCommentsTable.value = values.acquire_youtube_comments_table || '';
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
    initConnectionOpsSectionToggles();

    if (els.brandProfileButton) {
      els.brandProfileButton.addEventListener('click', () => {
        openProjectsPage();
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
        const account = getAccountIdentity(state.profile);
        const contactNameInput = String(formData.get('contact_name') || '').trim();
        const emailInput = String(formData.get('email') || '').trim();
        const payload = {
          contact_name: contactNameInput || account.name,
          email: emailInput || account.email,
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

    if (els.settingsProjectSelector) {
      els.settingsProjectSelector.addEventListener('change', async () => {
        const projectId = String(els.settingsProjectSelector.value || '').trim();
        if (!projectId) {
          state.currentProjectId = '';
          window.localStorage.removeItem(App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId');
          applyProjectToHeader();
          notify('Project context cleared');
          return;
        }
        state.currentProjectId = projectId;
        window.localStorage.setItem(App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId', projectId);
        renderProjectLists();
        renderProjectDetails();
        applyProjectToHeader();
        notify('Active project updated');
      });
      refreshProjectContext();
    }

    if (els.settingsCreateProjectBtn) {
      els.settingsCreateProjectBtn.addEventListener('click', async () => {
        const name = String(els.settingsNewProjectName?.value || '').trim();
        const description = String(els.settingsNewProjectDescription?.value || '').trim();
        if (!name) return notify('Project name is required', true);
        try {
          const res = await api('/api/projects', {
            method: 'POST',
            body: JSON.stringify({ name, description }),
          });
          const projectId = String(res.project?.id || res.id || '').trim();
          if (projectId) {
            state.currentProjectId = projectId;
            window.localStorage.setItem(App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId', projectId);
          }
          if (els.settingsNewProjectName) els.settingsNewProjectName.value = '';
          if (els.settingsNewProjectDescription) els.settingsNewProjectDescription.value = '';
          await refreshProjectContext();
          setProjectsCreateVisible(false);
          notify('Project created');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (els.settingsProjectLogoFile) {
      els.settingsProjectLogoFile.addEventListener('change', async () => {
        const file = els.settingsProjectLogoFile.files?.[0];
        if (!file) return;
        const activeId = String(state.currentProjectId || '').trim();
        if (!activeId) return notify('Select a project first', true);
        try {
          const dataUrl = await readFileAsDataUrl(file);
          setProjectLogoDataUrl(activeId, dataUrl);
          renderProjectDetails();
          applyProjectToHeader();
          notify('Project logo updated');
        } catch (err) {
          notify(err.message, true);
        } finally {
          els.settingsProjectLogoFile.value = '';
        }
      });
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
          acquire_youtube_details_table: String(formData.get('acquire_youtube_details_table') || '').trim(),
          acquire_youtube_comments_table: String(formData.get('acquire_youtube_comments_table') || '').trim(),
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
          await refreshPromoLeadsIfAvailable();
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
          await refreshPromoLeadsIfAvailable();
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
        activeChannelLabel = '';
        openApiSettingsForm(state.apiSchemas[0]?.provider || '', {}, 'Add API');
      });
    }

    const apiAllBtn = getApiAllBtn();
    if (apiAllBtn) {
      apiAllBtn.addEventListener('click', () => {
        closeApiSettingsForm();
        setConnectionOpsPanelVisible(false);
        activeChannelLabel = '';
        const channelLabel = document.getElementById('connectionOpsChannelLabel');
        if (channelLabel) channelLabel.textContent = '';
        refreshSettingsApisHeadingFromUi();
        const table = document.getElementById('apiChannelsTableBody');
        if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (els.apiSettingsForm) {
      els.apiSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const provider = els.apiProviderSelect?.value;
        const values   = {};
        els.apiFieldsContainer?.querySelectorAll('input[name], textarea[name]').forEach((input) => {
          values[input.name] = String(input.value || '').trim();
        });
        try {
          await api('/api/settings/apis', { method: 'POST', body: JSON.stringify({ provider, values }) });
          notify('API credentials saved');
          const channelMode = Boolean(activeChannelLabel);
          await refreshApiSettings();
          if (!channelMode) closeApiSettingsForm();
          try {
            await refreshConnectionOps(provider);
            setConnectionOpsStatus('Credentials saved. Continue with Human Gates and run a smoke test.');
          } catch {
            // Ignore connection ops refresh failures after successful credential save.
          }
          await refreshPromoLeadsIfAvailable();
        } catch (err) { notify(err.message, true); }
      });
    }

    const connectionOpsAttemptForm = document.getElementById('connectionOpsAttemptForm');
    if (connectionOpsAttemptForm) {
      connectionOpsAttemptForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fd = new FormData(connectionOpsAttemptForm);
        const payload = {
          status: String(fd.get('status') || '').trim(),
          blocker_code: String(fd.get('blocker_code') || '').trim(),
          summary: String(fd.get('summary') || '').trim(),
          details: String(fd.get('details') || '').trim(),
        };
        if (!payload.summary) {
          notify('Attempt summary is required', true);
          return;
        }
        try {
          await api(`/api/settings/connection-ops/${encodeURIComponent(connectionOpsState.platform)}/attempts`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          connectionOpsAttemptForm.reset();
          await refreshConnectionOps();
          notify('Connection attempt logged.');
        } catch (err) {
          notify(err.message || 'Could not log attempt', true);
        }
      });
    }

    closeApiSettingsForm();
    setConnectionOpsPanelVisible(false);
    refreshConnectionOpsPlatforms()
      .then(async () => {
        await preloadConnectionOpsSnapshots();
        if (!connectionOpsState.platform && connectionOpsState.supported.length) {
          connectionOpsState.platform = connectionOpsState.supported[0];
        }
        await refreshConnectionOps();
      });
  }

  return {
    init,
    manifest: { id: 'settings', label: 'Settings', pageId: 'settingsPage', pagePrefixes: ['settings'] },
    onPageActivated: async function () {
      await refreshProfile();
      await refreshApiSettings();
      await refreshConnectionOpsPlatforms();
      await preloadConnectionOpsSnapshots();
      if (!connectionOpsState.platform && connectionOpsState.supported.length) {
        connectionOpsState.platform = connectionOpsState.supported[0];
      }
      await refreshConnectionOps();
      activeChannelLabel = '';
      closeApiSettingsForm();
      setConnectionOpsPanelVisible(false);
      const channelLabel = document.getElementById('connectionOpsChannelLabel');
      if (channelLabel) channelLabel.textContent = '';
      refreshSettingsApisHeadingFromUi();
    },
    openProjectsPage,
    openProjectsCreate,
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
