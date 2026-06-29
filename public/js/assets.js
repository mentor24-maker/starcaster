window.App = window.App || {};

App.assets = (function () {
  const { state, els, api, notify } = App;
  const LEGACY_UPLOAD_MAX_BYTES = 7 * 1024 * 1024;
  let vercelBlobClientPromise = null;
  let editingAssetId = null;
  let selectedAssetIds = new Set();
  const ASSET_ASPECT_OVERRIDE_STORAGE_KEY = 'starcaster.assetAspectOverrides';
  let manualAspectOverrides = {};
  let bulkDraft = {
    asset_name: '',
    asset_type: '',
    category: '',
    aspect: '',
    tags: '',
  };
  const assetTableState = {
    sort: {
      key: 'assetName',
      dir: 'asc',
    },
  };

  function getAssetCategorySelect() {
    return els.assetCategoryInput || els.assetForm?.querySelector('select[name="category"]') || null;
  }

  function getAssetTypeSelect() {
    return els.assetTypeInput || els.assetForm?.querySelector('select[name="asset_type"]') || null;
  }

  function displayAssetType(value) {
    const type = String(value || '').trim();
    if (type === 'Lead Magnet') return 'PDF';
    return type || '-';
  }

  function isValidUrl(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    try {
      const parsed = new URL(text);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function extractDriveId(url) {
    const text = String(url || '').trim();
    if (!text) return '';
    const byPath = text.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (byPath) return byPath[1];
    try {
      const u = new URL(text);
      const byParam = u.searchParams.get('id');
      return byParam || '';
    } catch {
      return '';
    }
  }

  function toDriveDirectUrl(url) {
    const id = extractDriveId(url);
    if (!id) return '';
    return `/api/assets/drive-file/${encodeURIComponent(id)}`;
  }

  function assetImageUrl(asset, options = {}) {
    const preferThumbnail = options.preferThumbnail !== false;
    const thumbnailLocation = String(
      asset?.thumbnailLocation || asset?.thumbnailUrl || asset?.thumbnail_location || ''
    ).trim();
    const sourceLocation = String(asset?.location || '').trim();
    const location = preferThumbnail && thumbnailLocation ? thumbnailLocation : sourceLocation;
    if (!location) return '';
    return toDriveDirectUrl(location) || (isValidUrl(location) ? location : '');
  }

  function appendCell(tr, text) {
    const td = document.createElement('td');
    td.textContent = String(text || '-');
    tr.appendChild(td);
  }

  function normalizeSortText(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function syncAssetCaptionFieldVisibility(assetType) {
    const isImage = String(assetType || '').trim() === 'Image';
    document.querySelectorAll('.asset-caption-field').forEach((el) => {
      el.classList.toggle('hidden', !isImage);
    });
  }

  function updateAssetSortButtons() {
    const configs = [
      ['assetsSortNameBtn', 'assetName', 'Asset Name'],
      ['assetsSortCaptionBtn', 'caption', 'Caption'],
      ['assetsSortTypeBtn', 'assetType', 'Asset Type'],
      ['assetsSortCategoryBtn', 'category', 'Category'],
      ['assetsSortAspectBtn', 'aspect', 'Aspect'],
      ['assetsSortTagsBtn', 'tags', 'Tags'],
      ['assetsSortSizeBtn', 'size', 'Size'],
    ];

    configs.forEach(([id, key, label]) => {
      const button = document.getElementById(id);
      if (!button) return;
      const marker = assetTableState.sort.key === key
        ? (assetTableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      button.textContent = `${label}${marker}`;
    });
  }

  function getAssetSortValue(asset, key) {
    if (key === 'size') return Number(asset?.size || 0) || 0;
    if (key === 'aspect') return resolvedAssetAspect(asset);
    if (key === 'tags') {
      return Array.isArray(asset?.tags) ? asset.tags.join(', ') : '';
    }
    return String(asset?.[key] || '');
  }

  function resetBulkDraft() {
    bulkDraft = {
      asset_name: '',
      asset_type: '',
      category: '',
      aspect: '',
      tags: '',
    };
  }

  function normalizeAspect(value) {
    const key = String(value || '').trim().toLowerCase();
    return ['wide', 'square', 'tall'].includes(key) ? key : '';
  }

  function readManualAspectOverrides() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(ASSET_ASPECT_OVERRIDE_STORAGE_KEY) || '{}');
      manualAspectOverrides = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      manualAspectOverrides = {};
    }
  }

  function saveManualAspectOverrides() {
    try {
      window.localStorage.setItem(ASSET_ASPECT_OVERRIDE_STORAGE_KEY, JSON.stringify(manualAspectOverrides || {}));
    } catch (_) {}
  }

  function setManualAspectOverride(assetId, aspect) {
    const id = String(assetId || '').trim();
    const normalized = normalizeAspect(aspect);
    if (!id || !normalized) return;
    manualAspectOverrides[id] = normalized;
    saveManualAspectOverrides();
  }

  function displayAspect(value) {
    const aspect = normalizeAspect(value);
    if (aspect === 'wide') return 'Wide';
    if (aspect === 'square') return 'Square';
    if (aspect === 'tall') return 'Tall';
    return '-';
  }

  function inferAspectFromDimensions(width, height) {
    const w = Math.max(0, Number(width) || 0);
    const h = Math.max(0, Number(height) || 0);
    if (w > 0 && h > 0) {
      const ratio = w / h;
      if (ratio >= 1.2) return 'wide';
      if (ratio <= 0.82) return 'tall';
      return 'square';
    }
    return '';
  }

  function dimensionsFromAssetName(asset) {
    const text = String(asset?.assetName || asset?.asset_name || '').trim();
    const match = text.match(/(?:^|[^0-9])([1-9][0-9]{1,4})\s*[xX]\s*([1-9][0-9]{1,4})(?:[^0-9]|$)/);
    if (!match) return { width: 0, height: 0 };
    return {
      width: Number(match[1] || 0) || 0,
      height: Number(match[2] || 0) || 0,
    };
  }

  function resolvedAssetAspect(asset) {
    const manual = normalizeAspect(manualAspectOverrides[String(asset?.id || '').trim()]);
    if (manual) return manual;
    const stored = normalizeAspect(asset?.aspect);
    if (stored) return stored;
    const direct = inferAspectFromDimensions(asset?.imageWidth || asset?.image_width, asset?.imageHeight || asset?.image_height);
    if (direct) return direct;
    const thumb = inferAspectFromDimensions(asset?.thumbnailWidth || asset?.thumbnail_width, asset?.thumbnailHeight || asset?.thumbnail_height);
    if (thumb) return thumb;
    const named = dimensionsFromAssetName(asset);
    return inferAspectFromDimensions(named.width, named.height);
  }

  function isBulkMode() {
    return selectedAssetIds.size > 0;
  }

  function exitBulkMode() {
    selectedAssetIds = new Set();
    resetBulkDraft();
    syncAssetsHeaderControls();
  }

  function getSelectedAssets() {
    const byId = new Map((Array.isArray(state.assets) ? state.assets : []).map((asset) => [Number(asset.id || 0), asset]));
    return Array.from(selectedAssetIds)
      .map((id) => byId.get(Number(id || 0)))
      .filter(Boolean);
  }

  function getVisibleSelectableAssetIds() {
    return getFilteredAssets()
      .map((asset) => Number(asset.id || 0) || 0)
      .filter((id) => id > 0);
  }

  function getBulkCommonAssetType() {
    const selectedAssets = getSelectedAssets();
    if (!selectedAssets.length) return '';
    const firstType = String(selectedAssets[0]?.assetType || '').trim();
    if (!firstType) return '';
    const allMatch = selectedAssets.every((asset) => String(asset?.assetType || '').trim() === firstType);
    return allMatch ? firstType : '';
  }

  function getCategoryOptionsForType(assetType) {
    const type = String(assetType || '').trim();
    const categories = Array.isArray(state.assetCategories) ? state.assetCategories : [];
    const names = new Set();

    categories.forEach((item) => {
      if (type && String(item?.assetType || '').trim() !== type) return;
      const name = String(item?.category || '').trim();
      if (name) names.add(name);
    });

    (Array.isArray(state.assets) ? state.assets : []).forEach((asset) => {
      if (type && String(asset?.assetType || '').trim() !== type) return;
      const name = String(asset?.category || '').trim();
      if (name) names.add(name);
    });

    return Array.from(names).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  function formatBytes(bytesValue) {
    const bytes = Math.max(0, Number(bytesValue || 0) || 0);
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    const precision = value >= 100 || idx === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[idx]}`;
  }

  function getFilteredAssets() {
    const filters = state.assetsFilters || {};
    const name = String(filters.asset_name || '').trim().toLowerCase();
    const caption = String(filters.caption || '').trim().toLowerCase();
    const type = String(filters.asset_type || '').trim();
    const category = String(filters.category || '').trim().toLowerCase();
    const aspect = normalizeAspect(filters.aspect);
    const tags = String(filters.tags || '').trim().toLowerCase();
    const size = String(filters.size || '').trim().toLowerCase();

    const filtered = (state.assets || []).filter((asset) => {
      const assetName = String(asset.assetName || '').toLowerCase();
      const assetCaption = String(asset.caption || '').toLowerCase();
      const assetType = String(asset.assetType || '');
      const assetCategory = String(asset.category || '').toLowerCase();
      const assetAspect = resolvedAssetAspect(asset);
      const assetTags = Array.isArray(asset.tags) ? asset.tags.join(', ').toLowerCase() : '';
      const assetSizeRaw = String(Math.max(0, Number(asset.size || 0) || 0));
      const assetSizeFmt = formatBytes(asset.size).toLowerCase();

      if (name && !assetName.includes(name)) return false;
      if (caption && !assetCaption.includes(caption)) return false;
      if (type && assetType !== type) return false;
      if (category && assetCategory !== category) return false;
      if (aspect && assetAspect !== aspect) return false;
      if (tags && !assetTags.includes(tags)) return false;
      if (size && !assetSizeRaw.includes(size) && !assetSizeFmt.includes(size)) return false;
      return true;
    });

    const key = String(assetTableState.sort.key || '').trim();
    const dir = assetTableState.sort.dir === 'desc' ? 'desc' : 'asc';
    filtered.sort((a, b) => {
      const left = getAssetSortValue(a, key);
      const right = getAssetSortValue(b, key);
      let result = 0;
      if (key === 'size') {
        if (left !== right) result = left < right ? -1 : 1;
      } else {
        const leftText = normalizeSortText(left);
        const rightText = normalizeSortText(right);
        if (leftText !== rightText) result = leftText < rightText ? -1 : 1;
      }
      return dir === 'asc' ? result : -result;
    });

    return filtered;
  }

  function setAssetFormMode(isEditing) {
    if (els.assetFormTitle) {
      els.assetFormTitle.textContent = isEditing ? 'Edit Asset' : 'Add Asset';
    }
    if (els.assetFormSubmitBtn) {
      els.assetFormSubmitBtn.textContent = isEditing ? 'Update Asset' : 'Save Asset';
    }
  }

  function resetPreviewMedia() {
    const mediaEls = [
      els.assetPreviewImage,
      els.assetPreviewVideo,
      els.assetPreviewAudio,
      els.assetPreviewFrame,
      els.assetPreviewCopy,
      els.assetPreviewLinkRow,
    ];
    mediaEls.forEach((el) => el && el.classList.add('hidden'));
    if (els.assetPreviewImage) els.assetPreviewImage.removeAttribute('src');
    if (els.assetPreviewVideo) {
      els.assetPreviewVideo.pause();
      els.assetPreviewVideo.removeAttribute('src');
      els.assetPreviewVideo.load();
    }
    if (els.assetPreviewAudio) {
      els.assetPreviewAudio.pause();
      els.assetPreviewAudio.removeAttribute('src');
      els.assetPreviewAudio.load();
    }
    if (els.assetPreviewFrame) els.assetPreviewFrame.removeAttribute('src');
    if (els.assetPreviewCopy) els.assetPreviewCopy.textContent = '';
  }

  function renderAssetPreview(asset) {
    if (!els.assetPreviewWrap) return;
    resetPreviewMedia();

    if (!asset) {
      if (els.assetPreviewEmpty) {
        els.assetPreviewEmpty.textContent = 'Select an asset to preview.';
        els.assetPreviewEmpty.classList.remove('hidden');
      }
      return;
    }

    const type = String(asset.assetType || '').trim();
    const location = String(asset.location || '').trim();
    const direct = toDriveDirectUrl(location) || location;
    const valid = isValidUrl(location);

    if (els.assetPreviewEmpty) els.assetPreviewEmpty.classList.add('hidden');

    if (valid && els.assetPreviewLink && els.assetPreviewLinkRow) {
      els.assetPreviewLink.href = location;
      els.assetPreviewLinkRow.classList.remove('hidden');
    }

    if (type === 'Image' && valid && els.assetPreviewImage) {
      els.assetPreviewImage.src = direct;
      els.assetPreviewImage.classList.remove('hidden');
      return;
    }

    const isYouTube = location.includes('youtube.com') || location.includes('youtu.be');

    if (type === 'Video' && valid) {
      if (isYouTube && els.assetPreviewFrame) {
        let embedUrl = location;
        try {
          const u = new URL(location);
          if (!u.pathname.startsWith('/embed/')) {
            let vidId = u.searchParams.get('v');
            if (u.hostname === 'youtu.be') vidId = u.pathname.substring(1);
            if (vidId) {
              const sp = new URLSearchParams(u.search);
              sp.delete('v');
              embedUrl = `https://www.youtube.com/embed/${vidId}?${sp.toString()}`;
            }
          }
        } catch(e){}
        els.assetPreviewFrame.src = embedUrl;
        els.assetPreviewFrame.classList.remove('hidden');
        return;
      } else if (els.assetPreviewVideo && !isYouTube) {
        els.assetPreviewVideo.src = direct;
        els.assetPreviewVideo.classList.remove('hidden');
        return;
      }
    }

    if (type === 'Audio' && valid && els.assetPreviewAudio) {
      els.assetPreviewAudio.src = direct;
      els.assetPreviewAudio.classList.remove('hidden');
      return;
    }

    if (valid && els.assetPreviewFrame) {
      els.assetPreviewFrame.src = location;
      els.assetPreviewFrame.classList.remove('hidden');
      return;
    }

    if (els.assetPreviewEmpty) {
      els.assetPreviewEmpty.textContent = 'Preview is not available for this asset.';
      els.assetPreviewEmpty.classList.remove('hidden');
    }
  }

  function resetAssetForm() {
    editingAssetId = null;
    if (els.assetForm) els.assetForm.reset();
    syncAssetCaptionFieldVisibility('');
    renderCategoryOptionsByType('', '');
    renderAssetTopicOptions('');
    if (els.assetIdInput) els.assetIdInput.value = '';
    if (els.assetLocationText) els.assetLocationText.textContent = '-';
    if (els.assetLocationRow) els.assetLocationRow.classList.add('hidden');
    if (els.assetDimensionsText) els.assetDimensionsText.textContent = '-';
    if (els.assetDimensionsRow) els.assetDimensionsRow.classList.add('hidden');
    if (els.assetSizeText) els.assetSizeText.textContent = '-';
    if (els.assetSizeRow) els.assetSizeRow.classList.add('hidden');
    renderAssetPreview(null);
    setAssetFormMode(false);
    App.assetImageEditor?.close?.();
  }

  function renderCategoryOptionsByType(assetType, selectedCategory) {
    const select = getAssetCategorySelect();
    if (!select) return;
    const type = String(assetType || '').trim();
    const selected = String(selectedCategory || '').trim();
    const options = getCategoryOptionsForType(type);

    if (selected && !options.includes(selected)) {
      options.push(selected);
    }

    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select Category';
    select.appendChild(placeholder);

    options.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });

    select.value = selected || '';
  }

  async function renderAssetTopicOptions(selectedTopic = '') {
    const select = els.assetForm?.topic;
    if (!select) return;
    const selected = String(selectedTopic || '').trim();
    const topics = new Set();

    try {
      if (App.ui && typeof App.ui.ensureMessagingTopicsLoaded === 'function') {
        const loaded = await App.ui.ensureMessagingTopicsLoaded();
        (Array.isArray(loaded) ? loaded : []).forEach((topic) => {
          const name = String(topic || '').trim();
          if (name) topics.add(name);
        });
      }
    } catch (_) {}

    (Array.isArray(state.assets) ? state.assets : []).forEach((asset) => {
      const name = String(asset?.topic || '').trim();
      if (name) topics.add(name);
    });

    if (selected) topics.add(selected);

    const options = Array.from(topics).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select Topic';
    select.appendChild(placeholder);

    options.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });

    select.value = selected && options.includes(selected) ? selected : '';
  }

  function renderUploadCategorySelect(select, assetType, selectedCategory) {
    if (!select) return;
    const type = String(assetType || '').trim();
    const selected = String(selectedCategory || '').trim();
    const options = getCategoryOptionsForType(type);

    if (selected && !options.includes(selected)) options.push(selected);

    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select Category';
    select.appendChild(placeholder);

    options.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });

    select.value = selected || '';
  }

  function renderUploadCategoryOptionsByType(assetType, selectedCategory) {
    renderUploadCategorySelect(els.assetUploadCategory, assetType, selectedCategory);
  }

  function renderMultiUploadCategoryOptionsByType(assetType, selectedCategory) {
    renderUploadCategorySelect(els.assetMultiUploadCategory, assetType, selectedCategory);
  }

  function renderDriveFolderCategoryOptions(selectedCategory) {
    renderUploadCategorySelect(els.assetDriveFolderCategory, 'Image', selectedCategory);
  }

  function inferAssetTypeFromCategory(category) {
    const targetCategory = String(category || '').trim();
    if (!targetCategory) return '';

    const matchingTypes = Array.from(new Set(
      (Array.isArray(state.assetCategories) ? state.assetCategories : [])
        .filter((item) => String(item?.category || '').trim() === targetCategory)
        .map((item) => String(item?.assetType || '').trim())
        .filter(Boolean)
    ));

    return matchingTypes.length === 1 ? matchingTypes[0] : '';
  }

  function getActiveUploadDefaults() {
    const activeType = String(state.assetsFilters?.asset_type || '').trim();
    const activeCategory = String(state.assetsFilters?.category || '').trim();
    return {
      assetType: activeType || inferAssetTypeFromCategory(activeCategory),
      category: activeCategory,
      aspect: normalizeAspect(state.assetsFilters?.aspect),
    };
  }

  function prefillUploadFormsFromActiveFilters() {
    const defaults = getActiveUploadDefaults();

    if (els.assetUploadType) {
      els.assetUploadType.value = defaults.assetType || '';
    }
    renderUploadCategoryOptionsByType(defaults.assetType, defaults.category);

    if (els.assetMultiUploadType) {
      els.assetMultiUploadType.value = defaults.assetType || '';
    }
    renderMultiUploadCategoryOptionsByType(defaults.assetType, defaults.category);
    if (els.assetMultiUploadAspect) {
      els.assetMultiUploadAspect.value = defaults.aspect || '';
    }
    renderDriveFolderCategoryOptions(defaults.category);
  }

  function renderAssetFilterCategoryOptions(assetType, selectedCategory, config = {}) {
    const select = els.assetsFilterCategory;
    if (!select) return;

    const type = String(assetType || '').trim();
    const selected = String(selectedCategory || '').trim();
    const bulkMode = Boolean(config.bulkMode);
    const categoryOptions = [];

    if (type) {
      const categorySet = new Set();
      getCategoryOptionsForType(type).forEach((name) => categorySet.add(name));

      (Array.isArray(state.assets) ? state.assets : []).forEach((asset) => {
        if (String(asset?.assetType || '').trim() !== type) return;
        const category = String(asset?.category || '').trim();
        if (category) categorySet.add(category);
      });

      if (selected) categorySet.add(selected);
      categoryOptions.push(...Array.from(categorySet.values()));
    } else if (selected) {
      categoryOptions.push(selected);
    }

    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = bulkMode
      ? (type ? 'Leave Category Unchanged' : 'Select Asset Type First')
      : (type ? 'All Categories' : 'Select Asset Type First');
    select.appendChild(placeholder);

    categoryOptions.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });

    select.disabled = !type && !selected;
    if (selected && categoryOptions.includes(selected)) {
      select.value = selected;
    } else {
      select.value = '';
    }
  }

  function syncAssetsHeaderControls() {
    const bulkMode = isBulkMode();
    const visibleIds = getVisibleSelectableAssetIds();
    const selectedVisibleCount = visibleIds.filter((id) => selectedAssetIds.has(id)).length;

    if (els.assetsSelectAllVisible) {
      els.assetsSelectAllVisible.checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
      els.assetsSelectAllVisible.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
      els.assetsSelectAllVisible.disabled = visibleIds.length === 0;
    }

    if (els.assetsBulkEditBtn) els.assetsBulkEditBtn.disabled = !bulkMode;
    if (els.assetsBulkResizeBtn) els.assetsBulkResizeBtn.disabled = !bulkMode;
    if (els.assetsBulkDeleteBtn) els.assetsBulkDeleteBtn.disabled = !bulkMode;
    if (els.assetsFilterActionRow) els.assetsFilterActionRow.classList.toggle('hidden', bulkMode);
    if (els.assetsBulkActionRow) els.assetsBulkActionRow.classList.toggle('hidden', !bulkMode);
    if (!bulkMode) closeBulkResizePanel();

    if (!els.assetsFilterName || !els.assetsFilterType || !els.assetsFilterTags) return;

    if (bulkMode) {
      els.assetsFilterName.placeholder = 'Asset Name (leave unchanged)';
      els.assetsFilterTags.placeholder = 'Tags (comma-separated, leave unchanged)';
      if (els.assetsFilterType.options[0]) els.assetsFilterType.options[0].textContent = 'Asset Type (leave unchanged)';
      if (els.assetsFilterAspect?.options?.[0]) els.assetsFilterAspect.options[0].textContent = 'Aspect (leave unchanged)';

      els.assetsFilterName.value = bulkDraft.asset_name;
      els.assetsFilterType.value = bulkDraft.asset_type;
      if (els.assetsFilterAspect) els.assetsFilterAspect.value = normalizeAspect(bulkDraft.aspect);
      els.assetsFilterTags.value = bulkDraft.tags;

      const categoryType = bulkDraft.asset_type || getBulkCommonAssetType();
      renderAssetFilterCategoryOptions(categoryType, bulkDraft.category, { bulkMode: true });
      if (els.assetsFilterCategory) {
        els.assetsFilterCategory.value = bulkDraft.category && Array.from(els.assetsFilterCategory.options).some((option) => option.value === bulkDraft.category)
          ? bulkDraft.category
          : '';
      }
      return;
    }

    els.assetsFilterName.placeholder = 'Asset Name';
    els.assetsFilterTags.placeholder = 'Tags';
    if (els.assetsFilterType.options[0]) els.assetsFilterType.options[0].textContent = 'All Types';
    if (els.assetsFilterAspect?.options?.[0]) els.assetsFilterAspect.options[0].textContent = 'All Aspects';

    els.assetsFilterName.value = String(state.assetsFilters?.asset_name || '');
    if (els.assetsFilterCaption) {
      els.assetsFilterCaption.value = String(state.assetsFilters?.caption || '');
    }
    const activeType = String(state.assetsFilters?.asset_type || '').trim();
    els.assetsFilterType.value = activeType;
    if (els.assetsFilterAspect) els.assetsFilterAspect.value = normalizeAspect(state.assetsFilters?.aspect);
    els.assetsFilterTags.value = String(state.assetsFilters?.tags || '');
    renderAssetFilterCategoryOptions(
      activeType,
      String(state.assetsFilters?.category || '').trim(),
      { bulkMode: false }
    );

    const createBtn = document.getElementById('openCreateVideoToolBtn');
    const inlineCreateBtn = document.getElementById('assetsInlineCreateVideoBtn');
    if (createBtn) {
      if ((activeType === 'Video' || !activeType) && !bulkMode) {
        createBtn.classList.remove('hidden');
        if (inlineCreateBtn) inlineCreateBtn.classList.remove('hidden');
      } else {
        createBtn.classList.add('hidden');
        if (inlineCreateBtn) inlineCreateBtn.classList.add('hidden');
      }
    }
  }

  async function beginEdit(asset) {
    editingAssetId = Number(asset?.id || 0) || null;
    if (!editingAssetId) {
      notify('This asset cannot be edited yet. Run the SQL migration to add the id column.', true);
      return;
    }
    if (!els.assetForm) return;

    els.assetForm.asset_name.value = String(asset.assetName || '');
    els.assetForm.asset_type.value = String(asset.assetType || '');
    renderCategoryOptionsByType(asset.assetType, String(asset.category || ''));
    if (els.assetForm.aspect) els.assetForm.aspect.value = resolvedAssetAspect(asset);
    if (els.assetForm.topic) {
      if (els.assetForm.topic.tagName === 'SELECT') {
        await renderAssetTopicOptions(String(asset.topic || ''));
      } else {
        els.assetForm.topic.value = String(asset.topic || '');
      }
    }
    if (els.assetCaptionInput) els.assetCaptionInput.value = String(asset.caption || '');
    if (els.assetForm.comments) els.assetForm.comments.value = String(asset.comments || '');
    els.assetForm.tags.value = Array.isArray(asset.tags) ? asset.tags.join(', ') : '';
    syncAssetCaptionFieldVisibility(asset.assetType);
    if (els.assetIdInput) {
      els.assetIdInput.value = String(editingAssetId);
    }
    if (els.assetLocationText) {
      els.assetLocationText.innerHTML = '';
      const location = String(asset.location || '').trim();
      if (isValidUrl(location)) {
        let displayUrl = location;
        try {
          const u = new URL(location);
          if (u.hostname.includes('youtube.com') && u.pathname.startsWith('/embed/')) {
            const vidId = u.pathname.replace('/embed/', '');
            const out = new URL('https://www.youtube.com/watch');
            out.searchParams.set('v', vidId);
            for (const [k, v] of u.searchParams.entries()) {
              out.searchParams.set(k, v);
            }
            displayUrl = out.toString();
          }
        } catch(e){}

        const link = document.createElement('a');
        link.href = displayUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = displayUrl;
        els.assetLocationText.appendChild(link);
      } else {
        els.assetLocationText.textContent = location || '-';
      }
    }
    if (els.assetLocationRow) els.assetLocationRow.classList.remove('hidden');
    const width = Math.max(0, Number(asset.imageWidth || 0) || 0);
    const height = Math.max(0, Number(asset.imageHeight || 0) || 0);
    if (width > 0 && height > 0) {
      if (els.assetDimensionsText) els.assetDimensionsText.textContent = `${width} x ${height}`;
      if (els.assetDimensionsRow) els.assetDimensionsRow.classList.remove('hidden');
    } else {
      if (els.assetDimensionsText) els.assetDimensionsText.textContent = '-';
      if (els.assetDimensionsRow) els.assetDimensionsRow.classList.add('hidden');
    }
    if (els.assetSizeText) {
      const bytes = Math.max(0, Number(asset.size || 0) || 0);
      els.assetSizeText.textContent = `${formatBytes(bytes)} (${bytes} B)`;
    }
    if (els.assetSizeRow) els.assetSizeRow.classList.remove('hidden');
    renderAssetPreview(asset);
    setAssetFormMode(true);
    if (String(asset.assetType || '').trim() === 'Image') {
      App.assetImageEditor?.openForAsset?.(asset, assetImageUrl(asset, { preferThumbnail: false }));
    } else {
      App.assetImageEditor?.close?.();
    }
    App.setActivePage('addAssetPage');
  }

  async function deleteById(assetId) {
    const id = Number(assetId || 0);
    if (!id) {
      notify('This asset cannot be deleted yet. Run the SQL migration to add the id column.', true);
      return;
    }
    if (!confirm('Delete this asset?')) return;

    try {
      await api(`/api/assets/${id}`, { method: 'DELETE' });
      notify('Asset deleted');
      await refresh();
    } catch (err) {
      notify(err.message, true);
    }
  }

  function renderAssets() {
    if (!els.assetsTable) return;
    els.assetsTable.innerHTML = '';
    updateAssetSortButtons();

    const filteredAssets = getFilteredAssets();
    const validIds = new Set((Array.isArray(state.assets) ? state.assets : []).map((asset) => Number(asset.id || 0)).filter((id) => id > 0));
    selectedAssetIds = new Set(Array.from(selectedAssetIds).filter((id) => validIds.has(id)));

    filteredAssets.forEach((asset) => {
      const tr = document.createElement('tr');
      const assetId = Number(asset.id || 0) || 0;

      const selectTd = document.createElement('td');
      if (assetId > 0) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'assets-select-checkbox';
        checkbox.checked = selectedAssetIds.has(assetId);
        checkbox.setAttribute('aria-label', `Select asset ${asset.assetName || assetId}`);
        checkbox.addEventListener('change', () => {
          const wasBulkMode = isBulkMode();
          if (checkbox.checked) {
            selectedAssetIds.add(assetId);
            if (!wasBulkMode) resetBulkDraft();
          } else {
            selectedAssetIds.delete(assetId);
            if (!isBulkMode()) resetBulkDraft();
          }
          syncAssetsHeaderControls();
        });
        selectTd.appendChild(checkbox);
      } else {
        selectTd.textContent = '-';
      }
      tr.appendChild(selectTd);

      const thumbnailTd = document.createElement('td');
      const assetTypeText = String(asset.assetType || '').trim();
      const location = String(asset.location || '').trim();
      const directImageUrl = assetImageUrl(asset);
      if (assetTypeText === 'Image' && directImageUrl) {
        const img = document.createElement('img');
        img.src = directImageUrl;
        img.alt = String(asset.assetName || 'Asset thumbnail');
        img.style.height = '50px';
        img.style.width = 'auto';
        img.style.display = 'block';
        thumbnailTd.appendChild(img);
      } else {
        thumbnailTd.textContent = '-';
      }
      tr.appendChild(thumbnailTd);

      const nameTd = document.createElement('td');
      const nameText = String(asset.assetName || '-');
      if (isValidUrl(location)) {
        const link = document.createElement('a');
        link.href = location;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = nameText;
        nameTd.appendChild(link);
      } else {
        nameTd.textContent = nameText;
      }
      tr.appendChild(nameTd);

      appendCell(tr, asset.imageWidth > 0 ? String(asset.imageWidth) : '-');
      appendCell(tr, asset.imageHeight > 0 ? String(asset.imageHeight) : '-');

      appendCell(tr, displayAssetType(asset.assetType));
      appendCell(tr, asset.category);
      appendCell(tr, displayAspect(resolvedAssetAspect(asset)));
      const createdAt = String(asset.createdAt || '').trim();
      appendCell(tr, createdAt ? new Date(createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '-');
      appendCell(tr, formatBytes(asset.size));

      const actionsTd = document.createElement('td');
      if (assetId > 0) {
        const linkBtn = App.makeIconButton('link', 'Associations', () => {
          if (App.assetAssociations?.openModal) App.assetAssociations.openModal(asset);
        });
        const editBtn = App.makeIconButton('edit', 'Edit Asset', () => beginEdit(asset));
        const deleteBtn = App.makeIconButton('delete', 'Delete Asset', () => deleteById(assetId), { danger: true });
        App.finishTableActionsCell(actionsTd, linkBtn, editBtn, deleteBtn);
      } else {
        actionsTd.classList.add('actions-col');
        actionsTd.textContent = '-';
      }
      tr.appendChild(actionsTd);

      els.assetsTable.appendChild(tr);
    });

    syncAssetsHeaderControls();
  }

  function toggleUploadPanel(show) {
    if (!els.assetUploadPanel) return;
    els.assetUploadPanel.classList.toggle('hidden', !show);
  }

  function bytesToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  async function getVercelBlobClient() {
    if (!vercelBlobClientPromise) {
      vercelBlobClientPromise = import('https://esm.sh/@vercel/blob/client?bundle');
    }
    return vercelBlobClientPromise;
  }

  function isImageMimeType(mimeType) {
    return String(mimeType || '').toLowerCase().startsWith('image/');
  }

  function isImageUploadFile(file) {
    if (!file) return false;
    const mime = String(file.type || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(String(file.name || ''));
  }

  function setBulkImportProgress(visible, text, value, max) {
    const wrap = document.getElementById('assetMultiUploadProgressWrap');
    const label = document.getElementById('assetMultiUploadProgressText');
    const bar = document.getElementById('assetMultiUploadProgressBar');
    if (wrap) wrap.classList.toggle('hidden', !visible);
    if (label && text) label.textContent = text;
    if (bar) {
      bar.max = Math.max(1, Number(max || 1));
      bar.value = Math.max(0, Number(value || 0));
    }
  }

  function setDriveFolderImportProgress(visible, text, value, max) {
    const wrap = document.getElementById('assetDriveFolderProgressWrap');
    const label = document.getElementById('assetDriveFolderProgressText');
    const bar = document.getElementById('assetDriveFolderProgressBar');
    if (wrap) wrap.classList.toggle('hidden', !visible);
    if (label && text) label.textContent = text;
    if (bar) {
      if (max == null) {
        bar.removeAttribute('value');
        bar.removeAttribute('max');
      } else {
        bar.max = Math.max(1, Number(max || 1));
        bar.value = Math.max(0, Number(value || 0));
      }
    }
  }

  async function importImageFile(file, options) {
    if (!file) throw new Error('Choose a file to upload');
    if (!isImageUploadFile(file)) {
      throw new Error('Bulk image import only accepts image files');
    }
    if (file.size > LEGACY_UPLOAD_MAX_BYTES) {
      throw new Error('Upload limit is 7MB per image in this version');
    }

    const fileBuffer = await file.arrayBuffer();
    const aspect = normalizeAspect(options?.aspect);
    const payload = {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileBase64: bytesToBase64(fileBuffer),
      assetName: String(options?.assetName || '').trim() || file.name,
      category: String(options?.category || '').trim(),
      tags: Array.isArray(options?.tags) ? options.tags : [],
    };
    if (aspect) payload.aspect = aspect;

    const result = await api('/api/assets/import-image', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return result;
  }

  async function uploadFileToDrive(file, options) {
    if (!file) throw new Error('Choose a file to upload');
    const assetType = String(options?.assetType || '').trim();
    if (!assetType) throw new Error('Asset Type is required');
    if (assetType !== 'Video' && file.size > LEGACY_UPLOAD_MAX_BYTES) {
      throw new Error('Upload limit is 7MB per file for this asset type in this version');
    }

    if (assetType === 'Image' && isImageUploadFile(file)) {
      return importImageFile(file, options);
    }

    const fileBuffer = await file.arrayBuffer();
    const payload = {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileBase64: bytesToBase64(fileBuffer),
      fileSize: Number(file.size || 0),
      assetType,
      assetName: String(options?.assetName || '').trim() || file.name,
      category: String(options?.category || '').trim(),
      tags: Array.isArray(options?.tags) ? options.tags : [],
    };

    await api('/api/assets/upload-google-drive', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function uploadFileToBlobClient(file, options) {
    if (!file) throw new Error('Choose a file to upload');
    const assetType = String(options?.assetType || '').trim();
    if (!assetType) throw new Error('Asset Type is required');
    const assetName = String(options?.assetName || '').trim() || file.name;
    const category = String(options?.category || '').trim();
    const tags = Array.isArray(options?.tags) ? options.tags : [];
    const { upload } = await getVercelBlobClient();
    const blob = await upload(file.name, file, {
      access: 'public',
      handleUploadUrl: '/api/assets/blob-upload',
      multipart: true,
      clientPayload: JSON.stringify({
        fileName: file.name,
        assetType,
        assetName,
        category,
        tags,
      }),
    });
    const created = await api('/api/assets', {
      method: 'POST',
      body: JSON.stringify({
        assetName,
        assetType,
        category,
        location: String(blob?.url || '').trim(),
        tags,
        size: Number(file.size || 0) || 0,
      }),
    });
    return created?.asset || created?.data || null;
  }

  async function refresh() {
    if (!els.assetsTable) return;
    const [assetsRes, categoriesRes] = await Promise.allSettled([
      api('/api/assets'),
      api('/api/asset-categories'),
    ]);

    if (assetsRes.status === 'fulfilled') {
      state.assets = assetsRes.value.assets || [];
    } else {
      const reason = assetsRes.reason || new Error('Failed to load assets');
      const msg = String(reason?.message || reason || '');
      if (/failed to fetch|networkerror|load failed/i.test(msg)) {
        throw new Error(
          'Cannot reach the API. Start the dev server (npm run dev) and open the app on the same port shown in the terminal (often http://localhost:3001).'
        );
      }
      throw reason;
    }

    if (categoriesRes.status === 'fulfilled') {
      state.assetCategories = categoriesRes.value.categories || [];
    }

    renderAssets();
    prefillUploadFormsFromActiveFilters();
  }

  async function openAssetsLanding() {
    App.setActivePage('assetsPage');
    
    const overview = document.getElementById('assetsOverviewSection');
    const tbSection = document.getElementById('assetsTableSection');
    if(overview) overview.classList.remove('hidden');
    if(tbSection) tbSection.classList.add('hidden');
    
    const panel = document.getElementById('assetUploadPanel');
    if (panel) panel.classList.add('hidden');
    
    const hdr = document.getElementById('assetsPageHeading');
    if(hdr) hdr.textContent = 'Assets';
    const sub = document.getElementById('assetsPageSubtitle');
    if(sub) sub.textContent = 'Manage the reusable media and physical files that support campaigns, pages, and publishing sequences.';

    const btns = document.querySelectorAll('.assets-header-action-btn');
    btns.forEach(b => b.classList.add('hidden'));
    App.assetFieldImport?.syncImagesImportButton?.('');

    try {
      await refresh();
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function openAssetsManager(assetType = '', category = '') {
    const nextType = String(assetType || '').trim();
    const nextCategory = String(category || '').trim();
    if (state.assetsFilters) {
      state.assetsFilters.asset_name = '';
      state.assetsFilters.asset_type = nextType;
      state.assetsFilters.category = nextCategory;
      state.assetsFilters.tags = '';
    }
    if (els.assetsFilterName) {
      els.assetsFilterName.value = '';
    }
    if (els.assetsFilterType) {
      els.assetsFilterType.value = nextType;
    }
    renderAssetFilterCategoryOptions(nextType, nextCategory);
    if (els.assetsFilterCategory) {
      const options = Array.from(els.assetsFilterCategory.options || []);
      els.assetsFilterCategory.value = options.some((option) => option.value === nextCategory) ? nextCategory : '';
    }
    if (els.assetsFilterTags) {
      els.assetsFilterTags.value = '';
    }
    
    const overview = document.getElementById('assetsOverviewSection');
    const tbSection = document.getElementById('assetsTableSection');
    if(overview) overview.classList.add('hidden');
    if(tbSection) tbSection.classList.remove('hidden');
    
    const hdr = document.getElementById('assetsPageHeading');
    const nextTypeSafe = String(assetType || 'All Assets').trim();
    if(hdr) hdr.textContent = `Assets: ${nextTypeSafe}`;
    
    const btns = document.querySelectorAll('.assets-header-action-btn');
    btns.forEach(b => b.classList.remove('hidden'));
    App.assetFieldImport?.syncImagesImportButton?.(nextType);

    App.setActivePage('assetsPage');
    try {
      await refresh();
    } catch (err) {
      notify(err.message, true);
    }
  }

  function openBulkResizePanel() {
    if (!els.assetsBulkResizePanel) return;
    const selected = getSelectedAssets().filter((a) => String(a.assetType || '') === 'Image');
    const count = selected.length;
    if (els.bulkResizeRunBtn) els.bulkResizeRunBtn.textContent = `Resize ${count} Image${count === 1 ? '' : 's'}`;
    if (els.bulkResizeStatus) els.bulkResizeStatus.textContent = '';
    if (els.bulkResizeImageList) {
      els.bulkResizeImageList.innerHTML = selected.map((asset) => {
        const thumb = assetImageUrl(asset, { preferThumbnail: true });
        const imgTag = thumb
          ? `<img src="${thumb}" alt="" class="bulk-resize-image-thumb" />`
          : `<span class="bulk-resize-image-thumb bulk-resize-image-thumb--empty"></span>`;
        return `<div class="bulk-resize-image-item">${imgTag}<span class="bulk-resize-image-name">${String(asset.assetName || '').trim() || '(unnamed)'}</span></div>`;
      }).join('');
    }
    els.assetsBulkResizePanel.classList.remove('hidden');
    els.assetsBulkResizePanel.setAttribute('aria-hidden', 'false');
    els.assetsBulkResizePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeBulkResizePanel() {
    if (!els.assetsBulkResizePanel) return;
    els.assetsBulkResizePanel.classList.add('hidden');
    els.assetsBulkResizePanel.setAttribute('aria-hidden', 'true');
  }

  async function runBulkResize() {
    const selectedAssets = getSelectedAssets().filter((a) => String(a.assetType || '') === 'Image');
    if (!selectedAssets.length) {
      notify('Select one or more image assets first', true);
      return;
    }
    const width = Math.max(0, Number(els.bulkResizeWidth?.value || 0) || 0) || null;
    const height = Math.max(0, Number(els.bulkResizeHeight?.value || 0) || 0) || null;
    if (!width && !height) {
      notify('Enter a target width or height', true);
      return;
    }
    const fit = String(els.bulkResizeFit?.value || 'inside');
    if (els.bulkResizeRunBtn) els.bulkResizeRunBtn.disabled = true;
    if (els.bulkResizeStatus) els.bulkResizeStatus.textContent = `Resizing ${selectedAssets.length} image${selectedAssets.length === 1 ? '' : 's'}…`;
    try {
      const result = await api('/api/assets/bulk-resize', {
        method: 'POST',
        body: JSON.stringify({ assetIds: selectedAssets.map((a) => a.id), width, height, fit }),
      });
      const results = result?.results || [];
      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);

      const statusParts = [`${succeeded.length} resized`];
      if (failed.length) statusParts.push(`${failed.length} failed: ${failed.map((r) => `#${r.id} ${r.error || 'unknown error'}`).join('; ')}`);
      if (els.bulkResizeStatus) els.bulkResizeStatus.textContent = statusParts.join(' · ');

      if (succeeded.length) {
        notify(`${succeeded.length} image${succeeded.length === 1 ? '' : 's'} resized`);
        exitBulkMode();
        await refresh();
      } else if (failed.length) {
        notify(failed[0].error || 'Resize failed', true);
      }
    } catch (err) {
      notify(err.message || 'Bulk resize failed', true);
      if (els.bulkResizeStatus) els.bulkResizeStatus.textContent = '';
    } finally {
      if (els.bulkResizeRunBtn) els.bulkResizeRunBtn.disabled = false;
    }
  }

  async function editSelectedAssets() {
    const selectedAssets = getSelectedAssets();
    if (!selectedAssets.length) {
      notify('Select one or more assets first', true);
      return;
    }

    const nextName = String(bulkDraft.asset_name || '').trim();
    const nextType = String(bulkDraft.asset_type || '').trim();
    const nextCategory = String(bulkDraft.category || '').trim();
    const nextAspect = normalizeAspect(bulkDraft.aspect);
    const nextTagsRaw = String(bulkDraft.tags || '').trim();
    const nextTags = nextTagsRaw
      ? nextTagsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : null;

    if (!nextName && !nextType && !nextCategory && !nextAspect && !nextTagsRaw) {
      notify('Change one or more fields before using Edit All', true);
      return;
    }

    try {
      for (const asset of selectedAssets) {
        const assetId = Number(asset.id || 0) || 0;
        if (!assetId) continue;
        const payload = {
          assetName: nextName || String(asset.assetName || '').trim(),
          assetType: nextType || String(asset.assetType || '').trim(),
          category: nextCategory || String(asset.category || '').trim(),
          aspect: nextAspect || resolvedAssetAspect(asset),
          tags: nextTags || (Array.isArray(asset.tags) ? asset.tags : []),
        };
        const updated = await api(`/api/assets/${assetId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        if (payload.aspect) setManualAspectOverride(assetId, payload.aspect);
        const updatedAsset = updated?.asset || updated?.data || null;
        if (updatedAsset?.id) {
          const idx = (state.assets || []).findIndex((item) => Number(item.id || 0) === Number(updatedAsset.id || 0));
          if (idx >= 0) state.assets[idx] = { ...state.assets[idx], ...updatedAsset, aspect: payload.aspect || updatedAsset.aspect };
        }
      }

      notify(`${selectedAssets.length} asset${selectedAssets.length === 1 ? '' : 's'} updated`);
      exitBulkMode();
      await refresh();
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function deleteSelectedAssets() {
    const ids = Array.from(selectedAssetIds).filter((id) => Number(id || 0) > 0);
    if (!ids.length) {
      notify('Select one or more assets first', true);
      return;
    }
    if (!confirm(`Delete ${ids.length} selected asset${ids.length === 1 ? '' : 's'}?`)) return;

    try {
      for (const id of ids) {
        await api(`/api/assets/${id}`, { method: 'DELETE' });
      }

      notify(`${ids.length} asset${ids.length === 1 ? '' : 's'} deleted`);
      exitBulkMode();
      await refresh();
    } catch (err) {
      notify(err.message, true);
    }
  }

  function init() {
    if (App.assetFieldImport?.init) App.assetFieldImport.init();
    if (App.assetAssociations?.init) App.assetAssociations.init();
    readManualAspectOverrides();
    const bindSortButton = (id, key, defaultDir = 'asc') => {
      const button = document.getElementById(id);
      if (!button) return;
      button.addEventListener('click', () => {
        if (assetTableState.sort.key === key) {
          assetTableState.sort.dir = assetTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          assetTableState.sort.key = key;
          assetTableState.sort.dir = defaultDir === 'desc' ? 'desc' : 'asc';
        }
        renderAssets();
      });
    };

    bindSortButton('assetsSortNameBtn', 'assetName', 'asc');
    bindSortButton('assetsSortWidthBtn', 'imageWidth', 'desc');
    bindSortButton('assetsSortHeightBtn', 'imageHeight', 'desc');
    bindSortButton('assetsSortTypeBtn', 'assetType', 'asc');
    bindSortButton('assetsSortCategoryBtn', 'category', 'asc');
    bindSortButton('assetsSortAspectBtn', 'aspect', 'asc');
    bindSortButton('assetsSortUpdatedBtn', 'createdAt', 'desc');
    bindSortButton('assetsSortSizeBtn', 'size', 'desc');

    if (els.backToAssetsBtn) {
      els.backToAssetsBtn.addEventListener('click', () => {
        App.setActivePage('assetsPage');
      });
    }

    if (els.uploadAssetsBtn) {
      els.uploadAssetsBtn.addEventListener('click', () => {
        const isHidden = els.assetUploadPanel?.classList.contains('hidden');
        if (isHidden) prefillUploadFormsFromActiveFilters();
        toggleUploadPanel(Boolean(isHidden));
      });
    }

    if (els.assetUploadForm) {
      els.assetUploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const file = els.assetUploadFile?.files?.[0];
        if (!file) return notify('Choose a file to upload', true);

        const assetType = String(els.assetUploadType?.value || '').trim();
        if (!assetType) return notify('Asset Type is required', true);

        const assetName = String(els.assetUploadName?.value || '').trim() || file.name;
        const tags = String(els.assetUploadTags?.value || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        try {
          if (assetType === 'Video') {
            await uploadFileToBlobClient(file, {
              assetType,
              assetName,
              category: String(els.assetUploadCategory?.value || '').trim(),
              tags,
            });
          } else {
            await uploadFileToDrive(file, {
              assetType,
              assetName,
              category: String(els.assetUploadCategory?.value || '').trim(),
              tags,
            });
          }

          const uploadedViaImport = assetType === 'Image' && isImageUploadFile(file);
          notify(
            assetType === 'Video'
              ? 'Video uploaded'
              : uploadedViaImport
                ? 'Image imported with thumbnail and aspect'
                : 'Asset uploaded to Google Drive'
          );
          els.assetUploadForm.reset();
          prefillUploadFormsFromActiveFilters();
          await refresh();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (els.assetDriveFolderImportForm) {
      els.assetDriveFolderImportForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const folderUrl = String(els.assetDriveFolderUrl?.value || '').trim();
        if (!folderUrl) return notify('Paste a Google Drive folder URL', true);

        const category = String(els.assetDriveFolderCategory?.value || '').trim();
        const submitBtn = els.assetDriveFolderImportForm.querySelector('button[type="submit"]');

        try {
          if (submitBtn) submitBtn.disabled = true;
          setDriveFolderImportProgress(true, 'Listing folder and importing images from Google Drive…');

          const body = await api('/api/assets/import-drive-folder', {
            method: 'POST',
            body: JSON.stringify({ folderUrl, category, tags: [] }),
          });

          const data = body?.data ?? body;
          const folderName = String(data?.folderName || '').trim();
          const discovered = Number(data?.discovered || 0);
          const imported = Number(data?.imported || 0);
          const skipped = Number(data?.skipped || 0);
          const failed = Number(data?.failed || 0);
          const thumbCount = Number(data?.thumbnailCount || 0);

          const label = folderName ? `"${folderName}"` : 'folder';
          let summary = `Imported ${imported} of ${discovered} image${discovered === 1 ? '' : 's'} from ${label}`;
          if (thumbCount > 0) summary += ` (${thumbCount} with thumbnails)`;
          if (skipped > 0) summary += `. ${skipped} skipped (already in Assets)`;
          if (failed > 0) summary += `. ${failed} failed — see console`;

          notify(summary, failed > 0);
          if (failed > 0 && Array.isArray(data?.results)) {
            const issues = data.results.filter((row) => row && row.ok === false);
            if (issues.length) console.warn('[assets] Drive folder import issues:', issues);
          }

          els.assetDriveFolderImportForm.reset();
          prefillUploadFormsFromActiveFilters();
          await refresh();
        } catch (err) {
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
          setDriveFolderImportProgress(false);
        }
      });
    }

    if (els.assetMultiUploadForm) {
      els.assetMultiUploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const files = Array.from(els.assetMultiUploadFiles?.files || []);
        if (!files.length) return notify('Choose one or more files to upload', true);

        const assetType = String(els.assetMultiUploadType?.value || '').trim();
        if (!assetType) return notify('Asset Type is required', true);

        const category = String(els.assetMultiUploadCategory?.value || '').trim();
        const aspect = normalizeAspect(els.assetMultiUploadAspect?.value);

        try {
          if (assetType === 'Image') {
            const imageFiles = files.filter((file) => isImageUploadFile(file));
            const skipped = files.length - imageFiles.length;
            if (!imageFiles.length) {
              notify('Choose one or more image files for bulk image import', true);
              return;
            }

            setBulkImportProgress(true, `Importing 0 of ${imageFiles.length}...`, 0, imageFiles.length);
            let imported = 0;
            let thumbCount = 0;
            const failures = [];

            for (let index = 0; index < imageFiles.length; index += 1) {
              const file = imageFiles[index];
              setBulkImportProgress(
                true,
                `Importing ${index + 1} of ${imageFiles.length}: ${file.name}`,
                index,
                imageFiles.length
              );
              try {
                const result = await importImageFile(file, {
                  assetName: file.name,
                  category,
                  aspect,
                  tags: [],
                });
                imported += 1;
                if (result?.thumbnailGenerated) thumbCount += 1;
                if (result?.thumbnailError) {
                  failures.push(`${file.name}: thumbnail ${result.thumbnailError}`);
                }
              } catch (err) {
                failures.push(`${file.name}: ${err.message || 'Import failed'}`);
              }
            }

            setBulkImportProgress(true, 'Import complete', imageFiles.length, imageFiles.length);
            const summary = `Imported ${imported} image${imported === 1 ? '' : 's'} (${thumbCount} with thumbnails)`;
            if (skipped > 0 || failures.length) {
              notify(
                `${summary}. ${skipped ? `${skipped} non-image file(s) skipped. ` : ''}${failures.length ? `${failures.length} issue(s) — see console.` : ''}`,
                failures.length > 0
              );
              if (failures.length) console.warn('[assets] bulk image import issues:', failures);
            } else {
              notify(summary);
            }
          } else {
            for (const file of files) {
              if (assetType === 'Video') {
                await uploadFileToBlobClient(file, {
                  assetType,
                  assetName: file.name,
                  category,
                  tags: [],
                });
              } else {
                await uploadFileToDrive(file, {
                  assetType,
                  assetName: file.name,
                  category,
                  tags: [],
                });
              }
            }
            notify(`${files.length} ${assetType === 'Video' ? 'video' : 'asset'}${files.length === 1 ? '' : 's'} uploaded`);
          }

          els.assetMultiUploadForm.reset();
          prefillUploadFormsFromActiveFilters();
          await refresh();
        } catch (err) {
          notify(err.message, true);
        } finally {
          setBulkImportProgress(false);
        }
      });
    }

    if (els.assetForm?.asset_type) {
      syncAssetCaptionFieldVisibility(String(els.assetForm.asset_type.value || '').trim());
    }

    if (els.assetForm) {
      els.assetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(els.assetForm);
        const payload = {
          assetName: String(formData.get('asset_name') || '').trim(),
          assetType: String(formData.get('asset_type') || '').trim(),
          category: String(formData.get('category') || '').trim(),
          aspect: normalizeAspect(formData.get('aspect')),
          topic: String(formData.get('topic') || '').trim(),
          caption: String(formData.get('caption') || '').trim(),
          comments: String(formData.get('comments') || '').trim(),
          tags: String(formData.get('tags') || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        };

        try {
          const currentId = Number(formData.get('asset_id') || editingAssetId || 0) || 0;
          if (currentId > 0) {
            const updated = await api(`/api/assets/${currentId}`, { method: 'PATCH', body: JSON.stringify(payload) });
            if (payload.aspect) setManualAspectOverride(currentId, payload.aspect);
            const updatedAsset = updated?.asset || updated?.data || null;
            if (updatedAsset?.id) {
              const idx = (state.assets || []).findIndex((item) => Number(item.id || 0) === Number(updatedAsset.id || 0));
              if (idx >= 0) state.assets[idx] = { ...state.assets[idx], ...updatedAsset, aspect: payload.aspect || updatedAsset.aspect };
            }
            notify('Asset updated');
          } else {
            await api('/api/assets', { method: 'POST', body: JSON.stringify(payload) });
            notify('Asset created');
          }
          resetAssetForm();
          await refresh();
          App.setActivePage('assetsPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (els.assetForm?.asset_type) {
      els.assetForm.asset_type.addEventListener('change', () => {
        const assetType = String(els.assetForm.asset_type.value || '').trim();
        const existingCategory = String(els.assetForm.category?.value || '').trim();
        renderCategoryOptionsByType(assetType, existingCategory);
        syncAssetCaptionFieldVisibility(assetType);
        if (editingAssetId) return;
        const assetName = String(els.assetForm.asset_name?.value || '').trim();
        const tags = String(els.assetForm.tags?.value || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        renderAssetPreview({ assetType, assetName, tags, location: '' });
      });
    }

    if (els.assetUploadType) {
      els.assetUploadType.addEventListener('change', () => {
        const assetType = String(els.assetUploadType.value || '').trim();
        const existingCategory = String(els.assetUploadCategory?.value || '').trim();
        renderUploadCategoryOptionsByType(assetType, existingCategory);
      });
    }

    if (els.assetMultiUploadType) {
      els.assetMultiUploadType.addEventListener('change', () => {
        const assetType = String(els.assetMultiUploadType.value || '').trim();
        const existingCategory = String(els.assetMultiUploadCategory?.value || '').trim();
        renderMultiUploadCategoryOptionsByType(assetType, existingCategory);
      });
    }

    const bindHeaderField = (el, key) => {
      if (!el) return;
      el.addEventListener('input', () => {
        if (isBulkMode()) {
          bulkDraft[key] = String(el.value || '');
          return;
        }
        state.assetsFilters[key] = String(el.value || '');
      });
      el.addEventListener('change', () => {
        if (isBulkMode()) {
          bulkDraft[key] = String(el.value || '');
          return;
        }
        state.assetsFilters[key] = String(el.value || '');
      });
    };

    bindHeaderField(els.assetsFilterName, 'asset_name');
    bindHeaderField(els.assetsFilterCaption, 'caption');
    bindHeaderField(els.assetsFilterCategory, 'category');
    bindHeaderField(els.assetsFilterAspect, 'aspect');
    bindHeaderField(els.assetsFilterTags, 'tags');

    if (els.assetsFilterType) {
      els.assetsFilterType.addEventListener('change', () => {
        const selectedType = String(els.assetsFilterType.value || '').trim();
        if (isBulkMode()) {
          bulkDraft.asset_type = selectedType;
          renderAssetFilterCategoryOptions(
            bulkDraft.asset_type || getBulkCommonAssetType(),
            String(bulkDraft.category || '').trim(),
            { bulkMode: true }
          );
          bulkDraft.category = String(els.assetsFilterCategory?.value || '').trim();
          return;
        }

        state.assetsFilters.asset_type = selectedType;
        renderAssetFilterCategoryOptions(
          selectedType,
          String(state.assetsFilters.category || '').trim(),
          { bulkMode: false }
        );
        state.assetsFilters.category = String(els.assetsFilterCategory?.value || '').trim();
      });
    }

    if (els.assetsApplyFilterBtn) {
      els.assetsApplyFilterBtn.addEventListener('click', () => {
        if (isBulkMode()) return;
        state.assetsFilters.asset_name = String(els.assetsFilterName?.value || '');
        state.assetsFilters.caption = String(els.assetsFilterCaption?.value || '');
        state.assetsFilters.asset_type = String(els.assetsFilterType?.value || '');
        state.assetsFilters.category = String(els.assetsFilterCategory?.value || '');
        state.assetsFilters.aspect = normalizeAspect(els.assetsFilterAspect?.value);
        state.assetsFilters.tags = String(els.assetsFilterTags?.value || '');
        renderAssets();
      });
    }

    if (els.assetsSelectAllVisible) {
      els.assetsSelectAllVisible.addEventListener('change', () => {
        const visibleIds = getVisibleSelectableAssetIds();
        const wasBulkMode = isBulkMode();
        if (els.assetsSelectAllVisible.checked) {
          visibleIds.forEach((id) => selectedAssetIds.add(id));
          if (!wasBulkMode && visibleIds.length) resetBulkDraft();
        } else {
          visibleIds.forEach((id) => selectedAssetIds.delete(id));
          if (!isBulkMode()) resetBulkDraft();
        }
        renderAssets();
      });
    }

    if (els.assetsBulkEditBtn) {
      els.assetsBulkEditBtn.addEventListener('click', editSelectedAssets);
    }

    if (els.assetsBulkResizeBtn) {
      els.assetsBulkResizeBtn.addEventListener('click', openBulkResizePanel);
    }

    if (els.bulkResizeRunBtn) {
      els.bulkResizeRunBtn.addEventListener('click', runBulkResize);
    }

    if (els.bulkResizeCancelBtn) {
      els.bulkResizeCancelBtn.addEventListener('click', closeBulkResizePanel);
    }

    if (els.assetsBulkDeleteBtn) {
      els.assetsBulkDeleteBtn.addEventListener('click', deleteSelectedAssets);
    }

    resetAssetForm();
    prefillUploadFormsFromActiveFilters();
    syncAssetsHeaderControls();
    App.assetImageEditor?.init?.({
      onSaved: async (updatedAsset) => {
        if (!updatedAsset?.id) return;
        const idx = (state.assets || []).findIndex((item) => Number(item.id || 0) === Number(updatedAsset.id || 0));
        if (idx >= 0) state.assets[idx] = { ...state.assets[idx], ...updatedAsset };
        if (Number(editingAssetId || 0) === Number(updatedAsset.id || 0)) {
          if (els.assetDimensionsText) {
            const width = Math.max(0, Number(updatedAsset.imageWidth || 0) || 0);
            const height = Math.max(0, Number(updatedAsset.imageHeight || 0) || 0);
            if (width > 0 && height > 0) {
              els.assetDimensionsText.textContent = `${width} x ${height}`;
              els.assetDimensionsRow?.classList.remove('hidden');
            }
          }
          if (els.assetSizeText) {
            const bytes = Math.max(0, Number(updatedAsset.size || 0) || 0);
            els.assetSizeText.textContent = `${formatBytes(bytes)} (${bytes} B)`;
            els.assetSizeRow?.classList.remove('hidden');
          }
          renderAssetPreview(updatedAsset);
        }
        await refresh();
      },
    });
  }

  return {
    manifest: { id: 'assets', label: 'Assets', pageId: 'assetsPage' },
    init,
    refresh,
    onPageActivated: refresh,
    openAssetsLanding,
    openAssetsManager,
    assetImageUrl,
  };
})();
