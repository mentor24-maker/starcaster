/**
 * public/js/develop.js
 * Develop menu: Agents, Templates, and Extensions forms for OpenClaw job control.
 */

window.App = window.App || {};
App.develop = (function () {
  const { state, els, api, notify, parseJsonInput, setPreview } = App;
  const LANDING_TEMPLATES = [
    {
      id: 'standard-right-form',
      name: 'Standard Right-Form',
      summary: 'Classic conversion layout with message left, form right, and a clean supporting body section.',
      eyebrow: 'Standard Page Template',
      headline: 'Build a clean, conversion-focused offer page with a form on the right.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
      primaryCta: 'Primary CTA',
      secondaryCta: 'Secondary CTA',
      featureOneTitle: 'Feature One',
      featureOneCopy: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.',
      featureTwoTitle: 'Feature Two',
      featureTwoCopy: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi.',
      formTitle: 'Request More Information',
      formCopy: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      bodyTitle: 'Lorem Ipsum Content Block',
    },
    {
      id: 'founder-story',
      name: 'Founder Story',
      summary: 'A warm narrative-first template that leads with origin story and trust-building copy.',
      eyebrow: 'Founder-Led Story',
      headline: 'Lead with the founder story, then convert with a focused inquiry form.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
      primaryCta: 'Work With Us',
      secondaryCta: 'Read The Story',
      featureOneTitle: 'Origin Story',
      featureOneCopy: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.',
      featureTwoTitle: 'Credibility Layer',
      featureTwoCopy: 'Totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto.',
      formTitle: 'Start The Conversation',
      formCopy: 'Tell us what you are building and what support you need.',
      bodyTitle: 'Founder-Led Narrative',
    },
    {
      id: 'lead-magnet-download',
      name: 'PDF Download',
      summary: 'Optimized for giving away a guide, checklist, or PDF in exchange for lead capture.',
      eyebrow: 'PDF Focus',
      headline: 'Offer a downloadable resource and keep the call-to-action simple.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Excepteur sint occaecat cupidatat non proident.',
      primaryCta: 'Download Now',
      secondaryCta: 'See What’s Inside',
      featureOneTitle: 'Quick Value',
      featureOneCopy: 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
      featureTwoTitle: 'Fast Conversion',
      featureTwoCopy: 'Sunt in culpa qui officia deserunt mollit anim id est laborum.',
      formTitle: 'Get The PDF',
      formCopy: 'Enter your details and we will send the resource instantly.',
      bodyTitle: 'Resource Overview',
    },
    {
      id: 'webinar-registration',
      name: 'Webinar Registration',
      summary: 'Event-driven template that highlights urgency, speaker value, and a registration form.',
      eyebrow: 'Event Registration',
      headline: 'Promote a webinar, training, or live session with urgency and clarity.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.',
      primaryCta: 'Reserve My Spot',
      secondaryCta: 'View Agenda',
      featureOneTitle: 'What You’ll Learn',
      featureOneCopy: 'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur.',
      featureTwoTitle: 'Why Attend Live',
      featureTwoCopy: 'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae.',
      formTitle: 'Register For The Session',
      formCopy: 'Save your seat and we will send event details to your inbox.',
      bodyTitle: 'Session Details',
    },
    {
      id: 'case-study-showcase',
      name: 'Case Study Showcase',
      summary: 'A proof-oriented template built around outcomes, transformation, and inquiry.',
      eyebrow: 'Results-Driven',
      headline: 'Use a case-study-style page to prove the offer before asking for the lead.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam.',
      primaryCta: 'See The Results',
      secondaryCta: 'Request A Strategy Call',
      featureOneTitle: 'Before / After',
      featureOneCopy: 'Eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.',
      featureTwoTitle: 'Measured Outcome',
      featureTwoCopy: 'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur.',
      formTitle: 'Ask About Your Project',
      formCopy: 'Share a few details and we will outline what this could look like for you.',
      bodyTitle: 'Case Study Breakdown',
    },
    {
      id: 'newsletter-signup',
      name: 'Newsletter Signup',
      summary: 'A lighter, editorial-style layout for list building, content subscriptions, and updates.',
      eyebrow: 'Audience Building',
      headline: 'Grow a newsletter or content list with a cleaner, lower-friction signup page.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. At vero eos et accusamus et iusto odio dignissimos ducimus.',
      primaryCta: 'Join The List',
      secondaryCta: 'Read A Sample',
      featureOneTitle: 'Editorial Promise',
      featureOneCopy: 'Et harum quidem rerum facilis est et expedita distinctio nam libero tempore.',
      featureTwoTitle: 'Reader Benefit',
      featureTwoCopy: 'Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet.',
      formTitle: 'Subscribe For Updates',
      formCopy: 'Add your email to receive ongoing content, offers, and updates.',
      bodyTitle: 'What Subscribers Get',
    },
  ];
  const FORM_TEMPLATES = [
    {
      id: 'squeeze-form',
      name: 'Squeeze Form',
      defaultHeading: 'Get Instant Access',
      defaultSubmitLabel: 'Submit',
      fields: [
        { key: 'first_name', label: 'First Name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
      ],
    },
    {
      id: 'short-form',
      name: 'Short Form',
      defaultHeading: 'Tell Us About Yourself',
      defaultSubmitLabel: 'Send Request',
      fields: [
        { key: 'first_name', label: 'First Name', type: 'text', required: true },
        { key: 'last_name', label: 'Last Name', type: 'text', required: false },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone Number', type: 'tel', required: false },
      ],
    },
    {
      id: 'long-form',
      name: 'Long Form',
      defaultHeading: 'Complete The Form',
      defaultSubmitLabel: 'Submit Form',
      fields: [
        { key: 'first_name', label: 'First Name', type: 'text', required: true },
        { key: 'last_name', label: 'Last Name', type: 'text', required: false },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone Number', type: 'tel', required: false },
        { key: 'city', label: 'City', type: 'text', required: false },
        { key: 'state', label: 'State', type: 'text', required: false },
        { key: 'country', label: 'Country', type: 'text', required: false },
      ],
    },
  ];
  const CONTACT_TYPE_OPTIONS = [
    { value: 'lead', label: 'Lead' },
    { value: 'prospect', label: 'Prospect' },
    { value: 'subscriber', label: 'Subscriber' },
    { value: 'member', label: 'Member' },
    { value: 'partner', label: 'Partner' },
    { value: 'other', label: 'Other' },
  ];
  const FORM_LEAD_MAGNET_TYPES = [
    { value: 'White Paper', label: 'White Paper' },
    { value: 'Report', label: 'Report' },
    { value: 'Video', label: 'Video' },
    { value: 'Infographic', label: 'Infographic' },
  ];
  let selectedTemplateId = LANDING_TEMPLATES[0].id;
  let selectedFormTemplateId = FORM_TEMPLATES[0].id;
  let selectedEmailTemplateId = '';
  let savedThemes = [];
  let selectedThemeId = '';
  let formBuilderState = null;
  const DEFAULT_FORM_ACCENT = '#0b82d4';
  const MATCH_LANDING_GREY = '#6b7280';
  const DEFAULT_LANDING_PRIMARY = '#0b82d4';
  const DEFAULT_LANDING_BACKGROUND = '#f5fbff';
  const DEFAULT_LANDING_ACCENT = '#1a4f81';
  let landingPageColors = {
    primary: DEFAULT_LANDING_PRIMARY,
    background: DEFAULT_LANDING_BACKGROUND,
    accent: DEFAULT_LANDING_ACCENT,
  };
  let savedForms = [];
  let savedLandingPages = [];
  let savedPageTemplates = [];
  let savedExtensions = [];
  let savedEmailTemplates = [];
  let savedAgents = [];
  let emailTemplateBlocksDraft = [];
  let landingPageHeadlines = [];
  let landingPageSubheadings = [];
  let landingPagePitches = [];
  let landingPageCtas = [];
  const landingPageSelectorFilterState = {};
  let pendingLandingPageFormRecord = null;
  let selectedLandingPageIds = new Set();
  let activeLandingPagePreviewRecord = null;
  let activeLandingPagePreviewMode = 'page';
  let activeLandingPageVisualRecord = null;
  let activeLandingPageVisualMode = 'page';
  let landingPageVisualEditMode = true;
  let landingPageVisualDraft = {};
  let landingPageThankYouState = null;
  const activeLandingPageVisualEditors = new Set();
  const collapsedExtensionIds = new Set();
  const formTableState = {
    sort: {
      key: 'updatedAt',
      dir: 'desc',
    },
  };

  function getEmailTemplatesByKind(kind) {
    const normalized = safeText(kind).toLowerCase();
    return savedEmailTemplates.filter((template) => {
      const templateKind = safeText(template?.templateKind).toLowerCase() || 'text';
      return normalized ? templateKind === normalized : true;
    });
  }

  function getThemeById(themeId) {
    const id = safeText(themeId);
    return savedThemes.find((item) => String(item.id) === id) || null;
  }
  const landingPageTableState = {
    filters: {
      name: '',
      templateId: '',
    },
    sort: {
      key: 'updatedAt',
      dir: 'desc',
    },
  };
  const EXTENSION_TYPE_OPTIONS = [
    { value: 'manager', label: 'Manager' },
    { value: 'utility', label: 'Utility' },
    { value: 'generator', label: 'Generator' },
    { value: 'connector', label: 'Connector' },
    { value: 'workflow', label: 'Workflow' },
    { value: 'automation', label: 'Automation' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'catalog', label: 'Catalog' },
    { value: 'custom', label: 'Custom' },
  ];
  const extensionTableState = {
    filters: {
      name: '',
      extensionType: '',
      status: '',
      tags: '',
    },
    sort: {
      key: 'updatedAt',
      dir: 'desc',
    },
  };
  const LANDING_THANK_YOU_STATE_KEY = 'develop_landing_thank_you_state_v1';
  const SAVED_AGENTS_STORAGE_KEY = 'develop_saved_agents_v1';
  let extensionManagerConfig = {
    defaultFilters: {},
    defaultSortKey: 'updatedAt',
    defaultSortDir: 'desc',
  };

  function safeText(value) {
    return String(value || '').trim();
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setThemesBuilderVisible(visible) {
    const panel = byId('developThemesBuilderPanel');
    const toggle = byId('developThemesBuilderToggleBtn');
    if (panel) panel.classList.toggle('hidden', !visible);
    if (toggle) {
      toggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
      toggle.textContent = visible ? '▾' : '▸';
    }
  }

  function openThemesPage() {
    setThemesBuilderVisible(false);
    App.setActivePage('developThemesPage');
    refresh().catch((err) => notify(err.message || 'Unable to load themes', true));
  }

  function openThemesBuilder() {
    App.setActivePage('developThemesPage');
    setThemesBuilderVisible(true);
    const panel = byId('developThemesBuilderPanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function openAgentsPage() {
    setAgentsBuilderVisible(false);
    App.setActivePage('developAgentsPage');
    refresh().catch((err) => notify(err.message || 'Unable to load agents page', true));
  }

  function setAgentsBuilderVisible(visible) {
    const panel = byId('developAgentsBuilderPanel');
    if (panel) panel.classList.toggle('hidden', !visible);
  }

  function nextLocalId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadSavedAgents() {
    try {
      const raw = String(window.localStorage.getItem(SAVED_AGENTS_STORAGE_KEY) || '').trim();
      if (!raw) {
        savedAgents = [];
        return;
      }
      const parsed = JSON.parse(raw);
      savedAgents = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      savedAgents = [];
    }
  }

  function persistSavedAgents() {
    try {
      window.localStorage.setItem(SAVED_AGENTS_STORAGE_KEY, JSON.stringify(savedAgents));
    } catch (_) {}
  }

  function getAgentFormPayload() {
    const form = els.developAgentsForm;
    const formData = new FormData(form);
    return {
      id: safeText(formData.get('agent_preset_id')),
      name: safeText(formData.get('agent_name')),
      action: safeText(formData.get('action')) || 'create_job',
      job_id: safeText(formData.get('job_id')),
      workspace_id: safeText(formData.get('workspace_id')) || 'alphire-main',
      type: safeText(formData.get('type')) || 'acquire.web',
      requested_by_user_id: safeText(formData.get('requested_by_user_id')) || 'alphire-ui',
      requested_by_email: safeText(formData.get('requested_by_email')) || 'ops@alphire.ai',
      payload_json: String(formData.get('payload_json') || '').trim() || '{"source_urls":[],"max_pages":20}',
      approval_decision: safeText(formData.get('approval_decision')) || 'APPROVE',
      approval_token: safeText(formData.get('approval_token')),
      approval_comment: safeText(formData.get('approval_comment')),
      manual_confirmed: formData.get('manual_confirmed') === 'on',
    };
  }

  function populateAgentForm(record) {
    const form = els.developAgentsForm;
    if (!form || !record) return;
    const setValue = (name, value) => {
      const field = form.elements.namedItem(name);
      if (!field) return;
      if (field.type === 'checkbox') {
        field.checked = Boolean(value);
      } else {
        field.value = String(value || '');
      }
    };
    setValue('agent_preset_id', record.id);
    setValue('agent_name', record.name);
    setValue('action', record.action);
    setValue('job_id', record.job_id);
    setValue('workspace_id', record.workspace_id);
    setValue('type', record.type);
    setValue('requested_by_user_id', record.requested_by_user_id);
    setValue('requested_by_email', record.requested_by_email);
    setValue('payload_json', record.payload_json);
    setValue('approval_decision', record.approval_decision);
    setValue('approval_token', record.approval_token);
    setValue('approval_comment', record.approval_comment);
    setValue('manual_confirmed', record.manual_confirmed);
  }

  function resetAgentsForm() {
    if (els.developAgentsForm) els.developAgentsForm.reset();
    const presetId = byId('developAgentPresetIdInput');
    const nameInput = byId('developAgentNameInput');
    if (presetId) presetId.value = '';
    if (nameInput) nameInput.value = '';
    const actionSelect = byId('agentsActionSelect');
    if (actionSelect) actionSelect.value = 'agent_api_setup_orchestrator';
    const workspaceField = els.developAgentsForm?.elements?.namedItem('workspace_id');
    const typeField = els.developAgentsForm?.elements?.namedItem('type');
    const requestedById = els.developAgentsForm?.elements?.namedItem('requested_by_user_id');
    const requestedByEmail = els.developAgentsForm?.elements?.namedItem('requested_by_email');
    const payload = els.developAgentsForm?.elements?.namedItem('payload_json');
    if (workspaceField) workspaceField.value = 'alphire-main';
    if (typeField) typeField.value = 'acquire.web';
    if (requestedById) requestedById.value = 'alphire-ui';
    if (requestedByEmail) requestedByEmail.value = 'ops@alphire.ai';
    if (payload) payload.value = '{"source_urls":[],"max_pages":20}';
  }

  function renderSavedAgentsTable() {
    const body = byId('developAgentsTableBody');
    if (!body) return;
    if (!savedAgents.length) {
      body.innerHTML = '<tr><td colspan="6" class="meta">No saved agents yet.</td></tr>';
      return;
    }
    body.innerHTML = '';
    savedAgents
      .slice()
      .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))
      .forEach((item) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${safeText(item.name) || 'Untitled Agent'}</td>
          <td>${safeText(item.action) || '-'}</td>
          <td>${safeText(item.workspace_id) || '-'}</td>
          <td>${safeText(item.type) || '-'}</td>
          <td>${safeText(item.updatedAt) || '-'}</td>
          <td class="develop-agents-actions-cell"></td>
        `;
        const actions = row.querySelector('.develop-agents-actions-cell');
        if (actions) {
          actions.appendChild(App.makeIconButton('edit', 'Edit Agent', () => {
            populateAgentForm(item);
            setAgentsBuilderVisible(true);
            const panel = byId('developAgentsBuilderPanel');
            if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }));
          actions.appendChild(App.makeIconButton('copy', 'Clone Agent', () => {
            const clone = { ...item, id: '', name: `${safeText(item.name) || 'Agent'} Copy` };
            populateAgentForm(clone);
            const presetId = byId('developAgentPresetIdInput');
            if (presetId) presetId.value = '';
            setAgentsBuilderVisible(true);
          }));
          actions.appendChild(App.makeIconButton('delete', 'Delete Agent', () => {
            if (!window.confirm(`Delete agent "${safeText(item.name) || 'Untitled Agent'}"?`)) return;
            savedAgents = savedAgents.filter((entry) => safeText(entry.id) !== safeText(item.id));
            persistSavedAgents();
            renderSavedAgentsTable();
            notify('Agent deleted');
          }));
        }
        body.appendChild(row);
      });
  }

  function saveAgentPresetFromForm({ clone = false } = {}) {
    const payload = getAgentFormPayload();
    if (!payload.name) throw new Error('Agent name is required');
    const now = new Date().toISOString();
    const nextIdValue = clone || !payload.id ? nextLocalId('agent') : payload.id;
    const record = {
      ...payload,
      id: nextIdValue,
      updatedAt: now,
      createdAt: clone || !payload.id
        ? now
        : (savedAgents.find((entry) => safeText(entry.id) === safeText(payload.id))?.createdAt || now),
    };
    const existingIndex = savedAgents.findIndex((entry) => safeText(entry.id) === safeText(payload.id));
    if (!clone && existingIndex >= 0) savedAgents.splice(existingIndex, 1, record);
    else savedAgents.unshift(record);
    persistSavedAgents();
    renderSavedAgentsTable();
    populateAgentForm(record);
    const presetId = byId('developAgentPresetIdInput');
    if (presetId) presetId.value = record.id;
    notify(clone ? 'Agent cloned' : (existingIndex >= 0 ? 'Agent updated' : 'Agent saved'));
  }

  function openAgentsCreate() {
    App.setActivePage('developAgentsPage');
    resetAgentsForm();
    setAgentsBuilderVisible(true);
    const panel = byId('developAgentsBuilderPanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function slugify(value) {
    return safeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
  }

  function setSelectOptions(select, options, placeholder, currentValue) {
    if (!select) return;
    const desired = String(currentValue || '');
    select.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);

    (Array.isArray(options) ? options : []).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });

    if (desired && Array.from(select.options).some((option) => option.value === desired)) {
      select.value = desired;
    }
  }

  function assetLabel(asset, fallbackLabel) {
    return safeText(asset?.assetName) || fallbackLabel;
  }

  function isValidUrl(value) {
    const text = safeText(value);
    if (!text) return false;
    try {
      const parsed = new URL(text);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function extractDriveId(url) {
    const text = safeText(url);
    if (!text) return '';
    const byProxyPath = text.match(/\/api\/assets\/drive-file\/([a-zA-Z0-9_-]{10,})/);
    if (byProxyPath) return byProxyPath[1];
    const byProxyPathNoLeadingSlash = text.match(/^api\/assets\/drive-file\/([a-zA-Z0-9_-]{10,})/);
    if (byProxyPathNoLeadingSlash) return byProxyPathNoLeadingSlash[1];
    const byPath = text.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (byPath) return byPath[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
    try {
      const parsed = new URL(text);
      const byParam = parsed.searchParams.get('id');
      if (byParam) return byParam;
      const byPathInUrl = parsed.pathname.match(/\/api\/assets\/drive-file\/([a-zA-Z0-9_-]{10,})/);
      if (byPathInUrl) return byPathInUrl[1];
      return '';
    } catch {
      return '';
    }
  }

  function toDirectAssetUrl(url) {
    const text = safeText(url);
    if (!text) return '';
    if (text.startsWith('/api/assets/drive-file/')) return text;
    if (text.startsWith('api/assets/drive-file/')) return `/${text}`;
    const driveId = extractDriveId(text);
    if (driveId) return `/api/assets/drive-file/${encodeURIComponent(driveId)}`;
    if (isValidUrl(text)) return text;
    if (text.startsWith('/')) return text;
    return text;
  }

  function getAssetsByType(assetType) {
    return (Array.isArray(state.assets) ? state.assets : []).filter(
      (asset) => safeText(asset?.assetType) === safeText(assetType)
    );
  }

  function getFormLeadMagnetTypeDisplayLabel(type) {
    const value = safeText(type);
    const match = FORM_LEAD_MAGNET_TYPES.find((item) => safeText(item.value) === value);
    return match ? match.label : getAssetTypeDisplayLabel(value);
  }

  function getFormLeadMagnetTypeOptions(currentType) {
    const rows = FORM_LEAD_MAGNET_TYPES.map((item) => ({ value: item.value, label: item.label }));
    const legacy = safeText(currentType);
    if (legacy && !rows.some((item) => safeText(item.value) === legacy)) {
      rows.push({ value: legacy, label: getFormLeadMagnetTypeDisplayLabel(legacy) });
    }
    return rows;
  }

  function assetMatchesFormLeadMagnetType(asset, leadMagnetType) {
    const type = safeText(leadMagnetType);
    const assetType = safeText(asset?.assetType);
    const category = safeText(asset?.category);
    if (!type) return true;
    if (type === 'White Paper') {
      return (assetType === 'Lead Magnet' || assetType === 'File') && category === 'White Paper';
    }
    if (type === 'Report') {
      return (assetType === 'Lead Magnet' || assetType === 'File') && category === 'Report';
    }
    if (type === 'Video') {
      return assetType === 'Video';
    }
    if (type === 'Infographic') {
      return assetType === 'Image' && category === 'Infographic';
    }
    return assetType === type || category === type;
  }

  function getAssetTypeDisplayLabel(assetType) {
    return safeText(assetType) === 'Lead Magnet' ? 'PDF' : safeText(assetType);
  }

  function setThemeStatus(message, isError = false) {
    const node = byId('developThemesStatusMsg');
    if (!node) return;
    const text = safeText(message, 500);
    node.textContent = text;
    node.classList.toggle('hidden', !text);
    node.classList.toggle('error', Boolean(text && isError));
  }

  function getThemeImageAssets() {
    return getAssetsByType('Image');
  }

  const THEME_ASSET_PICKERS = {
    developThemesLogoWideSelect: {
      selectId: 'developThemesLogoWideSelect',
      buttonId: 'developThemesLogoWidePickerBtn',
      previewId: 'developThemesLogoWidePreview',
      title: 'Logo - Wide',
      category: 'Logo - Wide',
      categories: ['Logo - Wide'],
      tags: ['theme', 'logo-wide', 'builder'],
    },
    developThemesLogoSquareSelect: {
      selectId: 'developThemesLogoSquareSelect',
      buttonId: 'developThemesLogoSquarePickerBtn',
      previewId: 'developThemesLogoSquarePreview',
      title: 'Logo - Square',
      category: 'Logo - Square',
      categories: ['Logo - Square', 'Square Logo'],
      tags: ['theme', 'logo-square', 'builder'],
    },
    developThemesFeatureImageSelect: {
      selectId: 'developThemesFeatureImageSelect',
      buttonId: 'developThemesFeatureImagePickerBtn',
      previewId: 'developThemesFeatureImagePreview',
      title: 'Feature Image',
      category: 'Feature Image',
      categories: ['Feature Image', 'Feature', 'Feature Graphic', 'Featured Image'],
      tags: ['theme', 'feature-image', 'builder'],
    },
    developThemesBackgroundImageSelect: {
      selectId: 'developThemesBackgroundImageSelect',
      buttonId: 'developThemesBackgroundImagePickerBtn',
      previewId: 'developThemesBackgroundImagePreview',
      title: 'Background Image',
      category: 'Background Image',
      categories: ['Background Image'],
      tags: ['theme', 'background-image', 'builder'],
    },
  };

  const LANDING_IMAGE_PICKERS = {
    developLandingBannerImageSelect: {
      selectId: 'developLandingBannerImageSelect',
      buttonId: 'developLandingBannerImagePickerBtn',
      previewId: 'developLandingBannerImagePreview',
      title: 'Website Banner Image',
      category: 'Banner Image',
      categories: ['Banner Image', 'Website Banner', 'Website Banner Image', 'Hero Banner', 'Article Banner'],
      tags: ['landing-page', 'website-banner', 'builder'],
    },
    developLandingBackgroundImageSelect: {
      selectId: 'developLandingBackgroundImageSelect',
      buttonId: 'developLandingBackgroundImagePickerBtn',
      previewId: 'developLandingBackgroundImagePreview',
      title: 'Background Image',
      category: 'Background Image',
      categories: ['Background Image'],
      tags: ['landing-page', 'background-image', 'builder'],
    },
    developLandingFeatureImageSelect: {
      selectId: 'developLandingFeatureImageSelect',
      buttonId: 'developLandingFeatureImagePickerBtn',
      previewId: 'developLandingFeatureImagePreview',
      title: 'Feature Image',
      category: 'Feature Image',
      categories: ['Feature Image', 'Feature', 'Feature Graphic', 'Featured Image'],
      tags: ['landing-page', 'feature-image', 'builder'],
    },
    developLandingHighlightImageSelect: {
      selectId: 'developLandingHighlightImageSelect',
      buttonId: 'developLandingHighlightImagePickerBtn',
      previewId: 'developLandingHighlightImagePreview',
      title: 'Highlight Image',
      category: 'Highlight Image',
      categories: ['Highlight Image', 'Highlight'],
      tags: ['landing-page', 'highlight-image', 'builder'],
    },
    developLandingLogoSquareSelect: {
      selectId: 'developLandingLogoSquareSelect',
      buttonId: 'developLandingLogoSquarePickerBtn',
      previewId: 'developLandingLogoSquarePreview',
      title: 'Logo - Square',
      category: 'Logo - Square',
      categories: ['Logo - Square', 'Square Logo'],
      tags: ['landing-page', 'logo-square', 'builder'],
    },
  };

  function isLandingImageFieldKey(fieldKey) {
    return [
      'websiteBannerImageId',
      'backgroundImageId',
      'featureImageId',
      'highlightImageId',
      'logoSquareId',
      'logoWideId',
    ].includes(safeText(fieldKey));
  }

  function isLandingImageSelectId(selectId) {
    return Boolean(LANDING_IMAGE_PICKERS[safeText(selectId)]);
  }

  function getImagePickerConfig(selectId) {
    const key = String(selectId || '').trim();
    return THEME_ASSET_PICKERS[key] || LANDING_IMAGE_PICKERS[key] || null;
  }

  function getThemePickerConfig(selectId) {
    return THEME_ASSET_PICKERS[String(selectId || '').trim()] || null;
  }

  function getImagePickerAssets(selectId, currentValue = '') {
    const config = getImagePickerConfig(selectId);
    const currentId = safeText(currentValue);
    const allowedCategories = new Set((config?.categories || []).map((item) => safeText(item)).filter(Boolean));
    const rows = getThemeImageAssets().filter((asset) => {
      if (!allowedCategories.size) return true;
      return allowedCategories.has(safeText(asset?.category));
    });
    if (currentId && !rows.some((asset) => String(asset.id) === currentId)) {
      const currentAsset = (Array.isArray(state.assets) ? state.assets : []).find((asset) => String(asset.id) === currentId);
      if (currentAsset && safeText(currentAsset.assetType) === 'Image') rows.unshift(currentAsset);
    }
    return rows;
  }

  function getThemePickerAssets(selectId, currentValue = '') {
    return getImagePickerAssets(selectId, currentValue);
  }

  function renderThemeAssetPickerDisplay(selectId) {
    const config = getImagePickerConfig(selectId);
    if (!config) return;
    const select = byId(config.selectId);
    const button = byId(config.buttonId);
    const preview = byId(config.previewId);
    const selectedId = safeText(select?.value);
    const asset = selectedId
      ? (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === selectedId)
      : null;
    if (button) button.textContent = asset ? `Change ${config.title}` : `Choose ${config.title}`;
    if (!preview) return;
    if (!asset) {
      preview.innerHTML = 'No image selected';
      return;
    }
    const imageUrl = toDirectAssetUrl(asset.location);
    preview.innerHTML = `
      ${imageUrl ? `<img src="${imageUrl}" alt="${safeText(asset.assetName) || config.title}" />` : ''}
      <div class="develop-theme-asset-preview-text">
        <strong>${safeText(assetLabel(asset, config.title))}</strong>
        <span>${safeText(asset.category) || 'Image'}</span>
      </div>
    `;
  }

  function renderLandingAssetPickerDisplay(selectId) {
    const config = getImagePickerConfig(selectId);
    if (!config) return;
    const select = byId(config.selectId);
    const button = byId(config.buttonId);
    const preview = byId(config.previewId);
    const selectedId = safeText(select?.value);
    const asset = selectedId
      ? (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === selectedId)
      : null;
    if (button) button.textContent = asset ? `Change ${config.title}` : `Choose ${config.title}`;
    if (!preview) return;
    if (!asset) {
      preview.innerHTML = 'No image selected';
      return;
    }
    const imageUrl = toDirectAssetUrl(asset.location);
    preview.innerHTML = `
      ${imageUrl ? `<img src="${imageUrl}" alt="${safeText(asset.assetName) || config.title}" />` : ''}
      <div class="develop-theme-asset-preview-text">
        <strong>${safeText(assetLabel(asset, config.title))}</strong>
        <span>${safeText(asset.category) || 'Image'}</span>
      </div>
    `;
  }

  function renderThemeAssetSelect(selectId, currentValue, placeholderLabel) {
    const select = byId(selectId);
    if (!select) return;
    setSelectOptions(
      select,
      getThemePickerAssets(selectId, currentValue).map((asset) => ({
        value: String(asset.id),
        label: assetLabel(asset, `Asset ${asset.id}`),
      })),
      placeholderLabel || 'None',
      currentValue
    );
    renderThemeAssetPickerDisplay(selectId);
  }

  function renderLandingAssetSelect(selectId, currentValue, placeholderLabel) {
    const select = byId(selectId);
    if (!select) return;
    setSelectOptions(
      select,
      getImagePickerAssets(selectId, currentValue).map((asset) => ({
        value: String(asset.id),
        label: assetLabel(asset, `Asset ${asset.id}`),
      })),
      placeholderLabel || 'None',
      currentValue
    );
    renderLandingAssetPickerDisplay(selectId);
  }

  async function uploadThemeAssetFile(file, selectId) {
    const config = getImagePickerConfig(selectId);
    if (!file || !config) return null;
    if (!String(file.type || '').startsWith('image/')) {
      throw new Error('Please choose an image file');
    }
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const result = await api('/api/assets/upload-google-drive', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileBase64: btoa(binary),
        fileSize: Number(file.size || 0),
        assetType: 'Image',
        assetName: file.name.replace(/\.[^.]+$/, '') || file.name,
        category: config.category,
        tags: config.tags,
      }),
    });
    const asset = result?.asset || result?.data?.asset || null;
    if (!asset?.id) throw new Error('Image upload did not return an asset');
    state.assets = [asset].concat(Array.isArray(state.assets) ? state.assets.filter((item) => String(item.id) !== String(asset.id)) : []);
    return asset;
  }

  async function uploadLandingAssetFile(file, selectId) {
    const asset = await uploadThemeAssetFile(file, selectId);
    renderLandingAssetSelect(selectId, String(asset.id), 'None');
    updateLandingPageFieldOutlines();
    return asset;
  }

  function openImageAssetPicker(selectId, options = {}) {
    const config = getImagePickerConfig(selectId);
    const select = byId(selectId);
    if (!config || !App.components || typeof App.components.Modal !== 'function') return;
    const getValue = typeof options.getValue === 'function' ? options.getValue : (() => safeText(select.value));
    const setValue = typeof options.setValue === 'function'
      ? options.setValue
      : ((value) => {
        if (select) select.value = safeText(value);
      });
    const afterChange = typeof options.afterChange === 'function' ? options.afterChange : (() => {});
    const uploadHandler = typeof options.uploadHandler === 'function'
      ? options.uploadHandler
      : ((file) => uploadThemeAssetFile(file, selectId));
    const body = document.createElement('div');
    body.className = 'develop-theme-picker-body';
    const toolbar = document.createElement('div');
    toolbar.className = 'develop-theme-picker-toolbar';

    const filterInput = document.createElement('input');
    filterInput.placeholder = 'Search images by name, category, or tag';

    const resultCount = document.createElement('div');
    resultCount.className = 'develop-theme-picker-result-count';
    resultCount.textContent = '0 images';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear Selection';

    const uploadWrap = document.createElement('div');
    uploadWrap.className = 'develop-theme-picker-upload';
    const uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.accept = 'image/*';
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.textContent = 'Upload Image';
    uploadWrap.appendChild(uploadInput);
    uploadWrap.appendChild(uploadBtn);

    toolbar.appendChild(filterInput);
    toolbar.appendChild(resultCount);
    toolbar.appendChild(clearBtn);
    toolbar.appendChild(uploadWrap);

    const grid = document.createElement('div');
    grid.className = 'develop-theme-picker-grid';
    body.appendChild(toolbar);
    body.appendChild(grid);

    let modal = null;
    let previewModal = null;

    function getAssetDimensions(asset) {
      const width = Number(asset?.width || asset?.imageWidth || asset?.assetWidth || 0);
      const height = Number(asset?.height || asset?.imageHeight || asset?.assetHeight || 0);
      return {
        width: Number.isFinite(width) && width > 0 ? width : 0,
        height: Number.isFinite(height) && height > 0 ? height : 0,
      };
    }

    function getAssetOrientation(asset) {
      const { width, height } = getAssetDimensions(asset);
      if (!width || !height) return 'unknown';
      const ratio = width / height;
      if (ratio >= 1.2) return 'wide';
      if (ratio <= 0.82) return 'tall';
      return 'square';
    }

    function getAssetDimensionLabel(asset) {
      const { width, height } = getAssetDimensions(asset);
      return width && height ? `${width} x ${height}` : '';
    }

    function openImagePreview(asset) {
      if (!asset || !App.components || typeof App.components.Modal !== 'function') return;
      const imageUrl = toDirectAssetUrl(asset.location);
      if (!imageUrl) return;
      const previewBody = document.createElement('div');
      previewBody.className = 'develop-theme-image-preview-modal-body';
      previewBody.innerHTML = `
        <div class="develop-theme-image-preview-stage">
          <img src="${imageUrl}" alt="${safeText(assetLabel(asset, config.title))}" />
        </div>
        <div class="develop-theme-image-preview-meta">
          <strong>${safeText(assetLabel(asset, config.title))}</strong>
          <span>${safeText(asset.category) || 'Image'}</span>
        </div>
      `;
      previewModal = App.components.Modal({
        title: safeText(assetLabel(asset, config.title)) || config.title,
        body: previewBody,
        dialogClass: 'develop-theme-image-preview-modal',
      });
      previewModal.open();
    }

    function renderGrid() {
      const filter = safeText(filterInput.value).toLowerCase();
      const assets = getImagePickerAssets(selectId, getValue()).filter((asset) => {
        if (!filter) return true;
        const tagText = Array.isArray(asset?.tags)
          ? asset.tags.map((item) => safeText(item)).filter(Boolean).join(' ')
          : safeText(asset?.tags).replace(/[;,]+/g, ' ');
        const haystack = [
          assetLabel(asset, ''),
          safeText(asset.category),
          safeText(asset.assetName),
          safeText(asset.location),
          tagText,
        ].join(' ').toLowerCase();
        return haystack.includes(filter);
      });
      resultCount.textContent = `${assets.length} image${assets.length === 1 ? '' : 's'}`;
      grid.innerHTML = '';
      if (!assets.length) {
        const empty = document.createElement('div');
        empty.className = 'meta';
        empty.textContent = 'No matching images found.';
        grid.appendChild(empty);
        return;
      }
      const grouped = {
        wide: [],
        square: [],
        tall: [],
        unknown: [],
      };
      assets.forEach((asset) => {
        grouped[getAssetOrientation(asset)].push(asset);
      });

      [
        ['wide', 'Wide Images'],
        ['square', 'Square Images'],
        ['tall', 'Tall Images'],
        ['unknown', 'Other Images'],
      ].forEach(([groupKey, label]) => {
        const rows = grouped[groupKey];
        if (!rows.length) return;
        const section = document.createElement('section');
        section.className = 'develop-theme-picker-group';

        const heading = document.createElement('div');
        heading.className = 'develop-theme-picker-group-heading';
        heading.innerHTML = `<strong>${label}</strong><span>${rows.length}</span>`;
        section.appendChild(heading);

        const sectionGrid = document.createElement('div');
        sectionGrid.className = `develop-theme-picker-grid develop-theme-picker-grid--${groupKey}`;

        rows.forEach((asset) => {
          const card = document.createElement('div');
          card.className = `develop-theme-picker-card develop-theme-picker-card--${groupKey}${String(asset.id) === getValue() ? ' is-selected' : ''}`;
          const imageUrl = toDirectAssetUrl(asset.location);
          const dimensionLabel = getAssetDimensionLabel(asset);
          card.innerHTML = `
            <button type="button" class="develop-theme-picker-card-image-btn">
              ${imageUrl ? `<img src="${imageUrl}" alt="${safeText(assetLabel(asset, config.title))}" />` : '<div class="develop-theme-table-thumb-empty">No Image</div>'}
            </button>
            <div class="develop-theme-picker-card-title">${safeText(assetLabel(asset, config.title))}</div>
            <div class="develop-theme-picker-card-meta">${safeText(asset.category) || 'Image'}${dimensionLabel ? ` • ${dimensionLabel}` : ''}</div>
            <div class="develop-theme-picker-card-actions">
              <button type="button" class="tiny-btn develop-theme-picker-preview-btn">Preview</button>
              <button type="button" class="tiny-btn develop-theme-picker-select-btn">Use Image</button>
            </div>
          `;
          const imageBtn = card.querySelector('.develop-theme-picker-card-image-btn');
          const previewBtn = card.querySelector('.develop-theme-picker-preview-btn');
          const selectBtn = card.querySelector('.develop-theme-picker-select-btn');
          const choose = () => {
            setValue(String(asset.id));
            afterChange(asset);
            if (modal) modal.close();
          };
          if (imageBtn) {
            imageBtn.addEventListener('click', () => {
              openImagePreview(asset);
            });
          }
          if (previewBtn) {
            previewBtn.addEventListener('click', () => {
              openImagePreview(asset);
            });
          }
          if (selectBtn) {
            selectBtn.addEventListener('click', choose);
          }
          sectionGrid.appendChild(card);
        });

        section.appendChild(sectionGrid);
        grid.appendChild(section);
      });
    }

    filterInput.addEventListener('input', renderGrid);
    clearBtn.addEventListener('click', () => {
      setValue('');
      afterChange(null);
      if (modal) modal.close();
    });
    uploadBtn.addEventListener('click', async () => {
      const file = uploadInput.files && uploadInput.files[0];
      if (!file) {
        notify('Choose an image file first', true);
        return;
      }
      try {
        uploadBtn.disabled = true;
        const asset = await uploadHandler(file);
        notify('Image uploaded');
        if (asset?.id) {
          setValue(String(asset.id));
          afterChange(asset);
        }
        renderGrid();
        if (modal) modal.close();
      } catch (err) {
        notify(err.message || 'Could not upload image', true);
      } finally {
        uploadBtn.disabled = false;
      }
    });

    modal = App.components.Modal({
      title: `Choose ${config.title}`,
      body,
      dialogClass: 'develop-theme-picker-modal',
    });
    renderGrid();
    modal.open();
  }

  function openThemeAssetPicker(selectId) {
    openImageAssetPicker(selectId, {
      afterChange: () => {
        renderThemeAssetPickerDisplay(selectId);
        renderThemesPreview();
      },
      uploadHandler: (file) => uploadThemeAssetFile(file, selectId).then((asset) => {
        renderThemeAssetSelect(selectId, String(asset.id), 'None');
        renderThemesTable();
        renderThemesPreview();
        return asset;
      }),
    });
  }

  function openLandingAssetPicker(selectId) {
    openImageAssetPicker(selectId, {
      afterChange: () => {
        renderLandingAssetPickerDisplay(selectId);
        updateLandingPageFieldOutlines();
      },
      uploadHandler: (file) => uploadLandingAssetFile(file, selectId),
    });
  }

  function buildThemePayload() {
    return {
      name: safeText(byId('developThemesNameInput')?.value),
      primaryColor: safeText(byId('developThemesPrimaryColorInput')?.value) || DEFAULT_LANDING_PRIMARY,
      backgroundColor: safeText(byId('developThemesBackgroundColorInput')?.value) || DEFAULT_LANDING_BACKGROUND,
      accentColor: safeText(byId('developThemesAccentColorInput')?.value) || DEFAULT_LANDING_ACCENT,
      borderThickness: Number(byId('developThemesBorderThicknessInput')?.value || 1) || 1,
      borderRadius: Number(byId('developThemesBorderRadiusInput')?.value || 12) || 12,
      containerBlur: Number(byId('developThemesContainerBlurInput')?.value || 0) || 0,
      contrastLevel: Number(byId('developThemesContrastLevelInput')?.value || 0) || 0,
      logoWideId: safeText(byId('developThemesLogoWideSelect')?.value),
      logoSquareId: safeText(byId('developThemesLogoSquareSelect')?.value),
      featureImageId: safeText(byId('developThemesFeatureImageSelect')?.value),
      backgroundImageId: safeText(byId('developThemesBackgroundImageSelect')?.value),
    };
  }

  function syncThemeRangeLabels() {
    const pairs = [
      ['developThemesBorderThicknessInput', 'developThemesBorderThicknessValue'],
      ['developThemesBorderRadiusInput', 'developThemesBorderRadiusValue'],
      ['developThemesContainerBlurInput', 'developThemesContainerBlurValue'],
      ['developThemesContrastLevelInput', 'developThemesContrastLevelValue'],
    ];
    pairs.forEach(([inputId, outputId]) => {
      const input = byId(inputId);
      const output = byId(outputId);
      if (!input || !output) return;
      output.textContent = String(input.value || '0');
    });
  }

  function resetThemeBuilder() {
    selectedThemeId = '';
    if (byId('developThemesThemeSelect')) byId('developThemesThemeSelect').value = '';
    if (byId('developThemesNameInput')) byId('developThemesNameInput').value = '';
    if (byId('developThemesPrimaryColorInput')) byId('developThemesPrimaryColorInput').value = DEFAULT_LANDING_PRIMARY;
    if (byId('developThemesBackgroundColorInput')) byId('developThemesBackgroundColorInput').value = DEFAULT_LANDING_BACKGROUND;
    if (byId('developThemesAccentColorInput')) byId('developThemesAccentColorInput').value = DEFAULT_LANDING_ACCENT;
    if (byId('developThemesBorderThicknessInput')) byId('developThemesBorderThicknessInput').value = '1';
    if (byId('developThemesBorderRadiusInput')) byId('developThemesBorderRadiusInput').value = '12';
    if (byId('developThemesContainerBlurInput')) byId('developThemesContainerBlurInput').value = '0';
    if (byId('developThemesContrastLevelInput')) byId('developThemesContrastLevelInput').value = '0';
    renderThemeAssetSelect('developThemesLogoWideSelect', '', 'None');
    renderThemeAssetSelect('developThemesLogoSquareSelect', '', 'None');
    renderThemeAssetSelect('developThemesFeatureImageSelect', '', 'None');
    renderThemeAssetSelect('developThemesBackgroundImageSelect', '', 'None');
    syncThemeRangeLabels();
    setThemeStatus('');
    renderThemesPreview();
  }

  function applyThemeToBuilder(theme) {
    if (!theme) {
      resetThemeBuilder();
      return;
    }
    selectedThemeId = String(theme.id || '');
    if (byId('developThemesThemeSelect')) byId('developThemesThemeSelect').value = selectedThemeId;
    if (byId('developThemesNameInput')) byId('developThemesNameInput').value = safeText(theme.name);
    if (byId('developThemesPrimaryColorInput')) byId('developThemesPrimaryColorInput').value = safeText(theme.primaryColor) || DEFAULT_LANDING_PRIMARY;
    if (byId('developThemesBackgroundColorInput')) byId('developThemesBackgroundColorInput').value = safeText(theme.backgroundColor) || DEFAULT_LANDING_BACKGROUND;
    if (byId('developThemesAccentColorInput')) byId('developThemesAccentColorInput').value = safeText(theme.accentColor) || DEFAULT_LANDING_ACCENT;
    if (byId('developThemesBorderThicknessInput')) byId('developThemesBorderThicknessInput').value = String(theme.borderThickness ?? 1);
    if (byId('developThemesBorderRadiusInput')) byId('developThemesBorderRadiusInput').value = String(theme.borderRadius ?? 12);
    if (byId('developThemesContainerBlurInput')) byId('developThemesContainerBlurInput').value = String(theme.containerBlur ?? 0);
    if (byId('developThemesContrastLevelInput')) byId('developThemesContrastLevelInput').value = String(theme.contrastLevel ?? 0);
    renderThemeAssetSelect('developThemesLogoWideSelect', safeText(theme.logoWideId), 'None');
    renderThemeAssetSelect('developThemesLogoSquareSelect', safeText(theme.logoSquareId), 'None');
    renderThemeAssetSelect('developThemesFeatureImageSelect', safeText(theme.featureImageId), 'None');
    renderThemeAssetSelect('developThemesBackgroundImageSelect', safeText(theme.backgroundImageId), 'None');
    syncThemeRangeLabels();
    setThemeStatus('');
    renderThemesPreview();
  }

  function syncThemesBuilder() {
    setSelectOptions(
      byId('developThemesThemeSelect'),
      savedThemes.map((theme) => ({ value: String(theme.id), label: safeText(theme.name) || `Theme ${theme.id}` })),
      'Select Theme',
      selectedThemeId
    );
    const current = getThemeById(selectedThemeId);
    if (current) applyThemeToBuilder(current);
    else resetThemeBuilder();
  }

  function getThemeAssetLabel(id, fallback = '-') {
    const cleanId = safeText(id);
    if (!cleanId) return fallback;
    const asset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === cleanId);
    return assetLabel(asset, fallback);
  }

  function renderThemePaletteSwatches(theme) {
    const colors = [
      { label: 'Primary', value: safeText(theme?.primaryColor) },
      { label: 'Background', value: safeText(theme?.backgroundColor) },
      { label: 'Accent', value: safeText(theme?.accentColor) },
    ].filter((item) => item.value);
    if (!colors.length) return '-';
    return `
      <div class="develop-theme-palette-cell">
        ${colors.map((item) => `
          <span class="develop-theme-palette-chip" title="${item.label}: ${item.value}">
            <span class="develop-theme-palette-dot" style="background:${item.value};"></span>
            <span>${item.value}</span>
          </span>
        `).join('')}
      </div>
    `;
  }

  function renderThemeStyleGlyph(theme) {
    const borderThickness = Math.max(0, Number(theme?.borderThickness || 0) || 0);
    const borderRadius = Math.max(0, Number(theme?.borderRadius || 0) || 0);
    const scaledRadius = Math.min(14, Math.round(borderRadius / 4));
    const borderWidth = borderThickness > 0 ? 1 : 0;
    return `
      <div class="develop-theme-style-cell">
        <span class="develop-theme-style-glyph" style="border-width:${borderWidth}px;border-radius:${scaledRadius}px;"></span>
        <span>B:${borderThickness} R:${borderRadius} Blur:${theme?.containerBlur ?? 0} C:${theme?.contrastLevel ?? 0}</span>
      </div>
    `;
  }

  function getThemePreviewMessagingContent() {
    const headlineRows = Array.isArray(landingPageHeadlines) ? landingPageHeadlines : [];
    const subheadingRows = Array.isArray(landingPageSubheadings) ? landingPageSubheadings : [];
    const pitchRows = Array.isArray(landingPagePitches) ? landingPagePitches : [];
    const ctaRows = Array.isArray(landingPageCtas) ? landingPageCtas : [];
    return {
      heroHeadline: safeText(headlineRows[0]?.headline) || 'Messaging headline preview',
      heroPitch: safeText(pitchRows[0]?.pitch) || 'Use real Headlines, Pitches, and Calls to Action from this project to preview a landing page theme in context.',
      primaryCta: safeText(ctaRows[0]?.cta) || 'Primary CTA',
      secondaryCta: safeText(ctaRows[1]?.cta || ctaRows[0]?.cta) || 'Secondary CTA',
      featureHeadline: safeText(headlineRows[1]?.headline || headlineRows[0]?.headline) || 'Feature headline',
      featureSubheading: safeText(subheadingRows[0]?.subheading) || 'Feature sub-heading from Messaging',
      highlightHeadline: safeText(headlineRows[2]?.headline || headlineRows[0]?.headline) || 'Highlight headline',
      highlightPitch: safeText(pitchRows[1]?.pitch || pitchRows[0]?.pitch) || 'Highlight support copy from Messaging Pitches.',
      bodyHeadline: safeText(headlineRows[3]?.headline || headlineRows[0]?.headline) || 'Body headline',
      bodySubheading: safeText(subheadingRows[1]?.subheading || subheadingRows[0]?.subheading) || 'Body sub-heading',
      bodyPitch: safeText(pitchRows[2]?.pitch || pitchRows[0]?.pitch) || 'Body pitch content appears here using project-scoped Messaging records.',
    };
  }

  function renderThemesPreview() {
    const host = byId('developThemesPreviewHost');
    if (!host) return;
    const payload = buildThemePayload();
    const content = getThemePreviewMessagingContent();
    const logoWideAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.logoWideId));
    const logoSquareAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.logoSquareId));
    const featureAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.featureImageId));
    const backgroundAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.backgroundImageId));
    const logoWideUrl = logoWideAsset ? toDirectAssetUrl(logoWideAsset.location) : '';
    const logoSquareUrl = logoSquareAsset ? toDirectAssetUrl(logoSquareAsset.location) : '';
    const featureUrl = featureAsset ? toDirectAssetUrl(featureAsset.location) : '';
    const backgroundUrl = backgroundAsset ? toDirectAssetUrl(backgroundAsset.location) : '';
    host.innerHTML = `
      <div class="develop-themes-preview-frame" style="${backgroundUrl ? `background-image:linear-gradient(rgba(7,33,66,0.18), rgba(7,33,66,0.18)), url('${backgroundUrl}');` : `background:${payload.backgroundColor};`}">
        <div class="develop-themes-preview-card" style="background:${payload.backgroundColor}; border:${payload.borderThickness}px solid ${payload.accentColor}; border-radius:${payload.borderRadius}px; backdrop-filter:blur(${payload.containerBlur}px);">
          <div class="develop-themes-preview-header">
            <div class="develop-themes-preview-brand">
              ${logoWideUrl ? `<img class="develop-themes-preview-logo-wide" src="${logoWideUrl}" alt="Wide logo" />` : `<div class="develop-themes-preview-logo-fallback" style="color:${payload.primaryColor};">${safeText(payload.name) || 'Theme Brand'}</div>`}
              <div class="develop-themes-preview-eyebrow" style="color:${payload.accentColor};">Landing Page Theme</div>
            </div>
            ${logoSquareUrl ? `<img class="develop-themes-preview-logo-square" src="${logoSquareUrl}" alt="Square logo" />` : ''}
          </div>
          <div class="develop-themes-preview-hero">
            <div class="develop-themes-preview-copy">
              <div class="develop-themes-preview-kicker" style="color:${payload.accentColor};">${safeText(payload.name) || 'Untitled Theme'}</div>
              <h4 style="color:${payload.primaryColor};">${content.heroHeadline}</h4>
              <p>${content.heroPitch}</p>
              <div class="develop-themes-preview-actions">
                <button type="button" style="background:${payload.primaryColor}; border-color:${payload.primaryColor};">${content.primaryCta}</button>
                <button type="button" style="border:${Math.max(1, payload.borderThickness)}px solid ${payload.accentColor}; color:${payload.accentColor}; background:transparent;">${content.secondaryCta}</button>
              </div>
            </div>
            <div class="develop-themes-preview-feature" style="border-radius:${payload.borderRadius}px;">
              ${featureUrl ? `<img src="${featureUrl}" alt="Feature" />` : '<div class="develop-themes-preview-feature-placeholder">Feature Image</div>'}
            </div>
          </div>
          <div class="develop-themes-preview-modules">
            <article class="develop-themes-preview-module">
              <h5 style="color:${payload.primaryColor};">${content.featureHeadline}</h5>
              <p class="develop-themes-preview-module-subheading">${content.featureSubheading}</p>
            </article>
            <article class="develop-themes-preview-module">
              <h5 style="color:${payload.primaryColor};">${content.highlightHeadline}</h5>
              <p>${content.highlightPitch}</p>
            </article>
          </div>
          <div class="develop-themes-preview-body">
            <div class="develop-themes-preview-body-copy">
              <h5 style="color:${payload.primaryColor};">${content.bodyHeadline}</h5>
              <p class="develop-themes-preview-module-subheading">${content.bodySubheading}</p>
              <p>${content.bodyPitch}</p>
            </div>
            <div class="develop-themes-preview-body-side" style="border-radius:${payload.borderRadius}px; border:${Math.max(1, payload.borderThickness)}px solid ${payload.accentColor};">
              <span style="color:${payload.accentColor};">${content.secondaryCta}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderThemesInventory() {
    const tbody = byId('developThemesInventoryBody');
    const list = byId('developThemesConsolidationList');
    if (tbody) {
      tbody.innerHTML = `
        <tr><td>Palette</td><td>Primary / Background / Accent</td><td>Supabase Theme Record</td><td>Shared theme builder</td></tr>
        <tr><td>Container Styles</td><td>Border, Radius, Blur, Contrast</td><td>Supabase Theme Record</td><td>Shared theme builder</td></tr>
        <tr><td>Image Assets</td><td>Logo Wide, Logo Square, Feature, Background</td><td>Supabase Theme Record</td><td>Shared theme builder</td></tr>
      `;
    }
    if (list) {
      list.innerHTML = `
        <li>Use Builder: Themes as the shared visual source of truth for campaigns and pages.</li>
        <li>Keep asset-driven visual references attached to each theme record.</li>
      `;
    }
  }

  function buildThemeActions(theme) {
    const wrap = document.createElement('div');
    wrap.className = 'page-heading-actions';
    wrap.style.justifyContent = 'flex-start';
    wrap.appendChild(App.makeIconButton('edit', 'Edit Theme', () => {
      setThemesBuilderVisible(true);
      applyThemeToBuilder(theme);
      const panel = byId('developThemesBuilderPanel');
      if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    wrap.appendChild(App.makeIconButton('delete', 'Delete Theme', async () => {
      if (!window.confirm(`Delete theme "${safeText(theme.name) || theme.id}"?`)) return;
      try {
        await api(`/api/develop/themes/${encodeURIComponent(theme.id)}`, { method: 'DELETE' });
        if (String(selectedThemeId) === String(theme.id)) selectedThemeId = '';
        await refresh();
        notify('Theme deleted');
      } catch (err) {
        notify(err.message || 'Could not delete theme', true);
      }
    }, { danger: true, marginLeft: '8px' }));
    return wrap;
  }

  function renderThemesTable() {
    const tbody = byId('developThemesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!savedThemes.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No saved themes yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }
    savedThemes.forEach((theme) => {
      const tr = document.createElement('tr');
      const featureTd = document.createElement('td');
      featureTd.className = 'develop-theme-table-thumb';
      const featureAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(theme.featureImageId));
      const featureUrl = featureAsset ? toDirectAssetUrl(featureAsset.location) : '';
      featureTd.innerHTML = featureUrl ? `<img src="${featureUrl}" alt="Feature image" />` : '<div class="develop-theme-table-thumb-empty">None</div>';
      const nameTd = document.createElement('td');
      nameTd.textContent = safeText(theme.name) || '-';
      const paletteTd = document.createElement('td');
      paletteTd.innerHTML = renderThemePaletteSwatches(theme);
      const stylesTd = document.createElement('td');
      stylesTd.innerHTML = renderThemeStyleGlyph(theme);
      const updatedTd = document.createElement('td');
      updatedTd.textContent = theme.updatedAt ? new Date(theme.updatedAt).toLocaleString() : '-';
      const actionsTd = document.createElement('td');
      actionsTd.appendChild(buildThemeActions(theme));
      tr.appendChild(featureTd);
      tr.appendChild(nameTd);
      tr.appendChild(paletteTd);
      tr.appendChild(stylesTd);
      tr.appendChild(updatedTd);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function getAssetsByCategory(category) {
    return (Array.isArray(state.assets) ? state.assets : []).filter(
      (asset) => safeText(asset?.category) === safeText(category)
    );
  }

  function getAssetsByCategoryAliases(categories, assetType) {
    const allowedCategories = new Set(
      (Array.isArray(categories) ? categories : [])
        .map((item) => safeText(item))
        .filter(Boolean)
    );
    const normalizedType = safeText(assetType);
    return (Array.isArray(state.assets) ? state.assets : []).filter((asset) => {
      if (normalizedType && safeText(asset?.assetType) !== normalizedType) return false;
      return allowedCategories.has(safeText(asset?.category));
    });
  }

  async function submitToolJob(toolName, input, workspaceId, requestPreviewEl, responsePreviewEl, successMessage) {
    const request = {
      manual_confirmed: true,
      type:             'tool.run',
      workspace_id:     safeText(workspaceId) || 'alphire-main',
      requested_by:     { user_id: 'alphire-ui', email: 'ops@alphire.ai' },
      payload:          { tool_name: safeText(toolName), input },
      policy:           { requires_manual_approval: true }
    };
    setPreview(requestPreviewEl, { action: 'create_job', request });
    const result = await api('/api/openclaw/create_job', { method: 'POST', body: JSON.stringify(request) });
    setPreview(responsePreviewEl, result);
    notify(successMessage);
    return result;
  }

  function renderIconBuilderResult(icon) {
    if (!els.iconBuilderResultCard || !els.iconBuilderResultImage) return;
    const hasIcon = Boolean(icon?.dataUrl);
    els.iconBuilderResultCard.classList.toggle('hidden', !hasIcon);
    if (!hasIcon) {
      els.iconBuilderResultImage.removeAttribute('src');
      if (els.iconBuilderResultTitle) els.iconBuilderResultTitle.textContent = 'Generated Icon';
      if (els.iconBuilderResultCaption) els.iconBuilderResultCaption.textContent = '';
      return;
    }
    els.iconBuilderResultImage.src = String(icon.dataUrl);
    if (els.iconBuilderResultTitle) {
      els.iconBuilderResultTitle.textContent = safeText(icon.objectName) || 'Generated Icon';
    }
    if (els.iconBuilderResultCaption) {
      const bits = [safeText(icon.objectType), safeText(icon.visualStyle), safeText(icon.size)].filter(Boolean);
      els.iconBuilderResultCaption.textContent = bits.join(' | ');
    }
  }

  function renderScreenshotResult(asset) {
    const card = byId('developScreenshotResultCard');
    const image = byId('developScreenshotResultImage');
    const title = byId('developScreenshotResultTitle');
    const caption = byId('developScreenshotResultCaption');
    const hasAsset = Boolean(asset && safeText(asset.location));
    if (card) card.classList.toggle('hidden', !hasAsset);
    if (!image) return;
    if (!hasAsset) {
      image.removeAttribute('src');
      if (title) title.textContent = 'Captured Screenshot';
      if (caption) caption.textContent = '';
      return;
    }
    image.src = safeText(asset.location);
    if (title) title.textContent = safeText(asset.assetName) || 'Captured Screenshot';
    if (caption) {
      const bits = [safeText(asset.assetType), safeText(asset.category), asset.imageWidth && asset.imageHeight ? `${asset.imageWidth}x${asset.imageHeight}` : '']
        .filter(Boolean);
      caption.textContent = bits.join(' | ');
    }
  }

  function renderThumbnailResult(asset) {
    const card = byId('developThumbnailResultCard');
    const image = byId('developThumbnailResultImage');
    const title = byId('developThumbnailResultTitle');
    const caption = byId('developThumbnailResultCaption');
    const hasAsset = Boolean(asset && safeText(asset.location));
    if (card) card.classList.toggle('hidden', !hasAsset);
    if (!image) return;
    if (!hasAsset) {
      image.removeAttribute('src');
      if (title) title.textContent = 'Generated Thumbnail';
      if (caption) caption.textContent = '';
      return;
    }
    image.src = safeText(asset.location);
    if (title) title.textContent = safeText(asset.assetName) || 'Generated Thumbnail';
    if (caption) {
      const bits = [safeText(asset.assetType), safeText(asset.category), asset.imageWidth && asset.imageHeight ? `${asset.imageWidth}x${asset.imageHeight}` : '']
        .filter(Boolean);
      caption.textContent = bits.join(' | ');
    }
  }

  function renderThumbnailSourceAssetOptions() {
    const select = byId('developThumbnailSourceAssetSelect');
    if (!select) return;
    const items = (Array.isArray(state.assets) ? state.assets : [])
      .slice()
      .sort((a, b) => safeText(a?.assetName).localeCompare(safeText(b?.assetName)))
      .map((asset) => ({
        value: safeText(asset.id),
        label: `${assetLabel(asset, 'Asset')} (${safeText(asset.assetType) || 'Unknown'})`,
      }));
    setSelectOptions(select, items, 'Source Asset (Optional)');
  }

  function getTemplateById(templateId) {
    const id = safeText(templateId);
    return LANDING_TEMPLATES.find((item) => item.id === id) || LANDING_TEMPLATES[0];
  }

  function getFormTemplateById(templateId) {
    const id = safeText(templateId);
    return FORM_TEMPLATES.find((item) => item.id === id) || FORM_TEMPLATES[0];
  }

  function buildDefaultFormState(templateId) {
    const template = getFormTemplateById(templateId);
    return {
      id: '',
      name: '',
      formType: template.id,
      contactType: 'lead',
      leadMagnetType: '',
      leadMagnetId: '',
      ctaId: '',
      heading: template.defaultHeading,
      submitLabel: template.defaultSubmitLabel,
      successMessage: 'Thanks. Your request has been received.',
      errorMessage: 'Something went wrong. Please try again.',
      accentColor: DEFAULT_FORM_ACCENT,
      matchLandingColor: false,
      landingColorMode: 'primary',
      useLandingBackground: false,
      required: Object.fromEntries(template.fields.map((field) => [field.key, Boolean(field.required)])),
    };
  }

  function ensureFormBuilderState(templateId) {
    const requestedTemplate = getFormTemplateById(templateId);
    if (!formBuilderState || formBuilderState.formType !== requestedTemplate.id) {
      formBuilderState = buildDefaultFormState(requestedTemplate.id);
    }
    return formBuilderState;
  }

  function renderFormBuilderFieldConfig() {
    const host = byId('developFormFieldsConfig');
    if (!host) return;

    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const template = getFormTemplateById(current.formType);
    host.innerHTML = '';

    template.fields.forEach((field) => {
      const row = document.createElement('div');
      row.className = 'develop-form-config-row';

      const label = document.createElement('div');
      label.className = 'develop-form-config-label';
      label.textContent = field.label;

      const toggleWrap = document.createElement('label');
      toggleWrap.className = 'checkbox-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(current.required[field.key]);
      checkbox.addEventListener('change', () => {
        current.required[field.key] = checkbox.checked;
        renderFormBuilderPreview();
      });
      toggleWrap.appendChild(checkbox);
      toggleWrap.appendChild(document.createTextNode('Required'));

      row.appendChild(label);
      row.appendChild(toggleWrap);
      host.appendChild(row);
    });
  }

  function renderFormBuilderPreview() {
    const host = byId('developFormPreviewHost');
    if (!host) return;

    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const template = getFormTemplateById(current.formType);
    const accentColor = current.matchLandingColor
      ? MATCH_LANDING_GREY
      : (safeText(current.accentColor) || DEFAULT_FORM_ACCENT);
    const previewBackground = current.matchLandingColor && current.useLandingBackground
      ? landingPageColors.background
      : '';

    host.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'develop-form-preview';
    card.style.borderColor = accentColor;
    card.style.boxShadow = `0 10px 22px ${accentColor}22`;
    card.style.background = previewBackground || 'linear-gradient(135deg, #ffffff 0%, #f5fbff 100%)';

    const heading = document.createElement('h3');
    heading.textContent = current.heading || template.defaultHeading;
    heading.style.color = accentColor;
    card.appendChild(heading);

    template.fields.forEach((field) => {
      const input = document.createElement('input');
      input.type = field.type;
      input.placeholder = field.label;
      if (current.required[field.key]) input.required = true;
      card.appendChild(input);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = getLandingPageCtaLabel(current.ctaId) || current.submitLabel || template.defaultSubmitLabel;
    submitBtn.style.background = accentColor;
    submitBtn.style.borderColor = accentColor;
    submitBtn.style.color = '#ffffff';
    card.appendChild(submitBtn);

    if (current.leadMagnetId) {
      const helper = document.createElement('p');
      helper.style.margin = '0.75rem 0 0 0';
      helper.style.fontSize = '0.84rem';
      helper.style.color = '#36516a';
      helper.textContent = `Lead Magnet: ${getLandingPageAssetName(current.leadMagnetId, 'Selected Asset')}`;
      card.appendChild(helper);
    }

    host.appendChild(card);
  }

  function buildCurrentFormPayload(nameOverride) {
    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const template = getFormTemplateById(current.formType);
    const ctaLabel = getLandingPageCtaLabel(current.ctaId) || current.submitLabel || template.defaultSubmitLabel;
    return {
      id: safeText(current.id),
      name: safeText(nameOverride || byId('developFormNameInput')?.value),
      formType: template.id,
      contactType: safeText(current.contactType) || 'lead',
      leadMagnetType: safeText(current.leadMagnetType),
      leadMagnetId: safeText(current.leadMagnetId),
      ctaId: safeText(current.ctaId),
      heading: current.heading || template.defaultHeading,
      submitLabel: ctaLabel,
      successMessage: safeText(current.successMessage),
      errorMessage: safeText(current.errorMessage),
      accentColor: safeText(current.accentColor) || DEFAULT_FORM_ACCENT,
      matchLandingColor: Boolean(current.matchLandingColor),
      landingColorMode: current.matchLandingColor ? (safeText(current.landingColorMode) || 'primary') : '',
      useLandingBackground: Boolean(current.matchLandingColor && current.useLandingBackground),
      fields: template.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: Boolean(current.required[field.key]),
      })),
    };
  }

  function formatRequiredFieldsSummary(form) {
    const requiredLabels = (Array.isArray(form?.fields) ? form.fields : [])
      .filter((field) => Boolean(field?.required))
      .map((field) => safeText(field?.label))
      .filter(Boolean);
    return requiredLabels.length ? requiredLabels.join(', ') : 'None';
  }

  function getFilteredSortedForms() {
    const rows = savedForms.slice();
    const direction = formTableState.sort.dir === 'asc' ? 1 : -1;
    const getValue = (row, key) => {
      switch (key) {
        case 'name':
          return safeText(row?.name).toLowerCase();
        case 'formType':
          return safeText(getFormTemplateById(row?.formType).name).toLowerCase();
        case 'leadMagnetType':
          return safeText(getFormLeadMagnetTypeDisplayLabel(row?.leadMagnetType)).toLowerCase();
        case 'leadMagnetId':
          return safeText(getLandingPageAssetName(row?.leadMagnetId, '')).toLowerCase();
        case 'ctaId':
          return safeText(getLandingPageCtaLabel(row?.ctaId)).toLowerCase();
        case 'contactType':
          return safeText(row?.contactType).toLowerCase();
        case 'updatedAt':
        default:
          return new Date(row?.updatedAt || row?.createdAt || 0).getTime();
      }
    };
    rows.sort((a, b) => {
      const left = getValue(a, formTableState.sort.key);
      const right = getValue(b, formTableState.sort.key);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right)) * direction;
    });
    return rows;
  }

  function applySavedFormToBuilder(form) {
    const template = getFormTemplateById(form?.formType);
    const required = Object.fromEntries(template.fields.map((field) => [field.key, false]));
    (Array.isArray(form?.fields) ? form.fields : []).forEach((field) => {
      const key = safeText(field?.key);
      if (key && Object.prototype.hasOwnProperty.call(required, key)) {
        required[key] = Boolean(field?.required);
      }
    });

    formBuilderState = {
      id: safeText(form?.id),
      name: safeText(form?.name),
      formType: template.id,
      contactType: safeText(form?.contactType) || 'lead',
      leadMagnetType: safeText(form?.leadMagnetType),
      leadMagnetId: safeText(form?.leadMagnetId),
      ctaId: safeText(form?.ctaId),
      heading: safeText(form?.heading) || template.defaultHeading,
      submitLabel: safeText(form?.submitLabel) || template.defaultSubmitLabel,
      successMessage: safeText(form?.successMessage) || 'Thanks. Your request has been received.',
      errorMessage: safeText(form?.errorMessage) || 'Something went wrong. Please try again.',
      accentColor: safeText(form?.accentColor) || DEFAULT_FORM_ACCENT,
      matchLandingColor: Boolean(form?.matchLandingColor),
      landingColorMode: safeText(form?.landingColorMode) || 'primary',
      useLandingBackground: Boolean(form?.useLandingBackground),
      required,
    };

    const nameInput = byId('developFormNameInput');
    if (nameInput) nameInput.value = safeText(form?.name);
    const editorTitle = byId('developFormsEditorTitle');
    if (editorTitle) editorTitle.textContent = 'Edit Form';
    byId('developFormEditorPanel')?.classList.remove('hidden');
    syncFormBuilderInputs();
    renderFormBuilderFieldConfig();
    renderFormBuilderPreview();
  }

  function renderSavedForms() {
    const tbody = byId('developFormsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!savedForms.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 8;
      cell.textContent = 'No saved forms yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    getFilteredSortedForms().forEach((form) => {
      const row = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = safeText(form.name) || '-';

      const typeTd = document.createElement('td');
      typeTd.textContent = getFormTemplateById(form.formType).name;

      const leadMagnetTypeTd = document.createElement('td');
      leadMagnetTypeTd.textContent = getFormLeadMagnetTypeDisplayLabel(form.leadMagnetType) || '-';

      const leadMagnetTd = document.createElement('td');
      leadMagnetTd.textContent = getLandingPageAssetName(form.leadMagnetId, '-') || '-';

      const ctaTd = document.createElement('td');
      ctaTd.textContent = getLandingPageCtaLabel(form.ctaId) || '-';

      const contactTypeTd = document.createElement('td');
      contactTypeTd.textContent = CONTACT_TYPE_OPTIONS.find((item) => item.value === safeText(form.contactType))?.label || safeText(form.contactType) || '-';

      const updatedTd = document.createElement('td');
      updatedTd.textContent = form.updatedAt ? new Date(form.updatedAt).toLocaleString() : '-';

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Form', () => {
        applySavedFormToBuilder(form);
        notify(`Editing form: ${safeText(form.name) || form.id}`);
      });
      const cloneBtn = App.makeIconButton('clone', 'Clone Form', async () => {
        try {
          const payload = {
            name: safeText(form.name),
            formType: safeText(form.formType),
            contactType: safeText(form.contactType),
            leadMagnetType: safeText(form.leadMagnetType),
            leadMagnetId: safeText(form.leadMagnetId),
            ctaId: safeText(form.ctaId),
            heading: safeText(form.heading),
            submitLabel: safeText(form.submitLabel),
            successMessage: safeText(form.successMessage),
            errorMessage: safeText(form.errorMessage),
            accentColor: safeText(form.accentColor),
            matchLandingColor: Boolean(form.matchLandingColor),
            landingColorMode: safeText(form.landingColorMode),
            useLandingBackground: Boolean(form.useLandingBackground),
            fields: Array.isArray(form.fields)
              ? form.fields.map((field) => ({
                  key: safeText(field?.key),
                  label: safeText(field?.label),
                  type: safeText(field?.type),
                  required: Boolean(field?.required),
                }))
              : [],
          };
          await api('/api/develop/forms', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          await refresh();
          notify('Form cloned');
        } catch (err) {
          notify(err.message, true);
        }
      }, { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Form', async () => {
        if (!window.confirm(`Delete form "${safeText(form.name) || form.id}"?`)) return;
        try {
          await api(`/api/develop/forms/${encodeURIComponent(form.id)}`, { method: 'DELETE' });
          await refresh();
          notify('Form deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(cloneBtn);
      actionsTd.appendChild(deleteBtn);

      row.appendChild(nameTd);
      row.appendChild(typeTd);
      row.appendChild(leadMagnetTypeTd);
      row.appendChild(leadMagnetTd);
      row.appendChild(ctaTd);
      row.appendChild(contactTypeTd);
      row.appendChild(updatedTd);
      row.appendChild(actionsTd);
      tbody.appendChild(row);
    });
  }

  async function loadSavedForms() {
    const result = await api('/api/develop/forms');
    savedForms = Array.isArray(result.forms) ? result.forms : [];
  }

  async function loadSavedThemes() {
    const result = await api('/api/develop/themes');
    savedThemes = Array.isArray(result.themes) ? result.themes : [];
    if (!selectedThemeId && savedThemes[0]?.id) {
      selectedThemeId = String(savedThemes[0].id);
    }
    if (selectedThemeId && !savedThemes.some((item) => String(item.id) === String(selectedThemeId))) {
      selectedThemeId = String(savedThemes[0]?.id || '');
    }
  }

  async function loadSavedEmailTemplates() {
    const result = await api('/api/develop/email-templates');
    savedEmailTemplates = Array.isArray(result.emailTemplates) ? result.emailTemplates : [];
    if (!selectedEmailTemplateId && savedEmailTemplates[0]?.id) {
      selectedEmailTemplateId = String(savedEmailTemplates[0].id);
    }
    if (selectedEmailTemplateId && !savedEmailTemplates.some((item) => String(item.id) === String(selectedEmailTemplateId))) {
      selectedEmailTemplateId = String(savedEmailTemplates[0]?.id || '');
    }
  }

  async function loadSavedLandingPages() {
    const result = await api('/api/develop/landing-pages');
    savedLandingPages = Array.isArray(result.landingPages) ? result.landingPages : [];
  }

  async function loadSavedPageTemplates() {
    try {
      const result = await api('/api/develop/page-templates');
      savedPageTemplates = Array.isArray(result.pageTemplates) ? result.pageTemplates : [];
    } catch (_) {
      savedPageTemplates = [];
    }
  }

  async function loadSavedExtensions() {
    const result = await api('/api/develop/extensions');
    savedExtensions = Array.isArray(result.extensions) ? result.extensions : [];
  }

  async function loadExtensionManagerConfig() {
    try {
      const result = await api('/api/develop/extensions-manager');
      const manager = result.manager || result.data || {};
      extensionManagerConfig = {
        defaultFilters: manager.defaultFilters && typeof manager.defaultFilters === 'object' ? manager.defaultFilters : {},
        defaultSortKey: safeText(manager.defaultSortKey) || 'updatedAt',
        defaultSortDir: safeText(manager.defaultSortDir) || 'desc',
      };
      extensionTableState.filters = {
        name: safeText(extensionManagerConfig.defaultFilters.name),
        extensionType: safeText(extensionManagerConfig.defaultFilters.extensionType),
        status: safeText(extensionManagerConfig.defaultFilters.status),
        tags: safeText(extensionManagerConfig.defaultFilters.tags),
      };
      extensionTableState.sort = {
        key: safeText(extensionManagerConfig.defaultSortKey) || 'updatedAt',
        dir: safeText(extensionManagerConfig.defaultSortDir) || 'desc',
      };
    } catch (_) {
      extensionManagerConfig = {
        defaultFilters: {},
        defaultSortKey: 'updatedAt',
        defaultSortDir: 'desc',
      };
    }
  }

  async function saveExtensionManagerConfig() {
    try {
      await api('/api/develop/extensions-manager', {
        method: 'POST',
        body: JSON.stringify({
          defaultFilters: { ...extensionTableState.filters },
          defaultSortKey: extensionTableState.sort.key,
          defaultSortDir: extensionTableState.sort.dir,
        }),
      });
    } catch (_) {
      // Non-blocking UI preference persistence.
    }
  }

  function getExtensionTypeLabel(value) {
    return EXTENSION_TYPE_OPTIONS.find((item) => item.value === safeText(value))?.label || safeText(value) || '-';
  }

  function buildExtensionPath(id, map, seen = new Set()) {
    const cleanId = safeText(id);
    if (!cleanId || seen.has(cleanId)) return '';
    const item = map.get(cleanId);
    if (!item) return '';
    seen.add(cleanId);
    const parentPath = buildExtensionPath(item.parentId, map, seen);
    const name = safeText(item.name) || cleanId;
    return parentPath ? `${parentPath} / ${name}` : name;
  }

  function populateExtensionParentSelect(currentId) {
    const select = byId('developExtensionParentSelect');
    if (!select) return;
    const current = safeText(currentId);
    const map = new Map(savedExtensions.map((item) => [safeText(item.id), item]));
    const options = savedExtensions
      .filter((item) => safeText(item.id) && safeText(item.id) !== current)
      .map((item) => ({
        value: item.id,
        label: buildExtensionPath(item.id, map),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    setSelectOptions(select, options, 'Parent Extension (Optional)');
  }

  function resetExtensionManagerForm() {
    const form = byId('developExtensionManagerForm');
    if (form) form.reset();
    const idInput = byId('developExtensionIdInput');
    const statusSelect = byId('developExtensionStatusSelect');
    const submitBtn = byId('developExtensionSubmitBtn');
    if (idInput) idInput.value = '';
    if (statusSelect) statusSelect.value = 'active';
    if (submitBtn) submitBtn.textContent = 'Save Extension';
    populateExtensionParentSelect('');
  }

  function deriveExtensionSlug(name) {
    return safeText(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 160);
  }

  function applyExtensionToForm(item) {
    const idInput = byId('developExtensionIdInput');
    const nameInput = byId('developExtensionNameInput');
    const typeSelect = byId('developExtensionTypeSelect');
    const parentSelect = byId('developExtensionParentSelect');
    const statusSelect = byId('developExtensionStatusSelect');
    const tagsInput = byId('developExtensionTagsInput');
    const summaryInput = byId('developExtensionSummaryInput');
    const definitionInput = byId('developExtensionDefinitionInput');
    const submitBtn = byId('developExtensionSubmitBtn');
    if (idInput) idInput.value = safeText(item?.id);
    if (nameInput) nameInput.value = safeText(item?.name);
    if (typeSelect) typeSelect.value = safeText(item?.extensionType);
    populateExtensionParentSelect(safeText(item?.id));
    if (parentSelect) parentSelect.value = safeText(item?.parentId);
    if (statusSelect) statusSelect.value = safeText(item?.status) || 'active';
    if (tagsInput) tagsInput.value = safeText(item?.tags);
    if (summaryInput) summaryInput.value = safeText(item?.summary, 1000);
    if (definitionInput) definitionInput.value = safeText(item?.definition, 10000);
    if (submitBtn) submitBtn.textContent = 'Update Extension';
    App.setActivePage('developExtensionsManagerPage');
  }

  function sortExtensionsForLanding(rows) {
    return rows.slice().sort((a, b) => {
      const featuredDelta = (b.isFeatured === true ? 1 : 0) - (a.isFeatured === true ? 1 : 0);
      if (featuredDelta) return featuredDelta;
      const usageDelta = (Number(b.usageCount || 0) || 0) - (Number(a.usageCount || 0) || 0);
      if (usageDelta) return usageDelta;
      const left = new Date(b.lastUsedAt || b.updatedAt || 0).getTime();
      const right = new Date(a.lastUsedAt || a.updatedAt || 0).getTime();
      if (left !== right) return left - right;
      return safeText(a.name).localeCompare(safeText(b.name));
    });
  }

  async function openExtensionItem(item) {
    if (!item) return;
    try {
      if (safeText(item.id)) {
        await api(`/api/develop/extensions/${encodeURIComponent(item.id)}/use`, { method: 'POST' });
      }
    } catch (_) {
      // Non-blocking usage tracking.
    }
    await refresh();
    const launchPageId = safeText(item.launchPageId);
    if (launchPageId) {
      App.setActivePage(launchPageId);
      return;
    }
    applyExtensionToForm(item);
  }

  function renderExtensionsLanding() {
    const host = byId('developExtensionsFeaturedGrid');
    if (!host) return;
    host.innerHTML = '';
    if (!savedExtensions.length) {
      const empty = document.createElement('div');
      empty.className = 'messaging-content-node';
      empty.textContent = 'No extensions yet.';
      host.appendChild(empty);
      return;
    }

    const header = document.createElement('div');
    header.className = 'develop-extensions-header';
    ['Extension Name', 'Extension Type', 'Summary'].forEach((label) => {
      const cell = document.createElement('div');
      cell.className = 'develop-extensions-header-cell';
      cell.textContent = label;
      header.appendChild(cell);
    });
    host.appendChild(header);

    const byParent = new Map();
    savedExtensions.forEach((item) => {
      const parentKey = safeText(item.parentId) || 'root';
      if (!byParent.has(parentKey)) byParent.set(parentKey, []);
      byParent.get(parentKey).push(item);
    });

    const renderNode = (item, depth = 0) => {
      const id = safeText(item.id);
      const children = sortExtensionsForLanding(byParent.get(id) || []);
      const hasChildren = children.length > 0;
      const isCollapsed = hasChildren && collapsedExtensionIds.has(id);

      const row = document.createElement('div');
      row.className = 'develop-extension-table-row';

      const nameCell = document.createElement('div');
      nameCell.className = 'develop-extension-name-cell';
      nameCell.style.setProperty('--extension-depth', String(depth));

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = `develop-extension-tree-toggle${hasChildren ? '' : ' is-empty'}`;
      toggle.textContent = hasChildren ? (isCollapsed ? '▶' : '▼') : '▶';
      toggle.disabled = !hasChildren;
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!hasChildren) return;
        if (collapsedExtensionIds.has(id)) collapsedExtensionIds.delete(id);
        else collapsedExtensionIds.add(id);
        renderExtensionsLanding();
      });

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'develop-extension-name-link';
      button.addEventListener('click', () => {
        openExtensionItem(item).catch((err) => {
          notify(err.message, true);
        });
      });

      button.textContent = safeText(item.name) || 'Extension';

      const typeCell = document.createElement('div');
      typeCell.className = 'develop-extension-table-cell';
      typeCell.textContent = getExtensionTypeLabel(item.extensionType);

      const summaryCell = document.createElement('div');
      summaryCell.className = 'develop-extension-table-cell develop-extension-summary-cell';
      summaryCell.textContent = safeText(item.summary, 220) || 'Open extension';

      nameCell.appendChild(toggle);
      nameCell.appendChild(button);
      row.appendChild(nameCell);
      row.appendChild(typeCell);
      row.appendChild(summaryCell);

      return row;
    };

    const appendVisibleNodes = (item, depth = 0) => {
      const id = safeText(item.id);
      const children = sortExtensionsForLanding(byParent.get(id) || []);
      const hasChildren = children.length > 0;
      const isCollapsed = hasChildren && collapsedExtensionIds.has(id);
      host.appendChild(renderNode(item, depth));
      if (hasChildren && !isCollapsed) {
        children.forEach((child) => {
          appendVisibleNodes(child, depth + 1);
        });
      }
    };

    const roots = sortExtensionsForLanding(byParent.get('root') || []);
    roots.forEach((item) => {
      appendVisibleNodes(item, 0);
    });
  }

  function getFilteredSortedExtensions() {
    const map = new Map(savedExtensions.map((item) => [safeText(item.id), item]));
    const filters = extensionTableState.filters;
    const rows = savedExtensions
      .filter((item) => {
        const name = safeText(item.name).toLowerCase();
        const tags = safeText(item.tags).toLowerCase();
        const type = safeText(item.extensionType);
        const status = safeText(item.status);
        if (filters.name && !name.includes(filters.name.toLowerCase())) return false;
        if (filters.extensionType && type !== filters.extensionType) return false;
        if (filters.status && status !== filters.status) return false;
        if (filters.tags && !tags.includes(filters.tags.toLowerCase())) return false;
        return true;
      })
      .map((item) => ({
        ...item,
        taxonomyPath: buildExtensionPath(item.id, map),
      }));

    const { key, dir } = extensionTableState.sort;
    rows.sort((a, b) => {
      let left = '';
      let right = '';
      if (key === 'updatedAt') {
        left = new Date(a.updatedAt || 0).getTime();
        right = new Date(b.updatedAt || 0).getTime();
      } else if (key === 'taxonomyPath') {
        left = safeText(a.taxonomyPath).toLowerCase();
        right = safeText(b.taxonomyPath).toLowerCase();
      } else {
        left = safeText(a[key]).toLowerCase();
        right = safeText(b[key]).toLowerCase();
      }
      if (left < right) return dir === 'asc' ? -1 : 1;
      if (left > right) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }

  function renderExtensionsTable() {
    const tbody = byId('developExtensionsTableBody');
    const typeFilter = byId('developExtensionsFilterType');
    const nameFilter = byId('developExtensionsFilterName');
    const statusFilter = byId('developExtensionsFilterStatus');
    const tagsFilter = byId('developExtensionsFilterTags');
    if (!tbody) return;
    if (nameFilter) nameFilter.value = extensionTableState.filters.name;
    if (typeFilter) {
      setSelectOptions(typeFilter, EXTENSION_TYPE_OPTIONS, 'All Types', extensionTableState.filters.extensionType);
    }
    if (statusFilter) statusFilter.value = extensionTableState.filters.status;
    if (tagsFilter) tagsFilter.value = extensionTableState.filters.tags;

    tbody.innerHTML = '';
    const rows = getFilteredSortedExtensions();
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No extensions yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    rows.forEach((item) => {
      const row = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = safeText(item.name) || '-';

      const typeTd = document.createElement('td');
      typeTd.textContent = getExtensionTypeLabel(item.extensionType);

      const pathTd = document.createElement('td');
      pathTd.textContent = safeText(item.taxonomyPath) || '-';

      const statusTd = document.createElement('td');
      statusTd.textContent = safeText(item.status) || '-';

      const updatedTd = document.createElement('td');
      updatedTd.textContent = item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-';

      const actionsTd = document.createElement('td');
      const viewBtn = App.makeIconButton('view', 'Open Extension', () => {
        openExtensionItem(item).catch((err) => {
          notify(err.message, true);
        });
      });
      const editBtn = App.makeIconButton('edit', 'Edit Extension', () => {
        applyExtensionToForm(item);
        notify(`Loaded extension: ${safeText(item.name) || item.id}`);
      }, { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Extension', async () => {
        if (!window.confirm(`Delete extension "${safeText(item.name) || item.id}"?`)) return;
        try {
          await api(`/api/develop/extensions/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          await refresh();
          notify('Extension deleted');
          resetExtensionManagerForm();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);

      row.appendChild(nameTd);
      row.appendChild(typeTd);
      row.appendChild(pathTd);
      row.appendChild(statusTd);
      row.appendChild(updatedTd);
      row.appendChild(actionsTd);
      tbody.appendChild(row);
    });
  }

  function getLandingPageFormPayload(formData) {
    const landingPageId = safeText(formData.get('landing_page_id'));
    const existing = savedLandingPages.find((item) => safeText(item.id) === landingPageId) || null;
    return {
      name: safeText(formData.get('landing_page_name')),
      templateId: safeText(formData.get('template_id')) || selectedTemplateId,
      primaryColor: landingPageColors.primary,
      backgroundColor: landingPageColors.background,
      accentColor: landingPageColors.accent,
      formId: safeText(formData.get('form_id')),
      leadMagnetId: safeText(formData.get('lead_magnet_id')),
      headlineId: safeText(formData.get('headline_id')),
      pitchId: safeText(formData.get('pitch_id')),
      ctaId: safeText(formData.get('cta_id')),
      websiteBannerImageId: safeText(formData.get('website_banner_image_id')),
      backgroundImageId: safeText(formData.get('background_image_id')),
      featureImageId: safeText(formData.get('feature_image_id')),
      highlightImageId: safeText(formData.get('highlight_image_id')),
      featureHeadlineId: safeText(formData.get('feature_headline_id')),
      featureSubheadingId: safeText(formData.get('feature_subheading_id')),
      featureTitle: safeText(formData.get('feature_title'), 500),
      featureCopy: safeText(formData.get('feature_copy'), 5000),
      highlightHeadlineId: safeText(formData.get('highlight_headline_id')),
      highlightPitchId: safeText(formData.get('highlight_pitch_id')),
      highlightTitle: safeText(formData.get('highlight_title'), 500),
      highlightCopy: safeText(formData.get('highlight_copy'), 5000),
      bodyHeadlineId: safeText(formData.get('body_headline_id')),
      bodySubheadingId: safeText(formData.get('body_subheading_id')),
      bodyPitchId: safeText(formData.get('body_pitch_id')),
      logoWideId: safeText(formData.get('logo_wide_id')),
      logoSquareId: safeText(formData.get('logo_square_id')),
      contentOverrides: normalizeLandingPageContentOverrides(existing?.contentOverrides),
    };
  }

  function getLandingPageTemplateName(templateId) {
    return getTemplateById(templateId).name;
  }

  function getLandingPageFieldRows(key) {
    const fieldKey = safeText(key);
    if (fieldKey === 'formId') return savedForms.slice();
    if (fieldKey === 'leadMagnetId') return getAssetsByType('Lead Magnet');
    if (fieldKey === 'headlineId' || fieldKey === 'featureHeadlineId' || fieldKey === 'highlightHeadlineId' || fieldKey === 'bodyHeadlineId') {
      return landingPageHeadlines.slice();
    }
    if (fieldKey === 'featureSubheadingId' || fieldKey === 'bodySubheadingId') {
      return landingPageSubheadings.slice();
    }
    if (fieldKey === 'pitchId' || fieldKey === 'highlightPitchId' || fieldKey === 'bodyPitchId') {
      return landingPagePitches.slice();
    }
    if (fieldKey === 'ctaId') return landingPageCtas.slice();
    if (fieldKey === 'websiteBannerImageId') {
      return getAssetsByCategoryAliases(
        ['Banner Image', 'Website Banner', 'Website Banner Image', 'Hero Banner', 'Article Banner'],
        'Image'
      );
    }
    if (fieldKey === 'backgroundImageId') {
      return getAssetsByCategoryAliases(['Background Image'], 'Image');
    }
    if (fieldKey === 'featureImageId') {
      return getAssetsByCategoryAliases(['Feature Image', 'Feature', 'Feature Graphic', 'Featured Image'], 'Image');
    }
    if (fieldKey === 'highlightImageId') {
      return getAssetsByCategoryAliases(['Highlight Image', 'Highlight'], 'Image');
    }
    if (fieldKey === 'logoSquareId') {
      return getAssetsByCategoryAliases(['Logo - Square', 'Square Logo'], 'Image');
    }
    return [];
  }

  function getLandingPageFieldOptionLabel(key, row) {
    const fieldKey = safeText(key);
    if (fieldKey === 'formId') {
      return safeText(row?.name) || getFormTemplateById(row?.formType).name;
    }
    if (fieldKey === 'headlineId' || fieldKey === 'featureHeadlineId' || fieldKey === 'highlightHeadlineId' || fieldKey === 'bodyHeadlineId') {
      return safeText(row?.headline) || `Headline ${safeText(row?.id)}`;
    }
    if (fieldKey === 'featureSubheadingId' || fieldKey === 'bodySubheadingId') {
      return safeText(row?.subheading) || `Sub-heading ${safeText(row?.id)}`;
    }
    if (fieldKey === 'pitchId' || fieldKey === 'highlightPitchId' || fieldKey === 'bodyPitchId') {
      return safeText(row?.pitch) || `Pitch ${safeText(row?.id)}`;
    }
    if (fieldKey === 'ctaId') {
      return safeText(row?.cta) || `CTA ${safeText(row?.id)}`;
    }
    return assetLabel(row, `Item ${safeText(row?.id)}`);
  }

  function getLandingPageFieldFilterMeta(key) {
    const fieldKey = safeText(key);
    if (fieldKey === 'formId') {
      return {
        placeholder: 'All Form Types',
        label: 'Form Type Filter',
        getValue: (row) => safeText(row?.formType),
        getLabel: (value) => getFormTemplateById(value).name,
      };
    }
    if ([
      'leadMagnetId',
      'headlineId',
      'featureHeadlineId',
      'highlightHeadlineId',
      'bodyHeadlineId',
      'featureSubheadingId',
      'bodySubheadingId',
      'pitchId',
      'highlightPitchId',
      'bodyPitchId',
      'ctaId',
      'websiteBannerImageId',
      'backgroundImageId',
      'featureImageId',
      'highlightImageId',
      'logoSquareId',
    ].includes(fieldKey)) {
      return {
        placeholder: 'All Categories',
        label: 'Category Filter',
        getValue: (row) => safeText(row?.category),
        getLabel: (value) => value || 'Uncategorized',
      };
    }
    return null;
  }

  function getLandingPageDefaultSelectorFilters() {
    try {
      const raw = window.localStorage.getItem(LANDING_SELECTOR_DEFAULTS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function getLandingPageFilterState(fieldKey) {
    const key = safeText(fieldKey);
    if (!landingPageSelectorFilterState[key]) {
      const defaults = getLandingPageDefaultSelectorFilters();
      const saved = defaults && typeof defaults[key] === 'object' ? defaults[key] : {};
      if (key === 'formId') {
        landingPageSelectorFilterState[key] = {
          formType: safeText(saved.formType),
        };
      } else if ([
        'leadMagnetId',
        'websiteBannerImageId',
        'backgroundImageId',
        'featureImageId',
        'highlightImageId',
        'logoSquareId',
      ].includes(key)) {
        landingPageSelectorFilterState[key] = {
          asset_name: safeText(saved.asset_name),
          asset_type: safeText(saved.asset_type),
          category: safeText(saved.category),
          tags: safeText(saved.tags),
        };
      } else if (getLandingPageFieldFilterMeta(key)) {
        landingPageSelectorFilterState[key] = {
          category: safeText(saved.category),
        };
      } else {
        landingPageSelectorFilterState[key] = {};
      }
    }
    return landingPageSelectorFilterState[key];
  }

  function saveLandingPageSelectorDefaults() {
    try {
      window.localStorage.setItem(LANDING_SELECTOR_DEFAULTS_KEY, JSON.stringify(landingPageSelectorFilterState));
      notify('Selector defaults saved');
    } catch {
      notify('Could not save selector defaults', true);
    }
  }

  function getLandingPageVisualEditorOptions(key, filterValue = '') {
    if (safeText(key) === 'templateId') {
      return LANDING_TEMPLATES.map((template) => ({ value: template.id, label: template.name }));
    }
    const rows = getLandingPageFieldRows(key);
    const meta = getLandingPageFieldFilterMeta(key);
    const state = (filterValue && typeof filterValue === 'object')
      ? filterValue
      : { category: safeText(filterValue) };
    const filteredRows = rows.filter((row) => {
      if (state.asset_name) {
        const name = assetLabel(row, '').toLowerCase();
        if (!name.includes(String(state.asset_name).trim().toLowerCase())) return false;
      }
      if (state.asset_type && safeText(row?.assetType) !== safeText(state.asset_type)) {
        return false;
      }
      if (state.tags) {
        const tagText = Array.isArray(row?.tags) ? row.tags.join(', ').toLowerCase() : '';
        if (!tagText.includes(String(state.tags).trim().toLowerCase())) return false;
      }
      if (state.formType && safeText(row?.formType) !== safeText(state.formType)) {
        return false;
      }
      if (state.category && meta && safeText(meta.getValue(row)) !== safeText(state.category)) {
        return false;
      }
      return true;
    });
    return filteredRows.map((row) => ({
      value: row.id,
      label: getLandingPageFieldOptionLabel(key, row),
    }));
  }

  function clearLandingPageSelectorFilters() {
    Object.keys(landingPageSelectorFilterState).forEach((key) => {
      delete landingPageSelectorFilterState[key];
    });
  }

  function ensureLandingPageFieldFilterSelect(select, fieldKey) {
    if (!select) return null;
    const key = safeText(fieldKey);
    const wrapId = `${select.id}FilterWrap`;
    const existingWrap = byId(wrapId);
    if (isLandingImageFieldKey(key)) {
      if (existingWrap) existingWrap.remove();
      return null;
    }
    const meta = getLandingPageFieldFilterMeta(key);
    const state = getLandingPageFilterState(key);
    let wrap = byId(wrapId);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = wrapId;
      wrap.className = 'develop-selector-filter-wrap';
      wrap.dataset.filterFor = select.id;
      select.parentNode.insertBefore(wrap, select);
    }
    wrap.innerHTML = '';

    const rerender = () => {
      renderLandingPageBuilderSelect(select.id, key, select.dataset.placeholder || select.options[0]?.textContent || '');
    };

    if ([
      'leadMagnetId',
      'websiteBannerImageId',
      'backgroundImageId',
      'featureImageId',
      'highlightImageId',
      'logoSquareId',
    ].includes(key)) {
      const rows = getLandingPageFieldRows(key);
      const typeValues = Array.from(new Set(rows.map((row) => safeText(row?.assetType)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      const categoryValues = Array.from(new Set(rows.map((row) => safeText(row?.category)).filter(Boolean))).sort((a, b) => a.localeCompare(b));

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Filter: Asset Name';
      nameInput.value = safeText(state.asset_name);
      nameInput.addEventListener('input', () => {
        state.asset_name = safeText(nameInput.value);
        rerender();
      });
      wrap.appendChild(nameInput);

      const typeSelect = document.createElement('select');
      setSelectOptions(
        typeSelect,
        typeValues.map((value) => ({ value, label: value })),
        'All Asset Types',
        state.asset_type
      );
      typeSelect.addEventListener('change', () => {
        state.asset_type = safeText(typeSelect.value);
        rerender();
      });
      wrap.appendChild(typeSelect);

      const categorySelect = document.createElement('select');
      setSelectOptions(
        categorySelect,
        categoryValues.map((value) => ({ value, label: value })),
        'All Categories',
        state.category
      );
      categorySelect.addEventListener('change', () => {
        state.category = safeText(categorySelect.value);
        rerender();
      });
      wrap.appendChild(categorySelect);

      const tagsInput = document.createElement('input');
      tagsInput.type = 'text';
      tagsInput.placeholder = 'Filter: Tags';
      tagsInput.value = safeText(state.tags);
      tagsInput.addEventListener('input', () => {
        state.tags = safeText(tagsInput.value);
        rerender();
      });
      wrap.appendChild(tagsInput);
      return wrap;
    }

    if (key === 'formId') {
      const typeSelect = document.createElement('select');
      const values = Array.from(new Set(savedForms.map((row) => safeText(row?.formType)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      setSelectOptions(
        typeSelect,
        values.map((value) => ({ value, label: getFormTemplateById(value).name })),
        'All Form Types',
        state.formType
      );
      typeSelect.addEventListener('change', () => {
        state.formType = safeText(typeSelect.value);
        rerender();
      });
      wrap.appendChild(typeSelect);
      return wrap;
    }

    if (meta) {
      const categorySelect = document.createElement('select');
      const rows = getLandingPageFieldRows(key);
      const values = Array.from(new Set(rows.map((row) => safeText(meta.getValue(row))).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      setSelectOptions(
        categorySelect,
        values.map((value) => ({ value, label: meta.getLabel(value) })),
        meta.placeholder,
        state.category
      );
      categorySelect.addEventListener('change', () => {
        state.category = safeText(categorySelect.value);
        rerender();
      });
      wrap.appendChild(categorySelect);
      return wrap;
    }

    return null;
  }

  function renderLandingPageBuilderSelect(selectId, fieldKey, placeholder) {
    const select = byId(selectId);
    if (!select) return;
    select.dataset.placeholder = placeholder;
    const currentValue = safeText(select.value);
    ensureLandingPageFieldFilterSelect(select, fieldKey);
    if (isLandingImageSelectId(selectId)) {
      renderLandingAssetSelect(selectId, currentValue, placeholder);
      return;
    }
    setSelectOptions(
      select,
      getLandingPageVisualEditorOptions(fieldKey, getLandingPageFilterState(fieldKey)),
      placeholder,
      currentValue
    );
  }

  function getSavedFormName(formId) {
    const id = safeText(formId);
    if (!id) return '';
    const match = savedForms.find((form) => safeText(form.id) === id);
    return match ? (safeText(match.name) || getFormTemplateById(match.formType).name) : '';
  }

  function getLandingMessageLabel(rows, id, field, fallbackPrefix) {
    const targetId = safeText(id);
    if (!targetId) return '';
    const match = (Array.isArray(rows) ? rows : []).find((item) => safeText(item.id) === targetId);
    return match ? (safeText(match[field]) || `${fallbackPrefix} ${targetId}`) : '';
  }

  function getLandingPageHeadlineLabel(headlineId) {
    return getLandingMessageLabel(landingPageHeadlines, headlineId, 'headline', 'Headline');
  }

  function getLandingPageSubheadingLabel(subheadingId) {
    return getLandingMessageLabel(landingPageSubheadings, subheadingId, 'subheading', 'Sub-heading');
  }

  function getLandingPagePitchLabel(pitchId) {
    return getLandingMessageLabel(landingPagePitches, pitchId, 'pitch', 'Pitch');
  }

  function getLandingPageCtaLabel(ctaId) {
    return getLandingMessageLabel(landingPageCtas, ctaId, 'cta', 'CTA');
  }

  function getAssetById(assetId) {
    const targetId = safeText(assetId);
    if (!targetId) return null;
    return (Array.isArray(state.assets) ? state.assets : []).find((asset) => safeText(asset?.id) === targetId) || null;
  }

  function getLandingPageAssetUrl(assetId) {
    const candidates = getLandingPageAssetUrlCandidates(assetId);
    return candidates[0] || '';
  }

  function getLandingPageAssetUrlCandidates(assetId) {
    const asset = getAssetById(assetId);
    if (!asset) return [];
    const location = safeText(asset.location);
    const driveId = extractDriveId(location);
    const urls = [];
    if (driveId && safeText(asset.assetType) === 'Image') {
      urls.push(`/api/assets/drive-file/${encodeURIComponent(driveId)}`);
      urls.push(`https://drive.google.com/uc?export=view&id=${encodeURIComponent(driveId)}`);
      urls.push(`https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w2400`);
    }
    const direct = toDirectAssetUrl(location);
    if (direct) urls.push(direct);
    if (location) urls.push(location);
    return Array.from(new Set(urls.filter(Boolean)));
  }

  function buildLandingAssetImage(assetId, altText, className = '') {
    const candidates = getLandingPageAssetUrlCandidates(assetId);
    if (!candidates.length) return '';
    const primary = candidates[0];
    const fallbackSrcs = candidates.slice(1);
    const classAttr = className ? ` class="${className}"` : '';
    const fallbackAttr = fallbackSrcs.length
      ? ` data-fallback-srcs="${encodeURIComponent(JSON.stringify(fallbackSrcs))}" data-fallback-idx="0"`
      : '';
    return `<img src="${primary}" alt="${safeText(altText)}"${classAttr}${fallbackAttr} />`;
  }

  function bindLandingImageFallbacks(host) {
    if (!host) return;
    host.querySelectorAll('img[data-fallback-srcs]').forEach((img) => {
      if (img.dataset.fallbackBound === '1') return;
      img.dataset.fallbackBound = '1';
      img.addEventListener('error', () => {
        let fallbacks = [];
        try {
          const raw = decodeURIComponent(safeText(img.dataset.fallbackSrcs));
          const parsed = JSON.parse(raw);
          fallbacks = Array.isArray(parsed) ? parsed.map((item) => safeText(item)).filter(Boolean) : [];
        } catch (_) {
          fallbacks = [];
        }
        const idx = Math.max(0, Number(img.dataset.fallbackIdx || 0) || 0);
        if (idx >= fallbacks.length) return;
        img.dataset.fallbackIdx = String(idx + 1);
        img.src = fallbacks[idx];
      });
    });
  }

  function getLandingPageAssetName(assetId, fallbackLabel) {
    const asset = getAssetById(assetId);
    return assetLabel(asset, fallbackLabel);
  }

  async function ensureAssetsLoaded() {
    if (Array.isArray(state.assets) && state.assets.length) return;
    const result = await api('/api/assets');
    state.assets = Array.isArray(result?.assets) ? result.assets : [];
  }

  function normalizeLandingPageContentOverrides(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) {
      const next = {};
      Object.entries(value).forEach(([key, raw]) => {
        const cleanKey = safeText(key, 120);
        if (!cleanKey) return;
        next[cleanKey] = safeText(raw, 10000);
      });
      return next;
    }
    if (typeof value === 'string') {
      try {
        return normalizeLandingPageContentOverrides(JSON.parse(value));
      } catch (_) {
        return {};
      }
    }
    return {};
  }

  function getLandingPageMergedContentOverrides(record) {
    const base = normalizeLandingPageContentOverrides(record?.contentOverrides);
    const draft = normalizeLandingPageContentOverrides(landingPageVisualDraft.contentOverrides);
    return {
      ...base,
      ...draft,
    };
  }

  const LANDING_TEXT_SCALE_OPTIONS = ['0.80', '0.90', '1.00', '1.10', '1.20'];

  function getLandingPageTextStyleKey(slot) {
    return `__style__${safeText(slot)}`;
  }

  function parseLandingPageTextStyle(value) {
    if (!value) return { fontScale: '1.00', sizeToFit: false };
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      const scale = LANDING_TEXT_SCALE_OPTIONS.includes(String(parsed?.fontScale || ''))
        ? String(parsed.fontScale)
        : '1.00';
      return {
        fontScale: scale,
        sizeToFit: parsed?.sizeToFit === true,
      };
    } catch {
      return { fontScale: '1.00', sizeToFit: false };
    }
  }

  function getLandingPageTextStyle(record, slot) {
    const overrides = getLandingPageMergedContentOverrides(record);
    return parseLandingPageTextStyle(overrides[getLandingPageTextStyleKey(slot)]);
  }

  function setLandingPageTextStyle(slot, nextStyle) {
    const overrides = getLandingPageMergedContentOverrides(getActiveLandingPageVisualRecord());
    const current = getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot);
    const merged = {
      fontScale: LANDING_TEXT_SCALE_OPTIONS.includes(String(nextStyle?.fontScale || ''))
        ? String(nextStyle.fontScale)
        : current.fontScale,
      sizeToFit: nextStyle?.sizeToFit === true,
    };
    overrides[getLandingPageTextStyleKey(slot)] = JSON.stringify(merged);
    landingPageVisualDraft.contentOverrides = overrides;
  }

  function buildLandingPageTextAttrs(record, slot, extraStyle = '') {
    const textStyle = getLandingPageTextStyle(record, slot);
    const styles = [];
    if (extraStyle) styles.push(extraStyle);
    if (textStyle.fontScale && textStyle.fontScale !== '1.00') {
      styles.push(`font-size:${Number(textStyle.fontScale).toFixed(2)}em;`);
    }
    const styleAttr = styles.length ? ` style="${styles.join(' ')}"` : '';
    return ` data-text-slot="${slot}" data-size-to-fit="${textStyle.sizeToFit ? '1' : '0'}"${styleAttr}`;
  }

  function setLandingPageContentOverride(slot, value) {
    const overrides = getLandingPageMergedContentOverrides(getActiveLandingPageVisualRecord());
    const nextValue = safeText(value, 10000);
    if (nextValue) {
      overrides[slot] = nextValue;
    } else {
      delete overrides[slot];
    }
    landingPageVisualDraft.contentOverrides = overrides;
  }

  function getLandingPageTextSlotFieldKey(slot) {
    return {
    }[safeText(slot)] || '';
  }

  function getLandingPageSlotSelectSpec(slot) {
    return {
      'feature-one-title': { fieldKey: 'featureHeadlineId', label: 'Feature One Headline', placeholder: 'No Headline' },
      'feature-one-copy': { fieldKey: 'featureSubheadingId', label: 'Feature One Sub-heading', placeholder: 'No Sub-heading' },
      'feature-two-title': { fieldKey: 'highlightHeadlineId', label: 'Feature Two Headline', placeholder: 'No Headline' },
      'feature-two-copy': { fieldKey: 'highlightPitchId', label: 'Feature Two Pitch', placeholder: 'No Pitch' },
      'body-title': { fieldKey: 'bodyHeadlineId', label: 'Body Headline', placeholder: 'No Headline' },
      'body-lead': { fieldKey: 'bodySubheadingId', label: 'Body Sub-heading', placeholder: 'No Sub-heading' },
      'body-copy': { fieldKey: 'bodyPitchId', label: 'Body Pitch', placeholder: 'No Pitch' },
    }[safeText(slot)] || null;
  }

  function getLandingPageEditorId(key, slot) {
    const cleanKey = safeText(key);
    const cleanSlot = safeText(slot);
    return cleanSlot ? `${cleanKey}::${cleanSlot}` : cleanKey;
  }

  function parseLandingPageEditorId(editorId) {
    const [key, slot] = safeText(editorId).split('::');
    return {
      key: safeText(key),
      slot: safeText(slot),
    };
  }

  function getLandingPagePreviewContext(record) {
    const template = getTemplateById(record?.templateId);
    const overrides = getLandingPageMergedContentOverrides(record);
    const headline = overrides.headline || getLandingPageHeadlineLabel(record?.headlineId) || template.headline;
    const pitch = overrides.pitch || getLandingPagePitchLabel(record?.pitchId) || template.lead;
    const cta = overrides['primary-cta'] || getLandingPageCtaLabel(record?.ctaId) || template.primaryCta;
    const form = savedForms.find((item) => safeText(item.id) === safeText(record?.formId)) || null;
    const formFields = Array.isArray(form?.fields) && form.fields.length
      ? form.fields
      : [
          { key: 'first_name', label: 'First Name', type: 'text', required: true },
          { key: 'email', label: 'Email', type: 'email', required: true },
          { key: 'company', label: 'Company', type: 'text', required: false },
        ];

    return {
      template,
      overrides,
      headline,
      pitch,
      cta,
      form,
      formFields,
      bannerUrl: getLandingPageAssetUrl(record?.websiteBannerImageId),
      backgroundUrl: getLandingPageAssetUrl(record?.backgroundImageId),
      featureUrl: getLandingPageAssetUrl(record?.featureImageId),
      highlightUrl: getLandingPageAssetUrl(record?.highlightImageId),
      logoWideUrl: getLandingPageAssetUrl(record?.logoWideId),
      logoSquareUrl: getLandingPageAssetUrl(record?.logoSquareId),
      primaryColor: safeText(record?.primaryColor) || DEFAULT_LANDING_PRIMARY,
      backgroundColor: safeText(record?.backgroundColor) || DEFAULT_LANDING_BACKGROUND,
      accentColor: safeText(record?.accentColor) || DEFAULT_LANDING_ACCENT,
      eyebrow: overrides.eyebrow || template.eyebrow,
      secondaryCta: overrides['secondary-cta'] || template.secondaryCta,
      featureOneTitle: getLandingPageHeadlineLabel(record?.featureHeadlineId) || safeText(record?.featureTitle, 500) || overrides['feature-one-title'] || template.featureOneTitle,
      featureOneCopy: getLandingPageSubheadingLabel(record?.featureSubheadingId) || safeText(record?.featureCopy, 5000) || overrides['feature-one-copy'] || template.featureOneCopy,
      featureTwoTitle: getLandingPageHeadlineLabel(record?.highlightHeadlineId) || safeText(record?.highlightTitle, 500) || overrides['feature-two-title'] || template.featureTwoTitle,
      featureTwoCopy: getLandingPagePitchLabel(record?.highlightPitchId) || safeText(record?.highlightCopy, 5000) || overrides['feature-two-copy'] || template.featureTwoCopy,
      formTitle: overrides['form-heading'] || safeText(form?.heading) || template.formTitle,
      formCopy: overrides['form-copy'] || template.formCopy,
      formSubmitLabel: overrides['form-submit'] || safeText(form?.submitLabel) || 'Submit Form',
      bodyTitle: getLandingPageHeadlineLabel(record?.bodyHeadlineId) || overrides['body-title'] || template.bodyTitle,
      bodyLead: getLandingPageSubheadingLabel(record?.bodySubheadingId) || overrides['body-lead'] || template.lead,
      bodyCopy: getLandingPagePitchLabel(record?.bodyPitchId) || overrides['body-copy'] || template.featureOneCopy,
    };
  }

  function buildLandingPageMarkup(record, options = {}) {
    if (!record) return '';
    const {
      interactive = false,
      editableClass = 'develop-landing-editable',
    } = options;
        const ctx = getLandingPagePreviewContext(record);
    const attr = (key, label, slot = '') => (
      interactive
        ? ` data-edit-key="${key}" data-edit-label="${label}"${slot ? ` data-edit-slot="${slot}"` : ''}`
        : ''
    );
    const editable = (baseClass = '') => {
      const classes = [];
      if (baseClass) classes.push(baseClass);
      if (interactive) classes.push(editableClass);
      return classes.length ? ` class="${classes.join(' ')}"` : '';
    };
    const runtimeFieldMarkup = ctx.formFields.map((field, index) => {
      const fieldType = safeText(field?.type) || 'text';
      const fieldLabel = safeText(field?.label) || 'Field';
      const fieldKey = safeText(field?.key) || `field_${index}`;
      const required = Boolean(field?.required);
      return `<input name="${fieldKey}" type="${fieldType}" placeholder="${fieldLabel}${required ? ' *' : ''}"${required ? ' required' : ''}${editable()}${attr('formId', 'Form', 'form-fields')} />`;
    }).join('');

    return `
        <div class="develop-template-canvas">
          <div${editable('develop-template-banner')}${attr('websiteBannerImageId', 'Website Banner Image', 'banner')}>${
          ctx.bannerUrl
            ? buildLandingAssetImage(record.websiteBannerImageId, getLandingPageAssetName(record.websiteBannerImageId, 'Page Banner Image'), 'develop-template-banner-img')
            : getLandingPageAssetName(record.websiteBannerImageId, 'Page Banner Image')
        }</div>
        <div class="develop-template-hero" style="background:${ctx.backgroundColor};">
          <div class="develop-template-copy">
            <div${editable('develop-template-eyebrow')}${attr('theme', 'Theme', 'eyebrow')}${buildLandingPageTextAttrs(record, 'eyebrow', `color:${ctx.accentColor};`)}>${ctx.eyebrow}</div>
            <h3${editable()}${attr('headlineId', 'Headline', 'headline')}${buildLandingPageTextAttrs(record, 'headline', `color:${ctx.primaryColor};`)}>${ctx.headline}</h3>
            <p${editable()}${attr('pitchId', 'Pitch', 'pitch')}${buildLandingPageTextAttrs(record, 'pitch')}>${ctx.pitch}</p>
            <div class="develop-template-cta-row">
              <button type="button"${editable()}${attr('ctaId', 'Call To Action', 'primary-cta')}${buildLandingPageTextAttrs(record, 'primary-cta', `background:${ctx.primaryColor}; border-color:${ctx.primaryColor};`)}>${ctx.cta}</button>
              <button type="button"${editable('develop-template-secondary-btn')}${attr('theme', 'Theme', 'secondary-cta')}${buildLandingPageTextAttrs(record, 'secondary-cta', `border-color:${ctx.accentColor}; color:${ctx.accentColor};`)}>${ctx.secondaryCta}</button>
            </div>
            <div class="develop-template-feature-grid">
              <div class="develop-template-feature-card">
                <div${editable('develop-template-image-slot')}${attr('featureImageId', 'Feature Image', 'feature-image')}>${
                  ctx.featureUrl
                    ? buildLandingAssetImage(record.featureImageId, getLandingPageAssetName(record.featureImageId, 'Feature Image'))
                    : getLandingPageAssetName(record.featureImageId, 'Feature Image')
                }</div>
                <h4${editable()}${attr('theme', 'Theme', 'feature-one-title')}${buildLandingPageTextAttrs(record, 'feature-one-title')}>${ctx.featureOneTitle}</h4>
                <p${editable()}${attr('theme', 'Theme', 'feature-one-copy')}${buildLandingPageTextAttrs(record, 'feature-one-copy')}>${ctx.featureOneCopy}</p>
              </div>
              <div class="develop-template-feature-card">
                <div${editable('develop-template-image-slot')}${attr('highlightImageId', 'Highlight Image', 'highlight-image')}>${
                  ctx.highlightUrl
                    ? buildLandingAssetImage(record.highlightImageId, getLandingPageAssetName(record.highlightImageId, 'Highlight Image'))
                    : getLandingPageAssetName(record.highlightImageId, 'Highlight Image')
                }</div>
                <h4${editable()}${attr('theme', 'Theme', 'feature-two-title')}${buildLandingPageTextAttrs(record, 'feature-two-title')}>${ctx.featureTwoTitle}</h4>
                <p${editable()}${attr('theme', 'Theme', 'feature-two-copy')}${buildLandingPageTextAttrs(record, 'feature-two-copy')}>${ctx.featureTwoCopy}</p>
              </div>
            </div>
          </div>
          <aside${editable('develop-template-form-card')}${attr('formId', 'Form', 'form-card')}>
            <div class="develop-template-logo-row">
              <div${editable('develop-template-logo-slot develop-template-logo-square')}${attr('logoSquareId', 'Logo - Square', 'logo-square')}>${
                ctx.logoSquareUrl
                  ? buildLandingAssetImage(record.logoSquareId, 'Logo - Square')
                  : 'Logo - Square'
              }</div>
            </div>
            <form class="develop-template-runtime-form${interactive ? ' develop-template-runtime-form-disabled' : ''}" data-landing-page-id="${safeText(record.id)}" data-form-id="${safeText(record.formId)}">
              <h3${editable()}${attr('formId', 'Form', 'form-heading')}${buildLandingPageTextAttrs(record, 'form-heading', `color:${ctx.accentColor};`)}>${ctx.formTitle}</h3>
              <p${editable()}${attr('formId', 'Form', 'form-copy')}${buildLandingPageTextAttrs(record, 'form-copy')}>${ctx.formCopy}</p>
              ${runtimeFieldMarkup}
              <button type="${interactive ? 'button' : 'submit'}"${editable()}${attr('formId', 'Form', 'form-submit')}${buildLandingPageTextAttrs(record, 'form-submit', `background:${ctx.primaryColor}; border-color:${ctx.primaryColor};`)}>${ctx.formSubmitLabel}</button>
              <div class="develop-template-form-status" aria-live="polite"></div>
            </form>
          </aside>
        </div>
        <div class="develop-template-content">
          <div class="develop-template-body-copy">
            <h3${editable()}${attr('theme', 'Theme', 'body-title')}${buildLandingPageTextAttrs(record, 'body-title')}>${ctx.bodyTitle}</h3>
            <p${editable()}${attr('theme', 'Theme', 'body-lead')}${buildLandingPageTextAttrs(record, 'body-lead')}>${ctx.bodyLead}</p>
            <p${editable()}${attr('theme', 'Theme', 'body-copy')}${buildLandingPageTextAttrs(record, 'body-copy')}>${ctx.bodyCopy}</p>
          </div>
          <div${editable('develop-template-side-image')}${attr('backgroundImageId', 'Background Image', 'background-image')}>${
            ctx.backgroundUrl
              ? buildLandingAssetImage(record.backgroundImageId, getLandingPageAssetName(record.backgroundImageId, 'Background Image / Supporting Visual'))
              : getLandingPageAssetName(record.backgroundImageId, 'Background Image / Supporting Visual')
          }</div>
        </div>
      </div>
    `;
  }

  function bindLandingPageRuntimeForms(host, record) {
    if (!host || !record) return;
    const formConfig = savedForms.find((item) => safeText(item.id) === safeText(record.formId)) || null;
    const leadMagnetId = safeText(formConfig?.leadMagnetId) || safeText(record?.leadMagnetId);
    const leadMagnetAsset = getAssetById(leadMagnetId);
    const leadMagnetUrl = leadMagnetAsset ? toDirectAssetUrl(leadMagnetAsset.location) : '';
    host.querySelectorAll('.develop-template-runtime-form').forEach((form) => {
      const submitButton = form.querySelector('button[type="submit"]');
      const status = form.querySelector('.develop-template-form-status');
      if (!submitButton) return;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submitButton.disabled = true;
        if (status) {
          status.textContent = 'Submitting...';
          status.classList.remove('is-error', 'is-success');
        }
        try {
          const formData = new FormData(form);
          const fields = {};
          formData.forEach((value, key) => {
            fields[String(key)] = String(value || '').trim();
          });
          await api(`/api/develop/landing-pages/${encodeURIComponent(record.id)}/submit`, {
            method: 'POST',
            body: JSON.stringify({
              formId: safeText(record.formId),
              fields,
            }),
          });
          form.reset();
          if (status) {
            status.textContent = safeText(formConfig?.successMessage) || 'Contact saved.';
            status.classList.remove('is-error');
            status.classList.add('is-success');
          }
          openLandingPageThankYouPage({
            title: 'Thank You',
            message: safeText(formConfig?.successMessage) || 'Thank you. Your request has been received.',
            leadMagnetUrl,
            leadMagnetId: leadMagnetAsset ? safeText(leadMagnetAsset.id) : '',
            landingPageId: safeText(record.id),
            leadMagnetLabel: leadMagnetAsset ? `Download ${assetLabel(leadMagnetAsset, 'Lead Magnet')}` : 'Open Lead Magnet',
          });
        } catch (err) {
          if (status) {
            status.textContent = safeText(formConfig?.errorMessage) || err.message || 'Could not save contact';
            status.classList.remove('is-success');
            status.classList.add('is-error');
          }
        } finally {
          submitButton.disabled = false;
        }
      });
    });
  }

  function getActiveLandingPageVisualRecord() {
    if (!activeLandingPageVisualRecord) return null;
    const baseOverrides = normalizeLandingPageContentOverrides(activeLandingPageVisualRecord.contentOverrides);
    const draftOverrides = normalizeLandingPageContentOverrides(landingPageVisualDraft.contentOverrides);
    return {
      ...activeLandingPageVisualRecord,
      ...landingPageVisualDraft,
      contentOverrides: {
        ...baseOverrides,
        ...draftOverrides,
      },
    };
  }

  function getLandingPageVisualEditorTitle(key) {
    return {
      theme: 'Theme',
      headlineId: 'Headline',
      pitchId: 'Pitch',
      ctaId: 'Call To Action',
      formId: 'Form',
      websiteBannerImageId: 'Website Banner Image',
      featureImageId: 'Feature Image',
      highlightImageId: 'Highlight Image',
      backgroundImageId: 'Background Image',
      logoWideId: 'Logo - Wide',
      logoSquareId: 'Logo - Square',
    }[key] || key;
  }

  function setLandingPageVisualDraftValue(fieldKey, value, options = {}) {
    const nextValue = safeText(value);
    landingPageVisualDraft[fieldKey] = nextValue;
    if (fieldKey === 'templateId') {
      activeLandingPageVisualRecord.templateId = nextValue || activeLandingPageVisualRecord.templateId;
    }
    if (!options.skipRender) {
      renderLandingPageVisualEditor();
    }
  }

  function createLandingPageVisualSelectControl(record, fieldKey, label, placeholder) {
    const wrap = document.createElement('label');
    wrap.className = 'develop-inline-editor-field';

    const text = document.createElement('span');
    text.className = 'develop-inline-editor-field-label';
    text.textContent = label;
    wrap.appendChild(text);

    const meta = getLandingPageFieldFilterMeta(fieldKey);
    let activeFilter = '';
    if (meta) {
      const filter = document.createElement('select');
      const rows = getLandingPageFieldRows(fieldKey);
      const values = Array.from(new Set(rows.map((row) => safeText(meta.getValue(row))).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      setSelectOptions(
        filter,
        values.map((value) => ({ value, label: meta.getLabel(value) })),
        meta.placeholder,
        getLandingPageFilterState(fieldKey).category
      );
      activeFilter = safeText(filter.value);
      filter.addEventListener('change', () => {
        getLandingPageFilterState(fieldKey).category = safeText(filter.value);
        renderLandingPageVisualEditor();
      });
      wrap.appendChild(filter);
    }

    const select = document.createElement('select');
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    const optionFilterState = meta
      ? { ...getLandingPageFilterState(fieldKey), category: activeFilter }
      : getLandingPageFilterState(fieldKey);
    getLandingPageVisualEditorOptions(fieldKey, optionFilterState).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.value = safeText(record[fieldKey]);
    select.addEventListener('change', () => {
      setLandingPageVisualDraftValue(fieldKey, select.value);
    });
    wrap.appendChild(select);
    return wrap;
  }

  function createLandingPageVisualColorControl(record, fieldKey, label, fallback) {
    const wrap = document.createElement('label');
    wrap.className = 'develop-inline-editor-field';

    const text = document.createElement('span');
    text.className = 'develop-inline-editor-field-label';
    text.textContent = label;
    wrap.appendChild(text);

    const input = document.createElement('input');
    input.type = 'color';
    input.value = safeText(record[fieldKey]) || fallback;
    input.addEventListener('input', () => {
      setLandingPageVisualDraftValue(fieldKey, input.value);
    });
    wrap.appendChild(input);
    return wrap;
  }

  function createLandingPageVisualAssetNavigator(record, fieldKey, label, placeholder) {
    const wrap = document.createElement('div');
    wrap.className = 'develop-inline-editor-field';

    const title = document.createElement('span');
    title.className = 'develop-inline-editor-field-label';
    title.textContent = label;
    wrap.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'develop-inline-asset-nav';

    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.textContent = `Choose ${label}`;

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';

    const status = document.createElement('div');
    status.className = 'develop-inline-asset-status';

    const preview = document.createElement('div');
    preview.className = 'develop-inline-asset-preview';

    const updateStatus = () => {
      const currentValue = safeText(getActiveLandingPageVisualRecord()?.[fieldKey] || record[fieldKey]);
      const asset = getAssetById(currentValue);
      status.textContent = asset ? assetLabel(asset, label) : placeholder;
      const assetUrl = asset ? toDirectAssetUrl(asset.location) : '';
      preview.innerHTML = '';
      if (assetUrl) {
        const img = document.createElement('img');
        img.src = assetUrl;
        img.alt = assetLabel(asset, label);
        preview.appendChild(img);
      } else {
        const fallback = document.createElement('span');
        fallback.textContent = asset ? assetLabel(asset, label) : 'No asset selected';
        preview.appendChild(fallback);
      }
    };

    chooseBtn.addEventListener('click', () => {
      const config = getLandingPageImagePickerConfigForField(fieldKey);
      if (!config) return;
      openImageAssetPicker(config.selectId, {
        getValue: () => safeText(getActiveLandingPageVisualRecord()?.[fieldKey] || record[fieldKey]),
        setValue: (value) => {
          setLandingPageVisualDraftValue(fieldKey, value);
        },
        afterChange: () => {
          updateStatus();
        },
        uploadHandler: (file) => {
          return uploadThemeAssetFile(file, config.selectId);
        },
      });
    });
    clearBtn.addEventListener('click', () => {
      setLandingPageVisualDraftValue(fieldKey, '');
    });

    controls.appendChild(chooseBtn);
    controls.appendChild(status);
    controls.appendChild(clearBtn);
    wrap.appendChild(controls);
    wrap.appendChild(preview);
    updateStatus();
    return wrap;
  }

  function getLandingPageImagePickerConfigForField(fieldKey) {
    const key = safeText(fieldKey);
    return Object.values(LANDING_IMAGE_PICKERS).find((config) => safeText(config.fieldKey) === key) || null;
  }

  function createLandingPageInlineEditor(key, record) {
    const panel = document.createElement('section');
    panel.className = 'develop-inline-editor';

    const header = document.createElement('div');
    header.className = 'develop-inline-editor-header';

    const title = document.createElement('strong');
    title.textContent = getLandingPageVisualEditorTitle(key);
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeLandingPageVisualEditors.delete(key);
      renderLandingPageVisualEditor();
    });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'develop-inline-editor-body';

    if (key === 'theme') {
      body.appendChild(createLandingPageVisualSelectControl(record, 'templateId', 'Template', 'Template'));
      body.appendChild(createLandingPageVisualColorControl(record, 'primaryColor', 'Primary Color', DEFAULT_LANDING_PRIMARY));
      body.appendChild(createLandingPageVisualColorControl(record, 'backgroundColor', 'Background Color', DEFAULT_LANDING_BACKGROUND));
      body.appendChild(createLandingPageVisualColorControl(record, 'accentColor', 'Accent Color', DEFAULT_LANDING_ACCENT));
    } else if (key === 'headlineId') {
      body.appendChild(createLandingPageVisualSelectControl(record, 'headlineId', 'Headline', 'No Headline'));
    } else if (key === 'pitchId') {
      body.appendChild(createLandingPageVisualSelectControl(record, 'pitchId', 'Pitch', 'No Pitch'));
    } else if (key === 'ctaId') {
      body.appendChild(createLandingPageVisualSelectControl(record, 'ctaId', 'Call To Action', 'No CTA'));
    } else if (key === 'formId') {
      body.appendChild(createLandingPageVisualSelectControl(record, 'formId', 'Form', 'No Form'));
    } else if (key === 'websiteBannerImageId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'websiteBannerImageId', 'Website Banner Image', 'No Banner Image'));
    } else if (key === 'featureImageId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'featureImageId', 'Feature Image', 'No Feature Image'));
    } else if (key === 'backgroundImageId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'backgroundImageId', 'Background Image', 'No Background Image'));
    } else if (key === 'logoWideId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'logoWideId', 'Logo - Wide', 'No Wide Logo'));
    } else if (key === 'logoSquareId') {
      body.appendChild(createLandingPageVisualAssetNavigator(record, 'logoSquareId', 'Logo - Square', 'No Square Logo'));
    }

    panel.appendChild(body);
    return panel;
  }

  function isLandingPageImageEditorKey(key) {
    return [
      'websiteBannerImageId',
      'featureImageId',
      'highlightImageId',
      'backgroundImageId',
      'logoWideId',
      'logoSquareId',
    ].includes(safeText(key));
  }

  function mountLandingPageInlineAssetSelect(target, key, record, editorId, config = {}) {
    const label = safeText(config.label) || getLandingPageVisualEditorTitle(key);
    const current = safeText(record?.[key]);
    if (isLandingPageImageEditorKey(key)) {
      const wrap = document.createElement('div');
      wrap.className = 'develop-inline-image-select';

      const chooser = document.createElement('div');
      chooser.className = 'develop-inline-editor-field';

      const title = document.createElement('span');
      title.className = 'develop-inline-editor-field-label';
      title.textContent = label;
      chooser.appendChild(title);

      const controls = document.createElement('div');
      controls.className = 'develop-inline-asset-nav';

      const chooseBtn = document.createElement('button');
      chooseBtn.type = 'button';
      chooseBtn.textContent = `Choose ${label}`;
      chooseBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const pickerConfig = getLandingPageImagePickerConfigForField(key);
        if (!pickerConfig) return;
        openImageAssetPicker(pickerConfig.selectId, {
          getValue: () => safeText(getActiveLandingPageVisualRecord()?.[key] || record?.[key]),
          setValue: (value) => {
            setLandingPageVisualDraftValue(key, value);
          },
          afterChange: () => {
            renderLandingPageVisualEditor();
          },
          uploadHandler: (file) => uploadThemeAssetFile(file, pickerConfig.selectId),
        });
      });

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setLandingPageVisualDraftValue(key, '');
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        activeLandingPageVisualEditors.delete(editorId);
        renderLandingPageVisualEditor();
      });

      const status = document.createElement('div');
      status.className = 'develop-inline-asset-status';
      const currentAsset = getAssetById(safeText(getActiveLandingPageVisualRecord()?.[key] || current));
      status.textContent = currentAsset ? assetLabel(currentAsset, label) : (safeText(config.placeholder) || `Select ${label}`);

      controls.appendChild(chooseBtn);
      controls.appendChild(status);
      controls.appendChild(clearBtn);
      controls.appendChild(closeBtn);
      chooser.appendChild(controls);

      const preview = document.createElement('div');
      preview.className = 'develop-inline-asset-preview';
      const assetUrl = currentAsset ? toDirectAssetUrl(currentAsset.location) : '';
      if (assetUrl) {
        preview.innerHTML = `<img src="${assetUrl}" alt="${safeText(assetLabel(currentAsset, label))}" />`;
      } else {
        preview.innerHTML = `<span>${currentAsset ? assetLabel(currentAsset, label) : 'No asset selected'}</span>`;
      }
      chooser.appendChild(preview);

      wrap.appendChild(chooser);
      target.innerHTML = '';
      target.appendChild(wrap);
      target.classList.add('develop-inline-image-editor-target');
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'develop-inline-image-select';
    const state = getLandingPageFilterState(key);
    const rows = getLandingPageFieldRows(key);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Filter: Asset Name';
    nameInput.value = safeText(state.asset_name);
    nameInput.addEventListener('click', (event) => event.stopPropagation());
    nameInput.addEventListener('input', () => {
      state.asset_name = safeText(nameInput.value);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(nameInput);

    const typeValues = Array.from(new Set(rows.map((row) => safeText(row?.assetType)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const typeSelect = document.createElement('select');
    setSelectOptions(
      typeSelect,
      typeValues.map((value) => ({ value, label: value })),
      'All Asset Types',
      state.asset_type
    );
    typeSelect.addEventListener('click', (event) => event.stopPropagation());
    typeSelect.addEventListener('change', () => {
      state.asset_type = safeText(typeSelect.value);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(typeSelect);

    const categoryValues = Array.from(new Set(rows.map((row) => safeText(row?.category)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const categorySelect = document.createElement('select');
    setSelectOptions(
      categorySelect,
      categoryValues.map((value) => ({ value, label: value })),
      'All Categories',
      state.category
    );
    categorySelect.addEventListener('click', (event) => event.stopPropagation());
    categorySelect.addEventListener('change', () => {
      state.category = safeText(categorySelect.value);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(categorySelect);

    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.placeholder = 'Filter: Tags';
    tagsInput.value = safeText(state.tags);
    tagsInput.addEventListener('click', (event) => event.stopPropagation());
    tagsInput.addEventListener('input', () => {
      state.tags = safeText(tagsInput.value);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(tagsInput);

    const select = document.createElement('select');
    const first = document.createElement('option');
    first.value = '';
    first.textContent = safeText(config.placeholder) || `Select ${label}`;
    select.appendChild(first);
    getLandingPageVisualEditorOptions(key, state).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.value = current;
    select.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    select.addEventListener('change', () => {
      setLandingPageVisualDraftValue(key, select.value);
    });

    if (config.textSlot) {
      wrap.appendChild(createLandingPageTextStyleControls(config.textSlot));
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeLandingPageVisualEditors.delete(editorId);
      renderLandingPageVisualEditor();
    });

    wrap.appendChild(select);
    wrap.appendChild(closeBtn);
    target.innerHTML = '';
    target.appendChild(wrap);
    target.classList.add('develop-inline-image-editor-target');
  }

  function mountLandingPageInlineFormSelect(target, record, editorId) {
    const key = 'formId';
    const current = safeText(record?.formId);
    const state = getLandingPageFilterState(key);
    const rows = getLandingPageFieldRows(key);

    const wrap = document.createElement('div');
    wrap.className = 'develop-inline-image-select';

    const templateSelect = document.createElement('select');
    const templateValues = Array.from(new Set(rows.map((row) => safeText(row?.formType)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    setSelectOptions(
      templateSelect,
      templateValues.map((value) => ({ value, label: getFormTemplateById(value).name })),
      'All Form Templates',
      state.formType
    );
    templateSelect.addEventListener('click', (event) => event.stopPropagation());
    templateSelect.addEventListener('change', () => {
      state.formType = safeText(templateSelect.value);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(templateSelect);

    const select = document.createElement('select');
    const first = document.createElement('option');
    first.value = '';
    first.textContent = 'No Form';
    select.appendChild(first);
    getLandingPageVisualEditorOptions(key, state).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.value = current;
    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('change', () => {
      setLandingPageVisualDraftValue(key, select.value);
    });
    wrap.appendChild(select);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeLandingPageVisualEditors.delete(editorId);
      renderLandingPageVisualEditor();
    });
    wrap.appendChild(closeBtn);

    target.innerHTML = '';
    target.appendChild(wrap);
    target.classList.add('develop-inline-image-editor-target');
  }

  function mountLandingPageInlineTextEditor(target, slot, record, editorId) {
    const slotSelectSpec = getLandingPageSlotSelectSpec(slot);
    if (slotSelectSpec) {
      mountLandingPageInlineAssetSelect(target, slotSelectSpec.fieldKey, record, editorId, {
        label: slotSelectSpec.label,
        placeholder: slotSelectSpec.placeholder,
        textSlot: slot,
      });
      return;
    }
    const directFieldKey = getLandingPageTextSlotFieldKey(slot);
    const overrides = getLandingPageMergedContentOverrides(record);
    const fallbackText = safeText(
      target.textContent || target.getAttribute('placeholder') || target.value || '',
      10000
    );
    const currentText = directFieldKey
      ? safeText(record?.[directFieldKey], 10000) || fallbackText
      : (safeText(overrides[slot], 10000) || fallbackText);
    const wrap = document.createElement('div');
    wrap.className = 'develop-inline-textarea-wrap';
    const textArea = document.createElement('textarea');
    textArea.className = 'develop-inline-textarea';
    textArea.value = currentText;
    textArea.rows = Math.max(2, Math.min(8, Math.ceil((currentText || fallbackText || 'X').length / 42)));
    textArea.style.minHeight = `${Math.max(target.offsetHeight || 72, 56)}px`;
    textArea.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    textArea.addEventListener('input', () => {
      if (directFieldKey) {
        setLandingPageVisualDraftValue(directFieldKey, textArea.value, { skipRender: true });
      } else {
        setLandingPageContentOverride(slot, textArea.value);
      }
    });
    textArea.addEventListener('blur', () => {
      renderLandingPageVisualEditor();
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.className = 'develop-inline-textarea-close';
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeLandingPageVisualEditors.delete(editorId);
      renderLandingPageVisualEditor();
    });

    wrap.appendChild(textArea);
    wrap.appendChild(createLandingPageTextStyleControls(slot));
    wrap.appendChild(closeBtn);
    target.classList.add('develop-inline-hidden-target');
    target.insertAdjacentElement('afterend', wrap);
    setTimeout(() => {
      textArea.focus();
      textArea.select();
    }, 0);
  }

  function applyLandingPageAutoFit(host) {
    if (!host) return;
    host.querySelectorAll('[data-text-slot][data-size-to-fit="1"]').forEach((node) => {
      const inlineScale = Number(node.style.fontSize.replace('em', '')) || 1;
      const parentFontPx = Number(window.getComputedStyle(node.parentElement || node).fontSize.replace('px', '')) || 16;
      const basePx = parentFontPx * inlineScale;
      let nextPx = Math.max(10, Math.min(72, basePx));
      node.style.fontSize = `${nextPx}px`;

      let guard = 0;
      while (guard < 12 && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
        nextPx -= 1;
        if (nextPx <= 10) break;
        node.style.fontSize = `${nextPx}px`;
        guard += 1;
      }
      while (
        guard < 24 &&
        node.scrollHeight <= node.clientHeight * 0.9 &&
        node.scrollWidth <= node.clientWidth * 0.9 &&
        nextPx < 72
      ) {
        nextPx += 1;
        node.style.fontSize = `${nextPx}px`;
        guard += 1;
        if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
          nextPx -= 1;
          node.style.fontSize = `${nextPx}px`;
          break;
        }
      }
    });
  }

  function createLandingPageTextStyleControls(slot) {
    const textStyle = getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot);
    const controls = document.createElement('div');
    controls.className = 'develop-inline-text-controls';

    const title = document.createElement('div');
    title.className = 'develop-inline-text-controls-label';
    title.textContent = 'Text Size';

    const sizeRow = document.createElement('div');
    sizeRow.className = 'develop-inline-fontsize-row';

    const currentIndex = Math.max(0, LANDING_TEXT_SCALE_OPTIONS.indexOf(textStyle.fontScale));

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '◀';
    prevBtn.disabled = currentIndex <= 0;
    prevBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const currentIndex = Math.max(0, LANDING_TEXT_SCALE_OPTIONS.indexOf(getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot).fontScale));
      const nextIndex = Math.max(0, currentIndex - 1);
      setLandingPageTextStyle(slot, {
        ...getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot),
        fontScale: LANDING_TEXT_SCALE_OPTIONS[nextIndex],
      });
      renderLandingPageVisualEditor();
    });

    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'develop-inline-fontsize-label';
    sizeLabel.textContent = `${Number(textStyle.fontScale).toFixed(2)}x${textStyle.fontScale === '1.00' ? ' (Default)' : ''}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '▶';
    nextBtn.disabled = currentIndex >= LANDING_TEXT_SCALE_OPTIONS.length - 1;
    nextBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const currentIndex = Math.max(0, LANDING_TEXT_SCALE_OPTIONS.indexOf(getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot).fontScale));
      const nextIndex = Math.min(LANDING_TEXT_SCALE_OPTIONS.length - 1, currentIndex + 1);
      setLandingPageTextStyle(slot, {
        ...getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot),
        fontScale: LANDING_TEXT_SCALE_OPTIONS[nextIndex],
      });
      renderLandingPageVisualEditor();
    });

    const fitToggle = document.createElement('label');
    fitToggle.className = 'checkbox-row';
    fitToggle.addEventListener('click', (event) => event.stopPropagation());
    const fitCheckbox = document.createElement('input');
    fitCheckbox.type = 'checkbox';
    fitCheckbox.checked = Boolean(textStyle.sizeToFit);
    fitCheckbox.addEventListener('change', () => {
      setLandingPageTextStyle(slot, {
        ...getLandingPageTextStyle(getActiveLandingPageVisualRecord(), slot),
        sizeToFit: fitCheckbox.checked,
      });
      renderLandingPageVisualEditor();
    });
    fitToggle.appendChild(fitCheckbox);
    fitToggle.appendChild(document.createTextNode('Size to fit'));

    const hint = document.createElement('div');
    hint.className = 'develop-inline-fontsize-hint';
    hint.textContent = 'Steps: 0.80x, 0.90x, 1.00x, 1.10x, 1.20x';

    controls.appendChild(title);
    sizeRow.appendChild(prevBtn);
    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(nextBtn);
    controls.appendChild(sizeRow);
    controls.appendChild(fitToggle);
    controls.appendChild(hint);
    return controls;
  }

  function setLandingPageFormMode(isEditing) {
    const title = byId('developLandingPagesFormTitle');
    const submitBtn = byId('developLandingPagesSubmitBtn');
    const form = els.developLandingPagesForm;
    if (title) title.textContent = isEditing ? 'Edit Page' : 'Create Page';
    if (submitBtn) submitBtn.textContent = isEditing ? 'Update Page' : 'Save Page';
    if (form) {
      form.classList.toggle('develop-landing-page-editing', Boolean(isEditing));
    }
    updateLandingPageFieldOutlines();
  }

  function updateLandingPageFieldOutlines() {
    const form = els.developLandingPagesForm;
    if (!form) return;
    const isEditing = form.classList.contains('develop-landing-page-editing');
    const fields = form.querySelectorAll('input, select, textarea');
    fields.forEach((field) => {
      if (!field || field.type === 'hidden') return;
      field.classList.remove('develop-field-complete', 'develop-field-missing');
      if (!isEditing) return;
      const hasValue = safeText(field.value) !== '';
      field.classList.add(hasValue ? 'develop-field-complete' : 'develop-field-missing');
    });
  }

  function applyLandingPageRecordToForm(record) {
    if (!record) return;
    const form = els.developLandingPagesForm;
    if (!form) return;

    const idInput = byId('developLandingPageIdInput');
    const nameInput = byId('developLandingPageNameInput');
    if (idInput) idInput.value = safeText(record.id);
    if (nameInput) nameInput.value = safeText(record.name);

    landingPageColors = {
      primary: safeText(record.primaryColor) || DEFAULT_LANDING_PRIMARY,
      background: safeText(record.backgroundColor) || DEFAULT_LANDING_BACKGROUND,
      accent: safeText(record.accentColor) || DEFAULT_LANDING_ACCENT,
    };

    const primaryInput = byId('developLandingPrimaryColorInput');
    const backgroundInput = byId('developLandingBackgroundColorInput');
    const accentInput = byId('developLandingAccentColorInput');
    if (primaryInput) primaryInput.value = landingPageColors.primary;
    if (backgroundInput) backgroundInput.value = landingPageColors.background;
    if (accentInput) accentInput.value = landingPageColors.accent;

    const setValue = (id, value) => {
      const select = byId(id);
      if (select) select.value = safeText(value);
    };
    setValue('developLandingTemplateSelect', record.templateId);
    setValue('developLandingFormSelect', record.formId);
    setValue('developLandingLeadMagnetSelect', record.leadMagnetId);
    setValue('developLandingHeadlineSelect', record.headlineId);
    setValue('developLandingPitchSelect', record.pitchId);
    setValue('developLandingCtaSelect', record.ctaId);
    setValue('developLandingBannerImageSelect', record.websiteBannerImageId);
    setValue('developLandingBackgroundImageSelect', record.backgroundImageId);
    setValue('developLandingFeatureImageSelect', record.featureImageId);
    setValue('developLandingHighlightImageSelect', record.highlightImageId);
    setValue('developLandingFeatureHeadlineSelect', record.featureHeadlineId);
    setValue('developLandingFeatureSubheadingSelect', record.featureSubheadingId);
    setValue('developLandingHighlightHeadlineSelect', record.highlightHeadlineId);
    setValue('developLandingHighlightPitchSelect', record.highlightPitchId);
    setValue('developLandingBodyHeadlineSelect', record.bodyHeadlineId);
    setValue('developLandingBodySubheadingSelect', record.bodySubheadingId);
    setValue('developLandingBodyPitchSelect', record.bodyPitchId);
    setValue('developLandingLogoSquareSelect', record.logoSquareId);

    selectedTemplateId = safeText(record.templateId) || selectedTemplateId;
    renderTemplateLibrary();
    renderTemplatePreview(selectedTemplateId);
    setLandingPageFormMode(Boolean(safeText(record.id)));
    pendingLandingPageFormRecord = null;
  }

  function resetLandingPageForm() {
    pendingLandingPageFormRecord = null;
    clearLandingPageSelectorFilters();
    const form = els.developLandingPagesForm;
    if (form) form.reset();
    const idInput = byId('developLandingPageIdInput');
    if (idInput) idInput.value = '';
    landingPageColors = {
      primary: DEFAULT_LANDING_PRIMARY,
      background: DEFAULT_LANDING_BACKGROUND,
      accent: DEFAULT_LANDING_ACCENT,
    };
    const primaryInput = byId('developLandingPrimaryColorInput');
    const backgroundInput = byId('developLandingBackgroundColorInput');
    const accentInput = byId('developLandingAccentColorInput');
    if (primaryInput) primaryInput.value = landingPageColors.primary;
    if (backgroundInput) backgroundInput.value = landingPageColors.background;
    if (accentInput) accentInput.value = landingPageColors.accent;
    selectedTemplateId = LANDING_TEMPLATES[0].id;
    const templateSelect = byId('developLandingTemplateSelect');
    if (templateSelect) templateSelect.value = selectedTemplateId;
    renderTemplateLibrary();
    renderTemplatePreview(selectedTemplateId);
    setLandingPageFormMode(false);
    updateLandingPageFieldOutlines();
  }

  function buildEmptyLandingRecord(name, templateId) {
    return {
      id: '',
      name: safeText(name, 255),
      templateId: safeText(templateId, 120) || LANDING_TEMPLATES[0].id,
      primaryColor: DEFAULT_LANDING_PRIMARY,
      backgroundColor: DEFAULT_LANDING_BACKGROUND,
      accentColor: DEFAULT_LANDING_ACCENT,
      formId: '',
      leadMagnetId: '',
      headlineId: '',
      pitchId: '',
      ctaId: '',
      websiteBannerImageId: '',
      backgroundImageId: '',
      featureImageId: '',
      highlightImageId: '',
      featureHeadlineId: '',
      featureSubheadingId: '',
      featureTitle: '',
      featureCopy: '',
      highlightHeadlineId: '',
      highlightPitchId: '',
      highlightTitle: '',
      highlightCopy: '',
      bodyHeadlineId: '',
      bodySubheadingId: '',
      bodyPitchId: '',
      logoWideId: '',
      logoSquareId: '',
      contentOverrides: {},
      createdAt: '',
      updatedAt: '',
    };
  }

  function openCreateLandingPage() {
    resetLandingPageForm();
    loadLandingPageBuilderOptions().catch(() => {});
    App.setActivePage('developLandingPagesPage');
  }

  function openCreateLandingTemplate() {
    const baseTemplate = getTemplateById(selectedTemplateId);
    const suggestedName = `${safeText(baseTemplate?.name) || 'Page'} Template`;
    const name = safeText(window.prompt('Template name', suggestedName), 255) || suggestedName;
    const record = buildEmptyLandingRecord(name, safeText(baseTemplate?.id) || selectedTemplateId);
    openLandingPageVisualEditor(record, { mode: 'template' });
  }

  function openEditLandingPage(record) {
    if (!record) return;
    clearLandingPageSelectorFilters();
    pendingLandingPageFormRecord = { ...record };
    setLandingPageFormMode(true);
    loadLandingPageBuilderOptions().catch(() => {
      if (pendingLandingPageFormRecord) applyLandingPageRecordToForm(pendingLandingPageFormRecord);
    });
    App.setActivePage('developLandingPagesPage');
  }

  function previewCurrentLandingPageForm() {
    const form = els.developLandingPagesForm;
    if (!form) return;
    const formData = new FormData(form);
    const payload = getLandingPageFormPayload(formData);
    if (!payload.templateId) {
      notify('Choose a template before previewing', true);
      return;
    }
    renderLandingPagePreview({
      id: safeText(formData.get('landing_page_id')),
      name: payload.name || 'Unsaved Page Preview',
      ...payload,
    });
    App.setActivePage('developLandingPagePreviewPage');
  }

  function renderLandingPagePreview(record) {
    const host = byId('developLandingPagePreviewHost');
    const title = byId('developLandingPagePreviewTitle');
    const modeBtn = byId('developLandingPagePreviewModeBtn');
    if (!host || !record) return;

    activeLandingPagePreviewRecord = record;
    if (title) title.textContent = safeText(record.name) || (activeLandingPagePreviewMode === 'template' ? 'Template Preview' : 'Page Preview');
    if (modeBtn) modeBtn.disabled = false;
    host.innerHTML = buildLandingPageMarkup(record);
    bindLandingImageFallbacks(host);
    applyLandingPageAutoFit(host);
    if (activeLandingPagePreviewMode !== 'template') {
      bindLandingPageRuntimeForms(host, record);
    }
  }

  function saveLandingPageThankYouState(payload) {
    landingPageThankYouState = payload && typeof payload === 'object' ? payload : null;
    try {
      if (landingPageThankYouState) {
        window.sessionStorage.setItem(LANDING_THANK_YOU_STATE_KEY, JSON.stringify(landingPageThankYouState));
      } else {
        window.sessionStorage.removeItem(LANDING_THANK_YOU_STATE_KEY);
      }
    } catch (_) {
      // no-op
    }
  }

  function getLandingPageThankYouState() {
    if (landingPageThankYouState) return landingPageThankYouState;
    try {
      const raw = window.sessionStorage.getItem(LANDING_THANK_YOU_STATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      landingPageThankYouState = parsed && typeof parsed === 'object' ? parsed : null;
      return landingPageThankYouState;
    } catch {
      return null;
    }
  }

  function getAssetTags(asset) {
    if (!asset) return [];
    if (Array.isArray(asset.tags)) return asset.tags.map((item) => safeText(item)).filter(Boolean);
    return safeText(asset.tags)
      .split(',')
      .map((item) => safeText(item))
      .filter(Boolean);
  }

  function getLeadMagnetThumbnailUrl(asset) {
    if (!asset) return '';
    if (safeText(asset.assetType) === 'Image') return toDirectAssetUrl(asset.location);
    const sourceAssetId = safeText(asset.id);
    const sourceLocation = safeText(asset.location);
    const thumbnail = (Array.isArray(state.assets) ? state.assets : []).find((item) => {
      if (safeText(item?.assetType) !== 'Image') return false;
      if (safeText(item?.category) !== 'Thumbnail') return false;
      const tags = getAssetTags(item);
      if (sourceAssetId && tags.includes(`source_asset_id:${sourceAssetId}`)) return true;
      if (sourceLocation && tags.includes(`source_location:${sourceLocation}`)) return true;
      return false;
    });
    return thumbnail ? toDirectAssetUrl(thumbnail.location) : '';
  }

  function renderLandingPageThankYouPage() {
    const host = byId('developLandingThankYouHost');
    if (!host) return;
    const state = getLandingPageThankYouState();
    const message = safeText(state?.message, 2000) || 'Thank you. Your request has been received.';
    const leadMagnetUrl = safeText(state?.leadMagnetUrl);
    const label = safeText(state?.leadMagnetLabel) || 'Open Lead Magnet';
    const title = safeText(state?.title) || 'Thank You';
    const hasLink = Boolean(leadMagnetUrl);
    const landingPageId = safeText(state?.landingPageId);
    const leadMagnetId = safeText(state?.leadMagnetId);
    const sourceRecord = savedLandingPages.find((item) => safeText(item.id) === landingPageId)
      || activeLandingPagePreviewRecord
      || null;
    const ctx = sourceRecord ? getLandingPagePreviewContext(sourceRecord) : null;
    const fallbackLabel = leadMagnetId ? getLandingPageAssetName(leadMagnetId, '') : '';
    const leadMagnetAsset = getAssetById(leadMagnetId)
      || (leadMagnetUrl ? (Array.isArray(state.assets) ? state.assets : []).find((asset) => toDirectAssetUrl(asset?.location) === leadMagnetUrl) : null)
      || null;
    const downloadThumbUrl = getLeadMagnetThumbnailUrl(leadMagnetAsset);
    const displayLabel = hasLink ? (label || fallbackLabel || 'Open Lead Magnet') : 'Lead Magnet Unavailable';

    host.innerHTML = `
      <div class="develop-template-canvas develop-thankyou-canvas">
        <div class="develop-template-banner">${
          ctx?.bannerUrl
            ? `<img src="${ctx.bannerUrl}" alt="${getLandingPageAssetName(sourceRecord?.websiteBannerImageId, 'Page Banner Image')}" class="develop-template-banner-img" />`
            : 'Page Banner Image'
        }</div>
        <div class="develop-template-hero develop-thankyou-hero-shell" style="${ctx ? `background:${ctx.backgroundColor};` : ''}">
          <div class="develop-thankyou-center">
            <h3 style="${ctx ? `color:${ctx.primaryColor};` : ''}">${title}</h3>
            <p>${message}</p>
            <a
              class="develop-thankyou-download${hasLink ? '' : ' is-disabled'}"
              href="${hasLink ? leadMagnetUrl : '#'}"
              ${hasLink ? 'target="_blank" rel="noopener noreferrer"' : ''}
              aria-label="${displayLabel}"
            >
              <span class="develop-thankyou-download-icon-wrap" aria-hidden="true">${
                downloadThumbUrl
                  ? `<img src="${downloadThumbUrl}" alt="${displayLabel}" class="develop-thankyou-download-thumb" />`
                  : '<span class="develop-thankyou-download-icon">⬇</span>'
              }</span>
              <span class="develop-thankyou-download-label">${displayLabel}</span>
            </a>
          </div>
        </div>
      </div>
    `;
    bindLandingImageFallbacks(host);
  }

  function openLandingPageThankYouPage(payload) {
    saveLandingPageThankYouState(payload);
    ensureAssetsLoaded()
      .catch(() => {})
      .finally(() => {
        renderLandingPageThankYouPage();
        App.setActivePage('developLandingPageThankYouPage');
      });
  }

  function openLandingPagePreview(record, options = {}) {
    if (!record) return;
    ensureAssetsLoaded()
      .catch(() => {})
      .finally(() => {
        activeLandingPagePreviewMode = safeText(options.mode) === 'template' ? 'template' : 'page';
        renderLandingPagePreview(record);
        App.setActivePage('developLandingPagePreviewPage');
      });
  }

  function syncLandingVisualChrome(record) {
    const title = byId('developLandingPageVisualEditorTitle');
    const saveBtn = byId('developLandingPageVisualSaveBtn');
    const backBtn = byId('developLandingPageVisualBackBtn');
    const subject = activeLandingPageVisualMode === 'template' ? 'Template' : 'Page';
    if (title) title.textContent = record ? `Visual Editor: ${safeText(record.name) || subject}` : `Visual ${subject} Editor`;
    if (saveBtn) saveBtn.textContent = activeLandingPageVisualMode === 'template' ? 'Save Template' : 'Save All Changes';
    if (backBtn) backBtn.textContent = activeLandingPageVisualMode === 'template' ? 'Back To Templates' : 'Back To Pages';
  }

  function renderLandingPageVisualEditor() {
    const host = byId('developLandingPageVisualEditorHost');
    const saveBtn = byId('developLandingPageVisualSaveBtn');
    const modeBtn = byId('developLandingPageVisualModeBtn');
    const record = getActiveLandingPageVisualRecord();
    if (!host) return;
    if (saveBtn) saveBtn.disabled = !record || !landingPageVisualEditMode;
    if (modeBtn) {
      modeBtn.textContent = landingPageVisualEditMode ? 'Display Mode' : 'Edit Mode';
    }
    if (!record) {
      host.innerHTML = '';
      syncLandingVisualChrome(null);
      return;
    }
    syncLandingVisualChrome(record);
    host.innerHTML = buildLandingPageMarkup(record, { interactive: landingPageVisualEditMode });
    bindLandingImageFallbacks(host);
    applyLandingPageAutoFit(host);
    if (!landingPageVisualEditMode) {
      bindLandingPageRuntimeForms(host, record);
      return;
    }
    host.querySelectorAll('[data-edit-key]').forEach((node) => {
      node.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = safeText(node.dataset.editKey);
        const slot = safeText(node.dataset.editSlot);
        if (!key) return;
        const editorId = key === 'formId' ? 'formId' : getLandingPageEditorId(key, slot || key);
        activeLandingPageVisualEditors.add(editorId);
        renderLandingPageVisualEditor();
      });
    });
    Array.from(activeLandingPageVisualEditors).forEach((editorId) => {
      const { key, slot } = parseLandingPageEditorId(editorId);
      let target = null;
      if (slot) {
        target = host.querySelector(`[data-edit-key="${key}"][data-edit-slot="${slot}"]`);
      }
      if (!target && key) {
        target = host.querySelector(`[data-edit-key="${key}"]`);
      }
      if (!target) return;
      target.classList.add('develop-landing-editing-active');
      if (key === 'formId') {
        target = host.querySelector('[data-edit-key="formId"][data-edit-slot="form-card"]') || target;
        mountLandingPageInlineFormSelect(target, record, editorId);
      } else if (isLandingPageImageEditorKey(key)) {
        mountLandingPageInlineAssetSelect(target, key, record, editorId);
      } else {
        mountLandingPageInlineTextEditor(target, slot || key, record, editorId);
      }
    });
  }

  function openLandingPageVisualEditor(record, options = {}) {
    if (!record) return;
    ensureAssetsLoaded()
      .catch(() => {})
      .finally(() => {
        activeLandingPageVisualMode = safeText(options.mode) === 'template' ? 'template' : 'page';
        activeLandingPageVisualRecord = {
          ...record,
          contentOverrides: normalizeLandingPageContentOverrides(record.contentOverrides),
        };
        landingPageVisualEditMode = true;
        landingPageVisualDraft = {};
        activeLandingPageVisualEditors.clear();
        renderLandingPageVisualEditor();
        App.setActivePage('developLandingPageVisualEditorPage');
      });
  }

  function getFilteredSortedLandingPages() {
    const nameFilter = safeText(landingPageTableState.filters.name).toLowerCase();
    const templateFilter = safeText(landingPageTableState.filters.templateId);

    const rows = savedLandingPages.filter((item) => {
      const name = safeText(item.name).toLowerCase();
      const templateId = safeText(item.templateId);
      if (nameFilter && !name.includes(nameFilter)) return false;
      if (templateFilter && templateId !== templateFilter) return false;
      return true;
    });

    const key = safeText(landingPageTableState.sort.key);
    const dir = landingPageTableState.sort.dir === 'asc' ? 'asc' : 'desc';
    rows.sort((a, b) => {
      let left = '';
      let right = '';
      if (key === 'name') {
        left = safeText(a.name).toLowerCase();
        right = safeText(b.name).toLowerCase();
      } else if (key === 'templateId') {
        left = getLandingPageTemplateName(a.templateId).toLowerCase();
        right = getLandingPageTemplateName(b.templateId).toLowerCase();
      } else if (key === 'headlineId') {
        left = getLandingPageHeadlineLabel(a.headlineId).toLowerCase();
        right = getLandingPageHeadlineLabel(b.headlineId).toLowerCase();
      } else if (key === 'formId') {
        left = getSavedFormName(a.formId).toLowerCase();
        right = getSavedFormName(b.formId).toLowerCase();
      } else {
        left = safeText(a.updatedAt);
        right = safeText(b.updatedAt);
      }
      if (left === right) return 0;
      const result = left < right ? -1 : 1;
      return dir === 'asc' ? result : -result;
    });

    return rows;
  }

  function syncLandingPageTableControls() {
    const visibleIds = getFilteredSortedLandingPages().map((item) => safeText(item.id)).filter(Boolean);
    selectedLandingPageIds = new Set(Array.from(selectedLandingPageIds).filter((id) => visibleIds.includes(id) || savedLandingPages.some((item) => safeText(item.id) === id)));

    const selectAll = byId('developLandingPagesSelectAllVisible');
    const bulkBtn = byId('developLandingPagesBulkEditBtn');
    if (selectAll) {
      const selectedVisibleCount = visibleIds.filter((id) => selectedLandingPageIds.has(id)).length;
      selectAll.checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
      selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
      selectAll.disabled = visibleIds.length === 0;
    }
    if (bulkBtn) bulkBtn.disabled = !selectedLandingPageIds.size;
  }

  function renderLandingPagesTable() {
    const tbody = byId('developLandingPagesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const sortButtons = [
      ['developLandingPagesSortNameBtn', 'name', 'Name'],
      ['developLandingPagesSortTemplateBtn', 'templateId', 'Template'],
      ['developLandingPagesSortHeadlineBtn', 'headlineId', 'Headline'],
      ['developLandingPagesSortFormBtn', 'formId', 'Form'],
      ['developLandingPagesSortUpdatedBtn', 'updatedAt', 'Updated'],
    ];
    sortButtons.forEach(([id, key, label]) => {
      const button = byId(id);
      if (!button) return;
      const marker = landingPageTableState.sort.key === key
        ? (landingPageTableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      button.textContent = `${label}${marker}`;
    });

    const templateFilter = byId('developLandingPagesTemplateFilter');
    if (templateFilter) {
      const current = safeText(landingPageTableState.filters.templateId);
      setSelectOptions(
        templateFilter,
        LANDING_TEMPLATES.map((template) => ({ value: template.id, label: template.name })),
        'All Templates',
        current
      );
    }

    const rows = getFilteredSortedLandingPages();
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = 'No pages yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      syncLandingPageTableControls();
      return;
    }

    rows.forEach((item) => {
      const row = document.createElement('tr');
      const id = safeText(item.id);

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedLandingPageIds.has(id);
      checkbox.setAttribute('aria-label', `Select page ${safeText(item.name) || id}`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedLandingPageIds.add(id);
        else selectedLandingPageIds.delete(id);
        syncLandingPageTableControls();
      });
      selectTd.appendChild(checkbox);
      row.appendChild(selectTd);

      const append = (text) => {
        const td = document.createElement('td');
        td.textContent = text || '-';
        row.appendChild(td);
      };

      append(safeText(item.name) || '-');
      append(getLandingPageTemplateName(item.templateId) || '-');
      append(getLandingPageHeadlineLabel(item.headlineId) || '-');
      append(getSavedFormName(item.formId) || '-');
      append(item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '-');

      const actionsTd = document.createElement('td');
      actionsTd.className = 'develop-pages-actions-cell';
      const viewBtn = App.makeIconButton('view', 'View Page', () => {
        openLandingPagePreview(item);
      });
      const editBtn = App.makeIconButton('edit', 'Edit Page', () => {
        openLandingPageVisualEditor(item);
      }, { marginLeft: '10px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Page', async () => {
        if (!window.confirm(`Delete page "${safeText(item.name) || id}"?`)) return;
        try {
          await api(`/api/develop/landing-pages/${encodeURIComponent(id)}`, { method: 'DELETE' });
          selectedLandingPageIds.delete(id);
          await refresh();
          notify('Landing page deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '10px' });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      row.appendChild(actionsTd);
      tbody.appendChild(row);
    });

    syncLandingPageTableControls();
  }

  function syncFormBuilderInputs() {
    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const idInput = byId('developFormIdInput');
    const nameInput = byId('developFormNameInput');
    const typeSelect = byId('developFormTypeSelect');
    const contactTypeSelect = byId('developFormContactTypeSelect');
    const leadMagnetTypeSelect = byId('developFormLeadMagnetTypeSelect');
    const leadMagnetSelect = byId('developFormLeadMagnetSelect');
    const ctaSelect = byId('developFormCtaSelect');
    const headingInput = byId('developFormHeadingInput');
    const successMessageInput = byId('developFormSuccessMessageInput');
    const errorMessageInput = byId('developFormErrorMessageInput');
    const accentInput = byId('developFormAccentColorInput');
    const matchInput = byId('developFormMatchLandingColorInput');
    const landingColorModeWrap = byId('developFormLandingColorModeWrap');
    const landingColorModeSelect = byId('developFormLandingColorModeSelect');
    const useLandingBackgroundWrap = byId('developFormUseLandingBackgroundWrap');
    const useLandingBackgroundInput = byId('developFormUseLandingBackgroundInput');

    if (idInput) idInput.value = current.id || '';
    if (nameInput) nameInput.value = current.name || '';
    if (typeSelect) typeSelect.value = current.formType;
    if (contactTypeSelect) contactTypeSelect.value = current.contactType || 'lead';
    if (leadMagnetTypeSelect) {
      setSelectOptions(
        leadMagnetTypeSelect,
        getFormLeadMagnetTypeOptions(current.leadMagnetType),
        'Lead Magnet Type',
        current.leadMagnetType || ''
      );
    }
    if (leadMagnetSelect) {
      const selectedType = safeText(current.leadMagnetType);
      const options = (Array.isArray(state.assets) ? state.assets : []).filter((asset) =>
        assetMatchesFormLeadMagnetType(asset, selectedType)
      );
      setSelectOptions(
        leadMagnetSelect,
        options.map((asset) => ({ value: String(asset.id), label: assetLabel(asset, String(asset.id)) })),
        'Lead Magnet (Optional)',
        current.leadMagnetId || ''
      );
      if (current.leadMagnetId && !options.some((asset) => safeText(asset.id) === safeText(current.leadMagnetId))) {
        current.leadMagnetId = '';
        leadMagnetSelect.value = '';
      }
    }
    if (ctaSelect) {
      setSelectOptions(
        ctaSelect,
        landingPageCtas.map((row) => ({ value: String(row.id), label: safeText(row.cta) || `CTA ${row.id}` })),
        landingPageCtas.length ? 'Call To Action' : 'Call To Action (optional)',
        current.ctaId || ''
      );
    }
    if (headingInput) headingInput.value = current.heading;
    if (successMessageInput) successMessageInput.value = current.successMessage || '';
    if (errorMessageInput) errorMessageInput.value = current.errorMessage || '';
    if (accentInput) accentInput.value = current.accentColor || DEFAULT_FORM_ACCENT;
    if (accentInput) accentInput.disabled = Boolean(current.matchLandingColor);
    if (matchInput) matchInput.checked = Boolean(current.matchLandingColor);
    if (landingColorModeSelect) landingColorModeSelect.value = current.landingColorMode || 'primary';
    if (useLandingBackgroundInput) useLandingBackgroundInput.checked = Boolean(current.useLandingBackground);
    if (landingColorModeWrap) landingColorModeWrap.classList.toggle('hidden', !current.matchLandingColor);
    if (useLandingBackgroundWrap) useLandingBackgroundWrap.classList.toggle('hidden', !current.matchLandingColor);
  }

  function renderTemplatePreview(templateId) {
    const host = byId('developTemplatesPreviewHost');
    if (!host) return;
    const template = getTemplateById(templateId);
    selectedTemplateId = template.id;

    host.innerHTML = buildTemplatePreviewMarkup(template);
  }

  function openCreateFormEditor() {
    var initialTemplateId = arguments.length ? arguments[0] : FORM_TEMPLATES[0].id;
    formBuilderState = buildDefaultFormState(initialTemplateId);
    const editorTitle = byId('developFormsEditorTitle');
    if (editorTitle) editorTitle.textContent = 'Create Form';
    byId('developFormEditorPanel')?.classList.remove('hidden');
    syncFormBuilderInputs();
    renderFormBuilderFieldConfig();
    renderFormBuilderPreview();
  }

  function closeFormEditor() {
    byId('developFormEditorPanel')?.classList.add('hidden');
    const editorTitle = byId('developFormsEditorTitle');
    if (editorTitle) editorTitle.textContent = 'Create Form';
  }

  function buildFormTemplatePreviewMarkup(template) {
    const fields = Array.isArray(template?.fields) ? template.fields : [];
    const fieldMarkup = fields.map((field) => `<input type="${safeText(field.type) || 'text'}" placeholder="${safeText(field.label) || 'Field'}${field.required ? ' *' : ''}" />`).join('');
    return `
      <div class="develop-form-preview">
        <h3>${safeText(template?.defaultHeading) || 'Form Template'}</h3>
        ${fieldMarkup}
        <button type="button">${safeText(template?.defaultSubmitLabel) || 'Submit'}</button>
      </div>
    `;
  }

  function renderFormTemplatePreview(templateId) {
    const host = byId('developFormTemplatesPreviewHost');
    if (!host) return;
    const template = getFormTemplateById(templateId);
    selectedFormTemplateId = template.id;
    host.innerHTML = buildFormTemplatePreviewMarkup(template);
  }

  function buildEmailTemplatePreviewMarkup(template, options = {}) {
    const sampleContent = options && options.sampleContent === true;
    const loremParagraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
    const loremHeading = 'Lorem Ipsum Headline';
    const loremEyebrow = 'Sample Email';
    const loremButton = 'Call To Action';
    const subject = safeText(template?.subject) || 'Sample subject line';
    const blocks = normalizeEmailTemplateBlocks(template);
    const blockMarkup = blocks.map((block) => {
      const blockText = safeText(block.text);
      const displayText = sampleContent ? (blockText || (block.type === 'heading'
        ? loremHeading
        : block.type === 'eyebrow'
          ? loremEyebrow
          : block.type === 'button'
            ? loremButton
            : loremParagraph)) : blockText;
      if (block.type === 'eyebrow') {
        return `<div class="develop-template-eyebrow">${displayText || 'Email Template'}</div>`;
      }
      if (block.type === 'heading') {
        return `<h3>${displayText || 'Heading'}</h3>`;
      }
      if (block.type === 'paragraph') {
        return `<p>${displayText || ''}</p>`;
      }
      if (block.type === 'button') {
        return `<button type="button">${displayText || 'Open'}</button>`;
      }
      if (block.type === 'image') {
        const src = resolveEmailTemplateImageSource(block);
        if (!src) {
          return sampleContent
            ? '<div class="develop-email-template-image-placeholder">Image Placeholder</div>'
            : '';
        }
        const alt = safeText(block.alt) || 'Email image';
        return `<div class="develop-email-template-image-wrap"><img src="${src}" alt="${alt}" class="develop-email-template-image" /></div>`;
      }
      if (block.type === 'divider') {
        return '<hr style="margin:0.8rem 0;border:none;border-top:1px solid rgba(15,79,143,0.2);" />';
      }
      if (block.type === 'spacer') {
        return '<div style="height:1rem;"></div>';
      }
      return '';
    }).join('');
    return `
      <div class="develop-email-template-preview">
        <div class="develop-email-template-preview-meta"><strong>Subject:</strong> ${subject}</div>
        ${blockMarkup}
      </div>
    `;
  }

  function openEmailTemplatePreviewModal(template) {
    if (!template || !App.components || typeof App.components.Modal !== 'function') return;
    const body = document.createElement('div');
    body.innerHTML = buildEmailTemplatePreviewMarkup(template, { sampleContent: true });
    const modal = App.components.Modal({
      title: `${safeText(template.name) || 'Email Template'} Preview`,
      body,
      actions: [
        {
          label: 'Close',
          onClick: () => modal.close(),
        },
      ],
      dialogClass: 'develop-email-template-modal',
      bodyClass: 'develop-email-template-modal-body',
    });
    modal.open();
  }

  function normalizeEmailTemplateBlocks(template) {
    const raw = Array.isArray(template?.blocks) ? template.blocks : [];
    const normalized = raw
      .map((block, index) => ({
        id: safeText(block?.id) || `block_${index + 1}`,
        type: safeText(block?.type).toLowerCase() || 'paragraph',
        text: safeText(block?.text),
        url: safeText(block?.url),
        sourceMode: safeText(block?.sourceMode).toLowerCase() || (safeText(block?.assetId) ? 'gallery' : (safeText(block?.url) ? 'url' : 'gallery')),
        assetId: safeText(block?.assetId),
        alt: safeText(block?.alt),
      }))
      .filter((block) => block.type);
    if (normalized.length) return normalized;
    const fallback = [];
    if (safeText(template?.heading)) fallback.push({ id: 'heading_1', type: 'heading', text: safeText(template.heading), url: '' });
    if (safeText(template?.body)) fallback.push({ id: 'paragraph_1', type: 'paragraph', text: safeText(template.body), url: '' });
    if (safeText(template?.cta)) fallback.push({ id: 'button_1', type: 'button', text: safeText(template.cta), url: '' });
    return fallback.length ? fallback : [{ id: 'paragraph_1', type: 'paragraph', text: '', url: '' }];
  }

  function createEmailTemplateBlock(type = 'paragraph') {
    return {
      id: `block_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      text: '',
      url: '',
      sourceMode: 'gallery',
      assetId: '',
      alt: '',
    };
  }

  function getImageAssets() {
    return (Array.isArray(state.assets) ? state.assets : []).filter((asset) => safeText(asset?.assetType) === 'Image');
  }

  function resolveEmailTemplateImageSource(block) {
    if (!block || block.type !== 'image') return '';
    if (safeText(block.sourceMode) === 'url') {
      return safeText(block.url);
    }
    const assetId = safeText(block.assetId);
    if (!assetId) return '';
    const asset = getImageAssets().find((item) => safeText(item.id) === assetId);
    if (!asset) return '';
    return toDirectAssetUrl(asset.location);
  }

  async function uploadEmailTemplateBlockImage(file, block) {
    if (!file || !block) return;
    if (!String(file.type || '').startsWith('image/')) {
      throw new Error('Please choose an image file');
    }
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const payload = {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileBase64: btoa(binary),
      fileSize: Number(file.size || 0),
      assetType: 'Image',
      assetName: file.name,
      category: 'Email Template',
      tags: ['email-template', 'builder'],
    };
    const result = await api('/api/assets/upload-google-drive', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const asset = result?.asset || result?.data?.asset || null;
    if (!asset?.id) throw new Error('Image upload did not return an asset');
    block.sourceMode = 'gallery';
    block.assetId = safeText(asset.id);
    block.url = '';
    if (!safeText(block.alt)) {
      block.alt = file.name.replace(/\.[^.]+$/, '');
    }
    await loadLandingPageBuilderOptions().catch(() => {});
  }

  function renderEmailTemplatePreview(templateId) {
    const host = byId('developEmailTemplatesPreviewHost');
    if (!host) return;
    const textTemplates = getEmailTemplatesByKind('text');
    const template = textTemplates.find((item) => safeText(item.id) === safeText(templateId)) || textTemplates[0];
    selectedEmailTemplateId = safeText(template?.id);
    host.innerHTML = template ? buildEmailTemplatePreviewMarkup(template) : '';
  }

  function openCampaignBuilderWithEmailTemplate(templateId) {
    const nextTemplateId = safeText(templateId) || safeText(savedEmailTemplates[0]?.id);
    App.setActivePage('campaignsPage');
    setTimeout(() => {
      const toggleBtn = byId('campaignToggleFormBtn');
      const form = byId('campaignForm');
      if (form && form.classList.contains('hidden') && toggleBtn) {
        toggleBtn.click();
      }
      setTimeout(() => {
        const select = byId('campaignEmailTemplateSelect');
        if (select) select.value = nextTemplateId;
      }, 120);
    }, 50);
  }

  function openModularEmailTemplateEditor(template) {
    if (!template) return;
    const builderIdInput = byId('developTemplateEditorIdInput');
    const builderNameInput = byId('developTemplateEditorNameInput');
    const builderSlugInput = byId('developTemplateEditorSlugInput');
    const builderSummaryInput = byId('developTemplateEditorSummaryInput');
    const builderSubjectInput = byId('developTemplateEditorSubjectInput');
    const builderCtaInput = byId('developTemplateEditorCtaInput');
    if (builderIdInput) builderIdInput.value = safeText(template.id);
    if (builderNameInput) builderNameInput.value = safeText(template.name);
    if (builderSlugInput) builderSlugInput.value = safeText(template.slug);
    if (builderSummaryInput) builderSummaryInput.value = safeText(template.summary);
    if (builderSubjectInput) builderSubjectInput.value = safeText(template.subject);
    if (builderCtaInput) builderCtaInput.value = safeText(template.cta);
    emailTemplateBlocksDraft = normalizeEmailTemplateBlocks(template);
    renderEmailTemplateBlockEditor();
    const builderSubmitBtnTop = byId('developTemplateEditorSaveBtnTop');
    const builderSubmitBtnBottom = byId('developTemplateEditorSaveBtnBottom');
    const label = template?.id ? 'Update Template' : 'Save Template';
    if (builderSubmitBtnTop) builderSubmitBtnTop.textContent = label;
    if (builderSubmitBtnBottom) builderSubmitBtnBottom.textContent = label;
    setEmailTemplateEditorVisible(true);
    const panel = byId('developTemplateEditorPanel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderTemplateRecordsTable(hostId, title, headers, rows) {
    const host = byId(hostId);
    if (!host) return;
    host.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'develop-template-records-card';
    const heading = document.createElement('h4');
    heading.textContent = title;
    card.appendChild(heading);
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'develop-template-records-empty';
      empty.textContent = 'No records yet.';
      card.appendChild(empty);
      host.appendChild(card);
      return;
    }
    const table = document.createElement('table');
    table.className = 'develop-template-records-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headers.forEach((header) => {
      const th = document.createElement('th');
      th.textContent = header;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach((cells) => {
      const tr = document.createElement('tr');
      cells.forEach((cell) => {
        const td = document.createElement('td');
        if (cell && typeof cell === 'object' && cell.nodeType) {
          td.appendChild(cell);
        } else {
          td.textContent = safeText(cell) || '-';
        }
        if (td.childNodes.length && td.firstChild && td.firstChild.nodeType === 1 && td.firstChild.classList?.contains('page-heading-actions')) {
          td.classList.add('actions-cell');
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    host.appendChild(card);
  }

  function buildEmailTemplateActions(template) {
    const wrap = document.createElement('div');
    wrap.className = 'page-heading-actions';
    wrap.style.justifyContent = 'flex-start';
    const previewBtn = App.makeIconButton('preview', 'Preview Template', () => {
      openEmailTemplatePreviewModal(template);
    });
    const editBtn = App.makeIconButton('edit', 'Edit Template', () => {
      if ((safeText(template.templateKind).toLowerCase() || 'text') === 'modular') {
        openModularEmailTemplateEditor(template);
      } else {
        populateEmailTemplateForm(template);
      }
    }, { marginLeft: '8px' });
    const deleteBtn = App.makeIconButton('delete', 'Delete Template', async () => {
      const confirmed = window.confirm(`Delete email template "${safeText(template.name) || 'Untitled'}"?`);
      if (!confirmed) return;
      try {
        await api(`/api/develop/email-templates/${encodeURIComponent(template.id)}`, { method: 'DELETE' });
        if (String(selectedEmailTemplateId) === String(template.id)) {
          selectedEmailTemplateId = '';
        }
        await refresh();
        notify('Email template deleted');
      } catch (err) {
        notify(err.message || 'Could not delete email template', true);
      }
    }, { danger: true, marginLeft: '8px' });
    wrap.appendChild(previewBtn);
    wrap.appendChild(editBtn);
    wrap.appendChild(deleteBtn);
    return wrap;
  }

  function renderEmailTemplateTables() {
    const rows = savedEmailTemplates.map((template) => ([
      safeText(template.name) || '-',
      safeText(template.templateKind).toLowerCase() === 'modular' ? 'Email: Modular' : 'Email: Text',
      safeText(template.subject) || '-',
      safeText(template.updatedAt ? new Date(template.updatedAt).toLocaleString() : '-') || '-',
      buildEmailTemplateActions(template),
    ]));
    renderTemplateRecordsTable(
      'developEmailTemplatesPrimaryTableHost',
      'Saved Templates',
      ['Name', 'Kind', 'Subject', 'Updated', 'Actions'],
      rows
    );
  }

  function renderFormTemplateRecordsTable() {
    const rows = savedForms.map((form) => {
      const actions = document.createElement('div');
      actions.className = 'page-heading-actions';
      actions.style.justifyContent = 'flex-start';
      const editBtn = App.makeIconButton('edit', 'Edit Form', () => {
        App.setActivePage('developFormsPage');
        setTimeout(() => applySavedFormToBuilder(form), 60);
      });
      const cloneBtn = App.makeIconButton('clone', 'Clone Form', async () => {
        try {
          const payload = {
            name: safeText(form.name),
            formType: safeText(form.formType),
            contactType: safeText(form.contactType),
            leadMagnetType: safeText(form.leadMagnetType),
            leadMagnetId: safeText(form.leadMagnetId),
            ctaId: safeText(form.ctaId),
            heading: safeText(form.heading),
            submitLabel: safeText(form.submitLabel),
            successMessage: safeText(form.successMessage),
            errorMessage: safeText(form.errorMessage),
            accentColor: safeText(form.accentColor),
            matchLandingColor: Boolean(form.matchLandingColor),
            landingColorMode: safeText(form.landingColorMode),
            useLandingBackground: Boolean(form.useLandingBackground),
            fields: Array.isArray(form.fields)
              ? form.fields.map((field) => ({
                  key: safeText(field?.key),
                  label: safeText(field?.label),
                  type: safeText(field?.type),
                  required: Boolean(field?.required),
                }))
              : [],
          };
          await api('/api/develop/forms', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          await refresh();
          notify('Form cloned');
        } catch (err) {
          notify(err.message, true);
        }
      }, { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Form', async () => {
        if (!window.confirm(`Delete form "${safeText(form.name) || form.id}"?`)) return;
        try {
          await api(`/api/develop/forms/${encodeURIComponent(form.id)}`, { method: 'DELETE' });
          await refresh();
          notify('Form deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actions.appendChild(editBtn);
      actions.appendChild(cloneBtn);
      actions.appendChild(deleteBtn);
      return [
        safeText(form.name) || '-',
        getFormTemplateById(form.formType).name,
        form.updatedAt ? new Date(form.updatedAt).toLocaleString() : '-',
        actions,
      ];
    });
    renderTemplateRecordsTable(
      'developFormTemplatesTableHost',
      'Saved Forms',
      ['Name', 'Type', 'Updated', 'Actions'],
      rows
    );
  }

  function renderPageTemplateRecordsTable() {
    const rows = savedPageTemplates.map((page) => {
      const actions = document.createElement('div');
      actions.className = 'page-heading-actions';
      actions.style.justifyContent = 'flex-start';
      const viewBtn = App.makeIconButton('view', 'View Template', () => {
        openLandingPagePreview(page, { mode: 'template' });
      });
      const editBtn = App.makeIconButton('edit', 'Edit Template', () => {
        openLandingPageVisualEditor(page, { mode: 'template' });
      }, { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Template', async () => {
        const id = safeText(page.id);
        if (!window.confirm(`Delete template "${safeText(page.name) || id}"?`)) return;
        try {
          await api(`/api/develop/page-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
          await refresh();
          notify('Page template deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actions.appendChild(viewBtn);
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      return [
        safeText(page.name) || '-',
        getLandingPageTemplateName(page.templateId) || '-',
        page.updatedAt ? new Date(page.updatedAt).toLocaleString() : '-',
        actions,
      ];
    });
    renderTemplateRecordsTable(
      'developPageTemplatesTableHost',
      'Saved Page Templates',
      ['Name', 'Template', 'Updated', 'Actions'],
      rows
    );
  }

  function renderEmailTemplateLibrary() {
    const host = byId('developEmailTemplatesLibrary');
    if (!host) return;
    host.innerHTML = '';
    const textTemplates = getEmailTemplatesByKind('text');
    if (!textTemplates.length) {
      host.innerHTML = '<p class="meta">No email templates yet. Create one above to start building your library.</p>';
      return;
    }
    textTemplates.forEach((template) => {
      const card = document.createElement('article');
      card.className = `develop-template-library-card${String(template.id) === String(selectedEmailTemplateId) ? ' is-selected' : ''}`;
      const copyWrap = document.createElement('div');
      copyWrap.className = 'develop-template-library-copy';
      const mediaWrap = document.createElement('div');
      mediaWrap.className = 'develop-template-library-media';
      mediaWrap.innerHTML = `
        <div class="develop-template-preview-frame" aria-hidden="true">
          <div class="develop-template-preview-scale">
            ${buildEmailTemplatePreviewMarkup(template)}
          </div>
        </div>
      `;
      const title = document.createElement('h3');
      title.textContent = template.name;
      const summary = document.createElement('p');
      summary.textContent = template.summary;
      const actionRow = document.createElement('div');
      actionRow.className = 'page-heading-actions';
      actionRow.style.justifyContent = 'flex-start';
      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.textContent = String(template.id) === String(selectedEmailTemplateId) ? 'Selected' : 'Preview';
      previewBtn.addEventListener('click', () => {
        selectedEmailTemplateId = String(template.id);
        renderEmailTemplateLibrary();
        renderEmailTemplatePreview(template.id);
      });
      const launchBtn = document.createElement('button');
      launchBtn.type = 'button';
      launchBtn.textContent = 'Use In Campaign';
      launchBtn.addEventListener('click', () => {
        selectedEmailTemplateId = String(template.id);
        renderEmailTemplateLibrary();
        renderEmailTemplatePreview(template.id);
        openCampaignBuilderWithEmailTemplate(template.id);
      });
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        populateEmailTemplateForm(template);
      });
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async () => {
        const confirmed = window.confirm(`Delete email template "${safeText(template.name) || 'Untitled'}"?`);
        if (!confirmed) return;
        try {
          await api(`/api/develop/email-templates/${encodeURIComponent(template.id)}`, { method: 'DELETE' });
          if (String(selectedEmailTemplateId) === String(template.id)) {
            selectedEmailTemplateId = '';
          }
          await refresh();
          notify('Email template deleted');
        } catch (err) {
          notify(err.message || 'Could not delete email template', true);
        }
      });
      actionRow.appendChild(previewBtn);
      actionRow.appendChild(launchBtn);
      actionRow.appendChild(editBtn);
      actionRow.appendChild(deleteBtn);
      copyWrap.appendChild(title);
      copyWrap.appendChild(summary);
      copyWrap.appendChild(actionRow);
      card.appendChild(copyWrap);
      card.appendChild(mediaWrap);
      host.appendChild(card);
    });
  }

  function populateEmailTemplateForm(template) {
    const form = byId('developEmailTemplateForm');
    if (!form) return;
    setCollapsibleSectionExpanded('developEmailSectionToggle', 'developEmailSectionBody', true);
    const builderIdInput = byId('developTemplateEditorIdInput');
    const builderNameInput = byId('developTemplateEditorNameInput');
    const builderSlugInput = byId('developTemplateEditorSlugInput');
    const builderSummaryInput = byId('developTemplateEditorSummaryInput');
    const builderSubjectInput = byId('developTemplateEditorSubjectInput');
    const builderCtaInput = byId('developTemplateEditorCtaInput');
    if (builderIdInput) builderIdInput.value = '';
    if (builderNameInput) builderNameInput.value = '';
    if (builderSlugInput) builderSlugInput.value = '';
    if (builderSummaryInput) builderSummaryInput.value = '';
    if (builderSubjectInput) builderSubjectInput.value = '';
    if (builderCtaInput) builderCtaInput.value = '';
    byId('developEmailTemplateIdInput').value = safeText(template?.id);
    byId('developEmailTemplateNameInput').value = safeText(template?.name);
    byId('developEmailTemplateSlugInput').value = safeText(template?.slug);
    byId('developEmailTemplateSummaryInput').value = safeText(template?.summary);
    byId('developEmailTemplateSubjectInput').value = safeText(template?.subject);
    byId('developEmailTemplateHeadingInput').value = safeText(template?.heading);
    byId('developEmailTemplateBodyInput').value = safeText(template?.body);
    byId('developEmailTemplateCtaInput').value = safeText(template?.cta);
    const submitBtn = byId('developEmailTemplateSubmitBtn');
    const submitBtnTop = byId('developEmailTemplateSubmitBtnTop');
    const label = template?.id ? 'Update Template' : 'Save Template';
    if (submitBtn) submitBtn.textContent = label;
    if (submitBtnTop) submitBtnTop.textContent = label;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetEmailTemplateForm() {
    const form = byId('developEmailTemplateForm');
    if (form) form.reset();
    byId('developEmailTemplateIdInput').value = '';
    const builderIdInput = byId('developTemplateEditorIdInput');
    if (builderIdInput) builderIdInput.value = '';
    const builderNameInput = byId('developTemplateEditorNameInput');
    if (builderNameInput) builderNameInput.value = '';
    const builderSlugInput = byId('developTemplateEditorSlugInput');
    const builderSummaryInput = byId('developTemplateEditorSummaryInput');
    const builderSubjectInput = byId('developTemplateEditorSubjectInput');
    const builderCtaInput = byId('developTemplateEditorCtaInput');
    if (builderSlugInput) builderSlugInput.value = '';
    if (builderSummaryInput) builderSummaryInput.value = '';
    if (builderSubjectInput) builderSubjectInput.value = '';
    if (builderCtaInput) builderCtaInput.value = '';
    emailTemplateBlocksDraft = [
      createEmailTemplateBlock('heading'),
      createEmailTemplateBlock('paragraph'),
      createEmailTemplateBlock('button'),
    ];
    renderEmailTemplateBlockEditor();
    const submitBtn = byId('developEmailTemplateSubmitBtn');
    const submitBtnTop = byId('developEmailTemplateSubmitBtnTop');
    const builderSubmitBtnTop = byId('developTemplateEditorSaveBtnTop');
    const builderSubmitBtnBottom = byId('developTemplateEditorSaveBtnBottom');
    if (submitBtn) submitBtn.textContent = 'Save Template';
    if (submitBtnTop) submitBtnTop.textContent = 'Save Template';
    if (builderSubmitBtnTop) builderSubmitBtnTop.textContent = 'Save Template';
    if (builderSubmitBtnBottom) builderSubmitBtnBottom.textContent = 'Save Template';
  }

  function setEmailTemplateEditorVisible(visible) {
    const panel = byId('developTemplateEditorPanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
    if (visible) {
      setCollapsibleSectionExpanded('developTemplateEditorToggle', 'developTemplateEditorBody', true);
    }
  }

  function setCollapsibleSectionExpanded(toggleId, bodyId, expanded) {
    const toggle = byId(toggleId);
    const body = byId(bodyId);
    if (!toggle || !body) return false;
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    body.classList.toggle('hidden', !expanded);
    return true;
  }

  function bindCollapsibleSection(toggleId, bodyId, { defaultExpanded = true } = {}) {
    const toggle = byId(toggleId);
    const body = byId(bodyId);
    if (!toggle || !body) return;
    setCollapsibleSectionExpanded(toggleId, bodyId, defaultExpanded);
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') !== 'false';
      setCollapsibleSectionExpanded(toggleId, bodyId, !expanded);
    });
  }

  function renderEmailTemplateBlockEditor() {
    const title = byId('developTemplateEditorTitle');
    const meta = byId('developTemplateEditorMeta');
    const host = byId('developTemplateEditorModules');
    if (!host) return;
    let draggedIndex = null;
    setEmailTemplateEditorVisible(true);
    if (title) title.textContent = 'Email: Modular';
    if (meta) meta.textContent = 'Build the email as ordered blocks. Use move buttons to rearrange sections.';
    host.innerHTML = '';

    emailTemplateBlocksDraft.forEach((block, index) => {
      const item = document.createElement('div');
      item.className = 'develop-template-module-item';

      const grip = document.createElement('div');
      grip.className = 'develop-template-module-grip';
      grip.textContent = '::';
      grip.draggable = true;
      grip.title = 'Drag to reorder';
      grip.addEventListener('dragstart', (event) => {
        draggedIndex = index;
        item.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(index));
        }
      });
      grip.addEventListener('dragend', () => {
        draggedIndex = null;
        host.querySelectorAll('.develop-template-module-item').forEach((node) => {
          node.classList.remove('is-drag-over', 'is-dragging');
        });
      });

      item.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (draggedIndex === null || draggedIndex === index) return;
        item.classList.add('is-drag-over');
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('is-drag-over');
      });
      item.addEventListener('drop', (event) => {
        event.preventDefault();
        item.classList.remove('is-drag-over');
        if (draggedIndex === null || draggedIndex === index) return;
        const [moved] = emailTemplateBlocksDraft.splice(draggedIndex, 1);
        const insertIndex = draggedIndex < index ? index - 1 : index;
        emailTemplateBlocksDraft.splice(insertIndex, 0, moved);
        renderEmailTemplateBlockEditor();
      });

      const fields = document.createElement('div');
      fields.className = 'develop-template-module-fields';

      const typeSelect = document.createElement('select');
      [
        ['eyebrow', 'Eyebrow'],
        ['heading', 'Heading'],
        ['paragraph', 'Paragraph'],
        ['image', 'Image'],
        ['button', 'Button'],
        ['divider', 'Divider'],
        ['spacer', 'Spacer'],
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        typeSelect.appendChild(option);
      });
      typeSelect.value = block.type;
      typeSelect.addEventListener('change', () => {
        block.type = safeText(typeSelect.value) || 'paragraph';
        renderEmailTemplateBlockEditor();
      });

      const textInput = document.createElement(block.type === 'paragraph' ? 'textarea' : 'input');
      textInput.className = 'develop-template-module-span';
      if (block.type === 'paragraph') textInput.rows = 3;
      textInput.placeholder = block.type === 'button' ? 'Button label' : 'Block text';
      textInput.value = safeText(block.text);
      textInput.addEventListener('input', () => {
        block.text = safeText(textInput.value);
      });

      fields.appendChild(typeSelect);

      if (block.type === 'button') {
        const urlInput = document.createElement('input');
        urlInput.placeholder = 'Button URL (optional)';
        urlInput.value = safeText(block.url);
        urlInput.addEventListener('input', () => {
          block.url = safeText(urlInput.value);
        });
        fields.appendChild(urlInput);
      } else if (block.type === 'image') {
        const sourceModeSelect = document.createElement('select');
        [
          ['gallery', 'Choose From Gallery'],
          ['url', 'Use URL'],
        ].forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          sourceModeSelect.appendChild(option);
        });
        sourceModeSelect.value = safeText(block.sourceMode) || 'gallery';
        sourceModeSelect.addEventListener('change', () => {
          block.sourceMode = safeText(sourceModeSelect.value) || 'gallery';
          renderEmailTemplateBlockEditor();
        });
        fields.appendChild(sourceModeSelect);
      } else {
        const filler = document.createElement('div');
        fields.appendChild(filler);
      }

      if (block.type === 'image') {
        const imageControls = document.createElement('div');
        imageControls.className = 'develop-template-module-span';

        const assetSelect = document.createElement('select');
        assetSelect.style.display = block.sourceMode === 'gallery' ? '' : 'none';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = getImageAssets().length ? 'Select Image Asset' : 'No image assets available yet';
        assetSelect.appendChild(placeholder);
        getImageAssets().forEach((asset) => {
          const option = document.createElement('option');
          option.value = safeText(asset.id);
          option.textContent = safeText(asset.assetName) || `Image ${asset.id}`;
          assetSelect.appendChild(option);
        });
        assetSelect.value = safeText(block.assetId);
        assetSelect.addEventListener('change', () => {
          block.assetId = safeText(assetSelect.value);
        });

        const urlInput = document.createElement('input');
        urlInput.placeholder = 'https://...';
        urlInput.style.display = block.sourceMode === 'url' ? '' : 'none';
        urlInput.value = safeText(block.url);
        urlInput.addEventListener('input', () => {
          block.url = safeText(urlInput.value);
        });

        const altInput = document.createElement('input');
        altInput.placeholder = 'Alt text';
        altInput.value = safeText(block.alt);
        altInput.addEventListener('input', () => {
          block.alt = safeText(altInput.value);
        });

        const uploadWrap = document.createElement('div');
        uploadWrap.className = 'page-heading-actions';
        uploadWrap.style.justifyContent = 'flex-start';
        uploadWrap.style.marginTop = '0.45rem';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.textContent = 'Upload Image';
        uploadBtn.addEventListener('click', async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) {
            notify('Choose an image file first', true);
            return;
          }
          try {
            uploadBtn.disabled = true;
            await uploadEmailTemplateBlockImage(file, block);
            renderEmailTemplateBlockEditor();
            notify('Image uploaded');
          } catch (err) {
            notify(err.message || 'Could not upload image', true);
          } finally {
            uploadBtn.disabled = false;
          }
        });
        uploadWrap.appendChild(fileInput);
        uploadWrap.appendChild(uploadBtn);

        const previewUrl = resolveEmailTemplateImageSource(block);
        const preview = document.createElement('div');
        preview.className = 'develop-template-module-span';
        preview.style.marginTop = '0.4rem';
        if (previewUrl) {
          preview.innerHTML = `<img src="${previewUrl}" alt="${safeText(block.alt) || 'Email image'}" style="display:block;max-width:240px;max-height:160px;height:auto;width:auto;border-radius:10px;border:1px solid rgba(15,79,143,0.16);" />`;
        } else {
          preview.innerHTML = '<div class="meta">No image selected yet.</div>';
        }

        imageControls.appendChild(assetSelect);
        imageControls.appendChild(urlInput);
        imageControls.appendChild(altInput);
        imageControls.appendChild(uploadWrap);
        imageControls.appendChild(preview);
        fields.appendChild(imageControls);
      } else if (!['divider', 'spacer'].includes(block.type)) {
        fields.appendChild(textInput);
      } else {
        const note = document.createElement('div');
        note.className = 'develop-template-module-span meta';
        note.textContent = block.type === 'divider'
          ? 'Divider adds a visual separator line.'
          : 'Spacer adds breathing room between blocks.';
        fields.appendChild(note);
      }

      const actions = document.createElement('div');
      actions.className = 'develop-template-module-actions develop-template-module-span';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.textContent = 'Move Up';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => {
        const prior = emailTemplateBlocksDraft[index - 1];
        emailTemplateBlocksDraft[index - 1] = block;
        emailTemplateBlocksDraft[index] = prior;
        renderEmailTemplateBlockEditor();
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.textContent = 'Move Down';
      downBtn.disabled = index === emailTemplateBlocksDraft.length - 1;
      downBtn.addEventListener('click', () => {
        const next = emailTemplateBlocksDraft[index + 1];
        emailTemplateBlocksDraft[index + 1] = block;
        emailTemplateBlocksDraft[index] = next;
        renderEmailTemplateBlockEditor();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        emailTemplateBlocksDraft.splice(index, 1);
        if (!emailTemplateBlocksDraft.length) {
          emailTemplateBlocksDraft.push(createEmailTemplateBlock('paragraph'));
        }
        renderEmailTemplateBlockEditor();
      });

      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(removeBtn);
      fields.appendChild(actions);

      item.appendChild(grip);
      item.appendChild(fields);
      host.appendChild(item);
    });
  }

  function renderFormTemplateLibrary() {
    const host = byId('developFormTemplatesLibrary');
    if (!host) return;
    host.innerHTML = '';
    FORM_TEMPLATES.forEach((template) => {
      const card = document.createElement('article');
      card.className = `develop-template-library-card${template.id === selectedFormTemplateId ? ' is-selected' : ''}`;
      const copyWrap = document.createElement('div');
      copyWrap.className = 'develop-template-library-copy';
      const mediaWrap = document.createElement('div');
      mediaWrap.className = 'develop-template-library-media';
      mediaWrap.innerHTML = `
        <div class="develop-template-preview-frame" aria-hidden="true">
          <div class="develop-template-preview-scale">
            ${buildFormTemplatePreviewMarkup(template)}
          </div>
        </div>
      `;
      const title = document.createElement('h3');
      title.textContent = template.name;
      const summary = document.createElement('p');
      summary.textContent = `${template.fields.length} fields · ${template.defaultSubmitLabel}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = template.id === selectedFormTemplateId ? 'Selected' : 'Use Template';
      button.addEventListener('click', () => {
        selectedFormTemplateId = template.id;
        renderFormTemplateLibrary();
        renderFormTemplatePreview(template.id);
      });
      const launchBtn = document.createElement('button');
      launchBtn.type = 'button';
      launchBtn.textContent = 'Open In Form Builder';
      launchBtn.addEventListener('click', () => {
        selectedFormTemplateId = template.id;
        renderFormTemplateLibrary();
        renderFormTemplatePreview(template.id);
        App.setActivePage('developFormsPage');
        openCreateFormEditor(template.id);
      });
      copyWrap.appendChild(title);
      copyWrap.appendChild(summary);
      copyWrap.appendChild(button);
      copyWrap.appendChild(launchBtn);
      card.appendChild(copyWrap);
      card.appendChild(mediaWrap);
      host.appendChild(card);
    });
  }

  function buildTemplatePreviewMarkup(template, canvasClass = '') {
    return `
      <div class="develop-template-canvas${canvasClass ? ` ${canvasClass}` : ''}">
        <div class="develop-template-banner">Page Banner Image</div>
        <div class="develop-template-hero">
          <div class="develop-template-copy">
            <div class="develop-template-eyebrow">${template.eyebrow}</div>
            <h3>${template.headline}</h3>
            <p>${template.lead}</p>
            <div class="develop-template-cta-row">
              <button type="button">${template.primaryCta}</button>
              <button type="button" class="develop-template-secondary-btn">${template.secondaryCta}</button>
            </div>
            <div class="develop-template-feature-grid">
              <div class="develop-template-feature-card">
                <div class="develop-template-image-slot">Feature Image</div>
                <h4>${template.featureOneTitle}</h4>
                <p>${template.featureOneCopy}</p>
              </div>
              <div class="develop-template-feature-card">
                <div class="develop-template-image-slot">Logo - Wide</div>
                <h4>${template.featureTwoTitle}</h4>
                <p>${template.featureTwoCopy}</p>
              </div>
            </div>
          </div>
          <aside class="develop-template-form-card">
            <div class="develop-template-logo-row">
              <div class="develop-template-logo-slot develop-template-logo-wide">Logo - Wide</div>
              <div class="develop-template-logo-slot develop-template-logo-square">Logo - Square</div>
            </div>
            <h3>${template.formTitle}</h3>
            <p>${template.formCopy}</p>
            <input type="text" placeholder="First Name" />
            <input type="email" placeholder="Email Address" />
            <input type="text" placeholder="Company" />
            <textarea rows="4" placeholder="What are you looking for?"></textarea>
            <button type="button">Submit Form</button>
          </aside>
        </div>
        <div class="develop-template-content">
          <div class="develop-template-body-copy">
            <h3>${template.bodyTitle}</h3>
            <p>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt
              ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
              laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in
              voluptate velit esse cillum dolore eu fugiat nulla pariatur.
            </p>
            <p>
              Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit
              anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium
              doloremque laudantium, totam rem aperiam.
            </p>
          </div>
          <div class="develop-template-side-image">Background Image / Supporting Visual</div>
        </div>
      </div>
    `;
  }

  function renderTemplateLibrary() {
    const host = byId('developTemplatesLibrary');
    if (!host) return;

    host.innerHTML = '';
    LANDING_TEMPLATES.forEach((template) => {
      const card = document.createElement('article');
      card.className = `develop-template-library-card${template.id === selectedTemplateId ? ' is-selected' : ''}`;

      const copyWrap = document.createElement('div');
      copyWrap.className = 'develop-template-library-copy';

      const mediaWrap = document.createElement('div');
      mediaWrap.className = 'develop-template-library-media';
      mediaWrap.innerHTML = `
        <div class="develop-template-preview-frame" aria-hidden="true">
          <div class="develop-template-preview-scale">
            ${buildTemplatePreviewMarkup(template, 'develop-template-canvas-mini')}
          </div>
        </div>
      `;

      const title = document.createElement('h3');
      title.textContent = template.name;

      const summary = document.createElement('p');
      summary.textContent = template.summary;

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = template.id === selectedTemplateId ? 'Selected' : 'Use Template';
      button.addEventListener('click', () => {
        selectedTemplateId = template.id;
        renderTemplateLibrary();
        renderTemplatePreview(template.id);
        const landingTemplateSelect = byId('developLandingTemplateSelect');
        if (landingTemplateSelect) landingTemplateSelect.value = template.id;
      });
      const launchBtn = document.createElement('button');
      launchBtn.type = 'button';
      launchBtn.textContent = 'Open In Page Builder';
      launchBtn.addEventListener('click', () => {
        selectedTemplateId = template.id;
        renderTemplateLibrary();
        renderTemplatePreview(template.id);
        const landingTemplateSelect = byId('developLandingTemplateSelect');
        if (landingTemplateSelect) landingTemplateSelect.value = template.id;
        openCreateLandingPage();
        setTimeout(() => {
          const select = byId('developLandingTemplateSelect');
          if (select) select.value = template.id;
        }, 120);
      });
      const manageBtn = document.createElement('button');
      manageBtn.type = 'button';
      manageBtn.textContent = 'Open Pages Gateway';
      manageBtn.addEventListener('click', () => {
        App.setActivePage('developManageLandingPagesPage');
      });

      copyWrap.appendChild(title);
      copyWrap.appendChild(summary);
      copyWrap.appendChild(button);
      copyWrap.appendChild(launchBtn);
      copyWrap.appendChild(manageBtn);
      card.appendChild(copyWrap);
      card.appendChild(mediaWrap);
      host.appendChild(card);
    });
  }

  async function loadLandingPageBuilderOptions() {
    if (!byId('developLandingTemplateSelect')) return;
    const [assetsResult, headlinesResult, subheadingsResult, pitchesResult, ctasResult] = await Promise.allSettled([
      api('/api/assets'),
      api('/api/messaging/headlines?limit=200'),
      api('/api/messaging/subheadings?limit=200'),
      api('/api/messaging/pitches?limit=200'),
      api('/api/messaging/ctas?limit=200'),
    ]);

    if (assetsResult.status !== 'fulfilled') {
      throw assetsResult.reason || new Error('Could not load assets');
    }

    state.assets = assetsResult.value.assets || [];

    landingPageHeadlines = headlinesResult.status === 'fulfilled'
      ? (Array.isArray(headlinesResult.value.headlines) ? headlinesResult.value.headlines : [])
      : [];
    landingPageSubheadings = subheadingsResult.status === 'fulfilled'
      ? (Array.isArray(subheadingsResult.value.subheadings) ? subheadingsResult.value.subheadings : [])
      : [];
    landingPagePitches = pitchesResult.status === 'fulfilled'
      ? (Array.isArray(pitchesResult.value.pitches) ? pitchesResult.value.pitches : [])
      : [];
    landingPageCtas = ctasResult.status === 'fulfilled'
      ? (Array.isArray(ctasResult.value.ctas) ? ctasResult.value.ctas : [])
      : [];

    setSelectOptions(
      byId('developLandingTemplateSelect'),
      LANDING_TEMPLATES.map((template) => ({ value: template.id, label: template.name })),
      'Template',
      selectedTemplateId
    );

    const landingPrimaryInput = byId('developLandingPrimaryColorInput');
    const landingBackgroundInput = byId('developLandingBackgroundColorInput');
    const landingAccentInput = byId('developLandingAccentColorInput');
    if (landingPrimaryInput) landingPrimaryInput.value = landingPageColors.primary;
    if (landingBackgroundInput) landingBackgroundInput.value = landingPageColors.background;
    if (landingAccentInput) landingAccentInput.value = landingPageColors.accent;

    renderLandingPageBuilderSelect('developLandingFormSelect', 'formId', savedForms.length ? 'Form' : 'Form (save a form first)');
    renderLandingPageBuilderSelect('developLandingLeadMagnetSelect', 'leadMagnetId', getLandingPageFieldRows('leadMagnetId').length ? 'PDF' : 'PDF (add assets with type "Lead Magnet")');
    renderLandingPageBuilderSelect('developLandingHeadlineSelect', 'headlineId', landingPageHeadlines.length ? 'Headline' : 'Headline (add Messaging > Headlines first)');
    renderLandingPageBuilderSelect('developLandingPitchSelect', 'pitchId', landingPagePitches.length ? 'Pitch' : 'Pitch (add Messaging > Pitches first)');
    renderLandingPageBuilderSelect('developLandingCtaSelect', 'ctaId', landingPageCtas.length ? 'CTA' : 'CTA (add Messaging > Calls to Action first)');
    renderLandingPageBuilderSelect('developLandingBannerImageSelect', 'websiteBannerImageId', getLandingPageFieldRows('websiteBannerImageId').length ? 'Website Banner Image' : 'Website Banner Image (add image assets in "Banner Image")');
    renderLandingPageBuilderSelect('developLandingBackgroundImageSelect', 'backgroundImageId', getLandingPageFieldRows('backgroundImageId').length ? 'Background Image' : 'Background Image (add image assets in "Background Image")');
    renderLandingPageBuilderSelect('developLandingFeatureImageSelect', 'featureImageId', getLandingPageFieldRows('featureImageId').length ? 'Feature Image' : 'Feature Image (add image assets in "Feature Image")');
    renderLandingPageBuilderSelect('developLandingHighlightImageSelect', 'highlightImageId', getLandingPageFieldRows('highlightImageId').length ? 'Highlight Image' : 'Highlight Image (add image assets in "Highlight Image")');
    renderLandingPageBuilderSelect('developLandingFeatureHeadlineSelect', 'featureHeadlineId', landingPageHeadlines.length ? 'Feature One Headline' : 'Feature One Headline (add Messaging > Headlines first)');
    renderLandingPageBuilderSelect('developLandingFeatureSubheadingSelect', 'featureSubheadingId', landingPageSubheadings.length ? 'Feature One Sub-heading' : 'Feature One Sub-heading (add Messaging > Sub-headings first)');
    renderLandingPageBuilderSelect('developLandingHighlightHeadlineSelect', 'highlightHeadlineId', landingPageHeadlines.length ? 'Feature Two Headline' : 'Feature Two Headline (add Messaging > Headlines first)');
    renderLandingPageBuilderSelect('developLandingHighlightPitchSelect', 'highlightPitchId', landingPagePitches.length ? 'Feature Two Pitch' : 'Feature Two Pitch (add Messaging > Pitches first)');
    renderLandingPageBuilderSelect('developLandingBodyHeadlineSelect', 'bodyHeadlineId', landingPageHeadlines.length ? 'Body Headline' : 'Body Headline (add Messaging > Headlines first)');
    renderLandingPageBuilderSelect('developLandingBodySubheadingSelect', 'bodySubheadingId', landingPageSubheadings.length ? 'Body Sub-heading' : 'Body Sub-heading (add Messaging > Sub-headings first)');
    renderLandingPageBuilderSelect('developLandingBodyPitchSelect', 'bodyPitchId', landingPagePitches.length ? 'Body Pitch' : 'Body Pitch (add Messaging > Pitches first)');
    renderLandingPageBuilderSelect('developLandingLogoSquareSelect', 'logoSquareId', getLandingPageFieldRows('logoSquareId').length ? 'Logo - Square' : 'Logo - Square (add image assets in "Logo - Square")');

    if (pendingLandingPageFormRecord) {
      applyLandingPageRecordToForm(pendingLandingPageFormRecord);
    }
  }

  async function refresh() {
    loadSavedAgents();
    await Promise.all([
      loadSavedForms(),
      loadSavedThemes(),
      loadSavedEmailTemplates(),
      loadSavedLandingPages(),
      loadSavedPageTemplates(),
      loadSavedExtensions(),
      loadExtensionManagerConfig(),
    ]);
    try {
      await loadLandingPageBuilderOptions();
    } catch (_) {
      await ensureAssetsLoaded().catch(() => {});
    }
    ensureFormBuilderState(formBuilderState?.formType || FORM_TEMPLATES[0].id);
    syncFormBuilderInputs();
    renderFormBuilderFieldConfig();
    renderFormBuilderPreview();
    renderSavedForms();
    renderThemesTable();
    syncThemesBuilder();
    renderThemesPreview();
    renderExtensionsLanding();
    populateExtensionParentSelect(byId('developExtensionIdInput')?.value);
    renderExtensionsTable();
    renderLandingPagesTable();
    renderFormTemplateRecordsTable();
    renderEmailTemplateTables();
    renderPageTemplateRecordsTable();
    renderLandingPageThankYouPage();
    renderThumbnailSourceAssetOptions();
    renderFormTemplateLibrary();
    renderFormTemplatePreview(selectedFormTemplateId);
    renderEmailTemplateLibrary();
    renderEmailTemplatePreview(selectedEmailTemplateId);
    resetEmailTemplateForm();
    renderTemplateLibrary();
    renderTemplatePreview(selectedTemplateId);
    renderSavedAgentsTable();
  }

  // ---------------------------------------------------------------------------
  // Request builders
  // ---------------------------------------------------------------------------

  function buildAgentsRequest(formData) {
    const action          = String(formData.get('action') || 'create_job');
    const manualConfirmed = formData.get('manual_confirmed') === 'on';
    const payload         = parseJsonInput(formData.get('payload_json'), {});
    const requestedBy     = {
      user_id: String(formData.get('requested_by_user_id') || '').trim() || 'alphire-ui',
      email:   String(formData.get('requested_by_email')   || '').trim() || 'ops@alphire.ai'
    };
    const jobId = String(formData.get('job_id') || '').trim();

    if (!manualConfirmed) throw new Error('Manual confirmation is required');

    const request = { manual_confirmed: true };

    if (action === 'create_job') {
      request.type         = String(formData.get('type')         || '').trim() || 'acquire.web';
      request.workspace_id = String(formData.get('workspace_id') || '').trim() || 'alphire-main';
      request.requested_by = requestedBy;
      request.payload      = payload;
      request.policy       = { requires_manual_approval: true };
      return { action, request };
    }

    if (!jobId) throw new Error('job_id is required for this action');
    request.job_id = jobId;

    if (action === 'preview_job') {
      request.requested_by = requestedBy;
      request.options      = { include_confidence: true, sample_size: 25 };
      return { action, request };
    }
    if (action === 'approve_job') {
      request.decision    = String(formData.get('approval_decision') || 'APPROVE');
      request.approver    = requestedBy;
      request.comment     = String(formData.get('approval_comment') || '').trim();
      request.constraints = { expires_in_minutes: 30 };
      return { action, request };
    }
    if (action === 'execute_job') {
      const approvalToken = String(formData.get('approval_token') || '').trim();
      if (!approvalToken) throw new Error('approval_token is required for execute_job');
      request.requested_by  = requestedBy;
      request.approval_token = approvalToken;
      request.execution     = { priority: 'normal', dry_run: false };
      return { action, request };
    }
    if (action === 'job_status') return { action, request };

    throw new Error('Unsupported action');
  }

  // ---------------------------------------------------------------------------
  // Init — wire up form handlers
  // ---------------------------------------------------------------------------

  function init() {
    const formIdInput = byId('developFormIdInput');
    const formNameInput = byId('developFormNameInput');
    const emailTemplateForm = byId('developEmailTemplateForm');
    const templateEditorIdInput = byId('developTemplateEditorIdInput');
    const emailTemplateNameInput = byId('developEmailTemplateNameInput');
    const templateEditorNameInput = byId('developTemplateEditorNameInput');
    const templateEditorSlugInput = byId('developTemplateEditorSlugInput');
    const templateEditorSummaryInput = byId('developTemplateEditorSummaryInput');
    const templateEditorSubjectInput = byId('developTemplateEditorSubjectInput');
    const templateEditorCtaInput = byId('developTemplateEditorCtaInput');
    const landingPreviewAction = byId('developLandingPagePreviewAction');
    const openCreateFormBtn = byId('developOpenCreateFormBtn');
    const cancelFormEditBtn = byId('developCancelFormEditBtn');
    const formTypeSelect = byId('developFormTypeSelect');
    const formContactTypeSelect = byId('developFormContactTypeSelect');
    const formLeadMagnetTypeSelect = byId('developFormLeadMagnetTypeSelect');
    const formLeadMagnetSelect = byId('developFormLeadMagnetSelect');
    const formCtaSelect = byId('developFormCtaSelect');
    const formHeadingInput = byId('developFormHeadingInput');
    const formSuccessMessageInput = byId('developFormSuccessMessageInput');
    const themesBuilderToggleBtn = byId('developThemesBuilderToggleBtn');
    const themesCreateBtn = byId('developThemesCreateBtn');
    const themesThemeSelect = byId('developThemesThemeSelect');
    const themesNewBtn = byId('developThemesNewBtn');
    const themesSaveBtn = byId('developThemesSaveBtn');
    const themesDeleteBtn = byId('developThemesDeleteBtn');
    const agentsSavePresetBtn = byId('developAgentsSavePresetBtn');
    const agentsClonePresetBtn = byId('developAgentsClonePresetBtn');

    if (themesBuilderToggleBtn) {
      themesBuilderToggleBtn.addEventListener('click', () => {
        const nextExpanded = themesBuilderToggleBtn.getAttribute('aria-expanded') !== 'true';
        setThemesBuilderVisible(nextExpanded);
      });
    }

    if (themesCreateBtn) {
      themesCreateBtn.addEventListener('click', () => {
        openThemesBuilder();
      });
    }

    if (themesThemeSelect) {
      themesThemeSelect.addEventListener('change', () => {
        selectedThemeId = safeText(themesThemeSelect.value);
        const selected = getThemeById(selectedThemeId);
        if (selected) applyThemeToBuilder(selected);
        else resetThemeBuilder();
        renderThemesPreview();
      });
    }

    if (themesNewBtn) {
      themesNewBtn.addEventListener('click', () => {
        resetThemeBuilder();
        setThemesBuilderVisible(true);
      });
    }

    [
      'developThemesNameInput',
      'developThemesPrimaryColorInput',
      'developThemesBackgroundColorInput',
      'developThemesAccentColorInput',
      'developThemesLogoWideSelect',
      'developThemesLogoSquareSelect',
      'developThemesFeatureImageSelect',
      'developThemesBackgroundImageSelect',
    ].forEach((id) => {
      const node = byId(id);
      if (!node) return;
      node.addEventListener('input', () => {
        if (id.endsWith('Select')) renderThemeAssetPickerDisplay(id);
        renderThemesPreview();
      });
      node.addEventListener('change', () => {
        if (id.endsWith('Select')) renderThemeAssetPickerDisplay(id);
        renderThemesPreview();
      });
    });

    [
      'developThemesBorderThicknessInput',
      'developThemesBorderRadiusInput',
      'developThemesContainerBlurInput',
      'developThemesContrastLevelInput',
    ].forEach((id) => {
      const input = byId(id);
      if (!input) return;
      input.addEventListener('input', () => {
        syncThemeRangeLabels();
        renderThemesPreview();
      });
      input.addEventListener('change', () => {
        syncThemeRangeLabels();
        renderThemesPreview();
      });
    });

    [
      ['developThemesLogoWidePickerBtn', 'developThemesLogoWideSelect'],
      ['developThemesLogoSquarePickerBtn', 'developThemesLogoSquareSelect'],
      ['developThemesFeatureImagePickerBtn', 'developThemesFeatureImageSelect'],
      ['developThemesBackgroundImagePickerBtn', 'developThemesBackgroundImageSelect'],
    ].forEach(([buttonId, selectId]) => {
      const button = byId(buttonId);
      if (!button) return;
      button.addEventListener('click', () => {
        openThemeAssetPicker(selectId);
      });
    });

    [
      ['developLandingBannerImagePickerBtn', 'developLandingBannerImageSelect'],
      ['developLandingBackgroundImagePickerBtn', 'developLandingBackgroundImageSelect'],
      ['developLandingFeatureImagePickerBtn', 'developLandingFeatureImageSelect'],
      ['developLandingHighlightImagePickerBtn', 'developLandingHighlightImageSelect'],
      ['developLandingLogoSquarePickerBtn', 'developLandingLogoSquareSelect'],
    ].forEach(([buttonId, selectId]) => {
      const button = byId(buttonId);
      if (!button) return;
      button.addEventListener('click', () => {
        openLandingAssetPicker(selectId);
      });
    });

    if (themesSaveBtn) {
      themesSaveBtn.addEventListener('click', async () => {
        const payload = buildThemePayload();
        if (!payload.name) {
          notify('Theme name is required', true);
          return;
        }
        try {
          const current = getThemeById(selectedThemeId);
          const endpoint = current?.id
            ? `/api/develop/themes/${encodeURIComponent(current.id)}`
            : '/api/develop/themes';
          const method = current?.id ? 'PATCH' : 'POST';
          const result = await api(endpoint, { method, body: JSON.stringify(payload) });
          const saved = result.theme || result.data?.theme || result.data || null;
          selectedThemeId = safeText(saved?.id) || selectedThemeId;
          await refresh();
          notify(current?.id ? 'Theme updated' : 'Theme created');
          setThemesBuilderVisible(true);
        } catch (err) {
          notify(err.message || 'Could not save theme', true);
        }
      });
    }

    if (themesDeleteBtn) {
      themesDeleteBtn.addEventListener('click', async () => {
        const current = getThemeById(selectedThemeId);
        if (!current?.id) {
          resetThemeBuilder();
          return;
        }
        if (!window.confirm(`Delete theme "${safeText(current.name) || current.id}"?`)) return;
        try {
          await api(`/api/develop/themes/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
          selectedThemeId = '';
          await refresh();
          resetThemeBuilder();
          notify('Theme deleted');
        } catch (err) {
          notify(err.message || 'Could not delete theme', true);
        }
      });
    }

    if (agentsSavePresetBtn) {
      agentsSavePresetBtn.addEventListener('click', () => {
        try {
          saveAgentPresetFromForm({ clone: false });
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (agentsClonePresetBtn) {
      agentsClonePresetBtn.addEventListener('click', () => {
        try {
          saveAgentPresetFromForm({ clone: true });
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (landingPreviewAction && typeof App.makeIconButton === 'function') {
      landingPreviewAction.innerHTML = '';
      landingPreviewAction.appendChild(
        App.makeIconButton('preview', 'Preview Page', () => {
          previewCurrentLandingPageForm();
        }, { primary: true })
      );
    }

    const templateEditorCloseBtn = byId('developTemplateEditorCloseBtn');
    if (templateEditorCloseBtn) {
      templateEditorCloseBtn.addEventListener('click', () => {
        setEmailTemplateEditorVisible(false);
      });
    }

    bindCollapsibleSection('developTemplateEditorToggle', 'developTemplateEditorBody', { defaultExpanded: false });
    bindCollapsibleSection('developFormsSectionToggle', 'developFormsSectionBody', { defaultExpanded: false });
    bindCollapsibleSection('developEmailSectionToggle', 'developEmailSectionBody', { defaultExpanded: false });
    bindCollapsibleSection('developPagesSectionToggle', 'developPagesSectionBody', { defaultExpanded: false });

    const templateEditorToolbar = byId('developTemplateEditorToolbar');
    if (templateEditorToolbar) {
      templateEditorToolbar.querySelectorAll('button[data-block-type]').forEach((button) => {
        button.addEventListener('click', () => {
          const type = safeText(button.getAttribute('data-block-type')) || 'paragraph';
          emailTemplateBlocksDraft.push(createEmailTemplateBlock(type));
          renderEmailTemplateBlockEditor();
        });
      });
    }

    if (emailTemplateForm) {
      emailTemplateForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const derivedHeading = emailTemplateBlocksDraft.find((block) => block.type === 'heading')?.text || '';
        const derivedBody = emailTemplateBlocksDraft.find((block) => block.type === 'paragraph')?.text || '';
        const derivedCta = emailTemplateBlocksDraft.find((block) => block.type === 'button')?.text || '';
        const id = safeText(byId('developEmailTemplateIdInput')?.value);
        const payload = {
          templateKind: 'text',
          name: safeText(byId('developEmailTemplateNameInput')?.value),
          slug: safeText(byId('developEmailTemplateSlugInput')?.value) || slugify(byId('developEmailTemplateNameInput')?.value),
          summary: safeText(byId('developEmailTemplateSummaryInput')?.value),
          subject: safeText(byId('developEmailTemplateSubjectInput')?.value),
          heading: safeText(byId('developEmailTemplateHeadingInput')?.value) || derivedHeading,
          body: safeText(byId('developEmailTemplateBodyInput')?.value) || derivedBody,
          cta: safeText(byId('developEmailTemplateCtaInput')?.value) || derivedCta,
          blocks: [],
        };
        if (!payload.name) {
          notify('Template name is required', true);
          return;
        }
        try {
          const endpoint = id
            ? `/api/develop/email-templates/${encodeURIComponent(id)}`
            : '/api/develop/email-templates';
          const method = id ? 'PATCH' : 'POST';
          await api(endpoint, { method, body: JSON.stringify(payload) });
          notify(id ? 'Email template updated' : 'Email template created');
          await refresh();
        } catch (err) {
          notify(err.message || 'Could not save email template', true);
        }
      });
    }

    const saveModularTemplate = async () => {
      const derivedHeading = emailTemplateBlocksDraft.find((block) => block.type === 'heading')?.text || '';
      const derivedBody = emailTemplateBlocksDraft.find((block) => block.type === 'paragraph')?.text || '';
      const derivedCta = emailTemplateBlocksDraft.find((block) => block.type === 'button')?.text || '';
      const id = safeText(templateEditorIdInput?.value);
      const name = safeText(templateEditorNameInput?.value);
      const slug = safeText(templateEditorSlugInput?.value) || slugify(templateEditorNameInput?.value);
      const summary = safeText(templateEditorSummaryInput?.value);
      const subject = safeText(templateEditorSubjectInput?.value);
      const cta = safeText(templateEditorCtaInput?.value) || derivedCta;
      const payload = {
        templateKind: 'modular',
        name,
        slug,
        summary,
        subject,
        heading: derivedHeading,
        body: derivedBody,
        cta,
        blocks: emailTemplateBlocksDraft.map((block) => ({
          id: safeText(block.id),
          type: safeText(block.type),
          text: safeText(block.text),
          url: safeText(block.url),
          sourceMode: safeText(block.sourceMode),
          assetId: safeText(block.assetId),
          alt: safeText(block.alt),
        })),
      };
      if (!payload.name) {
        notify('Template name is required', true);
        return;
      }
      try {
        const endpoint = id
          ? `/api/develop/email-templates/${encodeURIComponent(id)}`
          : '/api/develop/email-templates';
        const method = id ? 'PATCH' : 'POST';
        await api(endpoint, { method, body: JSON.stringify(payload) });
        notify(id ? 'Modular email template updated' : 'Modular email template created');
        await refresh();
      } catch (err) {
        notify(err.message || 'Could not save modular email template', true);
      }
    };

    const bindModularSaveButton = (button) => {
      if (!button) return;
      button.addEventListener('click', saveModularTemplate);
    };
    bindModularSaveButton(byId('developTemplateEditorSaveBtnTop'));
    bindModularSaveButton(byId('developTemplateEditorSaveBtnBottom'));

    const bindResetEmailTemplate = (button) => {
      if (!button) return;
      button.addEventListener('click', () => {
        resetEmailTemplateForm();
      });
    };
    bindResetEmailTemplate(byId('developEmailTemplateResetBtn'));
    bindResetEmailTemplate(byId('developEmailTemplateResetBtnTop'));
    const formErrorMessageInput = byId('developFormErrorMessageInput');
    const formAccentInput = byId('developFormAccentColorInput');
    const formMatchLandingInput = byId('developFormMatchLandingColorInput');
    const formLandingColorModeSelect = byId('developFormLandingColorModeSelect');
    const formUseLandingBackgroundInput = byId('developFormUseLandingBackgroundInput');
    const formBuilderForm = byId('developFormBuilderForm');
    const landingTemplateSelect = byId('developLandingTemplateSelect');
    const landingPrimaryInput = byId('developLandingPrimaryColorInput');
    const landingBackgroundInput = byId('developLandingBackgroundColorInput');
    const landingAccentInput = byId('developLandingAccentColorInput');

    if (openCreateFormBtn) {
      openCreateFormBtn.addEventListener('click', () => {
        openCreateFormEditor();
      });
    }

    if (cancelFormEditBtn) {
      cancelFormEditBtn.addEventListener('click', () => {
        closeFormEditor();
      });
    }

    if (formNameInput) {
      formNameInput.addEventListener('input', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.name = safeText(formNameInput.value);
      });
    }

    if (formTypeSelect) {
      formTypeSelect.addEventListener('change', () => {
        const next = buildDefaultFormState(formTypeSelect.value || FORM_TEMPLATES[0].id);
        next.id = safeText(formIdInput?.value);
        next.name = safeText(formNameInput?.value);
        next.leadMagnetType = safeText(formLeadMagnetTypeSelect?.value);
        next.leadMagnetId = safeText(formLeadMagnetSelect?.value);
        next.ctaId = safeText(formCtaSelect?.value);
        next.successMessage = safeText(formSuccessMessageInput?.value) || next.successMessage;
        next.errorMessage = safeText(formErrorMessageInput?.value) || next.errorMessage;
        formBuilderState = next;
        syncFormBuilderInputs();
        renderFormBuilderFieldConfig();
        renderFormBuilderPreview();
      });
    }

    if (formContactTypeSelect) {
      setSelectOptions(
        formContactTypeSelect,
        CONTACT_TYPE_OPTIONS,
        'Contact Type',
        ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id).contactType
      );
      formContactTypeSelect.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.contactType = safeText(formContactTypeSelect.value) || 'lead';
      });
    }

    if (formLeadMagnetSelect) {
      formLeadMagnetSelect.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.leadMagnetId = safeText(formLeadMagnetSelect.value);
        renderFormBuilderPreview();
      });
    }

    if (formLeadMagnetTypeSelect) {
      formLeadMagnetTypeSelect.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.leadMagnetType = safeText(formLeadMagnetTypeSelect.value);
        current.leadMagnetId = '';
        syncFormBuilderInputs();
        renderFormBuilderPreview();
      });
    }

    if (formCtaSelect) {
      formCtaSelect.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.ctaId = safeText(formCtaSelect.value);
        renderFormBuilderPreview();
      });
    }

    if (formHeadingInput) {
      formHeadingInput.addEventListener('input', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.heading = safeText(formHeadingInput.value) || getFormTemplateById(current.formType).defaultHeading;
        renderFormBuilderPreview();
      });
    }

    if (formSuccessMessageInput) {
      formSuccessMessageInput.addEventListener('input', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.successMessage = safeText(formSuccessMessageInput.value);
      });
    }

    if (formErrorMessageInput) {
      formErrorMessageInput.addEventListener('input', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.errorMessage = safeText(formErrorMessageInput.value);
      });
    }

    if (formAccentInput) {
      formAccentInput.addEventListener('input', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.accentColor = safeText(formAccentInput.value) || DEFAULT_FORM_ACCENT;
        renderFormBuilderPreview();
      });
    }

    if (formMatchLandingInput) {
      formMatchLandingInput.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.matchLandingColor = formMatchLandingInput.checked;
        syncFormBuilderInputs();
        renderFormBuilderPreview();
      });
    }

    if (formLandingColorModeSelect) {
      formLandingColorModeSelect.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.landingColorMode = safeText(formLandingColorModeSelect.value) || 'primary';
        renderFormBuilderPreview();
      });
    }

    if (formUseLandingBackgroundInput) {
      formUseLandingBackgroundInput.addEventListener('change', () => {
        const current = ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id);
        current.useLandingBackground = formUseLandingBackgroundInput.checked;
        renderFormBuilderPreview();
      });
    }

    if (landingPrimaryInput) {
      landingPrimaryInput.addEventListener('input', () => {
        landingPageColors.primary = safeText(landingPrimaryInput.value) || '#0b82d4';
        updateLandingPageFieldOutlines();
        if (ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id).matchLandingColor) {
          renderFormBuilderPreview();
        }
      });
    }

    if (landingBackgroundInput) {
      landingBackgroundInput.addEventListener('input', () => {
        landingPageColors.background = safeText(landingBackgroundInput.value) || '#f5fbff';
        updateLandingPageFieldOutlines();
        if (ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id).matchLandingColor
          && ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id).useLandingBackground) {
          renderFormBuilderPreview();
        }
      });
    }

    if (landingAccentInput) {
      landingAccentInput.addEventListener('input', () => {
        landingPageColors.accent = safeText(landingAccentInput.value) || '#1a4f81';
        updateLandingPageFieldOutlines();
        if (ensureFormBuilderState(formTypeSelect?.value || FORM_TEMPLATES[0].id).matchLandingColor) {
          renderFormBuilderPreview();
        }
      });
    }

    if (landingTemplateSelect) {
      landingTemplateSelect.addEventListener('change', () => {
        selectedTemplateId = safeText(landingTemplateSelect.value) || LANDING_TEMPLATES[0].id;
        renderTemplateLibrary();
        renderTemplatePreview(selectedTemplateId);
        updateLandingPageFieldOutlines();
      });
    }

    if (els.developLandingPagesForm) {
      els.developLandingPagesForm.querySelectorAll('input, select, textarea').forEach((field) => {
        if (!field || field.type === 'hidden') return;
        field.addEventListener('input', () => {
          updateLandingPageFieldOutlines();
        });
        field.addEventListener('change', () => {
          updateLandingPageFieldOutlines();
        });
      });
    }

    const openCreateLandingPageBtn = byId('developOpenCreateLandingPageBtn');
    if (openCreateLandingPageBtn) {
      openCreateLandingPageBtn.addEventListener('click', () => {
        openCreateLandingPage();
      });
    }

    const createPageTemplateBtn = byId('developCreatePageTemplateBtn');
    if (createPageTemplateBtn) {
      createPageTemplateBtn.addEventListener('click', () => {
        openCreateLandingTemplate();
      });
    }

    const visualSaveBtn = byId('developLandingPageVisualSaveBtn');
    const visualModeBtn = byId('developLandingPageVisualModeBtn');
    const visualBackBtn = byId('developLandingPageVisualBackBtn');
    const previewModeBtn = byId('developLandingPagePreviewModeBtn');
    const previewBackBtn = byId('developLandingPagePreviewBackBtn');
    const thankYouBackBtn = byId('developLandingThankYouBackBtn');
    const saveSelectorDefaultsBtn = byId('developLandingSaveSelectorDefaultsBtn');

    if (saveSelectorDefaultsBtn) {
      saveSelectorDefaultsBtn.addEventListener('click', () => {
        saveLandingPageSelectorDefaults();
      });
    }

    if (visualModeBtn) {
      visualModeBtn.addEventListener('click', () => {
        landingPageVisualEditMode = !landingPageVisualEditMode;
        if (!landingPageVisualEditMode) {
          activeLandingPageVisualEditors.clear();
        }
        renderLandingPageVisualEditor();
      });
    }

    if (previewModeBtn) {
      previewModeBtn.addEventListener('click', () => {
        if (!activeLandingPagePreviewRecord) {
          notify('Open a page preview first', true);
          return;
        }
        openLandingPageVisualEditor(activeLandingPagePreviewRecord, { mode: activeLandingPagePreviewMode });
      });
    }

    if (previewBackBtn) {
      previewBackBtn.addEventListener('click', () => {
        App.setActivePage(activeLandingPagePreviewMode === 'template' ? 'developTemplatesPage' : 'developManageLandingPagesPage');
      });
    }

    if (visualBackBtn) {
      visualBackBtn.addEventListener('click', () => {
        App.setActivePage(activeLandingPageVisualMode === 'template' ? 'developTemplatesPage' : 'developManageLandingPagesPage');
      });
    }

    if (thankYouBackBtn) {
      thankYouBackBtn.addEventListener('click', () => {
        if (activeLandingPagePreviewRecord) {
          App.setActivePage('developLandingPagePreviewPage');
        } else {
          App.setActivePage('developManageLandingPagesPage');
        }
      });
    }

    if (visualSaveBtn) {
      visualSaveBtn.addEventListener('click', async () => {
        const record = getActiveLandingPageVisualRecord();
        if (!record) {
          notify('Open an item in the visual editor first', true);
          return;
        }
        try {
          const endpointBase = activeLandingPageVisualMode === 'template'
            ? '/api/develop/page-templates'
            : '/api/develop/landing-pages';
          const hasId = Boolean(safeText(record.id));
          const result = await api(hasId ? `${endpointBase}/${encodeURIComponent(record.id)}` : endpointBase, {
            method: hasId ? 'PATCH' : 'POST',
            body: JSON.stringify({
              name: safeText(record.name),
              templateId: safeText(record.templateId),
              primaryColor: safeText(record.primaryColor),
              backgroundColor: safeText(record.backgroundColor),
              accentColor: safeText(record.accentColor),
              formId: safeText(record.formId),
              leadMagnetId: safeText(record.leadMagnetId),
              headlineId: safeText(record.headlineId),
              pitchId: safeText(record.pitchId),
              ctaId: safeText(record.ctaId),
              websiteBannerImageId: safeText(record.websiteBannerImageId),
              backgroundImageId: safeText(record.backgroundImageId),
              featureImageId: safeText(record.featureImageId),
              highlightImageId: safeText(record.highlightImageId),
              featureHeadlineId: safeText(record.featureHeadlineId),
              featureSubheadingId: safeText(record.featureSubheadingId),
              featureTitle: safeText(record.featureTitle, 500),
              featureCopy: safeText(record.featureCopy, 5000),
              highlightHeadlineId: safeText(record.highlightHeadlineId),
              highlightPitchId: safeText(record.highlightPitchId),
              highlightTitle: safeText(record.highlightTitle, 500),
              highlightCopy: safeText(record.highlightCopy, 5000),
              bodyHeadlineId: safeText(record.bodyHeadlineId),
              bodySubheadingId: safeText(record.bodySubheadingId),
              bodyPitchId: safeText(record.bodyPitchId),
              logoWideId: safeText(record.logoWideId),
              logoSquareId: safeText(record.logoSquareId),
              contentOverrides: normalizeLandingPageContentOverrides(record.contentOverrides),
            }),
          });
          activeLandingPageVisualRecord = result?.landingPage || result?.pageTemplate || result?.data || record;
          landingPageVisualDraft = {};
          await refresh();
          renderLandingPageVisualEditor();
          notify(activeLandingPageVisualMode === 'template'
            ? (hasId ? 'Page template updated' : 'Page template created')
            : (hasId ? 'Landing page updated' : 'Landing page created'));
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    const landingPageNameFilter = byId('developLandingPagesNameFilter');
    const landingPageTemplateFilter = byId('developLandingPagesTemplateFilter');
    const landingPageSelectAll = byId('developLandingPagesSelectAllVisible');
    const landingPageBulkEditBtn = byId('developLandingPagesBulkEditBtn');
    const landingPageBulkEditForm = byId('developLandingPagesBulkEditForm');
    const landingPageBulkEditSummary = byId('developLandingPagesBulkEditSummary');
    const landingPageBackFromBulkEditBtn = byId('developLandingPagesBackFromBulkEditBtn');

    if (landingPageNameFilter) {
      landingPageNameFilter.addEventListener('input', () => {
        landingPageTableState.filters.name = safeText(landingPageNameFilter.value);
        renderLandingPagesTable();
      });
    }

    if (landingPageTemplateFilter) {
      landingPageTemplateFilter.addEventListener('change', () => {
        landingPageTableState.filters.templateId = safeText(landingPageTemplateFilter.value);
        renderLandingPagesTable();
      });
    }

    [
      ['developLandingPagesSortNameBtn', 'name', 'asc'],
      ['developLandingPagesSortTemplateBtn', 'templateId', 'asc'],
      ['developLandingPagesSortHeadlineBtn', 'headlineId', 'asc'],
      ['developLandingPagesSortFormBtn', 'formId', 'asc'],
      ['developLandingPagesSortUpdatedBtn', 'updatedAt', 'desc'],
    ].forEach(([id, key, defaultDir]) => {
      const button = byId(id);
      if (!button) return;
      button.addEventListener('click', () => {
        if (landingPageTableState.sort.key === key) {
          landingPageTableState.sort.dir = landingPageTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          landingPageTableState.sort.key = key;
          landingPageTableState.sort.dir = defaultDir;
        }
        renderLandingPagesTable();
      });
    });

    if (landingPageSelectAll) {
      landingPageSelectAll.addEventListener('change', () => {
        const visibleIds = getFilteredSortedLandingPages().map((item) => safeText(item.id)).filter(Boolean);
        if (landingPageSelectAll.checked) visibleIds.forEach((id) => selectedLandingPageIds.add(id));
        else visibleIds.forEach((id) => selectedLandingPageIds.delete(id));
        renderLandingPagesTable();
      });
    }

    if (landingPageBulkEditBtn) {
      landingPageBulkEditBtn.addEventListener('click', () => {
        const ids = Array.from(selectedLandingPageIds);
        if (!ids.length) {
          notify('Select at least one page first', true);
          return;
        }
        if (landingPageBulkEditSummary) {
          landingPageBulkEditSummary.textContent = `${ids.length} page${ids.length === 1 ? '' : 's'} selected.`;
        }
        setSelectOptions(
          byId('developLandingPagesBulkTemplateSelect'),
          LANDING_TEMPLATES.map((template) => ({ value: template.id, label: template.name })),
          'Leave Unchanged'
        );
        const applyPrimary = byId('developLandingPagesBulkApplyPrimaryColor');
        const applyBackground = byId('developLandingPagesBulkApplyBackgroundColor');
        const applyAccent = byId('developLandingPagesBulkApplyAccentColor');
        const bulkPrimary = byId('developLandingPagesBulkPrimaryColorInput');
        const bulkBackground = byId('developLandingPagesBulkBackgroundColorInput');
        const bulkAccent = byId('developLandingPagesBulkAccentColorInput');
        if (applyPrimary) applyPrimary.checked = false;
        if (applyBackground) applyBackground.checked = false;
        if (applyAccent) applyAccent.checked = false;
        if (bulkPrimary) bulkPrimary.value = DEFAULT_LANDING_PRIMARY;
        if (bulkBackground) bulkBackground.value = DEFAULT_LANDING_BACKGROUND;
        if (bulkAccent) bulkAccent.value = DEFAULT_LANDING_ACCENT;
        App.setActivePage('developLandingPagesBulkEditPage');
      });
    }

    if (landingPageBackFromBulkEditBtn) {
      landingPageBackFromBulkEditBtn.addEventListener('click', () => {
        App.setActivePage('developManageLandingPagesPage');
      });
    }

    if (landingPageBulkEditForm) {
      landingPageBulkEditForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ids = Array.from(selectedLandingPageIds);
        if (!ids.length) {
          notify('Select at least one page first', true);
          return;
        }
        const formData = new FormData(landingPageBulkEditForm);
        const nextTemplateId = safeText(formData.get('template_id'));
        const applyPrimary = formData.get('apply_primary_color') === 'on';
        const applyBackground = formData.get('apply_background_color') === 'on';
        const applyAccent = formData.get('apply_accent_color') === 'on';

        if (!nextTemplateId && !applyPrimary && !applyBackground && !applyAccent) {
          notify('Choose at least one field to update', true);
          return;
        }

        try {
          for (const id of ids) {
            const item = savedLandingPages.find((entry) => safeText(entry.id) === id);
            if (!item) continue;
            await api(`/api/develop/landing-pages/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              body: JSON.stringify({
                name: safeText(item.name),
                templateId: nextTemplateId || safeText(item.templateId),
                primaryColor: applyPrimary ? safeText(formData.get('primary_color')) : safeText(item.primaryColor),
                backgroundColor: applyBackground ? safeText(formData.get('background_color')) : safeText(item.backgroundColor),
                accentColor: applyAccent ? safeText(formData.get('accent_color')) : safeText(item.accentColor),
                formId: safeText(item.formId),
                leadMagnetId: safeText(item.leadMagnetId),
                headlineId: safeText(item.headlineId),
                pitchId: safeText(item.pitchId),
                ctaId: safeText(item.ctaId),
                websiteBannerImageId: safeText(item.websiteBannerImageId),
                backgroundImageId: safeText(item.backgroundImageId),
                featureImageId: safeText(item.featureImageId),
                highlightImageId: safeText(item.highlightImageId),
                featureHeadlineId: safeText(item.featureHeadlineId),
                featureSubheadingId: safeText(item.featureSubheadingId),
                featureTitle: safeText(item.featureTitle, 500),
                featureCopy: safeText(item.featureCopy, 5000),
                highlightHeadlineId: safeText(item.highlightHeadlineId),
                highlightPitchId: safeText(item.highlightPitchId),
                highlightTitle: safeText(item.highlightTitle, 500),
                highlightCopy: safeText(item.highlightCopy, 5000),
                bodyHeadlineId: safeText(item.bodyHeadlineId),
                bodySubheadingId: safeText(item.bodySubheadingId),
                bodyPitchId: safeText(item.bodyPitchId),
                logoWideId: safeText(item.logoWideId),
                logoSquareId: safeText(item.logoSquareId),
                contentOverrides: normalizeLandingPageContentOverrides(item.contentOverrides),
              }),
            });
          }
          selectedLandingPageIds = new Set();
          await refresh();
          notify('Landing pages updated');
          App.setActivePage('developManageLandingPagesPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (formBuilderForm) {
      formBuilderForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const payload = buildCurrentFormPayload();
          if (!payload.name) throw new Error('Form name is required');
          if (!payload.heading) throw new Error('Heading is required');
          if (!payload.successMessage) throw new Error('Success confirmation message is required');
          if (!payload.errorMessage) throw new Error('Error confirmation message is required');
          if (payload.id) {
            await api(`/api/develop/forms/${encodeURIComponent(payload.id)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
            notify('Form updated');
          } else {
            await api('/api/develop/forms', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            notify('Form created');
          }
          await refresh();
          closeFormEditor();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    [
      ['developFormsSortNameBtn', 'name', 'asc'],
      ['developFormsSortTypeBtn', 'formType', 'asc'],
      ['developFormsSortLeadMagnetTypeBtn', 'leadMagnetType', 'asc'],
      ['developFormsSortLeadMagnetBtn', 'leadMagnetId', 'asc'],
      ['developFormsSortCtaBtn', 'ctaId', 'asc'],
      ['developFormsSortContactTypeBtn', 'contactType', 'asc'],
      ['developFormsSortUpdatedBtn', 'updatedAt', 'desc'],
    ].forEach(([id, key, defaultDir]) => {
      const button = byId(id);
      if (!button) return;
      button.addEventListener('click', () => {
        if (formTableState.sort.key === key) {
          formTableState.sort.dir = formTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          formTableState.sort.key = key;
          formTableState.sort.dir = defaultDir;
        }
        renderSavedForms();
      });
    });

    const extensionManagerForm = byId('developExtensionManagerForm');
    const extensionResetBtn = byId('developExtensionResetBtn');
    const extensionNameFilter = byId('developExtensionsFilterName');
    const extensionTypeFilter = byId('developExtensionsFilterType');
    const extensionStatusFilter = byId('developExtensionsFilterStatus');
    const extensionTagsFilter = byId('developExtensionsFilterTags');

    if (extensionResetBtn) {
      extensionResetBtn.addEventListener('click', () => {
        resetExtensionManagerForm();
      });
    }

    if (extensionManagerForm) {
      extensionManagerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(extensionManagerForm);
          const extensionId = safeText(formData.get('extension_id'));
          const existing = savedExtensions.find((item) => safeText(item.id) === extensionId) || null;
          const payload = {
            slug: existing?.slug || deriveExtensionSlug(formData.get('name')),
            name: safeText(formData.get('name')),
            extensionType: safeText(formData.get('extension_type')),
            parentId: safeText(formData.get('parent_id')),
            status: safeText(formData.get('status')) || 'active',
            tags: safeText(formData.get('tags')),
            summary: safeText(formData.get('summary'), 1000),
            definition: safeText(formData.get('definition'), 10000),
            launchPageId: existing?.launchPageId || '',
            isFeatured: existing?.isFeatured === true,
            usageCount: Number(existing?.usageCount || 0) || 0,
            lastUsedAt: existing?.lastUsedAt || '',
          };
          if (!payload.name) throw new Error('Extension name is required');
          if (!payload.extensionType) throw new Error('Extension type is required');
          if (payload.parentId && payload.parentId === extensionId) throw new Error('An extension cannot be its own parent');

          if (extensionId) {
            await api(`/api/develop/extensions/${encodeURIComponent(extensionId)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
          } else {
            await api('/api/develop/extensions', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          }

          await refresh();
          resetExtensionManagerForm();
          notify(extensionId ? 'Extension updated' : 'Extension saved');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (extensionNameFilter) {
      extensionNameFilter.addEventListener('input', () => {
        extensionTableState.filters.name = safeText(extensionNameFilter.value);
        renderExtensionsTable();
        saveExtensionManagerConfig();
      });
    }

    if (extensionTypeFilter) {
      extensionTypeFilter.addEventListener('change', () => {
        extensionTableState.filters.extensionType = safeText(extensionTypeFilter.value);
        renderExtensionsTable();
        saveExtensionManagerConfig();
      });
    }

    if (extensionStatusFilter) {
      extensionStatusFilter.addEventListener('change', () => {
        extensionTableState.filters.status = safeText(extensionStatusFilter.value);
        renderExtensionsTable();
        saveExtensionManagerConfig();
      });
    }

    if (extensionTagsFilter) {
      extensionTagsFilter.addEventListener('input', () => {
        extensionTableState.filters.tags = safeText(extensionTagsFilter.value);
        renderExtensionsTable();
        saveExtensionManagerConfig();
      });
    }

    [
      ['developExtensionsSortNameBtn', 'name', 'asc'],
      ['developExtensionsSortTypeBtn', 'extensionType', 'asc'],
      ['developExtensionsSortTaxonomyBtn', 'taxonomyPath', 'asc'],
      ['developExtensionsSortStatusBtn', 'status', 'asc'],
      ['developExtensionsSortUpdatedBtn', 'updatedAt', 'desc'],
    ].forEach(([id, key, defaultDir]) => {
      const button = byId(id);
      if (!button) return;
      button.addEventListener('click', () => {
        if (extensionTableState.sort.key === key) {
          extensionTableState.sort.dir = extensionTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          extensionTableState.sort.key = key;
          extensionTableState.sort.dir = defaultDir;
        }
        renderExtensionsTable();
        saveExtensionManagerConfig();
      });
    });

    if (els.developLandingPagesForm) {
      els.developLandingPagesForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(els.developLandingPagesForm);
          const landingPageId = safeText(formData.get('landing_page_id'));
          const payload = getLandingPageFormPayload(formData);
          if (!payload.name) throw new Error('Landing page name is required');
          if (!payload.templateId) throw new Error('Template is required');
          selectedTemplateId = payload.templateId;
          renderTemplateLibrary();
          renderTemplatePreview(selectedTemplateId);

          let result;
          if (landingPageId) {
            result = await api(`/api/develop/landing-pages/${encodeURIComponent(landingPageId)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
          } else {
            result = await api('/api/develop/landing-pages', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          }

          await refresh();
          notify(landingPageId ? 'Landing page updated' : 'Landing page saved');
          App.setActivePage('developManageLandingPagesPage');
          resetLandingPageForm();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (els.developAgentsForm) {
      els.developAgentsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(els.developAgentsForm);
          const built    = buildAgentsRequest(formData);
          setPreview(els.agentsRequestPreview, built);
          const result = await api(`/api/openclaw/${built.action}`, {
            method: 'POST',
            body: JSON.stringify(built.request)
          });
          setPreview(els.agentsResponsePreview, result);
          notify(`OpenClaw ${built.action} request sent`);
        } catch (err) { notify(err.message, true); }
      });
    }

    if (els.developToolsForm) {
      els.developToolsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData        = new FormData(els.developToolsForm);
          const manualConfirmed = formData.get('manual_confirmed') === 'on';
          if (!manualConfirmed) throw new Error('Manual confirmation is required');
          const toolName = safeText(formData.get('tool_name'));
          if (toolName === 'icon.builder') {
            throw new Error('Use the dedicated Icon Builder form above for icon generation.');
          }
          const input   = parseJsonInput(formData.get('input_json'), {});
          await submitToolJob(
            toolName,
            input,
            formData.get('workspace_id'),
            els.toolsRequestPreview,
            els.toolsResponsePreview,
            'Tool job sent to OpenClaw'
          );
        } catch (err) {
          setPreview(els.toolsResponsePreview, {
            ok: false,
            error: err.message || 'Tool job failed'
          });
          notify(err.message, true);
        }
      });
    }

    if (els.iconBuilderForm) {
      els.iconBuilderForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(els.iconBuilderForm);
          const manualConfirmed = formData.get('manual_confirmed') === 'on';
          if (!manualConfirmed) throw new Error('Manual confirmation is required');
          const objectType = safeText(formData.get('object_type'));
          const objectName = safeText(formData.get('object_name'));
          if (!objectName) throw new Error('Object name is required');
          const input = {
            manual_confirmed: true,
            workspace_id: safeText(formData.get('workspace_id')) || 'alphire-main',
            object_type: objectType || 'custom',
            object_name: objectName,
            category: safeText(formData.get('category')),
            summary: safeText(formData.get('object_summary')),
            icon_spec: {
              visual_style: safeText(formData.get('visual_style')) || 'clean-flat',
              palette: safeText(formData.get('palette')),
              destination: safeText(formData.get('destination')) || 'menu-bar',
              size: safeText(formData.get('size')) || '64x64',
              usage: 'Generate a compact icon for use between the main navigation and the right-side system menu.'
            }
          };
          setPreview(els.iconBuilderRequestPreview, { action: 'build_icon', request: input });
          const result = await api('/api/develop/icon-builder', {
            method: 'POST',
            body: JSON.stringify(input)
          });
          setPreview(els.iconBuilderResponsePreview, result);
          renderIconBuilderResult(result?.data || result?.icon || null);
          notify('Icon generated');
        } catch (err) {
          setPreview(els.iconBuilderResponsePreview, {
            ok: false,
            error: err.message || 'Icon Builder job failed'
          });
          renderIconBuilderResult(null);
          notify(err.message, true);
        }
      });
    }

    const screenshotForm = byId('developScreenshotForm');
    const screenshotResponsePreview = byId('developScreenshotResponsePreview');
    if (screenshotForm) {
      screenshotForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(screenshotForm);
          const url = safeText(formData.get('url'));
          if (!url) throw new Error('URL is required');
          const payload = {
            url,
            assetName: safeText(formData.get('asset_name')),
            tags: safeText(formData.get('tags')),
          };
          const result = await api('/api/develop/extensions/screenshot-capture', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          setPreview(screenshotResponsePreview, result);
          renderScreenshotResult(result?.asset || result?.data || null);
          notify('Screenshot captured');
        } catch (err) {
          setPreview(screenshotResponsePreview, {
            ok: false,
            error: err.message || 'Could not capture screenshot',
          });
          renderScreenshotResult(null);
          notify(err.message, true);
        }
      });
    }

    const thumbnailForm = byId('developThumbnailForm');
    const thumbnailResponsePreview = byId('developThumbnailResponsePreview');
    if (thumbnailForm) {
      thumbnailForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(thumbnailForm);
          const fileLocation = safeText(formData.get('file_location'));
          if (!fileLocation) throw new Error('PDF file location is required');
          const payload = {
            fileLocation,
            sourceAssetId: safeText(formData.get('source_asset_id')),
            assetName: safeText(formData.get('asset_name')),
            tags: safeText(formData.get('tags')),
          };
          const result = await api('/api/develop/extensions/thumbnail-capture', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          setPreview(thumbnailResponsePreview, result);
          renderThumbnailResult(result?.asset || result?.data || null);
          notify('Thumbnail generated');
        } catch (err) {
          setPreview(thumbnailResponsePreview, {
            ok: false,
            error: err.message || 'Could not generate thumbnail',
          });
          renderThumbnailResult(null);
          notify(err.message, true);
        }
      });
    }
  }

  return {
    manifest: { id: 'develop', label: 'Develop', pageId: 'developPage', pagePrefixes: ['develop'] },
    init,
    refresh,
    onPageActivated: refresh,
    openThemesPage,
    openThemesBuilder,
    openAgentsPage,
    openAgentsCreate
  };
})();
