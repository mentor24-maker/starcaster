'use strict';

function normalizePollContentWidth(value, fallback = '100') {
  const text = String(value ?? '').trim();
  if (text === '75' || text === '50' || text === '100') return text;
  return fallback;
}

function normalizeCurrentPollModuleWidth(value) {
  return normalizePollContentWidth(value, '100');
}

module.exports = {
  normalizeCurrentPollModuleWidth,
  POLL_CONTENT_WIDTH_OPTIONS: ['100', '75', '50'],
};
