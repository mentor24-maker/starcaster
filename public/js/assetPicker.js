window.App = window.App || {};

App.assetPicker = (function () {
  const Aspect = App.assetAspect;

  function isRenderableUrl(value) {
    const text = String(value || '').trim();
    return Boolean(text) && text !== '[object Object]';
  }

  function resolvePreviewUrl(value, toDirectAssetUrl) {
    if (typeof toDirectAssetUrl !== 'function') return isRenderableUrl(value) ? String(value || '').trim() : '';
    const resolved = String(toDirectAssetUrl(value) || '').trim();
    return isRenderableUrl(resolved) ? resolved : '';
  }

  function previewUrlFromAsset(asset, toDirectAssetUrl) {
    const fromAsset = resolvePreviewUrl(asset, toDirectAssetUrl);
    if (fromAsset) return fromAsset;

    const thumb = String(
      asset?.thumbnailLocation || asset?.thumbnailUrl || asset?.thumbnail_location || ''
    ).trim();
    if (thumb) {
      const resolved = resolvePreviewUrl(thumb, toDirectAssetUrl);
      if (resolved) return resolved;
      return thumb;
    }

    const location = String(asset?.location || '').trim();
    return resolvePreviewUrl(location, toDirectAssetUrl) || location;
  }

  function dimensionLabel(asset) {
    const w = Number(asset?.imageWidth || asset?.image_width || 0) || 0;
    const h = Number(asset?.imageHeight || asset?.image_height || 0) || 0;
    return w > 0 && h > 0 ? `${w} × ${h}` : '';
  }

  function safeText(value) {
    return String(value || '').trim();
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

  function assetLabel(asset, fallbackLabel) {
    return safeText(asset?.assetName) || safeText(fallbackLabel) || 'Image';
  }

  function getAssetTagText(asset) {
    const tags = Array.isArray(asset?.tags)
      ? asset.tags
      : safeText(asset?.tags).split(/[;,]+/g);
    return tags.map((item) => safeText(item)).filter(Boolean).join(' ');
  }

  function filterImageAssets(assets) {
    return (Array.isArray(assets) ? assets : []).filter(
      (asset) => safeText(asset?.assetType) === 'Image'
    );
  }

  function findAssetIdByLogoUrl(assets, logoUrl) {
    const url = safeText(logoUrl);
    if (!url) return '';
    for (const asset of filterImageAssets(assets)) {
      const candidates = [
        toDirectAssetUrl(asset?.location),
        previewUrlFromAsset(asset, toDirectAssetUrl),
        safeText(asset?.location),
        safeText(asset?.thumbnailLocation || asset?.thumbnail_location),
      ].filter(Boolean);
      if (candidates.some((candidate) => candidate === url)) {
        return String(asset.id || '');
      }
    }
    return '';
  }

  function logoUrlFromAsset(asset) {
    return previewUrlFromAsset(asset, toDirectAssetUrl);
  }

  async function uploadImageToGallery(file, options = {}) {
    const api = options.api;
    const state = options.state;
    if (!file) throw new Error('Choose an image file first');
    if (!String(file.type || '').startsWith('image/')) {
      throw new Error('Please choose an image file');
    }
    if (typeof api !== 'function') throw new Error('Upload is unavailable');
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
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
        category: safeText(options.category) || 'Image',
        tags: Array.isArray(options.tags) ? options.tags : ['gallery'],
      }),
    });
    const asset = result?.asset || result?.data?.asset || null;
    if (!asset?.id) throw new Error('Image upload did not return an asset');
    if (state && typeof state === 'object') {
      state.assets = [asset].concat(
        Array.isArray(state.assets)
          ? state.assets.filter((item) => String(item.id) !== String(asset.id))
          : []
      );
    }
    return asset;
  }

  function openImageGalleryPicker(options = {}) {
    if (!App.components || typeof App.components.Modal !== 'function') return null;
    const title = safeText(options.title) || 'Image';
    const assets = filterImageAssets(typeof options.getAssets === 'function' ? options.getAssets() : []);
    const currentUrl = safeText(options.currentUrl);
    const currentAssetId = findAssetIdByLogoUrl(assets, currentUrl);
    const modalAssets = assets.slice();
    if (currentAssetId && !modalAssets.some((asset) => String(asset.id) === currentAssetId)) {
      const currentAsset = (Array.isArray(options.allAssets) ? options.allAssets : assets)
        .find((asset) => String(asset.id) === currentAssetId);
      if (currentAsset) modalAssets.unshift(currentAsset);
    }

    const body = document.createElement('div');
    body.className = 'builder-theme-picker-body';
    const toolbar = document.createElement('div');
    toolbar.className = 'builder-theme-picker-toolbar';

    const filterInput = document.createElement('input');
    filterInput.placeholder = 'Search images by name, category, or tag';

    const categoryFilter = document.createElement('select');
    const tagFilter = document.createElement('select');

    const resultCount = document.createElement('div');
    resultCount.className = 'builder-theme-picker-result-count';
    resultCount.textContent = '0 images';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-ghost';
    clearBtn.textContent = 'Clear Selection';

    toolbar.appendChild(filterInput);
    toolbar.appendChild(categoryFilter);
    toolbar.appendChild(tagFilter);
    toolbar.appendChild(resultCount);
    toolbar.appendChild(clearBtn);

    const grid = document.createElement('div');
    grid.className = 'builder-theme-picker-groups';
    body.appendChild(toolbar);
    body.appendChild(grid);

    let modal = null;
    let previewModal = null;

    function syncPickerFilters() {
      const categoryValues = Array.from(
        new Set(modalAssets.map((asset) => safeText(asset?.category)).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b));
      const tagValues = Array.from(new Set(
        modalAssets.flatMap((asset) => {
          const tags = Array.isArray(asset?.tags)
            ? asset.tags
            : safeText(asset?.tags).split(/[;,]+/g);
          return tags.map((item) => safeText(item)).filter(Boolean);
        })
      )).sort((a, b) => a.localeCompare(b));

      const currentCategory = safeText(categoryFilter.value);
      categoryFilter.innerHTML = '<option value="">All Categories</option>';
      categoryValues.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        if (value === currentCategory) option.selected = true;
        categoryFilter.appendChild(option);
      });

      const currentTag = safeText(tagFilter.value);
      tagFilter.innerHTML = '<option value="">All Tags</option>';
      tagValues.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        if (value === currentTag) option.selected = true;
        tagFilter.appendChild(option);
      });
    }

    function openImagePreview(asset) {
      const imageUrl = logoUrlFromAsset(asset);
      if (!imageUrl || !App.components || typeof App.components.Modal !== 'function') return;
      const previewBody = document.createElement('div');
      previewBody.className = 'builder-theme-image-preview-modal-body';
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = assetLabel(asset, title);
      const meta = document.createElement('div');
      meta.className = 'builder-theme-image-preview-meta';
      const strong = document.createElement('strong');
      strong.textContent = assetLabel(asset, title);
      const span = document.createElement('span');
      span.textContent = safeText(asset?.category) || 'Image';
      meta.appendChild(strong);
      meta.appendChild(span);
      const stage = document.createElement('div');
      stage.className = 'builder-theme-image-preview-stage';
      stage.appendChild(img);
      previewBody.appendChild(stage);
      previewBody.appendChild(meta);
      previewModal = App.components.Modal({
        title: assetLabel(asset, title),
        body: previewBody,
        dialogClass: 'builder-theme-image-preview-modal',
      });
      previewModal.open();
    }

    function renderGrid() {
      syncPickerFilters();
      const filter = safeText(filterInput.value).toLowerCase();
      const categoryValue = safeText(categoryFilter.value);
      const tagValue = safeText(tagFilter.value).toLowerCase();
      const rows = modalAssets.filter((asset) => {
        if (categoryValue && safeText(asset?.category) !== categoryValue) return false;
        const tagText = getAssetTagText(asset).toLowerCase();
        if (tagValue && !tagText.includes(tagValue)) return false;
        if (!filter) return true;
        const haystack = [
          assetLabel(asset, ''),
          safeText(asset?.category),
          safeText(asset?.assetName),
          safeText(asset?.location),
          safeText(asset?.aspect),
          tagText,
        ].join(' ').toLowerCase();
        return haystack.includes(filter);
      });
      resultCount.textContent = `${rows.length} image${rows.length === 1 ? '' : 's'}`;
      grid.textContent = '';
      renderGroupedImageGrid(grid, {
        assets: rows,
        getSelectedId: () => currentAssetId,
        toDirectAssetUrl,
        assetLabel: (asset) => assetLabel(asset, title),
        onChoose: (asset) => {
          if (typeof options.onSelect === 'function') {
            options.onSelect(logoUrlFromAsset(asset), asset);
          }
          if (modal) modal.close();
        },
        onPreview: openImagePreview,
        emptyMessage: safeText(options.emptyMessage) || 'No matching images found.',
      });
    }

    filterInput.addEventListener('input', renderGrid);
    categoryFilter.addEventListener('change', renderGrid);
    tagFilter.addEventListener('change', renderGrid);
    clearBtn.addEventListener('click', () => {
      if (typeof options.onClear === 'function') options.onClear();
      if (modal) modal.close();
    });

    modal = App.components.Modal({
      title: `Choose ${title}`,
      body,
      dialogClass: safeText(options.dialogClass) || 'builder-theme-picker-modal',
    });
    renderGrid();
    modal.open();
    return modal;
  }

  function renderGroupedImageGrid(container, options) {
    const {
      assets = [],
      getSelectedId = () => '',
      onChoose,
      onPreview,
      toDirectAssetUrl,
      assetLabel = (asset) => String(asset?.assetName || asset?.id || 'Image'),
      emptyMessage = 'No matching images found.',
    } = options;

    container.textContent = '';
    const grouped = Aspect.groupAssetsByAspect(assets);
    let renderedSections = 0;

    Aspect.ASPECT_ORDER.forEach((aspectKey) => {
      const rows = grouped[aspectKey];
      if (!rows.length) return;
      renderedSections += 1;

      const section = document.createElement('section');
      section.className = 'builder-theme-picker-group';
      section.dataset.aspect = aspectKey;

      const heading = document.createElement('button');
      heading.type = 'button';
      heading.className = 'builder-theme-picker-group-heading';
      heading.setAttribute('aria-expanded', 'true');

      const headingText = document.createElement('strong');
      headingText.textContent = Aspect.ASPECT_LABELS[aspectKey] || aspectKey;

      const count = document.createElement('span');
      count.className = 'builder-theme-picker-group-count';
      count.textContent = String(rows.length);

      const toggle = document.createElement('span');
      toggle.className = 'builder-theme-picker-group-toggle';
      toggle.setAttribute('aria-hidden', 'true');

      heading.appendChild(headingText);
      heading.appendChild(count);
      heading.appendChild(toggle);

      const sectionGrid = document.createElement('div');
      sectionGrid.className = `builder-theme-picker-grid builder-theme-picker-grid--${aspectKey}`;

      rows.forEach((asset) => {
        const selectedId = String(getSelectedId() || '');
        const card = document.createElement('div');
        card.className = `builder-theme-picker-card builder-theme-picker-card--${aspectKey}${
          String(asset.id) === selectedId ? ' is-selected' : ''
        }`;

        const imageBtn = document.createElement('button');
        imageBtn.type = 'button';
        imageBtn.className = 'builder-theme-picker-card-image-btn';
        const imageUrl = previewUrlFromAsset(asset, toDirectAssetUrl);
        if (imageUrl) {
          const img = document.createElement('img');
          img.src = imageUrl;
          img.alt = String(assetLabel(asset) || 'Image');
          img.loading = 'lazy';
          imageBtn.appendChild(img);
        } else {
          const empty = document.createElement('div');
          empty.className = 'builder-theme-table-thumb-empty';
          empty.textContent = 'No Image';
          imageBtn.appendChild(empty);
        }

        const titleDiv = document.createElement('div');
        titleDiv.className = 'builder-theme-picker-card-title';
        titleDiv.textContent = String(assetLabel(asset) || '');

        const dims = dimensionLabel(asset);
        const metaDiv = document.createElement('div');
        metaDiv.className = 'builder-theme-picker-card-meta';
        metaDiv.textContent = `${String(asset?.category || 'Image')}${dims ? ` • ${dims}` : ''}`;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'builder-theme-picker-card-actions';

        const previewBtn = document.createElement('button');
        previewBtn.type = 'button';
        previewBtn.className = 'tiny-btn builder-theme-picker-preview-btn';
        previewBtn.textContent = 'Preview';

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'tiny-btn builder-theme-picker-select-btn';
        selectBtn.textContent = 'Use Image';

        const choose = () => {
          if (typeof onChoose === 'function') onChoose(asset);
        };

        imageBtn.addEventListener('click', choose);
        selectBtn.addEventListener('click', choose);
        if (typeof onPreview === 'function') {
          previewBtn.addEventListener('click', () => onPreview(asset));
        } else {
          previewBtn.hidden = true;
        }

        actionsDiv.appendChild(previewBtn);
        actionsDiv.appendChild(selectBtn);
        card.appendChild(imageBtn);
        card.appendChild(titleDiv);
        card.appendChild(metaDiv);
        card.appendChild(actionsDiv);
        sectionGrid.appendChild(card);
      });

      heading.addEventListener('click', () => {
        const collapsed = section.classList.toggle('is-collapsed');
        heading.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      });

      section.appendChild(heading);
      section.appendChild(sectionGrid);
      container.appendChild(section);
    });

    if (!renderedSections) {
      const empty = document.createElement('div');
      empty.className = 'meta';
      empty.textContent = emptyMessage;
      container.appendChild(empty);
    }
  }

  return {
    previewUrlFromAsset,
    renderGroupedImageGrid,
    toDirectAssetUrl,
    logoUrlFromAsset,
    filterImageAssets,
    findAssetIdByLogoUrl,
    uploadImageToGallery,
    openImageGalleryPicker,
  };
})();
