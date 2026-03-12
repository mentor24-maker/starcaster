'use strict';

const { getProviderValues } = require('../apiSettings');

function safeText(value) {
  return String(value || '').trim();
}

function firstNonEmpty(values) {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return '';
}

function resolveYoutubeApiKey() {
  const providerAliases = ['youtube', 'youtube_data_api', 'youtube_data', 'youtubeapi'];
  const fieldAliases = ['api_key', 'key', 'youtube_api_key', 'youtube_key'];

  const envKey = firstNonEmpty([
    process.env.YOUTUBE_API_KEY,
    process.env.YOUTUBE_DATA_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GCP_API_KEY,
  ]);

  if (envKey) return envKey;

  for (const provider of providerAliases) {
    const values = getProviderValues(provider) || {};
    const key = firstNonEmpty(fieldAliases.map((field) => values[field]));
    if (key) return key;
  }

  return '';
}

module.exports = {
  resolveYoutubeApiKey,
};
