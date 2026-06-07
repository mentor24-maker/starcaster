/**
 * public/js/acquire.js
 * Acquire jobs table, direct web acquire, and OpenClaw job lifecycle actions.
 */

window.App = window.App || {};
App.acquire = (function () {
  const { state, els, api, notify, setPreview, prettyJson } = App;
  let redditAcquireProgressTimer = null;
  let lastRedditDiscoveryResult = null;
  let lastBlueskyDiscoveryResult = null;
  let blueskyDiscoverySelectedPostUrls = new Set();
  const BLUESKY_DISCOVERY_FEEDBACK_KEY_PREFIX = 'alphire:bluesky:discovery-feedback:';
  const BLUESKY_REPLY_FEEDBACK_KEY_PREFIX = 'alphire:bluesky:reply-feedback:';
  const YT_MINER_RESPONSE_CONTEXT_KEY = 'yt_miner_response_context_v1';
  const YT_MINER_RESPONSE_GUIDELINES_KEY = 'yt_miner_response_guidelines_v1';
  const DIRECT_ACQUIRE_KEYWORD_EXCLUSIONS_KEY = 'alphire:direct-acquire:keyword-exclusions:v1';
  const DIRECT_ACQUIRE_KEYWORD_REASONS_KEY = 'alphire:direct-acquire:keyword-exclusion-reasons:v1';
  const DIRECT_ACQUIRE_KEYWORD_TOPICS_KEY = 'alphire:direct-acquire:keyword-topics:v1';
  const ACQUIRE_SETTINGS_KEY = 'alphire:acquire:settings:v1';
  const DEFAULT_ACQUIRE_YOUTUBE_BAN_REASONS = [
    'Corporate',
    'Personal',
    'Not Serious',
    'Low Volume',
    'AI Slop',
  ];
  const DEFAULT_ACQUIRE_WEBSITE_DEFAULTS = {
    acquireSocial: true,
    acquireKeywords: true,
    acquireHashtags: true,
    acquireImages: true,
    acquirePages: true,
    acquirePeerSites: false,
    maxPages: 10,
    peerSitesLimit: 20,
    imagesLimit: 20,
    snippetLength: 600,
  };
  const DIRECT_ACQUIRE_KEYWORD_REASON_OPTIONS = [
    ['', 'No Exclusion'],
    ['brand', 'Brand'],
    ['generic', 'Generic'],
    ['navigational', 'Navigational'],
    ['boilerplate', 'Boilerplate'],
    ['location', 'Location'],
    ['legal', 'Legal'],
  ];
  let directAcquireImageCategories = [];
  let directAcquireSelectedImages = new Set();
  let directAcquireImageCategoryByUrl = new Map();
  let directAcquireImagesExpanded = false;
  let directAcquireSelectedHashtags = new Set();
  let directAcquireSelectedKeywords = new Set();

  function directAcquireHashtagBodyLength(hashtag) {
    return String(hashtag || '').trim().replace(/^#+/, '').length;
  }

  function isDirectAcquireTwoCharacterHashtag(hashtag) {
    return directAcquireHashtagBodyLength(hashtag) === 2;
  }

  function filterDirectAcquireHashtagRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter((item) => {
      const hashtag = String(item?.hashtag || '').trim();
      return hashtag && !isDirectAcquireTwoCharacterHashtag(hashtag);
    });
  }
  let directAcquireProgressTimer = null;
  let directAcquireTopics = [];
  let directAcquireWebsitePeers = [];
  let directAcquireWebsitePeerEditingId = '';
  let directAcquireProjectSourceUrl = '';
  let directAcquirePeerDiscoveryResults = [];
  const WEBSITE_PEER_MODELS = Array.isArray(App.WEBSITE_PEER_MODELS) ? App.WEBSITE_PEER_MODELS.slice() : [];
  const ACQUIRE_WEBSITE_ROLE_LABELS = {
    project: 'Project Website',
    peer: 'Peer Website',
    model: 'Model Website',
  };
  const ACQUIRE_WEBSITE_TYPE_LABELS = {
    peer: 'Peer',
    model: 'Model',
  };
  const SECTION_SETTINGS_LINKS = [
    { label: 'Acquire Settings', pageId: 'acquireSettingsPage' },
    { label: 'Contacts Settings', pageId: 'contactsSettingsPage' },
    { label: 'Channels Settings', pageId: 'channelsSettingsPage' },
    { label: 'Messaging Settings', pageId: 'messagingSettingsPage' },
    { label: 'Assets Settings', pageId: 'assetsSettingsPage' },
    { label: 'Builder Settings', pageId: 'builderSettingsPage' },
    { label: 'Campaigns Settings', pageId: 'campaignSettingsPage' },
    { label: 'Promote Settings', pageId: 'promoteSettingsPage' },
    { label: 'Engage Settings', pageId: 'engageSettingsPage' },
    { label: 'Observe Settings', pageId: 'observeSettingsPage' },
    { label: 'Training Settings', pageId: 'trainingSettingsPage' },
  ];

  function normalizeAcquireSettingLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function readAcquireSettings() {
    try {
      const raw = window.localStorage.getItem(ACQUIRE_SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const reasons = Array.isArray(parsed?.youtubeBanReasons) ? parsed.youtubeBanReasons : [];
      const merged = Array.from(new Set(DEFAULT_ACQUIRE_YOUTUBE_BAN_REASONS.concat(
        reasons.map((item) => normalizeAcquireSettingLabel(item)).filter(Boolean)
      )));
      return {
        youtubeBanReasons: merged,
        websiteDefaults: Object.assign({}, DEFAULT_ACQUIRE_WEBSITE_DEFAULTS, parsed?.websiteDefaults || {}),
      };
    } catch (_) {
      return {
        youtubeBanReasons: DEFAULT_ACQUIRE_YOUTUBE_BAN_REASONS.slice(),
        websiteDefaults: Object.assign({}, DEFAULT_ACQUIRE_WEBSITE_DEFAULTS),
      };
    }
  }

  function writeAcquireSettings(nextSettings) {
    const current = readAcquireSettings();
    const settings = Object.assign({}, current, nextSettings || {});
    settings.youtubeBanReasons = Array.from(new Set(
      (Array.isArray(settings.youtubeBanReasons) ? settings.youtubeBanReasons : [])
        .map((item) => normalizeAcquireSettingLabel(item))
        .filter(Boolean)
    ));
    settings.websiteDefaults = Object.assign({}, DEFAULT_ACQUIRE_WEBSITE_DEFAULTS, settings.websiteDefaults || {});
    try {
      window.localStorage.setItem(ACQUIRE_SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) {
      // ignore local storage failures
    }
    return settings;
  }

  function getAcquireYoutubeBanReasons() {
    return readAcquireSettings().youtubeBanReasons.slice();
  }

  function getAcquireWebsiteDefaults() {
    return Object.assign({}, DEFAULT_ACQUIRE_WEBSITE_DEFAULTS, readAcquireSettings().websiteDefaults || {});
  }

  App.getAcquireYoutubeBanReasons = getAcquireYoutubeBanReasons;
  App.getAcquireWebsiteDefaults = getAcquireWebsiteDefaults;

  function normalizeDirectAcquireKeyword(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&[a-z0-9#]+;/gi, ' ')
      .replace(/[^a-z0-9\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitDirectAcquireKeywordExclusions(value) {
    return String(value || '')
      .split(/\r?\n|,|;/g)
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  function readDirectAcquireKeywordReasons() {
    try {
      const raw = window.localStorage.getItem(DIRECT_ACQUIRE_KEYWORD_REASONS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeDirectAcquireKeywordReasons(map) {
    try {
      window.localStorage.setItem(DIRECT_ACQUIRE_KEYWORD_REASONS_KEY, JSON.stringify(map || {}));
    } catch (_) {
      // ignore local storage failures
    }
  }

  function readDirectAcquireKeywordTopics() {
    try {
      const raw = window.localStorage.getItem(DIRECT_ACQUIRE_KEYWORD_TOPICS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeDirectAcquireKeywordTopics(map) {
    try {
      window.localStorage.setItem(DIRECT_ACQUIRE_KEYWORD_TOPICS_KEY, JSON.stringify(map || {}));
    } catch (_) {
      // ignore local storage failures
    }
  }

  async function refreshDirectAcquireTopics() {
    try {
      if (App.ui && App.ui.ensureMessagingTopicsLoaded) {
        const topics = await App.ui.ensureMessagingTopicsLoaded();
        directAcquireTopics = topics.slice();
      } else {
        const res = await api('/api/messaging/topics');
        const topics = Array.isArray(res?.topics) ? res.topics : Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        directAcquireTopics = topics
          .map((item) => String(item?.topic || item?.category || '').trim())
          .filter(Boolean)
          .filter((value, index, list) => list.indexOf(value) === index)
          .sort((a, b) => a.localeCompare(b));
      }
    } catch (_) {
      directAcquireTopics = [];
    }
  }

  async function saveSelectedKeywordsAsContent(keywordLabels, topics) {
    const labels = Array.from(keywordLabels || []).map((value) => String(value || '').trim()).filter(Boolean);
    const topicList = Array.from(topics || []).map((value) => String(value || '').trim()).filter(Boolean);
    if (!labels.length || !topicList.length) return 0;
    const existingRes = await api('/api/messaging/keywords?limit=5000');
    const existing = Array.isArray(existingRes?.keywords)
      ? existingRes.keywords
      : Array.isArray(existingRes?.data)
        ? existingRes.data
        : Array.isArray(existingRes)
          ? existingRes
          : [];
    const existingPairs = new Set(
      existing.map((item) => `${normalizeDirectAcquireKeyword(item?.keyword)}::${String(item?.topic || item?.category || '').trim().toLowerCase()}`)
    );
    let created = 0;
    for (const keyword of labels) {
      for (const topic of topicList) {
        const pairKey = `${normalizeDirectAcquireKeyword(keyword)}::${String(topic || '').trim().toLowerCase()}`;
        if (existingPairs.has(pairKey)) continue;
        await api('/api/messaging/keywords', {
          method: 'POST',
          body: JSON.stringify({ keyword, topic }),
        });
        existingPairs.add(pairKey);
        created += 1;
      }
    }
    return created;
  }

  function renderDirectAcquireKeywordTopicOptions() {
    const menu = document.getElementById('directAcquireKeywordTopicsMenu');
    const summary = document.getElementById('directAcquireKeywordTopicsSummary');
    if (!menu || !summary) return;
    const selectedValues = new Set(
      Array.from(menu.querySelectorAll('input[type="checkbox"][data-topic]:checked'))
        .map((input) => String(input.value || '').trim())
        .filter(Boolean)
    );
    menu.innerHTML = '';
    directAcquireTopics.forEach((topic) => {
      const label = document.createElement('label');
      label.className = 'direct-acquire-dropdown-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = topic;
      checkbox.dataset.topic = topic;
      checkbox.checked = selectedValues.has(topic);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(topic));
      menu.appendChild(label);
    });
    const count = selectedValues.size;
    summary.textContent = count ? `${count} Topic${count === 1 ? '' : 's'} Selected` : 'Topics';
  }

  function syncDirectAcquireKeywordExclusionsFromTable() {
    const textarea = document.getElementById('directAcquireKeywordExclusionsInput');
    const tableBody = document.getElementById('directAcquireKeywordTable');
    if (!textarea || !tableBody) return;
    const currentRunKeywords = new Map(
      (Array.isArray(state.directAcquireCurrentRun?.keyword_labels) ? state.directAcquireCurrentRun.keyword_labels : [])
        .map(([keyword]) => [normalizeDirectAcquireKeyword(keyword), String(keyword || '').trim()])
        .filter(([normalized, label]) => normalized && label)
    );
    const existingEntries = splitDirectAcquireKeywordExclusions(textarea.value);
    const manualOnly = existingEntries.filter((entry) => !currentRunKeywords.has(normalizeDirectAcquireKeyword(entry)));
    const nextReasons = readDirectAcquireKeywordReasons();
    const selectedEntries = [];
    tableBody.querySelectorAll('tr').forEach((row) => {
      const select = row.querySelector('select[data-keyword-reason]');
      if (!select) return;
      const label = String(select.dataset.keyword || '').trim();
      const normalized = normalizeDirectAcquireKeyword(label);
      if (!normalized || !label) return;
      const reason = String(select.value || '').trim();
      if (reason) {
        nextReasons[normalized] = reason;
        selectedEntries.push(label);
      } else {
        delete nextReasons[normalized];
      }
    });
    const merged = Array.from(new Set([...manualOnly, ...selectedEntries]));
    textarea.value = merged.join('\n');
    try {
      window.localStorage.setItem(DIRECT_ACQUIRE_KEYWORD_EXCLUSIONS_KEY, textarea.value);
    } catch (_) {
      // ignore local storage failures
    }
    writeDirectAcquireKeywordReasons(nextReasons);
  }

  function setDirectAcquireResultsVisible(visible) {
    const wrap = document.getElementById('directAcquireResultsWrap');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !visible);
  }

  function setDirectAcquireProjectWebsitePanelVisible(visible) {
    const panel = document.getElementById('directAcquireProjectWebsitePanel');
    if (panel) panel.classList.toggle('hidden', !visible);
  }

  function hasDirectAcquireResultsContent() {
    const run = state.directAcquireCurrentRun;
    if (run) return true;
    return listProjectWebsitePeers(directAcquireWebsitePeers).length > 0
      || listReferenceWebsitePeers(directAcquireWebsitePeers).length > 0;
  }

  function syncDirectAcquireResultsVisibility() {
    setDirectAcquireResultsVisible(hasDirectAcquireResultsContent());
  }

  function normalizeAcquireSourceUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      let path = parsed.pathname.replace(/\/+$/, '');
      if (path === '/') path = '';
      return `${parsed.protocol}//${host}${path}`.toLowerCase();
    } catch {
      return raw.toLowerCase().replace(/\/+$/, '');
    }
  }

  function getWebsitePeerReferenceRole(peer) {
    const fromPeer = String(peer?.reference_role || '').trim().toLowerCase();
    if (fromPeer === 'peer' || fromPeer === 'model' || fromPeer === 'project') return fromPeer;
    const fromMeta = String(peer?.metadata?.reference_role || '').trim().toLowerCase();
    if (fromMeta === 'peer' || fromMeta === 'model' || fromMeta === 'project') return fromMeta;
    if (String(peer?.site_type || '').trim() === 'source') return 'project';
    return 'peer';
  }

  function listReferenceWebsitePeers(peers) {
    return (Array.isArray(peers) ? peers : []).filter((peer) => {
      const role = getWebsitePeerReferenceRole(peer);
      return role === 'peer' || role === 'model';
    });
  }

  function listProjectWebsitePeers(peers) {
    return (Array.isArray(peers) ? peers : []).filter((peer) => getWebsitePeerReferenceRole(peer) === 'project');
  }

  function findWebsitePeerForUrl(peers, url) {
    const normalized = normalizeAcquireSourceUrl(url);
    if (!normalized) return null;
    const matches = (Array.isArray(peers) ? peers : []).filter((peer) => (
      normalizeAcquireSourceUrl(peer?.site_url || '') === normalized
    ));
    return matches.find((peer) => getWebsitePeerReferenceRole(peer) === 'project') || matches[0] || null;
  }

  function getAcquireTitleForUrl(run, url) {
    const normalized = normalizeAcquireSourceUrl(url);
    const pages = Array.isArray(run?.pages) ? run.pages : [];
    const match = pages.find((page) => normalizeAcquireSourceUrl(page?.url) === normalized) || pages[0] || null;
    return String(match?.title || '').trim();
  }

  function scrollAcquireWebPanelIntoView(panelId) {
    const panel = document.getElementById(panelId);
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function getAcquireWebWebsiteRole() {
    const select = document.getElementById('directAcquireWebsiteRoleSelect');
    const role = String(select?.value || 'project').trim().toLowerCase();
    return role === 'peer' || role === 'model' ? role : 'project';
  }

  async function fetchProjectWebsiteUrl() {
    const projectFields = ['projectUrl', 'project_url', 'website', 'siteUrl', 'site_url', 'url'];
    const projects = Array.isArray(state.projects) ? state.projects : [];
    const active = projects.find((project) => String(project?.id || '') === String(state.currentProjectId || '')) || null;
    const fromState = projectFields.map((key) => String(active?.[key] || '').trim()).find(Boolean) || '';
    if (fromState) return fromState;
    try {
      const current = await api('/api/projects/current', { method: 'GET' });
      const project = current?.project || current?.data?.project || null;
      return projectFields.map((key) => String(project?.[key] || '').trim()).find(Boolean) || '';
    } catch (_) {
      return '';
    }
  }

  function populateAcquireWebReferenceModelSelect() {
    const select = document.getElementById('directAcquireReferenceModelSelect');
    if (!select) return;
    const current = String(select.value || '').trim();
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Model Category';
    select.appendChild(placeholder);
    WEBSITE_PEER_MODELS.forEach((label) => {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      select.appendChild(option);
    });
    if (current && WEBSITE_PEER_MODELS.includes(current)) select.value = current;
    else if (WEBSITE_PEER_MODELS.includes('Industry Hubs and Publications')) select.value = 'Industry Hubs and Publications';
    else if (WEBSITE_PEER_MODELS.length) select.value = WEBSITE_PEER_MODELS[0];
  }

  function applyAcquireWebWebsiteRoleUi() {
    const role = getAcquireWebWebsiteRole();
    const isProject = role === 'project';
    const isPeer = role === 'peer';
    const isModel = role === 'model';
    const submitBtn = document.getElementById('directAcquireSubmitBtn');
    const discoverBtn = document.getElementById('directAcquireDiscoverPeersBtn');
    const addRefBtn = document.getElementById('directAcquireAddReferenceBtn');
    const modelSelect = document.getElementById('directAcquireReferenceModelSelect');
    const urlInput = document.getElementById('directAcquireUrlInput');
    if (submitBtn) submitBtn.classList.toggle('hidden', !isProject);
    if (discoverBtn) discoverBtn.classList.toggle('hidden', !isPeer);
    if (addRefBtn) addRefBtn.classList.toggle('hidden', !isModel);
    if (modelSelect) modelSelect.classList.toggle('hidden', !isModel);
    if (urlInput) {
      if (isProject || isPeer) {
        urlInput.value = String(directAcquireProjectSourceUrl || urlInput.value || '').trim();
        urlInput.placeholder = isPeer ? 'Project website used for peer discovery' : 'https://example.com';
      } else {
        urlInput.placeholder = 'https://model-site.example';
      }
    }
  }

  function setDirectAcquirePeerDiscoveryPanelVisible(visible) {
    const panel = document.getElementById('directAcquirePeerDiscoveryPanel');
    if (panel) panel.classList.toggle('hidden', !visible);
  }

  function renderDirectAcquirePeerDiscoveryResults() {
    const tableBody = document.getElementById('directAcquirePeerDiscoveryTable');
    const metaEl = document.getElementById('directAcquirePeerDiscoveryMeta');
    const keywordsEl = document.getElementById('directAcquirePeerDiscoveryKeywords');
    const saveBtn = document.getElementById('directAcquirePeerDiscoverySaveBtn');
    const selectAll = document.getElementById('directAcquirePeerDiscoverySelectAll');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const results = Array.isArray(directAcquirePeerDiscoveryResults) ? directAcquirePeerDiscoveryResults : [];
    setDirectAcquirePeerDiscoveryPanelVisible(results.length > 0);
    if (!results.length) {
      if (metaEl) metaEl.textContent = String(state.directAcquirePeerDiscoveryError || '').trim() || 'No peer discovery run yet.';
      if (keywordsEl) keywordsEl.textContent = String(state.directAcquirePeerDiscoveryKeywords || '').trim();
      if (saveBtn) saveBtn.disabled = true;
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      return;
    }
    results.forEach((item, index) => {
      const tr = document.createElement('tr');

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.selected !== false;
      checkbox.addEventListener('change', () => {
        directAcquirePeerDiscoveryResults[index].selected = checkbox.checked;
        renderDirectAcquirePeerDiscoveryResults();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      const scoreTd = document.createElement('td');
      scoreTd.textContent = Number(item.similarity_score || 0).toFixed(1);
      tr.appendChild(scoreTd);

      const typeTd = document.createElement('td');
      typeTd.textContent = String(item.suggested_reference_role || 'peer').toLowerCase() === 'model' ? 'Model' : 'Peer';
      tr.appendChild(typeTd);

      const domainTd = document.createElement('td');
      domainTd.className = 'direct-acquire-contact-label';
      domainTd.textContent = String(item.domain || '').trim() || '-';
      tr.appendChild(domainTd);

      const siteTd = document.createElement('td');
      const url = String(item.url || '').trim();
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(item.title || '').trim() || url;
        siteTd.appendChild(link);
      } else {
        siteTd.textContent = String(item.title || '').trim() || '-';
      }
      tr.appendChild(siteTd);

      const keywordsTd = document.createElement('td');
      keywordsTd.textContent = Array.isArray(item.matched_keywords) && item.matched_keywords.length
        ? item.matched_keywords.join(', ')
        : '-';
      tr.appendChild(keywordsTd);

      const reasonsTd = document.createElement('td');
      reasonsTd.textContent = Array.isArray(item.reasons) && item.reasons.length
        ? item.reasons.join('; ')
        : '-';
      tr.appendChild(reasonsTd);

      tableBody.appendChild(tr);
    });
    const selectedCount = results.filter((item) => item.selected !== false).length;
    if (metaEl) {
      metaEl.textContent = `${results.length} candidate${results.length === 1 ? '' : 's'} ranked by similarity.`;
    }
    if (saveBtn) saveBtn.disabled = selectedCount === 0;
    if (selectAll) {
      selectAll.checked = selectedCount === results.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < results.length;
    }
  }

  function startPeerDiscoveryProgress() {
    const wrap = document.getElementById('directAcquireProgressWrap');
    const bar = document.getElementById('directAcquireProgressBar');
    const text = document.getElementById('directAcquireProgressText');
    const discoverBtn = document.getElementById('directAcquireDiscoverPeersBtn');
    if (wrap) wrap.classList.remove('hidden');
    if (bar) bar.value = 8;
    if (text) text.textContent = 'Discovering peers...';
    if (discoverBtn) discoverBtn.disabled = true;
    if (directAcquireProgressTimer) clearInterval(directAcquireProgressTimer);
    directAcquireProgressTimer = setInterval(() => {
      if (!bar) return;
      const current = Number(bar.value || 0) || 0;
      bar.value = Math.min(92, current + (current < 35 ? 5 : current < 65 ? 3 : 1.5));
    }, 650);
  }

  function finishPeerDiscoveryProgress(ok, message) {
    const wrap = document.getElementById('directAcquireProgressWrap');
    const bar = document.getElementById('directAcquireProgressBar');
    const text = document.getElementById('directAcquireProgressText');
    const discoverBtn = document.getElementById('directAcquireDiscoverPeersBtn');
    if (directAcquireProgressTimer) {
      clearInterval(directAcquireProgressTimer);
      directAcquireProgressTimer = null;
    }
    if (bar) bar.value = ok ? 100 : Math.max(8, Number(bar.value || 0) || 0);
    if (text) text.textContent = String(message || (ok ? 'Peer discovery complete.' : 'Peer discovery failed.')).trim();
    if (discoverBtn) discoverBtn.disabled = false;
    if (wrap) {
      setTimeout(() => wrap.classList.add('hidden'), ok ? 900 : 1800);
    }
  }

  async function discoverAcquireWebPeers() {
    const projectUrl = String(directAcquireProjectSourceUrl || await fetchProjectWebsiteUrl()).trim();
    if (!projectUrl) throw new Error('Project website is required before discovering peers.');
    const exclusionsInput = document.getElementById('directAcquireKeywordExclusionsInput');
    const maxPagesSelect = document.getElementById('directAcquireMaxPagesSelect');
    startPeerDiscoveryProgress();
    let searchedKeywords = [];
    try {
      const result = await api('/api/acquire/peer-discovery', {
        method: 'POST',
        body: JSON.stringify({
          source_url: projectUrl,
          max_pages: Number(maxPagesSelect?.value || 10) || 10,
          body_snippet_chars: Number(document.getElementById('directAcquireSnippetInput')?.value || 600) || 600,
          keyword_exclusions: String(exclusionsInput?.value || '').trim(),
          keyword_count: 5,
          results_per_keyword: 30,
          output_count: 5,
          light_fetch_count: 20,
        }),
      });
      const payload = result?.data || result || {};
      const discovery = payload.discovery || payload;
      const peers = Array.isArray(discovery?.results) ? discovery.results : [];
      const discoveryError = String(discovery?.error || '').trim();
      const searchErrors = Array.isArray(discovery?.errors) ? discovery.errors.filter(Boolean) : [];
      if (discoveryError && !peers.length) {
        const detail = searchErrors.length && !discoveryError.includes('Custom Search API')
          ? `${discoveryError} ${searchErrors[0]}`
          : discoveryError;
        throw new Error(detail);
      }
      searchedKeywords = Array.isArray(discovery?.searched_keywords) ? discovery.searched_keywords : [];
      state.directAcquirePeerDiscoveryError = '';
      let sourceDomain = '';
      try {
        sourceDomain = new URL(String(discovery?.source_url || projectUrl).trim()).hostname.replace(/^www\./, '').toLowerCase();
      } catch (_) {
        sourceDomain = '';
      }
      const existingKeys = new Set(
        (Array.isArray(directAcquireWebsitePeers) ? directAcquireWebsitePeers : []).map((peer) => {
          const peerSourceDomain = String(peer?.source_domain || '').trim().toLowerCase();
          const domain = String(peer?.domain || '').trim().toLowerCase();
          return `${peerSourceDomain}::${domain}`;
        })
      );
      directAcquirePeerDiscoveryResults = peers.map((peer) => {
        const domain = String(peer?.domain || '').trim().toLowerCase();
        return {
          source_url: String(discovery?.source_url || projectUrl).trim(),
          url: String(peer?.url || '').trim(),
          domain,
          title: String(peer?.title || '').trim(),
          matched_keywords: Array.isArray(peer?.matched_keywords) ? peer.matched_keywords.slice() : [],
          snippet: String(peer?.snippet || '').trim(),
          website_model: String(peer?.website_model || peer?.model || '').trim() || 'Direct Competitors',
          suggested_reference_role: String(peer?.suggested_reference_role || 'peer').trim().toLowerCase() === 'model' ? 'model' : 'peer',
          similarity_score: Number(peer?.similarity_score || 0) || 0,
          reasons: Array.isArray(peer?.reasons) ? peer.reasons.slice() : [],
          selected: !existingKeys.has(`${sourceDomain}::${domain}`),
        };
      }).filter((peer) => peer.url && peer.domain);
      state.directAcquirePeerDiscoveryKeywords = searchedKeywords.length
        ? `Search phrases: ${searchedKeywords.join(', ')}`
        : '';
      renderDirectAcquirePeerDiscoveryResults();
      setDirectAcquireResultsVisible(true);
      const count = directAcquirePeerDiscoveryResults.length;
      finishPeerDiscoveryProgress(true, count ? `Discovered ${count} peer candidate${count === 1 ? '' : 's'}.` : 'No peer candidates returned.');
      notify(count ? `Discovered ${count} peer candidate${count === 1 ? '' : 's'}` : 'No peer candidates returned', !count);
      if (count) scrollAcquireWebPanelIntoView('directAcquirePeerDiscoveryPanel');
    } catch (err) {
      directAcquirePeerDiscoveryResults = [];
      state.directAcquirePeerDiscoveryError = String(err.message || 'Peer discovery failed.').trim();
      state.directAcquirePeerDiscoveryKeywords = searchedKeywords.length
        ? `Search phrases: ${searchedKeywords.join(', ')} (keyword discovery succeeded; search step failed.)`
        : '';
      setDirectAcquirePeerDiscoveryPanelVisible(true);
      renderDirectAcquirePeerDiscoveryResults();
      finishPeerDiscoveryProgress(false, state.directAcquirePeerDiscoveryError);
      notify(state.directAcquirePeerDiscoveryError, true);
    }
  }

  async function saveSelectedAcquireWebPeers() {
    const selected = directAcquirePeerDiscoveryResults.filter((item) => item.selected !== false);
    if (!selected.length) {
      notify('Select at least one discovered peer', true);
      return;
    }
    const existingKeys = new Set(
      (Array.isArray(directAcquireWebsitePeers) ? directAcquireWebsitePeers : []).map((peer) => {
        const sourceDomain = String(peer?.source_domain || '').trim().toLowerCase();
        const domain = String(peer?.domain || '').trim().toLowerCase();
        return `${sourceDomain}::${domain}`;
      })
    );
    let created = 0;
    let skipped = 0;
    for (const peer of selected) {
      let sourceDomain = '';
      try {
        sourceDomain = new URL(String(peer.source_url || '').trim()).hostname.replace(/^www\./, '').toLowerCase();
      } catch (_) {
        sourceDomain = '';
      }
      const key = `${sourceDomain}::${String(peer.domain || '').trim().toLowerCase()}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      const referenceRole = peer.suggested_reference_role === 'model' ? 'model' : 'peer';
      await api('/api/acquire/website-peers', {
        method: 'POST',
        body: JSON.stringify({
          source_url: peer.source_url,
          site_url: peer.url,
          title: peer.title,
          matched_keywords: peer.matched_keywords,
          snippet: peer.snippet,
          website_model: peer.website_model,
          reference_role: referenceRole,
          metadata: {
            reference_role: referenceRole,
            discovery_version: 'peer-discovery-v1',
            similarity_score: peer.similarity_score,
          },
        }),
      });
      existingKeys.add(key);
      created += 1;
    }
    await refreshDirectAcquireWebsitePeers();
    directAcquirePeerDiscoveryResults = directAcquirePeerDiscoveryResults.map((item) => ({
      ...item,
      selected: false,
    }));
    renderDirectAcquirePeerDiscoveryResults();
    const parts = [];
    if (created) parts.push(`${created} saved`);
    if (skipped) parts.push(`${skipped} skipped`);
    notify(parts.length ? parts.join(', ') : 'No new peers saved', !created);
  }

  async function addAcquireWebReferenceFromForm() {
    const role = getAcquireWebWebsiteRole();
    if (role !== 'peer' && role !== 'model') throw new Error('Select Peer Website or Model Website to add a reference.');
    const siteUrl = String(document.getElementById('directAcquireUrlInput')?.value || '').trim();
    if (!siteUrl) throw new Error('Website URL is required.');
    const projectUrl = String(directAcquireProjectSourceUrl || await fetchProjectWebsiteUrl()).trim();
    if (!projectUrl) throw new Error('Project website is required before adding references.');
    const modelSelect = document.getElementById('directAcquireReferenceModelSelect');
    const websiteModel = role === 'model'
      ? String(modelSelect?.value || '').trim() || (WEBSITE_PEER_MODELS[0] || '')
      : String(WEBSITE_PEER_MODELS.includes('Direct Competitors') ? 'Direct Competitors' : (WEBSITE_PEER_MODELS[0] || '')).trim();
    if (role === 'model' && !websiteModel) throw new Error('Select a model category.');
    await api('/api/acquire/website-peers', {
      method: 'POST',
      body: JSON.stringify({
        site_type: 'peer',
        source_url: projectUrl,
        site_url: siteUrl,
        reference_role: role,
        website_model: websiteModel,
        metadata: { reference_role: role },
      }),
    });
    await refreshDirectAcquireWebsitePeers();
    const urlInput = document.getElementById('directAcquireUrlInput');
    if (urlInput) urlInput.value = '';
    notify(`${ACQUIRE_WEBSITE_ROLE_LABELS[role] || 'Reference'} added`);
  }

  async function resolveAcquireWebSourceUrl() {
    if (getAcquireWebWebsiteRole() !== 'project') {
      return String(directAcquireProjectSourceUrl || await fetchProjectWebsiteUrl()).trim();
    }
    const input = document.getElementById('directAcquireUrlInput');
    const fromInput = String(input?.value || '').trim();
    if (fromInput) return fromInput;
    const projectUrl = await fetchProjectWebsiteUrl();
    if (projectUrl && input) input.value = projectUrl;
    return projectUrl;
  }

  async function loadLatestDirectAcquireRunForSourceUrl(sourceUrlInput, options = {}) {
    const sourceUrl = String(sourceUrlInput || '').trim();
    const normalized = normalizeAcquireSourceUrl(sourceUrl);
    if (!normalized) {
      state.directAcquireCurrentRun = null;
      if (!options.keepResultsVisible) syncDirectAcquireResultsVisibility();
      else renderDirectAcquirePagesTable();
      return false;
    }
    const res = await api('/api/acquire/direct-runs?limit=50');
    const runs = Array.isArray(res.runs) ? res.runs : [];
    const match = runs.find((run) => normalizeAcquireSourceUrl(run?.source_url) === normalized);
    if (!match?.run_id) {
      state.directAcquireCurrentRun = null;
      if (!options.keepResultsVisible) syncDirectAcquireResultsVisibility();
      else renderDirectAcquirePagesTable();
      return false;
    }
    await loadDirectAcquireRun(match.run_id);
    return true;
  }

  async function openDirectAcquireProjectWebsiteEditor(peer) {
    const url = String(peer?.site_url || peer?.source_url || '').trim();
    if (!url) return;
    setDirectAcquireProjectWebsitePanelVisible(true);
    directAcquireProjectSourceUrl = url;
    const urlInput = document.getElementById('directAcquireUrlInput');
    if (urlInput) urlInput.value = url;
    const urlMeta = document.getElementById('directAcquireProjectWebsiteUrl');
    if (urlMeta) urlMeta.textContent = url;
    fillDirectAcquireWebsiteDetailsForm(peer, url);
    setDirectAcquireResultsVisible(true);
    try {
      await loadLatestDirectAcquireRunForSourceUrl(url, { keepResultsVisible: true });
    } catch (_) {
      state.directAcquireCurrentRun = null;
      renderDirectAcquirePagesTable();
    }
    scrollAcquireWebPanelIntoView('directAcquireProjectWebsitePanel');
  }

  async function hydrateAcquireWebPage(options = {}) {
    applyAcquireWebsiteDefaultsToForm();
    populateAcquireWebReferenceModelSelect();
    const roleSelect = document.getElementById('directAcquireWebsiteRoleSelect');
    directAcquireProjectSourceUrl = await fetchProjectWebsiteUrl();
    if (roleSelect) roleSelect.value = 'project';
    applyAcquireWebWebsiteRoleUi();
    const advancedPanel = document.getElementById('directAcquireAdvancedPanel');
    const urlInput = document.getElementById('directAcquireUrlInput');
    if (urlInput && directAcquireProjectSourceUrl) urlInput.value = directAcquireProjectSourceUrl;
    try {
      await refreshDirectAcquireWebsitePeers();
    } catch (_) {}
    const sourceUrl = String(directAcquireProjectSourceUrl || '').trim();
    if (!sourceUrl) {
      setDirectAcquireProjectWebsitePanelVisible(false);
      if (!options.keepResults) syncDirectAcquireResultsVisibility();
      return false;
    }
    const loaded = await loadLatestDirectAcquireRunForSourceUrl(sourceUrl);
    setDirectAcquireProjectWebsitePanelVisible(false);
    if (loaded) {
      if (advancedPanel) advancedPanel.open = false;
      if (options.scrollToResults !== false) {
        const results = document.getElementById('directAcquireResultsWrap');
        if (results && typeof results.scrollIntoView === 'function') {
          window.setTimeout(() => results.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
        }
      }
      return true;
    }
    if (!options.keepResults) syncDirectAcquireResultsVisibility();
    return false;
  }

  function startDirectAcquireProgress() {
    const wrap = document.getElementById('directAcquireProgressWrap');
    const bar = document.getElementById('directAcquireProgressBar');
    const text = document.getElementById('directAcquireProgressText');
    const submitBtn = document.getElementById('directAcquireSubmitBtn');
    if (wrap) wrap.classList.remove('hidden');
    if (bar) bar.value = 8;
    if (text) text.textContent = 'Acquiring website...';
    if (submitBtn) submitBtn.disabled = true;
    if (directAcquireProgressTimer) clearInterval(directAcquireProgressTimer);
    directAcquireProgressTimer = setInterval(() => {
      if (!bar) return;
      const current = Number(bar.value || 0) || 0;
      bar.value = Math.min(92, current + (current < 35 ? 5 : current < 65 ? 3 : 1.5));
    }, 650);
  }

  function finishDirectAcquireProgress(ok, message) {
    const wrap = document.getElementById('directAcquireProgressWrap');
    const bar = document.getElementById('directAcquireProgressBar');
    const text = document.getElementById('directAcquireProgressText');
    const submitBtn = document.getElementById('directAcquireSubmitBtn');
    if (directAcquireProgressTimer) {
      clearInterval(directAcquireProgressTimer);
      directAcquireProgressTimer = null;
    }
    if (bar) bar.value = ok ? 100 : Math.max(8, Number(bar.value || 0) || 0);
    if (text) text.textContent = String(message || (ok ? 'Acquire complete.' : 'Acquire failed.')).trim();
    if (submitBtn) submitBtn.disabled = false;
    if (wrap) {
      setTimeout(() => wrap.classList.add('hidden'), ok ? 900 : 1800);
    }
  }

  function renderSectionSettingsNav(activePageId) {
    const wrap = document.getElementById('sectionSettingsNavList');
    if (!wrap) return;
    wrap.innerHTML = '';
    SECTION_SETTINGS_LINKS.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.className = 'section-settings-nav-btn' + (item.pageId === activePageId ? ' is-active' : '');
      button.disabled = item.pageId === activePageId;
      button.addEventListener('click', function () {
        const target = String(item.pageId || '').trim();
        const page = document.getElementById(target);
        if (page && page.classList.contains('app-page')) {
          App.setActivePage(target);
        } else {
          notify(item.label + ' is not set up yet.');
        }
      });
      wrap.appendChild(button);
    });
  }

  function renderAcquireYoutubeBanReasons() {
    const tbody = document.getElementById('acquireYoutubeBanReasonsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const reasons = getAcquireYoutubeBanReasons();
    if (!reasons.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No ban reasons configured.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    reasons.forEach((reason) => {
      const tr = document.createElement('tr');
      const reasonTd = document.createElement('td');
      reasonTd.textContent = reason;
      const actionsTd = document.createElement('td');
      actionsTd.className = 'action-icons-cell';
      const deleteBtn = App.makeIconButton('delete', 'Delete Ban Reason', function () {
        const next = getAcquireYoutubeBanReasons().filter((item) => item !== reason);
        writeAcquireSettings({ youtubeBanReasons: next });
        renderAcquireYoutubeBanReasons();
        notify('Ban reason deleted');
      }, { danger: true });
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(reasonTd);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function renderAcquireWebsiteDefaults() {
    const defaults = getAcquireWebsiteDefaults();
    const checkboxMap = {
      acquireSettingsAcquireSocial: defaults.acquireSocial,
      acquireSettingsAcquireKeywords: defaults.acquireKeywords,
      acquireSettingsAcquireHashtags: defaults.acquireHashtags,
      acquireSettingsAcquireImages: defaults.acquireImages,
      acquireSettingsAcquirePages: defaults.acquirePages,
      acquireSettingsAcquirePeerSites: defaults.acquirePeerSites,
    };
    Object.keys(checkboxMap).forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.checked = checkboxMap[id] === true;
    });
    const valueMap = {
      acquireSettingsMaxPages: String(defaults.maxPages || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.maxPages),
      acquireSettingsPeerSitesLimit: String(defaults.peerSitesLimit || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.peerSitesLimit),
      acquireSettingsImagesLimit: String(defaults.imagesLimit || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.imagesLimit),
      acquireSettingsSnippetLength: String(defaults.snippetLength || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.snippetLength),
    };
    Object.keys(valueMap).forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = valueMap[id];
    });
  }

  function applyAcquireWebsiteDefaultsToForm() {
    const form = els.directAcquireForm;
    if (!form) return;
    const defaults = getAcquireWebsiteDefaults();
    const checkboxFields = {
      acquire_social: defaults.acquireSocial,
      acquire_keywords: defaults.acquireKeywords,
      acquire_hashtags: defaults.acquireHashtags,
      acquire_images: defaults.acquireImages,
      acquire_pages: defaults.acquirePages,
      acquire_peer_sites: defaults.acquirePeerSites,
    };
    Object.keys(checkboxFields).forEach((name) => {
      const input = form.querySelector('[name="' + name + '"]');
      if (input) input.checked = checkboxFields[name] === true;
    });
    const valueFields = {
      max_pages: String(defaults.maxPages || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.maxPages),
      peer_sites_limit: String(defaults.peerSitesLimit || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.peerSitesLimit),
      images_limit: String(defaults.imagesLimit || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.imagesLimit),
      body_snippet_chars: String(defaults.snippetLength || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.snippetLength),
    };
    Object.keys(valueFields).forEach((name) => {
      const input = form.querySelector('[name="' + name + '"]');
      if (input) input.value = valueFields[name];
    });
  }

  function renderAcquireSettingsPage() {
    renderAcquireYoutubeBanReasons();
    renderAcquireWebsiteDefaults();
    renderSectionSettingsNav('acquireSettingsPage');
  }

  function sanitizeImageNameFromUrl(url, index) {
    try {
      const parsed = new URL(String(url || '').trim());
      const last = String(parsed.pathname || '').split('/').filter(Boolean).pop() || '';
      const cleaned = decodeURIComponent(last).replace(/\.[a-z0-9]{2,8}$/i, '').replace(/[-_]+/g, ' ').trim();
      if (cleaned) return cleaned;
      return `Web Image ${index + 1}`;
    } catch {
      return `Web Image ${index + 1}`;
    }
  }

  function pruneDirectAcquireImageState() {
    const urls = new Set(
      (Array.isArray(state.directAcquireCurrentRun?.image_summary?.images) ? state.directAcquireCurrentRun.image_summary.images : [])
        .map((item) => String(item?.url || '').trim())
        .filter(Boolean)
    );
    directAcquireSelectedImages = new Set(Array.from(directAcquireSelectedImages).filter((url) => urls.has(url)));
    const nextMap = new Map();
    directAcquireImageCategoryByUrl.forEach((value, key) => {
      if (urls.has(key)) nextMap.set(key, value);
    });
    directAcquireImageCategoryByUrl = nextMap;
  }

  async function refreshDirectAcquireImageCategories() {
    try {
      const res = await api('/api/asset-categories');
      const categories = Array.isArray(res?.categories)
        ? res.categories
        : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res)
            ? res
            : [];
      directAcquireImageCategories = categories
        .filter((item) => String(item?.assetType || item?.asset_type || '').trim().toLowerCase() === 'image')
        .map((item) => String(item?.category || '').trim())
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index)
        .sort((a, b) => a.localeCompare(b));
    } catch (_) {
      directAcquireImageCategories = [];
    }
  }

  function fillDirectAcquireImageCategorySelect(select, selectedValue, placeholder = 'No Category') {
    if (!select) return;
    const selected = String(selectedValue || '').trim();
    select.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = placeholder;
    select.appendChild(emptyOption);
    directAcquireImageCategories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      if (category === selected) option.selected = true;
      select.appendChild(option);
    });
  }

  function renderDirectAcquireImageGallery() {
    const gallery = document.getElementById('directAcquireImageGallery');
    const emptyEl = document.getElementById('directAcquireImagesEmpty');
    const selectAll = document.getElementById('directAcquireImageSelectAll');
    const seeMoreBtn = document.getElementById('directAcquireImagesSeeMoreBtn');
    const saveBtn = document.getElementById('directAcquireSaveImagesBtn');
    const bulkCategory = document.getElementById('directAcquireImageBulkCategory');
    if (!gallery) return;
    gallery.innerHTML = '';
    if (bulkCategory) fillDirectAcquireImageCategorySelect(bulkCategory, bulkCategory.value, 'Select Image Category');
    const images = Array.isArray(state.directAcquireCurrentRun?.image_summary?.images) ? state.directAcquireCurrentRun.image_summary.images : [];
    pruneDirectAcquireImageState();
    if (!images.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (seeMoreBtn) seeMoreBtn.classList.add('hidden');
      if (saveBtn) saveBtn.disabled = true;
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    const visibleImages = directAcquireImagesExpanded ? images : images.slice(0, 24);
    visibleImages.forEach((item, index) => {
      const url = String(item?.url || '').trim();
      if (!url) return;
      const card = document.createElement('div');
      card.className = 'direct-acquire-image-card';

      const selectRow = document.createElement('div');
      selectRow.className = 'direct-acquire-image-card-top';
      const checkboxLabel = document.createElement('label');
      checkboxLabel.className = 'checkbox-row';
      checkboxLabel.style.margin = '0';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = directAcquireSelectedImages.has(url);
      checkbox.dataset.imageUrl = url;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) directAcquireSelectedImages.add(url);
        else directAcquireSelectedImages.delete(url);
        renderDirectAcquireImageGallery();
      });
      checkboxLabel.appendChild(checkbox);
      checkboxLabel.appendChild(document.createTextNode(' Select'));
      selectRow.appendChild(checkboxLabel);
      card.appendChild(selectRow);

      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'direct-acquire-image-link';
      const img = document.createElement('img');
      img.src = url;
      img.alt = sanitizeImageNameFromUrl(url, index);
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      link.appendChild(img);
      card.appendChild(link);

      const meta = document.createElement('div');
      meta.className = 'direct-acquire-image-meta';
      const name = document.createElement('div');
      name.className = 'direct-acquire-image-name';
      name.textContent = sanitizeImageNameFromUrl(url, index);
      meta.appendChild(name);
      const categorySelect = document.createElement('select');
      categorySelect.dataset.imageCategory = url;
      fillDirectAcquireImageCategorySelect(categorySelect, directAcquireImageCategoryByUrl.get(url) || '', 'No Category');
      categorySelect.addEventListener('change', () => {
        const value = String(categorySelect.value || '').trim();
        if (value) directAcquireImageCategoryByUrl.set(url, value);
        else directAcquireImageCategoryByUrl.delete(url);
      });
      meta.appendChild(categorySelect);
      card.appendChild(meta);

      gallery.appendChild(card);
    });

    if (seeMoreBtn) {
      if (images.length > 24) {
        seeMoreBtn.classList.remove('hidden');
        seeMoreBtn.textContent = directAcquireImagesExpanded ? 'Show Less' : `See More (${images.length - 24} more)`;
      } else {
        seeMoreBtn.classList.add('hidden');
      }
    }
    if (saveBtn) saveBtn.disabled = directAcquireSelectedImages.size === 0;
    if (selectAll) {
      const visibleUrls = visibleImages.map((item) => String(item?.url || '').trim()).filter(Boolean);
      const checkedCount = visibleUrls.filter((url) => directAcquireSelectedImages.has(url)).length;
      selectAll.checked = !!visibleUrls.length && checkedCount === visibleUrls.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < visibleUrls.length;
    }
  }

  async function saveDirectAcquireSelectedImages() {
    const images = Array.isArray(state.directAcquireCurrentRun?.image_summary?.images) ? state.directAcquireCurrentRun.image_summary.images : [];
    const selected = images.filter((item) => directAcquireSelectedImages.has(String(item?.url || '').trim()));
    if (!selected.length) throw new Error('No images selected.');
    const sourceUrl = String(state.directAcquireCurrentRun?.source_url || '').trim();
    let hostTag = '';
    try {
      hostTag = new URL(sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      hostTag = '';
    }
    await Promise.all(selected.map((item, index) => {
      const url = String(item?.url || '').trim();
      const category = String(directAcquireImageCategoryByUrl.get(url) || '').trim();
      return api('/api/assets', {
        method: 'POST',
        body: JSON.stringify({
          assetName: sanitizeImageNameFromUrl(url, index),
          assetType: 'Image',
          category,
          location: url,
          tags: ['acquire.web', 'web-image'].concat(hostTag ? [hostTag] : []),
        }),
      });
    }));
    notify(`Saved ${selected.length} image asset${selected.length === 1 ? '' : 's'}`);
  }

  function blueskyDiscoveryFeedbackKey(itemOrUrl) {
    const postUrl = typeof itemOrUrl === 'string'
      ? itemOrUrl
      : String(itemOrUrl && itemOrUrl.post_url || '').trim();
    return postUrl ? `${BLUESKY_DISCOVERY_FEEDBACK_KEY_PREFIX}${postUrl}` : '';
  }

  function readBlueskyDiscoveryFeedback(itemOrUrl) {
    const key = blueskyDiscoveryFeedbackKey(itemOrUrl);
    const empty = {
      quality: 0,
      categories: [],
      category_explain: '',
      attributes: [],
      attributes_explain: '',
      approaches: [],
      approaches_explain: '',
      note: '',
      suggested_response: '',
      updated_at: '',
    };
    if (!key) return empty;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) || {};
      return {
        quality: Number(parsed.quality || 0),
        categories: toList(parsed.categories).map((v) => String(v || '').trim()).filter(Boolean),
        category_explain: String(parsed.category_explain || '').trim(),
        attributes: toList(parsed.attributes).map((v) => String(v || '').trim()).filter(Boolean),
        attributes_explain: String(parsed.attributes_explain || '').trim(),
        approaches: toList(parsed.approaches).map((v) => String(v || '').trim()).filter(Boolean),
        approaches_explain: String(parsed.approaches_explain || '').trim(),
        note: String(parsed.note || ''),
        suggested_response: String(parsed.suggested_response || ''),
        updated_at: String(parsed.updated_at || ''),
      };
    } catch (_) {
      return empty;
    }
  }

  function saveBlueskyDiscoveryFeedback(itemOrUrl, patch) {
    const key = blueskyDiscoveryFeedbackKey(itemOrUrl);
    if (!key) return readBlueskyDiscoveryFeedback(itemOrUrl);
    const current = readBlueskyDiscoveryFeedback(itemOrUrl);
    const merged = { ...current, ...(patch || {}), updated_at: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(merged));
    return merged;
  }

  function blueskyDiscoveryHasReview(feedback) {
    return Boolean(
      Number(feedback && feedback.quality || 0) > 0
      || toList(feedback && feedback.categories).length
      || String(feedback && feedback.category_explain || '').trim()
      || toList(feedback && feedback.attributes).length
      || String(feedback && feedback.attributes_explain || '').trim()
      || toList(feedback && feedback.approaches).length
      || String(feedback && feedback.approaches_explain || '').trim()
      || String(feedback && feedback.note || '').trim()
      || String(feedback && feedback.suggested_response || '').trim()
    );
  }

  function makeQualityOptions(selectedValue) {
    const values = ['', '1', '2', '3', '4', '5'];
    return values.map((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value || 'Unrated';
      option.selected = String(selectedValue || '') === value;
      return option;
    });
  }

  function toList(value) {
    return Array.isArray(value) ? value : [];
  }

  function getTrainingConfigNames(tableId) {
    const tbody = document.getElementById(tableId);
    if (!tbody) return [];
    return Array.from(tbody.querySelectorAll('tr')).map((tr) => {
      const input = tr.querySelector('.yt-miner-config-name');
      if (input && String(input.value || '').trim()) return String(input.value || '').trim();
      const tds = tr.querySelectorAll('td');
      return String(tds[1] && tds[1].textContent || '').trim();
    }).filter(Boolean);
  }

  function blueskyReplyFeedbackKey(result, item) {
    const target = String(result && result.target || result?.post?.post_url || '').trim();
    const text = String(item && item.text || '').trim();
    return target && text ? `${BLUESKY_REPLY_FEEDBACK_KEY_PREFIX}${target}::${text}` : '';
  }

  function readBlueskyReplyFeedback(result, item) {
    const key = blueskyReplyFeedbackKey(result, item);
    const empty = {
      quality: 0,
      categories: [],
      category_explain: '',
      attributes: [],
      attributes_explain: '',
      approaches: [],
      approaches_explain: '',
      note: '',
      suggested_response: '',
      updated_at: '',
    };
    if (!key) return empty;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) || {};
      return {
        quality: Number(parsed.quality || 0),
        categories: toList(parsed.categories).map((v) => String(v || '').trim()).filter(Boolean),
        category_explain: String(parsed.category_explain || '').trim(),
        attributes: toList(parsed.attributes).map((v) => String(v || '').trim()).filter(Boolean),
        attributes_explain: String(parsed.attributes_explain || '').trim(),
        approaches: toList(parsed.approaches).map((v) => String(v || '').trim()).filter(Boolean),
        approaches_explain: String(parsed.approaches_explain || '').trim(),
        note: String(parsed.note || ''),
        suggested_response: String(parsed.suggested_response || ''),
        updated_at: String(parsed.updated_at || ''),
      };
    } catch (_) {
      return empty;
    }
  }

  function saveBlueskyReplyFeedback(result, item, patch) {
    const key = blueskyReplyFeedbackKey(result, item);
    if (!key) return readBlueskyReplyFeedback(result, item);
    const current = readBlueskyReplyFeedback(result, item);
    const merged = {
      ...current,
      ...(patch || {}),
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(merged));
    return merged;
  }

  function blueskyReplyHasReview(feedback) {
    return Boolean(
      Number(feedback && feedback.quality || 0) > 0
      || toList(feedback && feedback.categories).length
      || String(feedback && feedback.category_explain || '').trim()
      || toList(feedback && feedback.attributes).length
      || String(feedback && feedback.attributes_explain || '').trim()
      || toList(feedback && feedback.approaches).length
      || String(feedback && feedback.approaches_explain || '').trim()
      || String(feedback && feedback.note || '').trim()
      || String(feedback && feedback.suggested_response || '').trim()
    );
  }

  function renderBlueskyDiscoveryBulkActions() {
    const rows = Array.isArray(lastBlueskyDiscoveryResult?.candidates) ? lastBlueskyDiscoveryResult.candidates : [];
    const selectedCount = rows.reduce((count, item) => {
      const postUrl = String(item && item.post_url || '').trim();
      return count + (postUrl && blueskyDiscoverySelectedPostUrls.has(postUrl) ? 1 : 0);
    }, 0);
    const wrap = document.getElementById('blueskyDiscoveryBulkActions');
    const applyBtn = document.getElementById('blueskyDiscoveryApplyBulkQualityBtn');
    const bulkSelect = document.getElementById('blueskyDiscoveryBulkQuality');
    const selectAll = document.getElementById('blueskyDiscoverySelectAllVisible');
    if (wrap) wrap.classList.toggle('hidden', !rows.length);
    if (applyBtn) {
      applyBtn.disabled = !selectedCount;
      applyBtn.textContent = selectedCount ? `Apply To Selected (${selectedCount})` : 'Apply To Selected';
    }
    if (bulkSelect) bulkSelect.disabled = !selectedCount;
    if (selectAll) {
      const visibleUrls = rows.map((item) => String(item && item.post_url || '').trim()).filter(Boolean);
      selectAll.checked = !!visibleUrls.length && visibleUrls.every((url) => blueskyDiscoverySelectedPostUrls.has(url));
      selectAll.indeterminate = !selectAll.checked && visibleUrls.some((url) => blueskyDiscoverySelectedPostUrls.has(url));
    }
  }

  let blueskyDiscoveryPostOverlayEl = null;
  let blueskyDiscoveryPostOverlayBodyEl = null;
  let blueskyDiscoveryPostOverlayEditBtn = null;
  let blueskyDiscoveryPostOverlayHideTimer = null;
  let blueskyDiscoveryPostOverlayEditAction = null;

  function ensureBlueskyDiscoveryPostOverlay() {
    if (blueskyDiscoveryPostOverlayEl && document.body.contains(blueskyDiscoveryPostOverlayEl)) {
      return blueskyDiscoveryPostOverlayEl;
    }
    const overlay = document.createElement('div');
    overlay.className = 'bluesky-discovery-post-overlay hidden';
    const header = document.createElement('div');
    header.className = 'bluesky-discovery-post-overlay-header';
    const title = document.createElement('strong');
    title.textContent = 'Full Post';
    const editBtn = App.makeIconButton('edit', 'Review Training Feedback', () => {
      hideBlueskyDiscoveryPostOverlay(false);
      if (typeof blueskyDiscoveryPostOverlayEditAction === 'function') blueskyDiscoveryPostOverlayEditAction();
    }, { primary: true });
    editBtn.classList.add('youtube-miner-feedback-icon');
    header.appendChild(title);
    header.appendChild(editBtn);
    const body = document.createElement('div');
    body.className = 'bluesky-discovery-post-overlay-body';
    overlay.appendChild(header);
    overlay.appendChild(body);
    overlay.addEventListener('mouseenter', () => {
      if (blueskyDiscoveryPostOverlayHideTimer) clearTimeout(blueskyDiscoveryPostOverlayHideTimer);
    });
    overlay.addEventListener('mouseleave', () => {
      hideBlueskyDiscoveryPostOverlay(true);
    });
    document.body.appendChild(overlay);
    blueskyDiscoveryPostOverlayEl = overlay;
    blueskyDiscoveryPostOverlayBodyEl = body;
    blueskyDiscoveryPostOverlayEditBtn = editBtn;
    return overlay;
  }

  function positionBlueskyDiscoveryPostOverlay(anchorEl, overlayEl) {
    if (!anchorEl || !overlayEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const margin = 16;
    const overlayWidth = Math.min(760, Math.max(420, Math.floor(window.innerWidth * 0.52)));
    overlayEl.style.width = `${overlayWidth}px`;
    overlayEl.style.maxHeight = `${Math.floor(window.innerHeight * 0.62)}px`;
    const overlayRect = overlayEl.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 10;
    if (left + overlayRect.width > window.innerWidth - margin) {
      left = window.innerWidth - overlayRect.width - margin;
    }
    if (left < margin) left = margin;
    if (top + overlayRect.height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - overlayRect.height - 10);
    }
    overlayEl.style.left = `${left}px`;
    overlayEl.style.top = `${top}px`;
  }

  function showBlueskyDiscoveryPostOverlay(text, anchorEl, editAction, hasFeedback) {
    const overlay = ensureBlueskyDiscoveryPostOverlay();
    if (blueskyDiscoveryPostOverlayHideTimer) clearTimeout(blueskyDiscoveryPostOverlayHideTimer);
    blueskyDiscoveryPostOverlayEditAction = typeof editAction === 'function' ? editAction : null;
    if (blueskyDiscoveryPostOverlayBodyEl) {
      blueskyDiscoveryPostOverlayBodyEl.textContent = String(text || '').trim() || '-';
    }
    if (blueskyDiscoveryPostOverlayEditBtn) {
      blueskyDiscoveryPostOverlayEditBtn.classList.toggle('has-feedback', !!hasFeedback);
    }
    overlay.classList.remove('hidden');
    positionBlueskyDiscoveryPostOverlay(anchorEl, overlay);
  }

  function hideBlueskyDiscoveryPostOverlay(withDelay) {
    const overlay = ensureBlueskyDiscoveryPostOverlay();
    if (blueskyDiscoveryPostOverlayHideTimer) clearTimeout(blueskyDiscoveryPostOverlayHideTimer);
    const applyHide = () => overlay.classList.add('hidden');
    if (withDelay) {
      blueskyDiscoveryPostOverlayHideTimer = setTimeout(applyHide, 180);
      return;
    }
    applyHide();
  }

  function openBlueskyDiscoveryFeedbackPop(feedbackPop) {
    if (!feedbackPop) return;
    document.querySelectorAll('.bluesky-discovery-feedback-pop').forEach((node) => {
      if (node !== feedbackPop) node.classList.add('hidden');
    });
    if (!document.body.contains(feedbackPop)) {
      document.body.appendChild(feedbackPop);
    }
    feedbackPop.classList.remove('hidden');
    feedbackPop.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
  }

  async function getSharedTrainingPromptPayload() {
    const trainingContextInput = document.getElementById('youtubeMinerResponseContext');
    const trainingGuidelinesInput = document.getElementById('youtubeMinerGuidelines');

    let trainingContext = String(trainingContextInput && trainingContextInput.value || '').trim();
    let trainingGuidelines = String(trainingGuidelinesInput && trainingGuidelinesInput.value || '').trim();

    if (!trainingContext) {
      try { trainingContext = String(window.localStorage.getItem(YT_MINER_RESPONSE_CONTEXT_KEY) || '').trim(); } catch (_) { /* ignore */ }
    }
    if (!trainingGuidelines) {
      try { trainingGuidelines = String(window.localStorage.getItem(YT_MINER_RESPONSE_GUIDELINES_KEY) || '').trim(); } catch (_) { /* ignore */ }
    }

    if (!trainingContext || !trainingGuidelines) {
      try {
        const res = await api('/api/settings/training/context', { method: 'GET' });
        const loadedContext = String(res?.training_context || res?.data?.training_context || res?.youtube_response_context || res?.data?.youtube_response_context || '').trim();
        const loadedGuidelines = String(res?.training_guidelines || res?.data?.training_guidelines || res?.youtube_response_guidelines || res?.data?.youtube_response_guidelines || '').trim();
        if (!trainingContext && loadedContext) trainingContext = loadedContext;
        if (!trainingGuidelines && loadedGuidelines) trainingGuidelines = loadedGuidelines;
        if (trainingContextInput && !String(trainingContextInput.value || '').trim() && loadedContext) trainingContextInput.value = loadedContext;
        if (trainingGuidelinesInput && !String(trainingGuidelinesInput.value || '').trim() && loadedGuidelines) trainingGuidelinesInput.value = loadedGuidelines;
        if (loadedContext) {
          try { window.localStorage.setItem(YT_MINER_RESPONSE_CONTEXT_KEY, loadedContext); } catch (_) { /* ignore */ }
        }
        if (loadedGuidelines) {
          try { window.localStorage.setItem(YT_MINER_RESPONSE_GUIDELINES_KEY, loadedGuidelines); } catch (_) { /* ignore */ }
        }
      } catch (_) {
        // Keep best-effort local values; diagnostics will show if still missing.
      }
    }

    return {
      training_context: trainingContext,
      training_guidelines: trainingGuidelines,
    };
  }

  // -------------------------------------------------------------------------
  // Stage helpers
  // -------------------------------------------------------------------------

  function stageClass(stage, isBusy = false) {
    if (isBusy || stage === 'RUNNING') return 'status-warn';
    if (stage === 'COMPLETED') return 'status-ok';
    if (stage === 'REJECTED') return 'status-bad';
    return 'status-warn';
  }

  function isActionAllowed(stage, action) {
    const s = String(stage || '').toUpperCase();
    if (!s) return true;
    if (action === 'run')         return s === 'PENDING_PREVIEW' || s === 'PENDING_APPROVAL' || s === 'APPROVED';
    if (action === 'preview_job') return s === 'PENDING_PREVIEW';
    if (action === 'approve_job') return s === 'PENDING_APPROVAL';
    if (action === 'execute_job') return s === 'APPROVED';
    return true;
  }

  // -------------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------------

  function upsertAcquireJobState(job) {
    if (!job || !job.id) return;
    const idx = state.acquireJobs.findIndex((j) => String(j.id) === String(job.id));
    if (idx >= 0) {
      state.acquireJobs[idx] = { ...state.acquireJobs[idx], ...job };
    } else {
      state.acquireJobs.unshift(job);
    }
    state.acquireJobs.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  function deriveAcquireJobFromResponse(built, response) {
    const result = response?.result || {};
    const id = result?.job?.id || result?.job_id || built?.request?.job_id;
    if (!id) return null;
    const stage = result?.job?.status || result?.status || '';
    const urls = built?.request?.payload && Array.isArray(built.request.payload.source_urls)
      ? built.request.payload.source_urls : [];
    return {
      id: String(id),
      stage: String(stage || ''),
      url: String(urls[0] || ''),
      workspace_id: String(built?.request?.workspace_id || ''),
      type: String(built?.request?.type || ''),
      updated_at: new Date().toISOString()
    };
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function renderAcquireJobsTable() {
    if (!els.acquireJobsTable) return;
    els.acquireJobsTable.innerHTML = '';

    if (!state.acquireJobs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No jobs yet. Create one above to populate this list.';
      tr.appendChild(td);
      els.acquireJobsTable.appendChild(tr);
      return;
    }

    state.acquireJobs.forEach((job) => {
      const tr = document.createElement('tr');
      const stageValue = String(job.stage || '').toUpperCase();
      const isBusy = Boolean(state.acquireBusyByJob[job.id]);

      const idTd = document.createElement('td');
      idTd.textContent = job.id || '-';
      tr.appendChild(idTd);

      const stageTd = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `status-pill ${stageClass(stageValue, isBusy)}`;
      pill.textContent = isBusy ? 'RUNNING...' : (stageValue || '-');
      stageTd.appendChild(pill);
      tr.appendChild(stageTd);

      const urlTd = document.createElement('td');
      urlTd.textContent = job.url || '-';
      tr.appendChild(urlTd);

      const updatedTd = document.createElement('td');
      updatedTd.textContent = job.updated_at || '-';
      tr.appendChild(updatedTd);

      const actionsTd = document.createElement('td');

      const mkBtn = (label, onClick, enabled = true) => {
        const iconMap = {
          Load: 'load',
          Run: 'run',
          Status: 'status',
          Preview: 'preview',
          Approve: 'approve',
        };
        const btn = App.makeIconButton(iconMap[label] || 'view', label, onClick, { disabled: !enabled, marginRight: '6px' });
        return btn;
      };

      actionsTd.appendChild(mkBtn('Load', () => {
        if (job.id && els.acquireJobIdInput) els.acquireJobIdInput.value = job.id;
        if (job.url) {
          const src = els.acquireForm?.querySelector('textarea[name="source_urls"]');
          if (src) src.value = job.url;
        }
        notify(`Loaded ${job.id}`);
      }, !isBusy));

      actionsTd.appendChild(mkBtn('Run', () => runAcquireRowSequence(job), !isBusy && isActionAllowed(stageValue, 'run')));
      actionsTd.appendChild(mkBtn('Status',  () => runAcquireRowAction('job_status',  job), !isBusy));
      actionsTd.appendChild(mkBtn('Preview', () => runAcquireRowAction('preview_job', job), !isBusy && isActionAllowed(stageValue, 'preview_job')));
      actionsTd.appendChild(mkBtn('Approve', () => runAcquireRowAction('approve_job', job), !isBusy && isActionAllowed(stageValue, 'approve_job')));
      actionsTd.appendChild(mkBtn('Execute', () => runAcquireRowAction('execute_job', job), !isBusy && isActionAllowed(stageValue, 'execute_job')));
      actionsTd.appendChild(mkBtn('Delete', async () => {
        if (!confirm(`Delete ${job.id} from jobs list?`)) return;
        try {
          await api(`/api/acquire/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
          state.acquireJobs = state.acquireJobs.filter((j) => String(j.id) !== String(job.id));
          renderAcquireJobsTable();
          notify(`Deleted ${job.id}`);
        } catch (err) { notify(err.message, true); }
      }, !isBusy));

      tr.appendChild(actionsTd);
      els.acquireJobsTable.appendChild(tr);
    });
  }

  function renderDirectAcquireRunsTable() {
    if (!els.directAcquireRunsTable) return;
    els.directAcquireRunsTable.innerHTML = '';
    if (!state.directAcquireRuns.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 5; td.textContent = 'No direct runs yet.';
      tr.appendChild(td); els.directAcquireRunsTable.appendChild(tr); return;
    }
    state.directAcquireRuns.forEach((run) => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => loadDirectAcquireRun(run.run_id).catch((e) => notify(e.message, true)));
      [run.run_id||'-', run.source_url||'-', String(run.pages_succeeded??'-'), String(run.pages_failed??'-'), run.finished_at||'-']
        .forEach((text) => { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); });
      els.directAcquireRunsTable.appendChild(tr);
    });
  }

  function renderDirectAcquirePagesTable() {
    if (!els.directAcquirePagesTable) return;
    els.directAcquirePagesTable.innerHTML = '';
    const run = state.directAcquireCurrentRun;
    const pages = Array.isArray(run?.pages) ? run.pages : [];
    if (!pages.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 5; td.textContent = 'No website pages loaded yet.';
      tr.appendChild(td); els.directAcquirePagesTable.appendChild(tr);
    } else {
      pages.forEach((page) => {
        const tr = document.createElement('tr');
        [page.url||'-', page.title||'-',
         Array.isArray(page.emails)?page.emails.join(', ')||'-':'-',
         Array.isArray(page.phones)?page.phones.join(', ')||'-':'-',
         page.body_snippet||'-'
        ].forEach((text) => { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); });
        els.directAcquirePagesTable.appendChild(tr);
      });
    }
    if (els.directAcquireErrorsPreview) {
      const errors = Array.isArray(run?.errors) ? run.errors : [];
      els.directAcquireErrorsPreview.textContent = errors.length ? prettyJson({ errors }) : '{}';
      els.directAcquireErrorsPreview.classList.toggle('hidden', !errors.length);
    }
    setDirectAcquireResultsVisible(hasDirectAcquireResultsContent());
    renderDirectAcquireWebsiteDetails();
    renderDirectAcquireProjectWebsitesTable();
    renderDirectAcquireContactTable();
    renderDirectAcquireKeywordTable();
    renderDirectAcquireHashtagTable();
    renderDirectAcquirePeerSitesTable();
    renderDirectAcquireImageGallery();
    renderDirectAcquireWebsitePeersTable();
  }

  function renderDirectAcquireContactTable() {
    const tableBody = document.getElementById('directAcquireContactTable');
    const emptyEl = document.getElementById('directAcquireContactEmpty');
    const saveBtn = document.getElementById('directAcquireSaveContactBtn');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const run = state.directAcquireCurrentRun;
    const labels = Array.isArray(run?.contact_labels) ? run.contact_labels : [];
    if (!labels.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (saveBtn) saveBtn.disabled = true;
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    if (saveBtn) saveBtn.disabled = false;
    labels.forEach(([label, value]) => {
      const tr = document.createElement('tr');
      const labelTd = document.createElement('td');
      labelTd.className = 'direct-acquire-contact-label';
      labelTd.textContent = String(label || '');
      const valueTd = document.createElement('td');
      const text = String(value || '').trim();
      if (/^https?:\/\//i.test(text)) {
        const link = document.createElement('a');
        link.href = text;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = text;
        valueTd.appendChild(link);
      } else {
        valueTd.textContent = text;
      }
      tr.appendChild(labelTd);
      tr.appendChild(valueTd);
      tableBody.appendChild(tr);
    });
  }

  function renderDirectAcquireKeywordTable() {
    const tableBody = document.getElementById('directAcquireKeywordTable');
    const emptyEl = document.getElementById('directAcquireKeywordEmpty');
    const selectAll = document.getElementById('directAcquireKeywordSelectAll');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const run = state.directAcquireCurrentRun;
    const labels = Array.isArray(run?.keyword_labels) ? run.keyword_labels : [];
    const reasonMap = readDirectAcquireKeywordReasons();
    const topicMap = readDirectAcquireKeywordTopics();
    const validKeywords = new Set(
      labels.map(([keyword]) => String(keyword || '').trim()).filter(Boolean)
    );
    directAcquireSelectedKeywords = new Set(
      Array.from(directAcquireSelectedKeywords).filter((keyword) => validKeywords.has(keyword))
    );
    if (!labels.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      syncDirectAcquireSaveKeywordsBtn();
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    labels.forEach(([keyword, score]) => {
      const tr = document.createElement('tr');
      const normalized = normalizeDirectAcquireKeyword(keyword);
      const keywordLabel = String(keyword || '').trim();
      const isExcluded = Boolean(String(reasonMap[normalized] || '').trim());
      const assignedTopics = Array.isArray(topicMap[normalized]) ? topicMap[normalized].filter(Boolean) : [];
      if (isExcluded) tr.classList.add('direct-acquire-keyword-excluded');
      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = directAcquireSelectedKeywords.has(keywordLabel);
      checkbox.dataset.keyword = keywordLabel;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) directAcquireSelectedKeywords.add(keywordLabel);
        else directAcquireSelectedKeywords.delete(keywordLabel);
        syncDirectAcquireSaveKeywordsBtn();
        updateDirectAcquireKeywordSelectAllState();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);
      const keywordTd = document.createElement('td');
      keywordTd.className = 'direct-acquire-contact-label';
      keywordTd.textContent = String(keyword || '');
      const scoreTd = document.createElement('td');
      const numericScore = Number(score || 0) || 0;
      scoreTd.textContent = numericScore ? numericScore.toFixed(1) : '0.0';
      const topicsTd = document.createElement('td');
      topicsTd.textContent = assignedTopics.length ? assignedTopics.join(', ') : 'No Topics';
      const reasonTd = document.createElement('td');
      const reasonSelect = document.createElement('select');
      reasonSelect.dataset.keywordReason = 'true';
      reasonSelect.dataset.keyword = String(keyword || '').trim();
      DIRECT_ACQUIRE_KEYWORD_REASON_OPTIONS.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        if (String(value) === String(reasonMap[normalized] || '')) {
          option.selected = true;
        }
        reasonSelect.appendChild(option);
      });
      reasonSelect.addEventListener('change', () => {
        syncDirectAcquireKeywordExclusionsFromTable();
        renderDirectAcquireKeywordTable();
      });
      reasonTd.appendChild(reasonSelect);
      tr.appendChild(keywordTd);
      tr.appendChild(scoreTd);
      tr.appendChild(topicsTd);
      tr.appendChild(reasonTd);
      tableBody.appendChild(tr);
    });
    updateDirectAcquireKeywordSelectAllState();
    syncDirectAcquireSaveKeywordsBtn();
  }

  function renderDirectAcquireHashtagTable() {
    const tableBody = document.getElementById('directAcquireHashtagTable');
    const emptyEl = document.getElementById('directAcquireHashtagEmpty');
    const selectAll = document.getElementById('directAcquireHashtagSelectAll');
    const saveBtn = document.getElementById('directAcquireSaveHashtagsBtn');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const hashtags = filterDirectAcquireHashtagRows(state.directAcquireCurrentRun?.hashtag_summary?.hashtags);
    const valid = new Set(hashtags.map((item) => String(item?.hashtag || '').trim()).filter(Boolean));
    directAcquireSelectedHashtags = new Set(Array.from(directAcquireSelectedHashtags).filter((tag) => valid.has(tag)));
    if (!hashtags.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (saveBtn) saveBtn.disabled = true;
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    hashtags.forEach((item) => {
      const hashtag = String(item?.hashtag || '').trim();
      if (!hashtag) return;
      const tr = document.createElement('tr');

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = directAcquireSelectedHashtags.has(hashtag);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) directAcquireSelectedHashtags.add(hashtag);
        else directAcquireSelectedHashtags.delete(hashtag);
        renderDirectAcquireHashtagTable();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      const hashtagTd = document.createElement('td');
      hashtagTd.className = 'direct-acquire-contact-label';
      hashtagTd.textContent = hashtag;
      tr.appendChild(hashtagTd);

      const scoreTd = document.createElement('td');
      scoreTd.textContent = (Number(item?.evidence_score || 0) || 0).toFixed(1);
      tr.appendChild(scoreTd);

      const postsTd = document.createElement('td');
      postsTd.textContent = String(Number(item?.posts_count || 0) || 0);
      tr.appendChild(postsTd);

      const sampleTd = document.createElement('td');
      sampleTd.textContent = String(item?.sample_usage || '').trim() || '-';
      tr.appendChild(sampleTd);

      tableBody.appendChild(tr);
    });
    if (saveBtn) saveBtn.disabled = directAcquireSelectedHashtags.size === 0;
    if (selectAll) {
      const checkedCount = hashtags.filter((item) => directAcquireSelectedHashtags.has(String(item?.hashtag || '').trim())).length;
      selectAll.checked = !!hashtags.length && checkedCount === hashtags.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < hashtags.length;
    }
  }

  function renderDirectAcquirePeerSitesTable() {
    const tableBody = document.getElementById('directAcquirePeerSitesTable');
    const metaEl = document.getElementById('directAcquirePeerSitesMeta');
    const diagnosticsEl = document.getElementById('directAcquirePeerSitesDiagnostics');
    const suggestedWrap = document.getElementById('directAcquirePeerSitesSuggestedWrap');
    const suggestedEl = document.getElementById('directAcquirePeerSitesSuggested');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const summary = state.directAcquireCurrentRun?.peer_summary || {};
    const peers = Array.isArray(summary.peers) ? summary.peers : [];
    const suggestions = Array.isArray(summary.suggested_models) ? summary.suggested_models : [];
    const searchedKeywords = Array.isArray(summary.searched_keywords) ? summary.searched_keywords.filter(Boolean) : [];
    if (diagnosticsEl) {
      const diagnosticParts = [];
      diagnosticParts.push(`Provider: ${String(summary.provider || 'google_custom_search')}`);
      diagnosticParts.push(`Configured: ${summary.configured ? 'Yes' : 'No'}`);
      diagnosticParts.push(`Requested: ${summary.enabled === false ? 'No' : 'Yes'}`);
      diagnosticParts.push(`Keywords: ${searchedKeywords.length}`);
      diagnosticParts.push(`Results: ${Number(summary.raw_results_count || 0) || 0}`);
      diagnosticParts.push(`Unique Domains: ${Number(summary.unique_domains_count || 0) || 0}`);
      if (Array.isArray(summary.errors) && summary.errors.length) {
        diagnosticParts.push(`Errors: ${summary.errors.join(' | ')}`);
      } else if (String(summary.error || '').trim()) {
        diagnosticParts.push(`Error: ${String(summary.error || '').trim()}`);
      }
      diagnosticsEl.textContent = diagnosticParts.join(' | ');
    }
    if (!peers.length) {
      if (metaEl) {
        metaEl.textContent = String(summary.error || '').trim()
          || (summary.enabled === false
            ? 'Peer sites not searched.'
            : summary.configured === false
              ? 'Peer site discovery is not configured yet.'
              : 'No peer sites discovered yet.');
      }
      if (suggestedWrap) suggestedWrap.classList.add('hidden');
      return;
    }
    if (metaEl) {
      const uniqueCount = Number(summary.unique_domains_count || peers.length) || peers.length;
      const rawCount = Number(summary.raw_results_count || 0) || 0;
      metaEl.textContent = `${uniqueCount} unique domains identified from ${rawCount} search results.`;
    }
    if (suggestedWrap && suggestedEl) {
      if (suggestions.length) {
        suggestedEl.textContent = suggestions
          .map((item) => `${item.model} (${item.count})`)
          .join(', ');
        suggestedWrap.classList.remove('hidden');
      } else {
        suggestedWrap.classList.add('hidden');
      }
    }
    peers.forEach((peer) => {
      const tr = document.createElement('tr');

      const modelTd = document.createElement('td');
      modelTd.textContent = String(peer?.model || '').trim() || '-';
      tr.appendChild(modelTd);

      const domainTd = document.createElement('td');
      domainTd.className = 'direct-acquire-contact-label';
      domainTd.textContent = String(peer?.domain || '').trim() || '-';
      tr.appendChild(domainTd);

      const siteTd = document.createElement('td');
      const url = String(peer?.url || '').trim();
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(peer?.title || '').trim() || url;
        siteTd.appendChild(link);
      } else {
        siteTd.textContent = String(peer?.title || '').trim() || '-';
      }
      tr.appendChild(siteTd);

      const keywordsTd = document.createElement('td');
      keywordsTd.textContent = Array.isArray(peer?.matched_keywords) && peer.matched_keywords.length
        ? peer.matched_keywords.join(', ')
        : '-';
      tr.appendChild(keywordsTd);

      const snippetTd = document.createElement('td');
      snippetTd.textContent = String(peer?.snippet || '').trim() || '-';
      tr.appendChild(snippetTd);

      tableBody.appendChild(tr);
    });
  }

  function resetDirectAcquireWebsitePeerForm(referenceRole) {
    directAcquireWebsitePeerEditingId = '';
    const form = document.getElementById('directAcquireWebsitePeerForm');
    if (!form) return;
    form.reset();
    const idInput = document.getElementById('directAcquireWebsitePeerId');
    if (idInput) idInput.value = '';
    const role = referenceRole === 'model' ? 'model' : 'peer';
    const roleInput = document.getElementById('directAcquireWebsitePeerReferenceRole');
    if (roleInput) roleInput.value = role;
    const typeInput = document.getElementById('directAcquireWebsitePeerType');
    if (typeInput) {
      typeInput.value = role === 'model'
        ? (WEBSITE_PEER_MODELS.includes('Industry Hubs and Publications') ? 'Industry Hubs and Publications' : (WEBSITE_PEER_MODELS[0] || ''))
        : (WEBSITE_PEER_MODELS.includes('Direct Competitors') ? 'Direct Competitors' : (WEBSITE_PEER_MODELS[0] || ''));
    }
    const sourceUrlInput = document.getElementById('directAcquireWebsitePeerSourceUrl');
    const projectUrl = String(directAcquireProjectSourceUrl || state.directAcquireCurrentRun?.source_url || '').trim();
    if (sourceUrlInput && projectUrl) sourceUrlInput.value = projectUrl;
    const scopeInput = document.getElementById('directAcquireWebsitePeerModel');
    if (scopeInput) scopeInput.value = role === 'model' ? 'Model' : 'Peer';
  }

  function populateWebsitePeerModelSelect(selectEl) {
    if (!selectEl) return;
    const current = String(selectEl.value || '').trim();
    selectEl.innerHTML = '';
    WEBSITE_PEER_MODELS.forEach((label) => {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      selectEl.appendChild(option);
    });
    if (current && WEBSITE_PEER_MODELS.includes(current)) selectEl.value = current;
  }

  function deriveWebsitePeerScope(payload, existingPeer) {
    const sourceUrl = String(payload?.source_url || existingPeer?.source_url || '').trim();
    const siteUrl = String(payload?.site_url || existingPeer?.site_url || '').trim();
    if (!sourceUrl || !siteUrl) return String(existingPeer?.site_type || 'peer').trim() || 'peer';
    try {
      const source = new URL(sourceUrl);
      const site = new URL(siteUrl);
      const sourceHost = String(source.hostname || '').toLowerCase().replace(/^www\./, '');
      const siteHost = String(site.hostname || '').toLowerCase().replace(/^www\./, '');
      return sourceHost === siteHost ? 'source' : 'peer';
    } catch (_) {
      return String(existingPeer?.site_type || 'peer').trim() || 'peer';
    }
  }

  function fillDirectAcquireWebsitePeerForm(peer) {
    directAcquireWebsitePeerEditingId = String(peer?.id || '').trim();
    const idInput = document.getElementById('directAcquireWebsitePeerId');
    const roleInput = document.getElementById('directAcquireWebsitePeerReferenceRole');
    const typeInput = document.getElementById('directAcquireWebsitePeerType');
    const sourceUrlInput = document.getElementById('directAcquireWebsitePeerSourceUrl');
    const siteUrlInput = document.getElementById('directAcquireWebsitePeerSiteUrl');
    const titleInput = document.getElementById('directAcquireWebsitePeerTitle');
    const modelInput = document.getElementById('directAcquireWebsitePeerModel');
    const keywordsInput = document.getElementById('directAcquireWebsitePeerKeywords');
    const snippetInput = document.getElementById('directAcquireWebsitePeerSnippet');
    const notesInput = document.getElementById('directAcquireWebsitePeerNotes');
    if (idInput) idInput.value = directAcquireWebsitePeerEditingId;
    const referenceRole = getWebsitePeerReferenceRole(peer);
    if (roleInput) roleInput.value = referenceRole === 'model' ? 'model' : 'peer';
    if (typeInput) typeInput.value = String(peer?.website_model || '').trim() || (WEBSITE_PEER_MODELS.includes('Direct Competitors') ? 'Direct Competitors' : (WEBSITE_PEER_MODELS[0] || ''));
    if (sourceUrlInput) sourceUrlInput.value = String(peer?.source_url || '').trim();
    if (siteUrlInput) siteUrlInput.value = String(peer?.site_url || '').trim();
    if (titleInput) titleInput.value = String(peer?.title || '').trim();
    if (modelInput) {
      modelInput.value = referenceRole === 'model'
        ? ACQUIRE_WEBSITE_TYPE_LABELS.model
        : ACQUIRE_WEBSITE_TYPE_LABELS.peer;
    }
    if (keywordsInput) keywordsInput.value = Array.isArray(peer?.matched_keywords) ? peer.matched_keywords.join(', ') : '';
    if (snippetInput) snippetInput.value = String(peer?.snippet || '').trim();
    if (notesInput) notesInput.value = String(peer?.notes || '').trim();
  }

  function fillDirectAcquireWebsiteDetailsForm(peer, sourceUrl) {
    const idInput = document.getElementById('directAcquireWebsiteDetailsId');
    const urlInput = document.getElementById('directAcquireWebsiteDetailsUrl');
    const titleInput = document.getElementById('directAcquireWebsiteDetailsTitle');
    const descriptionInput = document.getElementById('directAcquireWebsiteDetailsDescription');
    const isProjectInput = document.getElementById('directAcquireWebsiteDetailsIsProject');
    const run = state.directAcquireCurrentRun;
    const url = String(sourceUrl || run?.source_url || directAcquireProjectSourceUrl || '').trim();
    const referenceRole = peer ? getWebsitePeerReferenceRole(peer) : 'project';
    if (idInput) idInput.value = String(peer?.id || '').trim();
    if (urlInput) urlInput.value = url;
    if (titleInput) {
      titleInput.value = String(peer?.title || '').trim() || getAcquireTitleForUrl(run, url);
    }
    if (descriptionInput) descriptionInput.value = String(peer?.notes || '').trim();
    if (isProjectInput) isProjectInput.checked = referenceRole === 'project';
  }

  function renderDirectAcquireWebsiteDetails() {
    const urlMeta = document.getElementById('directAcquireProjectWebsiteUrl');
    const run = state.directAcquireCurrentRun;
    const sourceUrl = String(run?.source_url || directAcquireProjectSourceUrl || '').trim();
    if (urlMeta) urlMeta.textContent = sourceUrl || '';
    const peer = findWebsitePeerForUrl(directAcquireWebsitePeers, sourceUrl);
    fillDirectAcquireWebsiteDetailsForm(peer, sourceUrl);
  }

  function renderDirectAcquireProjectWebsitesTable() {
    const tableBody = document.getElementById('directAcquireProjectWebsitesTable');
    const metaEl = document.getElementById('directAcquireProjectWebsitesMeta');
    const countEl = document.getElementById('directAcquireProjectWebsitesCount');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const peers = listProjectWebsitePeers(directAcquireWebsitePeers);
    if (countEl) countEl.textContent = `${peers.length} saved`;
    if (!peers.length) {
      if (metaEl) metaEl.textContent = 'No project websites saved yet.';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = 'No project websites saved yet.';
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }
    if (metaEl) metaEl.textContent = `${peers.length} project website${peers.length === 1 ? '' : 's'} for this project.`;
    peers.forEach((peer) => {
      const tr = document.createElement('tr');

      const domainTd = document.createElement('td');
      domainTd.className = 'direct-acquire-contact-label';
      domainTd.textContent = String(peer?.domain || '').trim() || '-';
      tr.appendChild(domainTd);

      const siteTd = document.createElement('td');
      if (String(peer?.site_url || '').trim()) {
        const link = document.createElement('a');
        link.href = String(peer.site_url).trim();
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(peer?.site_url || '').trim();
        siteTd.appendChild(link);
      } else {
        siteTd.textContent = '-';
      }
      tr.appendChild(siteTd);

      const titleTd = document.createElement('td');
      titleTd.textContent = String(peer?.title || '').trim() || '-';
      tr.appendChild(titleTd);

      const descriptionTd = document.createElement('td');
      descriptionTd.textContent = String(peer?.notes || '').trim() || '-';
      tr.appendChild(descriptionTd);

      const updatedTd = document.createElement('td');
      updatedTd.textContent = String(peer?.updated_at || peer?.last_acquired_at || '').trim() || '-';
      tr.appendChild(updatedTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'actions-col';
      const editBtn = App.makeIconButton('edit', 'Edit', () => {
        openDirectAcquireProjectWebsiteEditor(peer).catch((err) => notify(err.message || 'Could not open project website', true));
      });
      const deleteBtn = App.makeIconButton('trash', 'Delete', async () => {
        if (!confirm(`Delete ${String(peer?.domain || peer?.site_url || 'this website').trim()}?`)) return;
        try {
          await api(`/api/acquire/website-peers/${encodeURIComponent(peer.id)}`, { method: 'DELETE' });
          directAcquireWebsitePeers = directAcquireWebsitePeers.filter((item) => String(item?.id || '') !== String(peer.id));
          const editingId = String(document.getElementById('directAcquireWebsiteDetailsId')?.value || '').trim();
          if (editingId && editingId === String(peer.id)) setDirectAcquireProjectWebsitePanelVisible(false);
          renderDirectAcquireWebsiteDetails();
          renderDirectAcquireProjectWebsitesTable();
          renderDirectAcquireWebsitePeersTable();
          syncDirectAcquireResultsVisibility();
          notify('Project website deleted');
        } catch (err) {
          notify(err.message || 'Could not delete project website', true);
        }
      }, { danger: true });
      App.finishTableActionsCell(actionsTd, editBtn, deleteBtn);
      tr.appendChild(actionsTd);
      tableBody.appendChild(tr);
    });
  }

  function renderDirectAcquireWebsitePeersTable() {
    const tableBody = document.getElementById('directAcquireWebsitePeersTable');
    const metaEl = document.getElementById('directAcquireWebsitePeersMeta');
    const countEl = document.getElementById('directAcquireOtherWebsitesCount');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const peers = listReferenceWebsitePeers(directAcquireWebsitePeers);
    state.directAcquireWebsitePeers = Array.isArray(directAcquireWebsitePeers) ? directAcquireWebsitePeers.slice() : [];
    if (countEl) countEl.textContent = `${peers.length} saved`;
    if (!peers.length) {
      if (metaEl) metaEl.textContent = 'No peer or model websites saved yet.';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.textContent = 'No other websites saved yet.';
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }
    if (metaEl) metaEl.textContent = `${peers.length} other website${peers.length === 1 ? '' : 's'} for this project.`;
    peers.forEach((peer) => {
      const tr = document.createElement('tr');
      const referenceRole = getWebsitePeerReferenceRole(peer);

      const typeTd = document.createElement('td');
      typeTd.textContent = ACQUIRE_WEBSITE_TYPE_LABELS[referenceRole] || 'Peer';
      tr.appendChild(typeTd);

      const modelTd = document.createElement('td');
      modelTd.textContent = String(peer?.website_model || '').trim() || '-';
      tr.appendChild(modelTd);

      const domainTd = document.createElement('td');
      domainTd.className = 'direct-acquire-contact-label';
      domainTd.textContent = String(peer?.domain || '').trim() || '-';
      tr.appendChild(domainTd);

      const siteTd = document.createElement('td');
      if (String(peer?.site_url || '').trim()) {
        const link = document.createElement('a');
        link.href = String(peer.site_url).trim();
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(peer?.title || peer?.site_url || '').trim();
        siteTd.appendChild(link);
      } else {
        siteTd.textContent = String(peer?.title || '').trim() || '-';
      }
      tr.appendChild(siteTd);

      const keywordsTd = document.createElement('td');
      keywordsTd.textContent = Array.isArray(peer?.matched_keywords) && peer.matched_keywords.length
        ? peer.matched_keywords.join(', ')
        : '-';
      tr.appendChild(keywordsTd);

      const sourceTd = document.createElement('td');
      sourceTd.textContent = String(peer?.source_domain || peer?.source_url || '').trim() || '-';
      tr.appendChild(sourceTd);

      const updatedTd = document.createElement('td');
      updatedTd.textContent = String(peer?.updated_at || peer?.last_acquired_at || '').trim() || '-';
      tr.appendChild(updatedTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'crud-actions-cell';

      const viewBtn = App.makeIconButton('view', 'View', () => {
        if (String(peer?.site_url || '').trim()) window.open(String(peer.site_url).trim(), '_blank', 'noopener');
      });
      actionsTd.appendChild(viewBtn);

      const editBtn = App.makeIconButton('edit', 'Edit', () => {
        fillDirectAcquireWebsitePeerForm(peer);
        scrollAcquireWebPanelIntoView('directAcquireOtherWebsitesSection');
      });
      actionsTd.appendChild(editBtn);

      const deleteBtn = App.makeIconButton('trash', 'Delete', async () => {
        if (!confirm(`Delete ${String(peer?.domain || peer?.site_url || 'this website').trim()}?`)) return;
        try {
          await api(`/api/acquire/website-peers/${encodeURIComponent(peer.id)}`, { method: 'DELETE' });
          directAcquireWebsitePeers = directAcquireWebsitePeers.filter((item) => String(item?.id || '') !== String(peer.id));
          renderDirectAcquireWebsiteDetails();
          renderDirectAcquireProjectWebsitesTable();
          renderDirectAcquireWebsitePeersTable();
          if (String(directAcquireWebsitePeerEditingId || '') === String(peer.id)) resetDirectAcquireWebsitePeerForm();
          notify('Website peer deleted');
        } catch (err) {
          notify(err.message || 'Could not delete website peer', true);
        }
      }, { danger: true });
      actionsTd.appendChild(deleteBtn);

      tr.appendChild(actionsTd);
      tableBody.appendChild(tr);
    });
  }

  async function refreshDirectAcquireWebsitePeers() {
    const res = await api('/api/acquire/website-peers?limit=500');
    directAcquireWebsitePeers = Array.isArray(res?.websitePeers)
      ? res.websitePeers
      : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res)
          ? res
          : [];
    state.directAcquireWebsitePeers = directAcquireWebsitePeers.slice();
    renderDirectAcquireProjectWebsitesTable();
    renderDirectAcquireWebsitePeersTable();
    if (!document.getElementById('directAcquireProjectWebsitePanel')?.classList.contains('hidden')) {
      renderDirectAcquireWebsiteDetails();
    }
    syncDirectAcquireResultsVisibility();
  }

  async function saveDirectAcquireSelectedHashtags() {
    const hashtags = Array.from(directAcquireSelectedHashtags).filter(Boolean);
    if (!hashtags.length) throw new Error('No hashtags selected.');
    await Promise.all(hashtags.map((hashtag) => api('/api/messaging/hashtags', {
      method: 'POST',
      body: JSON.stringify({ hashtag }),
    })));
    notify(`Saved ${hashtags.length} hashtag${hashtags.length === 1 ? '' : 's'}`);
  }

  function syncDirectAcquireSaveKeywordsBtn() {
    const saveBtn = document.getElementById('directAcquireSaveKeywordsBtn');
    if (!saveBtn) return;
    saveBtn.disabled = directAcquireSelectedKeywords.size === 0;
  }

  function updateDirectAcquireKeywordSelectAllState() {
    const selectAll = document.getElementById('directAcquireKeywordSelectAll');
    const tableBody = document.getElementById('directAcquireKeywordTable');
    if (!selectAll || !tableBody) return;
    const checkboxes = Array.from(tableBody.querySelectorAll('input[type="checkbox"][data-keyword]'));
    const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
    selectAll.checked = !!checkboxes.length && checkedCount === checkboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
  }

  function applyBulkKeywordExclusion(reason) {
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) return 0;
    const selected = Array.from(directAcquireSelectedKeywords).filter(Boolean);
    if (!selected.length) return 0;
    const tableBody = document.getElementById('directAcquireKeywordTable');
    selected.forEach((keyword) => {
      const row = tableBody
        ? Array.from(tableBody.querySelectorAll('select[data-keyword-reason]')).find(
            (select) => String(select.dataset.keyword || '').trim() === keyword
          )?.closest('tr')
        : null;
      const reasonSelect = row ? row.querySelector('select[data-keyword-reason]') : null;
      if (reasonSelect) reasonSelect.value = normalizedReason;
    });
    syncDirectAcquireKeywordExclusionsFromTable();
    renderDirectAcquireKeywordTable();
    return selected.length;
  }

  async function saveDirectAcquireSelectedKeywords() {
    const labels = Array.from(directAcquireSelectedKeywords).map((value) => String(value || '').trim()).filter(Boolean);
    if (!labels.length) throw new Error('No keywords selected.');
    const topicMap = readDirectAcquireKeywordTopics();
    const topicsByKeyword = [];
    labels.forEach((keyword) => {
      const topics = Array.isArray(topicMap[normalizeDirectAcquireKeyword(keyword)])
        ? topicMap[normalizeDirectAcquireKeyword(keyword)].filter(Boolean)
        : [];
      if (!topics.length) return;
      topicsByKeyword.push({ keyword, topics });
    });
    if (!topicsByKeyword.length) {
      throw new Error('Assign at least one topic to the selected keywords before saving.');
    }
    let createdCount = 0;
    for (const entry of topicsByKeyword) {
      createdCount += await saveSelectedKeywordsAsContent([entry.keyword], entry.topics);
    }
    const noun = topicsByKeyword.length === 1 ? 'keyword' : 'keywords';
    const createdText = createdCount
      ? ` and added ${createdCount} keyword content record${createdCount === 1 ? '' : 's'}`
      : '';
    notify(`Saved ${topicsByKeyword.length} ${noun}${createdText}`);
  }

  function buildContactPayloadFromDirectRun(run) {
    const summary = run?.contact_summary || {};
    const domain = (() => {
      try { return new URL(String(summary.website || run?.source_url || '')).hostname.replace(/^www\./, ''); }
      catch { return ''; }
    })();
    const tags = ['web-acquire'];
    if (run?.capture_contact_data) tags.push('contact-capture');
    const extraNotes = [];
    const appendList = (label, key) => {
      const values = Array.isArray(summary?.[key]) ? summary[key].filter(Boolean) : [];
      if (values.length > 1) extraNotes.push(`${label}: ${values.join(', ')}`);
      return values;
    };
    const emails = appendList('Emails', 'emails');
    const phones = appendList('Phones', 'phones');
    const youtube = appendList('YouTube', 'youtube');
    const instagram = appendList('Instagram', 'instagram');
    const tiktok = appendList('TikTok', 'tiktok');
    const facebook = appendList('Facebook', 'facebook');
    const x = appendList('X', 'x');
    const bluesky = appendList('Bluesky', 'bluesky');
    const linkedin = appendList('LinkedIn', 'linkedin');
    const patreon = appendList('Patreon', 'patreon');
    const substack = appendList('Substack', 'substack');
    const medium = appendList('Medium', 'medium');
    const telegram = appendList('Telegram', 'telegram');
    const discord = appendList('Discord', 'discord');
    const whatsapp = appendList('WhatsApp', 'whatsapp');
    if (telegram.length) extraNotes.push(`Telegram: ${telegram.join(', ')}`);
    if (discord.length) extraNotes.push(`Discord: ${discord.join(', ')}`);
    if (whatsapp.length) extraNotes.push(`WhatsApp: ${whatsapp.join(', ')}`);
    return {
      contactType: 'lead',
      entityType: 'Human',
      company: domain,
      email: emails[0] || '',
      phone: phones[0] || '',
      website: String(summary.website || run?.source_url || '').trim(),
      youtube: youtube[0] || '',
      instagram: instagram[0] || '',
      tiktok: tiktok[0] || '',
      facebook: facebook[0] || '',
      x: x[0] || '',
      bluesky: bluesky[0] || '',
      patreon: patreon[0] || '',
      linkedin: linkedin[0] || '',
      source: 'acquire.web',
      status: 'captured',
      tags,
      notes: extraNotes.join('\n'),
    };
  }

  async function saveDirectAcquireContact() {
    const run = state.directAcquireCurrentRun;
    const labels = Array.isArray(run?.contact_labels) ? run.contact_labels : [];
    if (!labels.length) throw new Error('No captured contact data to save.');
    const payload = buildContactPayloadFromDirectRun(run);
    await api('/api/contacts', { method: 'POST', body: JSON.stringify(payload) });
    notify('Captured contact saved');
  }

  function buildUserIndex(users) {
    const map = new Map();
    (Array.isArray(users) ? users : []).forEach((user) => {
      const id = String(user && user.id || '').trim();
      if (!id) return;
      map.set(id, user);
    });
    return map;
  }

  function toIsoFromLocal(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
  }

  function estimateRedditAcquireSeconds(payload) {
    const mode = String(payload?.mode || 'auto');
    const maxPosts = Number(payload?.max_posts || 0);
    const maxComments = Number(payload?.max_comments || 0);
    const includeReplies = !!payload?.include_replies;
    let estimate = 18;
    if (mode === 'post') {
      estimate += Math.ceil(maxComments * 0.18);
    } else {
      estimate += Math.ceil(maxPosts * 0.9);
      estimate += Math.ceil(maxComments * 0.12);
    }
    if (includeReplies) estimate += 24;
    return Math.max(30, Math.min(900, estimate));
  }

  function setRedditAcquireProgress(percent, text) {
    const wrap = document.getElementById('redditAcquireProgressWrap');
    const bar = document.getElementById('redditAcquireProgressBar');
    const label = document.getElementById('redditAcquireProgressText');
    if (!wrap || !bar || !label) return;
    wrap.classList.remove('hidden');
    bar.value = Math.max(0, Math.min(100, Number(percent) || 0));
    label.textContent = String(text || '').trim() || 'Running…';
  }

  function clearRedditAcquireProgress() {
    if (redditAcquireProgressTimer) {
      clearInterval(redditAcquireProgressTimer);
      redditAcquireProgressTimer = null;
    }
  }

  function beginRedditAcquireProgress(payload) {
    clearRedditAcquireProgress();
    const startedAt = Date.now();
    const estimateSeconds = estimateRedditAcquireSeconds(payload);
    setRedditAcquireProgress(4, 'Queued request (phase 1 of 3)…');
    setRedditAcquireProgress(12, `Running OpenClaw acquire (phase 2 of 3)… ~${estimateSeconds}s remaining (estimated)`);
    redditAcquireProgressTimer = setInterval(() => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const remainingSeconds = Math.max(0, estimateSeconds - elapsedSeconds);
      const ratio = estimateSeconds > 0 ? Math.min(1, elapsedSeconds / estimateSeconds) : 0;
      const pct = Math.min(92, 12 + Math.round(ratio * 80));
      const eta = remainingSeconds > 0 ? `~${remainingSeconds}s remaining (estimated)` : 'finalizing…';
      setRedditAcquireProgress(pct, `Running OpenClaw acquire (phase 2 of 3)… ${eta}`);
    }, 1000);
    return {
      finishSuccess() {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        clearRedditAcquireProgress();
        setRedditAcquireProgress(100, `Completed in ${elapsedSeconds}s.`);
      },
      finishError(message) {
        clearRedditAcquireProgress();
        setRedditAcquireProgress(100, `Stopped: ${safeText(message) || 'request failed'}`);
      },
    };
  }

  function renderXAcquireItemsTable() {
    if (!els.xAcquireItemsTable) return;
    els.xAcquireItemsTable.innerHTML = '';
    const run = state.xAcquireCurrentRun;
    const result = run && run.result ? run.result : null;
    const tweets = Array.isArray(result && result.tweets) ? result.tweets : [];
    const replies = Array.isArray(result && result.replies) ? result.replies : [];
    const usersById = buildUserIndex(result && result.users);
    const rows = []
      .concat(tweets.map((item) => ({ type: 'tweet', item })))
      .concat(replies.map((item) => ({ type: 'reply', item })));

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No tweets/replies loaded yet.';
      tr.appendChild(td);
      els.xAcquireItemsTable.appendChild(tr);
    } else {
      rows.forEach((row) => {
        const tweet = row.item || {};
        const tr = document.createElement('tr');
        const author = usersById.get(String(tweet.author_id || '').trim()) || {};
        const cells = [
          row.type,
          String(tweet.id || ''),
          String(author.username || author.name || tweet.author_id || '-'),
          String(tweet.created_at || '-'),
          String(tweet.text || '').trim(),
        ];
        cells.forEach((value) => {
          const td = document.createElement('td');
          td.textContent = value || '-';
          tr.appendChild(td);
        });
        els.xAcquireItemsTable.appendChild(tr);
      });
    }

    if (els.xAcquireRawPreview) {
      els.xAcquireRawPreview.textContent = run ? prettyJson(run) : '{}';
    }
  }

  function renderRedditAcquireItemsTable() {
    if (!els.redditAcquireItemsTable) return;
    els.redditAcquireItemsTable.innerHTML = '';
    const run = state.redditAcquireCurrentRun;
    const result = run && run.result ? run.result : null;
    const posts = Array.isArray(result && result.posts) ? result.posts : [];
    const primaryPost = (result && result.post) ? result.post : (posts[0] || null);
    App.setKeyValueRows(els.redditAcquirePostDetailsBody, primaryPost ? [
      ['Title', String(primaryPost.title || '').trim() || '-'],
      ['Subreddit', String(primaryPost.subreddit || run?.subreddit || '-')],
      ['Author', String(primaryPost.author || '-')],
      ['Score', String(primaryPost.score != null ? primaryPost.score : '-')],
      ['Created', String(primaryPost.created_utc ? new Date(Number(primaryPost.created_utc) * 1000).toISOString() : '-')],
      ['Permalink', String(primaryPost.permalink ? `https://www.reddit.com${primaryPost.permalink}` : '-')],
    ] : [
      ['Post', 'No post details loaded yet.'],
    ]);
    const comments = Array.isArray(result && result.comments) ? result.comments : [];
    const rows = []
      .concat(posts.map((item) => ({ type: 'post', item })))
      .concat(comments.map((item) => ({ type: 'comment', item })));

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No posts/comments loaded yet.';
      tr.appendChild(td);
      els.redditAcquireItemsTable.appendChild(tr);
    } else {
      rows.forEach((row) => {
        const item = row.item || {};
        const tr = document.createElement('tr');
        const cols = [
          row.type,
          String(item.id || item.name || ''),
          String(item.author || '-'),
          String(item.score != null ? item.score : '-'),
          row.type === 'post' ? String(item.title || item.selftext || '').trim() : String(item.body || '').trim(),
        ];
        cols.forEach((value) => {
          const td = document.createElement('td');
          td.textContent = value || '-';
          tr.appendChild(td);
        });
        els.redditAcquireItemsTable.appendChild(tr);
      });
    }

    if (els.redditAcquireRawPreview) {
      els.redditAcquireRawPreview.textContent = run ? prettyJson(run) : '{}';
    }
  }

  function setRedditDiscoveryStatus(message, isError = false) {
    const el = document.getElementById('redditDiscoveryStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'Reddit discovery is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setRedditReplyStatus(message, isError = false) {
    const el = document.getElementById('redditReplyStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'Reddit reply generation is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setBlueskyDiscoveryStatus(message, isError = false) {
    const el = document.getElementById('blueskyDiscoveryStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'BlueSky discovery is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setBlueskyReplyStatus(message, isError = false) {
    const el = document.getElementById('blueskyReplyStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'BlueSky reply generation is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setBlueskyPostingStatus(message, isError = false) {
    const el = document.getElementById('blueskyPostingStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'BlueSky posting operator is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function renderBlueskyDiscoveryTable(result) {
    const tbody = document.getElementById('blueskyDiscoveryTable');
    const repliesTbody = document.getElementById('blueskyDiscoveryRepliesTable');
    const preview = document.getElementById('blueskyDiscoveryPreview');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';
    if (repliesTbody) repliesTbody.innerHTML = '';
    lastBlueskyDiscoveryResult = result || null;
    const rows = Array.isArray(result?.candidates) ? result.candidates : [];
    const threadReplies = Array.isArray(result?.thread_replies) ? result.thread_replies : [];
    const categoryNames = getTrainingConfigNames('youtubeMinerCategoryConfigTable');
    const attributeNames = getTrainingConfigNames('youtubeMinerAttributeConfigTable');
    const approachNames = getTrainingConfigNames('youtubeMinerApproachConfigTable');
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 11;
      td.textContent = 'No BlueSky post candidates loaded yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      if (repliesTbody) {
        const replyTr = document.createElement('tr');
        const replyTd = document.createElement('td');
        replyTd.colSpan = 5;
        replyTd.textContent = 'No BlueSky thread replies loaded yet.';
        replyTr.appendChild(replyTd);
        repliesTbody.appendChild(replyTr);
      }
      renderBlueskyDiscoveryBulkActions();
      return;
    }

    const populateBlueskyTargets = (postUrl) => {
      const nextValue = String(postUrl || '').trim();
      const replyTarget = document.getElementById('blueskyReplyTarget');
      const postingTarget = document.getElementById('blueskyPostingTarget');
      if (replyTarget) replyTarget.value = nextValue;
      if (postingTarget) postingTarget.value = nextValue;
      return nextValue;
    };

    rows.forEach((item) => {
      const postUrl = String(item && item.post_url || '').trim();
      const feedback = readBlueskyDiscoveryFeedback(item);
      const tr = document.createElement('tr');
      if (blueskyDiscoveryHasReview(feedback)) tr.classList.add('youtube-miner-row-reviewed');

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = postUrl ? blueskyDiscoverySelectedPostUrls.has(postUrl) : false;
      checkbox.disabled = !postUrl;
      checkbox.setAttribute('aria-label', 'Select BlueSky post ' + (postUrl || ''));
      checkbox.addEventListener('change', () => {
        if (!postUrl) return;
        if (checkbox.checked) blueskyDiscoverySelectedPostUrls.add(postUrl);
        else blueskyDiscoverySelectedPostUrls.delete(postUrl);
        renderBlueskyDiscoveryBulkActions();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      const cols = [
        String(item.discovery_score != null ? item.discovery_score : item.reply_opportunity || '-'),
        String(item.author_handle || item.author_display_name || '-'),
        String(item.text || item.post_url || '-'),
        String(item.like_count != null ? item.like_count : '-'),
        String(item.reply_count != null ? item.reply_count : '-'),
        String(item.repost_count != null ? item.repost_count : '-'),
        String(item.created_at ? new Date(item.created_at).toLocaleString() : '-'),
      ];
      cols.forEach((value, idx) => {
        const td = document.createElement('td');
        if (idx === 0) td.className = 'bluesky-discovery-metric-cell bluesky-discovery-score-cell';
        if (idx === 3 || idx === 4 || idx === 5) td.className = 'bluesky-discovery-metric-cell';
        if (idx === 2 && item.post_url) {
          td.className = 'bluesky-discovery-post-cell';
          const previewWrap = document.createElement('div');
          previewWrap.className = 'bluesky-discovery-post-preview-wrap';
          const a = document.createElement('a');
          a.href = item.post_url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = value || '-';
          a.className = 'bluesky-discovery-post-link';
          a.addEventListener('mouseenter', () => showBlueskyDiscoveryPostOverlay(value || '-', a, () => {
            openBlueskyDiscoveryFeedbackPop(feedbackPop);
          }, blueskyDiscoveryHasReview(feedback)));
          a.addEventListener('focus', () => showBlueskyDiscoveryPostOverlay(value || '-', a, () => {
            openBlueskyDiscoveryFeedbackPop(feedbackPop);
          }, blueskyDiscoveryHasReview(feedback)));
          a.addEventListener('mouseleave', () => hideBlueskyDiscoveryPostOverlay(true));
          a.addEventListener('blur', () => hideBlueskyDiscoveryPostOverlay(true));
          previewWrap.appendChild(a);
          td.appendChild(previewWrap);
        } else {
          td.textContent = value || '-';
        }
        tr.appendChild(td);
      });

      const qualityTd = document.createElement('td');
      const qualitySelect = document.createElement('select');
      qualitySelect.className = 'bluesky-discovery-quality-select';
      makeQualityOptions(feedback.quality).forEach((option) => qualitySelect.appendChild(option));
      qualitySelect.addEventListener('change', () => {
        const updated = saveBlueskyDiscoveryFeedback(item, { quality: String(qualitySelect.value || '').trim(), updated_at: new Date().toISOString() });
        tr.classList.toggle('youtube-miner-row-reviewed', blueskyDiscoveryHasReview(updated));
        feedbackBtn.classList.toggle('has-feedback', blueskyDiscoveryHasReview(updated));
      });
      qualityTd.appendChild(qualitySelect);
      tr.appendChild(qualityTd);

      const whyTd = document.createElement('td');
      whyTd.textContent = String(item.why_relevant || '-');
      tr.appendChild(whyTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'bluesky-discovery-actions-cell';
      const copyBtn = App.makeIconButton('copy', 'Copy Post URL Into Forms', () => {
        const nextValue = populateBlueskyTargets(item.post_url);
        notify(nextValue ? 'Copied BlueSky post URL into reply and posting forms' : 'No BlueSky post URL available', !nextValue);
      }, { primary: true });
      const generateBtn = App.makeIconButton('run', 'Generate Reply Candidates', async () => {
        const nextValue = populateBlueskyTargets(item.post_url);
        if (!nextValue) {
          notify('No BlueSky post URL available', true);
          return;
        }
        try {
          generateBtn.disabled = true;
          await runBlueskyReplyCandidates(nextValue);
          const replySection = document.getElementById('blueskyReplyCandidatesTable');
          if (replySection) replySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          notify('Generated BlueSky reply candidates from selected post');
        } catch (err) {
          setBlueskyReplyStatus(err.message || 'Could not generate BlueSky reply candidates', true);
          notify(err.message, true);
        } finally {
          generateBtn.disabled = false;
        }
      }, { primary: true, marginLeft: '0.35rem' });
      const feedbackWrap = document.createElement('div');
      feedbackWrap.className = 'youtube-miner-feedback-wrap';
      feedbackWrap.style.display = 'inline-flex';
      feedbackWrap.style.marginLeft = '0.35rem';
      const feedbackBtn = App.makeIconButton('edit', 'Review Training Feedback', () => {
        if (feedbackPop.classList.contains('hidden')) openBlueskyDiscoveryFeedbackPop(feedbackPop);
        else feedbackPop.classList.add('hidden');
      }, { primary: true });
      feedbackBtn.classList.add('youtube-miner-feedback-icon');
      if (blueskyDiscoveryHasReview(feedback)) feedbackBtn.classList.add('has-feedback');
      const feedbackPop = document.createElement('div');
      feedbackPop.className = 'youtube-miner-feedback-pop bluesky-discovery-feedback-pop hidden';
      const title = document.createElement('h4');
      title.textContent = 'Training Feedback';
      feedbackPop.appendChild(title);
      const excerpt = document.createElement('div');
      excerpt.className = 'bluesky-training-feedback-comment';
      excerpt.textContent = String(item.text || item.post_url || '');
      feedbackPop.appendChild(excerpt);

      const popQualityRow = document.createElement('div');
      popQualityRow.className = 'form-row';
      const popQualityLabel = document.createElement('label');
      popQualityLabel.textContent = 'Quality (1-5)';
      const popQualitySelect = document.createElement('select');
      popQualitySelect.appendChild(new Option('0 (unset)', '0'));
      for (let i = 1; i <= 5; i++) popQualitySelect.appendChild(new Option(String(i), String(i)));
      popQualitySelect.value = String(Number(feedback.quality || 0));
      popQualityRow.appendChild(popQualityLabel);
      popQualityRow.appendChild(popQualitySelect);
      feedbackPop.appendChild(popQualityRow);

      const catRow = document.createElement('div');
      catRow.className = 'form-row youtube-miner-feedback-factor-row';
      const catLabel = document.createElement('label');
      catLabel.textContent = 'Category (multi-select)';
      const catInput = document.createElement('select');
      catInput.multiple = true;
      catInput.size = 5;
      categoryNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.categories.indexOf(name) !== -1;
        catInput.appendChild(option);
      });
      const catExplain = document.createElement('input');
      catExplain.type = 'text';
      catExplain.placeholder = 'Explain';
      catExplain.value = String(feedback.category_explain || '');
      catRow.appendChild(catLabel);
      catRow.appendChild(catInput);
      catRow.appendChild(catExplain);
      feedbackPop.appendChild(catRow);

      const attrRow = document.createElement('div');
      attrRow.className = 'form-row youtube-miner-feedback-factor-row';
      const attrLabel = document.createElement('label');
      attrLabel.textContent = 'Attributes (multi-select)';
      const attrInput = document.createElement('select');
      attrInput.multiple = true;
      attrInput.size = 5;
      attributeNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.attributes.indexOf(name) !== -1;
        attrInput.appendChild(option);
      });
      const attrExplain = document.createElement('input');
      attrExplain.type = 'text';
      attrExplain.placeholder = 'Explain';
      attrExplain.value = String(feedback.attributes_explain || '');
      attrRow.appendChild(attrLabel);
      attrRow.appendChild(attrInput);
      attrRow.appendChild(attrExplain);
      feedbackPop.appendChild(attrRow);

      const approachRow = document.createElement('div');
      approachRow.className = 'form-row youtube-miner-feedback-factor-row';
      const approachLabel = document.createElement('label');
      approachLabel.textContent = 'Approach (multi-select)';
      const approachInput = document.createElement('select');
      approachInput.multiple = true;
      approachInput.size = 5;
      approachNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.approaches.indexOf(name) !== -1;
        approachInput.appendChild(option);
      });
      const approachExplain = document.createElement('input');
      approachExplain.type = 'text';
      approachExplain.placeholder = 'Explain';
      approachExplain.value = String(feedback.approaches_explain || '');
      approachRow.appendChild(approachLabel);
      approachRow.appendChild(approachInput);
      approachRow.appendChild(approachExplain);
      feedbackPop.appendChild(approachRow);

      const noteRow = document.createElement('div');
      noteRow.className = 'form-row';
      const noteLabel = document.createElement('label');
      noteLabel.textContent = 'What do you like about this comment?';
      const noteInput = document.createElement('textarea');
      noteInput.rows = 8;
      noteInput.placeholder = 'Explain what makes this comment valuable, what signals matter, and what reply style would fit.';
      noteInput.value = String(feedback.note || '');
      noteRow.appendChild(noteLabel);
      noteRow.appendChild(noteInput);
      feedbackPop.appendChild(noteRow);

      const suggestedRow = document.createElement('div');
      suggestedRow.className = 'form-row';
      const suggestedLabel = document.createElement('label');
      suggestedLabel.textContent = 'Suggested Response';
      const suggestedInput = document.createElement('textarea');
      suggestedInput.rows = 4;
      suggestedInput.placeholder = 'Optional: write the exact style or sample response you would want here.';
      suggestedInput.value = String(feedback.suggested_response || '');
      suggestedRow.appendChild(suggestedLabel);
      suggestedRow.appendChild(suggestedInput);
      feedbackPop.appendChild(suggestedRow);

      const actionRow = document.createElement('div');
      actionRow.className = 'youtube-miner-feedback-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Close';
      cancelBtn.addEventListener('click', () => feedbackPop.classList.add('hidden'));
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = 'Save Feedback';
      saveBtn.addEventListener('click', () => {
        const selectedCategories = Array.from(catInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const selectedAttributes = Array.from(attrInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const selectedApproaches = Array.from(approachInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const updated = saveBlueskyDiscoveryFeedback(item, {
          quality: Number(popQualitySelect.value || 0),
          categories: selectedCategories,
          category_explain: String(catExplain.value || ''),
          attributes: selectedAttributes,
          attributes_explain: String(attrExplain.value || ''),
          approaches: selectedApproaches,
          approaches_explain: String(approachExplain.value || ''),
          note: String(noteInput.value || ''),
          suggested_response: String(suggestedInput.value || ''),
        });
        qualitySelect.value = String(updated.quality || '');
        tr.classList.toggle('youtube-miner-row-reviewed', blueskyDiscoveryHasReview(updated));
        feedbackBtn.classList.toggle('has-feedback', blueskyDiscoveryHasReview(updated));
        feedbackPop.classList.add('hidden');
        notify('Saved BlueSky training feedback');
      });
      actionRow.appendChild(cancelBtn);
      actionRow.appendChild(saveBtn);
      feedbackPop.appendChild(actionRow);
      feedbackWrap.appendChild(feedbackBtn);
      actionsTd.appendChild(copyBtn);
      actionsTd.appendChild(generateBtn);
      actionsTd.appendChild(feedbackWrap);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
      if (!document.body.contains(feedbackPop)) {
        document.body.appendChild(feedbackPop);
      }
    });

    if (repliesTbody) {
      if (!threadReplies.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = 'No thread replies loaded for the current target.';
        tr.appendChild(td);
        repliesTbody.appendChild(tr);
      } else {
        threadReplies.forEach((item) => {
          const tr = document.createElement('tr');
          [
            String(item.author_handle || item.author_display_name || '-'),
            String(item.text || '-'),
            String(item.like_count != null ? item.like_count : '-'),
            String(item.reply_count != null ? item.reply_count : '-'),
            String(item.created_at ? new Date(item.created_at).toLocaleString() : '-'),
          ].forEach((value) => {
            const td = document.createElement('td');
            td.textContent = value || '-';
            tr.appendChild(td);
          });
          repliesTbody.appendChild(tr);
        });
      }
    }
    renderBlueskyDiscoveryBulkActions();
  }

  function renderBlueskyReplyCandidates(result) {
    const tbody = document.getElementById('blueskyReplyCandidatesTable');
    const preview = document.getElementById('blueskyReplyCandidatesPreview');
    const promptSummary = document.getElementById('blueskyReplyPromptSummary');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(result?.replies) ? result.replies : [];
    const sourcePost = result?.post || null;
    const sourceText = String(sourcePost && sourcePost.text || '').trim();
    const trainingContext = String(result?.training_context || '').trim();
    const trainingGuidelines = String(result?.training_guidelines || '').trim();
    if (promptSummary) {
      const contextLoaded = Boolean(trainingContext);
      const guidelinesLoaded = Boolean(trainingGuidelines);
      const contextExcerpt = contextLoaded ? trainingContext.slice(0, 260) : 'No shared training context loaded.';
      const guidelinesExcerpt = guidelinesLoaded ? trainingGuidelines.slice(0, 220) : 'No shared guidelines loaded.';
      promptSummary.innerHTML = '';
      const tCtxLabel = document.createElement('strong');
      tCtxLabel.textContent = 'Training Context: ';
      promptSummary.appendChild(tCtxLabel);
      promptSummary.appendChild(document.createTextNode(contextLoaded ? 'Loaded' : 'Missing'));
      promptSummary.appendChild(document.createElement('br'));
      const tCtxVal = document.createElement('span');
      tCtxVal.textContent = contextExcerpt;
      promptSummary.appendChild(tCtxVal);
      promptSummary.appendChild(document.createElement('br'));
      promptSummary.appendChild(document.createElement('br'));
      
      const gLabel = document.createElement('strong');
      gLabel.textContent = 'Guidelines: ';
      promptSummary.appendChild(gLabel);
      promptSummary.appendChild(document.createTextNode(guidelinesLoaded ? 'Loaded' : 'Missing'));
      promptSummary.appendChild(document.createElement('br'));
      const gVal = document.createElement('span');
      gVal.textContent = guidelinesExcerpt;
      promptSummary.appendChild(gVal);
      promptSummary.classList.toggle('is-missing', !contextLoaded && !guidelinesLoaded);
    }
    const categoryNames = getTrainingConfigNames('youtubeMinerCategoryConfigTable');
    const attributeNames = getTrainingConfigNames('youtubeMinerAttributeConfigTable');
    const approachNames = getTrainingConfigNames('youtubeMinerApproachConfigTable');
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No BlueSky reply candidates generated yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      if (promptSummary && !result) {
        promptSummary.textContent = 'BlueSky reply prompt diagnostics will appear here after generation.';
        promptSummary.classList.remove('is-missing');
      }
      return;
    }
    if (sourceText) {
      const sourceTr = document.createElement('tr');
      sourceTr.className = 'bluesky-reply-source-row';
      const sourceTd = document.createElement('td');
      sourceTd.colSpan = 5;
      const sourceWrap = document.createElement('div');
      sourceWrap.className = 'bluesky-reply-source-card';
      const sourceLabel = document.createElement('div');
      sourceLabel.className = 'bluesky-reply-source-label';
      sourceLabel.textContent = 'Replying To';
      const sourceBody = document.createElement('div');
      sourceBody.className = 'bluesky-reply-source-text';
      sourceBody.textContent = sourceText;
      sourceWrap.appendChild(sourceLabel);
      sourceWrap.appendChild(sourceBody);
      sourceTd.appendChild(sourceWrap);
      sourceTr.appendChild(sourceTd);
      tbody.appendChild(sourceTr);
    }
    rows.forEach((item) => {
      const feedback = readBlueskyReplyFeedback(result, item);
      const tr = document.createElement('tr');
      if (blueskyReplyHasReview(feedback)) tr.classList.add('youtube-miner-row-reviewed');

      const replyTd = document.createElement('td');
      replyTd.textContent = String(item && item.text || '-');
      tr.appendChild(replyTd);

      const toneTd = document.createElement('td');
      toneTd.textContent = String(item && item.tone || '-');
      tr.appendChild(toneTd);

      const whyTd = document.createElement('td');
      whyTd.textContent = String(item && item.why || '-');
      tr.appendChild(whyTd);

      const qualityTd = document.createElement('td');
      const qualitySelect = document.createElement('select');
      qualitySelect.className = 'bluesky-discovery-quality-select';
      makeQualityOptions(feedback.quality).forEach((option) => qualitySelect.appendChild(option));
      qualitySelect.addEventListener('change', () => {
        const updated = saveBlueskyReplyFeedback(result, item, { quality: Number(qualitySelect.value || 0) });
        tr.classList.toggle('youtube-miner-row-reviewed', blueskyReplyHasReview(updated));
        feedbackBtn.classList.toggle('has-feedback', blueskyReplyHasReview(updated));
      });
      qualityTd.appendChild(qualitySelect);
      tr.appendChild(qualityTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'bluesky-discovery-actions-cell';
      const feedbackWrap = document.createElement('div');
      feedbackWrap.className = 'youtube-miner-feedback-wrap';
      feedbackWrap.style.display = 'inline-flex';
      const feedbackBtn = App.makeIconButton('edit', 'Review Reply Feedback', () => {
        document.querySelectorAll('.bluesky-reply-feedback-pop').forEach((node) => {
          if (node !== feedbackPop) node.classList.add('hidden');
        });
        feedbackPop.classList.toggle('hidden');
      }, { primary: true });
      feedbackBtn.classList.add('youtube-miner-feedback-icon');
      if (blueskyReplyHasReview(feedback)) feedbackBtn.classList.add('has-feedback');

      const feedbackPop = document.createElement('div');
      feedbackPop.className = 'youtube-miner-feedback-pop bluesky-reply-feedback-pop hidden';
      const heading = document.createElement('h4');
      heading.textContent = 'Reply Feedback';
      feedbackPop.appendChild(heading);

      const qualityRow = document.createElement('div');
      qualityRow.className = 'form-row';
      const qualityLabel = document.createElement('label');
      qualityLabel.textContent = 'Quality (1-5)';
      const popQuality = document.createElement('select');
      popQuality.appendChild(new Option('0 (unset)', '0'));
      for (let i = 1; i <= 5; i++) popQuality.appendChild(new Option(String(i), String(i)));
      popQuality.value = String(feedback.quality || 0);
      qualityRow.appendChild(qualityLabel);
      qualityRow.appendChild(popQuality);
      feedbackPop.appendChild(qualityRow);

      const catRow = document.createElement('div');
      catRow.className = 'form-row youtube-miner-feedback-factor-row';
      const catLabel = document.createElement('label');
      catLabel.textContent = 'Category (multi-select)';
      const catInput = document.createElement('select');
      catInput.multiple = true;
      catInput.size = 5;
      categoryNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.categories.indexOf(name) !== -1;
        catInput.appendChild(option);
      });
      const catExplain = document.createElement('input');
      catExplain.type = 'text';
      catExplain.placeholder = 'Explain';
      catExplain.value = String(feedback.category_explain || '');
      catRow.appendChild(catLabel);
      catRow.appendChild(catInput);
      catRow.appendChild(catExplain);
      feedbackPop.appendChild(catRow);

      const attrRow = document.createElement('div');
      attrRow.className = 'form-row youtube-miner-feedback-factor-row';
      const attrLabel = document.createElement('label');
      attrLabel.textContent = 'Attributes (multi-select)';
      const attrInput = document.createElement('select');
      attrInput.multiple = true;
      attrInput.size = 5;
      attributeNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.attributes.indexOf(name) !== -1;
        attrInput.appendChild(option);
      });
      const attrExplain = document.createElement('input');
      attrExplain.type = 'text';
      attrExplain.placeholder = 'Explain';
      attrExplain.value = String(feedback.attributes_explain || '');
      attrRow.appendChild(attrLabel);
      attrRow.appendChild(attrInput);
      attrRow.appendChild(attrExplain);
      feedbackPop.appendChild(attrRow);

      const approachRow = document.createElement('div');
      approachRow.className = 'form-row youtube-miner-feedback-factor-row';
      const approachLabel = document.createElement('label');
      approachLabel.textContent = 'Approach (multi-select)';
      const approachInput = document.createElement('select');
      approachInput.multiple = true;
      approachInput.size = 5;
      approachNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.approaches.indexOf(name) !== -1;
        approachInput.appendChild(option);
      });
      const approachExplain = document.createElement('input');
      approachExplain.type = 'text';
      approachExplain.placeholder = 'Explain';
      approachExplain.value = String(feedback.approaches_explain || '');
      approachRow.appendChild(approachLabel);
      approachRow.appendChild(approachInput);
      approachRow.appendChild(approachExplain);
      feedbackPop.appendChild(approachRow);

      const noteRow = document.createElement('div');
      noteRow.className = 'form-row';
      const noteLabel = document.createElement('label');
      noteLabel.textContent = 'What do you like about this comment?';
      const noteInput = document.createElement('textarea');
      noteInput.rows = 8;
      noteInput.placeholder = 'Explain what makes this reply valuable, what signals matter, and what style should be reinforced.';
      noteInput.value = String(feedback.note || '');
      noteRow.appendChild(noteLabel);
      noteRow.appendChild(noteInput);
      feedbackPop.appendChild(noteRow);

      const suggestedRow = document.createElement('div');
      suggestedRow.className = 'form-row';
      const suggestedLabel = document.createElement('label');
      suggestedLabel.textContent = 'Suggested Response';
      const suggestedInput = document.createElement('textarea');
      suggestedInput.rows = 4;
      suggestedInput.placeholder = 'Optional: refine the ideal version of this reply.';
      suggestedInput.value = String(feedback.suggested_response || '');
      suggestedRow.appendChild(suggestedLabel);
      suggestedRow.appendChild(suggestedInput);
      feedbackPop.appendChild(suggestedRow);

      const actionRow = document.createElement('div');
      actionRow.className = 'youtube-miner-feedback-actions';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => feedbackPop.classList.add('hidden'));
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = 'Save Feedback';
      saveBtn.addEventListener('click', () => {
        const selectedCategories = Array.from(catInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const selectedAttributes = Array.from(attrInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const selectedApproaches = Array.from(approachInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const updated = saveBlueskyReplyFeedback(result, item, {
          quality: Number(popQuality.value || 0),
          categories: selectedCategories,
          category_explain: String(catExplain.value || ''),
          attributes: selectedAttributes,
          attributes_explain: String(attrExplain.value || ''),
          approaches: selectedApproaches,
          approaches_explain: String(approachExplain.value || ''),
          note: String(noteInput.value || ''),
          suggested_response: String(suggestedInput.value || ''),
        });
        qualitySelect.value = String(updated.quality || '');
        tr.classList.toggle('youtube-miner-row-reviewed', blueskyReplyHasReview(updated));
        feedbackBtn.classList.toggle('has-feedback', blueskyReplyHasReview(updated));
        feedbackPop.classList.add('hidden');
        notify('BlueSky reply feedback saved');
      });
      actionRow.appendChild(closeBtn);
      actionRow.appendChild(saveBtn);
      feedbackPop.appendChild(actionRow);

      feedbackWrap.appendChild(feedbackBtn);
      feedbackWrap.appendChild(feedbackPop);
      actionsTd.appendChild(feedbackWrap);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function renderRedditDiscoveryTable(result) {
    const tbody = document.getElementById('redditDiscoveryTable');
    const preview = document.getElementById('redditDiscoveryPreview');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';

    lastRedditDiscoveryResult = result || null;
    const rows = Array.isArray(result?.candidates) ? result.candidates : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 9;
      td.textContent = 'No Reddit thread candidates found for the current filters.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement('tr');
      const cols = [
        String(item.discovery_score != null ? item.discovery_score : '-'),
        String(item.subreddit || '-'),
        String(item.title || item.discussion_url || '-'),
        String(item.author || '-'),
        String(item.score != null ? item.score : '-'),
        String(item.num_comments != null ? item.num_comments : '-'),
        String(item.created_at ? new Date(item.created_at).toLocaleString() : '-'),
        Array.isArray(item.reasons) ? item.reasons.join(', ') : '-',
      ];
      cols.forEach((value, idx) => {
        const td = document.createElement('td');
        if (idx === 2 && item.discussion_url) {
          const a = document.createElement('a');
          a.href = item.discussion_url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = value || '-';
          td.appendChild(a);
        } else {
          td.textContent = value || '-';
        }
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const acquireBtn = App.makeIconButton('copy', 'Use In Acquire', () => {
        const acquireTarget = document.getElementById('redditAcquireTarget');
        const discoveryTarget = document.getElementById('redditDiscoveryTarget');
        const replyTarget = document.getElementById('redditReplyTarget');
        const nextValue = String(item.discussion_url || '').trim() || String(item.subreddit ? `https://www.reddit.com/r/${item.subreddit}` : '').trim();
        if (acquireTarget) acquireTarget.value = nextValue;
        if (discoveryTarget && !discoveryTarget.value) discoveryTarget.value = nextValue;
        if (replyTarget) replyTarget.value = nextValue;
        notify('Copied Reddit thread target into acquire form');
      }, { primary: true });
      const replyBtn = App.makeIconButton('messages', 'Generate Replies', async () => {
        const replyTarget = document.getElementById('redditReplyTarget');
        if (replyTarget) replyTarget.value = String(item.discussion_url || '').trim();
        try {
          await runRedditReplyCandidates(String(item.discussion_url || '').trim());
          notify('Reddit reply candidates generated');
        } catch (err) {
          setRedditReplyStatus(err.message || 'Could not generate Reddit replies', true);
          notify(err.message, true);
        }
      }, { marginLeft: '8px' });
      actionsTd.appendChild(acquireBtn);
      actionsTd.appendChild(replyBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function renderRedditReplyCandidates(result) {
    const tbody = document.getElementById('redditReplyCandidatesTable');
    const preview = document.getElementById('redditReplyCandidatesPreview');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(result?.replies) ? result.replies : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'No Reddit reply candidates generated yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((item) => {
      const tr = document.createElement('tr');
      [
        String(item && item.text || '-'),
        String(item && item.tone || '-'),
        String(item && item.why || '-'),
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '-';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function renderXAcquireRunsTable() {
    if (!els.xAcquireRunsTable) return;
    els.xAcquireRunsTable.innerHTML = '';
    const runs = Array.isArray(state.xAcquireRuns) ? state.xAcquireRuns : [];
    if (!runs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No X acquire runs yet.';
      tr.appendChild(td);
      els.xAcquireRunsTable.appendChild(tr);
      return;
    }

    runs.forEach((run) => {
      const tr = document.createElement('tr');
      const cols = [
        String(run.run_id || ''),
        String(run.created_at || ''),
        String(run.query || '').trim() || (Array.isArray(run.hashtags) ? run.hashtags.map((tag) => `#${tag}`).join(' ') : '-'),
        String(run.total_tweets != null ? run.total_tweets : '-'),
        String(run.total_replies != null ? run.total_replies : '-'),
        String(run.errors != null ? run.errors : '-'),
      ];
      cols.forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '-';
        tr.appendChild(td);
      });
      const actionsTd = document.createElement('td');
      const viewBtn = App.makeIconButton('view', 'Load', () => {
        loadXAcquireRun(run.run_id).catch((err) => notify(err.message, true));
      }, { marginRight: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete', async () => {
        if (!confirm(`Delete X run ${run.run_id}?`)) return;
        try {
          await api(`/api/acquire/x-runs/${encodeURIComponent(run.run_id)}`, { method: 'DELETE' });
          state.xAcquireRuns = state.xAcquireRuns.filter((item) => String(item.run_id) !== String(run.run_id));
          if (String(state.xAcquireCurrentRun && state.xAcquireCurrentRun.run_id || '') === String(run.run_id)) {
            state.xAcquireCurrentRun = null;
            renderXAcquireItemsTable();
          }
          renderXAcquireRunsTable();
          notify('X acquire run deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      els.xAcquireRunsTable.appendChild(tr);
    });
  }

  function renderRedditAcquireRunsTable() {
    if (!els.redditAcquireRunsTable) return;
    els.redditAcquireRunsTable.innerHTML = '';
    const runs = Array.isArray(state.redditAcquireRuns) ? state.redditAcquireRuns : [];
    if (!runs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No Reddit acquire runs yet.';
      tr.appendChild(td);
      els.redditAcquireRunsTable.appendChild(tr);
      return;
    }

    runs.forEach((run) => {
      const tr = document.createElement('tr');
      const cols = [
        String(run.run_id || ''),
        String(run.created_at || ''),
        String(run.mode || ''),
        String(run.subreddit || run.target || ''),
        String(run.total_posts != null ? run.total_posts : '-'),
        String(run.total_comments != null ? run.total_comments : '-'),
      ];
      cols.forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '-';
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const viewBtn = App.makeIconButton('view', 'Load', () => {
        loadRedditAcquireRun(run.run_id).catch((err) => notify(err.message, true));
      }, { marginRight: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete', async () => {
        if (!confirm(`Delete Reddit run ${run.run_id}?`)) return;
        try {
          await api(`/api/acquire/reddit-runs/${encodeURIComponent(run.run_id)}`, { method: 'DELETE' });
          state.redditAcquireRuns = state.redditAcquireRuns.filter((item) => String(item.run_id) !== String(run.run_id));
          if (String(state.redditAcquireCurrentRun && state.redditAcquireCurrentRun.run_id || '') === String(run.run_id)) {
            state.redditAcquireCurrentRun = null;
            renderRedditAcquireItemsTable();
          }
          renderRedditAcquireRunsTable();
          notify('Reddit acquire run deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      els.redditAcquireRunsTable.appendChild(tr);
    });
  }

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  async function refreshAcquireJobs() {
    if (!els.acquireJobsTable) return;
    const res = await api('/api/acquire/jobs?limit=200');
    const fetched = Array.isArray(res.jobs) ? res.jobs : [];
    const byId = new Map();
    state.acquireJobs.forEach((j) => { if (j?.id) byId.set(String(j.id), j); });
    fetched.forEach((j) => {
      if (!j?.id) return;
      byId.set(String(j.id), { ...(byId.get(String(j.id)) || {}), ...j });
    });
    state.acquireJobs = Array.from(byId.values())
      .sort((a, b) => String(b.updated_at||'').localeCompare(String(a.updated_at||'')))
      .slice(0, 200);
    renderAcquireJobsTable();
  }

  async function refreshDirectAcquireRuns() {
    if (!els.directAcquireRunsTable) return;
    const res = await api('/api/acquire/direct-runs?limit=20');
    state.directAcquireRuns = Array.isArray(res.runs) ? res.runs : [];
    renderDirectAcquireRunsTable();
  }

  async function refreshXAcquireRuns() {
    if (!els.xAcquireRunsTable) return;
    const res = await api('/api/acquire/x-runs?limit=50');
    state.xAcquireRuns = Array.isArray(res.runs) ? res.runs : [];
    renderXAcquireRunsTable();
  }

  async function refreshRedditAcquireRuns() {
    if (!els.redditAcquireRunsTable) return;
    const res = await api('/api/acquire/reddit-runs?limit=50');
    state.redditAcquireRuns = Array.isArray(res.runs) ? res.runs : [];
    renderRedditAcquireRunsTable();
  }

  async function runRedditDiscovery() {
    const form = document.getElementById('redditDiscoveryForm');
    if (!form) return;
    const formData = new FormData(form);
    const payload = {
      target: String(formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      sort: String(formData.get('sort') || 'new').trim().toLowerCase(),
      max_posts: Number(formData.get('max_posts') || 20) || 20,
      keyword: String(formData.get('keyword') || '').trim(),
      min_score: Number(formData.get('min_score') || 0) || 0,
      min_comments: Number(formData.get('min_comments') || 0) || 0,
      start_time: String(formData.get('start_time') || '').trim(),
      end_time: String(formData.get('end_time') || '').trim(),
    };
    if (!payload.target) throw new Error('Subreddit or post URL is required.');
    setRedditDiscoveryStatus('Discovering Reddit threads...');
    const res = await api('/api/engage/reddit/discovery', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderRedditDiscoveryTable(res);
    const count = Array.isArray(res.candidates) ? res.candidates.length : 0;
    setRedditDiscoveryStatus(`Loaded ${count} Reddit thread candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function runRedditReplyCandidates(explicitTarget) {
    const form = document.getElementById('redditReplyCandidatesForm');
    if (!form) return null;
    const formData = new FormData(form);
    const payload = {
      target: String(explicitTarget || formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      comment_limit: Number(formData.get('comment_limit') || 8) || 8,
    };
    if (!payload.target) throw new Error('Reddit thread URL is required.');
    setRedditReplyStatus('Generating Reddit reply candidates...');
    const res = await api('/api/engage/reddit/reply-candidates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderRedditReplyCandidates(res);
    const count = Array.isArray(res.replies) ? res.replies.length : 0;
    setRedditReplyStatus(`Generated ${count} Reddit reply candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function runBlueskyDiscovery() {
    const form = document.getElementById('blueskyDiscoveryForm');
    if (!form) return null;
    const formData = new FormData(form);
    const payload = {
      target: String(formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      sort: String(formData.get('sort') || 'new').trim().toLowerCase(),
      max_posts: Number(formData.get('max_posts') || 20) || 20,
      keyword: String(formData.get('keyword') || '').trim(),
      min_likes: Number(formData.get('min_likes') || 0) || 0,
      min_replies: Number(formData.get('min_replies') || 0) || 0,
      start_time: String(formData.get('start_time') || '').trim(),
      end_time: String(formData.get('end_time') || '').trim(),
    };
    if (!payload.target) throw new Error('Handle, feed, or BlueSky post URL is required.');
    setBlueskyDiscoveryStatus('Discovering BlueSky posts...');
    const res = await api('/api/engage/bluesky/discovery', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderBlueskyDiscoveryTable(res);
    const count = Array.isArray(res.candidates) ? res.candidates.length : 0;
    setBlueskyDiscoveryStatus(`Loaded ${count} BlueSky post candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function runBlueskyReplyCandidates(explicitTarget) {
    const form = document.getElementById('blueskyReplyCandidatesForm');
    if (!form) return null;
    const formData = new FormData(form);
    const trainingPayload = await getSharedTrainingPromptPayload();
    const payload = {
      target: String(explicitTarget || formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      context_limit: Number(formData.get('context_limit') || 8) || 8,
      training_context: String(trainingPayload.training_context || '').trim(),
      training_guidelines: String(trainingPayload.training_guidelines || '').trim(),
    };
    if (!payload.target) throw new Error('BlueSky post URL is required.');
    setBlueskyReplyStatus('Generating BlueSky reply candidates...');
    const res = await api('/api/engage/bluesky/reply-candidates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderBlueskyReplyCandidates(res);
    const count = Array.isArray(res.replies) ? res.replies.length : 0;
    setBlueskyReplyStatus(`Generated ${count} BlueSky reply candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function loadDirectAcquireRun(runId) {
    const res = await api(`/api/acquire/direct-runs/${encodeURIComponent(runId)}`);
    state.directAcquireCurrentRun = res.run || null;
    directAcquireSelectedImages = new Set();
    directAcquireImageCategoryByUrl = new Map();
    directAcquireImagesExpanded = false;
    directAcquireSelectedHashtags = new Set();
    directAcquireSelectedKeywords = new Set();
    renderDirectAcquirePagesTable();
  }

  async function loadXAcquireRun(runId) {
    const res = await api(`/api/acquire/x-runs/${encodeURIComponent(runId)}`);
    state.xAcquireCurrentRun = res.run || null;
    renderXAcquireItemsTable();
  }

  async function loadRedditAcquireRun(runId) {
    const res = await api(`/api/acquire/reddit-runs/${encodeURIComponent(runId)}`);
    state.redditAcquireCurrentRun = res.run || null;
    renderRedditAcquireItemsTable();
  }

  // -------------------------------------------------------------------------
  // OpenClaw actions
  // -------------------------------------------------------------------------

  async function runAcquireRowAction(action, job) {
    const jobId = String(job?.id || '').trim();
    if (!jobId) { notify('job_id is required', true); return; }
    try {
      state.acquireBusyByJob[jobId] = true;
      renderAcquireJobsTable();
      const request = {
        manual_confirmed: true,
        job_id: jobId,
        role: (action === 'approve_job' || action === 'execute_job') ? 'approver'
            : action === 'preview_job' ? 'marketer' : 'operator'
      };
      if (action === 'approve_job') request.decision = 'APPROVE';
      if (action === 'execute_job') {
        let token = String(els.acquireApprovalTokenInput?.value || '').trim();
        if (!token) token = String(prompt('Enter approval token for execute_job') || '').trim();
        if (!token) throw new Error('approval_token is required for execute_job');
        request.approval_token = token;
        if (els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = token;
      }
      const response = await api(`/api/openclaw/${action}`, { method: 'POST', body: JSON.stringify(request) });
      setPreview(els.acquireRequestPreview, { action, request });
      setPreview(els.acquireResponsePreview, response);
      const derived = deriveAcquireJobFromResponse({ action, request }, response);
      if (derived) upsertAcquireJobState(derived);
      renderAcquireJobsTable();
      await refreshAcquireJobs();
      const approvalToken = response?.result?.approval?.approval_token;
      if (approvalToken && els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = approvalToken;
      notify(`Acquire ${action} request sent`);
    } catch (err) {
      notify(err.message, true);
    } finally {
      delete state.acquireBusyByJob[jobId];
      renderAcquireJobsTable();
    }
  }

  async function runAcquireRowSequence(job) {
    const jobId = String(job?.id || '').trim();
    if (!jobId) { notify('job_id is required', true); return; }
    try {
      state.acquireBusyByJob[jobId] = true;
      renderAcquireJobsTable();

      const previewReq = { manual_confirmed: true, job_id: jobId, role: 'marketer' };
      const previewRes = await api('/api/openclaw/preview_job', { method: 'POST', body: JSON.stringify(previewReq) });
      setPreview(els.acquireRequestPreview, { action: 'preview_job', request: previewReq });
      setPreview(els.acquireResponsePreview, previewRes);

      const approveReq = { manual_confirmed: true, job_id: jobId, decision: 'APPROVE', role: 'approver' };
      const approveRes = await api('/api/openclaw/approve_job', { method: 'POST', body: JSON.stringify(approveReq) });
      setPreview(els.acquireRequestPreview, { action: 'approve_job', request: approveReq });
      setPreview(els.acquireResponsePreview, approveRes);

      const approvalToken = String(approveRes?.result?.approval?.approval_token || '').trim();
      if (!approvalToken) throw new Error('No approval token returned from approve_job');
      if (els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = approvalToken;

      const executeReq = { manual_confirmed: true, job_id: jobId, approval_token: approvalToken, role: 'approver' };
      const executeRes = await api('/api/openclaw/execute_job', { method: 'POST', body: JSON.stringify(executeReq) });
      setPreview(els.acquireRequestPreview, { action: 'execute_job', request: executeReq });
      setPreview(els.acquireResponsePreview, executeRes);

      const derived = deriveAcquireJobFromResponse({ action: 'execute_job', request: executeReq }, executeRes);
      if (derived) upsertAcquireJobState(derived);
      renderAcquireJobsTable();
      await refreshAcquireJobs();
      notify(`Acquire run completed for ${jobId}`);
    } catch (err) {
      notify(err.message, true);
    } finally {
      delete state.acquireBusyByJob[jobId];
      renderAcquireJobsTable();
    }
  }

  // -------------------------------------------------------------------------
  // Request builders
  // -------------------------------------------------------------------------

  function parseSourceUrls(raw) {
    return String(raw || '').split('\n').map((l) => l.trim()).filter(Boolean);
  }

  function buildAcquireRequest(formData) {
    const action = String(formData.get('action') || 'create_job');
    if (formData.get('manual_confirmed') !== 'on') throw new Error('Manual confirmation is required');
    const jobId = String(formData.get('job_id') || '').trim();
    const request = {
      manual_confirmed: true,
      role: (action === 'approve_job' || action === 'execute_job') ? 'approver'
          : action === 'preview_job' ? 'marketer' : 'operator'
    };
    if (action === 'create_job') {
      request.type = String(formData.get('type') || '').trim() || 'acquire.web';
      request.workspace_id = String(formData.get('workspace_id') || '').trim() || 'alphire-main';
      request.requested_by = {
        user_id: String(formData.get('requested_by_user_id') || '').trim() || 'alphire-ui',
        email: String(formData.get('requested_by_email') || '').trim() || 'ops@alphire.ai'
      };
      request.payload = {
        source_urls: parseSourceUrls(formData.get('source_urls')),
        max_pages: Number(formData.get('max_pages') || 5),
        body_snippet_chars: Number(formData.get('body_snippet_chars') || 500)
      };
      request.policy = { requires_manual_approval: true, approval_ttl_minutes: 30 };
      return { action, request };
    }
    if (!jobId) throw new Error('job_id is required for this action');
    request.job_id = jobId;
    if (action === 'preview_job') return { action, request };
    if (action === 'approve_job') {
      request.decision = String(formData.get('approval_decision') || 'APPROVE').trim() || 'APPROVE';
      return { action, request };
    }
    if (action === 'execute_job') {
      const token = String(formData.get('approval_token') || '').trim();
      if (!token) throw new Error('approval_token is required for execute_job');
      request.approval_token = token;
      return { action, request };
    }
    if (action === 'job_status') return { action, request };
    throw new Error('Unsupported action');
  }

  // -------------------------------------------------------------------------
  // Event binding
  // -------------------------------------------------------------------------

  function init() {
    setDirectAcquireResultsVisible(false);
    
    // Begin: Theme Builder DOM Projection Pattern
    if (App.develop && typeof App.develop.buildModularPageTemplatePreviewMarkup === 'function') {
      const STORAGE_KEY = 'alphire:acquire-hub:layout';
      let payload;
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          payload = JSON.parse(saved);
          if (payload && payload.layoutSections && (payload.layoutSections[0]?.modules?.[0]?.type === 'system-app' || payload.layoutSections.length === 1)) {
            payload = null;
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (err) {}
      if (!payload || !payload.layoutSections || payload.layoutSections[0]?.modules?.[0]?.type === 'system-app' || payload.layoutSections.length === 1) {
        payload = {
          layoutSections: [
            {
              layout: '3-3', title: 'Row 1', collapsed: false,
              modules: [
                { type: 'pod', column: 'col1', settings: { title: 'Web Domain', description: 'Automated crawler fetching external site content.', logoUrl: '/images/logos/web.svg', targetPage: 'acquireWebPage' } },
                { type: 'pod', column: 'col2', settings: { title: 'YouTube', description: 'Video indexing and transcript mining tools.', logoUrl: '/images/logos/youtube.svg', targetPage: 'acquireYoutubePage' } }
              ]
            },
            {
              layout: '3-3', title: 'Row 2', collapsed: false,
              modules: [
                { type: 'pod', column: 'col1', settings: { title: 'BlueSky', description: 'Rapid decentralised feed monitoring.', logoUrl: '/images/logos/bluesky.svg', targetPage: 'acquireBlueskyPage' } },
                { type: 'pod', column: 'col2', settings: { title: 'Instagram', description: 'Basic meta ingestion via official endpoints.', logoUrl: '/images/logos/instagram.svg', targetPage: 'acquireInstagramPage' } }
              ]
            },
            {
              layout: '3-3', title: 'Row 3', collapsed: false,
              modules: [
                { type: 'pod', column: 'col1', settings: { title: 'TikTok', description: 'Short-form video discovery and trending topic extraction.', logoUrl: '/images/logos/tiktok.svg', targetPage: 'acquireTiktokPage' } },
                { type: 'pod', column: 'col2', settings: { title: 'Facebook', description: 'Group and page interaction ingestion and analysis.', logoUrl: '/images/logos/facebook.svg', targetPage: 'acquireFacebookPage' } }
              ]
            },
            {
              layout: '3-3', title: 'Row 4', collapsed: false,
              modules: [
                { type: 'pod', column: 'col1', settings: { title: 'X (Twitter)', description: 'Real-time microblog monitoring and sentiment tracking.', logoUrl: '/images/logos/x.svg', targetPage: 'acquireXPage' } },
                { type: 'pod', column: 'col2', settings: { title: 'Quora', description: 'Question and answer platform scraping for niche expertise.', logoUrl: '/images/logos/quora.svg', targetPage: 'acquireQuoraPage' } }
              ]
            },
            {
              layout: '3-3', title: 'Row 5', collapsed: false,
              modules: [
                { type: 'pod', column: 'col1', settings: { title: 'Substack', description: 'Long-form newsletter ingestion and audience analysis.', logoUrl: '/images/logos/substack.svg', targetPage: 'acquireSubstackPage' } },
                { type: 'pod', column: 'col2', settings: { title: 'Medium', description: 'Article extraction and topic clustering for written content.', logoUrl: '/images/logos/medium.svg', targetPage: 'acquireMediumPage' } }
              ]
            }
          ]
        };
      }
      
      const targetWrap = document.getElementById('acquirePage');
      if (targetWrap && !targetWrap.dataset.builderHydrated) {
        const heading = targetWrap.querySelector('.page-heading-row');
        const hubBody = targetWrap.querySelector('#acquireHubBody');
        
        targetWrap.textContent = '';
        const parser = new DOMParser();
        const doc = parser.parseFromString(App.develop.buildModularPageTemplatePreviewMarkup(payload), 'text/html');
        Array.from(doc.body.childNodes).forEach(node => targetWrap.appendChild(node.cloneNode(true)));
        
        if (heading) {
          targetWrap.insertBefore(heading, targetWrap.firstChild);
        }
        
        const mHub = targetWrap.querySelector('#mount-acquire-hub-panel');
        if (mHub && hubBody) mHub.appendChild(hubBody);
        
        targetWrap.dataset.builderHydrated = 'true';
      }
    }
    // End Theme Builder Integration

    const acquirePageActions = document.getElementById('acquirePageActions');
    if (acquirePageActions && !acquirePageActions.dataset.bound) {
      acquirePageActions.dataset.bound = 'true';
      acquirePageActions.innerHTML = '';
      
      if (App.develop && typeof App.develop.openModularPageTemplateEditor === 'function') {
        const editBtn = App.makeIconButton('edit', 'Edit Hub UI', function () {
          const STORAGE_KEY = 'alphire:acquire-hub:layout';
          let payload;
          try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) payload = JSON.parse(saved);
          } catch (err) {}
          if (!payload || !payload.layoutSections || payload.layoutSections[0]?.modules?.[0]?.type === 'system-app' || payload.layoutSections.length === 1) {
            payload = {
              layoutSections: [
                {
                  layout: '3-3', title: 'Row 1', collapsed: false,
                  modules: [
                    { type: 'pod', column: 'col1', settings: { title: 'Web Domain', description: 'Automated crawler fetching external site content.', logoUrl: '/images/logos/web.svg', targetPage: 'acquireWebPage' } },
                    { type: 'pod', column: 'col2', settings: { title: 'YouTube', description: 'Video indexing and transcript mining tools.', logoUrl: '/images/logos/youtube.svg', targetPage: 'acquireYoutubePage' } }
                  ]
                },
                {
                  layout: '3-3', title: 'Row 2', collapsed: false,
                  modules: [
                    { type: 'pod', column: 'col1', settings: { title: 'BlueSky', description: 'Rapid decentralised feed monitoring.', logoUrl: '/images/logos/bluesky.svg', targetPage: 'acquireBlueskyPage' } },
                    { type: 'pod', column: 'col2', settings: { title: 'Instagram', description: 'Basic meta ingestion via official endpoints.', logoUrl: '/images/logos/instagram.svg', targetPage: 'acquireInstagramPage' } }
                  ]
                },
                {
                  layout: '3-3', title: 'Row 3', collapsed: false,
                  modules: [
                    { type: 'pod', column: 'col1', settings: { title: 'TikTok', description: 'Short-form video discovery and trending topic extraction.', logoUrl: '/images/logos/tiktok.svg', targetPage: 'acquireTiktokPage' } },
                    { type: 'pod', column: 'col2', settings: { title: 'Facebook', description: 'Group and page interaction ingestion and analysis.', logoUrl: '/images/logos/facebook.svg', targetPage: 'acquireFacebookPage' } }
                  ]
                },
                {
                  layout: '3-3', title: 'Row 4', collapsed: false,
                  modules: [
                    { type: 'pod', column: 'col1', settings: { title: 'X (Twitter)', description: 'Real-time microblog monitoring and sentiment tracking.', logoUrl: '/images/logos/x.svg', targetPage: 'acquireXPage' } },
                    { type: 'pod', column: 'col2', settings: { title: 'Quora', description: 'Question and answer platform scraping for niche expertise.', logoUrl: '/images/logos/quora.svg', targetPage: 'acquireQuoraPage' } }
                  ]
                },
                {
                  layout: '3-3', title: 'Row 5', collapsed: false,
                  modules: [
                    { type: 'pod', column: 'col1', settings: { title: 'Substack', description: 'Long-form newsletter ingestion and audience analysis.', logoUrl: '/images/logos/substack.svg', targetPage: 'acquireSubstackPage' } },
                    { type: 'pod', column: 'col2', settings: { title: 'Medium', description: 'Article extraction and topic clustering for written content.', logoUrl: '/images/logos/medium.svg', targetPage: 'acquireMediumPage' } }
                  ]
                }
              ]
            };
          }

          App.develop.openModularPageTemplateEditor(payload, {
            mode: 'template',
            targetPage: 'developTemplatesPage',
            onClose: () => { App.setActivePage('acquirePage'); },
            onSave: (newPayload) => {
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(newPayload));
                App.notify('Acquire Hub layout saved locally. Refresh required.', false);
                setTimeout(() => window.location.reload(), 800);
              } catch (e) {
                App.notify('Could not save local config', true);
              }
            }
          });
        });
        acquirePageActions.appendChild(editBtn);
      }
      
      const settingsBtn = App.makeIconButton('settings', 'Acquire Settings', function () {
        App.setActivePage('acquireSettingsPage');
      });
      settingsBtn.classList.add('section-settings-gear-btn');
      acquirePageActions.appendChild(settingsBtn);
    }
    const acquireSettingsBackBtn = document.getElementById('acquireSettingsBackBtn');
    if (acquireSettingsBackBtn && !acquireSettingsBackBtn.dataset.bound) {
      acquireSettingsBackBtn.dataset.bound = 'true';
      acquireSettingsBackBtn.addEventListener('click', function () {
        App.setActivePage('acquirePage');
      });
    }
    const acquireYoutubeBanReasonForm = document.getElementById('acquireYoutubeBanReasonForm');
    if (acquireYoutubeBanReasonForm && !acquireYoutubeBanReasonForm.dataset.bound) {
      acquireYoutubeBanReasonForm.dataset.bound = 'true';
      acquireYoutubeBanReasonForm.addEventListener('submit', function (event) {
        event.preventDefault();
        const input = document.getElementById('acquireYoutubeBanReasonInput');
        const value = normalizeAcquireSettingLabel(input && input.value);
        if (!value) {
          notify('Enter a ban reason first.', true);
          return;
        }
        const current = getAcquireYoutubeBanReasons();
        if (current.some((item) => item.toLowerCase() === value.toLowerCase())) {
          notify('That ban reason already exists.', true);
          return;
        }
        writeAcquireSettings({ youtubeBanReasons: current.concat(value) });
        if (input) input.value = '';
        renderAcquireSettingsPage();
        notify('Ban reason added');
      });
    }
    const acquireWebsiteDefaultsForm = document.getElementById('acquireWebsiteDefaultsForm');
    if (acquireWebsiteDefaultsForm && !acquireWebsiteDefaultsForm.dataset.bound) {
      acquireWebsiteDefaultsForm.dataset.bound = 'true';
      acquireWebsiteDefaultsForm.addEventListener('submit', function (event) {
        event.preventDefault();
        const nextDefaults = {
          acquireSocial: Boolean(document.getElementById('acquireSettingsAcquireSocial')?.checked),
          acquireKeywords: Boolean(document.getElementById('acquireSettingsAcquireKeywords')?.checked),
          acquireHashtags: Boolean(document.getElementById('acquireSettingsAcquireHashtags')?.checked),
          acquireImages: Boolean(document.getElementById('acquireSettingsAcquireImages')?.checked),
          acquirePages: Boolean(document.getElementById('acquireSettingsAcquirePages')?.checked),
          acquirePeerSites: Boolean(document.getElementById('acquireSettingsAcquirePeerSites')?.checked),
          maxPages: Number(document.getElementById('acquireSettingsMaxPages')?.value || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.maxPages) || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.maxPages,
          peerSitesLimit: Number(document.getElementById('acquireSettingsPeerSitesLimit')?.value || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.peerSitesLimit) || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.peerSitesLimit,
          imagesLimit: Number(document.getElementById('acquireSettingsImagesLimit')?.value || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.imagesLimit) || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.imagesLimit,
          snippetLength: Number(document.getElementById('acquireSettingsSnippetLength')?.value || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.snippetLength) || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.snippetLength,
        };
        writeAcquireSettings({ websiteDefaults: nextDefaults });
        renderAcquireSettingsPage();
        applyAcquireWebsiteDefaultsToForm();
        notify('Website defaults saved');
      });
    }
    renderAcquireSettingsPage();
    applyAcquireWebsiteDefaultsToForm();
    renderDirectAcquireContactTable();
    renderDirectAcquireKeywordTable();
    renderDirectAcquireHashtagTable();
    renderDirectAcquirePeerSitesTable();
    renderDirectAcquireImageGallery();
    renderDirectAcquireWebsitePeersTable();
    resetDirectAcquireWebsitePeerForm();
    refreshDirectAcquireTopics().then(() => renderDirectAcquireKeywordTopicOptions()).catch(() => {});
    refreshDirectAcquireImageCategories().then(() => renderDirectAcquireImageGallery()).catch(() => {});
    refreshDirectAcquireWebsitePeers().catch(() => {});
    if (String(App.state?.activePage || '') === 'acquireWebPage') {
      hydrateAcquireWebPage({ scrollToResults: false }).catch(() => {});
    }
    const directAcquireUrlInput = document.getElementById('directAcquireUrlInput');
    if (directAcquireUrlInput && !directAcquireUrlInput.dataset.bound) {
      directAcquireUrlInput.dataset.bound = '1';
      let urlHydrateTimer = null;
      const scheduleUrlHydrate = () => {
        if (getAcquireWebWebsiteRole() !== 'project') return;
        if (urlHydrateTimer) clearTimeout(urlHydrateTimer);
        urlHydrateTimer = setTimeout(() => {
          const sourceUrl = String(directAcquireUrlInput.value || directAcquireProjectSourceUrl || '').trim();
          if (sourceUrl) directAcquireProjectSourceUrl = sourceUrl;
          loadLatestDirectAcquireRunForSourceUrl(sourceUrl)
            .then((loaded) => {
              const advancedPanel = document.getElementById('directAcquireAdvancedPanel');
              if (loaded && advancedPanel) advancedPanel.open = false;
            })
            .catch(() => {});
        }, 350);
      };
      directAcquireUrlInput.addEventListener('change', scheduleUrlHydrate);
      directAcquireUrlInput.addEventListener('blur', scheduleUrlHydrate);
    }
    const directAcquireWebsiteRoleSelect = document.getElementById('directAcquireWebsiteRoleSelect');
    if (directAcquireWebsiteRoleSelect && !directAcquireWebsiteRoleSelect.dataset.bound) {
      directAcquireWebsiteRoleSelect.dataset.bound = '1';
      directAcquireWebsiteRoleSelect.addEventListener('change', async () => {
        applyAcquireWebWebsiteRoleUi();
        if (getAcquireWebWebsiteRole() === 'project') {
          const urlInput = document.getElementById('directAcquireUrlInput');
          if (urlInput && directAcquireProjectSourceUrl) urlInput.value = directAcquireProjectSourceUrl;
          if (directAcquireProjectSourceUrl) {
            await loadLatestDirectAcquireRunForSourceUrl(directAcquireProjectSourceUrl);
          }
        }
      });
    }
    const directAcquireDiscoverPeersBtn = document.getElementById('directAcquireDiscoverPeersBtn');
    if (directAcquireDiscoverPeersBtn && !directAcquireDiscoverPeersBtn.dataset.bound) {
      directAcquireDiscoverPeersBtn.dataset.bound = '1';
      directAcquireDiscoverPeersBtn.addEventListener('click', async () => {
        try {
          await discoverAcquireWebPeers();
        } catch (err) {
          notify(err.message || 'Could not discover peers', true);
        }
      });
    }
    const directAcquireAddReferenceBtn = document.getElementById('directAcquireAddReferenceBtn');
    if (directAcquireAddReferenceBtn && !directAcquireAddReferenceBtn.dataset.bound) {
      directAcquireAddReferenceBtn.dataset.bound = '1';
      directAcquireAddReferenceBtn.addEventListener('click', async () => {
        try {
          await addAcquireWebReferenceFromForm();
        } catch (err) {
          notify(err.message || 'Could not add reference website', true);
        }
      });
    }
    const directAcquirePeerDiscoverySaveBtn = document.getElementById('directAcquirePeerDiscoverySaveBtn');
    if (directAcquirePeerDiscoverySaveBtn && !directAcquirePeerDiscoverySaveBtn.dataset.bound) {
      directAcquirePeerDiscoverySaveBtn.dataset.bound = '1';
      directAcquirePeerDiscoverySaveBtn.addEventListener('click', async () => {
        try {
          await saveSelectedAcquireWebPeers();
        } catch (err) {
          notify(err.message || 'Could not save discovered peers', true);
        }
      });
    }
    const directAcquirePeerDiscoverySelectAll = document.getElementById('directAcquirePeerDiscoverySelectAll');
    if (directAcquirePeerDiscoverySelectAll && !directAcquirePeerDiscoverySelectAll.dataset.bound) {
      directAcquirePeerDiscoverySelectAll.dataset.bound = '1';
      directAcquirePeerDiscoverySelectAll.addEventListener('change', function () {
        const checked = !!directAcquirePeerDiscoverySelectAll.checked;
        directAcquirePeerDiscoveryResults = directAcquirePeerDiscoveryResults.map((item) => ({
          ...item,
          selected: checked,
        }));
        renderDirectAcquirePeerDiscoveryResults();
      });
    }
    populateAcquireWebReferenceModelSelect();
    const directAcquireKeywordExclusionsInput = document.getElementById('directAcquireKeywordExclusionsInput');
    if (directAcquireKeywordExclusionsInput) {
      try {
        directAcquireKeywordExclusionsInput.value = String(window.localStorage.getItem(DIRECT_ACQUIRE_KEYWORD_EXCLUSIONS_KEY) || '').trim();
      } catch (_) {
        // ignore local storage failures
      }
      directAcquireKeywordExclusionsInput.addEventListener('change', function () {
        try {
          window.localStorage.setItem(DIRECT_ACQUIRE_KEYWORD_EXCLUSIONS_KEY, String(directAcquireKeywordExclusionsInput.value || '').trim());
        } catch (_) {
          // ignore local storage failures
        }
        renderDirectAcquireKeywordTable();
      });
    }
    const directAcquireKeywordSelectAll = document.getElementById('directAcquireKeywordSelectAll');
    if (directAcquireKeywordSelectAll) {
      directAcquireKeywordSelectAll.addEventListener('change', function () {
        const run = state.directAcquireCurrentRun;
        const keywordLabels = Array.isArray(run?.keyword_labels)
          ? run.keyword_labels.map(([keyword]) => String(keyword || '').trim()).filter(Boolean)
          : [];
        if (directAcquireKeywordSelectAll.checked) {
          keywordLabels.forEach((keyword) => directAcquireSelectedKeywords.add(keyword));
        } else {
          directAcquireSelectedKeywords.clear();
        }
        renderDirectAcquireKeywordTable();
      });
    }
    const directAcquireKeywordBulkTopics = document.getElementById('directAcquireKeywordTopicsDropdown');
    const directAcquireKeywordBulkReason = document.getElementById('directAcquireKeywordBulkReason');
    if (directAcquireKeywordBulkTopics) {
      directAcquireKeywordBulkTopics.addEventListener('change', async function (event) {
        const changedInput = event.target;
        if (!changedInput || changedInput.type !== 'checkbox' || !changedInput.dataset.topic) return;
        if (!directAcquireSelectedKeywords.size) {
          notify('Check at least one keyword first', true);
          changedInput.checked = !changedInput.checked;
          return;
        }
        const chosenTopics = Array.from(directAcquireKeywordBulkTopics.querySelectorAll('input[type="checkbox"][data-topic]:checked'))
          .map((input) => String(input.value || '').trim())
          .filter(Boolean);
        const topicMap = readDirectAcquireKeywordTopics();
        directAcquireSelectedKeywords.forEach((keyword) => {
          const normalized = normalizeDirectAcquireKeyword(keyword);
          if (!normalized) return;
          topicMap[normalized] = chosenTopics;
        });
        writeDirectAcquireKeywordTopics(topicMap);
        renderDirectAcquireKeywordTopicOptions();
        renderDirectAcquireKeywordTable();
        const count = directAcquireSelectedKeywords.size;
        const noun = count === 1 ? 'keyword' : 'keywords';
        notify(`Updated topics for ${count} ${noun}`);
        directAcquireKeywordBulkTopics.removeAttribute('open');
      });
    }
    const directAcquireSaveKeywordsBtn = document.getElementById('directAcquireSaveKeywordsBtn');
    if (directAcquireSaveKeywordsBtn) {
      directAcquireSaveKeywordsBtn.addEventListener('click', async () => {
        try {
          await saveDirectAcquireSelectedKeywords();
        } catch (err) {
          notify(err.message || 'Could not save selected keywords', true);
        }
      });
    }
    if (directAcquireKeywordBulkReason) {
      directAcquireKeywordBulkReason.addEventListener('change', function () {
        const reason = String(directAcquireKeywordBulkReason.value || '').trim();
        directAcquireKeywordBulkReason.value = '';
        if (!reason) return;
        if (!directAcquireSelectedKeywords.size) {
          notify('Check at least one keyword first', true);
          return;
        }
        const count = applyBulkKeywordExclusion(reason);
        const noun = count === 1 ? 'keyword' : 'keywords';
        notify(`Excluded ${count} ${noun}`);
      });
    }
    const directAcquireHashtagSelectAll = document.getElementById('directAcquireHashtagSelectAll');
    if (directAcquireHashtagSelectAll) {
      directAcquireHashtagSelectAll.addEventListener('change', function () {
        const hashtags = filterDirectAcquireHashtagRows(state.directAcquireCurrentRun?.hashtag_summary?.hashtags);
        hashtags.forEach((item) => {
          const hashtag = String(item?.hashtag || '').trim();
          if (!hashtag) return;
          if (directAcquireHashtagSelectAll.checked) directAcquireSelectedHashtags.add(hashtag);
          else directAcquireSelectedHashtags.delete(hashtag);
        });
        renderDirectAcquireHashtagTable();
      });
    }
    const directAcquireSaveHashtagsBtn = document.getElementById('directAcquireSaveHashtagsBtn');
    if (directAcquireSaveHashtagsBtn) {
      directAcquireSaveHashtagsBtn.addEventListener('click', async () => {
        try {
          await saveDirectAcquireSelectedHashtags();
        } catch (err) {
          notify(err.message || 'Could not save selected hashtags', true);
        }
      });
    }
    const directAcquireImageSelectAll = document.getElementById('directAcquireImageSelectAll');
    if (directAcquireImageSelectAll) {
      directAcquireImageSelectAll.addEventListener('change', function () {
        const images = Array.isArray(state.directAcquireCurrentRun?.image_summary?.images) ? state.directAcquireCurrentRun.image_summary.images : [];
        const visible = (directAcquireImagesExpanded ? images : images.slice(0, 24))
          .map((item) => String(item?.url || '').trim())
          .filter(Boolean);
        visible.forEach((url) => {
          if (directAcquireImageSelectAll.checked) directAcquireSelectedImages.add(url);
          else directAcquireSelectedImages.delete(url);
        });
        renderDirectAcquireImageGallery();
      });
    }
    const directAcquireImagesSeeMoreBtn = document.getElementById('directAcquireImagesSeeMoreBtn');
    if (directAcquireImagesSeeMoreBtn) {
      directAcquireImagesSeeMoreBtn.addEventListener('click', function () {
        directAcquireImagesExpanded = !directAcquireImagesExpanded;
        renderDirectAcquireImageGallery();
      });
    }
    const directAcquireApplyImageCategoryBtn = document.getElementById('directAcquireApplyImageCategoryBtn');
    const directAcquireImageBulkCategory = document.getElementById('directAcquireImageBulkCategory');
    if (directAcquireApplyImageCategoryBtn && directAcquireImageBulkCategory) {
      directAcquireApplyImageCategoryBtn.addEventListener('click', function () {
        const category = String(directAcquireImageBulkCategory.value || '').trim();
        if (!category) {
          notify('Select an image category first', true);
          return;
        }
        if (!directAcquireSelectedImages.size) {
          notify('Check at least one image first', true);
          return;
        }
        Array.from(directAcquireSelectedImages).forEach((url) => {
          directAcquireImageCategoryByUrl.set(url, category);
        });
        renderDirectAcquireImageGallery();
      });
    }
    const directAcquireSaveImagesBtn = document.getElementById('directAcquireSaveImagesBtn');
    if (directAcquireSaveImagesBtn) {
      directAcquireSaveImagesBtn.addEventListener('click', async () => {
        try {
          await saveDirectAcquireSelectedImages();
          await refreshDirectAcquireImageCategories();
          renderDirectAcquireImageGallery();
        } catch (err) {
          notify(err.message || 'Could not save selected images', true);
        }
      });
    }
    const directAcquireWebsitePeersRefreshBtn = document.getElementById('directAcquireWebsitePeersRefreshBtn');
    if (directAcquireWebsitePeersRefreshBtn) {
      directAcquireWebsitePeersRefreshBtn.addEventListener('click', async () => {
        try {
          await refreshDirectAcquireWebsitePeers();
          notify('Reference websites refreshed');
        } catch (err) {
          notify(err.message || 'Could not refresh website peers', true);
        }
      });
    }
    const directAcquireWebsitePeerCancelBtn = document.getElementById('directAcquireWebsitePeerCancelBtn');
    if (directAcquireWebsitePeerCancelBtn) {
      directAcquireWebsitePeerCancelBtn.addEventListener('click', function () {
        resetDirectAcquireWebsitePeerForm();
      });
    }
    const directAcquireWebsiteDetailsForm = document.getElementById('directAcquireWebsiteDetailsForm');
    if (directAcquireWebsiteDetailsForm && !directAcquireWebsiteDetailsForm.dataset.bound) {
      directAcquireWebsiteDetailsForm.dataset.bound = '1';
      directAcquireWebsiteDetailsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(directAcquireWebsiteDetailsForm);
          const siteUrl = String(formData.get('site_url') || '').trim();
          const title = String(formData.get('title') || '').trim();
          const notes = String(formData.get('notes') || '').trim();
          const isProject = formData.get('is_project_website') === 'on';
          const editingId = String(formData.get('id') || '').trim();
          if (!siteUrl) throw new Error('Website URL is required.');
          const referenceRole = isProject ? 'project' : 'peer';
          const projectUrl = String(directAcquireProjectSourceUrl || state.directAcquireCurrentRun?.source_url || siteUrl).trim();
          const payload = {
            site_url: siteUrl,
            source_url: isProject ? siteUrl : projectUrl,
            title,
            notes,
            reference_role: referenceRole,
            site_type: isProject ? 'source' : 'peer',
            website_model: isProject ? 'Source Website' : '',
            metadata: { reference_role: referenceRole },
          };
          if (!payload.source_url) throw new Error('Project website is required.');
          if (editingId) {
            await api(`/api/acquire/website-peers/${encodeURIComponent(editingId)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
            notify('Website details updated');
          } else {
            await api('/api/acquire/website-peers', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            notify('Website details saved');
          }
          await refreshDirectAcquireWebsitePeers();
          if (!isProject) setDirectAcquireProjectWebsitePanelVisible(false);
        } catch (err) {
          notify(err.message || 'Could not save website details', true);
        }
      });
    }
    document.querySelectorAll('.acquire-web-expandable-summary .page-heading-actions, .acquire-web-expandable-summary .direct-acquire-dropdown').forEach((el) => {
      el.addEventListener('click', (event) => event.stopPropagation());
    });
    const directAcquireWebsitePeerForm = document.getElementById('directAcquireWebsitePeerForm');
    if (directAcquireWebsitePeerForm) {
      populateWebsitePeerModelSelect(document.getElementById('directAcquireWebsitePeerType'));
      directAcquireWebsitePeerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const formData = new FormData(directAcquireWebsitePeerForm);
          const existingPeer = directAcquireWebsitePeers.find((item) => String(item?.id || '') === String(directAcquireWebsitePeerEditingId || '')) || null;
          const referenceRole = String(formData.get('reference_role') || 'peer').trim().toLowerCase() === 'model' ? 'model' : 'peer';
          const payload = {
            source_url: String(formData.get('source_url') || '').trim(),
            site_url: String(formData.get('site_url') || '').trim(),
            title: String(formData.get('title') || '').trim(),
            website_model: String(formData.get('website_model') || '').trim(),
            matched_keywords: String(formData.get('matched_keywords') || '').trim(),
            snippet: String(formData.get('snippet') || '').trim(),
            notes: String(formData.get('notes') || '').trim(),
            reference_role: referenceRole,
            site_type: 'peer',
            metadata: { reference_role: referenceRole },
          };
          if (!payload.site_url) throw new Error('Website URL is required.');
          if (!payload.source_url) {
            payload.source_url = String(directAcquireProjectSourceUrl || state.directAcquireCurrentRun?.source_url || '').trim();
          }
          if (!payload.source_url) throw new Error('Project website is required.');
          if (referenceRole === 'model' && !payload.website_model) {
            throw new Error('Model category is required for model websites.');
          }
          if (directAcquireWebsitePeerEditingId) {
            await api(`/api/acquire/website-peers/${encodeURIComponent(directAcquireWebsitePeerEditingId)}`, {
              method: 'PATCH',
              body: JSON.stringify(payload),
            });
            notify('Other website updated');
          } else {
            await api('/api/acquire/website-peers', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            notify('Other website created');
          }
          resetDirectAcquireWebsitePeerForm();
          await refreshDirectAcquireWebsitePeers();
        } catch (err) {
          notify(err.message || 'Could not save website peer', true);
        }
      });
    }
    clearRedditAcquireProgress();
    const redditProgressWrap = document.getElementById('redditAcquireProgressWrap');
    const redditProgressBar = document.getElementById('redditAcquireProgressBar');
    const redditProgressText = document.getElementById('redditAcquireProgressText');
    if (redditProgressWrap) redditProgressWrap.classList.remove('hidden');
    if (redditProgressBar) redditProgressBar.value = 0;
    if (redditProgressText) redditProgressText.textContent = 'Idle — ready to run Reddit acquire.';
    if (els.acquireForm) {
      els.acquireForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const built = buildAcquireRequest(new FormData(els.acquireForm));
          setPreview(els.acquireRequestPreview, built);
          const response = await api(`/api/openclaw/${built.action}`, { method: 'POST', body: JSON.stringify(built.request) });
          setPreview(els.acquireResponsePreview, response);
          const derived = deriveAcquireJobFromResponse(built, response);
          if (derived) { upsertAcquireJobState(derived); renderAcquireJobsTable(); }
          const createdId = response?.result?.job?.id;
          if (createdId && els.acquireJobIdInput) els.acquireJobIdInput.value = createdId;
          const token = response?.result?.approval?.approval_token;
          if (token && els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = token;
          await refreshAcquireJobs();
          notify(`Acquire ${built.action} request sent`);
        } catch (err) { notify(err.message, true); }
      });
    }
    if (els.acquireRefreshJobsBtn) {
      els.acquireRefreshJobsBtn.addEventListener('click', async () => {
        try { await refreshAcquireJobs(); notify('Acquire jobs refreshed'); }
        catch (err) { notify(err.message, true); }
      });
    }
    if (els.directAcquireRefreshBtn) {
      els.directAcquireRefreshBtn.addEventListener('click', async () => {
        try { await refreshDirectAcquireRuns(); notify('Direct acquire runs refreshed'); }
        catch (err) { notify(err.message, true); }
      });
    }
    if (els.directAcquireForm) {
      els.directAcquireForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          startDirectAcquireProgress();
          const formData = new FormData(els.directAcquireForm);
          const acquireUrl = String(formData.get('source_url') || directAcquireProjectSourceUrl || '').trim()
            || String(await fetchProjectWebsiteUrl()).trim();
          if (!acquireUrl) throw new Error('Project website URL is required.');
          directAcquireProjectSourceUrl = acquireUrl;
          const payload = {
            source_url: acquireUrl,
            max_pages: Number(formData.get('max_pages') || 10),
            peer_sites_limit: Number(formData.get('peer_sites_limit') || 20),
            images_limit: Number(formData.get('images_limit') || 20),
            body_snippet_chars: Number(formData.get('body_snippet_chars') || 600),
            capture_contact_data: formData.get('acquire_social') === 'on',
            acquire_peer_sites: formData.get('acquire_peer_sites') === 'on',
            keyword_exclusions: String(formData.get('keyword_exclusions') || '').trim(),
          };
          if (directAcquireKeywordExclusionsInput) {
            try {
              window.localStorage.setItem(DIRECT_ACQUIRE_KEYWORD_EXCLUSIONS_KEY, payload.keyword_exclusions);
            } catch (_) {
              // ignore local storage failures
            }
          }
          const res = await api('/api/acquire/direct-run', { method: 'POST', body: JSON.stringify(payload) });
          state.directAcquireCurrentRun = res.run || null;
          directAcquireSelectedImages = new Set();
          directAcquireImageCategoryByUrl = new Map();
          directAcquireImagesExpanded = false;
          directAcquireSelectedHashtags = new Set();
          directAcquireSelectedKeywords = new Set();
          renderDirectAcquirePagesTable();
          setDirectAcquireProjectWebsitePanelVisible(false);
          try {
            await refreshDirectAcquireWebsitePeers();
          } catch (_) {
            // keep the direct acquire result visible even if peer-table refresh fails
          }
          await refreshDirectAcquireRuns();
          const advancedPanel = document.getElementById('directAcquireAdvancedPanel');
          if (advancedPanel) advancedPanel.open = false;
          finishDirectAcquireProgress(true, `Acquire complete (${res.run?.pages_succeeded || 0} pages processed).`);
          const results = document.getElementById('directAcquireResultsWrap');
          if (results && typeof results.scrollIntoView === 'function') {
            window.setTimeout(() => results.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
          }
          const peerSaveCount = Number(res.website_peers_saved_count || 0) || 0;
          const peerSaveError = String(res.website_peers_error || '').trim();
          const peerSaveText = peerSaveCount ? ` and saved ${peerSaveCount} website peer record${peerSaveCount === 1 ? '' : 's'}` : '';
          notify(`Direct ingest completed (${res.run?.pages_succeeded || 0} pages parsed)${peerSaveText}`);
          if (peerSaveError) notify(peerSaveError, true);
        } catch (err) {
          finishDirectAcquireProgress(false, err.message || 'Acquire failed.');
          notify(err.message, true);
        }
      });
    }
    const saveDirectAcquireContactBtn = document.getElementById('directAcquireSaveContactBtn');
    if (saveDirectAcquireContactBtn) {
      saveDirectAcquireContactBtn.addEventListener('click', async () => {
        try {
          await saveDirectAcquireContact();
        } catch (err) {
          notify(err.message || 'Could not save captured contact', true);
        }
      });
    }
    if (els.xAcquireRefreshBtn) {
      els.xAcquireRefreshBtn.addEventListener('click', async () => {
        try {
          await refreshXAcquireRuns();
          notify('X acquire runs refreshed');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    if (els.xAcquireForm) {
      els.xAcquireForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const formData = new FormData(els.xAcquireForm);
          const payload = {
            query: String(formData.get('query') || '').trim(),
            hashtags: String(formData.get('hashtags') || '').split(/[,\s]+/g).map((item) => item.trim()).filter(Boolean),
            lang: String(formData.get('lang') || '').trim(),
            start_time: toIsoFromLocal(formData.get('start_time')),
            end_time: toIsoFromLocal(formData.get('end_time')),
            max_tweets: Number(formData.get('max_tweets') || 25) || 25,
            include_replies: formData.get('include_replies') === 'on',
            max_replies_per_tweet: Number(formData.get('max_replies_per_tweet') || 10) || 10,
            exclude_retweets: formData.get('exclude_retweets') === 'on',
            exclude_replies: formData.get('exclude_replies') === 'on',
          };
          if (!payload.query && !payload.hashtags.length) {
            throw new Error('Add at least one query keyword or hashtag.');
          }
          const res = await api('/api/acquire/x-acquire', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          state.xAcquireCurrentRun = res.run || null;
          renderXAcquireItemsTable();
          await refreshXAcquireRuns();
          notify(`X acquire complete (${(state.xAcquireCurrentRun?.stats?.total_tweets || 0)} tweets, ${(state.xAcquireCurrentRun?.stats?.total_replies || 0)} replies)`);
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    if (els.redditAcquireRefreshBtn) {
      els.redditAcquireRefreshBtn.addEventListener('click', async () => {
        try {
          await refreshRedditAcquireRuns();
          notify('Reddit acquire runs refreshed');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    const redditDiscoveryStatusBtn = document.getElementById('redditDiscoveryStatusBtn');
    if (redditDiscoveryStatusBtn) {
      redditDiscoveryStatusBtn.addEventListener('click', async () => {
        try {
          setRedditDiscoveryStatus('Checking Reddit connection...');
          const res = await api('/api/engage/reddit/status');
          const configured = Boolean(res?.configured);
          const ok = Boolean(res?.authOk);
          const authError = String(res?.auth?.error || '').trim();
          const message = !configured
            ? 'Reddit API is not configured in Settings > APIs.'
            : (ok
              ? 'Reddit configured and authenticated.'
              : (authError || 'Reddit is configured, but authentication failed.'));
          setRedditDiscoveryStatus(message, !ok);
          notify(message, !ok);
        } catch (err) {
          setRedditDiscoveryStatus(err.message || 'Reddit status check failed', true);
          notify(err.message, true);
        }
      });
    }
    const redditDiscoveryForm = document.getElementById('redditDiscoveryForm');
    if (redditDiscoveryForm) {
      redditDiscoveryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = redditDiscoveryForm.querySelector('button[type="submit"]');
        try {
          if (submitBtn) submitBtn.disabled = true;
          await runRedditDiscovery();
          notify('Reddit thread discovery complete');
        } catch (err) {
          setRedditDiscoveryStatus(err.message || 'Reddit thread discovery failed', true);
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
    const redditDiscoveryUseTargetBtn = document.getElementById('redditDiscoveryUseTargetBtn');
    if (redditDiscoveryUseTargetBtn) {
      redditDiscoveryUseTargetBtn.addEventListener('click', () => {
        const discoveryTarget = document.getElementById('redditDiscoveryTarget');
        const acquireTarget = document.getElementById('redditAcquireTarget');
        const value = String(discoveryTarget && discoveryTarget.value || '').trim();
        if (!value) {
          notify('Add a Reddit discovery target first', true);
          return;
        }
        if (acquireTarget) acquireTarget.value = value;
        const replyTarget = document.getElementById('redditReplyTarget');
        if (replyTarget) replyTarget.value = value;
        notify('Copied discovery target into acquire form');
      });
    }
    const redditReplyCandidatesForm = document.getElementById('redditReplyCandidatesForm');
    if (redditReplyCandidatesForm) {
      redditReplyCandidatesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = redditReplyCandidatesForm.querySelector('button[type="submit"]');
        try {
          if (submitBtn) submitBtn.disabled = true;
          await runRedditReplyCandidates();
          notify('Reddit reply candidates generated');
        } catch (err) {
          setRedditReplyStatus(err.message || 'Could not generate Reddit reply candidates', true);
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
    const blueskyRefreshBtn = document.getElementById('blueskyRefreshBtn');
    if (blueskyRefreshBtn) {
      blueskyRefreshBtn.addEventListener('click', () => {
        renderBlueskyDiscoveryTable(lastBlueskyDiscoveryResult);
        renderBlueskyReplyCandidates(null);
        setBlueskyDiscoveryStatus('BlueSky UI refreshed.', false);
        setBlueskyReplyStatus('BlueSky reply generation is idle.', false);
        setBlueskyPostingStatus('BlueSky posting operator is idle.', false);
        notify('BlueSky page refreshed');
      });
    }
    const blueskyDiscoveryStatusBtn = document.getElementById('blueskyDiscoveryStatusBtn');
    if (blueskyDiscoveryStatusBtn) {
      blueskyDiscoveryStatusBtn.addEventListener('click', async () => {
        try {
          setBlueskyDiscoveryStatus('Checking BlueSky connection...');
          const res = await api('/api/promote/social/bluesky/auth-test');
          const configured = Boolean(res?.configured);
          const ok = Boolean(res?.authOk);
          const message = !configured
            ? 'BlueSky API is not configured in Settings > APIs.'
            : (ok ? 'BlueSky configured and authenticated.' : String(res?.error || 'BlueSky authentication failed.'));
          setBlueskyDiscoveryStatus(message, !ok);
          setBlueskyPostingStatus(message, !ok);
          notify(message, !ok);
        } catch (err) {
          setBlueskyDiscoveryStatus(err.message || 'BlueSky status check failed', true);
          notify(err.message, true);
        }
      });
    }
    const blueskyDiscoveryForm = document.getElementById('blueskyDiscoveryForm');
    if (blueskyDiscoveryForm) {
      blueskyDiscoveryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = blueskyDiscoveryForm.querySelector('button[type="submit"]');
        try {
          if (submitBtn) submitBtn.disabled = true;
          await runBlueskyDiscovery();
          notify('BlueSky discovery complete');
        } catch (err) {
          setBlueskyDiscoveryStatus(err.message || 'BlueSky discovery failed', true);
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
    const blueskyDiscoveryUseTargetBtn = document.getElementById('blueskyDiscoveryUseTargetBtn');
    if (blueskyDiscoveryUseTargetBtn) {
      blueskyDiscoveryUseTargetBtn.addEventListener('click', () => {
        const discoveryTarget = document.getElementById('blueskyDiscoveryTarget');
        const replyTarget = document.getElementById('blueskyReplyTarget');
        const postingTarget = document.getElementById('blueskyPostingTarget');
        const value = String(discoveryTarget && discoveryTarget.value || '').trim();
        if (!value) {
          notify('Add a BlueSky discovery target first', true);
          return;
        }
        if (replyTarget) replyTarget.value = value;
        if (postingTarget) postingTarget.value = value;
        notify('Copied discovery target into BlueSky reply and posting forms');
      });
    }
    const blueskyDiscoverySelectAllVisible = document.getElementById('blueskyDiscoverySelectAllVisible');
    if (blueskyDiscoverySelectAllVisible) {
      blueskyDiscoverySelectAllVisible.addEventListener('change', () => {
        const rows = Array.isArray(lastBlueskyDiscoveryResult?.candidates) ? lastBlueskyDiscoveryResult.candidates : [];
        rows.forEach((item) => {
          const postUrl = String(item && item.post_url || '').trim();
          if (!postUrl) return;
          if (blueskyDiscoverySelectAllVisible.checked) blueskyDiscoverySelectedPostUrls.add(postUrl);
          else blueskyDiscoverySelectedPostUrls.delete(postUrl);
        });
        renderBlueskyDiscoveryTable(lastBlueskyDiscoveryResult);
      });
    }
    const blueskyDiscoveryApplyBulkQualityBtn = document.getElementById('blueskyDiscoveryApplyBulkQualityBtn');
    if (blueskyDiscoveryApplyBulkQualityBtn) {
      blueskyDiscoveryApplyBulkQualityBtn.addEventListener('click', () => {
        const bulkSelect = document.getElementById('blueskyDiscoveryBulkQuality');
        const quality = String(bulkSelect && bulkSelect.value || '').trim();
        if (!quality) {
          notify('Choose a bulk quality first', true);
          return;
        }
        const rows = Array.isArray(lastBlueskyDiscoveryResult?.candidates) ? lastBlueskyDiscoveryResult.candidates : [];
        let updatedCount = 0;
        rows.forEach((item) => {
          const postUrl = String(item && item.post_url || '').trim();
          if (!postUrl || !blueskyDiscoverySelectedPostUrls.has(postUrl)) return;
          saveBlueskyDiscoveryFeedback(item, { quality, updated_at: new Date().toISOString() });
          updatedCount += 1;
        });
        renderBlueskyDiscoveryTable(lastBlueskyDiscoveryResult);
        notify(updatedCount ? `Updated quality for ${updatedCount} BlueSky post${updatedCount === 1 ? '' : 's'}` : 'No BlueSky posts selected', !updatedCount);
      });
    }
    const blueskyReplyCandidatesForm = document.getElementById('blueskyReplyCandidatesForm');
    if (blueskyReplyCandidatesForm) {
      blueskyReplyCandidatesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = blueskyReplyCandidatesForm.querySelector('button[type="submit"]');
        try {
          if (submitBtn) submitBtn.disabled = true;
          await runBlueskyReplyCandidates();
          notify('BlueSky reply candidates generated');
        } catch (err) {
          setBlueskyReplyStatus(err.message || 'Could not generate BlueSky reply candidates', true);
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
    const blueskyPostingStatusBtn = document.getElementById('blueskyPostingStatusBtn');
    const blueskyPostingToggleBtn = document.getElementById('blueskyPostingToggleBtn');
    const blueskyPostingPanel = document.getElementById('blueskyPostingPanel');
    const syncBlueskyPostingPanel = () => {
      const isHidden = Boolean(blueskyPostingPanel && blueskyPostingPanel.classList.contains('hidden'));
      if (blueskyPostingToggleBtn) blueskyPostingToggleBtn.textContent = isHidden ? 'Posting Operator' : 'Hide Posting Operator';
    };
    if (blueskyPostingToggleBtn && blueskyPostingPanel) {
      syncBlueskyPostingPanel();
      blueskyPostingToggleBtn.addEventListener('click', () => {
        blueskyPostingPanel.classList.toggle('hidden');
        syncBlueskyPostingPanel();
        if (!blueskyPostingPanel.classList.contains('hidden')) {
          blueskyPostingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
    if (blueskyPostingStatusBtn) {
      blueskyPostingStatusBtn.addEventListener('click', async () => {
        try {
          setBlueskyPostingStatus('Checking BlueSky posting setup...');
          const res = await api('/api/promote/social/bluesky/auth-test');
          const configured = Boolean(res?.configured);
          const ok = Boolean(res?.authOk);
          const message = !configured
            ? 'BlueSky API is not configured in Settings > APIs.'
            : (ok ? 'BlueSky posting auth is ready.' : String(res?.error || 'BlueSky posting setup failed.'));
          const preview = document.getElementById('blueskyPostingPreview');
          if (preview) preview.textContent = prettyJson(res || {});
          setBlueskyPostingStatus(message, !ok);
          notify(message, !ok);
        } catch (err) {
          setBlueskyPostingStatus(err.message || 'BlueSky posting check failed', true);
          notify(err.message, true);
        }
      });
    }
    const blueskyPostingForm = document.getElementById('blueskyPostingForm');
    if (blueskyPostingForm) {
      blueskyPostingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(blueskyPostingForm);
        const payload = {
          target: String(formData.get('target') || '').trim(),
          reply_text: String(formData.get('reply_text') || '').trim(),
          mode: 'dry_run',
        };
        const preview = document.getElementById('blueskyPostingPreview');
        if (preview) preview.textContent = prettyJson({
          ok: true,
          mode: 'dry_run',
          target: payload.target,
          reply_text: payload.reply_text,
          assumptions: ['BlueSky posting operator UI is wired. Backend dry-run execution is the next implementation step.'],
        });
        setBlueskyPostingStatus('BlueSky posting operator UI is ready. Backend dry-run execution is next.', false);
        notify('BlueSky posting operator UI scaffold is ready');
      });
    }
    if (els.redditAcquireForm) {
      els.redditAcquireForm.addEventListener('submit', async (e) => {
        const submitBtn = els.redditAcquireForm.querySelector('button[type="submit"]');
        e.preventDefault();
        let progress = null;
        let controller = null;
        let timer = null;
        let watchdog = null;
        try {
          const formData = new FormData(els.redditAcquireForm);
          const payload = {
            target: String(formData.get('target') || '').trim(),
            mode: String(formData.get('mode') || 'auto').trim().toLowerCase(),
            source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
            sort: String(formData.get('sort') || 'new').trim().toLowerCase(),
            max_posts: Number(formData.get('max_posts') || 100) || 100,
            max_comments: Number(formData.get('max_comments') || 500) || 500,
            keyword: String(formData.get('keyword') || '').trim(),
            start_time: String(formData.get('start_time') || '').trim(),
            end_time: String(formData.get('end_time') || '').trim(),
            include_replies: formData.get('include_replies') === 'on',
          };
          if (!payload.target) throw new Error('Subreddit or post URL is required.');
          if (submitBtn) submitBtn.disabled = true;
          progress = beginRedditAcquireProgress(payload);
          controller = new AbortController();
          timer = setTimeout(() => controller.abort(), 180000);
          const apiPromise = api('/api/acquire/reddit-acquire', {
            method: 'POST',
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          const watchdogPromise = new Promise((_, reject) => {
            watchdog = setTimeout(() => reject(new Error('Reddit acquire watchdog timeout after 190s. Please retry with lower limits.')), 190000);
          });
          const res = await Promise.race([apiPromise, watchdogPromise]);
          state.redditAcquireCurrentRun = res.run || null;
          if (progress) {
            setRedditAcquireProgress(96, 'Saving acquire results (phase 3 of 3)…');
            progress.finishSuccess();
          }
          renderRedditAcquireItemsTable();
          await refreshRedditAcquireRuns();
          notify(`Reddit acquire complete (${(state.redditAcquireCurrentRun?.stats?.total_posts || 0)} posts, ${(state.redditAcquireCurrentRun?.stats?.total_comments || 0)} comments)`);
        } catch (err) {
          if (err?.name === 'AbortError') {
            err = new Error('Reddit acquire timed out after 180s. Try smaller limits (10 posts / 20 comments) and retry.');
          }
          if (progress) progress.finishError(err?.message || 'request failed');
          notify(err.message, true);
        } finally {
          if (timer) clearTimeout(timer);
          if (watchdog) clearTimeout(watchdog);
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    if (els.xAcquireRunsTable) {
      refreshXAcquireRuns().catch((err) => notify(err.message, true));
      renderXAcquireItemsTable();
    }
    if (els.redditAcquireRunsTable) {
      refreshRedditAcquireRuns().catch((err) => notify(err.message, true));
      renderRedditAcquireItemsTable();
    }
    renderRedditDiscoveryTable(null);
    setRedditDiscoveryStatus('Reddit discovery is idle.', false);
    renderRedditReplyCandidates(null);
    setRedditReplyStatus('Reddit reply generation is idle.', false);
    renderBlueskyDiscoveryTable(null);
    setBlueskyDiscoveryStatus('BlueSky discovery is idle.', false);
    renderBlueskyReplyCandidates(null);
    setBlueskyReplyStatus('BlueSky reply generation is idle.', false);
    setBlueskyPostingStatus('BlueSky posting operator is idle.', false);
  }

  return {
    manifest: {
      id: 'acquire',
      label: 'Acquire',
      pageId: 'acquirePage',
      pagePrefixes: ['acquireSettingsPage'],
      secondaryPages: ['acquireWebPage'],
    },
    init,
    onPageActivated(targetPageId) {
      if (targetPageId === 'acquireSettingsPage') {
        renderAcquireSettingsPage();
      }
      if (targetPageId === 'acquireWebPage') {
        hydrateAcquireWebPage().catch((err) => notify(err.message || 'Could not load prior acquire', true));
      }
    },
    refreshAcquireJobs, refreshDirectAcquireRuns, refreshXAcquireRuns, refreshRedditAcquireRuns, renderAcquireJobsTable
  };
})();
