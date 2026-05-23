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
      section.className = 'develop-theme-picker-group';
      section.dataset.aspect = aspectKey;

      const heading = document.createElement('button');
      heading.type = 'button';
      heading.className = 'develop-theme-picker-group-heading';
      heading.setAttribute('aria-expanded', 'true');

      const headingText = document.createElement('strong');
      headingText.textContent = Aspect.ASPECT_LABELS[aspectKey] || aspectKey;

      const count = document.createElement('span');
      count.className = 'develop-theme-picker-group-count';
      count.textContent = String(rows.length);

      const toggle = document.createElement('span');
      toggle.className = 'develop-theme-picker-group-toggle';
      toggle.setAttribute('aria-hidden', 'true');

      heading.appendChild(headingText);
      heading.appendChild(count);
      heading.appendChild(toggle);

      const sectionGrid = document.createElement('div');
      sectionGrid.className = `develop-theme-picker-grid develop-theme-picker-grid--${aspectKey}`;

      rows.forEach((asset) => {
        const selectedId = String(getSelectedId() || '');
        const card = document.createElement('div');
        card.className = `develop-theme-picker-card develop-theme-picker-card--${aspectKey}${
          String(asset.id) === selectedId ? ' is-selected' : ''
        }`;

        const imageBtn = document.createElement('button');
        imageBtn.type = 'button';
        imageBtn.className = 'develop-theme-picker-card-image-btn';
        const imageUrl = previewUrlFromAsset(asset, toDirectAssetUrl);
        if (imageUrl) {
          const img = document.createElement('img');
          img.src = imageUrl;
          img.alt = String(assetLabel(asset) || 'Image');
          img.loading = 'lazy';
          imageBtn.appendChild(img);
        } else {
          const empty = document.createElement('div');
          empty.className = 'develop-theme-table-thumb-empty';
          empty.textContent = 'No Image';
          imageBtn.appendChild(empty);
        }

        const titleDiv = document.createElement('div');
        titleDiv.className = 'develop-theme-picker-card-title';
        titleDiv.textContent = String(assetLabel(asset) || '');

        const dims = dimensionLabel(asset);
        const metaDiv = document.createElement('div');
        metaDiv.className = 'develop-theme-picker-card-meta';
        metaDiv.textContent = `${String(asset?.category || 'Image')}${dims ? ` • ${dims}` : ''}`;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'develop-theme-picker-card-actions';

        const previewBtn = document.createElement('button');
        previewBtn.type = 'button';
        previewBtn.className = 'tiny-btn develop-theme-picker-preview-btn';
        previewBtn.textContent = 'Preview';

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'tiny-btn develop-theme-picker-select-btn';
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
  };
})();
