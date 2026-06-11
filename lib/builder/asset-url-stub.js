'use strict';

function safeText(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeBuilderAssetUrl(value) {
  const text = safeText(value, 4000);
  if (!text) return '';

  if (text.startsWith('/api/assets/')) {
    return text;
  }

  if (/^assets?\//i.test(text)) {
    return `/api/assets/${text.replace(/^assets?\//i, '')}`;
  }

  try {
    const url = new URL(text, 'https://starcaster.local');
    if (url.pathname.startsWith('/api/assets/')) {
      return `${url.pathname}${url.search}`;
    }
  } catch (_) {
    // relative paths and asset ids pass through
  }

  return text;
}

function resolvePublicBuilderAssetUrl(value) {
  const normalized = normalizeBuilderAssetUrl(value);
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return normalized;
}

module.exports = {
  safeText,
  normalizeBuilderAssetUrl,
  resolvePublicBuilderAssetUrl,
};
