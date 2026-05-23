'use strict';

const ASPECT_WIDE = 'wide';
const ASPECT_SQUARE = 'square';
const ASPECT_TALL = 'tall';

const ASPECT_VALUES = [ASPECT_WIDE, ASPECT_SQUARE, ASPECT_TALL];

const ASPECT_LABELS = {
  [ASPECT_WIDE]: 'Wide Images',
  [ASPECT_SQUARE]: 'Square Images',
  [ASPECT_TALL]: 'Tall Images',
};

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

function resolveAspect({ aspect, imageWidth, imageHeight, image_width, image_height } = {}) {
  const stored = normalizeAspect(aspect);
  if (stored) return stored;
  const w = Math.max(0, Number(imageWidth ?? image_width ?? 0) || 0);
  const h = Math.max(0, Number(imageHeight ?? image_height ?? 0) || 0);
  return inferAspectFromDimensions(w, h);
}

module.exports = {
  ASPECT_WIDE,
  ASPECT_SQUARE,
  ASPECT_TALL,
  ASPECT_VALUES,
  ASPECT_LABELS,
  normalizeAspect,
  inferAspectFromDimensions,
  resolveAspect,
};
