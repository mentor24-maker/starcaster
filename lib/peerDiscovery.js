'use strict';

const {
  crawlProjectPagesForKeywords,
  buildKeywordSummary,
  registrableDomainOf,
  detectPeerSiteSignals,
  fetchPage,
  stripHtml,
  extractFirst,
  mapWithConcurrency,
} = require('./directAcquire');
const {
  resolveWebSearchConfig,
  fetchWebSearchBatch,
  webSearchConfigurationError,
} = require('./webSearch');
const { listWebsitePeers } = require('./websitePeersStore');

const PEER_DISCOVERY_VERSION = 'peer-discovery-v2';

function summarizeSearchErrors(errors) {
  const list = Array.isArray(errors) ? errors : [];
  if (!list.length) return '';
  const messages = list.map((entry) => {
    const text = String(entry || '').trim();
    const colon = text.indexOf(': ');
    return colon >= 0 ? text.slice(colon + 2).trim() : text;
  }).filter(Boolean);
  const unique = [...new Set(messages)];
  const primary = unique[0] || String(list[0] || '').trim();
  if (/does not have the access to Custom Search JSON API/i.test(primary)) {
    return 'Google Custom Search JSON API is no longer available for this project. Set BRAVE_API_KEY in Vercel env vars (recommended) or contact Google Cloud support to restore legacy access.';
  }
  if (/invalid.*api key|API key not valid|subscription token|X-Subscription-Token/i.test(primary)) {
    return 'Web search API key is invalid. Check BRAVE_API_KEY or GOOGLE_CUSTOM_SEARCH_API_KEY in Settings → APIs / Vercel env vars.';
  }
  if (/search engine id|cx.*invalid|invalid argument/i.test(primary)) {
    return 'Google Programmable Search Engine ID is invalid. Check GOOGLE_CUSTOM_SEARCH_ENGINE_ID (cx), or switch to BRAVE_API_KEY instead.';
  }
  if (/not configured|credentials are not configured/i.test(primary)) {
    return webSearchConfigurationError(resolveWebSearchConfig());
  }
  if (unique.length === 1) return primary;
  return `${primary} (${unique.length} search errors)`;
}
const KEYWORD_COUNT = 10;
const RESULTS_PER_KEYWORD = 10;
const OUTPUT_COUNT = 100;
const LIGHT_FETCH_COUNT = 15;
const MAX_RESULTS_PER_KEYWORD = 100;
const MAX_OUTPUT_COUNT = 150;

const MODEL_PRIMARY_CATEGORIES = new Set([
  'Mega hubs',
  'Comparison Sites',
  'Media Giants and Publishers',
  'Multinational Corporations',
]);

const HARD_EXCLUDE_HOSTS = new Set([
  'wikipedia.org',
  'amazon.com',
  'quora.com',
  'reddit.com',
  'medium.com',
  'substack.com',
  'youtube.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'github.com',
  'nytimes.com',
  'cnn.com',
  'bbc.com',
  'forbes.com',
  'theguardian.com',
  'washingtonpost.com',
  'reuters.com',
  'bloomberg.com',
  'wsj.com',
  'vox.com',
  'g2.com',
  'capterra.com',
  'getapp.com',
  'alternativeto.net',
  'trustradius.com',
  'producthunt.com',
]);

const SOCIAL_PATH_PATTERNS = [
  /linkedin\.com\/in\//i,
  /twitter\.com\/[^/]+$/i,
  /x\.com\/[^/]+$/i,
  /facebook\.com\/[^/]+$/i,
  /instagram\.com\/[^/]+$/i,
];

function tokenizeForOverlap(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3 && term.length <= 32)
  );
}

function overlapScore(leftText, rightText) {
  const left = tokenizeForOverlap(leftText);
  const right = tokenizeForOverlap(rightText);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  left.forEach((term) => {
    if (right.has(term)) shared += 1;
  });
  const union = new Set([...left, ...right]).size;
  return union ? shared / union : 0;
}

function buildProjectFingerprint(pages, keywordSummary) {
  const pageList = Array.isArray(pages) ? pages : [];
  const home = pageList[0] || {};
  const topicTerms = (Array.isArray(keywordSummary?.top_keywords) ? keywordSummary.top_keywords : [])
    .slice(0, 15)
    .map((item) => String(item?.keyword || '').trim())
    .filter(Boolean);
  const headingText = pageList
    .flatMap((page) => (Array.isArray(page?.headings) ? page.headings : []))
    .slice(0, 12)
    .join(' ');
  return {
    title: String(home?.title || '').trim(),
    meta_desc: String(home?.meta_desc || '').trim(),
    headings: headingText,
    topic_terms: topicTerms,
    corpus: [home?.title, home?.meta_desc, headingText, topicTerms.join(' ')].filter(Boolean).join(' '),
  };
}

function suggestedReferenceRole(primaryModel) {
  const model = String(primaryModel || '').trim();
  if (MODEL_PRIMARY_CATEGORIES.has(model)) return 'model';
  if (model === 'Thought Leaders/Influencers') return 'model';
  return 'peer';
}

function buildFilterReason(record, options) {
  const domain = String(record?.domain || '').trim().toLowerCase();
  const url = String(record?.url || '').trim();
  if (!domain) return 'missing_domain';
  if (domain === options.sourceDomain) return 'project_domain';
  if (options.excludeDomains.has(domain)) return 'already_saved';
  if (/\.pdf(?:$|[?#])/i.test(url)) return 'pdf';
  if (/docs\.google\.com/i.test(url)) return 'google_doc';
  if (SOCIAL_PATH_PATTERNS.some((pattern) => pattern.test(url))) return 'social_profile';
  if (String(record?.snippet || '').trim().length < 20 && String(record?.title || '').trim().length < 8) {
    return 'low_quality_snippet';
  }
  return '';
}

async function collectExcludedDomains(scope) {
  const excludeDomains = new Set();
  const result = await listWebsitePeers(2000, scope);
  if (!result.ok) return excludeDomains;
  (Array.isArray(result.data) ? result.data : []).forEach((peer) => {
    const domain = String(peer?.domain || '').trim().toLowerCase();
    if (!domain) return;
    const role = String(peer?.reference_role || '').trim().toLowerCase();
    if (role === 'model' || role === 'peer') excludeDomains.add(domain);
  });
  return excludeDomains;
}

async function searchWebForKeywords(keywords, sourceDomain, resultsPerKeyword = RESULTS_PER_KEYWORD) {
  const config = resolveWebSearchConfig();
  if (!config.configured) {
    return {
      configured: false,
      provider: config.provider || '',
      error: webSearchConfigurationError(config),
      queryResults: [],
      errors: [],
    };
  }
  const queryResults = [];
  const errors = [];
  const pageSize = Math.max(1, Number(config.pageSize) || 10);
  const maxPageIndex = Math.max(0, Number(config.maxPageIndex) || 9);
  const safePerKeyword = Math.max(10, Math.min(Number(resultsPerKeyword) || RESULTS_PER_KEYWORD, MAX_RESULTS_PER_KEYWORD));
  const pageCount = Math.min(Math.ceil(safePerKeyword / pageSize), maxPageIndex + 1);
  const pageIndexes = Array.from({ length: pageCount }, (_, index) => index);
  await mapWithConcurrency(keywords, 2, async (keyword) => {
    const results = [];
    for (const pageIndex of pageIndexes) {
      const batch = await fetchWebSearchBatch(keyword, pageIndex, config);
      if (!batch.ok) {
        errors.push(`${keyword}: ${batch.error}`);
        break;
      }
      const items = Array.isArray(batch.items) ? batch.items : [];
      items.forEach((item, index) => {
        const url = String(item?.link || '').trim();
        const domain = registrableDomainOf(url);
        if (!url || !domain || domain === sourceDomain) return;
        results.push({
          query_keyword: keyword,
          url,
          domain,
          title: String(item?.title || '').trim(),
          snippet: String(item?.snippet || '').trim(),
          rank: pageIndex * pageSize + index + 1,
        });
      });
      if (items.length < pageSize) break;
    }
    queryResults.push(...results);
  });
  return {
    configured: true,
    provider: config.provider,
    error: '',
    queryResults,
    errors,
  };
}

function aggregateCandidatesByDomain(queryResults) {
  const byDomain = new Map();
  queryResults.forEach((item) => {
    const existing = byDomain.get(item.domain);
    if (!existing) {
      byDomain.set(item.domain, {
        domain: item.domain,
        url: item.url,
        title: item.title,
        snippet: item.snippet,
        rank: item.rank,
        matched_keywords: [item.query_keyword],
        hits: 1,
      });
      return;
    }
    existing.hits += 1;
    if (!existing.matched_keywords.includes(item.query_keyword)) {
      existing.matched_keywords.push(item.query_keyword);
    }
    if (item.rank < existing.rank) {
      existing.url = item.url;
      existing.title = item.title;
      existing.snippet = item.snippet;
      existing.rank = item.rank;
    }
  });
  return Array.from(byDomain.values()).map((record) => {
    record.matched_keywords.sort((a, b) => a.localeCompare(b));
    return record;
  });
}

function preliminaryScore(record, fingerprint, keywordCount) {
  const candidateText = [record.title, record.snippet, record.matched_keywords.join(' ')].join(' ');
  const keywordOverlap = overlapScore(fingerprint.corpus, candidateText);
  const multiQuery = Math.min(Number(record.hits || 0) / Math.max(1, keywordCount), 1);
  const rankScore = 1 - Math.min(Math.max(0, Number(record.rank || 30) - 1), 29) / 29;
  return Number((keywordOverlap * 0.45 + multiQuery * 0.35 + rankScore * 0.2).toFixed(4));
}

async function lightFetchHomepages(candidates) {
  return mapWithConcurrency(candidates, 4, async (record) => {
    const url = String(record?.url || '').trim();
    if (!url) return { ...record, homepage_title: '', homepage_meta: '', fetch_error: 'missing_url' };
    try {
      const html = await fetchPage(url);
      const homepageTitle = extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      const homepageMeta = extractFirst(
        html,
        /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i
      );
      const bodySample = stripHtml(html).slice(0, 1200);
      return {
        ...record,
        homepage_title: homepageTitle,
        homepage_meta: homepageMeta,
        homepage_body_sample: bodySample,
        fetch_error: '',
      };
    } catch (err) {
      return { ...record, homepage_title: '', homepage_meta: '', homepage_body_sample: '', fetch_error: err.message || 'fetch failed' };
    }
  });
}

function finalScore(record, fingerprint, keywordCount) {
  const preliminary = preliminaryScore(record, fingerprint, keywordCount);
  const homepageText = [record.homepage_title, record.homepage_meta, record.homepage_body_sample].filter(Boolean).join(' ');
  const homepageOverlap = homepageText ? overlapScore(fingerprint.corpus, homepageText) : 0;
  const similarity = Number((preliminary * 0.7 + homepageOverlap * 0.3).toFixed(2));
  const reasons = [];
  if (Number(record.hits || 0) > 1) {
    reasons.push(`Matched ${record.hits}/${keywordCount} search phrases`);
  }
  if (homepageOverlap >= 0.08) reasons.push('Homepage content overlaps project themes');
  if (overlapScore(fingerprint.corpus, [record.title, record.snippet].join(' ')) >= 0.1) {
    reasons.push('Search listing aligns with project keywords');
  }
  if (!reasons.length) reasons.push('Ranked from search relevance signals');
  return { similarity, reasons };
}

function buildClassifiedCandidate(record, sourceDomain, fingerprint, keywordCount, homepageRecord = null) {
  const merged = homepageRecord ? { ...record, ...homepageRecord } : record;
  const classification = detectPeerSiteSignals(merged, sourceDomain);
  const primaryModel = classification.primary || 'Direct Competitors';
  const referenceRole = suggestedReferenceRole(primaryModel);
  const homepageFetched = Boolean(merged.homepage_title || merged.homepage_meta);
  let similarity = preliminaryScore(record, fingerprint, keywordCount);
  let reasons = ['Classified from search listing'];
  if (homepageFetched) {
    const scored = finalScore(merged, fingerprint, keywordCount);
    similarity = scored.similarity;
    reasons = scored.reasons;
  }
  const peerBoost = referenceRole === 'peer' ? 4 : 0;
  const directCompetitorBoost = primaryModel === 'Direct Competitors' ? 3 : 0;
  return {
    domain: record.domain,
    url: record.url,
    title: record.title || merged.homepage_title || '',
    snippet: record.snippet || merged.homepage_meta || '',
    rank: record.rank,
    hits: record.hits,
    matched_keywords: record.matched_keywords,
    similarity_score: similarity,
    sort_score: similarity + peerBoost + directCompetitorBoost,
    website_model: primaryModel,
    other_models: classification.other || [],
    suggested_reference_role: referenceRole,
    reasons,
    homepage_fetched: homepageFetched,
    fetch_error: String(merged.fetch_error || '').trim(),
  };
}

function sortClassifiedCandidates(candidates) {
  return candidates.sort((a, b) => {
    if (a.suggested_reference_role !== b.suggested_reference_role) {
      return a.suggested_reference_role === 'peer' ? -1 : 1;
    }
    if (a.website_model === 'Direct Competitors' && b.website_model !== 'Direct Competitors') return -1;
    if (b.website_model === 'Direct Competitors' && a.website_model !== 'Direct Competitors') return 1;
    return b.sort_score - a.sort_score
      || b.similarity_score - a.similarity_score
      || a.rank - b.rank
      || a.domain.localeCompare(b.domain);
  });
}

async function runPeerDiscovery(input, scope = null) {
  const startedAt = new Date().toISOString();
  const keywordCount = Math.max(1, Math.min(Number(input?.keyword_count) || KEYWORD_COUNT, 10));
  const resultsPerKeyword = Math.max(10, Math.min(Number(input?.results_per_keyword) || RESULTS_PER_KEYWORD, MAX_RESULTS_PER_KEYWORD));
  const outputCount = Math.max(1, Math.min(Number(input?.output_count) || OUTPUT_COUNT, MAX_OUTPUT_COUNT));
  const lightFetchCount = Math.max(0, Math.min(Number(input?.light_fetch_count) || LIGHT_FETCH_COUNT, 30));

  const crawl = await crawlProjectPagesForKeywords(input);
  const sourceUrl = crawl.source_url;
  const sourceDomain = registrableDomainOf(sourceUrl);
  const keywordSummary = await buildKeywordSummary({
    sourceUrl,
    pages: crawl.pages,
    exclusions: crawl.keyword_exclusions,
  });
  const searchedKeywords = (Array.isArray(keywordSummary?.top_keywords) ? keywordSummary.top_keywords : [])
    .slice(0, keywordCount)
    .map((item) => String(item?.keyword || '').trim())
    .filter(Boolean);

  if (!searchedKeywords.length) {
    return {
      version: PEER_DISCOVERY_VERSION,
      source_url: sourceUrl,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      pages_succeeded: crawl.pages_succeeded,
      keyword_summary: keywordSummary,
      searched_keywords: [],
      error: 'No keyword candidates available for peer discovery.',
      configured: false,
      results: [],
      raw_results_count: 0,
      filtered_count: 0,
      errors: [],
    };
  }

  const search = await searchWebForKeywords(searchedKeywords, sourceDomain, resultsPerKeyword);
  if (!search.configured) {
    return {
      version: PEER_DISCOVERY_VERSION,
      source_url: sourceUrl,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      pages_succeeded: crawl.pages_succeeded,
      keyword_summary: keywordSummary,
      searched_keywords: searchedKeywords,
      error: search.error,
      configured: false,
      results: [],
      raw_results_count: 0,
      filtered_count: 0,
      errors: search.errors,
    };
  }

  if (!search.queryResults.length) {
    const searchError = summarizeSearchErrors(search.errors)
      || 'Web search returned no peer candidates for the selected key phrases.';
    return {
      version: PEER_DISCOVERY_VERSION,
      source_url: sourceUrl,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      pages_succeeded: crawl.pages_succeeded,
      keyword_summary: {
        top_keywords: Array.isArray(keywordSummary.top_keywords) ? keywordSummary.top_keywords : [],
        ai_ranked: !!keywordSummary.ai_ranked,
        ai_error: String(keywordSummary.ai_error || '').trim(),
      },
      searched_keywords: searchedKeywords,
      configured: true,
      provider: search.provider || 'web_search',
      raw_results_count: 0,
      unique_domains_count: 0,
      filtered_count: 0,
      light_fetch_count: 0,
      results: [],
      errors: search.errors.slice(0, 10),
      error: searchError,
    };
  }

  const excludeDomains = await collectExcludedDomains(scope);
  const filterOptions = { sourceDomain, excludeDomains };
  const aggregated = aggregateCandidatesByDomain(search.queryResults);
  const fingerprint = buildProjectFingerprint(crawl.pages, keywordSummary);
  fingerprint.source_url = sourceUrl;

  const survivors = aggregated.filter((record) => !buildFilterReason(record, filterOptions));
  const scored = survivors
    .map((record) => ({
      ...record,
      preliminary_score: preliminaryScore(record, fingerprint, searchedKeywords.length),
    }))
    .sort((a, b) => b.preliminary_score - a.preliminary_score || a.rank - b.rank);

  const fetchTargets = scored
    .filter((record) => {
      const classification = detectPeerSiteSignals(record, sourceDomain);
      const role = suggestedReferenceRole(classification.primary);
      return role === 'peer' || classification.primary === 'Direct Competitors';
    })
    .slice(0, lightFetchCount);
  const enriched = lightFetchCount > 0 ? await lightFetchHomepages(fetchTargets) : [];
  const enrichedByDomain = new Map(enriched.map((record) => [record.domain, record]));
  const classified = scored.map((record) => buildClassifiedCandidate(
    record,
    sourceDomain,
    fingerprint,
    searchedKeywords.length,
    enrichedByDomain.get(record.domain) || null
  ));
  const results = sortClassifiedCandidates(classified).slice(0, outputCount);

  return {
    version: PEER_DISCOVERY_VERSION,
    source_url: sourceUrl,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    pages_succeeded: crawl.pages_succeeded,
    keyword_summary: {
      top_keywords: Array.isArray(keywordSummary.top_keywords) ? keywordSummary.top_keywords : [],
      ai_ranked: !!keywordSummary.ai_ranked,
      ai_error: String(keywordSummary.ai_error || '').trim(),
    },
    searched_keywords: searchedKeywords,
    configured: true,
    provider: search.provider || 'web_search',
    raw_results_count: search.queryResults.length,
    unique_domains_count: aggregated.length,
    filtered_count: survivors.length,
    light_fetch_count: fetchTargets.length,
    results,
    errors: search.errors.slice(0, 10),
    error: '',
  };
}

module.exports = {
  runPeerDiscovery,
  PEER_DISCOVERY_VERSION,
};
