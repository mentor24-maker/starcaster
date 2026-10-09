'use strict';

/**
 * Substack Miner — the web-search pass (Substack Miner 2/7, task 86bcfprxd).
 *
 * For each keyword it asks the web search engine for `site:substack.com
 * "<keyword>"`, keeps the results whose host is a publication
 * (`<handle>.substack.com`), and saves each writer as a candidate through
 * lib/substackMinerStore.js with every keyword that surfaced them. A writer
 * new to the project also gets their front page read once — title, meta
 * description, and the "1,000 subscribers" wording when the page shows it.
 *
 * It is lib/peerDiscovery.js turned inside out: that search drops substack.com
 * from its results, this one keeps nothing else. Public HTML pages only — no
 * login, no substack.com/api address, nothing posted — and one outside request
 * at a time, `pauseMsBetweenFetches` apart.
 *
 * The answer is a summary that accounts for everything: results seen, hosts
 * dropped for not being a publication, writers added and merged, and every
 * front page that could not be read, by handle and why. A page that could not
 * be read does not lose the writer — they are saved with the handle as their
 * name and no subscriber wording. A run with no search key is refused with
 * lib/webSearch.js's own configuration message, never answered as an empty
 * success.
 *
 * Every outside dependency comes in through `deps`, so the tests in
 * scripts/builder/substackMinerRun.test.js drive it with no network.
 */

const webSearch = require('../webSearch');
const minerStore = require('../substackMinerStore');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const PAGE_TIMEOUT_MS = 15000;
const MAX_PAGE_BYTES = 2_000_000;
// Vercel stops a function at 300s. Front pages not read by this point are
// still saved, and named in the summary as not read, rather than lost.
const DEFAULT_TIME_BUDGET_MS = 240000;
const MAX_KEYWORDS_PER_RUN = 50;

// Substack's own subdomains — not anybody's publication.
const RESERVED_LABELS = new Set(['www', 'open', 'on', 'support', 'api', 'cdn', 'help', 'email', 'app']);

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The publication handle a search result points at, or why it does not name
 * one. `open.substack.com/pub/<handle>/...` is Substack's share link for a
 * publication and names its handle in the path.
 */
function handleFromResultUrl(link) {
  let url;
  try {
    url = new URL(String(link || '').trim());
  } catch {
    return { ok: false, reason: 'not a web address' };
  }
  const host = url.hostname.toLowerCase();
  if (!host.endsWith('.substack.com')) return { ok: false, reason: 'not a substack.com publication' };
  let label = host.slice(0, -'.substack.com'.length).split('.')[0];
  if (label === 'open') {
    const pub = url.pathname.match(/^\/pub\/([^/]+)/i);
    label = pub ? pub[1].toLowerCase() : '';
  }
  if (!label || RESERVED_LABELS.has(label)) return { ok: false, reason: 'one of Substack\'s own addresses' };
  const checked = minerStore.handleOrError(label);
  if (!checked.ok) return { ok: false, reason: checked.error };
  return { ok: true, handle: checked.value };
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html, attr, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const named = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']${name}["']`, 'i'));
    if (!named) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i);
    if (content) return decodeEntities(content[1]);
  }
  return '';
}

/**
 * What a publication's front page says about itself. The title drops
 * Substack's own " | Substack" suffix; the subscriber wording is kept as the
 * page wrote it ("1,000 subscribers", "Over 2K subscribers").
 */
function parseFrontPage(html) {
  const text = String(html || '');
  const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeEntities(titleMatch ? titleMatch[1] : metaContent(text, 'property', 'og:title'))
    .replace(/\s*\|\s*Substack\s*$/i, '');
  const description = metaContent(text, 'name', 'description') || metaContent(text, 'property', 'og:description');
  const visible = decodeEntities(text.replace(/<[^>]+>/g, ' '));
  const subscribers = visible.match(/\b(?:over\s+|more than\s+)?[\d][\d,.]*\s*[km]?\+?\s+(?:paid\s+)?subscribers\b/i);
  return {
    name: title.slice(0, 300),
    description: description.slice(0, 4000),
    subscriberText: subscribers ? subscribers[0].replace(/\s+/g, ' ').trim().slice(0, 120) : '',
  };
}

/** Read one front page. Answers `{ ok, html }` or `{ ok: false, reason }`; never throws. */
async function fetchFrontPage(url) {
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, reason: `could not be reached: ${err.message}` };
  }
  if (!res.ok) return { ok: false, reason: `answered HTTP ${res.status}` };
  let html;
  try {
    html = await res.text();
  } catch (err) {
    return { ok: false, reason: `could not be read: ${err.message}` };
  }
  return { ok: true, html: html.slice(0, MAX_PAGE_BYTES) };
}

function keywordListOrError(value) {
  if (!Array.isArray(value)) return refuse('keywords must be a list of words or phrases');
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') return refuse(`keywords must contain only text — got ${JSON.stringify(item)}`);
    const text = item.trim();
    if (text && !out.some((existing) => existing.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  if (out.length > MAX_KEYWORDS_PER_RUN) return refuse(`a run can search at most ${MAX_KEYWORDS_PER_RUN} keywords — got ${out.length}`);
  return { ok: true, value: out };
}

/**
 * Run the web-search pass for one project.
 *
 *   input.keywords  optional list; the project's saved keyword list otherwise
 *
 * Answers the store envelope: `{ ok: true, status: 200, data: summary }`, or
 * a refusal naming why nothing was searched.
 */
async function runSubstackMinerSearch(input = {}, scope = null, deps = {}) {
  const resolveConfig = deps.resolveWebSearchConfig || webSearch.resolveWebSearchConfig;
  const configError = deps.webSearchConfigurationError || webSearch.webSearchConfigurationError;
  const searchBatch = deps.fetchWebSearchBatch || webSearch.fetchWebSearchBatch;
  const readPage = deps.fetchFrontPage || fetchFrontPage;
  const store = deps.store || minerStore;
  const wait = deps.sleep || sleep;
  const now = deps.now || Date.now;
  const timeBudgetMs = deps.timeBudgetMs || DEFAULT_TIME_BUDGET_MS;

  const config = resolveConfig();
  if (!config || !config.configured) return refuse(configError(config));

  const settings = await store.getSettings(scope);
  if (!settings.ok) return settings;

  let keywords;
  if (input && input.keywords !== undefined && input.keywords !== null) {
    const checked = keywordListOrError(input.keywords);
    if (!checked.ok) return checked;
    keywords = checked.value;
  } else {
    keywords = settings.data.keywords || [];
  }
  if (!keywords.length) {
    return refuse('There are no keywords to search — save some in the Substack Miner settings, or send { "keywords": [...] }.');
  }

  const perKeyword = Number(settings.data.maxResultsPerKeyword) || minerStore.SETTINGS_DEFAULTS.maxResultsPerKeyword;
  const pauseMs = Math.max(0, Number(settings.data.pauseMsBetweenFetches ?? minerStore.SETTINGS_DEFAULTS.pauseMsBetweenFetches) || 0);
  const pageSize = Math.max(1, Number(config.pageSize) || 10);
  const maxPageIndex = Math.max(0, Number(config.maxPageIndex) || 0);

  // One outside request at a time, `pauseMs` apart.
  let requested = false;
  async function politely(request) {
    if (requested && pauseMs) await wait(pauseMs);
    requested = true;
    return request();
  }

  const summary = {
    engine: webSearch.webSearchProviderLabel(config.provider),
    keywordsSearched: keywords,
    resultsSeen: 0,
    droppedNotSubstack: 0,
    droppedExamples: [],
    handlesFound: 0,
    added: 0,
    merged: 0,
    pagesRead: 0,
    unreadablePages: [],
    searchErrors: [],
    refused: [],
  };

  // handle → the keywords that found it, in the order they did.
  const found = new Map();
  let searchesAnswered = 0;
  for (const keyword of keywords) {
    const query = `site:substack.com "${keyword.replace(/"/g, '')}"`;
    const forKeyword = new Set();
    for (let pageIndex = 0; pageIndex <= maxPageIndex && forKeyword.size < perKeyword; pageIndex += 1) {
      const batch = await politely(() => searchBatch(query, pageIndex, config));
      if (!batch || !batch.ok) {
        summary.searchErrors.push({ keyword, error: String(batch?.error || 'the search gave no answer') });
        break;
      }
      searchesAnswered += 1;
      const items = Array.isArray(batch.items) ? batch.items : [];
      summary.resultsSeen += items.length;
      for (const item of items) {
        const parsed = handleFromResultUrl(item?.link);
        if (!parsed.ok) {
          summary.droppedNotSubstack += 1;
          if (summary.droppedExamples.length < 10) summary.droppedExamples.push(String(item?.link || ''));
          continue;
        }
        if (forKeyword.size >= perKeyword && !forKeyword.has(parsed.handle)) continue;
        forKeyword.add(parsed.handle);
        const hits = found.get(parsed.handle) || [];
        if (!hits.includes(keyword)) hits.push(keyword);
        found.set(parsed.handle, hits);
      }
      if (items.length < pageSize) break;
    }
  }
  if (!searchesAnswered) {
    const first = summary.searchErrors[0];
    return refuse(`No search could be run, so nothing was found. ${summary.engine} said: ${first ? first.error : 'nothing'}`, 502);
  }
  summary.handlesFound = found.size;

  // Writers already here are merged without reading their page again.
  const existing = await store.listCandidates(1000, scope);
  if (!existing.ok) return existing;
  const known = new Set(existing.data.map((row) => row.handle));

  const startedAt = now();
  for (const [handle, keywordsHit] of found) {
    const publicationUrl = `https://${handle}.substack.com`;
    const find = { handle, publicationUrl, keywordsHit, foundVia: 'web_search' };
    if (!known.has(handle)) {
      find.name = handle;
      if (now() - startedAt > timeBudgetMs) {
        summary.unreadablePages.push({ handle, reason: 'not read — the run ran out of time; the writer is saved without page details' });
      } else {
        const page = await politely(() => readPage(`${publicationUrl}/`));
        if (page.ok) {
          const details = parseFrontPage(page.html);
          summary.pagesRead += 1;
          if (details.name) find.name = details.name;
          if (details.description) find.description = details.description;
          if (details.subscriberText) find.subscriberText = details.subscriberText;
        } else {
          summary.unreadablePages.push({ handle, reason: page.reason });
        }
      }
    }
    const saved = await store.upsertCandidate(find, scope);
    if (!saved.ok) {
      // A tenancy or database failure is not one writer's fault: stop and say so.
      if (saved.status !== 400) return saved;
      summary.refused.push({ handle, error: saved.error });
      continue;
    }
    if (saved.status === 201) summary.added += 1;
    else summary.merged += 1;
  }

  return { ok: true, status: 200, data: summary };
}

module.exports = {
  runSubstackMinerSearch,
  handleFromResultUrl,
  parseFrontPage,
  fetchFrontPage,
  DEFAULT_TIME_BUDGET_MS,
};
