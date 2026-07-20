window.App = window.App || {};

App.campaigns = (function () {
  const { state, els, api, notify } = App;
  const CHANNEL_RULES_STORAGE_KEY = 'campaignChannelRules.v2';
  const TWEET_CHARACTER_LIMIT = 280;
  const PROJECT_URL_FIELDS = ['website', 'projectUrl', 'project_url', 'siteUrl', 'site_url', 'url', 'domain', 'canonicalUrl', 'canonical_url'];
  const CAMPAIGN_STATUSES = [
    { value: 'draft', label: 'Draft' },
    { value: 'pending', label: 'Pending' },
    { value: 'paused', label: 'Paused' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'ready', label: 'Ready' },
    { value: 'active', label: 'Active' },
    { value: 'complete', label: 'Complete' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'sent', label: 'Sent' },
  ];
  const MECHANIC_RULE_FIELDS = [
    { id: 'campaignEmailTemplateSelect', label: 'Template' },
    { id: 'campaignThemeSelect', label: 'Theme' },
    { id: 'campaignLandingPageSelect', label: 'Page' },
    { id: 'campaignSegmentSelect', label: 'Segment' },
  ];
  const CONTENT_RULE_FIELDS = [
    { id: 'campaignTopicSelect', label: 'Topics' },
    { id: 'campaignHeadlineSelect', label: 'Headline' },
    { id: 'campaignEmailSelect', label: 'Email Body' },
    { id: 'campaignSubjectLineSelect', label: 'Subject Line' },
    { id: 'campaignBlurbSelect', label: 'Blurb' },
    { id: 'campaignPitchSelect', label: 'Pitch' },
    { id: 'campaignSubheadingSelect', label: 'Sub-heading' },
    { id: 'campaignTaglineSelect', label: 'Tagline' },
    { id: 'campaignArticleSelect', label: 'Article' },
    { id: 'campaignReportSelect', label: 'Report' },
    { id: 'campaignWhitePaperSelect', label: 'White Paper' },
    { id: 'campaignEbookSelect', label: 'eBook' },
    { id: 'campaignPostSelect', label: 'Post' },
    { id: 'campaignDescriptionSelect', label: 'Description' },
    { id: 'campaignTranscriptSelect', label: 'Transcript' },
    { id: 'campaignCommentSelect', label: 'Comment' },
    { id: 'campaignTweetSelect', label: 'Tweet' },
    { id: 'campaignCtaSelect', label: 'CTA' },
    { id: 'campaignPrimaryImageSelect', label: 'Primary Image' },
    { id: 'campaignPrimaryVideoSelect', label: 'Primary Video' },
    { id: 'campaignHashtagGroupSelect', label: 'Hashtags' },
    { id: 'campaignLeadMagnetSelect', label: 'PDF' },
  ];
  const CAMPAIGN_CONTENT_COMBOBOX_SELECT_IDS = CONTENT_RULE_FIELDS
    .map((field) => field.id)
    .filter((id) => id !== 'campaignHashtagGroupSelect');
  const SOCIAL_CONTENT_TEMPLATE_FIELDS = [
    'campaignTweetSelect',
    'campaignCtaSelect',
    'campaignHashtagGroupSelect',
    'campaignPrimaryImageSelect',
    'campaignPrimaryVideoSelect',
  ];
  const FACEBOOK_SOCIAL_CONTENT_TEMPLATE_FIELDS = [
    'campaignPostSelect',
    'campaignCtaSelect',
    'campaignHashtagGroupSelect',
    'campaignPrimaryImageSelect',
    'campaignPrimaryVideoSelect',
  ];
  const CAMPAIGN_CONTENT_TEMPLATES = {
    default: {
      hint: 'Social campaigns use short copy, a CTA, hashtags, and primary image and video by default.',
      visibleMechanics: ['campaignSegmentSelect'],
      requiredMechanics: [],
      visibleContent: SOCIAL_CONTENT_TEMPLATE_FIELDS,
    },
    x: {
      hint: 'X campaigns use short copy, a CTA, hashtags, and primary image and video by default.',
      visibleMechanics: ['campaignSegmentSelect'],
      requiredMechanics: [],
      visibleContent: SOCIAL_CONTENT_TEMPLATE_FIELDS,
    },
    tiktok: {
      hint: 'TikTok campaigns require a primary video and use short caption copy, a CTA, and hashtags.',
      visibleMechanics: ['campaignSegmentSelect'],
      requiredMechanics: [],
      visibleContent: SOCIAL_CONTENT_TEMPLATE_FIELDS,
    },
    facebook: {
      hint: 'Facebook campaigns use post copy, a CTA, hashtags, and primary image and video by default.',
      visibleMechanics: ['campaignSegmentSelect'],
      requiredMechanics: [],
      visibleContent: FACEBOOK_SOCIAL_CONTENT_TEMPLATE_FIELDS,
    },
    facebook_personal: {
      hint: 'Facebook Personal campaigns use post copy, a CTA, hashtags, and primary image and video by default.',
      visibleMechanics: ['campaignSegmentSelect'],
      requiredMechanics: [],
      visibleContent: FACEBOOK_SOCIAL_CONTENT_TEMPLATE_FIELDS,
    },
  };

  let builderTweets = [];
  const campaignContentComboboxRegistry = new Map();
  let builderHashtags = [];
  let builderEmails = [];
  let builderEmailTemplates = [];
  let builderTopics = [];
  let builderHeadlines = [];
  let builderSubheadings = [];
  let builderTaglines = [];
  let builderPitches = [];
  let builderArticles = [];
  let builderReports = [];
  let builderWhitePapers = [];
  let builderEbooks = [];
  let builderPosts = [];
  let builderDescriptions = [];
  let builderTranscripts = [];
  let builderComments = [];
  let builderCtas = [];
  let builderPages = [];
  let builderForms = [];
  let editingCampaignId = '';
  let channelRulesState = loadChannelRulesState();
  let selectedCampaignHashtagIds = new Set();
  let hiddenCampaignContentFieldIds = new Set();

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value || '').trim();
  }

  function normalizeCampaignStatus(value) {
    const key = safeText(value).toLowerCase().replace(/[\s-]+/g, '_');
    return CAMPAIGN_STATUSES.some((status) => status.value === key) ? key : 'pending';
  }

  function campaignStatusLabel(value) {
    const key = normalizeCampaignStatus(value);
    return CAMPAIGN_STATUSES.find((status) => status.value === key)?.label || 'Pending';
  }

  function campaignStatusValue(campaign, config = parseCampaignConfig(campaign)) {
    return normalizeCampaignStatus(config?.status || campaign?.status);
  }

  function uniqueIds(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map((value) => safeText(value)).filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function loadChannelRulesState() {
    try {
      const raw = window.localStorage.getItem(CHANNEL_RULES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function persistChannelRulesState() {
    try {
      window.localStorage.setItem(CHANNEL_RULES_STORAGE_KEY, JSON.stringify(channelRulesState || {}));
    } catch {}
  }

  function mechanicsFieldIds() {
    return MECHANIC_RULE_FIELDS.map((item) => item.id);
  }

  function contentFieldIds() {
    return CONTENT_RULE_FIELDS.map((item) => item.id);
  }

  function contentRowFieldIds() {
    return Array.from(document.querySelectorAll('#campaignContentConditional .campaign-content-row'))
      .map((row) => safeText(row?.dataset?.fieldId))
      .filter(Boolean);
  }

  function resetCampaignContentRows() {
    document.querySelectorAll('#campaignContentConditional .campaign-content-row').forEach((row) => {
      row.classList.remove('user-hidden');
    });
    hiddenCampaignContentFieldIds = new Set();
  }

  function setHiddenCampaignContentFieldIds(ids) {
    const validIds = new Set(contentRowFieldIds());
    hiddenCampaignContentFieldIds = new Set(
      (Array.isArray(ids) ? ids : []).map((id) => safeText(id)).filter((id) => id && (!validIds.size || validIds.has(id)))
    );
    document.querySelectorAll('#campaignContentConditional .campaign-content-row').forEach((row) => {
      const fieldId = safeText(row?.dataset?.fieldId);
      const isHidden = hiddenCampaignContentFieldIds.has(fieldId);
      row.classList.toggle('user-hidden', isHidden);
      row.style.display = (row.dataset.channelVisible !== '0' && !isHidden) ? '' : 'none';
    });
    updateAddContentBtnVisibility();
  }

  function visibleMechanicsForProfile(profile) {
    return uniqueIds(profile?.visibleMechanics || []);
  }

  function requiredMechanicsForProfile(profile) {
    return uniqueIds(profile?.requiredMechanics || []);
  }

  function visibleContentForProfile(profile) {
    return uniqueIds(profile?.visibleContent || []);
  }

  function mergeChannelProfile(channel) {
    const defaults = channelProfile(channel);
    const key = safeText(channel?.id);
    const override = key ? channelRulesState[key] || {} : {};
    const mechanicsVisible = uniqueIds(
      Array.isArray(override.visibleMechanics) ? override.visibleMechanics : defaults.visibleMechanics
    );
    const mechanicsRequired = uniqueIds(
      Array.isArray(override.requiredMechanics) ? override.requiredMechanics : defaults.requiredMechanics || []
    ).filter((id) => mechanicsVisible.includes(id));
    const contentVisible = uniqueIds(
      Array.isArray(override.visibleContent) ? override.visibleContent : defaults.visibleContent
    );
    return {
      hint: safeText(override.hint || defaults.hint),
      visibleMechanics: mechanicsVisible,
      requiredMechanics: mechanicsRequired,
      visibleContent: contentVisible,
    };
  }

  function extractDriveId(url) {
    const text = safeText(url);
    if (!text) return '';
    const byPath = text.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (byPath) return byPath[1];
    try {
      const parsed = new URL(text);
      return parsed.searchParams.get('id') || '';
    } catch {
      return '';
    }
  }

  function assetPreviewUrl(asset) {
    const location = safeText(
      asset?.thumbnailLocation || asset?.thumbnailUrl || asset?.thumbnail_location || asset?.location
    );
    if (!location) return '';
    const driveId = extractDriveId(location);
    if (driveId) return `/api/assets/drive-file/${encodeURIComponent(driveId)}`;
    try {
      const parsed = new URL(location);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return location;
    } catch {}
    return '';
  }

  function selectedCampaignTweetRow() {
    if (!contentFieldIsActive('campaignTweetSelect')) return null;
    return findById(builderTweets, byId('campaignTweetSelect')?.value);
  }

  function selectedCampaignPostRow() {
    if (!contentFieldIsActive('campaignPostSelect')) return null;
    return findById(builderPosts, byId('campaignPostSelect')?.value);
  }

  function campaignSocialTextLimit() {
    const channel = selectedCampaignChannel();
    const platform = channelPlatformKey(channel);
    if (platform === 'facebook' || platform === 'facebook_personal') return 63206;
    return TWEET_CHARACTER_LIMIT;
  }

  function campaignUsesPostCopy() {
    return contentFieldIsActive('campaignPostSelect') && !contentFieldIsActive('campaignTweetSelect');
  }

  function parseCampaignConfig(campaign) {
    const raw = safeText(campaign?.content);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.builder === 'campaign-v1') {
        return parsed;
      }
    } catch {}
    return null;
  }

  function setSelectOptions(select, options, placeholder, currentValue) {
    if (!select) return;
    const desired = String(currentValue || '');
    select.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);

    (Array.isArray(options) ? options : []).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      // Option labels are truncated for display; keep the untruncated copy so
      // anything that publishes this selection uses the full text, not the label.
      const fullText = safeText(item.searchText);
      if (fullText && fullText !== item.label) option.dataset.fullText = fullText;
      select.appendChild(option);
    });

    if (desired && Array.from(select.options).some((option) => option.value === desired)) {
      select.value = desired;
    }
  }

  function isCampaignContentCombobox(selectId) {
    return CAMPAIGN_CONTENT_COMBOBOX_SELECT_IDS.includes(selectId);
  }

  function campaignComboboxSearchId(selectId) {
    return String(selectId).replace(/Select$/, 'Search');
  }

  function campaignComboboxListboxId(selectId) {
    return String(selectId).replace(/Select$/, 'Listbox');
  }

  function getCampaignComboboxState(selectId) {
    if (!campaignContentComboboxRegistry.has(selectId)) {
      campaignContentComboboxRegistry.set(selectId, {
        options: [],
        emptyHint: '',
        activeIndex: -1,
        blurTimer: 0,
        wired: false,
      });
    }
    return campaignContentComboboxRegistry.get(selectId);
  }

  function normalizeComboboxOptions(options) {
    return (Array.isArray(options) ? options : []).map((item) => {
      const label = safeText(item.label);
      const searchText = safeText(item.searchText) || label;
      return {
        value: item.value,
        label: label || String(item.value),
        searchText,
      };
    });
  }

  function comboboxOptionsFromTextRows(rows, textField, fallbackPrefix, labelMax = 100) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const searchText = safeText(row?.[textField]);
      const label = optionLabelFromText(searchText, `${fallbackPrefix} ${row?.id || ''}`);
      const shortLabel = label.length > labelMax ? `${label.slice(0, labelMax - 3)}...` : label;
      return {
        value: row.id,
        label: shortLabel,
        searchText: searchText || shortLabel,
      };
    });
  }

  function comboboxOptionsFromMappedRows(rows, mapFn) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const mapped = mapFn(row) || {};
      const label = safeText(mapped.label);
      const searchText = safeText(mapped.searchText) || label;
      return {
        value: row.id,
        label: label || String(row.id),
        searchText,
      };
    });
  }

  function syncCampaignComboboxSearchFromSelect(selectId) {
    const select = byId(selectId);
    const search = byId(campaignComboboxSearchId(selectId));
    if (!select || !search) return;
    const value = safeText(select.value);
    if (!value) {
      search.value = '';
      return;
    }
    const state = getCampaignComboboxState(selectId);
    const match = state.options.find((item) => String(item.value) === value);
    search.value = match?.searchText || selectedOptionText(select);
  }

  function setCampaignComboboxExpanded(selectId, isOpen) {
    const search = byId(campaignComboboxSearchId(selectId));
    const listbox = byId(campaignComboboxListboxId(selectId));
    if (search) search.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (listbox) listbox.classList.toggle('hidden', !isOpen);
  }

  function closeCampaignComboboxList(selectId) {
    const state = getCampaignComboboxState(selectId);
    state.activeIndex = -1;
    setCampaignComboboxExpanded(selectId, false);
  }

  function openCampaignComboboxList(selectId) {
    setCampaignComboboxExpanded(selectId, true);
  }

  function visibleCampaignComboboxMatches(selectId) {
    const search = byId(campaignComboboxSearchId(selectId));
    const state = getCampaignComboboxState(selectId);
    const query = safeText(search?.value).toLowerCase();
    if (!state.options.length) return [];
    return state.options.filter((item) => {
      if (!query) return true;
      const haystack = `${item.searchText} ${item.label}`.toLowerCase();
      return haystack.includes(query);
    }).slice(0, 80);
  }

  function renderCampaignComboboxList(selectId) {
    const listbox = byId(campaignComboboxListboxId(selectId));
    const state = getCampaignComboboxState(selectId);
    if (!listbox) return;
    listbox.innerHTML = '';
    const matches = visibleCampaignComboboxMatches(selectId);

    if (!state.options.length) {
      const empty = document.createElement('div');
      empty.className = 'campaign-combobox-empty';
      empty.textContent = state.emptyHint || 'No options available';
      listbox.appendChild(empty);
      state.activeIndex = -1;
      return;
    }

    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'campaign-combobox-empty';
      empty.textContent = 'No matching options';
      listbox.appendChild(empty);
      state.activeIndex = -1;
      return;
    }

    if (state.activeIndex >= matches.length) {
      state.activeIndex = matches.length - 1;
    }

    matches.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'campaign-combobox-option';
      if (index === state.activeIndex) btn.classList.add('is-active');
      btn.dataset.comboboxValue = String(item.value);
      btn.setAttribute('role', 'option');
      btn.textContent = item.label;
      listbox.appendChild(btn);
    });
  }

  function setCampaignComboboxSelection(selectId, value, options = {}) {
    const select = byId(selectId);
    const search = byId(campaignComboboxSearchId(selectId));
    if (!select) return;
    const desired = safeText(value);
    if (!desired) {
      select.value = '';
      if (search && options.clearSearch !== false) search.value = '';
    } else if (Array.from(select.options).some((option) => String(option.value) === desired)) {
      select.value = desired;
      syncCampaignComboboxSearchFromSelect(selectId);
    }
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (options.renderPreview !== false) renderCampaignLivePreview();
    updateCampaignFieldGlows();
  }

  function reconcileCampaignComboboxSearchOnBlur(selectId) {
    const select = byId(selectId);
    const search = byId(campaignComboboxSearchId(selectId));
    const state = getCampaignComboboxState(selectId);
    if (!select || !search) return;
    const query = safeText(search.value);
    if (!query) {
      if (safeText(select.value)) setCampaignComboboxSelection(selectId, '', { renderPreview: false });
      return;
    }
    if (safeText(select.value)) {
      const selected = state.options.find((item) => String(item.value) === safeText(select.value));
      if (selected && (query === selected.searchText || query === selected.label)) return;
    }
    const exact = state.options.find((item) => (
      item.searchText.toLowerCase() === query.toLowerCase()
      || item.label.toLowerCase() === query.toLowerCase()
    ));
    if (exact) {
      setCampaignComboboxSelection(selectId, exact.value, { renderPreview: false });
      return;
    }
    const matches = visibleCampaignComboboxMatches(selectId);
    if (matches.length === 1) {
      setCampaignComboboxSelection(selectId, matches[0].value, { renderPreview: false });
      return;
    }
    if (safeText(select.value)) setCampaignComboboxSelection(selectId, '', { renderPreview: false });
  }

  function setCampaignContentComboboxOptions(selectId, options, emptyHint, currentValue) {
    const select = byId(selectId);
    const state = getCampaignComboboxState(selectId);
    state.options = normalizeComboboxOptions(options);
    state.emptyHint = safeText(emptyHint);
    setSelectOptions(select, state.options, '', currentValue);
    syncCampaignComboboxSearchFromSelect(selectId);
    renderCampaignComboboxList(selectId);
  }

  function wireCampaignContentCombobox(selectId) {
    const state = getCampaignComboboxState(selectId);
    if (state.wired) return;
    const search = byId(campaignComboboxSearchId(selectId));
    const listbox = byId(campaignComboboxListboxId(selectId));
    const select = byId(selectId);
    if (!search || !listbox || !select) return;
    state.wired = true;

    search.addEventListener('input', () => {
      const selected = state.options.find((item) => String(item.value) === safeText(select.value));
      const selectedText = selected?.searchText || selected?.label || '';
      if (safeText(search.value) !== safeText(selectedText)) {
        select.value = '';
      }
      state.activeIndex = -1;
      renderCampaignComboboxList(selectId);
      openCampaignComboboxList(selectId);
      renderCampaignLivePreview();
      updateCampaignFieldGlows();
    });

    search.addEventListener('focus', () => {
      renderCampaignComboboxList(selectId);
      openCampaignComboboxList(selectId);
    });

    search.addEventListener('keydown', (event) => {
      const matches = visibleCampaignComboboxMatches(selectId);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCampaignComboboxList(selectId);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!matches.length) return;
        state.activeIndex = Math.min(matches.length - 1, state.activeIndex + 1);
        renderCampaignComboboxList(selectId);
        openCampaignComboboxList(selectId);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!matches.length) return;
        state.activeIndex = Math.max(0, state.activeIndex - 1);
        renderCampaignComboboxList(selectId);
        openCampaignComboboxList(selectId);
        return;
      }
      if (event.key === 'Enter') {
        if (!matches.length || state.activeIndex < 0) return;
        event.preventDefault();
        const choice = matches[state.activeIndex];
        if (!choice) return;
        setCampaignComboboxSelection(selectId, choice.value);
        closeCampaignComboboxList(selectId);
      }
    });

    search.addEventListener('blur', () => {
      window.clearTimeout(state.blurTimer);
      state.blurTimer = window.setTimeout(() => {
        closeCampaignComboboxList(selectId);
        reconcileCampaignComboboxSearchOnBlur(selectId);
        renderCampaignLivePreview();
      }, 160);
    });

    listbox.addEventListener('mousedown', (event) => {
      const option = event.target.closest('[data-combobox-value]');
      if (!option) return;
      event.preventDefault();
      setCampaignComboboxSelection(selectId, option.dataset.comboboxValue || '');
      closeCampaignComboboxList(selectId);
    });

    select.addEventListener('change', () => {
      syncCampaignComboboxSearchFromSelect(selectId);
      updateCampaignFieldGlows();
    });
  }

  function initCampaignContentComboboxes() {
    CAMPAIGN_CONTENT_COMBOBOX_SELECT_IDS.forEach((selectId) => {
      wireCampaignContentCombobox(selectId);
    });
  }

  function hashtagText(row) {
    return safeText(row?.hashtag || row?.tag || row?.text || row?.label || row?.name || row?.content);
  }

  function hashtagId(row) {
    return safeText(row?.id);
  }

  function normalizeCampaignHashtagInput(value) {
    const text = safeText(value).replace(/^[#,]+/, '').trim();
    if (!text) return '';
    return text.startsWith('#') ? text : `#${text}`;
  }

  function findHashtagRowByText(value) {
    const normalized = normalizeCampaignHashtagInput(value).toLowerCase();
    if (!normalized) return null;
    return (Array.isArray(builderHashtags) ? builderHashtags : []).find((row) => (
      hashtagText(row).toLowerCase() === normalized
    )) || null;
  }

  function filterHashtagRowsByQuery(rows, query) {
    const needle = safeText(query).toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const text = hashtagText(row).toLowerCase();
      return text.includes(needle) || text.replace(/^#/, '').includes(needle.replace(/^#/, ''));
    });
  }

  function findById(rows, id) {
    const desired = safeText(id);
    if (!desired) return null;
    return (Array.isArray(rows) ? rows : []).find((row) => {
      const rowId = safeText(row?.id);
      return rowId === desired || String(row?.id) === desired;
    }) || null;
  }

  function contentFieldIsActive(id) {
    const row = byId(id)?.closest('.campaign-content-row');
    return !!row && row.style.display !== 'none' && !row.classList.contains('user-hidden');
  }

  function characterCount(value) {
    return Array.from(String(value || '')).length;
  }

  function normalizeProjectUrl(value) {
    const raw = safeText(value);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw)) return `https://${raw}`;
    return '';
  }

  function activeProject() {
    const currentId = safeText(state.currentProjectId);
    const projects = Array.isArray(state.projects) ? state.projects : [];
    return projects.find((project) => safeText(project?.id) === currentId)
      || (safeText(state.currentProject?.id) === currentId ? state.currentProject : null)
      || state.currentProject
      || null;
  }

  async function ensureCampaignProjectContext() {
    try {
      const current = await api('/api/projects/current', { method: 'GET' });
      const project = current.project || current.currentProject || null;
      const projects = Array.isArray(current.projects) ? current.projects : [];
      if (project?.id) {
        state.currentProject = project;
        state.currentProjectId = safeText(project.id);
        window.localStorage.setItem(App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId', state.currentProjectId);
      }
      if (projects.length) state.projects = projects;
    } catch (_) {}
  }

  function campaignProjectUrl() {
    const project = activeProject();
    const projectUrl = PROJECT_URL_FIELDS
      .map((field) => normalizeProjectUrl(project?.[field]))
      .find(Boolean);
    return projectUrl || '';
  }

  function appendCtaUrl(ctaText) {
    const text = safeText(ctaText);
    if (!text) return '';
    const projectUrl = campaignProjectUrl();
    if (!projectUrl || text.includes(projectUrl)) return text;
    return `${text} ${projectUrl}`;
  }

  function hashtagTimestamp(row) {
    const time = Date.parse(row?.created_at || row?.updated_at || '');
    return Number.isFinite(time) ? time : 0;
  }

  function rankedHashtagRows(limit = 40) {
    const seen = new Set();
    return (Array.isArray(builderHashtags) ? builderHashtags : [])
      .filter((row) => hashtagId(row) && hashtagText(row))
      .slice()
      .sort((a, b) => {
        const scoreDiff = (Number(b?.quality_score || 0) || 0) - (Number(a?.quality_score || 0) || 0);
        if (scoreDiff) return scoreDiff;
        const timeDiff = hashtagTimestamp(b) - hashtagTimestamp(a);
        if (timeDiff) return timeDiff;
        return (Number(b?.id || 0) || 0) - (Number(a?.id || 0) || 0);
      })
      .filter((row) => {
        const key = hashtagText(row).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  function selectedHashtagRows() {
    const selected = Array.from(selectedCampaignHashtagIds);
    if (!selected.length) return [];
    const byId = new Map((Array.isArray(builderHashtags) ? builderHashtags : []).map((row) => [hashtagId(row), row]));
    return selected.map((id) => byId.get(id)).filter(Boolean);
  }

  function setSelectedCampaignHashtagIds(ids) {
    selectedCampaignHashtagIds = new Set((Array.isArray(ids) ? ids : []).map((id) => safeText(id)).filter(Boolean));
    renderCampaignHashtagPicker();
  }

  function campaignHashtagIdsFromConfig(config) {
    const direct = Array.isArray(config?.hashtagIds)
      ? config.hashtagIds
      : Array.isArray(config?.selectedHashtagIds)
        ? config.selectedHashtagIds
        : [];
    if (direct.length) return direct;

    const legacyGroupId = safeText(config?.hashtagGroupId);
    if (!legacyGroupId) return [];
    return (Array.isArray(builderHashtags) ? builderHashtags : [])
      .filter((row) => safeText(row?.campaign_id) === legacyGroupId)
      .map((row) => hashtagId(row))
      .filter(Boolean);
  }

  function renderCampaignHashtagPicker() {
    const hidden = byId('campaignHashtagGroupSelect');
    const summary = byId('campaignHashtagSummary');
    const button = byId('campaignHashtagPickerBtn');
    const available = rankedHashtagRows(40);
    const selectedRows = selectedHashtagRows();
    const selectedTexts = selectedRows.map(hashtagText).filter(Boolean);

    if (hidden) hidden.value = selectedTexts.join(' ');
    if (summary) {
      summary.textContent = selectedTexts.length ? selectedTexts.join(' ') : 'No hashtags selected';
      summary.title = selectedTexts.join(' ');
    }
    if (button) {
      button.disabled = false;
      button.textContent = selectedTexts.length
        ? `Edit Hashtags (${selectedTexts.length})`
        : 'Choose Hashtags';
    }
  }

  function openCampaignHashtagPicker() {
    const modalFactory = App?.components?.Modal;
    if (!modalFactory) {
      notify('Hashtag picker is unavailable', true);
      return;
    }

    const draftIds = new Set(selectedCampaignHashtagIds);
    const modalHashtagRows = () => rankedHashtagRows(5000);
    let searchQuery = '';

    const headerTools = document.createElement('div');
    headerTools.className = 'campaign-hashtag-modal-header-tools';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'campaign-hashtag-modal-search-wrap';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'campaignHashtagModalSearch';
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.setAttribute('aria-label', 'Search hashtags');

    const searchHint = document.createElement('div');
    searchHint.className = 'campaign-hashtag-modal-search-hint hidden';
    searchHint.setAttribute('aria-live', 'polite');

    const saveHashtagBtn = document.createElement('button');
    saveHashtagBtn.type = 'button';
    saveHashtagBtn.className = 'btn btn-primary';
    saveHashtagBtn.textContent = 'Save Hashtag';
    saveHashtagBtn.disabled = true;

    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(searchHint);
    headerTools.appendChild(searchWrap);
    headerTools.appendChild(saveHashtagBtn);

    const body = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'campaign-hashtag-modal-list';
    body.appendChild(list);

    function updateSaveHashtagState() {
      const normalized = normalizeCampaignHashtagInput(searchQuery);
      const existing = findHashtagRowByText(normalized);
      const canCreate = Boolean(normalized) && !existing;
      saveHashtagBtn.disabled = !canCreate;
      if (!normalized) {
        searchHint.classList.add('hidden');
        searchHint.textContent = '';
        return;
      }
      if (existing) {
        searchHint.classList.remove('hidden');
        searchHint.textContent = `${hashtagText(existing)} already exists — select it below or type a new hashtag.`;
        return;
      }
      searchHint.classList.remove('hidden');
      searchHint.textContent = `Save ${normalized} as a new hashtag and add it to this campaign.`;
    }

    function renderHashtagModalList() {
      list.innerHTML = '';
      const filtered = filterHashtagRowsByQuery(modalHashtagRows(), searchQuery);
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'campaign-combobox-empty';
        empty.style.gridColumn = '1 / -1';
        empty.textContent = searchQuery
          ? 'No matching hashtags'
          : 'No hashtags yet — type a hashtag above and click Save Hashtag.';
        list.appendChild(empty);
        return;
      }

      filtered.forEach((row) => {
        const id = hashtagId(row);
        const textValue = hashtagText(row);
        const option = document.createElement('div');
        option.className = 'campaign-hashtag-modal-option';
        option.title = textValue;
        option.dataset.hashtagId = id;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = id;
        checkbox.checked = draftIds.has(id);
        checkbox.setAttribute('aria-label', textValue);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) draftIds.add(id);
          else draftIds.delete(id);
        });
        checkbox.addEventListener('click', (event) => {
          event.stopPropagation();
        });

        const text = document.createElement('span');
        text.className = 'campaign-hashtag-modal-text';
        text.textContent = textValue;

        option.addEventListener('click', () => {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });
        option.appendChild(checkbox);
        option.appendChild(text);
        list.appendChild(option);
      });
    }

    searchInput.addEventListener('input', () => {
      searchQuery = safeText(searchInput.value);
      updateSaveHashtagState();
      renderHashtagModalList();
    });

    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !saveHashtagBtn.disabled) {
        event.preventDefault();
        saveHashtagBtn.click();
      }
    });

    saveHashtagBtn.addEventListener('click', async () => {
      const normalized = normalizeCampaignHashtagInput(searchQuery);
      if (!normalized) return;
      const existing = findHashtagRowByText(normalized);
      if (existing) {
        draftIds.add(hashtagId(existing));
        renderHashtagModalList();
        updateSaveHashtagState();
        return;
      }

      saveHashtagBtn.disabled = true;
      try {
        const result = await api('/api/messaging/hashtags', {
          method: 'POST',
          body: JSON.stringify({ hashtag: normalized }),
        });
        const created = result?.hashtag || result?.data || result;
        const createdId = hashtagId(created);
        if (!createdId) {
          throw new Error('Hashtag was saved but no id was returned');
        }
        if (!Array.isArray(builderHashtags)) builderHashtags = [];
        const duplicateIndex = builderHashtags.findIndex((row) => hashtagId(row) === createdId);
        if (duplicateIndex >= 0) {
          builderHashtags[duplicateIndex] = created;
        } else {
          builderHashtags.unshift(created);
        }
        draftIds.add(createdId);
        searchInput.value = '';
        searchQuery = '';
        updateSaveHashtagState();
        renderHashtagModalList();
        renderCampaignLivePreview();
        notify(`Saved ${normalized}`);
      } catch (err) {
        notify(err.message || 'Could not save hashtag', true);
        updateSaveHashtagState();
      }
    });

    updateSaveHashtagState();
    renderHashtagModalList();

    const modal = modalFactory({
      title: 'Select Hashtags',
      headerTools,
      body,
      dialogClass: 'campaign-hashtag-modal',
      bodyClass: 'campaign-hashtag-modal-body',
      actions: [
        {
          label: 'Clear',
          onClick: () => {
            setSelectedCampaignHashtagIds([]);
            updateCampaignFieldGlows();
            renderCampaignLivePreview();
            modal.close();
          },
        },
        { label: 'Cancel', onClick: () => modal.close() },
        {
          label: 'Apply',
          primary: true,
          onClick: () => {
            setSelectedCampaignHashtagIds(Array.from(draftIds));
            updateCampaignFieldGlows();
            renderCampaignLivePreview();
            modal.close();
          },
        },
      ],
    });
    modal.open();
    searchInput.focus();
  }

  function campaignPreviewChannelKind() {
    if (campaignUsesPostCopy()) return 'post';
    const channelSelect = byId('campaignChannelSelect');
    const channelText = `${selectedOptionText(channelSelect)} ${safeText(channelSelect?.value)}`.toLowerCase();
    if (channelText.includes('twitter') || /\bx\b/.test(channelText)) return 'tweet';
    return 'tweet';
  }

  function buildCampaignTweetPreview() {
    const usePost = campaignUsesPostCopy();
    const postRow = usePost ? selectedCampaignPostRow() : null;
    const tweetRow = usePost ? null : selectedCampaignTweetRow();
    const taglineRow = contentFieldIsActive('campaignTaglineSelect')
      ? findById(builderTaglines, byId('campaignTaglineSelect')?.value)
      : null;
    const ctaRow = contentFieldIsActive('campaignCtaSelect')
      ? findById(builderCtas, byId('campaignCtaSelect')?.value)
      : null;
    const primaryCopy = usePost
      ? safeText(postRow?.post || selectedOptionTextIfValue(byId('campaignPostSelect')))
      : safeText(tweetRow?.content || selectedOptionTextIfValue(byId('campaignTweetSelect')));
    const baseParts = [
      primaryCopy,
      safeText(taglineRow?.tagline || selectedOptionTextIfValue(byId('campaignTaglineSelect'))),
    ].filter(Boolean);
    const ctaText = appendCtaUrl(ctaRow?.cta || selectedOptionTextIfValue(byId('campaignCtaSelect')));
    // A selected Post's own URL (e.g. a specific article/episode link) wins over the
    // generic project Website URL; fall back to the project URL when the Post has none.
    const postOwnUrl = usePost ? normalizeProjectUrl(postRow?.url) : '';
    const shareUrl = postOwnUrl || campaignProjectUrl();
    const originalHashtags = selectedHashtagRows().map(hashtagText).filter(Boolean);
    let hashtags = originalHashtags.slice();
    let includeCta = !!ctaText;
    let includeLink = Boolean(shareUrl);
    const compose = () => {
      const bodyParts = [...baseParts];
      if (includeCta && ctaText) bodyParts.push(ctaText);
      const bodyJoined = bodyParts.join('\n\n');
      if (includeLink && shareUrl && !bodyJoined.includes(shareUrl)) bodyParts.push(shareUrl);
      const withHashtags = [...bodyParts];
      if (hashtags.length) withHashtags.push(hashtags.join(' '));
      return withHashtags.filter(Boolean).join('\n\n');
    };

    const textLimit = campaignSocialTextLimit();
    let text = compose();
    while (hashtags.length && characterCount(text) > textLimit) {
      hashtags = hashtags.slice(0, -1);
      text = compose();
    }
    if (includeCta && characterCount(text) > textLimit) {
      includeCta = false;
      text = compose();
    }
    if (includeLink && characterCount(text) > textLimit) {
      includeLink = false;
      text = compose();
    }

    const count = characterCount(text);
    return {
      text,
      count,
      limit: textLimit,
      delta: textLimit - count,
      removedHashtagCount: originalHashtags.length - hashtags.length,
      ctaDropped: !!ctaText && !includeCta,
      urlMissingFromTweet: Boolean(shareUrl) && !text.includes(shareUrl),
    };
  }

  function buildCampaignPreviewAsset() {
    if (contentFieldIsActive('campaignPrimaryImageSelect')) {
      const image = findById(state.assets, byId('campaignPrimaryImageSelect')?.value);
      if (image) return { type: 'image', asset: image, url: assetPreviewUrl(image) };
    }
    const postRow = selectedCampaignPostRow();
    const postImageId = Number(postRow?.image_asset_id || 0) || 0;
    if (postImageId) {
      const postImage = findById(state.assets, postImageId);
      const postImageUrl = assetPreviewUrl(postImage);
      if (postImage && postImageUrl) {
        return { type: 'image', asset: postImage, url: postImageUrl };
      }
    }
    const tweetRow = selectedCampaignTweetRow();
    const tweetImageId = Number(tweetRow?.image_asset_id || 0) || 0;
    if (tweetImageId) {
      const tweetImage = findById(state.assets, tweetImageId);
      const tweetImageUrl = assetPreviewUrl(tweetImage);
      if (tweetImage && tweetImageUrl) {
        return { type: 'image', asset: tweetImage, url: tweetImageUrl };
      }
    }
    if (contentFieldIsActive('campaignPrimaryVideoSelect')) {
      const video = findById(state.assets, byId('campaignPrimaryVideoSelect')?.value);
      if (video) return { type: 'video', asset: video, url: assetPreviewUrl(video) };
    }
    return null;
  }

  function selectedCampaignChannel() {
    const channelId = safeText(byId('campaignChannelSelect')?.value);
    const channels = Array.isArray(state.channels) ? state.channels : [];
    return channels.find((channel) => String(channel.id) === channelId) || null;
  }

  function campaignPreviewAccountLabel(channel) {
    return safeText(channel?.displayName || channel?.userName || channel?.handle || channel?.email || 'Starcaster');
  }

  function campaignPreviewHandle(channel) {
    const account = safeText(channel?.userName || channel?.handle || channel?.displayName || channel?.email);
    if (!account) return '@starcaster';
    return account.startsWith('@') ? account : `@${account}`;
  }

  function createCampaignPreviewShell() {
    const preview = buildCampaignTweetPreview();
    const text = preview.text;
    const media = buildCampaignPreviewAsset();
    const channel = selectedCampaignChannel();
    const accountLabel = campaignPreviewAccountLabel(channel);
    const shell = document.createElement('div');
    shell.className = 'campaign-preview-tweet-shell';

    const header = document.createElement('div');
    header.className = 'campaign-preview-tweet-header';
    const avatar = document.createElement('div');
    avatar.className = 'campaign-preview-tweet-avatar';
    avatar.textContent = safeText(accountLabel).charAt(0).toUpperCase() || 'S';
    const account = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'campaign-preview-tweet-name';
    name.textContent = accountLabel;
    const handle = document.createElement('div');
    handle.className = 'campaign-preview-tweet-handle';
    handle.textContent = campaignPreviewHandle(channel);
    account.appendChild(name);
    account.appendChild(handle);
    header.appendChild(avatar);
    header.appendChild(account);
    shell.appendChild(header);

    const textEl = document.createElement('div');
    textEl.className = text ? 'campaign-preview-tweet-text' : 'campaign-preview-empty';
    textEl.textContent = text || (campaignUsesPostCopy()
      ? 'Choose post content, a CTA, hashtags, or media to preview this post.'
      : 'Choose tweet content, a CTA, hashtags, or media to preview this post.');
    shell.appendChild(textEl);

    if (media) {
      const mediaWrap = document.createElement('div');
      mediaWrap.className = 'campaign-preview-tweet-media';
      if (media.type === 'image' && media.url) {
        const img = document.createElement('img');
        img.src = media.url;
        img.alt = safeText(media.asset?.assetName) || 'Campaign image';
        mediaWrap.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'campaign-preview-tweet-media-placeholder';
        placeholder.textContent = `${safeText(media.asset?.assetName) || 'Selected media'} will be attached.`;
        mediaWrap.appendChild(placeholder);
      }
      shell.appendChild(mediaWrap);
    }

    const meta = document.createElement('div');
    meta.className = 'campaign-preview-tweet-meta';
    meta.style.marginTop = '12px';
    meta.textContent = `${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
    shell.appendChild(meta);

    const countEl = document.createElement('div');
    countEl.className = `campaign-preview-tweet-count ${preview.delta < 0 ? 'is-over' : 'is-under'}`;
    const statusText = preview.delta >= 0
      ? `${preview.delta} under limit`
      : `${Math.abs(preview.delta)} over limit`;
    const trimNotes = [
      preview.removedHashtagCount ? `${preview.removedHashtagCount} hashtag${preview.removedHashtagCount === 1 ? '' : 's'} removed` : '',
      preview.ctaDropped ? 'CTA dropped' : '',
      preview.urlMissingFromTweet ? 'Project URL not in post - shorten copy or use a shorter Website URL' : '',
    ].filter(Boolean).join(' · ');
    countEl.textContent = `${preview.count}/${preview.limit} characters · ${statusText}${trimNotes ? ` · ${trimNotes}` : ''}`;
    shell.appendChild(countEl);

    const footer = document.createElement('div');
    footer.className = 'campaign-preview-tweet-footer';
    ['Reply', 'Repost', 'Like', 'Share'].forEach((item) => {
      const span = document.createElement('span');
      span.textContent = item;
      footer.appendChild(span);
    });
    shell.appendChild(footer);
    return shell;
  }

  function renderCampaignLivePreview() {
    const mount = byId('campaignLivePreview');
    if (!mount) return;
    mount.innerHTML = '';
    mount.appendChild(createCampaignPreviewShell());
  }

  async function openCampaignPreview() {
    if (!App?.components?.Modal) {
      notify('Preview modal is unavailable', true);
      return;
    }
    await ensureCampaignProjectContext();
    const kind = campaignPreviewChannelKind();
    const body = document.createElement('div');

    if (kind === 'tweet') {
      body.appendChild(createCampaignPreviewShell());
    }

    const modal = App.components.Modal({
      title: 'Campaign Preview',
      body,
      dialogClass: 'campaign-preview-modal',
      bodyClass: 'campaign-preview-modal-body',
      actions: [{ label: 'Close', primary: true, onClick: () => modal.close() }],
    });
    modal.open();
  }

  function channelDisplayPlatform(raw) {
    const text = safeText(raw);
    // Older channel rows were saved as plain "Facebook" before the Page/Personal
    // split was named consistently — display them the same as new rows.
    if (text.toLowerCase() === 'facebook') return 'Facebook Page';
    return text;
  }

  function channelLabel(channel) {
    const platform = channelDisplayPlatform(
      channel?.channel
      || channel?.name
    );
    const account = safeText(channel?.userName || channel?.handle || channel?.displayName || channel?.email);
    if (platform && account) return `${platform}: ${account}`;
    return safeText(platform || account || channel?.id);
  }

  function channelPlatformKey(channel) {
    const raw = safeText(channel?.channel || channel?.platform || channel?.name).toLowerCase();
    if (!raw) return '';
    if (raw === 'twitter' || raw === 'x' || raw.includes('twitter')) return 'x';
    if (raw === 'tik tok' || raw === 'tiktok' || raw.includes('tik tok') || raw.includes('tiktok')) return 'tiktok';
    if (raw === 'facebook personal' || raw === 'facebook_personal' || raw.includes('facebook personal')) return 'facebook_personal';
    if (raw === 'facebook' || raw.includes('facebook')) return 'facebook';
    return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function optionLabelFromText(value, fallback) {
    const text = safeText(value);
    if (!text) return fallback || '-';
    return text.length > 100 ? `${text.slice(0, 97)}...` : text;
  }

  function selectedTopicLabel(topicId) {
    const desired = safeText(topicId);
    if (!desired) return '';
    const topic = builderTopics.find((item) => String(item.id) === desired);
    return safeText(topic?.topic || topic?.category);
  }

  function filterRowsByTopic(rows, topicLabel, categoryField) {
    const activeTopic = safeText(topicLabel).toLowerCase();
    const field = safeText(categoryField) || 'category';
    if (!activeTopic) return Array.isArray(rows) ? rows : [];
    return (Array.isArray(rows) ? rows : []).filter((item) => {
      const value = safeText(item?.[field]).toLowerCase();
      return value === activeTopic;
    });
  }

  function applyTopicValue(select, topicId, topicLabel) {
    if (!select) return;
    const desiredId = safeText(topicId);
    if (desiredId && Array.from(select.options).some((option) => String(option.value) === desiredId)) {
      select.value = desiredId;
      if (isCampaignContentCombobox(select.id)) syncCampaignComboboxSearchFromSelect(select.id);
      return;
    }
    const desiredLabel = safeText(topicLabel).toLowerCase();
    if (!desiredLabel) {
      select.value = '';
      if (isCampaignContentCombobox(select.id)) syncCampaignComboboxSearchFromSelect(select.id);
      return;
    }
    const matching = Array.from(select.options).find((option) => safeText(option.textContent).toLowerCase() === desiredLabel);
    select.value = matching ? String(matching.value) : '';
    if (isCampaignContentCombobox(select.id)) syncCampaignComboboxSearchFromSelect(select.id);
  }

  function setFieldVisible(id, visible) {
    const el = byId(id);
    if (!el) return;
    // Check for campaign content row wrapper first
    const contentRow = el.closest('.campaign-content-row');
    if (contentRow) {
      // Channel profile visibility is stored as a data attribute
      contentRow.dataset.channelVisible = visible ? '1' : '0';
      // Show only if BOTH channel-visible AND not user-hidden
      const userHidden = contentRow.classList.contains('user-hidden');
      contentRow.style.display = (visible && !userHidden) ? '' : 'none';
      return;
    }
    const container = el.closest('.form-row');
    if (container) {
      container.style.display = visible ? '' : 'none';
    } else {
      el.style.display = visible ? '' : 'none';
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) label.style.display = visible ? '' : 'none';
    }
  }

  function channelProfile(channel) {
    const platform = channelPlatformKey(channel);
    if (!platform) {
      return {
        hint: 'Select a channel to load content fields.',
        visibleMechanics: [],
        requiredMechanics: [],
        visibleContent: [],
      };
    }
    const template = CAMPAIGN_CONTENT_TEMPLATES[platform] || CAMPAIGN_CONTENT_TEMPLATES.default;
    return {
      hint: template.hint,
      visibleMechanics: template.visibleMechanics,
      requiredMechanics: template.requiredMechanics,
      visibleContent: template.visibleContent,
    };
  }

  function applyCampaignChannelProfile(channelId, options = {}) {
    if (options.resetUserHidden) resetCampaignContentRows();
    const mechanicsWrap = byId('campaignMechanicsConditional');
    const contentWrap = byId('campaignContentConditional');
    const hint = byId('campaignContentChannelHint');
    const channels = Array.isArray(state.channels) ? state.channels : [];
    const channel = channels.find((item) => String(item.id) === String(channelId || '')) || null;
    const profile = mergeChannelProfile(channel);
    const mechanicIds = ['campaignEmailTemplateSelect', 'campaignThemeSelect', 'campaignLandingPageSelect', 'campaignSegmentSelect'];
    const contentIds = [
      'campaignTopicSelect',
      'campaignHeadlineSelect',
      'campaignEmailSelect',
      'campaignSubjectLineSelect',
      'campaignBlurbSelect',
      'campaignPitchSelect',
      'campaignSubheadingSelect',
      'campaignTaglineSelect',
      'campaignArticleSelect',
      'campaignReportSelect',
      'campaignWhitePaperSelect',
      'campaignEbookSelect',
      'campaignPostSelect',
      'campaignDescriptionSelect',
      'campaignTranscriptSelect',
      'campaignCommentSelect',
      'campaignTweetSelect',
      'campaignCtaSelect',
      'campaignPrimaryImageSelect',
      'campaignPrimaryVideoSelect',
      'campaignHashtagGroupSelect',
      'campaignLeadMagnetSelect',
    ];
    const hasChannel = Boolean(channel);
    if (mechanicsWrap) mechanicsWrap.style.display = hasChannel ? '' : 'none';
    if (contentWrap) contentWrap.style.display = hasChannel ? '' : 'none';
    if (hint) hint.textContent = profile.hint;
    mechanicIds.forEach((id) => {
      const field = byId(id);
      setFieldVisible(id, profile.visibleMechanics.includes(id));
      if (field) field.required = profile.requiredMechanics.includes(id);
    });
    contentIds.forEach((id) => setFieldVisible(id, profile.visibleContent.includes(id)));
  }

  function currentRulesChannel() {
    const select = byId('campaignRulesChannelSelect');
    if (!select) return null;
    const channels = Array.isArray(state.channels) ? state.channels : [];
    return channels.find((item) => String(item.id) === String(select.value || '')) || null;
  }

  function buildRulesChecklist(items, activeIds, name) {
    const wrap = document.createElement('div');
    wrap.className = 'stack-form';
    wrap.style.margin = '0';
    items.forEach((item) => {
      const row = document.createElement('label');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '0.5rem';
      row.style.marginBottom = '0.25rem';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = name;
      input.value = item.id;
      input.checked = activeIds.includes(item.id);
      row.appendChild(input);
      row.appendChild(document.createTextNode(item.label));
      wrap.appendChild(row);
    });
    return wrap;
  }

  function renderChannelRulesEditor() {
    const channel = currentRulesChannel();
    const mechanicsWrap = byId('campaignRulesVisibleMechanicsList');
    const requiredWrap = byId('campaignRulesRequiredMechanicsList');
    const contentWrap = byId('campaignRulesVisibleContentList');
    if (!mechanicsWrap || !requiredWrap || !contentWrap) return;
    mechanicsWrap.innerHTML = '';
    requiredWrap.innerHTML = '';
    contentWrap.innerHTML = '';
    if (!channel) return;
    const profile = mergeChannelProfile(channel);
    mechanicsWrap.appendChild(buildRulesChecklist(MECHANIC_RULE_FIELDS, visibleMechanicsForProfile(profile), 'visibleMechanics'));
    requiredWrap.appendChild(buildRulesChecklist(MECHANIC_RULE_FIELDS, requiredMechanicsForProfile(profile), 'requiredMechanics'));
    contentWrap.appendChild(buildRulesChecklist(CONTENT_RULE_FIELDS, visibleContentForProfile(profile), 'visibleContent'));
  }

  function selectedRuleValues(containerId, name) {
    const wrap = byId(containerId);
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => safeText(input.value));
  }

  function renderChannelRulesSelect(currentValue) {
    const select = byId('campaignRulesChannelSelect');
    const channels = Array.isArray(state.channels) ? state.channels : [];
    setSelectOptions(
      select,
      channels.map((channel) => ({ value: channel.id, label: channelLabel(channel) || `Channel ${channel.id}` })),
      channels.length ? 'Channel' : 'No channels available yet',
      currentValue
    );
    renderChannelRulesEditor();
  }

  function toggleRulesPanel(forceOpen) {
    const panel = byId('campaignChannelRulesPanel');
    const btn = byId('campaignToggleRulesBtn');
    if (!panel || !btn) return;
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !shouldOpen);
    btn.textContent = shouldOpen ? 'Hide Channel Rules' : 'Channel Rules';
    if (shouldOpen) {
      renderChannelRulesSelect(safeText(byId('campaignChannelSelect')?.value));
    }
  }

  function saveChannelRules() {
    const channel = currentRulesChannel();
    if (!channel) {
      notify('Select a channel', true);
      return;
    }
    const visibleMechanics = selectedRuleValues('campaignRulesVisibleMechanicsList', 'visibleMechanics');
    const requiredMechanics = selectedRuleValues('campaignRulesRequiredMechanicsList', 'requiredMechanics')
      .filter((id) => visibleMechanics.includes(id));
    const visibleContent = selectedRuleValues('campaignRulesVisibleContentList', 'visibleContent');
    channelRulesState[String(channel.id)] = {
      visibleMechanics,
      requiredMechanics,
      visibleContent,
    };
    persistChannelRulesState();
    if (safeText(byId('campaignChannelSelect')?.value) === String(channel.id)) {
      applyCampaignChannelProfile(String(channel.id));
    }
    notify('Channel rules saved');
  }

  function resetChannelRules() {
    const channel = currentRulesChannel();
    if (!channel) {
      notify('Select a channel', true);
      return;
    }
    delete channelRulesState[String(channel.id)];
    persistChannelRulesState();
    renderChannelRulesEditor();
    if (safeText(byId('campaignChannelSelect')?.value) === String(channel.id)) {
      applyCampaignChannelProfile(String(channel.id));
    }
    notify('Channel rules reset');
  }

  function renderBuilderSelects() {
    const currentValues = {
      channelId: safeText(byId('campaignChannelSelect')?.value),
      topicId: safeText(byId('campaignTopicSelect')?.value),
      segmentId: safeText(byId('campaignSegmentSelect')?.value),
      emailTemplateId: safeText(byId('campaignEmailTemplateSelect')?.value),
      emailId: safeText(byId('campaignEmailSelect')?.value),
      headlineId: safeText(byId('campaignHeadlineSelect')?.value),
      subjectLineId: safeText(byId('campaignSubjectLineSelect')?.value),
      blurbId: safeText(byId('campaignBlurbSelect')?.value),
      pitchId: safeText(byId('campaignPitchSelect')?.value),
      subheadingId: safeText(byId('campaignSubheadingSelect')?.value),
      taglineId: safeText(byId('campaignTaglineSelect')?.value),
      articleId: safeText(byId('campaignArticleSelect')?.value),
      reportId: safeText(byId('campaignReportSelect')?.value),
      whitePaperId: safeText(byId('campaignWhitePaperSelect')?.value),
      ebookId: safeText(byId('campaignEbookSelect')?.value),
      postId: safeText(byId('campaignPostSelect')?.value),
      descriptionId: safeText(byId('campaignDescriptionSelect')?.value),
      transcriptId: safeText(byId('campaignTranscriptSelect')?.value),
      commentId: safeText(byId('campaignCommentSelect')?.value),
      tweetId: safeText(byId('campaignTweetSelect')?.value),
      ctaId: safeText(byId('campaignCtaSelect')?.value),
      primaryImageId: safeText(byId('campaignPrimaryImageSelect')?.value),
      primaryVideoId: safeText(byId('campaignPrimaryVideoSelect')?.value),
      landingPageId: safeText(byId('campaignLandingPageSelect')?.value),
      formObjectId: safeText(byId('campaignFormObjectSelect')?.value),
      leadMagnetId: safeText(byId('campaignLeadMagnetSelect')?.value),
      hashtagGroupId: safeText(byId('campaignHashtagGroupSelect')?.value),
    };
    const channels = Array.isArray(state.channels) ? state.channels : [];
    const assets = Array.isArray(state.assets) ? state.assets : [];
    const images = assets.filter((asset) => safeText(asset.assetType) === 'Image');
    const videos = assets.filter((asset) => safeText(asset.assetType) === 'Video');
    const leadMagnets = assets.filter((asset) => safeText(asset.assetType) === 'Lead Magnet');
    const activeTopic = selectedTopicLabel(currentValues.topicId);
    const filteredHeadlines = filterRowsByTopic(builderHeadlines, activeTopic, 'category');
    const filteredEmails = filterRowsByTopic(builderEmails, activeTopic, 'category');
    const filteredPitches = filterRowsByTopic(builderPitches, activeTopic, 'category');
    const filteredSubheadings = filterRowsByTopic(builderSubheadings, activeTopic, 'category');
    const filteredTaglines = filterRowsByTopic(builderTaglines, activeTopic, 'category');
    const filteredArticles = filterRowsByTopic(builderArticles, activeTopic, 'category');
    const filteredReports = filterRowsByTopic(builderReports, activeTopic, 'category');
    const filteredWhitePapers = filterRowsByTopic(builderWhitePapers, activeTopic, 'category');
    const filteredEbooks = filterRowsByTopic(builderEbooks, activeTopic, 'category');
    const filteredPosts = filterRowsByTopic(builderPosts, activeTopic, 'category');
    const filteredDescriptions = filterRowsByTopic(builderDescriptions, activeTopic, 'category');
    const filteredTranscripts = filterRowsByTopic(builderTranscripts, activeTopic, 'category');
    const filteredComments = filterRowsByTopic(builderComments, activeTopic, 'category');
    const filteredCtas = filterRowsByTopic(builderCtas, activeTopic, 'category');
    const filteredTweets = filterRowsByTopic(builderTweets, activeTopic, 'category');
    const filteredImages = filterRowsByTopic(images, activeTopic, 'category');
    const filteredVideos = filterRowsByTopic(videos, activeTopic, 'category');
    const filteredLeadMagnets = filterRowsByTopic(leadMagnets, activeTopic, 'category');

    setSelectOptions(
      byId('campaignChannelSelect'),
      channels.map((channel) => ({ value: channel.id, label: channelLabel(channel) || `Channel ${channel.id}` })),
      channels.length ? 'Channel' : 'No channels available yet',
      currentValues.channelId
    );

    setCampaignContentComboboxOptions(
      'campaignTopicSelect',
      comboboxOptionsFromMappedRows(builderTopics, (topic) => {
        const label = safeText(topic.topic || topic.category) || `Topic ${topic.id}`;
        return { label, searchText: label };
      }),
      builderTopics.length ? '' : 'Create topics in Messaging > Topics',
      currentValues.topicId
    );

    setSelectOptions(
      byId('campaignSegmentSelect'),
      (Array.isArray(state.segments) ? state.segments : []).map((segment) => ({
        value: segment.id,
        label: safeText(segment.name) || `Segment ${segment.id}`,
      })),
      'Segment (optional)',
      currentValues.segmentId
    );

    setSelectOptions(
      byId('campaignEmailTemplateSelect'),
      builderEmailTemplates.map((template) => ({
        value: template.id,
        label: safeText(template.name) || `Template ${template.id}`,
      })),
      builderEmailTemplates.length ? 'Template (optional)' : 'Template (create in Builder > Templates)',
      currentValues.emailTemplateId
    );

    setCampaignContentComboboxOptions(
      'campaignEmailSelect',
      comboboxOptionsFromTextRows(filteredEmails, 'email', 'Email'),
      filteredEmails.length ? '' : activeTopic ? 'No emails for this topic' : 'Create emails in Messaging > Emails',
      currentValues.emailId
    );

    setCampaignContentComboboxOptions(
      'campaignHeadlineSelect',
      comboboxOptionsFromTextRows(filteredHeadlines, 'headline', 'Headline'),
      filteredHeadlines.length ? '' : activeTopic ? 'No headlines for this topic' : 'Create headlines in Messaging > Headlines',
      currentValues.headlineId
    );

    setCampaignContentComboboxOptions(
      'campaignSubjectLineSelect',
      comboboxOptionsFromTextRows(filteredHeadlines, 'headline', 'Subject'),
      filteredHeadlines.length ? '' : activeTopic ? 'No subject lines for this topic' : 'Use headlines in Messaging > Headlines',
      currentValues.subjectLineId
    );

    setCampaignContentComboboxOptions(
      'campaignBlurbSelect',
      comboboxOptionsFromTextRows(filteredDescriptions, 'description', 'Blurb'),
      filteredDescriptions.length ? '' : activeTopic ? 'No blurbs for this topic' : 'Use descriptions in Messaging > Descriptions',
      currentValues.blurbId
    );

    setCampaignContentComboboxOptions(
      'campaignPitchSelect',
      comboboxOptionsFromTextRows(filteredPitches, 'pitch', 'Pitch'),
      filteredPitches.length ? '' : activeTopic ? 'No pitches for this topic' : 'Create pitches in Messaging > Pitches',
      currentValues.pitchId
    );

    setCampaignContentComboboxOptions(
      'campaignSubheadingSelect',
      comboboxOptionsFromTextRows(filteredSubheadings, 'subheading', 'Sub-heading'),
      filteredSubheadings.length ? '' : activeTopic ? 'No sub-headings for this topic' : 'Create sub-headings in Messaging > Sub-headings',
      currentValues.subheadingId
    );

    setCampaignContentComboboxOptions(
      'campaignTaglineSelect',
      comboboxOptionsFromTextRows(filteredTaglines, 'tagline', 'Tagline'),
      filteredTaglines.length ? '' : activeTopic ? 'No taglines for this topic' : 'Create taglines in Messaging > Taglines',
      currentValues.taglineId
    );

    renderCampaignHashtagPicker();

    setCampaignContentComboboxOptions(
      'campaignCtaSelect',
      comboboxOptionsFromTextRows(filteredCtas, 'cta', 'CTA'),
      filteredCtas.length ? '' : activeTopic ? 'No CTAs for this topic' : 'Create CTAs in Messaging > CTAs',
      currentValues.ctaId
    );

    setCampaignContentComboboxOptions(
      'campaignTweetSelect',
      comboboxOptionsFromTextRows(filteredTweets, 'content', 'Tweet', 80),
      filteredTweets.length
        ? ''
        : activeTopic
          ? 'No tweets for this topic — change topic or create in Messaging > Tweets'
          : 'Create tweets in Messaging > Tweets',
      currentValues.tweetId
    );

    setCampaignContentComboboxOptions(
      'campaignPostSelect',
      comboboxOptionsFromTextRows(filteredPosts, 'post', 'Post'),
      filteredPosts.length ? '' : activeTopic ? 'No posts for this topic' : 'Create posts in Messaging > Posts',
      currentValues.postId
    );

    setCampaignContentComboboxOptions(
      'campaignDescriptionSelect',
      comboboxOptionsFromTextRows(filteredDescriptions, 'description', 'Description'),
      filteredDescriptions.length ? '' : activeTopic ? 'No descriptions for this topic' : 'Create descriptions in Messaging > Descriptions',
      currentValues.descriptionId
    );

    setCampaignContentComboboxOptions(
      'campaignTranscriptSelect',
      comboboxOptionsFromTextRows(filteredTranscripts, 'transcript', 'Transcript'),
      filteredTranscripts.length ? '' : activeTopic ? 'No transcripts for this topic' : 'Create transcripts in Messaging > Transcripts',
      currentValues.transcriptId
    );

    setCampaignContentComboboxOptions(
      'campaignCommentSelect',
      comboboxOptionsFromTextRows(filteredComments, 'comment', 'Comment'),
      filteredComments.length ? '' : activeTopic ? 'No comments for this topic' : 'Create comments in Messaging > Comments',
      currentValues.commentId
    );

    setCampaignContentComboboxOptions(
      'campaignPrimaryImageSelect',
      comboboxOptionsFromMappedRows(filteredImages, (asset) => {
        const label = safeText(asset.assetName) || `Image ${asset.id}`;
        return { label, searchText: label };
      }),
      filteredImages.length ? '' : activeTopic ? 'No images for this topic' : 'Upload image assets first',
      currentValues.primaryImageId
    );

    setCampaignContentComboboxOptions(
      'campaignPrimaryVideoSelect',
      comboboxOptionsFromMappedRows(filteredVideos, (asset) => {
        const label = safeText(asset.assetName) || `Video ${asset.id}`;
        return { label, searchText: label };
      }),
      filteredVideos.length ? '' : activeTopic ? 'No videos for this topic' : 'Upload video assets first',
      currentValues.primaryVideoId
    );

    const pageOptions = builderPages.map((page) => ({ value: page.id, label: `Builder: ${safeText(page.name) || page.id}` }));
    const externalSites = ['isitas.org', 'isitism.org', 'isitgame.org', 'itcoin.isitas.org'];
    externalSites.forEach(site => {
      pageOptions.push({ value: site, label: `Site: ${site}` });
    });
    channels.forEach(channel => {
      const name = channelLabel(channel) || channel.id;
      pageOptions.push({ value: `social_${channel.id}`, label: `Social: ${name}` });
    });

    setSelectOptions(
      byId('campaignLandingPageSelect'),
      pageOptions,
      'Page / Destination',
      currentValues.landingPageId
    );

    setSelectOptions(
      byId('campaignFormObjectSelect'),
      builderForms.map((item) => ({ value: item.id, label: safeText(item.name) || `Form ${item.id}` })),
      builderForms.length ? 'Form' : 'Form (create in Builder > Forms)',
      currentValues.formObjectId
    );

    setCampaignContentComboboxOptions(
      'campaignArticleSelect',
      comboboxOptionsFromTextRows(filteredArticles, 'title', 'Article'),
      filteredArticles.length ? '' : activeTopic ? 'No articles for this topic' : 'Create articles in Messaging > Articles',
      currentValues.articleId
    );

    setCampaignContentComboboxOptions(
      'campaignReportSelect',
      comboboxOptionsFromTextRows(filteredReports, 'title', 'Report'),
      filteredReports.length ? '' : activeTopic ? 'No reports for this topic' : 'Create reports in Messaging > Reports',
      currentValues.reportId
    );

    setCampaignContentComboboxOptions(
      'campaignWhitePaperSelect',
      comboboxOptionsFromTextRows(filteredWhitePapers, 'title', 'White Paper'),
      filteredWhitePapers.length ? '' : activeTopic ? 'No white papers for this topic' : 'Create white papers in Messaging > White Papers',
      currentValues.whitePaperId
    );

    setCampaignContentComboboxOptions(
      'campaignEbookSelect',
      comboboxOptionsFromTextRows(filteredEbooks, 'title', 'eBook'),
      filteredEbooks.length ? '' : activeTopic ? 'No eBooks for this topic' : 'Create eBooks in Messaging > eBooks',
      currentValues.ebookId
    );

    setCampaignContentComboboxOptions(
      'campaignLeadMagnetSelect',
      comboboxOptionsFromMappedRows(filteredLeadMagnets, (asset) => {
        const label = safeText(asset.assetName) || `Asset ${asset.id}`;
        return { label, searchText: label };
      }),
      filteredLeadMagnets.length ? '' : activeTopic ? 'No PDFs for this topic' : 'Upload PDF assets first',
      currentValues.leadMagnetId
    );

    const campaignForm = byId('campaignForm');
    const submitBtn = campaignForm?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = channels.length === 0;
    applyCampaignChannelProfile(currentValues.channelId || safeText(byId('campaignChannelSelect')?.value));
    renderCampaignLivePreview();
  }

  async function loadBuilderSources() {
    await ensureCampaignProjectContext();
    const [channelsRes, assetsRes, segmentsRes, tweetsRes, hashtagsRes, emailsRes, emailTemplatesRes, topicsRes, headlinesRes, subheadingsRes, taglinesRes, pitchesRes, articlesRes, reportsRes, whitePapersRes, ebooksRes, postsRes, descriptionsRes, transcriptsRes, commentsRes, ctasRes, pagesRes, formsRes] = await Promise.allSettled([
      api('/api/channels'),
      api('/api/assets'),
      api('/api/segments'),
      api('/api/messaging/tweets?limit=5000'),
      api('/api/messaging/hashtags?limit=5000'),
      api('/api/messaging/emails?limit=5000'),
      api('/api/builder/email-templates'),
      api('/api/messaging/topics?limit=5000'),
      api('/api/messaging/headlines?limit=5000'),
      api('/api/messaging/subheadings?limit=5000'),
      api('/api/messaging/taglines?limit=5000'),
      api('/api/messaging/pitches?limit=5000'),
      api('/api/messaging/articles?limit=200'),
      api('/api/messaging/reports?limit=200'),
      api('/api/messaging/white-papers?limit=200'),
      api('/api/messaging/ebooks?limit=200'),
      api('/api/messaging/posts?limit=5000'),
      api('/api/messaging/descriptions?limit=5000'),
      api('/api/messaging/transcripts?limit=5000'),
      api('/api/messaging/comments?limit=5000'),
      api('/api/messaging/ctas?limit=5000'),
      api('/api/builder/landing-pages'),
      api('/api/builder/forms'),
    ]);

    if (channelsRes.status === 'fulfilled' && Array.isArray(channelsRes.value.channels)) {
      state.channels = channelsRes.value.channels;
    }
    if (assetsRes.status === 'fulfilled' && Array.isArray(assetsRes.value.assets)) {
      state.assets = assetsRes.value.assets;
    }
    if (segmentsRes.status === 'fulfilled' && Array.isArray(segmentsRes.value.segments)) {
      state.segments = segmentsRes.value.segments;
    }

    if (tweetsRes.status === 'fulfilled' && Array.isArray(tweetsRes.value.tweets)) {
      builderTweets = tweetsRes.value.tweets;
    } else {
      builderTweets = [];
      const tweetsErr = safeText(tweetsRes.reason?.message);
      if (tweetsErr) {
        notify(`Could not load tweets: ${tweetsErr}`, true);
      }
    }
    builderHashtags = hashtagsRes.status === 'fulfilled' && Array.isArray(hashtagsRes.value.hashtags)
      ? hashtagsRes.value.hashtags
      : [];
    builderEmails = emailsRes.status === 'fulfilled' && Array.isArray(emailsRes.value.emails)
      ? emailsRes.value.emails
      : [];
    builderEmailTemplates = emailTemplatesRes.status === 'fulfilled' && Array.isArray(emailTemplatesRes.value.emailTemplates)
      ? emailTemplatesRes.value.emailTemplates
      : [];
    builderTopics = topicsRes.status === 'fulfilled'
      ? (Array.isArray(topicsRes.value.topics)
        ? topicsRes.value.topics
        : Array.isArray(topicsRes.value.categories)
          ? topicsRes.value.categories
        : Array.isArray(topicsRes.value.data)
          ? topicsRes.value.data
          : Array.isArray(topicsRes.value)
            ? topicsRes.value
            : [])
      : [];
    builderHeadlines = headlinesRes.status === 'fulfilled' && Array.isArray(headlinesRes.value.headlines) ? headlinesRes.value.headlines : [];
    builderSubheadings = subheadingsRes.status === 'fulfilled' && Array.isArray(subheadingsRes.value.subheadings) ? subheadingsRes.value.subheadings : [];
    builderTaglines = taglinesRes.status === 'fulfilled' && Array.isArray(taglinesRes.value.taglines) ? taglinesRes.value.taglines : [];
    builderPitches = pitchesRes.status === 'fulfilled' && Array.isArray(pitchesRes.value.pitches) ? pitchesRes.value.pitches : [];
    builderArticles = articlesRes.status === 'fulfilled' && Array.isArray(articlesRes.value.articles) ? articlesRes.value.articles : [];
    builderReports = reportsRes.status === 'fulfilled' && Array.isArray(reportsRes.value.reports) ? reportsRes.value.reports : [];
    builderWhitePapers = whitePapersRes.status === 'fulfilled' && Array.isArray(whitePapersRes.value.whitePapers) ? whitePapersRes.value.whitePapers : [];
    builderEbooks = ebooksRes.status === 'fulfilled' && Array.isArray(ebooksRes.value.ebooks) ? ebooksRes.value.ebooks : [];
    builderPosts = postsRes.status === 'fulfilled' && Array.isArray(postsRes.value.posts) ? postsRes.value.posts : [];
    builderDescriptions = descriptionsRes.status === 'fulfilled' && Array.isArray(descriptionsRes.value.descriptions) ? descriptionsRes.value.descriptions : [];
    builderTranscripts = transcriptsRes.status === 'fulfilled' && Array.isArray(transcriptsRes.value.transcripts) ? transcriptsRes.value.transcripts : [];
    builderComments = commentsRes.status === 'fulfilled' && Array.isArray(commentsRes.value.comments) ? commentsRes.value.comments : [];
    builderCtas = ctasRes.status === 'fulfilled' && Array.isArray(ctasRes.value.ctas) ? ctasRes.value.ctas : [];
    builderPages = pagesRes.status === 'fulfilled' && Array.isArray(pagesRes.value.pages) ? pagesRes.value.pages : [];
    builderForms = formsRes.status === 'fulfilled' && Array.isArray(formsRes.value.forms) ? formsRes.value.forms : [];

    renderBuilderSelects();
    renderCampaigns();
  }

  function getFilterValues() {
    return {
      name: (byId('campaignFilterName')?.value || '').trim().toLowerCase(),
      status: byId('campaignFilterStatus')?.value || '',
      segment: byId('campaignFilterSegment')?.value || '',
      channel: byId('campaignFilterChannel')?.value || '',
      template: byId('campaignFilterTemplate')?.value || '',
      page: byId('campaignFilterPage')?.value || '',
      subject: (byId('campaignFilterSubject')?.value || '').trim().toLowerCase(),
    };
  }

  function renderCampaigns() {
    const tbody = byId('campaignCards');
    if (!tbody) return;
    tbody.innerHTML = '';

    const allRows = Array.isArray(state.campaigns) ? state.campaigns : [];
    if (!allRows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.textContent = 'No campaigns yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    // Apply filters
    const f = getFilterValues();
    const rows = allRows.filter(campaign => {
      const config = parseCampaignConfig(campaign);
      if (f.name && !(campaign.name || '').toLowerCase().includes(f.name)) return false;
      if (f.status && campaignStatusValue(campaign, config) !== f.status) return false;
      if (f.segment) {
        const segId = String(config?.segmentId || campaign.segmentId || '');
        if (segId !== f.segment) return false;
      }
      if (f.channel) {
        const chId = String(config?.channelId || '');
        if (chId !== f.channel) return false;
      }
      if (f.template) {
        const tmplId = String(config?.emailTemplateId || '');
        if (tmplId !== f.template) return false;
      }
      if (f.page) {
        const pgId = String(config?.landingPageId || '');
        if (pgId !== f.page) return false;
      }
      if (f.subject) {
        const subj = (config?.subjectLineLabel || campaign.subject || config?.headlineLabel || '').toLowerCase();
        if (!subj.includes(f.subject)) return false;
      }
      return true;
    });

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.textContent = 'No matching campaigns.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const channelsById = new Map((Array.isArray(state.channels) ? state.channels : []).map((channel) => [String(channel.id), channel]));
    const assetsById = new Map((Array.isArray(state.assets) ? state.assets : []).map((asset) => [String(asset.id), asset]));
    const segmentsById = new Map((Array.isArray(state.segments) ? state.segments : []).map((segment) => [String(segment.id), segment]));
    const emailTemplatesById = new Map(builderEmailTemplates.map((template) => [String(template.id), template]));
    const landingPagesById = new Map(builderPages.map((page) => [String(page.id), page]));

    rows.forEach((campaign) => {
      const config = parseCampaignConfig(campaign);
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = safeText(campaign.name) || '-';
      tr.appendChild(nameTd);

      const statusTd = document.createElement('td');
      statusTd.textContent = campaignStatusLabel(campaignStatusValue(campaign, config));
      tr.appendChild(statusTd);

      const segmentTd = document.createElement('td');
      const segment = (config?.segmentId || campaign.segmentId)
        ? segmentsById.get(String(config?.segmentId || campaign.segmentId))
        : null;
      segmentTd.textContent = safeText(segment?.name || config?.segmentLabel) || '-';
      tr.appendChild(segmentTd);

      const channelTd = document.createElement('td');
      const channel = config?.channelId ? channelsById.get(String(config.channelId)) : null;
      channelTd.textContent = channelLabel(channel) || '-';
      tr.appendChild(channelTd);

      const templateTd = document.createElement('td');
      const template = config?.emailTemplateId ? emailTemplatesById.get(String(config.emailTemplateId)) : null;
      templateTd.textContent = safeText(template?.name || config?.emailTemplateLabel) || '-';
      tr.appendChild(templateTd);

      const pageTd = document.createElement('td');
      const page = config?.landingPageId ? landingPagesById.get(String(config.landingPageId)) : null;
      pageTd.textContent = safeText(page?.name || config?.landingPageLabel) || '-';
      tr.appendChild(pageTd);

      const subjectTd = document.createElement('td');
      subjectTd.textContent = safeText(config?.subjectLineLabel || campaign.subject || config?.headlineLabel) || '-';
      tr.appendChild(subjectTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'campaign-actions-cell';
      const editBtn = App.makeIconButton('edit', 'Edit Campaign', () => {
        openCampaignEditor(campaign);
      });
      const cloneBtn = App.makeIconButton('copy', 'Clone Campaign', () => {
        cloneCampaign(campaign);
      }, { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Campaign', async () => {
        if (!confirm(`Delete campaign "${safeText(campaign.name) || campaign.id}"?`)) return;
        try {
          await api(`/api/campaigns/${encodeURIComponent(campaign.id)}`, { method: 'DELETE' });
          notify('Campaign deleted');
          await loadBuilderSources();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(cloneBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    });
  }

  function setCampaignFormMode(isEditing) {
    const submitBtn = byId('campaignSubmitBtn');
    const heading = document.querySelector('#campaignCreatePage h2');
    if (submitBtn) submitBtn.textContent = isEditing ? 'Update Campaign' : 'Create Campaign';
    if (heading) heading.textContent = isEditing ? 'Edit Campaign' : 'Create Campaign';
  }

  function applySelectValue(select, value) {
    if (!select) return;
    const desired = safeText(value);
    if (!desired) {
      select.value = '';
      if (isCampaignContentCombobox(select.id)) syncCampaignComboboxSearchFromSelect(select.id);
      return;
    }
    if (Array.from(select.options).some((option) => String(option.value) === desired)) {
      select.value = desired;
      if (isCampaignContentCombobox(select.id)) syncCampaignComboboxSearchFromSelect(select.id);
    }
  }

  function ensureCampaignFormVisible() {
    if (typeof App !== 'undefined' && App.setActivePage) {
      App.setActivePage('campaignCreatePage');
    }
  }

  function updateCampaignFieldGlows() {
    const content = byId('campaignContentConditional');
    if (!content) return;
    const fields = content.querySelectorAll('.campaign-combobox input[type="text"], select:not(.campaign-combobox-native)');
    fields.forEach(el => {
      if (el.tagName === 'BUTTON' || el.type === 'hidden') return;
      if (el.value && el.value.trim() !== '') {
        el.classList.add('populated-glow');
        el.classList.remove('empty-glow');
      } else {
        el.classList.add('empty-glow');
        el.classList.remove('populated-glow');
      }
    });
  }

  function populateCampaignForm(campaign, cloneMode = false) {
    const form = byId('campaignForm');
    if (!form || !campaign) return;
    const config = parseCampaignConfig(campaign) || {};
    resetCampaignContentRows();
    editingCampaignId = cloneMode ? '' : safeText(campaign.id);
    const idInput = byId('campaignIdInput');
    if (idInput) idInput.value = editingCampaignId;
    form.elements.name.value = cloneMode ? `${safeText(campaign.name)} Copy`.trim() : safeText(campaign.name);
    form.elements.status.value = cloneMode ? 'draft' : campaignStatusValue(campaign, config);
    applySelectValue(byId('campaignChannelSelect'), config.channelId);
    applyTopicValue(byId('campaignTopicSelect'), config.topicId, config.topicLabel);
    applySelectValue(byId('campaignSegmentSelect'), config.segmentId || campaign.segmentId);
    applySelectValue(byId('campaignEmailTemplateSelect'), config.emailTemplateId);
    applySelectValue(byId('campaignEmailSelect'), config.emailId);
    applySelectValue(byId('campaignLandingPageSelect'), config.landingPageId);
    applySelectValue(byId('campaignFormObjectSelect'), config.formObjectId);
    applySelectValue(byId('campaignHeadlineSelect'), config.headlineId);
    applySelectValue(byId('campaignSubjectLineSelect'), config.subjectLineId);
    applySelectValue(byId('campaignBlurbSelect'), config.blurbId);
    applySelectValue(byId('campaignPitchSelect'), config.pitchId);
    applySelectValue(byId('campaignSubheadingSelect'), config.subheadingId);
    applySelectValue(byId('campaignTaglineSelect'), config.taglineId);
    applySelectValue(byId('campaignArticleSelect'), config.articleId);
    applySelectValue(byId('campaignReportSelect'), config.reportId);
    applySelectValue(byId('campaignWhitePaperSelect'), config.whitePaperId);
    applySelectValue(byId('campaignEbookSelect'), config.ebookId);
    applySelectValue(byId('campaignPostSelect'), config.postId);
    applySelectValue(byId('campaignDescriptionSelect'), config.descriptionId);
    applySelectValue(byId('campaignTranscriptSelect'), config.transcriptId);
    applySelectValue(byId('campaignCommentSelect'), config.commentId);
    applySelectValue(byId('campaignTweetSelect'), config.tweetId);
    applySelectValue(byId('campaignCtaSelect'), config.ctaId);
    applySelectValue(byId('campaignPrimaryImageSelect'), config.primaryImageId);
    applySelectValue(byId('campaignPrimaryVideoSelect'), config.primaryVideoId);
    setSelectedCampaignHashtagIds(campaignHashtagIdsFromConfig(config));
    applyCampaignChannelProfile(config.channelId);
    setHiddenCampaignContentFieldIds(config.hiddenContentFieldIds);
    setCampaignFormMode(!cloneMode);
    ensureCampaignFormVisible();
    updateCampaignFieldGlows();
    renderCampaignLivePreview();
  }

  async function openCampaignEditor(campaign) {
    await loadBuilderSources();
    populateCampaignForm(campaign, false);
  }

  async function cloneCampaign(campaign) {
    await loadBuilderSources();
    populateCampaignForm(campaign, true);
  }

  function selectedOptionText(select) {
    if (!select) return '';
    const option = select.options[select.selectedIndex];
    return safeText(option?.dataset?.fullText) || safeText(option?.textContent);
  }

  function selectedOptionTextIfValue(select) {
    return safeText(select?.value) ? selectedOptionText(select) : '';
  }

  // --- Campaign content row: delete icons + Add Content restore button ---

  function updateAddContentBtnVisibility() {
    const addBtn = byId('campaignAddContentBtn');
    if (!addBtn) return;
    const rows = document.querySelectorAll('#campaignContentConditional .campaign-content-row');
    const hasHidden = Array.from(rows).some(r => r.classList.contains('user-hidden'));
    addBtn.style.display = hasHidden ? '' : 'none';
  }

  function hideContentRow(row) {
    const fieldId = safeText(row?.dataset?.fieldId);
    if (fieldId) hiddenCampaignContentFieldIds.add(fieldId);
    row.classList.add('user-hidden');
    row.style.display = 'none';
    // Clear the select value so hidden fields don't submit stale data
    const select = row.querySelector('select');
    if (select) select.value = '';
    if (row.dataset.fieldId === 'campaignHashtagGroupSelect') {
      setSelectedCampaignHashtagIds([]);
    }
    updateAddContentBtnVisibility();
    renderCampaignLivePreview();
  }

  function showContentRow(row) {
    const fieldId = safeText(row?.dataset?.fieldId);
    if (fieldId) hiddenCampaignContentFieldIds.delete(fieldId);
    row.classList.remove('user-hidden');
    // Only show if channel profile also wants it visible
    const channelVisible = row.dataset.channelVisible !== '0';
    row.style.display = channelVisible ? '' : 'none';
    updateAddContentBtnVisibility();
    renderCampaignLivePreview();
  }

  function initCampaignContentRowControls() {
    const contentWrap = byId('campaignContentConditional');
    if (!contentWrap) return;

    // Inject delete icon into each content row
    const rows = contentWrap.querySelectorAll('.campaign-content-row');
    rows.forEach(row => {
      // Skip if already has a delete button
      if (row.querySelector('.content-remove-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'content-remove-btn';
      btn.title = 'Remove this content type';
      btn.textContent = '✕';
      btn.addEventListener('click', () => hideContentRow(row));
      row.appendChild(btn);
    });

    // Wire "Add Content" button
    const addBtn = byId('campaignAddContentBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => showAddContentPicker(addBtn));
      // Initially hidden until something is removed
      addBtn.style.display = 'none';
    }
  }

  function showAddContentPicker(anchorBtn) {
    // Remove any existing picker
    const existing = document.getElementById('campaignAddContentPicker');
    if (existing) { existing.remove(); return; }

    const rows = document.querySelectorAll('#campaignContentConditional .campaign-content-row.user-hidden');
    if (!rows.length) return;

    const picker = document.createElement('div');
    picker.id = 'campaignAddContentPicker';
    picker.style.cssText = 'background:#fff; border:1px solid var(--border,#ccc); border-radius:6px; padding:0.5rem; margin-top:0.5rem; box-shadow:0 4px 12px rgba(0,0,0,0.12); max-width:300px;';

    rows.forEach(row => {
      const label = row.querySelector('label');
      const labelText = label ? label.textContent.replace(/:$/, '').trim() : row.dataset.fieldId;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'btn';
      item.style.cssText = 'display:block; width:100%; text-align:left; margin-bottom:4px; font-size:0.85rem;';
      item.textContent = labelText;
      item.addEventListener('click', () => {
        showContentRow(row);
        // Remove picker after selection
        const p = document.getElementById('campaignAddContentPicker');
        if (p) p.remove();
      });
      picker.appendChild(item);
    });

    // Insert picker right after the Add Content button
    anchorBtn.insertAdjacentElement('afterend', picker);

    // Close picker on outside click
    function closeOnOutsideClick(e) {
      if (!picker.contains(e.target) && e.target !== anchorBtn) {
        picker.remove();
        document.removeEventListener('click', closeOnOutsideClick, true);
      }
    }
    setTimeout(() => document.addEventListener('click', closeOnOutsideClick, true), 0);
  }

  function init() {
    const rulesToggleBtn = byId('campaignToggleRulesBtn');
    const previewBtn = byId('campaignPreviewBtn');
    const form = byId('campaignForm');
    const rulesChannelSelect = byId('campaignRulesChannelSelect');
    const rulesSaveBtn = byId('campaignRulesSaveBtn');
    const rulesResetBtn = byId('campaignRulesResetBtn');

    const contentArea = byId('campaignContentConditional');
    if (contentArea) {
      contentArea.addEventListener('change', () => {
        updateCampaignFieldGlows();
        renderCampaignLivePreview();
      });
    }

    // --- Content row delete icons + Add Content button ---
    initCampaignContentComboboxes();
    initCampaignContentRowControls();

    // --- Filter bar ---
    const filterBtn = byId('campaignFilterBtn');
    if (filterBtn) filterBtn.addEventListener('click', renderCampaigns);
    // Enter key in text filter inputs triggers filter
    ['campaignFilterName', 'campaignFilterSubject'].forEach(id => {
      const el = byId(id);
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); renderCampaigns(); } });
    });

    if (rulesToggleBtn) {
      rulesToggleBtn.addEventListener('click', async () => {
        await loadBuilderSources();
        toggleRulesPanel();
      });
    }
    if (previewBtn) {
      previewBtn.addEventListener('click', openCampaignPreview);
    }
    if (rulesChannelSelect) {
      rulesChannelSelect.addEventListener('change', renderChannelRulesEditor);
    }
    if (rulesSaveBtn) {
      rulesSaveBtn.addEventListener('click', saveChannelRules);
    }
    if (rulesResetBtn) {
      rulesResetBtn.addEventListener('click', resetChannelRules);
    }

    document.addEventListener('messaging:formatImported', (event) => {
      const slug = String(event?.detail?.slug || '').trim().toLowerCase();
      if (slug && slug !== 'tweets') return;
      loadBuilderSources().catch((err) => notify(err.message, true));
    });

    if (form) {
      const channelSelect = byId('campaignChannelSelect');
      const topicSelect = byId('campaignTopicSelect');
      if (channelSelect) {
        channelSelect.addEventListener('change', function () {
          applyCampaignChannelProfile(channelSelect.value, { resetUserHidden: true });
          updateCampaignFieldGlows();
          renderCampaignLivePreview();
        });
      }
      if (topicSelect) {
        topicSelect.addEventListener('change', function () {
          renderBuilderSelects();
          renderCampaignLivePreview();
        });
      }
      form.addEventListener('input', renderCampaignLivePreview);
      const hashtagPickerBtn = byId('campaignHashtagPickerBtn');
      if (hashtagPickerBtn) {
        hashtagPickerBtn.addEventListener('click', openCampaignHashtagPicker);
      }
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const channelSelect = byId('campaignChannelSelect');
        const topicSelect = byId('campaignTopicSelect');
        const segmentSelect = byId('campaignSegmentSelect');
        const emailTemplateSelect = byId('campaignEmailTemplateSelect');
        const emailSelect = byId('campaignEmailSelect');
        const landingSelect = byId('campaignLandingPageSelect');
        const formObjectSelect = byId('campaignFormObjectSelect');
        const headlineSelect = byId('campaignHeadlineSelect');
        const subjectLineSelect = byId('campaignSubjectLineSelect');
        const blurbSelect = byId('campaignBlurbSelect');
        const pitchSelect = byId('campaignPitchSelect');
        const subheadingSelect = byId('campaignSubheadingSelect');
        const taglineSelect = byId('campaignTaglineSelect');
        const articleSelect = byId('campaignArticleSelect');
        const reportSelect = byId('campaignReportSelect');
        const whitePaperSelect = byId('campaignWhitePaperSelect');
        const ebookSelect = byId('campaignEbookSelect');
        const postSelect = byId('campaignPostSelect');
        const descriptionSelect = byId('campaignDescriptionSelect');
        const transcriptSelect = byId('campaignTranscriptSelect');
        const commentSelect = byId('campaignCommentSelect');
        const tweetSelect = byId('campaignTweetSelect');
        const ctaSelect = byId('campaignCtaSelect');
        const imageSelect = byId('campaignPrimaryImageSelect');
        const videoSelect = byId('campaignPrimaryVideoSelect');
        const leadMagnetSelect = byId('campaignLeadMagnetSelect');
        const selectedHashtagsText = selectedHashtagRows().map(hashtagText).filter(Boolean).join(' ');
        const selectedStatus = normalizeCampaignStatus(form.elements.status?.value);

        const payload = {
          name: safeText(form.elements.name?.value),
          status: selectedStatus,
          subject: selectedOptionTextIfValue(subjectLineSelect) || selectedOptionTextIfValue(headlineSelect) || selectedOptionTextIfValue(tweetSelect) || safeText(form.elements.name?.value),
          content: JSON.stringify({
            builder: 'campaign-v1',
            status: selectedStatus,
            statusLabel: campaignStatusLabel(selectedStatus),
            hiddenContentFieldIds: Array.from(hiddenCampaignContentFieldIds),
            channelId: safeText(channelSelect?.value),
            channelLabel: selectedOptionText(channelSelect),
            topicId: safeText(topicSelect?.value),
            topicLabel: selectedOptionText(topicSelect),
            segmentId: safeText(segmentSelect?.value),
            segmentLabel: selectedOptionText(segmentSelect),
            emailTemplateId: safeText(emailTemplateSelect?.value),
            emailTemplateLabel: selectedOptionText(emailTemplateSelect),
            emailId: safeText(emailSelect?.value),
            emailLabel: selectedOptionText(emailSelect),
            landingPageId: safeText(landingSelect?.value),
            landingPageLabel: selectedOptionText(landingSelect),
            formObjectId: safeText(formObjectSelect?.value),
            formObjectLabel: selectedOptionText(formObjectSelect),
            headlineId: safeText(headlineSelect?.value),
            headlineLabel: selectedOptionText(headlineSelect),
            subjectLineId: safeText(subjectLineSelect?.value),
            subjectLineLabel: selectedOptionText(subjectLineSelect),
            blurbId: safeText(blurbSelect?.value),
            blurbLabel: selectedOptionText(blurbSelect),
            pitchId: safeText(pitchSelect?.value),
            pitchLabel: selectedOptionText(pitchSelect),
            subheadingId: safeText(subheadingSelect?.value),
            subheadingLabel: selectedOptionText(subheadingSelect),
            taglineId: safeText(taglineSelect?.value),
            taglineLabel: selectedOptionText(taglineSelect),
            articleId: safeText(articleSelect?.value),
            articleLabel: selectedOptionText(articleSelect),
            reportId: safeText(reportSelect?.value),
            reportLabel: selectedOptionText(reportSelect),
            whitePaperId: safeText(whitePaperSelect?.value),
            whitePaperLabel: selectedOptionText(whitePaperSelect),
            ebookId: safeText(ebookSelect?.value),
            ebookLabel: selectedOptionText(ebookSelect),
            postId: safeText(postSelect?.value),
            postLabel: selectedOptionText(postSelect),
            postUrl: safeText(selectedCampaignPostRow()?.url),
            descriptionId: safeText(descriptionSelect?.value),
            descriptionLabel: selectedOptionText(descriptionSelect),
            transcriptId: safeText(transcriptSelect?.value),
            transcriptLabel: selectedOptionText(transcriptSelect),
            commentId: safeText(commentSelect?.value),
            commentLabel: selectedOptionText(commentSelect),
            tweetId: safeText(tweetSelect?.value),
            tweetLabel: selectedOptionText(tweetSelect),
            ctaId: safeText(ctaSelect?.value),
            ctaLabel: selectedOptionText(ctaSelect),
            primaryImageId: safeText(imageSelect?.value),
            primaryImageLabel: selectedOptionText(imageSelect),
            primaryVideoId: safeText(videoSelect?.value),
            primaryVideoLabel: selectedOptionText(videoSelect),
            hashtagGroupId: '',
            hashtagGroupLabel: selectedHashtagsText,
            hashtagIds: Array.from(selectedCampaignHashtagIds),
            hashtagsText: selectedHashtagsText,
            leadMagnetId: safeText(leadMagnetSelect?.value),
            leadMagnetLabel: selectedOptionText(leadMagnetSelect),
          }),
          segmentId: safeText(segmentSelect?.value),
        };

        if (!payload.name) {
          notify('Campaign name is required', true);
          return;
        }
        if (!safeText(channelSelect?.value)) {
          notify('Select a channel', true);
          return;
        }

        try {
          const isEditing = Boolean(editingCampaignId);
          let saveResult = null;
          if (editingCampaignId) {
            saveResult = await api(`/api/campaigns/${encodeURIComponent(editingCampaignId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
          } else {
            saveResult = await api('/api/campaigns', { method: 'POST', body: JSON.stringify(payload) });
          }
          const savedCampaign = saveResult?.campaign || saveResult?.data;
          if (savedCampaign && savedCampaign.id) {
            savedCampaign.status = selectedStatus;
            const rows = Array.isArray(state.campaigns) ? state.campaigns.slice() : [];
            const existingIndex = rows.findIndex((campaign) => String(campaign.id) === String(savedCampaign.id));
            if (existingIndex >= 0) rows[existingIndex] = { ...rows[existingIndex], ...savedCampaign };
            else rows.unshift(savedCampaign);
            state.campaigns = rows;
          }
          form.reset();
          setSelectedCampaignHashtagIds([]);
          resetCampaignContentRows();
          editingCampaignId = '';
          const idInput = byId('campaignIdInput');
          if (idInput) idInput.value = '';
          setCampaignFormMode(false);
          renderBuilderSelects();
          if (typeof App !== 'undefined' && App.setActivePage) {
            App.setActivePage('campaignsPage');
          }
          notify(isEditing ? 'Campaign updated' : 'Campaign created');
          await loadBuilderSources();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
  }

  return {
    manifest: { id: 'campaigns', label: 'Campaigns', pageId: 'campaignsPage', secondaryPages: ['campaignCreatePage'] },
    init,
    refresh: loadBuilderSources,
    renderCampaigns,
    onPageActivated: loadBuilderSources,
    toggleRulesPanel,
  };
})();
