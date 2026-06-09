'use strict';

const { getProviderValues } = require('./apiSettings');

const PROVIDERS = {
  brave: 'brave',
  google_custom_search: 'google_custom_search',
};

const PAGE_SIZE = 10;

function normalizeProvider(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === PROVIDERS.brave || raw === 'brave_search') return PROVIDERS.brave;
  if (raw === PROVIDERS.google_custom_search || raw === 'google' || raw === 'google_cse') {
    return PROVIDERS.google_custom_search;
  }
  return 'auto';
}

function getBraveSearchConfig() {
  const provider = getProviderValues('brave') || {};
  const apiKey = String(
    provider.api_key
    || process.env.BRAVE_API_KEY
    || process.env.BRAVE_SEARCH_API_KEY
    || ''
  ).trim();
  return {
    provider: PROVIDERS.brave,
    apiKey,
    searchEngineId: '',
    configured: Boolean(apiKey),
  };
}

function getGoogleSearchConfig() {
  const provider = getProviderValues('google_custom_search') || {};
  const apiKey = String(
    provider.api_key
    || process.env.GOOGLE_CUSTOM_SEARCH_API_KEY
    || process.env.GOOGLE_API_KEY
    || ''
  ).trim();
  const searchEngineId = String(
    provider.search_engine_id
    || process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID
    || process.env.GOOGLE_CUSTOM_SEARCH_CX
    || ''
  ).trim();
  return {
    provider: PROVIDERS.google_custom_search,
    apiKey,
    searchEngineId,
    configured: Boolean(apiKey && searchEngineId),
  };
}

function resolveWebSearchConfig() {
  const preference = normalizeProvider(process.env.WEB_SEARCH_PROVIDER);
  const brave = getBraveSearchConfig();
  const google = getGoogleSearchConfig();

  if (preference === PROVIDERS.brave) {
    return brave.configured ? brave : { ...brave, configured: false };
  }
  if (preference === PROVIDERS.google_custom_search) {
    return google.configured ? google : { ...google, configured: false };
  }

  if (brave.configured) return brave;
  if (google.configured) return google;
  return {
    provider: '',
    apiKey: '',
    searchEngineId: '',
    configured: false,
  };
}

function normalizeSearchItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      link: String(item?.link || '').trim(),
      title: String(item?.title || '').trim(),
      snippet: String(item?.snippet || '').trim(),
    }))
    .filter((item) => item.link);
}

async function fetchBraveSearchBatch(query, pageIndex, config) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(PAGE_SIZE));
  url.searchParams.set('offset', String(Math.max(0, Number(pageIndex) || 0)));
  url.searchParams.set('search_lang', 'en');
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'X-Subscription-Token': config.apiKey,
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, error: `Brave search request failed: ${err.message}` };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const rawError = body?.message || body?.error;
    const message = String(
      typeof rawError === 'string'
        ? rawError
        : rawError?.detail || rawError?.message || `Brave search failed (${res.status})`
    ).trim();
    return { ok: false, error: message };
  }
  const results = Array.isArray(body?.web?.results) ? body.web.results : [];
  return {
    ok: true,
    items: normalizeSearchItems(results.map((item) => ({
      link: item?.url,
      title: item?.title,
      snippet: item?.description,
    }))),
  };
}

async function fetchGoogleSearchBatch(query, pageIndex, config) {
  const startIndex = Math.max(1, (Number(pageIndex) || 0) * PAGE_SIZE + 1);
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', config.apiKey);
  url.searchParams.set('cx', config.searchEngineId);
  url.searchParams.set('q', query);
  url.searchParams.set('start', String(startIndex));
  url.searchParams.set('num', String(PAGE_SIZE));
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, error: `Google search request failed: ${err.message}` };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    return { ok: false, error: String(body?.error?.message || `Google search failed (${res.status})`) };
  }
  return { ok: true, items: normalizeSearchItems(body?.items) };
}

async function fetchWebSearchBatch(query, pageIndex, config = null) {
  const active = config && config.configured ? config : resolveWebSearchConfig();
  if (!active.configured) {
    return { ok: false, error: 'Web search credentials are not configured.' };
  }
  if (active.provider === PROVIDERS.brave) {
    return fetchBraveSearchBatch(query, pageIndex, active);
  }
  if (active.provider === PROVIDERS.google_custom_search) {
    return fetchGoogleSearchBatch(query, pageIndex, active);
  }
  return { ok: false, error: 'No supported web search provider is configured.' };
}

function webSearchProviderLabel(provider) {
  if (provider === PROVIDERS.brave) return 'Brave Search';
  if (provider === PROVIDERS.google_custom_search) return 'Google Programmable Search';
  return 'web search';
}

function webSearchConfigurationError(config) {
  const preference = normalizeProvider(process.env.WEB_SEARCH_PROVIDER);
  if (preference === PROVIDERS.brave) {
    return 'Brave Search API key is not configured. Set BRAVE_API_KEY in Settings → APIs or Vercel env vars.';
  }
  if (preference === PROVIDERS.google_custom_search) {
    return 'Google Programmable Search credentials are not configured.';
  }
  if (getBraveSearchConfig().configured || getGoogleSearchConfig().configured) {
    return 'Web search credentials are not configured.';
  }
  return 'Web search is not configured. Set BRAVE_API_KEY (recommended) or GOOGLE_CUSTOM_SEARCH_API_KEY + GOOGLE_CUSTOM_SEARCH_ENGINE_ID in Vercel env vars.';
}

module.exports = {
  PROVIDERS,
  PAGE_SIZE,
  getBraveSearchConfig,
  getGoogleSearchConfig,
  resolveWebSearchConfig,
  fetchWebSearchBatch,
  fetchBraveSearchBatch,
  fetchGoogleSearchBatch,
  webSearchProviderLabel,
  webSearchConfigurationError,
};
