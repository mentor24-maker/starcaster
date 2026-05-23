window.App = window.App || {};

App.campaigns = (function () {
  const { state, els, api, notify } = App;
  const CHANNEL_RULES_STORAGE_KEY = 'campaignChannelRules.v1';
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

  let builderTweets = [];
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
  let builderLandingPages = [];
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
      row.classList.toggle('user-hidden', hiddenCampaignContentFieldIds.has(fieldId));
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
    const location = safeText(asset?.location);
    if (!location) return '';
    const driveId = extractDriveId(location);
    if (driveId) return `/api/assets/drive-file/${encodeURIComponent(driveId)}`;
    try {
      const parsed = new URL(location);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return location;
    } catch {}
    return '';
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
      select.appendChild(option);
    });

    if (desired && Array.from(select.options).some((option) => option.value === desired)) {
      select.value = desired;
    }
  }

  function hashtagText(row) {
    return safeText(row?.hashtag || row?.tag || row?.text || row?.label || row?.name || row?.content);
  }

  function hashtagId(row) {
    return safeText(row?.id);
  }

  function findById(rows, id) {
    const desired = safeText(id);
    if (!desired) return null;
    return (Array.isArray(rows) ? rows : []).find((row) => safeText(row?.id) === desired) || null;
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
      button.disabled = available.length === 0;
      button.textContent = available.length
        ? selectedTexts.length
          ? `Edit Hashtags (${selectedTexts.length})`
          : 'Choose Hashtags'
        : 'No Hashtags Available';
    }
  }

  function openCampaignHashtagPicker() {
    const modalFactory = App?.components?.Modal;
    if (!modalFactory) {
      notify('Hashtag picker is unavailable', true);
      return;
    }
    const rows = rankedHashtagRows(40);
    if (!rows.length) {
      notify('No hashtags available yet', true);
      return;
    }

    const draftIds = new Set(selectedCampaignHashtagIds);
    const body = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'campaign-hashtag-modal-list';
    rows.forEach((row) => {
      const id = hashtagId(row);
      const textValue = hashtagText(row);
      const option = document.createElement('div');
      option.className = 'campaign-hashtag-modal-option';
      option.title = textValue;

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
    body.appendChild(list);

    const modal = modalFactory({
      title: 'Select Hashtags',
      body,
      dialogClass: 'campaign-hashtag-modal',
      bodyClass: 'campaign-hashtag-modal-body',
      actions: [
        {
          label: 'Clear',
          onClick: () => {
            setSelectedCampaignHashtagIds([]);
            updateCampaignFieldGlows();
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
            modal.close();
          },
        },
      ],
    });
    modal.open();
  }

  function campaignPreviewChannelKind() {
    const channelSelect = byId('campaignChannelSelect');
    const channelText = `${selectedOptionText(channelSelect)} ${safeText(channelSelect?.value)}`.toLowerCase();
    if (channelText.includes('twitter') || /\bx\b/.test(channelText)) return 'tweet';
    return 'tweet';
  }

  function buildCampaignTweetPreview() {
    const tweetRow = contentFieldIsActive('campaignTweetSelect')
      ? findById(builderTweets, byId('campaignTweetSelect')?.value)
      : null;
    const taglineRow = contentFieldIsActive('campaignTaglineSelect')
      ? findById(builderTaglines, byId('campaignTaglineSelect')?.value)
      : null;
    const ctaRow = contentFieldIsActive('campaignCtaSelect')
      ? findById(builderCtas, byId('campaignCtaSelect')?.value)
      : null;
    const baseParts = [
      safeText(tweetRow?.content || selectedOptionTextIfValue(byId('campaignTweetSelect'))),
      safeText(taglineRow?.tagline || selectedOptionTextIfValue(byId('campaignTaglineSelect'))),
    ].filter(Boolean);
    const ctaText = appendCtaUrl(ctaRow?.cta || selectedOptionTextIfValue(byId('campaignCtaSelect')));
    const shareUrl = campaignProjectUrl();
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

    let text = compose();
    while (hashtags.length && characterCount(text) > TWEET_CHARACTER_LIMIT) {
      hashtags = hashtags.slice(0, -1);
      text = compose();
    }
    if (includeCta && characterCount(text) > TWEET_CHARACTER_LIMIT) {
      includeCta = false;
      text = compose();
    }
    if (includeLink && characterCount(text) > TWEET_CHARACTER_LIMIT) {
      includeLink = false;
      text = compose();
    }

    const count = characterCount(text);
    return {
      text,
      count,
      limit: TWEET_CHARACTER_LIMIT,
      delta: TWEET_CHARACTER_LIMIT - count,
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
    if (contentFieldIsActive('campaignPrimaryVideoSelect')) {
      const video = findById(state.assets, byId('campaignPrimaryVideoSelect')?.value);
      if (video) return { type: 'video', asset: video, url: assetPreviewUrl(video) };
    }
    return null;
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
      const preview = buildCampaignTweetPreview();
      const text = preview.text;
      const media = buildCampaignPreviewAsset();
      const shell = document.createElement('div');
      shell.className = 'campaign-preview-tweet-shell';

      const header = document.createElement('div');
      header.className = 'campaign-preview-tweet-header';
      const avatar = document.createElement('div');
      avatar.className = 'campaign-preview-tweet-avatar';
      avatar.textContent = 'S';
      const account = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'campaign-preview-tweet-name';
      name.textContent = 'Starcaster';
      const handle = document.createElement('div');
      handle.className = 'campaign-preview-tweet-handle';
      handle.textContent = '@starcaster';
      account.appendChild(name);
      account.appendChild(handle);
      header.appendChild(avatar);
      header.appendChild(account);
      shell.appendChild(header);

      const textEl = document.createElement('div');
      textEl.className = text ? 'campaign-preview-tweet-text' : 'campaign-preview-empty';
      textEl.textContent = text || 'Choose tweet content, a tagline, CTA, or hashtags to preview this post.';
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
        preview.urlMissingFromTweet ? 'Project URL not in tweet — shorten copy or use a shorter Website URL' : '',
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
      body.appendChild(shell);
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

  function channelLabel(channel) {
    const platform = safeText(
      channel?.channel
      || channel?.name
    );
    const account = safeText(channel?.userName || channel?.handle || channel?.displayName || channel?.email);
    if (platform && account) return `${platform}: ${account}`;
    return safeText(platform || account || channel?.id);
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
    return safeText(topic?.category);
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
      return;
    }
    const desiredLabel = safeText(topicLabel).toLowerCase();
    if (!desiredLabel) {
      select.value = '';
      return;
    }
    const matching = Array.from(select.options).find((option) => safeText(option.textContent).toLowerCase() === desiredLabel);
    select.value = matching ? String(matching.value) : '';
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
    const name = safeText(channel?.channel || channel?.name).toLowerCase();
    if (!name) {
      return {
        hint: 'Select a channel to load content fields.',
        visibleMechanics: [],
        requiredMechanics: [],
        visibleContent: [],
      };
    }
    if (name.includes('email')) {
      return {
        hint: '',
        visibleMechanics: ['campaignEmailTemplateSelect', 'campaignLandingPageSelect', 'campaignSegmentSelect'],
        requiredMechanics: [],
        visibleContent: ['campaignHeadlineSelect', 'campaignEmailSelect', 'campaignCtaSelect', 'campaignPrimaryImageSelect', 'campaignLeadMagnetSelect'],
      };
    }
    if (name === 'x' || name.includes('twitter')) {
      return {
        hint: 'X campaigns focus on short social copy, hashtags, and optional media.',
        visibleMechanics: ['campaignSegmentSelect'],
        requiredMechanics: [],
        visibleContent: ['campaignTweetSelect', 'campaignTaglineSelect', 'campaignCtaSelect', 'campaignPrimaryImageSelect', 'campaignPrimaryVideoSelect', 'campaignHashtagGroupSelect'],
      };
    }
    if (name.includes('youtube')) {
      return {
        hint: 'YouTube campaigns can assemble titles, descriptions, transcripts, CTAs, and media.',
        visibleMechanics: ['campaignLandingPageSelect', 'campaignSegmentSelect'],
        requiredMechanics: [],
        visibleContent: ['campaignHeadlineSelect', 'campaignDescriptionSelect', 'campaignTranscriptSelect', 'campaignCommentSelect', 'campaignCtaSelect', 'campaignPrimaryImageSelect', 'campaignPrimaryVideoSelect'],
      };
    }
    if (name.includes('substack') || name.includes('medium') || name.includes('patreon') || name.includes('blog')) {
      return {
        hint: 'Publishing channels can use long-form content plus supporting summary copy and calls to action.',
        visibleMechanics: ['campaignLandingPageSelect', 'campaignSegmentSelect'],
        requiredMechanics: [],
        visibleContent: ['campaignHeadlineSelect', 'campaignArticleSelect', 'campaignReportSelect', 'campaignWhitePaperSelect', 'campaignEbookSelect', 'campaignDescriptionSelect', 'campaignCtaSelect', 'campaignPrimaryImageSelect', 'campaignLeadMagnetSelect'],
      };
    }
    return {
      hint: 'Social campaigns can combine posts, supporting copy, hashtags, and media.',
      visibleMechanics: ['campaignSegmentSelect'],
      requiredMechanics: [],
      visibleContent: ['campaignHeadlineSelect', 'campaignPostSelect', 'campaignDescriptionSelect', 'campaignTaglineSelect', 'campaignCtaSelect', 'campaignPrimaryImageSelect', 'campaignPrimaryVideoSelect', 'campaignHashtagGroupSelect'],
    };
  }

  function applyCampaignChannelProfile(channelId) {
    const mechanicsWrap = byId('campaignMechanicsConditional');
    const contentWrap = byId('campaignContentConditional');
    const hint = byId('campaignContentChannelHint');
    const channels = Array.isArray(state.channels) ? state.channels : [];
    const channel = channels.find((item) => String(item.id) === String(channelId || '')) || null;
    const profile = channelProfile(channel);
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

    setSelectOptions(
      byId('campaignTopicSelect'),
      builderTopics.map((topic) => ({ value: topic.id, label: safeText(topic.topic || topic.category) || `Topic ${topic.id}` })),
      builderTopics.length ? 'Topics' : 'Topics (create in Messaging > Topics)',
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

    setSelectOptions(
      byId('campaignEmailSelect'),
      filteredEmails.map((email) => {
        const body = safeText(email.email);
        const label = body.length > 100 ? `${body.slice(0, 97)}...` : body;
        return { value: email.id, label: label || `Email ${email.id}` };
      }),
      filteredEmails.length ? 'Email Body' : activeTopic ? 'Email Body (no matches for topic)' : 'Email Body (create in Messaging > Emails)',
      currentValues.emailId
    );

    setSelectOptions(
      byId('campaignHeadlineSelect'),
      filteredHeadlines.map((item) => ({ value: item.id, label: optionLabelFromText(item.headline, `Headline ${item.id}`) })),
      filteredHeadlines.length ? 'Headline' : activeTopic ? 'Headline (no matches for topic)' : 'Headline (create in Messaging > Headlines)',
      currentValues.headlineId
    );

    setSelectOptions(
      byId('campaignSubjectLineSelect'),
      filteredHeadlines.map((item) => ({ value: item.id, label: optionLabelFromText(item.headline, `Subject ${item.id}`) })),
      filteredHeadlines.length ? 'Subject Line' : activeTopic ? 'Subject Line (no matches for topic)' : 'Subject Line (use Headlines for now)',
      currentValues.subjectLineId
    );

    setSelectOptions(
      byId('campaignBlurbSelect'),
      filteredDescriptions.map((item) => ({ value: item.id, label: optionLabelFromText(item.description, `Blurb ${item.id}`) })),
      filteredDescriptions.length ? 'Blurb' : activeTopic ? 'Blurb (no matches for topic)' : 'Blurb (use Descriptions)',
      currentValues.blurbId
    );

    setSelectOptions(
      byId('campaignPitchSelect'),
      filteredPitches.map((item) => ({ value: item.id, label: optionLabelFromText(item.pitch, `Pitch ${item.id}`) })),
      filteredPitches.length ? 'Pitch' : activeTopic ? 'Pitch (no matches for topic)' : 'Pitch (create in Messaging > Pitches)',
      currentValues.pitchId
    );

    setSelectOptions(
      byId('campaignSubheadingSelect'),
      filteredSubheadings.map((item) => ({ value: item.id, label: optionLabelFromText(item.subheading, `Sub-heading ${item.id}`) })),
      filteredSubheadings.length ? 'Sub-heading' : activeTopic ? 'Sub-heading (no matches for topic)' : 'Sub-heading (create in Messaging > Sub-headings)',
      currentValues.subheadingId
    );

    setSelectOptions(
      byId('campaignTaglineSelect'),
      filteredTaglines.map((item) => ({ value: item.id, label: optionLabelFromText(item.tagline, `Tagline ${item.id}`) })),
      filteredTaglines.length ? 'Tagline' : activeTopic ? 'Tagline (no matches for topic)' : 'Tagline (create in Messaging > Taglines)',
      currentValues.taglineId
    );

    renderCampaignHashtagPicker();

    setSelectOptions(
      byId('campaignCtaSelect'),
      filteredCtas.map((item) => ({ value: item.id, label: optionLabelFromText(item.cta, `CTA ${item.id}`) })),
      filteredCtas.length ? 'CTA' : activeTopic ? 'CTA (no matches for topic)' : 'CTA (create in Messaging > CTAs)',
      currentValues.ctaId
    );

    setSelectOptions(
      byId('campaignTweetSelect'),
      filteredTweets.map((tweet) => {
        const content = safeText(tweet.content);
        const label = content.length > 80 ? `${content.slice(0, 77)}...` : content;
        return { value: tweet.id, label: label || `Tweet ${tweet.id}` };
      }),
      filteredTweets.length ? 'Tweet' : activeTopic ? 'Tweet (no matches for topic)' : 'Tweet (create in Messaging > Tweets)',
      currentValues.tweetId
    );

    setSelectOptions(
      byId('campaignPostSelect'),
      filteredPosts.map((item) => ({ value: item.id, label: optionLabelFromText(item.post, `Post ${item.id}`) })),
      filteredPosts.length ? 'Post' : activeTopic ? 'Post (no matches for topic)' : 'Post (create in Messaging > Posts)',
      currentValues.postId
    );

    setSelectOptions(
      byId('campaignDescriptionSelect'),
      filteredDescriptions.map((item) => ({ value: item.id, label: optionLabelFromText(item.description, `Description ${item.id}`) })),
      filteredDescriptions.length ? 'Description' : activeTopic ? 'Description (no matches for topic)' : 'Description (create in Messaging > Descriptions)',
      currentValues.descriptionId
    );

    setSelectOptions(
      byId('campaignTranscriptSelect'),
      filteredTranscripts.map((item) => ({ value: item.id, label: optionLabelFromText(item.transcript, `Transcript ${item.id}`) })),
      filteredTranscripts.length ? 'Transcript' : activeTopic ? 'Transcript (no matches for topic)' : 'Transcript (create in Messaging > Transcripts)',
      currentValues.transcriptId
    );

    setSelectOptions(
      byId('campaignCommentSelect'),
      filteredComments.map((item) => ({ value: item.id, label: optionLabelFromText(item.comment, `Comment ${item.id}`) })),
      filteredComments.length ? 'Comment' : activeTopic ? 'Comment (no matches for topic)' : 'Comment (create in Messaging > Comments)',
      currentValues.commentId
    );

    setSelectOptions(
      byId('campaignPrimaryImageSelect'),
      filteredImages.map((asset) => ({ value: asset.id, label: safeText(asset.assetName) || `Image ${asset.id}` })),
      filteredImages.length ? 'Primary Image' : activeTopic ? 'Primary Image (no matches for topic)' : 'Primary Image (no image assets yet)',
      currentValues.primaryImageId
    );

    setSelectOptions(
      byId('campaignPrimaryVideoSelect'),
      filteredVideos.map((asset) => ({ value: asset.id, label: safeText(asset.assetName) || `Video ${asset.id}` })),
      filteredVideos.length ? 'Primary Video (optional)' : activeTopic ? 'Primary Video (no matches for topic)' : 'Primary Video (optional)',
      currentValues.primaryVideoId
    );

    const pageOptions = builderLandingPages.map((page) => ({ value: page.id, label: `Builder: ${safeText(page.name) || page.id}` }));
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

    setSelectOptions(
      byId('campaignArticleSelect'),
      filteredArticles.map((item) => ({ value: item.id, label: optionLabelFromText(item.title, `Article ${item.id}`) })),
      filteredArticles.length ? 'Article' : activeTopic ? 'Article (no matches for topic)' : 'Article (create in Messaging > Articles)',
      currentValues.articleId
    );

    setSelectOptions(
      byId('campaignReportSelect'),
      filteredReports.map((item) => ({ value: item.id, label: optionLabelFromText(item.title, `Report ${item.id}`) })),
      filteredReports.length ? 'Report' : activeTopic ? 'Report (no matches for topic)' : 'Report (create in Messaging > Reports)',
      currentValues.reportId
    );

    setSelectOptions(
      byId('campaignWhitePaperSelect'),
      filteredWhitePapers.map((item) => ({ value: item.id, label: optionLabelFromText(item.title, `White Paper ${item.id}`) })),
      filteredWhitePapers.length ? 'White Paper' : activeTopic ? 'White Paper (no matches for topic)' : 'White Paper (create in Messaging > White Papers)',
      currentValues.whitePaperId
    );

    setSelectOptions(
      byId('campaignEbookSelect'),
      filteredEbooks.map((item) => ({ value: item.id, label: optionLabelFromText(item.title, `eBook ${item.id}`) })),
      filteredEbooks.length ? 'eBook' : activeTopic ? 'eBook (no matches for topic)' : 'eBook (create in Messaging > eBooks)',
      currentValues.ebookId
    );

    setSelectOptions(
      byId('campaignLeadMagnetSelect'),
      filteredLeadMagnets.map((asset) => ({ value: asset.id, label: safeText(asset.assetName) || `Asset ${asset.id}` })),
      filteredLeadMagnets.length ? 'PDF (optional)' : activeTopic ? 'PDF (no matches for topic)' : 'PDF (placeholder)',
      currentValues.leadMagnetId
    );

    const campaignForm = byId('campaignForm');
    const submitBtn = campaignForm?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = channels.length === 0;
    applyCampaignChannelProfile(currentValues.channelId || safeText(byId('campaignChannelSelect')?.value));
  }

  async function loadBuilderSources() {
    const [channelsRes, assetsRes, segmentsRes, tweetsRes, hashtagsRes, emailsRes, emailTemplatesRes, topicsRes, headlinesRes, subheadingsRes, taglinesRes, pitchesRes, articlesRes, reportsRes, whitePapersRes, ebooksRes, postsRes, descriptionsRes, transcriptsRes, commentsRes, ctasRes, landingPagesRes, formsRes] = await Promise.allSettled([
      api('/api/channels'),
      api('/api/assets'),
      api('/api/segments'),
      api('/api/messaging/tweets?limit=200'),
      api('/api/messaging/hashtags?limit=5000'),
      api('/api/messaging/emails?limit=5000'),
      api('/api/develop/email-templates'),
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
      api('/api/develop/landing-pages'),
      api('/api/develop/forms'),
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

    builderTweets = tweetsRes.status === 'fulfilled' && Array.isArray(tweetsRes.value.tweets)
      ? tweetsRes.value.tweets
      : [];
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
    builderLandingPages = landingPagesRes.status === 'fulfilled' && Array.isArray(landingPagesRes.value.landingPages) ? landingPagesRes.value.landingPages : [];
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
    const landingPagesById = new Map(builderLandingPages.map((page) => [String(page.id), page]));

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
      return;
    }
    if (Array.from(select.options).some((option) => String(option.value) === desired)) {
      select.value = desired;
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
    const fields = content.querySelectorAll('select, input');
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
    return safeText(option?.textContent);
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
  }

  function showContentRow(row) {
    const fieldId = safeText(row?.dataset?.fieldId);
    if (fieldId) hiddenCampaignContentFieldIds.delete(fieldId);
    row.classList.remove('user-hidden');
    // Only show if channel profile also wants it visible
    const channelVisible = row.dataset.channelVisible !== '0';
    row.style.display = channelVisible ? '' : 'none';
    updateAddContentBtnVisibility();
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
      contentArea.addEventListener('change', updateCampaignFieldGlows);
    }

    // --- Content row delete icons + Add Content button ---
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

    if (form) {
      const channelSelect = byId('campaignChannelSelect');
      const topicSelect = byId('campaignTopicSelect');
      if (channelSelect) {
        channelSelect.addEventListener('change', function () {
          applyCampaignChannelProfile(channelSelect.value);
        });
      }
      if (topicSelect) {
        topicSelect.addEventListener('change', function () {
          renderBuilderSelects();
        });
      }
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
          subject: selectedOptionText(subjectLineSelect) || selectedOptionText(headlineSelect) || safeText(form.elements.name?.value),
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
