window.App = window.App || {};

App.assetImageEditor = (function () {
  const { api, notify } = App;
  const UPLOAD_MAX_BYTES = 7 * 1024 * 1024;
  const UPLOAD_MAX_BASE64_CHARS = 9_000_000;

  const els = {
    panel: null,
    canvas: null,
    outputWidth: null,
    outputHeight: null,
    lockAspect: null,
    cropMeta: null,
    resetBtn: null,
    saveBtn: null,
  };

  let ctx = null;
  let image = null;
  let objectUrl = '';
  let assetContext = null;
  let onSaved = null;
  let displayScale = 1;
  let crop = { x: 0, y: 0, w: 0, h: 0 };
  let drag = null;
  let lockAspect = true;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value) {
    return Math.max(1, Math.round(Number(value) || 0));
  }

  function bytesToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function cleanupObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = '';
    }
  }

  function resetCropToFull() {
    if (!image) return;
    crop = { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
    if (els.outputWidth) els.outputWidth.value = String(crop.w);
    if (els.outputHeight) els.outputHeight.value = String(crop.h);
    updateCropMeta();
    renderCanvas();
  }

  function updateCropMeta() {
    if (!els.cropMeta || !image) return;
    els.cropMeta.textContent = `Crop: ${crop.w} x ${crop.h} px at (${crop.x}, ${crop.y}) · Source ${image.naturalWidth} x ${image.naturalHeight}`;
  }

  function displayPointFromEvent(event) {
    const rect = els.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * els.canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * els.canvas.height;
    return { x, y };
  }

  function imagePointFromDisplay(point) {
    return {
      x: clamp(Math.round(point.x / displayScale), 0, image.naturalWidth),
      y: clamp(Math.round(point.y / displayScale), 0, image.naturalHeight),
    };
  }

  function normalizeCropRect(start, end) {
    const x1 = clamp(Math.min(start.x, end.x), 0, image.naturalWidth);
    const y1 = clamp(Math.min(start.y, end.y), 0, image.naturalHeight);
    const x2 = clamp(Math.max(start.x, end.x), 0, image.naturalWidth);
    const y2 = clamp(Math.max(start.y, end.y), 0, image.naturalHeight);
    const w = Math.max(1, x2 - x1);
    const h = Math.max(1, y2 - y1);
    return { x: x1, y: y1, w, h };
  }

  function renderCanvas() {
    if (!ctx || !image || !els.canvas) return;
    const maxWidth = 640;
    displayScale = Math.min(1, maxWidth / image.naturalWidth);
    const displayWidth = Math.max(1, Math.round(image.naturalWidth * displayScale));
    const displayHeight = Math.max(1, Math.round(image.naturalHeight * displayScale));
    els.canvas.width = displayWidth;
    els.canvas.height = displayHeight;

    ctx.clearRect(0, 0, displayWidth, displayHeight);
    ctx.drawImage(image, 0, 0, displayWidth, displayHeight);

    const cropX = crop.x * displayScale;
    const cropY = crop.y * displayScale;
    const cropW = crop.w * displayScale;
    const cropH = crop.h * displayScale;

    ctx.fillStyle = 'rgba(7, 33, 66, 0.45)';
    ctx.fillRect(0, 0, displayWidth, cropY);
    ctx.fillRect(0, cropY + cropH, displayWidth, displayHeight - (cropY + cropH));
    ctx.fillRect(0, cropY, cropX, cropH);
    ctx.fillRect(cropX + cropW, cropY, displayWidth - (cropX + cropW), cropH);

    ctx.strokeStyle = '#0b82d4';
    ctx.lineWidth = 2;
    ctx.strokeRect(cropX + 0.5, cropY + 0.5, Math.max(0, cropW - 1), Math.max(0, cropH - 1));
  }

  function syncOutputFromCrop(options = {}) {
    if (!image) return;
    const nextWidth = round(els.outputWidth?.value || crop.w);
    const nextHeight = round(els.outputHeight?.value || crop.h);
    if (lockAspect && crop.w > 0 && crop.h > 0) {
      const cropAspect = crop.w / crop.h;
      if (options.source === 'width') {
        if (els.outputHeight) els.outputHeight.value = String(round(nextWidth / cropAspect));
      } else if (options.source === 'height') {
        if (els.outputWidth) els.outputWidth.value = String(round(nextHeight * cropAspect));
      } else {
        if (els.outputWidth) els.outputWidth.value = String(crop.w);
        if (els.outputHeight) els.outputHeight.value = String(crop.h);
      }
    } else {
      if (els.outputWidth) els.outputWidth.value = String(nextWidth);
      if (els.outputHeight) els.outputHeight.value = String(nextHeight);
    }
  }

  function editorFetchErrorMessage(err, actionLabel) {
    const raw = String(err?.message || '').trim();
    if (raw === 'Failed to fetch') {
      return `Network error while ${actionLabel}. Check that you are signed in and the dev server is running.`;
    }
    return raw || `Could not ${actionLabel}`;
  }

  function apiFetchHeaders() {
    const headers = {};
    const projectId = (
      typeof App.projectContext?.getSessionProjectId === 'function'
        ? App.projectContext.getSessionProjectId()
        : String(App.state?.currentProjectId || '').trim()
    );
    if (projectId) headers['X-Project-ID'] = projectId;
    const sessionToken = typeof App.getSessionToken === 'function' ? App.getSessionToken() : '';
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
    return headers;
  }

  async function readApiErrorMessage(response) {
    try {
      const body = await response.clone().json();
      const err = body?.error;
      const text = (
        (typeof err === 'object' && err !== null ? err.message : null) ||
        (typeof err === 'string' ? err : null) ||
        body?.message ||
        ''
      );
      if (text) return String(text).trim();
    } catch (_) {
      // ignore non-JSON errors
    }
    return '';
  }

  async function loadImage(assetId, fallbackUrl, asset = null) {
    cleanupObjectUrl();
    image = null;
    const id = Number(assetId || 0) || 0;
    const candidates = [];
    if (id > 0) candidates.push(`/api/assets/${id}/source-media`);

    const pushCandidate = (value) => {
      const url = String(value || '').trim();
      if (!url || candidates.includes(url)) return;
      candidates.push(url);
    };

    pushCandidate(fallbackUrl);
    pushCandidate(asset?.thumbnailLocation);
    pushCandidate(asset?.thumbnailUrl);

    const headers = apiFetchHeaders();
    let response = null;
    let lastError = null;
    for (const url of candidates) {
      try {
        response = await fetch(url, { credentials: 'same-origin', headers });
        if (response.ok) break;
        const apiMessage = await readApiErrorMessage(response);
        lastError = new Error(apiMessage || `Could not load image for editing (${response.status})`);
        response = null;
      } catch (err) {
        lastError = err;
        response = null;
      }
    }

    if (!response?.ok) {
      throw lastError || new Error('Could not load image for editing');
    }

    const blob = await response.blob();
    const blobType = String(blob.type || '').toLowerCase();
    if (blobType && !blobType.startsWith('image/')) {
      throw new Error('Selected asset is not an editable image');
    }

    objectUrl = URL.createObjectURL(blob);
    const nextImage = new Image();
    nextImage.src = objectUrl;
    try {
      await nextImage.decode();
    } catch (_) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = '';
      throw new Error('Could not decode image for editing');
    }
    image = nextImage;
    resetCropToFull();
  }

  function close() {
    assetContext = null;
    drag = null;
    cleanupObjectUrl();
    image = null;
    if (els.panel) {
      els.panel.classList.add('hidden');
      els.panel.setAttribute('aria-hidden', 'true');
    }
  }

  async function openForAsset(asset, imageUrl) {
    if (!els.panel || !els.canvas) return;
    const assetId = Number(asset?.id || 0) || 0;
    if (!assetId) {
      close();
      return;
    }
    assetContext = {
      id: assetId,
      assetName: String(asset?.assetName || 'image').trim() || 'image',
      category: String(asset?.category || '').trim(),
      aspect: String(asset?.aspect || '').trim(),
    };
    els.panel.classList.remove('hidden');
    els.panel.setAttribute('aria-hidden', 'false');
    try {
      await loadImage(assetId, imageUrl, asset);
    } catch (err) {
      close();
      notify(editorFetchErrorMessage(err, 'opening the image editor'), true);
    }
  }

  async function exportBlob() {
    if (!image) throw new Error('No image loaded');
    const outputWidth = round(els.outputWidth?.value || crop.w);
    const outputHeight = round(els.outputHeight?.value || crop.h);
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = outputWidth;
    exportCanvas.height = outputHeight;
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) throw new Error('Canvas is not available in this browser');
    exportCtx.drawImage(
      image,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      0,
      0,
      outputWidth,
      outputHeight
    );
    const mimeType = 'image/jpeg';
    const blob = await new Promise((resolve, reject) => {
      exportCanvas.toBlob((value) => {
        if (!value) reject(new Error('Failed to export edited image'));
        else resolve(value);
      }, mimeType, 0.92);
    });
    return { blob, mimeType, outputWidth, outputHeight };
  }

  async function saveEditedImage() {
    if (!assetContext?.id || !image) return;
    if (els.saveBtn) els.saveBtn.disabled = true;
    try {
      const { blob, mimeType, outputWidth, outputHeight } = await exportBlob();
      if (blob.size > UPLOAD_MAX_BYTES) {
        throw new Error('Edited image exceeds the 7MB upload limit. Reduce output dimensions.');
      }
      const baseName = String(assetContext.assetName || 'image')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 120) || 'image';
      const fileName = `${baseName}_${outputWidth}x${outputHeight}.jpg`;
      const fileBase64 = bytesToBase64(await blob.arrayBuffer());
      if (fileBase64.length > UPLOAD_MAX_BASE64_CHARS) {
        throw new Error('Edited image exceeds the upload limit. Reduce output dimensions.');
      }
      const payload = {
        fileName,
        mimeType,
        fileBase64,
        assetName: assetContext.assetName,
        category: assetContext.category,
      };
      if (assetContext.aspect) payload.aspect = assetContext.aspect;

      const result = await api(`/api/assets/${assetContext.id}/replace-image`, {
        method: 'POST',
        headers: apiFetchHeaders(),
        body: JSON.stringify(payload),
      });
      const updatedAsset = result?.asset || result?.data?.asset || null;
      notify('Edited image saved');
      if (typeof onSaved === 'function') {
        await onSaved(updatedAsset);
      }
      if (updatedAsset) {
        await openForAsset(
          updatedAsset,
          App.assets?.assetImageUrl?.(updatedAsset, { preferThumbnail: false }) || ''
        );
      }
    } catch (err) {
      notify(editorFetchErrorMessage(err, 'saving the edited image'), true);
    } finally {
      if (els.saveBtn) els.saveBtn.disabled = false;
    }
  }

  function bindCanvasEvents() {
    if (!els.canvas) return;

    els.canvas.addEventListener('pointerdown', (event) => {
      if (!image) return;
      event.preventDefault();
      const displayPoint = displayPointFromEvent(event);
      const start = imagePointFromDisplay(displayPoint);
      drag = { start, current: start };
      els.canvas.setPointerCapture(event.pointerId);
    });

    els.canvas.addEventListener('pointermove', (event) => {
      if (!drag || !image) return;
      event.preventDefault();
      drag.current = imagePointFromDisplay(displayPointFromEvent(event));
      crop = normalizeCropRect(drag.start, drag.current);
      syncOutputFromCrop();
      updateCropMeta();
      renderCanvas();
    });

    const finishDrag = (event) => {
      if (!drag) return;
      drag.current = imagePointFromDisplay(displayPointFromEvent(event));
      crop = normalizeCropRect(drag.start, drag.current);
      drag = null;
      syncOutputFromCrop();
      updateCropMeta();
      renderCanvas();
      try {
        els.canvas.releasePointerCapture(event.pointerId);
      } catch (_) {
        // ignore
      }
    };

    els.canvas.addEventListener('pointerup', finishDrag);
    els.canvas.addEventListener('pointercancel', finishDrag);
  }

  function init(options = {}) {
    onSaved = typeof options.onSaved === 'function' ? options.onSaved : null;
    els.panel = document.getElementById('assetImageEditorPanel');
    els.canvas = document.getElementById('assetImageEditorCanvas');
    els.outputWidth = document.getElementById('assetImageEditorOutputWidth');
    els.outputHeight = document.getElementById('assetImageEditorOutputHeight');
    els.lockAspect = document.getElementById('assetImageEditorLockAspect');
    els.cropMeta = document.getElementById('assetImageEditorCropMeta');
    els.resetBtn = document.getElementById('assetImageEditorResetBtn');
    els.saveBtn = document.getElementById('assetImageEditorSaveBtn');
    if (!els.panel || !els.canvas) return;
    ctx = els.canvas.getContext('2d');

    bindCanvasEvents();

    els.resetBtn?.addEventListener('click', () => {
      resetCropToFull();
    });

    els.saveBtn?.addEventListener('click', () => {
      saveEditedImage();
    });

    els.lockAspect?.addEventListener('change', () => {
      lockAspect = Boolean(els.lockAspect.checked);
      syncOutputFromCrop();
    });

    els.outputWidth?.addEventListener('input', () => {
      syncOutputFromCrop({ source: 'width' });
    });

    els.outputHeight?.addEventListener('input', () => {
      syncOutputFromCrop({ source: 'height' });
    });
  }

  return {
    init,
    openForAsset,
    close,
  };
})();
