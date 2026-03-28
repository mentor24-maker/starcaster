/**
 * public/js/acquire.js
 * Acquire jobs table, direct web acquire, and OpenClaw job lifecycle actions.
 */

window.App = window.App || {};
App.acquire = (function () {
  const { state, els, api, notify, setPreview, prettyJson } = App;
  let redditHarvestProgressTimer = null;
  let lastRedditDiscoveryResult = null;
  let lastBlueskyDiscoveryResult = null;
  let blueskyDiscoverySelectedPostUrls = new Set();
  const BLUESKY_DISCOVERY_FEEDBACK_KEY_PREFIX = 'alphire:bluesky:discovery-feedback:';
  const BLUESKY_REPLY_FEEDBACK_KEY_PREFIX = 'alphire:bluesky:reply-feedback:';
  const YT_MINER_RESPONSE_CONTEXT_KEY = 'yt_miner_response_context_v1';
  const YT_MINER_RESPONSE_GUIDELINES_KEY = 'yt_miner_response_guidelines_v1';
  const DIRECT_ACQUIRE_KEYWORD_EXCLUSIONS_KEY = 'alphire:direct-acquire:keyword-exclusions:v1';
  const DIRECT_ACQUIRE_KEYWORD_REASONS_KEY = 'alphire:direct-acquire:keyword-exclusion-reasons:v1';
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
      const checkbox = row.querySelector('input[type="checkbox"][data-keyword]');
      const select = row.querySelector('select[data-keyword-reason]');
      if (!checkbox) return;
      const label = String(checkbox.dataset.keyword || '').trim();
      const normalized = normalizeDirectAcquireKeyword(label);
      if (!normalized || !label) return;
      if (checkbox.checked) {
        const reason = String(select && select.value || 'brand').trim() || 'brand';
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

  function upsertHarvestJobState(job) {
    if (!job || !job.id) return;
    const idx = state.acquireJobs.findIndex((j) => String(j.id) === String(job.id));
    if (idx >= 0) {
      state.acquireJobs[idx] = { ...state.acquireJobs[idx], ...job };
    } else {
      state.acquireJobs.unshift(job);
    }
    state.acquireJobs.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  function deriveHarvestJobFromResponse(built, response) {
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

  function renderHarvestJobsTable() {
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

      actionsTd.appendChild(mkBtn('Run', () => runHarvestRowSequence(job), !isBusy && isActionAllowed(stageValue, 'run')));
      actionsTd.appendChild(mkBtn('Status',  () => runHarvestRowAction('job_status',  job), !isBusy));
      actionsTd.appendChild(mkBtn('Preview', () => runHarvestRowAction('preview_job', job), !isBusy && isActionAllowed(stageValue, 'preview_job')));
      actionsTd.appendChild(mkBtn('Approve', () => runHarvestRowAction('approve_job', job), !isBusy && isActionAllowed(stageValue, 'approve_job')));
      actionsTd.appendChild(mkBtn('Execute', () => runHarvestRowAction('execute_job', job), !isBusy && isActionAllowed(stageValue, 'execute_job')));
      actionsTd.appendChild(mkBtn('Delete', async () => {
        if (!confirm(`Delete ${job.id} from jobs list?`)) return;
        try {
          await api(`/api/acquire/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
          state.acquireJobs = state.acquireJobs.filter((j) => String(j.id) !== String(job.id));
          renderHarvestJobsTable();
          notify(`Deleted ${job.id}`);
        } catch (err) { notify(err.message, true); }
      }, !isBusy));

      tr.appendChild(actionsTd);
      els.acquireJobsTable.appendChild(tr);
    });
  }

  function renderDirectHarvestRunsTable() {
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
      tr.addEventListener('click', () => loadDirectHarvestRun(run.run_id).catch((e) => notify(e.message, true)));
      [run.run_id||'-', run.source_url||'-', String(run.pages_succeeded??'-'), String(run.pages_failed??'-'), run.finished_at||'-']
        .forEach((text) => { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); });
      els.directAcquireRunsTable.appendChild(tr);
    });
  }

  function renderDirectHarvestPagesTable() {
    if (!els.directAcquirePagesTable) return;
    els.directAcquirePagesTable.innerHTML = '';
    const run = state.directAcquireCurrentRun;
    const pages = Array.isArray(run?.pages) ? run.pages : [];
    if (!pages.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 5; td.textContent = 'No parsed pages loaded yet.';
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
    renderDirectAcquireContactTable();
    renderDirectAcquireKeywordTable();
    renderDirectAcquireImageGallery();
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
    const exclusionSet = new Set(
      splitDirectAcquireKeywordExclusions(document.getElementById('directAcquireKeywordExclusionsInput')?.value)
        .map((value) => normalizeDirectAcquireKeyword(value))
        .filter(Boolean)
    );
    const reasonMap = readDirectAcquireKeywordReasons();
    if (!labels.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    labels.forEach(([keyword, score]) => {
      const tr = document.createElement('tr');
      const normalized = normalizeDirectAcquireKeyword(keyword);
      const selected = exclusionSet.has(normalized);
      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected;
      checkbox.dataset.keyword = String(keyword || '').trim();
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          const reasonSelect = tr.querySelector('select[data-keyword-reason]');
          if (reasonSelect && !String(reasonSelect.value || '').trim()) reasonSelect.value = 'brand';
        }
        syncDirectAcquireKeywordExclusionsFromTable();
        renderDirectAcquireKeywordTable();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);
      const keywordTd = document.createElement('td');
      keywordTd.className = 'direct-acquire-contact-label';
      keywordTd.textContent = String(keyword || '');
      const scoreTd = document.createElement('td');
      const numericScore = Number(score || 0) || 0;
      scoreTd.textContent = numericScore ? numericScore.toFixed(1) : '0.0';
      const reasonTd = document.createElement('td');
      const reasonSelect = document.createElement('select');
      reasonSelect.dataset.keywordReason = 'true';
      reasonSelect.dataset.keyword = String(keyword || '').trim();
      DIRECT_ACQUIRE_KEYWORD_REASON_OPTIONS.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        if (String(value) === String(reasonMap[normalized] || (selected ? 'brand' : ''))) {
          option.selected = true;
        }
        reasonSelect.appendChild(option);
      });
      reasonSelect.addEventListener('change', () => {
        if (String(reasonSelect.value || '').trim()) {
          checkbox.checked = true;
        }
        if (!String(reasonSelect.value || '').trim()) {
          checkbox.checked = false;
        }
        syncDirectAcquireKeywordExclusionsFromTable();
        renderDirectAcquireKeywordTable();
      });
      reasonTd.appendChild(reasonSelect);
      tr.appendChild(keywordTd);
      tr.appendChild(scoreTd);
      tr.appendChild(reasonTd);
      tableBody.appendChild(tr);
    });
    if (selectAll) {
      const checkboxes = Array.from(tableBody.querySelectorAll('input[type="checkbox"][data-keyword]'));
      const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
      selectAll.checked = !!checkboxes.length && checkedCount === checkboxes.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    }
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

  function estimateRedditHarvestSeconds(payload) {
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

  function setRedditHarvestProgress(percent, text) {
    const wrap = document.getElementById('redditHarvestProgressWrap');
    const bar = document.getElementById('redditHarvestProgressBar');
    const label = document.getElementById('redditHarvestProgressText');
    if (!wrap || !bar || !label) return;
    wrap.classList.remove('hidden');
    bar.value = Math.max(0, Math.min(100, Number(percent) || 0));
    label.textContent = String(text || '').trim() || 'Running…';
  }

  function clearRedditHarvestProgress() {
    if (redditHarvestProgressTimer) {
      clearInterval(redditHarvestProgressTimer);
      redditHarvestProgressTimer = null;
    }
  }

  function beginRedditHarvestProgress(payload) {
    clearRedditHarvestProgress();
    const startedAt = Date.now();
    const estimateSeconds = estimateRedditHarvestSeconds(payload);
    setRedditHarvestProgress(4, 'Queued request (phase 1 of 3)…');
    setRedditHarvestProgress(12, `Running OpenClaw harvest (phase 2 of 3)… ~${estimateSeconds}s remaining (estimated)`);
    redditHarvestProgressTimer = setInterval(() => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const remainingSeconds = Math.max(0, estimateSeconds - elapsedSeconds);
      const ratio = estimateSeconds > 0 ? Math.min(1, elapsedSeconds / estimateSeconds) : 0;
      const pct = Math.min(92, 12 + Math.round(ratio * 80));
      const eta = remainingSeconds > 0 ? `~${remainingSeconds}s remaining (estimated)` : 'finalizing…';
      setRedditHarvestProgress(pct, `Running OpenClaw harvest (phase 2 of 3)… ${eta}`);
    }, 1000);
    return {
      finishSuccess() {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        clearRedditHarvestProgress();
        setRedditHarvestProgress(100, `Completed in ${elapsedSeconds}s.`);
      },
      finishError(message) {
        clearRedditHarvestProgress();
        setRedditHarvestProgress(100, `Stopped: ${safeText(message) || 'request failed'}`);
      },
    };
  }

  function renderXHarvestItemsTable() {
    if (!els.xHarvestItemsTable) return;
    els.xHarvestItemsTable.innerHTML = '';
    const run = state.xHarvestCurrentRun;
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
      els.xHarvestItemsTable.appendChild(tr);
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
        els.xHarvestItemsTable.appendChild(tr);
      });
    }

    if (els.xHarvestRawPreview) {
      els.xHarvestRawPreview.textContent = run ? prettyJson(run) : '{}';
    }
  }

  function renderRedditHarvestItemsTable() {
    if (!els.redditHarvestItemsTable) return;
    els.redditHarvestItemsTable.innerHTML = '';
    const run = state.redditHarvestCurrentRun;
    const result = run && run.result ? run.result : null;
    const posts = Array.isArray(result && result.posts) ? result.posts : [];
    const primaryPost = (result && result.post) ? result.post : (posts[0] || null);
    App.setKeyValueRows(els.redditHarvestPostDetailsBody, primaryPost ? [
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
      els.redditHarvestItemsTable.appendChild(tr);
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
        els.redditHarvestItemsTable.appendChild(tr);
      });
    }

    if (els.redditHarvestRawPreview) {
      els.redditHarvestRawPreview.textContent = run ? prettyJson(run) : '{}';
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
      popQualitySelect.innerHTML = '<option value="0">0 (unset)</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>';
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
      promptSummary.innerHTML =
        `<strong>Training Context:</strong> ${contextLoaded ? 'Loaded' : 'Missing'}<br>` +
        `<span>${contextExcerpt}</span><br><br>` +
        `<strong>Guidelines:</strong> ${guidelinesLoaded ? 'Loaded' : 'Missing'}<br>` +
        `<span>${guidelinesExcerpt}</span>`;
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
      popQuality.innerHTML = '<option value="0">0 (unset)</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>';
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
      const harvestBtn = App.makeIconButton('copy', 'Use In Harvest', () => {
        const harvestTarget = document.getElementById('redditHarvestTarget');
        const discoveryTarget = document.getElementById('redditDiscoveryTarget');
        const replyTarget = document.getElementById('redditReplyTarget');
        const nextValue = String(item.discussion_url || '').trim() || String(item.subreddit ? `https://www.reddit.com/r/${item.subreddit}` : '').trim();
        if (harvestTarget) harvestTarget.value = nextValue;
        if (discoveryTarget && !discoveryTarget.value) discoveryTarget.value = nextValue;
        if (replyTarget) replyTarget.value = nextValue;
        notify('Copied Reddit thread target into harvest form');
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
      actionsTd.appendChild(harvestBtn);
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

  function renderXHarvestRunsTable() {
    if (!els.xHarvestRunsTable) return;
    els.xHarvestRunsTable.innerHTML = '';
    const runs = Array.isArray(state.xHarvestRuns) ? state.xHarvestRuns : [];
    if (!runs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No X harvest runs yet.';
      tr.appendChild(td);
      els.xHarvestRunsTable.appendChild(tr);
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
        loadXHarvestRun(run.run_id).catch((err) => notify(err.message, true));
      }, { marginRight: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete', async () => {
        if (!confirm(`Delete X run ${run.run_id}?`)) return;
        try {
          await api(`/api/acquire/x-runs/${encodeURIComponent(run.run_id)}`, { method: 'DELETE' });
          state.xHarvestRuns = state.xHarvestRuns.filter((item) => String(item.run_id) !== String(run.run_id));
          if (String(state.xHarvestCurrentRun && state.xHarvestCurrentRun.run_id || '') === String(run.run_id)) {
            state.xHarvestCurrentRun = null;
            renderXHarvestItemsTable();
          }
          renderXHarvestRunsTable();
          notify('X harvest run deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      els.xHarvestRunsTable.appendChild(tr);
    });
  }

  function renderRedditHarvestRunsTable() {
    if (!els.redditHarvestRunsTable) return;
    els.redditHarvestRunsTable.innerHTML = '';
    const runs = Array.isArray(state.redditHarvestRuns) ? state.redditHarvestRuns : [];
    if (!runs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No Reddit harvest runs yet.';
      tr.appendChild(td);
      els.redditHarvestRunsTable.appendChild(tr);
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
        loadRedditHarvestRun(run.run_id).catch((err) => notify(err.message, true));
      }, { marginRight: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete', async () => {
        if (!confirm(`Delete Reddit run ${run.run_id}?`)) return;
        try {
          await api(`/api/acquire/reddit-runs/${encodeURIComponent(run.run_id)}`, { method: 'DELETE' });
          state.redditHarvestRuns = state.redditHarvestRuns.filter((item) => String(item.run_id) !== String(run.run_id));
          if (String(state.redditHarvestCurrentRun && state.redditHarvestCurrentRun.run_id || '') === String(run.run_id)) {
            state.redditHarvestCurrentRun = null;
            renderRedditHarvestItemsTable();
          }
          renderRedditHarvestRunsTable();
          notify('Reddit harvest run deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      els.redditHarvestRunsTable.appendChild(tr);
    });
  }

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  async function refreshHarvestJobs() {
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
    renderHarvestJobsTable();
  }

  async function refreshDirectHarvestRuns() {
    if (!els.directAcquireRunsTable) return;
    const res = await api('/api/acquire/direct-runs?limit=20');
    state.directAcquireRuns = Array.isArray(res.runs) ? res.runs : [];
    renderDirectHarvestRunsTable();
  }

  async function refreshXHarvestRuns() {
    if (!els.xHarvestRunsTable) return;
    const res = await api('/api/acquire/x-runs?limit=50');
    state.xHarvestRuns = Array.isArray(res.runs) ? res.runs : [];
    renderXHarvestRunsTable();
  }

  async function refreshRedditHarvestRuns() {
    if (!els.redditHarvestRunsTable) return;
    const res = await api('/api/acquire/reddit-runs?limit=50');
    state.redditHarvestRuns = Array.isArray(res.runs) ? res.runs : [];
    renderRedditHarvestRunsTable();
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

  async function loadDirectHarvestRun(runId) {
    const res = await api(`/api/acquire/direct-runs/${encodeURIComponent(runId)}`);
    state.directAcquireCurrentRun = res.run || null;
    directAcquireSelectedImages = new Set();
    directAcquireImageCategoryByUrl = new Map();
    directAcquireImagesExpanded = false;
    renderDirectHarvestPagesTable();
  }

  async function loadXHarvestRun(runId) {
    const res = await api(`/api/acquire/x-runs/${encodeURIComponent(runId)}`);
    state.xHarvestCurrentRun = res.run || null;
    renderXHarvestItemsTable();
  }

  async function loadRedditHarvestRun(runId) {
    const res = await api(`/api/acquire/reddit-runs/${encodeURIComponent(runId)}`);
    state.redditHarvestCurrentRun = res.run || null;
    renderRedditHarvestItemsTable();
  }

  // -------------------------------------------------------------------------
  // OpenClaw actions
  // -------------------------------------------------------------------------

  async function runHarvestRowAction(action, job) {
    const jobId = String(job?.id || '').trim();
    if (!jobId) { notify('job_id is required', true); return; }
    try {
      state.acquireBusyByJob[jobId] = true;
      renderHarvestJobsTable();
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
      const derived = deriveHarvestJobFromResponse({ action, request }, response);
      if (derived) upsertHarvestJobState(derived);
      renderHarvestJobsTable();
      await refreshHarvestJobs();
      const approvalToken = response?.result?.approval?.approval_token;
      if (approvalToken && els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = approvalToken;
      notify(`Acquire ${action} request sent`);
    } catch (err) {
      notify(err.message, true);
    } finally {
      delete state.acquireBusyByJob[jobId];
      renderHarvestJobsTable();
    }
  }

  async function runHarvestRowSequence(job) {
    const jobId = String(job?.id || '').trim();
    if (!jobId) { notify('job_id is required', true); return; }
    try {
      state.acquireBusyByJob[jobId] = true;
      renderHarvestJobsTable();

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

      const derived = deriveHarvestJobFromResponse({ action: 'execute_job', request: executeReq }, executeRes);
      if (derived) upsertHarvestJobState(derived);
      renderHarvestJobsTable();
      await refreshHarvestJobs();
      notify(`Acquire run completed for ${jobId}`);
    } catch (err) {
      notify(err.message, true);
    } finally {
      delete state.acquireBusyByJob[jobId];
      renderHarvestJobsTable();
    }
  }

  // -------------------------------------------------------------------------
  // Request builders
  // -------------------------------------------------------------------------

  function parseSourceUrls(raw) {
    return String(raw || '').split('\n').map((l) => l.trim()).filter(Boolean);
  }

  function buildHarvestRequest(formData) {
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
    renderDirectAcquireContactTable();
    renderDirectAcquireKeywordTable();
    renderDirectAcquireImageGallery();
    refreshDirectAcquireImageCategories().then(() => renderDirectAcquireImageGallery()).catch(() => {});
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
        document.querySelectorAll('#directAcquireKeywordTable input[type="checkbox"][data-keyword]').forEach((checkbox) => {
          checkbox.checked = directAcquireKeywordSelectAll.checked;
          if (directAcquireKeywordSelectAll.checked) {
            const row = checkbox.closest('tr');
            const reasonSelect = row ? row.querySelector('select[data-keyword-reason]') : null;
            if (reasonSelect && !String(reasonSelect.value || '').trim()) reasonSelect.value = 'brand';
          }
        });
        syncDirectAcquireKeywordExclusionsFromTable();
        renderDirectAcquireKeywordTable();
      });
    }
    const directAcquireApplyKeywordReasonBtn = document.getElementById('directAcquireApplyKeywordReasonBtn');
    const directAcquireKeywordBulkReason = document.getElementById('directAcquireKeywordBulkReason');
    if (directAcquireApplyKeywordReasonBtn && directAcquireKeywordBulkReason) {
      directAcquireApplyKeywordReasonBtn.addEventListener('click', function () {
        const reason = String(directAcquireKeywordBulkReason.value || '').trim();
        if (!reason) {
          notify('Select an exclusion reason first', true);
          return;
        }
        const selected = Array.from(document.querySelectorAll('#directAcquireKeywordTable input[type="checkbox"][data-keyword]:checked'));
        if (!selected.length) {
          notify('Check at least one keyword first', true);
          return;
        }
        selected.forEach((checkbox) => {
          const row = checkbox.closest('tr');
          const reasonSelect = row ? row.querySelector('select[data-keyword-reason]') : null;
          if (reasonSelect) reasonSelect.value = reason;
        });
        syncDirectAcquireKeywordExclusionsFromTable();
        renderDirectAcquireKeywordTable();
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
    clearRedditHarvestProgress();
    const redditProgressWrap = document.getElementById('redditHarvestProgressWrap');
    const redditProgressBar = document.getElementById('redditHarvestProgressBar');
    const redditProgressText = document.getElementById('redditHarvestProgressText');
    if (redditProgressWrap) redditProgressWrap.classList.remove('hidden');
    if (redditProgressBar) redditProgressBar.value = 0;
    if (redditProgressText) redditProgressText.textContent = 'Idle — ready to run Reddit harvest.';
    if (els.acquireForm) {
      els.acquireForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const built = buildHarvestRequest(new FormData(els.acquireForm));
          setPreview(els.acquireRequestPreview, built);
          const response = await api(`/api/openclaw/${built.action}`, { method: 'POST', body: JSON.stringify(built.request) });
          setPreview(els.acquireResponsePreview, response);
          const derived = deriveHarvestJobFromResponse(built, response);
          if (derived) { upsertHarvestJobState(derived); renderHarvestJobsTable(); }
          const createdId = response?.result?.job?.id;
          if (createdId && els.acquireJobIdInput) els.acquireJobIdInput.value = createdId;
          const token = response?.result?.approval?.approval_token;
          if (token && els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = token;
          await refreshHarvestJobs();
          notify(`Acquire ${built.action} request sent`);
        } catch (err) { notify(err.message, true); }
      });
    }
    if (els.acquireRefreshJobsBtn) {
      els.acquireRefreshJobsBtn.addEventListener('click', async () => {
        try { await refreshHarvestJobs(); notify('Acquire jobs refreshed'); }
        catch (err) { notify(err.message, true); }
      });
    }
    if (els.directAcquireRefreshBtn) {
      els.directAcquireRefreshBtn.addEventListener('click', async () => {
        try { await refreshDirectHarvestRuns(); notify('Direct acquire runs refreshed'); }
        catch (err) { notify(err.message, true); }
      });
    }
    if (els.directAcquireForm) {
      els.directAcquireForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const formData = new FormData(els.directAcquireForm);
          const payload = {
            source_url: String(formData.get('source_url') || '').trim(),
            max_pages: Number(formData.get('max_pages') || 5),
            body_snippet_chars: Number(formData.get('body_snippet_chars') || 600),
            capture_contact_data: formData.get('capture_contact_data') === 'on',
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
          renderDirectHarvestPagesTable();
          await refreshDirectHarvestRuns();
          notify(`Direct ingest completed (${res.run?.pages_succeeded || 0} pages parsed)`);
        } catch (err) { notify(err.message, true); }
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
    if (els.xHarvestRefreshBtn) {
      els.xHarvestRefreshBtn.addEventListener('click', async () => {
        try {
          await refreshXHarvestRuns();
          notify('X harvest runs refreshed');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    if (els.xHarvestForm) {
      els.xHarvestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const formData = new FormData(els.xHarvestForm);
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
          const res = await api('/api/acquire/x-harvest', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          state.xHarvestCurrentRun = res.run || null;
          renderXHarvestItemsTable();
          await refreshXHarvestRuns();
          notify(`X harvest complete (${(state.xHarvestCurrentRun?.stats?.total_tweets || 0)} tweets, ${(state.xHarvestCurrentRun?.stats?.total_replies || 0)} replies)`);
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    if (els.redditHarvestRefreshBtn) {
      els.redditHarvestRefreshBtn.addEventListener('click', async () => {
        try {
          await refreshRedditHarvestRuns();
          notify('Reddit harvest runs refreshed');
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
        const harvestTarget = document.getElementById('redditHarvestTarget');
        const value = String(discoveryTarget && discoveryTarget.value || '').trim();
        if (!value) {
          notify('Add a Reddit discovery target first', true);
          return;
        }
        if (harvestTarget) harvestTarget.value = value;
        const replyTarget = document.getElementById('redditReplyTarget');
        if (replyTarget) replyTarget.value = value;
        notify('Copied discovery target into harvest form');
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
          const res = await api('/api/engage/social/bluesky/auth-test');
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
          const res = await api('/api/engage/social/bluesky/auth-test');
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
    if (els.redditHarvestForm) {
      els.redditHarvestForm.addEventListener('submit', async (e) => {
        const submitBtn = els.redditHarvestForm.querySelector('button[type="submit"]');
        e.preventDefault();
        let progress = null;
        let controller = null;
        let timer = null;
        let watchdog = null;
        try {
          const formData = new FormData(els.redditHarvestForm);
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
          progress = beginRedditHarvestProgress(payload);
          controller = new AbortController();
          timer = setTimeout(() => controller.abort(), 180000);
          const apiPromise = api('/api/acquire/reddit-harvest', {
            method: 'POST',
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          const watchdogPromise = new Promise((_, reject) => {
            watchdog = setTimeout(() => reject(new Error('Reddit harvest watchdog timeout after 190s. Please retry with lower limits.')), 190000);
          });
          const res = await Promise.race([apiPromise, watchdogPromise]);
          state.redditHarvestCurrentRun = res.run || null;
          if (progress) {
            setRedditHarvestProgress(96, 'Saving harvest results (phase 3 of 3)…');
            progress.finishSuccess();
          }
          renderRedditHarvestItemsTable();
          await refreshRedditHarvestRuns();
          notify(`Reddit harvest complete (${(state.redditHarvestCurrentRun?.stats?.total_posts || 0)} posts, ${(state.redditHarvestCurrentRun?.stats?.total_comments || 0)} comments)`);
        } catch (err) {
          if (err?.name === 'AbortError') {
            err = new Error('Reddit harvest timed out after 180s. Try smaller limits (10 posts / 20 comments) and retry.');
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

    if (els.xHarvestRunsTable) {
      refreshXHarvestRuns().catch((err) => notify(err.message, true));
      renderXHarvestItemsTable();
    }
    if (els.redditHarvestRunsTable) {
      refreshRedditHarvestRuns().catch((err) => notify(err.message, true));
      renderRedditHarvestItemsTable();
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
    manifest: { id: 'acquire', label: 'Acquire', pageId: 'acquirePage' },
    init, refreshHarvestJobs, refreshDirectHarvestRuns, refreshXHarvestRuns, refreshRedditHarvestRuns, renderHarvestJobsTable
  };
})();
