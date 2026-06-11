const { getProviderValues } = require('./apiSettings');
const {
  resolveWebSearchConfig,
  fetchWebSearchBatch,
  webSearchConfigurationError,
} = require('./webSearch');
const blueskyClient = require('./blueskyClient');
const {
  saveDirectAcquireRun,
  listDirectAcquireRuns: listRunsFromStore,
  getDirectAcquireRun: getRunFromStore,
  getLatestDirectAcquireRun: getLatestRunFromStore,
} = require('./directAcquireRunsStore');

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

function imageFilenameFromUrl(url) {
  try {
    const last = String(new URL(String(url || '').trim()).pathname || '').split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last).trim();
  } catch {
    return '';
  }
}

function inferImageFormat(url) {
  const lower = String(url || '').trim().toLowerCase();
  const match = lower.match(/\.(jpe?g|png|webp|gif|avif|svg|ico|bmp)(?:[?#]|$)/i);
  if (match) {
    const ext = match[1].toLowerCase();
    return ext === 'jpg' ? 'jpeg' : ext;
  }
  if (/\/svg/i.test(lower)) return 'svg';
  return 'unknown';
}

function inferDimensionsFromUrl(url) {
  const text = String(url || '').trim();
  if (!text) return { width: null, height: null };
  const patterns = [
    /\b(\d{2,5})x(\d{2,5})\b/i,
    /-(\d{2,5})w(?:[.-]|$)/i,
    /\/(\d{2,5})w\//i,
    /[?&](?:w|width)=(\d{2,5})\b/i,
    /[?&](?:h|height)=(\d{2,5})\b/i,
  ];
  const bySize = text.match(patterns[0]);
  if (bySize) {
    return {
      width: Number(bySize[1]) || null,
      height: Number(bySize[2]) || null,
    };
  }
  const widthOnly = text.match(patterns[1]) || text.match(patterns[2]) || text.match(patterns[3]);
  const heightOnly = text.match(patterns[4]);
  return {
    width: widthOnly ? Number(widthOnly[1]) || null : null,
    height: heightOnly ? Number(heightOnly[1]) || null : null,
  };
}

function parseTagDimensions(tagHtml) {
  const widthMatch = String(tagHtml || '').match(/\bwidth=["']?(\d{2,5})/i);
  const heightMatch = String(tagHtml || '').match(/\bheight=["']?(\d{2,5})/i);
  return {
    width: widthMatch ? Number(widthMatch[1]) || null : null,
    height: heightMatch ? Number(heightMatch[1]) || null : null,
  };
}

function classifyAspectLabel(width, height) {
  if (!width || !height) return 'unknown';
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= 0.08) return 'square';
  if (ratio >= 2.2) return 'wide';
  if (ratio <= 0.45) return 'tall';
  if (ratio > 1) return 'landscape';
  if (ratio < 1) return 'portrait';
  return 'square';
}

function inferImageRoles(url, source, tagHtml = '') {
  const roles = new Set();
  const lower = String(url || '').trim().toLowerCase();
  const tagLower = String(tagHtml || '').toLowerCase();
  const format = inferImageFormat(url);

  if (source === 'css-background' || source === 'data-background') roles.add('background');
  if (source === 'link-icon') roles.add('favicon');
  if (source === 'meta-og' || source === 'meta-twitter') roles.add('social-preview');
  if (format === 'svg') roles.add('svg');
  if (/\blogo\b/.test(lower)) roles.add('logo');
  if (/\b(icon|glyph|symbol)\b/.test(lower) || /\/icons?\//.test(lower)) roles.add('icon');
  if (/\b(avatar|profile|headshot)\b/.test(lower)) roles.add('avatar');
  if (/\b(flag|flags)\b/.test(lower) || /\/flags?\//.test(lower)) roles.add('flag');
  if (/\b(sprite|spritesheet)\b/.test(lower)) roles.add('sprite');
  if (/\b(badge|seal|award)\b/.test(lower)) roles.add('badge');
  if (/\b(tracking|pixel|beacon|analytics)\b/.test(lower)) roles.add('tracking');
  if (/\b(hero|banner|cover|background|bg[-_/]|parallax)\b/.test(lower)) roles.add('background');
  if (/\b(stock|photo|gallery|headline)\b/.test(lower)) roles.add('photo');
  if (/\b(emoji|emoticon)\b/.test(lower)) roles.add('emoji');
  if (/\b(illustration|graphic|artwork)\b/.test(lower)) roles.add('illustration');
  if (/\bdecor/.test(tagLower) || /\bdecorative\b/.test(tagLower)) roles.add('decorative');
  if (!roles.size) roles.add('photo');
  return Array.from(roles);
}

function parseSrcsetCandidates(baseUrl, srcset) {
  return String(srcset || '')
    .split(',')
    .map((part) => String(part || '').trim().split(/\s+/)[0])
    .map((candidate) => normalizeImageUrl(baseUrl, candidate))
    .filter(Boolean);
}

function createHarvestedImageRecord(baseUrl, rawUrl, source, options = {}) {
  const url = normalizeImageUrl(baseUrl, rawUrl);
  if (!url) return null;
  const urlDimensions = inferDimensionsFromUrl(url);
  const width = Number(options.width) || urlDimensions.width || null;
  const height = Number(options.height) || urlDimensions.height || null;
  const format = inferImageFormat(url);
  const roles = inferImageRoles(url, source, options.tagHtml || '');
  if (format === 'svg' && !roles.includes('svg')) roles.push('svg');
  return {
    url,
    filename: imageFilenameFromUrl(url),
    format,
    source,
    roles,
    width,
    height,
    aspect_ratio: width && height ? Number((width / height).toFixed(3)) : null,
    aspect_label: classifyAspectLabel(width, height),
  };
}

function extractAllTagMatches(html, regex) {
  const out = [];
  const source = String(html || '');
  let match;
  while ((match = regex.exec(source))) {
    out.push(match[0]);
  }
  return out;
}

function extractPageImages(baseUrl, html) {
  const byUrl = new Map();
  const push = (rawUrl, source, options = {}) => {
    const record = createHarvestedImageRecord(baseUrl, rawUrl, source, options);
    if (!record) return;
    const existing = byUrl.get(record.url);
    if (!existing) {
      byUrl.set(record.url, {
        ...record,
        sources: [source],
      });
      return;
    }
    if (!Array.isArray(existing.sources)) {
      existing.sources = existing.source ? [existing.source] : [];
    }
    if (!existing.sources.includes(source)) existing.sources.push(source);
    existing.roles = Array.from(new Set([...(existing.roles || []), ...(record.roles || [])]));
    if (record.width && (!existing.width || record.width > existing.width)) existing.width = record.width;
    if (record.height && (!existing.height || record.height > existing.height)) existing.height = record.height;
    if (existing.width && existing.height) {
      existing.aspect_ratio = Number((existing.width / existing.height).toFixed(3));
      existing.aspect_label = classifyAspectLabel(existing.width, existing.height);
    }
  };

  const source = String(html || '');

  extractAll(source, /<meta[^>]+property=["']og:image(?::[^"']+)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi).forEach((value) => push(value, 'meta-og'));
  extractAll(source, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::[^"']+)?["'][^>]*>/gi).forEach((value) => push(value, 'meta-og'));
  extractAll(source, /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi).forEach((value) => push(value, 'meta-twitter'));
  extractAll(source, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/gi).forEach((value) => push(value, 'meta-twitter'));

  extractAllTagMatches(source, /<img\b[^>]*>/gi).forEach((tagHtml) => {
    const dimensions = parseTagDimensions(tagHtml);
    const attrs = [
      ['src', 'img-src'],
      ['data-src', 'data-lazy'],
      ['data-lazy-src', 'data-lazy'],
      ['data-original', 'data-lazy'],
      ['data-dm-image-path', 'data-cms'],
      ['data-bg', 'data-background'],
      ['data-background', 'data-background'],
      ['data-image', 'data-cms'],
    ];
    attrs.forEach(([attr, sourceKind]) => {
      const match = tagHtml.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
      if (match && match[1]) push(match[1], sourceKind, { ...dimensions, tagHtml });
    });
    const srcsetMatch = tagHtml.match(/\bsrcset=["']([^"']+)["']/i);
    if (srcsetMatch && srcsetMatch[1]) {
      parseSrcsetCandidates(baseUrl, srcsetMatch[1]).forEach((candidate) => push(candidate, 'img-srcset', { ...dimensions, tagHtml }));
    }
    const lazySrcsetMatch = tagHtml.match(/\bdata-srcset=["']([^"']+)["']/i);
    if (lazySrcsetMatch && lazySrcsetMatch[1]) {
      parseSrcsetCandidates(baseUrl, lazySrcsetMatch[1]).forEach((candidate) => push(candidate, 'data-lazy', { ...dimensions, tagHtml }));
    }
  });

  extractAllTagMatches(source, /<source\b[^>]*>/gi).forEach((tagHtml) => {
    const srcMatch = tagHtml.match(/\bsrc=["']([^"']+)["']/i);
    if (srcMatch && srcMatch[1]) push(srcMatch[1], 'picture-source', { tagHtml });
    const srcsetMatch = tagHtml.match(/\bsrcset=["']([^"']+)["']/i);
    if (srcsetMatch && srcsetMatch[1]) {
      parseSrcsetCandidates(baseUrl, srcsetMatch[1]).forEach((candidate) => push(candidate, 'picture-source', { tagHtml }));
    }
  });

  extractAllTagMatches(source, /<link\b[^>]*>/gi).forEach((tagHtml) => {
    if (!/\brel=["'][^"']*(?:icon|apple-touch-icon|shortcut icon)/i.test(tagHtml)) return;
    const hrefMatch = tagHtml.match(/\bhref=["']([^"']+)["']/i);
    if (hrefMatch && hrefMatch[1]) push(hrefMatch[1], 'link-icon', { tagHtml });
  });

  extractAll(source, /background-image\s*:\s*url\(\s*['"]?([^'"()]+?)['"]?\s*\)/gi).forEach((value) => push(value, 'css-background'));
  extractAll(source, /background\s*:[^;]*url\(\s*['"]?([^'"()]+?)['"]?\s*\)/gi).forEach((value) => push(value, 'css-background'));

  extractAll(source, /\sdata-(?:src|lazy-src|original|dm-image-path|bg|background|image|srcset)=["']([^"']+)["']/gi).forEach((value) => {
    if (String(value || '').includes(',')) {
      parseSrcsetCandidates(baseUrl, value).forEach((candidate) => push(candidate, 'data-lazy'));
      return;
    }
    push(value, 'data-lazy');
  });

  return Array.from(byUrl.values())
    .map((item) => ({
      ...item,
      source: item.source || (Array.isArray(item.sources) ? item.sources[0] : 'img-src'),
      sources: Array.isArray(item.sources) ? item.sources : [item.source || 'img-src'],
    }))
    .slice(0, 400);
}

function extractImageUrls(baseUrl, html) {
  return extractPageImages(baseUrl, html).map((item) => item.url);
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
  const byUrl = new Map();
  (Array.isArray(pages) ? pages : []).forEach((page, pageIndex) => {
    const pageUrl = String(page?.url || '').trim();
    const items = Array.isArray(page?.image_items) && page.image_items.length
      ? page.image_items
      : (Array.isArray(page?.image_urls) ? page.image_urls : []).map((url, imageIndex) => ({
        url,
        source: 'img-src',
        sources: ['img-src'],
        roles: inferImageRoles(url, 'img-src'),
        filename: imageFilenameFromUrl(url),
        format: inferImageFormat(url),
        width: inferDimensionsFromUrl(url).width,
        height: inferDimensionsFromUrl(url).height,
        aspect_ratio: null,
        aspect_label: 'unknown',
        _index: imageIndex,
      }));
    const seenOnPage = new Set();
    items.forEach((item, imageIndex) => {
      const url = String(item?.url || '').trim();
      if (!url) return;
      const index = Number.isFinite(item?._index) ? item._index : imageIndex;
      const baseScore = index < 2 ? 4 : index < 6 ? 2.5 : 1;
      let record = byUrl.get(url);
      if (!record) {
        const width = Number(item?.width) || inferDimensionsFromUrl(url).width || null;
        const height = Number(item?.height) || inferDimensionsFromUrl(url).height || null;
        record = {
          url,
          filename: String(item?.filename || imageFilenameFromUrl(url) || '').trim(),
          format: String(item?.format || inferImageFormat(url) || 'unknown').toLowerCase(),
          sources: Array.isArray(item?.sources) ? item.sources.slice() : [String(item?.source || 'img-src')],
          roles: Array.isArray(item?.roles) ? item.roles.slice() : inferImageRoles(url, item?.source || 'img-src'),
          page_urls: [],
          page_hits: 0,
          width,
          height,
          aspect_ratio: width && height ? Number((width / height).toFixed(3)) : null,
          aspect_label: classifyAspectLabel(width, height),
          score: 0,
        };
        byUrl.set(url, record);
      }
      record.score += baseScore;
      record.sources = Array.from(new Set([...(record.sources || []), ...(Array.isArray(item?.sources) ? item.sources : [item?.source || 'img-src'])]));
      record.roles = Array.from(new Set([...(record.roles || []), ...(Array.isArray(item?.roles) ? item.roles : [])]));
      if (item?.width && (!record.width || item.width > record.width)) record.width = item.width;
      if (item?.height && (!record.height || item.height > record.height)) record.height = item.height;
      if (record.width && record.height) {
        record.aspect_ratio = Number((record.width / record.height).toFixed(3));
        record.aspect_label = classifyAspectLabel(record.width, record.height);
      }
      if (pageUrl && !seenOnPage.has(url)) {
        seenOnPage.add(url);
        record.page_hits += 1;
        if (!record.page_urls.includes(pageUrl)) record.page_urls.push(pageUrl);
      }
      if (pageIndex === 0 && index < 3) record.score += 1;
    });
  });
  return Array.from(byUrl.values())
    .map((record) => ({
      url: record.url,
      filename: record.filename,
      format: record.format,
      sources: record.sources,
      roles: record.roles,
      page_urls: record.page_urls,
      page_hits: record.page_hits,
      width: record.width,
      height: record.height,
      aspect_ratio: record.aspect_ratio,
      aspect_label: record.aspect_label,
      score: Number((record.score + (Number(record.page_hits || 0) * 1.5)).toFixed(1)),
    }))
    .sort((a, b) => b.score - a.score || String(a.url).localeCompare(String(b.url)))
    .slice(0, 500);
}

function hashtagBodyLength(hashtag) {
  return String(hashtag || '').trim().replace(/^#+/, '').length;
}

function isTwoCharacterHashtag(hashtag) {
  return hashtagBodyLength(hashtag) === 2;
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
  if (acronym.length < 3 || acronym.length > 8) return '';
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
      if (isTwoCharacterHashtag(hashtag)) return;
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
      .filter((row) => !isTwoCharacterHashtag(row?.hashtag))
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

function registrableDomainOf(url) {
  const host = domainOf(url).replace(/^www\./, '');
  if (!host) return '';
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  const lastThree = parts.slice(-3).join('.');
  if (/\.(co|com|org|gov|ac)\.[a-z]{2}$/i.test(host)) return lastThree;
  return lastTwo;
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

function chunked(array, size) {
  const out = [];
  const list = Array.isArray(array) ? array : [];
  const safeSize = Math.max(1, Number(size) || 1);
  for (let i = 0; i < list.length; i += safeSize) out.push(list.slice(i, i + safeSize));
  return out;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = Array.isArray(items) ? items.slice() : [];
  const out = [];
  const limit = Math.max(1, Number(concurrency) || 1);
  async function runWorker() {
    while (queue.length) {
      const item = queue.shift();
      out.push(await worker(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length || 1) }, () => runWorker()));
  return out;
}

function getGoogleSearchConfig() {
  return resolveWebSearchConfig();
}

async function fetchGoogleSearchBatch(query, pageIndex, config) {
  return fetchWebSearchBatch(query, pageIndex, config);
}

const PEER_SITE_PRIMARY_MODELS = [
  'Mega hubs',
  'Industry Hubs and Publications',
  'Comparison Sites',
  'Multinational Corporations',
  'Large Institutions/Organization',
  'Media Giants and Publishers',
  'Thought Leaders/Influencers',
  'Direct Competitors',
];

const PEER_SITE_OTHER_MODELS = [
  'Academic / Research',
  'Government / Civic',
  'Communities / Forums',
  'Tools / SaaS Platforms',
  'Agencies / Consultancies',
  'Directories / Marketplaces',
  'Nonprofit / Advocacy',
  'Local / Regional Organizations',
];

function looksLikePersonalNameDomain(host) {
  const clean = String(host || '').replace(/^www\./, '').split('.')[0] || '';
  if (!clean || clean.length < 5) return false;
  return /^[a-z]+(?:[.-][a-z]+)+$/i.test(clean);
}

function detectPeerSiteSignals(record, sourceDomain) {
  const url = String(record?.url || '').trim();
  const host = registrableDomainOf(url);
  const title = String(record?.title || '').trim();
  const snippet = String(record?.snippet || '').trim();
  const haystack = `${host} ${title} ${snippet}`.toLowerCase();
  const signals = [];
  const knownMega = ['wikipedia.org', 'amazon.com', 'quora.com', 'reddit.com', 'medium.com', 'substack.com', 'youtube.com', 'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'github.com'];
  const knownMedia = ['nytimes.com', 'cnn.com', 'bbc.com', 'forbes.com', 'theguardian.com', 'washingtonpost.com', 'reuters.com', 'bloomberg.com', 'wsj.com', 'vox.com'];
  const knownCorporate = ['google.com', 'apple.com', 'microsoft.com', 'amazon.com', 'meta.com', 'ibm.com', 'oracle.com', 'salesforce.com', 'adobe.com', 'intel.com'];
  const knownComparison = ['g2.com', 'capterra.com', 'getapp.com', 'alternativeto.net', 'trustradius.com', 'producthunt.com'];
  if (!host || host === sourceDomain) return { primary: '', other: [] };
  if (knownMega.includes(host) || /\b(wikipedia|quora|reddit|medium|substack|amazon)\b/.test(haystack)) {
    return { primary: 'Mega hubs', other: [] };
  }
  if (knownComparison.includes(host) || /\b(compare|comparison|alternatives?|reviews?|vs\.?|top\s*10|best\s+)\b/.test(haystack)) {
    return { primary: 'Comparison Sites', other: ['Directories / Marketplaces'] };
  }
  if (knownMedia.includes(host) || /\b(news|magazine|journal|publisher|publishing|press|newspaper|media)\b/.test(haystack)) {
    return { primary: 'Media Giants and Publishers', other: [] };
  }
  if (knownCorporate.includes(host) || /\b(corporation|corp\.?|inc\.?|global|enterprise|holdings|multinational)\b/.test(haystack)) {
    return { primary: 'Multinational Corporations', other: ['Tools / SaaS Platforms'] };
  }
  if (/\.(edu|ac\.[a-z]{2}|gov|org)$/.test(host) || /\b(university|college|institute|foundation|association|nonprofit|organisation|organization|society)\b/.test(haystack)) {
    const other = [];
    if (/\.(edu|ac\.[a-z]{2})$/.test(host) || /\b(university|college|research|institute|lab)\b/.test(haystack)) other.push('Academic / Research');
    if (/\.(gov)$/.test(host) || /\b(city of|government|public sector|department)\b/.test(haystack)) other.push('Government / Civic');
    if (/\b(nonprofit|foundation|advocacy|association)\b/.test(haystack)) other.push('Nonprofit / Advocacy');
    return { primary: 'Large Institutions/Organization', other };
  }
  if (looksLikePersonalNameDomain(host) || /\b(author|speaker|coach|founder|newsletter|podcast|creator|influencer|thought leader)\b/.test(haystack)) {
    return { primary: 'Thought Leaders/Influencers', other: [] };
  }
  if (/\b(community|forum|forums|discussion|thread|threads)\b/.test(haystack)) signals.push('Communities / Forums');
  if (/\b(software|saas|platform|tool|tools|app|apps)\b/.test(haystack)) signals.push('Tools / SaaS Platforms');
  if (/\b(agency|consulting|consultancy|studio|collective)\b/.test(haystack)) signals.push('Agencies / Consultancies');
  if (/\b(directory|directories|marketplace|listing|listings)\b/.test(haystack)) signals.push('Directories / Marketplaces');
  if (/\b(local|regional|county|statewide|community)\b/.test(haystack)) signals.push('Local / Regional Organizations');
  if (/\b(blog|insights|resources|publication|industry)\b/.test(haystack)) {
    return { primary: 'Industry Hubs and Publications', other: signals };
  }
  return { primary: 'Direct Competitors', other: signals };
}

function summarizeOtherPeerModels(records) {
  const counts = new Map();
  records.forEach((record) => {
    (Array.isArray(record?.other_models) ? record.other_models : []).forEach((model) => {
      if (!PEER_SITE_OTHER_MODELS.includes(model)) return;
      const entry = counts.get(model) || { model, count: 0, sample_domains: [] };
      entry.count += 1;
      if (record.domain && entry.sample_domains.length < 3 && !entry.sample_domains.includes(record.domain)) {
        entry.sample_domains.push(record.domain);
      }
      counts.set(model, entry);
    });
  });
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model))
    .slice(0, 6);
}

async function buildPeerSitesSummary(keywordSummary, sourceUrl, options = {}) {
  const enabled = options.enabled === true || String(options.enabled || '').trim().toLowerCase() === 'true';
  const peerSitesLimit = Math.max(5, Math.min(Number(options.peerSitesLimit) || 20, 100));
  if (!enabled) {
    return {
      enabled: false,
      configured: false,
      provider: '',
      error: '',
      peers: [],
      suggested_models: [],
      searched_keywords: [],
      raw_results_count: 0,
      unique_domains_count: 0,
      errors: [],
    };
  }
  const queries = (Array.isArray(keywordSummary?.top_keywords) ? keywordSummary.top_keywords : [])
    .slice(0, 10)
    .map((item) => String(item?.keyword || '').trim())
    .filter(Boolean);
  if (!queries.length) {
    return { enabled: true, configured: false, provider: '', error: 'No keyword candidates available for peer site discovery.', peers: [], suggested_models: [], searched_keywords: [], raw_results_count: 0, unique_domains_count: 0, errors: [] };
  }
  const config = resolveWebSearchConfig();
  if (!config.configured) {
    return { enabled: true, configured: false, provider: config.provider || '', error: webSearchConfigurationError(config), peers: [], suggested_models: [], searched_keywords: queries, raw_results_count: 0, unique_domains_count: 0, errors: [] };
  }
  const sourceDomain = registrableDomainOf(sourceUrl);
  const queryResults = [];
  const errors = [];
  await mapWithConcurrency(queries, 2, async (keyword) => {
    const pageIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
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
          rank: pageIndex * 10 + index + 1,
        });
      });
      if (items.length < 10) break;
    }
    queryResults.push(...results);
  });

  const byDomain = new Map();
  queryResults.forEach((item) => {
    const key = item.domain;
    const existing = byDomain.get(key);
    if (!existing) {
      byDomain.set(key, {
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
    if (!existing.matched_keywords.includes(item.query_keyword)) existing.matched_keywords.push(item.query_keyword);
    if (item.rank < existing.rank) {
      existing.url = item.url;
      existing.title = item.title;
      existing.snippet = item.snippet;
      existing.rank = item.rank;
    }
  });

  const allPeers = Array.from(byDomain.values())
    .map((record) => {
      const classification = detectPeerSiteSignals(record, sourceDomain);
      return {
        domain: record.domain,
        url: record.url,
        title: record.title,
        snippet: record.snippet,
        rank: record.rank,
        hits: record.hits,
        matched_keywords: record.matched_keywords.sort((a, b) => a.localeCompare(b)),
        model: classification.primary || 'Direct Competitors',
        other_models: classification.other || [],
      };
    })
    .sort((a, b) => b.hits - a.hits || a.rank - b.rank || a.domain.localeCompare(b.domain));
  const peers = allPeers.slice(0, peerSitesLimit);

  return {
    enabled: true,
    configured: true,
    provider: config.provider || 'web_search',
    searched_keywords: queries,
    raw_results_count: queryResults.length,
    unique_domains_count: allPeers.length,
    peers,
    suggested_models: summarizeOtherPeerModels(peers),
    primary_models: PEER_SITE_PRIMARY_MODELS,
    errors: errors.slice(0, 10),
  };
}

async function crawlProjectPagesForKeywords(input) {
  const sourceUrl = normalizeUrl(input.source_url);
  const maxPages = Math.max(1, Math.min(Number(input.max_pages) || 10, 100));
  const snippetChars = Math.max(100, Math.min(Number(input.body_snippet_chars) || 500, 5000));
  const captureContactData = input.capture_contact_data === true || String(input.capture_contact_data || '').trim().toLowerCase() === 'true';
  const keywordExclusions = splitKeywordExclusions(input.keyword_exclusions);
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
      const imageItems = extractPageImages(current, html);
      const imageUrls = imageItems.map((item) => item.url);
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
        image_items: imageItems,
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

  return {
    source_url: sourceUrl,
    max_pages: maxPages,
    body_snippet_chars: snippetChars,
    keyword_exclusions: keywordExclusions,
    pages,
    errors,
    pages_succeeded: pages.length,
    pages_failed: errors.length,
    contact_summary: contactSummary,
  };
}

async function runDirectAcquire(input, scope = null) {
  const peerSitesLimit = Math.max(5, Math.min(Number(input.peer_sites_limit) || 20, 100));
  const imagesLimit = Math.max(5, Math.min(Number(input.images_limit) || 50, 500));
  const acquirePeerSites = input.acquire_peer_sites === true || String(input.acquire_peer_sites || '').trim().toLowerCase() === 'true';
  const runId = makeId('dhrun');
  const startedAt = new Date().toISOString();

  const crawl = await crawlProjectPagesForKeywords(input);
  const {
    source_url: sourceUrl,
    max_pages: maxPages,
    body_snippet_chars: snippetChars,
    keyword_exclusions: keywordExclusions,
    pages,
    errors,
    contact_summary: contactSummary,
  } = crawl;
  const captureContactData = !!contactSummary;

  const finishedAt = new Date().toISOString();
  const keywordSummary = await buildKeywordSummary({
    sourceUrl,
    pages,
    exclusions: keywordExclusions,
  });
  const peerSummary = await buildPeerSitesSummary(keywordSummary, sourceUrl, { enabled: acquirePeerSites, peerSitesLimit });
  const hashtagSummary = await buildHashtagSummary(keywordSummary);
  const imageSummary = buildImageSummary(pages).slice(0, imagesLimit);
  pages.forEach((page) => {
    delete page.body_text;
    delete page.image_items;
  });
  const run = {
    run_id: runId,
    source_url: sourceUrl,
    max_pages: maxPages,
    peer_sites_limit: peerSitesLimit,
    images_limit: imagesLimit,
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
    peer_summary: {
      peers: Array.isArray(peerSummary.peers) ? peerSummary.peers : [],
      enabled: peerSummary.enabled !== false,
      configured: !!peerSummary.configured,
      provider: String(peerSummary.provider || '').trim(),
      searched_keywords: Array.isArray(peerSummary.searched_keywords) ? peerSummary.searched_keywords : [],
      raw_results_count: Number(peerSummary.raw_results_count || 0) || 0,
      unique_domains_count: Number(peerSummary.unique_domains_count || 0) || 0,
      suggested_models: Array.isArray(peerSummary.suggested_models) ? peerSummary.suggested_models : [],
      errors: Array.isArray(peerSummary.errors) ? peerSummary.errors : [],
      error: String(peerSummary.error || '').trim(),
    },
    keyword_labels: buildKeywordLabels(keywordSummary),
    pages,
    errors
  };

  const persistRun = !(input && (input.persist_run === false || String(input.persist_run || '').trim().toLowerCase() === 'false'));
  if (persistRun) {
    await saveDirectAcquireRun(run, scope);
  }

  return run;
}

async function listDirectAcquireRuns(limit = 20, scope = null) {
  return listRunsFromStore(limit, scope);
}

async function getDirectAcquireRun(runId, scope = null) {
  return getRunFromStore(runId, scope);
}

async function getLatestDirectAcquireRun(scope = null) {
  return getLatestRunFromStore(scope);
}

module.exports = {
  runDirectAcquire,
  listDirectAcquireRuns,
  getDirectAcquireRun,
  getLatestDirectAcquireRun,
  crawlProjectPagesForKeywords,
  buildKeywordSummary,
  getGoogleSearchConfig,
  fetchGoogleSearchBatch,
  registrableDomainOf,
  detectPeerSiteSignals,
  fetchPage,
  stripHtml,
  extractFirst,
  splitKeywordExclusions,
  mapWithConcurrency,
  PEER_SITE_PRIMARY_MODELS,
  extractPageImages,
  buildImageSummary,
};
