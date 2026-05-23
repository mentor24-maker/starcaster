window.App = window.App || {};

App.assetAspect = (function () {
  const ASPECT_WIDE = 'wide';
  const ASPECT_SQUARE = 'square';
  const ASPECT_TALL = 'tall';
  const ASPECT_VALUES = [ASPECT_WIDE, ASPECT_SQUARE, ASPECT_TALL];
  const ASPECT_LABELS = {
    wide: 'Wide Images',
    square: 'Square Images',
    tall: 'Tall Images',
  };
  const ASPECT_ORDER = [ASPECT_WIDE, ASPECT_SQUARE, ASPECT_TALL];

  function normalizeAspect(value) {
    const key = String(value || '').trim().toLowerCase();
    return ASPECT_VALUES.includes(key) ? key : '';
  }

  function inferAspectFromDimensions(width, height) {
    const w = Math.max(0, Number(width) || 0);
    const h = Math.max(0, Number(height) || 0);
    if (w > 0 && h > 0) {
      const ratio = w / h;
      if (ratio >= 1.2) return ASPECT_WIDE;
      if (ratio <= 0.82) return ASPECT_TALL;
      return ASPECT_SQUARE;
    }
    return ASPECT_SQUARE;
  }

  function resolveAssetAspect(asset) {
    const stored = normalizeAspect(asset?.aspect);
    if (stored) return stored;
    const w = Number(asset?.imageWidth || asset?.image_width || 0) || 0;
    const h = Number(asset?.imageHeight || asset?.image_height || 0) || 0;
    return inferAspectFromDimensions(w, h);
  }

  function groupAssetsByAspect(assets) {
    const grouped = {
      wide: [],
      square: [],
      tall: [],
    };
    (Array.isArray(assets) ? assets : []).forEach((asset) => {
      const key = resolveAssetAspect(asset);
      grouped[key].push(asset);
    });
    return grouped;
  }

  return {
    ASPECT_WIDE,
    ASPECT_SQUARE,
    ASPECT_TALL,
    ASPECT_VALUES,
    ASPECT_LABELS,
    ASPECT_ORDER,
    normalizeAspect,
    inferAspectFromDimensions,
    resolveAssetAspect,
    groupAssetsByAspect,
  };
})();
