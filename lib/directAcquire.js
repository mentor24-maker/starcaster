const fs = require('fs');
const os = require('os');
const path = require('path');
const { getProviderValues } = require('./apiSettings');
const blueskyClient = require('./blueskyClient');

const PREFERRED_STORE_FILE = path.join(__dirname, '..', 'data', 'direct_acquire_runs.json');
const FALLBACK_STORE_FILE = path.join(os.tmpdir(), 'alphire-promo', 'direct_acquire_runs.json');
let resolvedStoreFile = '';

function canWriteToDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function getStoreFile() {
  if (resolvedStoreFile) return resolvedStoreFile;
  const configured = String(process.env.DIRECT_ACQUIRE_STORE_FILE || '').trim();
  if (configured) {
    const configuredDir = path.dirname(configured);
    if (canWriteToDir(configuredDir)) {
      resolvedStoreFile = configured;
      return resolvedStoreFile;
    }
  }
  const preferredDir = path.dirname(PREFERRED_STORE_FILE);
  if (canWriteToDir(preferredDir)) {
    resolvedStoreFile = PREFERRED_STORE_FILE;
    return resolvedStoreFile;
  }
  const fallbackDir = path.dirname(FALLBACK_STORE_FILE);
  canWriteToDir(fallbackDir);
  resolvedStoreFile = FALLBACK_STORE_FILE;
  return resolvedStoreFile;
}

function ensureStore() {
  const storeFile = getStoreFile();
  const dir = path.dirname(storeFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(storeFile)) {
    fs.writeFileSync(storeFile, JSON.stringify({ runs: [] }, null, 2));
  }
}

function readStore() {
  const storeFile = getStoreFile();
  ensureStore();
  try {
    const raw = fs.readFileSync(storeFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.runs)) return { runs: [] };
    return parsed;
  } catch {
    return { runs: [] };
  }
}

function writeStore(store) {
  const storeFile = getStoreFile();
  ensureStore();
  const tmp = `${storeFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, storeFile);
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('source_url is required');
  const withProto = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  const url = new URL(withProto);
  url.hash = '';
  return url.toString();
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripStructuralHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ');
}

function extractFirst(html, regex) {
  const m = String(html || '').match(regex);
  return m && m[1] ? stripHtml(m[1]).trim() : '';
}

function extractAll(html, regex) {
  const out = [];
  const source = String(html || '');
  let match;
  while ((match = regex.exec(source))) {
    const value = stripHtml(match[1]).trim();
    if (value) out.push(value);
  }
  return out;
}

function extractEmails(text) {
  const found = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return Array.from(new Set(found.map((v) => v.toLowerCase()))).slice(0, 50);
}

function extractPhones(text) {
  const found = String(text || '').match(/\+?\d[\d\s().-]{7,}\d/g) || [];
  const normalized = found
    .map((v) => v.replace(/\s+/g, ' ').trim())
    .filter((v) => v.length >= 10 && v.length <= 26);
  return Array.from(new Set(normalized)).slice(0, 50);
}

function normalizeImageUrl(baseUrl, raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^(data:|blob:|javascript:)/i.test(text)) return '';
  try {
    const parsed = new URL(text, baseUrl);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function looksLikeContentImage(url) {
  const text = String(url || '').trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/\b(sprite|icon|favicon|logo|avatar|badge|emoji|tracking|pixel)\b/.test(lower)) return false;
  if (/[?&](w|width|h|height)=([1-9]?\d|1\d\d)\b/.test(lower)) return false;
  if (/\b(32x32|48x48|64x64|96x96|120x120|150x150|180x180)\b/.test(lower)) return false;
  return /\.(jpg|jpeg|png|webp|gif|avif|svg)(?:[?#].*)?$/i.test(lower) || /\/wp-content\/uploads\//i.test(lower);
}

function extractImageUrls(baseUrl, html) {
  const found = [];
  const push = (value) => {
    const normalized = normalizeImageUrl(baseUrl, value);
    if (!normalized || !looksLikeContentImage(normalized)) return;
    if (found.includes(normalized)) return;
    found.push(normalized);
  };
  extractAll(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi).forEach(push);
  extractAll(html, /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi).forEach(push);
  extractAll(html, /<img[^>]+src=["']([^"']+)["'][^>]*>/gi).forEach(push);
  extractAll(html, /<img[^>]+srcset=["']([^"']+)["'][^>]*>/gi).forEach((srcset) => {
    String(srcset || '').split(',').forEach((part) => {
      const candidate = String(part || '').trim().split(/\s+/)[0];
      push(candidate);
    });
  });
  return found.slice(0, 60);
}

function pushUnique(list, value, limit = 50) {
  const text = String(value || '').trim();
  if (!text) return;
  if (!Array.isArray(list)) return;
  if (list.includes(text)) return;
  if (list.length >= limit) return;
  list.push(text);
}

function normalizeSocialUrl(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function socialPlatformFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = String(parsed.hostname || '').toLowerCase().replace(/^www\./, '');
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host === 'x.com' || host.endsWith('.x.com') || host.includes('twitter.com')) return 'x';
    if (host.includes('bsky.app') || host.includes('bsky.social')) return 'bluesky';
    if (host.includes('facebook.com')) return 'facebook';
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('patreon.com')) return 'patreon';
    if (host.includes('substack.com')) return 'substack';
    if (host.includes('medium.com')) return 'medium';
    if (host.includes('t.me') || host.includes('telegram.me')) return 'telegram';
    if (host.includes('discord.gg') || host.includes('discord.com')) return 'discord';
    if (host.includes('wa.me') || host.includes('whatsapp.com')) return 'whatsapp';
  } catch {
    return '';
  }
  return '';
}

function initContactSummary(sourceUrl) {
  return {
    website: sourceUrl,
    emails: [],
    phones: [],
    youtube: [],
    instagram: [],
    tiktok: [],
    facebook: [],
    x: [],
    bluesky: [],
    linkedin: [],
    patreon: [],
    substack: [],
    medium: [],
    telegram: [],
    discord: [],
    whatsapp: [],
  };
}

function mergePageContactSignals(summary, page) {
  if (!summary || !page) return summary;
  (Array.isArray(page.emails) ? page.emails : []).forEach((email) => pushUnique(summary.emails, String(email || '').toLowerCase()));
  (Array.isArray(page.phones) ? page.phones : []).forEach((phone) => pushUnique(summary.phones, phone));
  (Array.isArray(page.social_links) ? page.social_links : []).forEach((url) => {
    const platform = socialPlatformFromUrl(url);
    if (!platform || !summary[platform]) return;
    pushUnique(summary[platform], normalizeSocialUrl(url));
  });
  return summary;
}

function buildContactLabels(summary) {
  if (!summary || typeof summary !== 'object') return [];
  const firstValue = (value) => Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
  const labels = [
    ['Website', firstValue(summary.website)],
    ['Email', firstValue(summary.emails)],
    ['Phone', firstValue(summary.phones)],
    ['YouTube', firstValue(summary.youtube)],
    ['Instagram', firstValue(summary.instagram)],
    ['TikTok', firstValue(summary.tiktok)],
    ['Facebook', firstValue(summary.facebook)],
    ['X', firstValue(summary.x)],
    ['Bluesky', firstValue(summary.bluesky)],
    ['LinkedIn', firstValue(summary.linkedin)],
    ['Patreon', firstValue(summary.patreon)],
    ['Substack', firstValue(summary.substack)],
    ['Medium', firstValue(summary.medium)],
    ['Telegram', firstValue(summary.telegram)],
    ['Discord', firstValue(summary.discord)],
    ['WhatsApp', firstValue(summary.whatsapp)],
  ];
  return labels.filter(([, value]) => String(value || '').trim());
}

function buildImageSummary(pages) {
  const scores = new Map();
  const pageHits = new Map();
  (Array.isArray(pages) ? pages : []).forEach((page, pageIndex) => {
    const seenOnPage = new Set();
    (Array.isArray(page?.image_urls) ? page.image_urls : []).forEach((url, imageIndex) => {
      const normalized = String(url || '').trim();
      if (!normalized) return;
      const baseScore = imageIndex < 2 ? 4 : imageIndex < 6 ? 2.5 : 1;
      scores.set(normalized, Number(scores.get(normalized) || 0) + baseScore);
      if (!seenOnPage.has(normalized)) {
        pageHits.set(normalized, Number(pageHits.get(normalized) || 0) + 1);
        seenOnPage.add(normalized);
      }
    });
  });
  return Array.from(scores.entries())
    .map(([url, score]) => ({
      url,
      score: Number((score + (Number(pageHits.get(url) || 0) * 1.5)).toFixed(1)),
      page_hits: Number(pageHits.get(url) || 0),
    }))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, 120);
}

function hashtagifyKeyword(keyword) {
  const tokens = tokenizeKeywordTerms(keyword).filter(Boolean);
  if (!tokens.length || tokens.length > 4) return '';
  const compact = tokens.join('');
  if (compact.length < 3 || compact.length > 40) return '';
  return `#${compact.toLowerCase()}`;
}

function acronymHashtag(keyword) {
  const tokens = tokenizeKeywordTerms(keyword).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return '';
  const acronym = tokens.map((token) => token[0]).join('').toLowerCase();
  if (acronym.length < 2 || acronym.length > 8) return '';
  if (KEYWORD_STOPWORDS.has(acronym)) return '';
  return `#${acronym}`;
}

function buildHashtagCandidates(keywordSummary) {
  const rawKeywords = Array.isArray(keywordSummary?.top_keywords) ? keywordSummary.top_keywords : [];
  const ranked = [];
  const seen = new Set();
  rawKeywords.slice(0, 30).forEach((item) => {
    const keyword = String(item?.keyword || '').trim();
    const variants = [hashtagifyKeyword(keyword), acronymHashtag(keyword)].filter(Boolean);
    variants.forEach((hashtag, index) => {
      const normalized = hashtag.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      ranked.push({
        hashtag,
        source_keyword: keyword,
        source_score: Number(item?.score || 0) || 0,
        variant_rank: index,
      });
    });
  });
  return ranked.slice(0, 30);
}

async function fetchJson(url, accessJwt) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `Network error: ${String(err?.message || err || 'request failed')}` };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, status: response.status || 500, error: String(data?.message || data?.error || 'Bluesky request failed'), data };
  }
  return { ok: true, status: response.status || 200, data };
}

async function buildHashtagSummary(keywordSummary) {
  const candidates = buildHashtagCandidates(keywordSummary);
  if (!candidates.length) {
    return { hashtags: [], provider: 'bluesky', configured: false, error: 'No keyword candidates available for hashtag discovery.' };
  }
  const creds = blueskyClient.getBlueskyCredentials();
  if (!blueskyClient.isConfigured(creds)) {
    return { hashtags: [], provider: 'bluesky', configured: false, error: 'Bluesky credentials are not configured.' };
  }
  const session = await blueskyClient.createSession(creds);
  if (!session.ok) {
    return { hashtags: [], provider: 'bluesky', configured: true, error: String(session.error || 'Could not authenticate to Bluesky.') };
  }

  const results = [];
  for (const candidate of candidates.slice(0, 20)) {
    const params = new URLSearchParams({
      q: candidate.hashtag,
      limit: '15',
      sort: 'top',
    });
    const endpoint = `${creds.serviceUrl}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`;
    const res = await fetchJson(endpoint, session.accessJwt);
    if (!res.ok) continue;
    const posts = Array.isArray(res.data?.posts) ? res.data.posts : [];
    if (!posts.length) continue;
    const authors = new Set();
    let engagement = 0;
    posts.forEach((post) => {
      const did = String(post?.author?.did || '').trim();
      if (did) authors.add(did);
      engagement += Number(post?.likeCount || 0) + Number(post?.repostCount || 0) + (Number(post?.replyCount || 0) * 1.5);
    });
    const sample = String(posts[0]?.text || '').replace(/\s+/g, ' ').trim();
    const evidenceScore = Number((posts.length * 4 + authors.size * 3 + Math.min(engagement, 200) / 10 + candidate.source_score).toFixed(1));
    results.push({
      hashtag: candidate.hashtag,
      keyword: candidate.source_keyword,
      evidence_score: evidenceScore,
      posts_count: posts.length,
      author_count: authors.size,
      sample_usage: sample,
      platform: 'Bluesky',
    });
  }

  return {
    provider: 'bluesky',
    configured: true,
    hashtags: results
      .sort((a, b) => b.evidence_score - a.evidence_score || b.posts_count - a.posts_count || a.hashtag.localeCompare(b.hashtag))
      .slice(0, 20),
  };
}

const KEYWORD_STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could',
  'did', 'do', 'does', 'doing', 'down', 'during',
  'each',
  'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just',
  'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up',
  'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'home', 'page', 'click', 'read', 'learn', 'welcome', 'contact'
]);
const ALLOWED_SHORT_KEYWORD_TERMS = new Set(['ai', 'ui', 'ux', 'vr', 'ar']);
const BOILERPLATE_PHRASE_STOPWORDS = new Set(['read more', 'learn more', 'click here', 'sign up', 'log in', 'get started']);

function normalizeKeywordTerm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitKeywordExclusions(value) {
  return String(value || '')
    .split(/\r?\n|,|;/g)
    .map((item) => normalizeKeywordTerm(item))
    .filter(Boolean);
}

function tokenizeKeywordTerms(value) {
  const normalized = normalizeKeywordTerm(value);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((term) => term.trim())
    .filter((term) => {
      if (!term) return false;
      if (term.length > 32) return false;
      if (term.length >= 3) return !KEYWORD_STOPWORDS.has(term);
      return ALLOWED_SHORT_KEYWORD_TERMS.has(term);
    });
}

function keywordIsExcluded(keyword, exclusions) {
  const normalized = normalizeKeywordTerm(keyword);
  if (!normalized) return true;
  const list = Array.isArray(exclusions) ? exclusions : [];
  if (!list.length) return false;
  return list.some((excluded) => {
    const needle = normalizeKeywordTerm(excluded);
    if (!needle) return false;
    return normalized === needle || normalized.includes(needle);
  });
}

function splitKeywordTextSegments(value) {
  return String(value || '')
    .split(/[\r\n]+|[.!?;:|]+|\s{2,}/g)
    .map((segment) => normalizeKeywordTerm(segment))
    .filter(Boolean);
}

function countPageKeywordUnits(value, options = {}) {
  const {
    maxSegments = 250,
    maxTokensPerSegment = 40,
    maxNgramSize = 3,
    minPhraseRepeats = 1,
    includeSingles = true,
  } = options || {};
  const counts = new Map();
  const segments = splitKeywordTextSegments(value).slice(0, maxSegments);
  if (!segments.length) return counts;
  const add = (phrase, amount) => {
    const normalized = normalizeKeywordTerm(phrase);
    if (!normalized) return;
    if (BOILERPLATE_PHRASE_STOPWORDS.has(normalized)) return;
    counts.set(normalized, Number(counts.get(normalized) || 0) + Number(amount || 0));
  };
  segments.forEach((segment) => {
    const tokens = tokenizeKeywordTerms(segment).slice(0, maxTokensPerSegment);
    if (!tokens.length) return;
    const segmentPhraseCounts = new Map();
    const countPhrase = (phrase) => {
      const normalized = normalizeKeywordTerm(phrase);
      if (!normalized) return;
      segmentPhraseCounts.set(normalized, Number(segmentPhraseCounts.get(normalized) || 0) + 1);
    };
    if (includeSingles) {
      tokens.forEach((token) => add(token, 1));
    }
    for (let size = 2; size <= maxNgramSize; size += 1) {
      for (let i = 0; i <= tokens.length - size; i += 1) {
        countPhrase(tokens.slice(i, i + size).join(' '));
      }
    }
    segmentPhraseCounts.forEach((repeatCount, phrase) => {
      if (repeatCount < minPhraseRepeats) return;
      add(phrase, repeatCount * (phrase.split(' ').length === 2 ? 1.4 : 1.9));
    });
  });
  return counts;
}

function scoreKeywordPhrases(phraseMap, text, weight, options = {}) {
  const counts = countPageKeywordUnits(text, options);
  counts.forEach((count, phrase) => {
    phraseMap.set(phrase, Number(phraseMap.get(phrase) || 0) + (count * Number(weight || 0)));
  });
}

function addExactPhraseCandidates(text, countMap, options = {}) {
  const {
    maxSegments = 80,
    maxTokensPerSegment = 18,
    maxNgramSize = 3,
    minPhraseRepeats = 1,
  } = options || {};
  const segments = splitKeywordTextSegments(text).slice(0, maxSegments);
  segments.forEach((segment) => {
    const tokens = tokenizeKeywordTerms(segment).slice(0, maxTokensPerSegment);
    if (tokens.length < 2) return;
    const segmentCounts = new Map();
    for (let size = 2; size <= maxNgramSize; size += 1) {
      for (let i = 0; i <= tokens.length - size; i += 1) {
        const phrase = tokens.slice(i, i + size).join(' ');
        const normalized = normalizeKeywordTerm(phrase);
        if (!normalized || BOILERPLATE_PHRASE_STOPWORDS.has(normalized)) continue;
        segmentCounts.set(normalized, Number(segmentCounts.get(normalized) || 0) + 1);
      }
    }
    segmentCounts.forEach((repeatCount, phrase) => {
      if (repeatCount < minPhraseRepeats) return;
      countMap.set(phrase, Number(countMap.get(phrase) || 0) + repeatCount);
    });
  });
}

function buildBodyPhraseCounts(text) {
  const counts = new Map();
  addExactPhraseCandidates(text, counts, {
    maxSegments: 700,
    maxTokensPerSegment: 28,
    maxNgramSize: 3,
    minPhraseRepeats: 2,
  });
  return counts;
}

function buildStructuredPhraseCounts(text) {
  const counts = new Map();
  addExactPhraseCandidates(text, counts, {
    maxSegments: 80,
    maxTokensPerSegment: 18,
    maxNgramSize: 3,
    minPhraseRepeats: 1,
  });
  return counts;
}

function phraseLooksCoherent(phrase) {
  const normalized = normalizeKeywordTerm(phrase);
  if (!normalized) return false;
  const tokens = normalized.split(' ').filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.length === 1) return true;
  if (tokens.length > 3) return false;
  if (tokens.some((token) => KEYWORD_STOPWORDS.has(token) && !ALLOWED_SHORT_KEYWORD_TERMS.has(token))) return false;
  if (tokens.some((token) => token.length < 3 && !ALLOWED_SHORT_KEYWORD_TERMS.has(token))) return false;
  if (tokens[0].endsWith('ed') && tokens.length > 1) return false;
  if (tokens[tokens.length - 1].endsWith('ed')) return false;
  return true;
}

function buildKeywordLabels(summary) {
  if (!summary || !Array.isArray(summary.top_keywords)) return [];
  return summary.top_keywords
    .map((item) => [String(item?.keyword || '').trim(), Number(item?.score || 0) || 0])
    .filter(([keyword]) => keyword);
}

function summarizeKeywordSources(page) {
  return {
    title: String(page?.title || '').trim(),
    meta_desc: String(page?.meta_desc || '').trim(),
    meta_keywords: Array.isArray(page?.meta_keywords) ? page.meta_keywords.map((value) => String(value || '').trim()).filter(Boolean) : [],
    headings: Array.isArray(page?.headings) ? page.headings.map((value) => String(value || '').trim()).filter(Boolean) : [],
    body_text: String(page?.body_text || '').trim(),
  };
}

function buildGlobalKeywordCandidates(pages, exclusions = []) {
  const totalDocs = Math.max(1, Array.isArray(pages) ? pages.length : 0);
  const global = new Map();
  const addSource = (phrase, amount, sourceKey, pageIndex) => {
    const normalized = normalizeKeywordTerm(phrase);
    if (!normalized || keywordIsExcluded(normalized, exclusions)) return;
    const termCount = normalized.split(' ').filter(Boolean).length;
    if (!termCount || termCount > 3) return;
    if (!phraseLooksCoherent(normalized)) return;
    if (!global.has(normalized)) {
      global.set(normalized, {
        keyword: normalized,
        raw_score: 0,
        doc_ids: new Set(),
        field_hits: new Set(),
        term_count: termCount,
      });
    }
    const entry = global.get(normalized);
    entry.raw_score += Number(amount || 0);
    entry.doc_ids.add(pageIndex);
    if (sourceKey) entry.field_hits.add(sourceKey);
  };

  (Array.isArray(pages) ? pages : []).forEach((page, pageIndex) => {
    const sources = summarizeKeywordSources(page);
    const applyCounts = (counts, weight, sourceKey) => {
      counts.forEach((count, phrase) => addSource(phrase, count * weight, sourceKey, pageIndex));
    };

    applyCounts(countPageKeywordUnits(sources.title, { maxSegments: 2, maxTokensPerSegment: 20, maxNgramSize: 1, includeSingles: true }), 7.5, 'title');
    applyCounts(buildStructuredPhraseCounts(sources.title), 8.5, 'title');

    applyCounts(countPageKeywordUnits(sources.meta_desc, { maxSegments: 4, maxTokensPerSegment: 40, maxNgramSize: 1, includeSingles: true }), 4.5, 'meta_desc');
    applyCounts(buildStructuredPhraseCounts(sources.meta_desc), 5.5, 'meta_desc');

    sources.meta_keywords.forEach((value) => {
      addSource(value, 12, 'meta_keywords', pageIndex);
      applyCounts(countPageKeywordUnits(value, { maxSegments: 2, maxTokensPerSegment: 12, maxNgramSize: 1, includeSingles: true }), 6.5, 'meta_keywords');
      applyCounts(buildStructuredPhraseCounts(value), 7.5, 'meta_keywords');
    });
    sources.headings.forEach((value, index) => {
      addSource(value, index < 2 ? 10 : 7.5, 'heading', pageIndex);
      applyCounts(countPageKeywordUnits(value, { maxSegments: 2, maxTokensPerSegment: 24, maxNgramSize: 1, includeSingles: true }), index < 2 ? 5.5 : 4.2, 'heading');
      applyCounts(buildStructuredPhraseCounts(value), index < 2 ? 8.5 : 6.5, 'heading');
    });
    applyCounts(countPageKeywordUnits(sources.body_text, { maxSegments: 700, maxTokensPerSegment: 28, maxNgramSize: 1, includeSingles: true }), 0.85, 'body');
    applyCounts(buildBodyPhraseCounts(sources.body_text), 3.25, 'body');
  });

  return Array.from(global.values())
    .map((entry) => {
      const df = Math.max(1, entry.doc_ids.size);
      const idf = Math.log(1 + (totalDocs / df));
      const fieldBoost = entry.field_hits.has('title') || entry.field_hits.has('heading') || entry.field_hits.has('meta_keywords')
        ? 1.35
        : entry.field_hits.has('meta_desc')
          ? 1.15
          : 1;
      const phraseBoost = entry.term_count === 1 ? 0.82 : entry.term_count === 2 ? 1.28 : 1.42;
      const singletonPenalty = entry.term_count === 1 && df === 1 && !entry.field_hits.has('title') && !entry.field_hits.has('heading')
        ? 0.45
        : 1;
      const weakBodyOnlyPhrasePenalty = entry.term_count > 1 && df === 1 && entry.field_hits.size === 1 && entry.field_hits.has('body')
        ? 0.15
        : 1;
      const score = entry.raw_score * (0.6 + idf) * fieldBoost * phraseBoost * singletonPenalty * weakBodyOnlyPhrasePenalty;
      return {
        keyword: entry.keyword,
        score,
        raw_score: entry.raw_score,
        doc_frequency: df,
        term_count: entry.term_count,
        field_hits: Array.from(entry.field_hits),
      };
    })
    .filter((item) => item.keyword && item.score > 0)
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
}

function buildKeywordPageSummaries(pages) {
  return (Array.isArray(pages) ? pages : []).slice(0, 30).map((page) => ({
    url: String(page?.url || '').trim(),
    title: String(page?.title || '').trim(),
    meta_desc: String(page?.meta_desc || '').trim(),
    headings: Array.isArray(page?.headings) ? page.headings.slice(0, 6).map((value) => String(value || '').trim()).filter(Boolean) : [],
  }));
}

async function rerankKeywordCandidatesWithAi({ sourceUrl, pages, exclusions, candidates }) {
  const apiKey = String(getProviderValues('anthropic')?.api_key || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'Anthropic API key not configured.' };
  const shortlist = (Array.isArray(candidates) ? candidates : []).slice(0, 80).map((item) => item.keyword);
  if (!shortlist.length) return { ok: false, error: 'No keyword candidates to rank.' };

  const prompt = [
    'You are ranking website keywords for meaningful conceptual relevance.',
    'Return strict JSON only in this shape:',
    '{"keywords":["keyword one","keyword two"]}',
    '',
    'Rules:',
    '- Return exactly 20 keywords or fewer if not enough quality items exist.',
    '- Prefer meaningful concepts, themes, and search-style phrases.',
    '- Strongly prefer 2-word and 3-word phrases when they are more specific than a single word.',
    '- Reject brand names, navigation labels, boilerplate fragments, and awkward phrase fragments.',
    '- Keep keywords grounded in the website content provided.',
    '',
    `Source URL: ${String(sourceUrl || '').trim() || '-'}`,
    `Exclusions: ${(Array.isArray(exclusions) ? exclusions : []).join(', ') || '-'}`,
    '',
    'Page summaries:',
    JSON.stringify(buildKeywordPageSummaries(pages), null, 2),
    '',
    'Candidate keywords:',
    JSON.stringify(shortlist, null, 2),
  ].join('\n');

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'You rank website keywords for conceptual relevance. Output strict JSON only.',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return { ok: false, error: `Anthropic request failed: ${err.message}` };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: String(body?.error?.message || body?.error || 'Anthropic keyword ranking failed') };
  }
  const text = String((Array.isArray(body?.content) ? body.content : []).map((item) => item?.text || '').join('\n') || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(text);
    const keywords = Array.isArray(parsed?.keywords) ? parsed.keywords : [];
    return {
      ok: true,
      data: keywords.map((value) => normalizeKeywordTerm(value)).filter(Boolean),
    };
  } catch {
    return { ok: false, error: 'Anthropic returned invalid keyword ranking JSON.' };
  }
}

async function buildKeywordSummary({ sourceUrl, pages, exclusions }) {
  const localCandidates = buildGlobalKeywordCandidates(pages, exclusions);
  const topLocal = localCandidates.slice(0, 20);
  const aiRank = await rerankKeywordCandidatesWithAi({ sourceUrl, pages, exclusions, candidates: localCandidates });
  if (!aiRank.ok || !Array.isArray(aiRank.data) || !aiRank.data.length) {
    return {
      top_keywords: topLocal.map((item) => ({ keyword: item.keyword, score: Number(item.score.toFixed(1)) })),
      ai_ranked: false,
      ai_error: aiRank.error || '',
    };
  }
  const localMap = new Map(localCandidates.map((item) => [normalizeKeywordTerm(item.keyword), item]));
  const ranked = aiRank.data
    .map((keyword, index) => {
      const local = localMap.get(keyword);
      const rankBonus = Math.max(0, 25 - index);
      const score = (local ? local.score : 5) + rankBonus;
      return {
        keyword,
        score: Number(score.toFixed(1)),
      };
    })
    .filter((item, index, list) => item.keyword && list.findIndex((other) => other.keyword === item.keyword) === index)
    .slice(0, 20);
  return {
    top_keywords: ranked,
    ai_ranked: true,
    ai_error: '',
  };
}

function mergePageKeywordSignals(summary, page, exclusions = []) {
  if (!summary || !page) return summary;
  if (!(summary.keyword_scores instanceof Map)) summary.keyword_scores = new Map();
  extractPageKeywords(page, exclusions).forEach((item) => {
    summary.keyword_scores.set(
      item.keyword,
      Number(summary.keyword_scores.get(item.keyword) || 0) + Number(item.score || 0)
    );
  });
  summary.top_keywords = Array.from(summary.keyword_scores.entries())
    .map(([keyword, score]) => ({ keyword, score }))
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword))
    .slice(0, 20);
  return summary;
}

function initKeywordSummary() {
  return {
    top_keywords: [],
    keyword_scores: new Map(),
  };
}

function extractLinks(baseUrl, html) {
  const links = [];
  const seen = new Set();
  const hrefRegex = /<a[^>]+href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = hrefRegex.exec(html))) {
    try {
      const absolute = new URL(m[1], baseUrl);
      absolute.hash = '';
      const clean = absolute.toString();
      if (!/^https?:\/\//i.test(clean)) continue;
      if (seen.has(clean)) continue;
      seen.add(clean);
      links.push(clean);
    } catch {
      // ignore invalid href
    }
  }
  return links;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function fetchPage(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'user-agent': 'APH-Direct-Acquire/1.0',
      accept: 'text/html,application/xhtml+xml'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function runDirectAcquire(input) {
  const sourceUrl = normalizeUrl(input.source_url);
  const maxPages = Math.max(1, Math.min(Number(input.max_pages) || 5, 50));
  const snippetChars = Math.max(100, Math.min(Number(input.body_snippet_chars) || 500, 5000));
  const captureContactData = input.capture_contact_data === true || String(input.capture_contact_data || '').trim().toLowerCase() === 'true';
  const keywordExclusions = splitKeywordExclusions(input.keyword_exclusions);
  const runId = makeId('dhrun');
  const startedAt = new Date().toISOString();

  const sourceDomain = domainOf(sourceUrl);
  const queue = [sourceUrl];
  const visited = new Set();
  const pages = [];
  const errors = [];
  const contactSummary = captureContactData ? initContactSummary(sourceUrl) : null;

  while (queue.length && pages.length < maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    try {
      const html = await fetchPage(current);
      const text = stripHtml(stripStructuralHtml(html));
      const title = extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      const metaDesc = extractFirst(
        html,
        /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i
      );
      const metaKeywordsRaw = extractFirst(
        html,
        /<meta[^>]*name=["']keywords["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i
      );
      const headings = extractAll(html, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi).slice(0, 20);
      const snippet = text.slice(0, snippetChars);
      const emails = extractEmails(text);
      const phones = extractPhones(text);
      const links = extractLinks(current, html);
      const imageUrls = extractImageUrls(current, html);
      const socialLinks = links
        .map((href) => normalizeSocialUrl(href))
        .filter(Boolean)
        .filter((href) => Boolean(socialPlatformFromUrl(href)));

      const pageRecord = {
        url: current,
        title,
        meta_desc: metaDesc,
        meta_keywords: metaKeywordsRaw
          ? metaKeywordsRaw.split(',').map((value) => stripHtml(value).trim()).filter(Boolean).slice(0, 20)
          : [],
        headings,
        body_text: text.slice(0, 50000),
        body_snippet: snippet,
        emails,
        phones,
        image_urls: imageUrls,
        social_links: socialLinks,
        links_count: links.length,
        fetched_at: new Date().toISOString()
      };

      pages.push(pageRecord);
      if (contactSummary) mergePageContactSignals(contactSummary, pageRecord);

      links
        .filter((href) => domainOf(href) === sourceDomain)
        .forEach((href) => {
          if (!visited.has(href) && !queue.includes(href) && queue.length < maxPages * 4) {
            queue.push(href);
          }
        });
    } catch (err) {
      errors.push({ url: current, error: err.message || 'fetch failed' });
    }
  }

  const finishedAt = new Date().toISOString();
  const keywordSummary = await buildKeywordSummary({
    sourceUrl,
    pages,
    exclusions: keywordExclusions,
  });
  const hashtagSummary = await buildHashtagSummary(keywordSummary);
  const imageSummary = buildImageSummary(pages);
  pages.forEach((page) => {
    delete page.body_text;
  });
  const run = {
    run_id: runId,
    source_url: sourceUrl,
    max_pages: maxPages,
    body_snippet_chars: snippetChars,
    pages_total: pages.length + errors.length,
    pages_succeeded: pages.length,
    pages_failed: errors.length,
    started_at: startedAt,
    finished_at: finishedAt,
    capture_contact_data: captureContactData,
    keyword_exclusions: keywordExclusions,
    contact_summary: contactSummary,
    contact_labels: buildContactLabels(contactSummary),
    image_summary: {
      images: imageSummary,
    },
    keyword_summary: {
      top_keywords: Array.isArray(keywordSummary.top_keywords) ? keywordSummary.top_keywords : [],
      ai_ranked: !!keywordSummary.ai_ranked,
      ai_error: String(keywordSummary.ai_error || '').trim(),
    },
    hashtag_summary: {
      hashtags: Array.isArray(hashtagSummary.hashtags) ? hashtagSummary.hashtags : [],
      provider: String(hashtagSummary.provider || '').trim(),
      configured: !!hashtagSummary.configured,
      error: String(hashtagSummary.error || '').trim(),
    },
    keyword_labels: buildKeywordLabels(keywordSummary),
    pages,
    errors
  };

  const store = readStore();
  store.runs.unshift(run);
  store.runs = store.runs.slice(0, 100);
  writeStore(store);

  return run;
}

function listDirectAcquireRuns(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const store = readStore();
  return store.runs.slice(0, safeLimit).map((run) => ({
    run_id: run.run_id,
    source_url: run.source_url,
    pages_succeeded: run.pages_succeeded,
    pages_failed: run.pages_failed,
    started_at: run.started_at,
    finished_at: run.finished_at
  }));
}

function getDirectAcquireRun(runId) {
  const id = String(runId || '').trim();
  if (!id) return null;
  const store = readStore();
  return store.runs.find((r) => String(r.run_id) === id) || null;
}

module.exports = {
  runDirectAcquire,
  listDirectAcquireRuns,
  getDirectAcquireRun
};
