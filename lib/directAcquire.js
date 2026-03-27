const fs = require('fs');
const os = require('os');
const path = require('path');

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

function extractFirst(html, regex) {
  const m = String(html || '').match(regex);
  return m && m[1] ? stripHtml(m[1]).trim() : '';
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
      const text = stripHtml(html);
      const title = extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      const metaDesc = extractFirst(
        html,
        /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i
      );
      const snippet = text.slice(0, snippetChars);
      const emails = extractEmails(text);
      const phones = extractPhones(text);
      const links = extractLinks(current, html);
      const socialLinks = links
        .map((href) => normalizeSocialUrl(href))
        .filter(Boolean)
        .filter((href) => Boolean(socialPlatformFromUrl(href)));

      const pageRecord = {
        url: current,
        title,
        meta_desc: metaDesc,
        body_snippet: snippet,
        emails,
        phones,
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
    contact_summary: contactSummary,
    contact_labels: buildContactLabels(contactSummary),
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
