window.App = window.App || {};

App.assetFieldImport = (function assetFieldImportModule() {
  const { api, notify } = App;

  const DEFAULT_INCLUDES = ' or ';

  // Asset-source types require an Includes filter (WYR file-name matching).
  // Messaging-source types treat an empty Includes as "match all".
  const ASSET_SOURCE_TYPES = new Set(['image', 'video', 'audio', 'lead_magnet', 'file']);

  const FIELD_TYPES = [
    { id: 'image', label: 'Image', group: 'Assets' },
    { id: 'video', label: 'Video', group: 'Assets' },
    { id: 'audio', label: 'Audio', group: 'Assets' },
    { id: 'lead_magnet', label: 'PDF', group: 'Assets' },
    { id: 'file', label: 'File', group: 'Assets' },
    { id: 'tweet', label: 'Tweet', group: 'Messaging' },
    { id: 'headline', label: 'Headline', group: 'Messaging' },
    { id: 'subheading', label: 'Sub-heading', group: 'Messaging' },
    { id: 'tagline', label: 'Tagline', group: 'Messaging' },
    { id: 'pitch', label: 'Pitch', group: 'Messaging' },
    { id: 'email', label: 'Email', group: 'Messaging' },
    { id: 'post', label: 'Post', group: 'Messaging' },
    { id: 'description', label: 'Description', group: 'Messaging' },
    { id: 'transcript', label: 'Transcript', group: 'Messaging' },
    { id: 'comment', label: 'Comment', group: 'Messaging' },
    { id: 'hashtag', label: 'Hashtag', group: 'Messaging' },
    { id: 'cta', label: 'Call to Action', group: 'Messaging' },
    { id: 'article', label: 'Article', group: 'Messaging' },
    { id: 'report', label: 'Report', group: 'Messaging' },
    { id: 'white-paper', label: 'White Paper', group: 'Messaging' },
    { id: 'ebook', label: 'eBook', group: 'Messaging' },
    { id: 'web-page', label: 'Web Page', group: 'Messaging' },
  ];

  const FALLBACK_SUPPORTED_PAIRS = new Set(['image:tweet', 'image:headline', 'tweet:headline', 'tweet:post']);
  let supportedPairs = new Set(FALLBACK_SUPPORTED_PAIRS);
  let hintsByPair = new Map();

  const HINTS = {
    'image:tweet': 'Matching images become Would You Rather… tweets: OCR options (v2), file-name fallback, plus a follow-up teaser.',
    'image:headline': 'Matching images become headlines: Caption when set, otherwise title-case the file name (lowercase stop words).',
    'tweet:headline': 'Matching tweets become headlines: WYR main question only; otherwise first statement (skip if over 20 words).',
    'tweet:post': 'Matching tweets become posts: copies text, URL, hashtags, image, and topic unchanged.',
  };

  const TARGET_LABELS = {
    tweet: 'tweet',
    headline: 'headline',
    subheading: 'sub-heading',
    tagline: 'tagline',
    pitch: 'pitch',
    email: 'email',
    post: 'post',
    description: 'description',
    transcript: 'transcript',
    comment: 'comment',
    hashtag: 'hashtag',
    cta: 'call to action',
    article: 'article',
    report: 'report',
    'white-paper': 'white paper',
    ebook: 'eBook',
    'web-page': 'web page',
  };

  let modal;
  let fromSelect;
  let toSelect;
  let includesInput;
  let runBtn;
  let hintEl;
  let resultEl;
  let closeBtn;
  let running = false;
  let initialized = false;
  let listenersBound = false;

  function pairKey(fromType, toType) {
    return `${String(fromType || '').trim().toLowerCase()}:${String(toType || '').trim().toLowerCase()}`;
  }

  function isSupported(fromType, toType) {
    const key = pairKey(fromType, toType);
    if (!key || key === ':' || fromType === toType) return false;
    // All messaging-to-messaging pairs are handled by the generic AI handler.
    if (!ASSET_SOURCE_TYPES.has(fromType) && fromType && toType) return true;
    return supportedPairs.has(key);
  }

  function hintForPair(fromType, toType) {
    const key = pairKey(fromType, toType);
    return hintsByPair.get(key) || HINTS[key] || '';
  }

  function setSelectValue(select, value) {
    if (!select) return false;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return false;
    const option = Array.from(select.options || []).find(
      (opt) => String(opt.value || '').trim().toLowerCase() === normalized
    );
    if (!option) return false;
    select.value = option.value;
    return true;
  }

  async function loadSupportedPairsFromApi() {
    try {
      const res = await api('/api/assets/import-from-fields');
      const pairs = Array.isArray(res?.supportedPairs)
        ? res.supportedPairs
        : Array.isArray(res?.data?.supportedPairs)
          ? res.data.supportedPairs
          : [];
      if (!pairs.length) return;
      const nextPairs = new Set(FALLBACK_SUPPORTED_PAIRS);
      const nextHints = new Map(hintsByPair);
      pairs.forEach((pair) => {
        const key = pairKey(pair.fromType, pair.toType);
        if (!key || key === ':') return;
        nextPairs.add(key);
        const description = String(pair.description || '').trim();
        if (description) nextHints.set(key, description);
      });
      supportedPairs = nextPairs;
      hintsByPair = nextHints;
    } catch (_) {
      supportedPairs = new Set(FALLBACK_SUPPORTED_PAIRS);
      hintsByPair = new Map();
    }
  }

  function targetLabel(toType) {
    return TARGET_LABELS[String(toType || '').trim().toLowerCase()] || 'item';
  }

  function populateSelect(select) {
    if (!select) return;
    select.innerHTML = '';
    const groups = new Map();
    FIELD_TYPES.forEach((item) => {
      const groupName = item.group || 'Other';
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push(item);
    });
    groups.forEach((items, groupName) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = groupName;
      items.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });
  }

  function isAssetSource(fromType) {
    return ASSET_SOURCE_TYPES.has(String(fromType || '').trim().toLowerCase());
  }

  function syncUi() {
    const fromType = String(fromSelect?.value || '').trim();
    const toType = String(toSelect?.value || '').trim();
    const includes = String(includesInput?.value || '').trim();
    const supported = isSupported(fromType, toType);
    const key = pairKey(fromType, toType);

    if (hintEl) {
      hintEl.textContent = supported
        ? (hintForPair(fromType, toType) || HINTS[key] || '')
        : 'This import combination is not available yet.';
    }

    if (runBtn) {
      // Asset-source imports require an Includes filter; messaging-to-messaging do not.
      const needsIncludes = isAssetSource(fromType);
      runBtn.disabled = running || !supported || (needsIncludes && !includes);
    }
  }

  function setModalOpen(open) {
    if (!modal) return;
    modal.classList.toggle('hidden', !open);
    if (open) {
      syncUi();
      includesInput?.focus();
    } else if (resultEl) {
      resultEl.classList.add('hidden');
      resultEl.textContent = '';
    }
  }

  function formatResult(data) {
    const matched = Number(data?.matched || 0);
    const created = Number(data?.created || 0);
    const skipped = Number(data?.skipped || 0);
    const planned = Number(data?.planned || 0);
    const ocrCount = Number(data?.ocrCount || 0);
    const filenameFallbackCount = Number(data?.filenameFallbackCount || 0);
    const transformErrors = Number(data?.transformErrors || 0);
    const fromType = String(data?.fromType || '').trim();
    const assetSource = ASSET_SOURCE_TYPES.has(fromType);
    const sourceNoun = assetSource ? 'image' : (fromType || 'item');
    const label = targetLabel(data?.toType);
    const plural = planned === 1 ? label : `${label}s`;

    if (planned > 0 && created === 0 && skipped === 0) {
      let msg = `Matched ${matched} ${sourceNoun}(s). Ready to create ${planned} ${plural}.`;
      if (ocrCount || filenameFallbackCount) {
        msg += ` (${ocrCount} OCR, ${filenameFallbackCount} file name)`;
      }
      return msg;
    }
    const parts = [];
    if (matched) parts.push(`${matched} matched`);
    if (created) parts.push(`${created} created`);
    if (skipped) parts.push(`${skipped} skipped`);
    if (ocrCount) parts.push(`${ocrCount} OCR`);
    if (filenameFallbackCount) parts.push(`${filenameFallbackCount} file name`);
    if (transformErrors) parts.push(`${transformErrors} failed`);
    return parts.length ? parts.join(', ') + '.' : `No matching ${sourceNoun}s found.`;
  }

  async function refreshAfterImport(toType) {
    if (toType === 'headline' && App.messaging?.refreshHeadlines) {
      try {
        await App.messaging.refreshHeadlines();
      } catch (_) { /* optional */ }
      return;
    }
    if (toType === 'post' && App.messagingPostsEditor?.refreshPosts) {
      try {
        await App.messagingPostsEditor.refreshPosts();
      } catch (_) { /* optional */ }
      return;
    }
    if (App.messaging?.refresh) {
      try {
        await App.messaging.refresh();
      } catch (_) { /* optional */ }
    }
  }

  async function runImport() {
    if (running) return;
    const fromType = String(fromSelect?.value || '').trim();
    const toType = String(toSelect?.value || '').trim();
    const includes = String(includesInput?.value || '').trim();
    const label = targetLabel(toType);
    if (!isSupported(fromType, toType)) {
      notify('This import combination is not supported yet.', true);
      return;
    }
    if (isAssetSource(fromType) && !includes) {
      notify('Enter Includes text to filter file names.', true);
      return;
    }

    running = true;
    syncUi();
    if (resultEl) {
      resultEl.classList.remove('hidden');
      if (fromType === 'web-page') {
        resultEl.textContent = 'Rolling up Builder pages…';
      } else {
        resultEl.textContent = isAssetSource(fromType)
          ? 'Running OCR and building items…'
          : 'Repurposing content with AI…';
      }
    }

    try {
      if (fromType === 'web-page') {
        await api('/api/messaging/content-items/sync-web-pages', {
          method: 'POST',
          body: JSON.stringify({}),
        }).catch(() => null);
      }

      const dryRes = await api('/api/assets/import-from-fields', {
        method: 'POST',
        body: JSON.stringify({
          fromType,
          toType,
          includes,
          dryRun: true,
        }),
      });
      const dryData = dryRes?.data || dryRes || {};
      const planned = Number(dryData.planned || 0);
      if (!planned) {
        if (resultEl) resultEl.textContent = formatResult(dryData);
        const emptyMsg = fromType === 'web-page'
          ? 'No Builder pages with text content were found for this project.'
          : isAssetSource(fromType)
            ? 'No matching images found for that Includes filter.'
            : 'No matching source items found.';
        notify(emptyMsg, true);
        return;
      }

      if (resultEl && fromType === 'web-page') {
        resultEl.textContent = `Repurposing ${planned} page(s) with AI…`;
      }

      const applyRes = await api('/api/assets/import-from-fields', {
        method: 'POST',
        body: JSON.stringify({
          fromType,
          toType,
          includes,
          dryRun: false,
          plan: Array.isArray(dryData.plan) ? dryData.plan : undefined,
        }),
      });
      const data = applyRes?.data || applyRes || {};
      if (resultEl) resultEl.textContent = formatResult(data);
      const created = Number(data.created || 0);
      if (created > 0) {
        notify(`Created ${created} ${created === 1 ? label : `${label}s`}.`, false);
        await refreshAfterImport(toType);
      } else {
        notify(formatResult(data), false);
      }
    } catch (err) {
      let message = err?.message || 'Import failed';
      if (/not available yet/i.test(message)) {
        message = `${message} Restart the Node server on port 3001 (an old process may still be running).`;
      }
      if (resultEl) resultEl.textContent = message;
      notify(message, true);
    } finally {
      running = false;
      syncUi();
    }
  }

  function ensureInitialized() {
    if (initialized && modal && fromSelect && toSelect) return;
    init();
  }

  function openModal(preset = {}) {
    ensureInitialized();
    const fromType = String(preset.fromType || 'tweet').trim();
    const toType = String(preset.toType || 'post').trim();
    setSelectValue(fromSelect, fromType);
    setSelectValue(toSelect, toType);
    // Only pre-fill the WYR default for asset-source imports; leave empty for text-to-text.
    if (includesInput && !String(includesInput.value || '').trim()) {
      if (isAssetSource(fromType)) {
        includesInput.value = DEFAULT_INCLUDES;
      }
    }
    setModalOpen(true);
  }

  function init() {
    modal = document.getElementById('assetFieldImportModal');
    fromSelect = document.getElementById('assetFieldImportFromType');
    toSelect = document.getElementById('assetFieldImportToType');
    includesInput = document.getElementById('assetFieldImportIncludes');
    runBtn = document.getElementById('assetFieldImportRunBtn');
    hintEl = document.getElementById('assetFieldImportHint');
    resultEl = document.getElementById('assetFieldImportResult');
    closeBtn = document.getElementById('assetFieldImportCloseBtn');

    populateSelect(fromSelect);
    populateSelect(toSelect);

    if (includesInput && !includesInput.value) {
      includesInput.value = DEFAULT_INCLUDES;
    }

    if (!listenersBound) {
      listenersBound = true;
      fromSelect?.addEventListener('change', syncUi);
      toSelect?.addEventListener('change', syncUi);
      includesInput?.addEventListener('input', syncUi);
      runBtn?.addEventListener('click', () => {
        runImport();
      });
      closeBtn?.addEventListener('click', () => setModalOpen(false));
      modal?.addEventListener('click', (event) => {
        if (event.target === modal) setModalOpen(false);
      });
    }

    initialized = Boolean(modal && fromSelect && toSelect);
    syncUi();
    loadSupportedPairsFromApi().then(() => syncUi()).catch(() => {});
  }

  function syncImagesImportButton(assetType) {
    const btn = document.getElementById('openAssetFieldImportBtn');
    if (!btn) return;
    const show = String(assetType || '').trim() === 'Image';
    btn.classList.toggle('hidden', !show);
  }

  return {
    init,
    ensureInitialized,
    openModal,
    syncImagesImportButton,
    loadSupportedPairsFromApi,
    DEFAULT_INCLUDES,
  };
})();
