window.App = window.App || {};

App.assets = (function () {
  const { state, els, api, notify } = App;
  const LEGACY_UPLOAD_MAX_BYTES = 7 * 1024 * 1024;
  let vercelBlobClientPromise = null;
  let editingAssetId = null;
  let selectedAssetIds = new Set();
  let bulkDraft = {
    asset_name: '',
    asset_type: '',
    category: '',
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

  function appendCell(tr, text) {
    const td = document.createElement('td');
    td.textContent = String(text || '-');
    tr.appendChild(td);
  }

  function normalizeSortText(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function updateAssetSortButtons() {
    const configs = [
      ['assetsSortNameBtn', 'assetName', 'Asset Name'],
      ['assetsSortTypeBtn', 'assetType', 'Asset Type'],
      ['assetsSortCategoryBtn', 'category', 'Category'],
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
      tags: '',
    };
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
    const names = categories
      .filter((item) => {
        if (!type) return true;
        return String(item?.assetType || '').trim() === type;
      })
      .map((item) => String(item?.category || '').trim())
      .filter(Boolean);

    return Array.from(new Set(names));
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
    const type = String(filters.asset_type || '').trim();
    const category = String(filters.category || '').trim().toLowerCase();
    const tags = String(filters.tags || '').trim().toLowerCase();
    const size = String(filters.size || '').trim().toLowerCase();

    const filtered = (state.assets || []).filter((asset) => {
      const assetName = String(asset.assetName || '').toLowerCase();
      const assetType = String(asset.assetType || '');
      const assetCategory = String(asset.category || '').toLowerCase();
      const assetTags = Array.isArray(asset.tags) ? asset.tags.join(', ').toLowerCase() : '';
      const assetSizeRaw = String(Math.max(0, Number(asset.size || 0) || 0));
      const assetSizeFmt = formatBytes(asset.size).toLowerCase();

      if (name && !assetName.includes(name)) return false;
      if (type && assetType !== type) return false;
      if (category && assetCategory !== category) return false;
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

    if (type === 'Video' && valid && els.assetPreviewVideo) {
      els.assetPreviewVideo.src = direct;
      els.assetPreviewVideo.classList.remove('hidden');
      return;
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
    renderCategoryOptionsByType('', '');
    if (els.assetIdInput) els.assetIdInput.value = '';
    if (els.assetLocationText) els.assetLocationText.textContent = '-';
    if (els.assetLocationRow) els.assetLocationRow.classList.add('hidden');
    if (els.assetDimensionsText) els.assetDimensionsText.textContent = '-';
    if (els.assetDimensionsRow) els.assetDimensionsRow.classList.add('hidden');
    if (els.assetSizeText) els.assetSizeText.textContent = '-';
    if (els.assetSizeRow) els.assetSizeRow.classList.add('hidden');
    renderAssetPreview(null);
    setAssetFormMode(false);
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
    if (els.assetsBulkDeleteBtn) els.assetsBulkDeleteBtn.disabled = !bulkMode;
    if (els.assetsFilterActionRow) els.assetsFilterActionRow.classList.toggle('hidden', bulkMode);
    if (els.assetsBulkActionRow) els.assetsBulkActionRow.classList.toggle('hidden', !bulkMode);

    if (!els.assetsFilterName || !els.assetsFilterType || !els.assetsFilterTags) return;

    if (bulkMode) {
      els.assetsFilterName.placeholder = 'Asset Name (leave unchanged)';
      els.assetsFilterTags.placeholder = 'Tags (comma-separated, leave unchanged)';
      if (els.assetsFilterType.options[0]) els.assetsFilterType.options[0].textContent = 'Asset Type (leave unchanged)';

      els.assetsFilterName.value = bulkDraft.asset_name;
      els.assetsFilterType.value = bulkDraft.asset_type;
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

    els.assetsFilterName.value = String(state.assetsFilters?.asset_name || '');
    els.assetsFilterType.value = String(state.assetsFilters?.asset_type || '');
    els.assetsFilterTags.value = String(state.assetsFilters?.tags || '');
    renderAssetFilterCategoryOptions(
      String(state.assetsFilters?.asset_type || '').trim(),
      String(state.assetsFilters?.category || '').trim(),
      { bulkMode: false }
    );
  }

  function beginEdit(asset) {
    editingAssetId = Number(asset?.id || 0) || null;
    if (!editingAssetId) {
      notify('This asset cannot be edited yet. Run the SQL migration to add the id column.', true);
      return;
    }
    if (!els.assetForm) return;

    els.assetForm.asset_name.value = String(asset.assetName || '');
    els.assetForm.asset_type.value = String(asset.assetType || '');
    renderCategoryOptionsByType(asset.assetType, String(asset.category || ''));
    els.assetForm.tags.value = Array.isArray(asset.tags) ? asset.tags.join(', ') : '';
    if (els.assetIdInput) {
      els.assetIdInput.value = String(editingAssetId);
    }
    if (els.assetLocationText) {
      els.assetLocationText.innerHTML = '';
      const location = String(asset.location || '').trim();
      if (isValidUrl(location)) {
        const link = document.createElement('a');
        link.href = location;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = location;
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
      const directImageUrl = toDriveDirectUrl(location) || (isValidUrl(location) ? location : '');
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

      appendCell(tr, displayAssetType(asset.assetType));
      appendCell(tr, asset.category);
      appendCell(tr, Array.isArray(asset.tags) ? asset.tags.join(', ') : '-');
      appendCell(tr, formatBytes(asset.size));

      const actionsTd = document.createElement('td');
      if (assetId > 0) {
        const editBtn = App.makeIconButton('edit', 'Edit Asset', () => beginEdit(asset));
        const deleteBtn = App.makeIconButton('delete', 'Delete Asset', () => deleteById(assetId), { danger: true, marginLeft: '8px' });

        actionsTd.appendChild(editBtn);
        actionsTd.appendChild(deleteBtn);
      } else {
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

  async function uploadFileToDrive(file, options) {
    if (!file) throw new Error('Choose a file to upload');
    const assetType = String(options?.assetType || '').trim();
    if (!assetType) throw new Error('Asset Type is required');
    if (assetType !== 'Video' && file.size > LEGACY_UPLOAD_MAX_BYTES) {
      throw new Error('Upload limit is 7MB per file for this asset type in this version');
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
      throw assetsRes.reason || new Error('Failed to load assets');
    }

    if (categoriesRes.status === 'fulfilled') {
      state.assetCategories = categoriesRes.value.categories || [];
    }

    renderAssets();
  }

  async function openAssetsLanding() {
    App.setActivePage('assetsPage');
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
    App.setActivePage('assetsPage');
    try {
      await refresh();
    } catch (err) {
      notify(err.message, true);
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
    const nextTagsRaw = String(bulkDraft.tags || '').trim();
    const nextTags = nextTagsRaw
      ? nextTagsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : null;

    if (!nextName && !nextType && !nextCategory && !nextTagsRaw) {
      notify('Change one or more fields before using Edit All', true);
      return;
    }

    try {
      for (const asset of selectedAssets) {
        const assetId = Number(asset.id || 0) || 0;
        if (!assetId) continue;
        await api(`/api/assets/${assetId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            assetName: nextName || String(asset.assetName || '').trim(),
            assetType: nextType || String(asset.assetType || '').trim(),
            category: nextCategory || String(asset.category || '').trim(),
            tags: nextTags || (Array.isArray(asset.tags) ? asset.tags : []),
          }),
        });
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
    bindSortButton('assetsSortTypeBtn', 'assetType', 'asc');
    bindSortButton('assetsSortCategoryBtn', 'category', 'asc');
    bindSortButton('assetsSortTagsBtn', 'tags', 'asc');
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

          notify(assetType === 'Video' ? 'Video uploaded' : 'Asset uploaded to Google Drive');
          els.assetUploadForm.reset();
          prefillUploadFormsFromActiveFilters();
          await refresh();
        } catch (err) {
          notify(err.message, true);
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

        try {
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
          els.assetMultiUploadForm.reset();
          prefillUploadFormsFromActiveFilters();
          await refresh();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (els.assetForm) {
      els.assetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(els.assetForm);
        const payload = {
          assetName: String(formData.get('asset_name') || '').trim(),
          assetType: String(formData.get('asset_type') || '').trim(),
          category: String(formData.get('category') || '').trim(),
          tags: String(formData.get('tags') || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        };

        try {
          const currentId = Number(formData.get('asset_id') || editingAssetId || 0) || 0;
          if (currentId > 0) {
            await api(`/api/assets/${currentId}`, { method: 'PATCH', body: JSON.stringify(payload) });
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
    bindHeaderField(els.assetsFilterCategory, 'category');
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
        state.assetsFilters.asset_type = String(els.assetsFilterType?.value || '');
        state.assetsFilters.category = String(els.assetsFilterCategory?.value || '');
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

    if (els.assetsBulkDeleteBtn) {
      els.assetsBulkDeleteBtn.addEventListener('click', deleteSelectedAssets);
    }

    resetAssetForm();
    prefillUploadFormsFromActiveFilters();
    syncAssetsHeaderControls();
  }

  return {
    manifest: { id: 'assets', label: 'Assets', pageId: 'assetsPage' },
    init,
    refresh,
    onPageActivated: refresh,
    openAssetsLanding,
    openAssetsManager,
  };
})();
