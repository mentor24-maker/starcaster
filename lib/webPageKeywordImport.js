'use strict';

const { getProviderValues } = require('./apiSettings');
const { listWebPagesAsMessagingSources } = require('./webPageContentRollup');
const { listMessagingKeywords, createMessagingKeyword } = require('./messagingKeywordsStore');
const {
  getFormatSpec,
  getSourceText,
  contentMatchesIncludes,
} = require('./messagingFormatRegistry');

function clean(value) {
  return String(value || '').trim();
}

function normalizeKeyword(value) {
  return clean(value).replace(/\s+/g, ' ').toLowerCase();
}

function apiKey() {
  const cfg = getProviderValues('anthropic');
  return clean(cfg?.api_key || process.env.ANTHROPIC_API_KEY);
}

function anthropicModel() {
  return clean(process.env.ANTHROPIC_MODEL) || 'claude-sonnet-4-20250514';
}

function buildKeywordDistillPrompt(pageTitle, pageText) {
  return `Extract SEO and content-discovery keywords from the following web page. Return 8 to 15 distinct keyword phrases, one per line. Each phrase should be 1 to 4 words, lowercase, no numbering, no bullets, no hashtags, no explanations — keywords only.

Page title: ${pageTitle}

Page content:
${pageText}`;
}

function parseKeywordLines(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^[\d.)*-]+\s*/, '').trim())
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter((line) => line && !/^keywords?:/i.test(line))
    .map((line) => line.slice(0, 240));
}

async function distillKeywordsFromWebPage(page) {
  const key = apiKey();
  if (!key) return { ok: false, error: 'Anthropic API key not configured.' };

  const webPageSpec = getFormatSpec('web-page');
  const sourceText = getSourceText(webPageSpec, page);
  if (!sourceText) return { ok: false, error: 'Page has no extractable text.' };

  const title = clean(page.title || page.pageName || 'Untitled');
  const model = anthropicModel();
  const prompt = buildKeywordDistillPrompt(title, sourceText);

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
        system: 'You extract search keywords from web page content. Output only keyword phrases, one per line, nothing else.',
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    return { ok: false, error: `Anthropic request failed: ${err.message}` };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = clean(body?.error?.message || body?.error || 'Anthropic error');
    return { ok: false, error: message };
  }

  const text = clean((body?.content || []).map((part) => part?.text || '').join('\n'));
  const keywords = parseKeywordLines(text);
  if (!keywords.length) return { ok: false, error: 'Anthropic returned no valid keywords.' };
  return { ok: true, keywords };
}

async function runWebPageToKeywordImport(options = {}) {
  const scope = options.scope || null;
  const includes = String(options.includes || '').trim();
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);

  const webPageSpec = getFormatSpec('web-page');
  const pagesRes = await listWebPagesAsMessagingSources(5000, scope);
  if (!pagesRes.ok) {
    return {
      ok: false,
      status: pagesRes.status || 500,
      error: pagesRes.error || 'Could not load Builder pages',
    };
  }

  const candidates = (Array.isArray(pagesRes.data) ? pagesRes.data : []).filter((row) => {
    const text = getSourceText(webPageSpec, row);
    return text && contentMatchesIncludes(text, includes);
  });

  const existingRes = await listMessagingKeywords(5000, scope);
  if (!existingRes.ok) {
    return {
      ok: false,
      status: existingRes.status || 500,
      error: existingRes.error || 'Could not load existing keywords',
    };
  }

  const existingByContent = new Set();
  for (const row of existingRes.data || []) {
    const norm = normalizeKeyword(row.keyword);
    if (norm) existingByContent.add(norm);
  }

  const preview = candidates.slice(0, 3).map((row) => ({
    sourceId: Number(row.id || 0),
    sourcePreview: String(row.title || row.pageName || '').slice(0, 120),
  }));

  const resultData = {
    fromType: 'web-page',
    toType: 'keyword',
    includes: includes || null,
    matched: candidates.length,
    skipped: 0,
    planned: candidates.length,
    transformErrors: 0,
    preview,
  };

  if (dryRun) {
    return { ok: true, status: 200, data: { ...resultData, created: 0, errors: [] } };
  }

  let created = 0;
  let transformErrors = 0;
  const errors = [];

  for (const page of candidates) {
    const sourceId = Number(page.id || 0);
    const topic = clean(page.topic || page.category || '');

    const distilled = await distillKeywordsFromWebPage(page);
    if (!distilled.ok) {
      transformErrors += 1;
      errors.push({ sourceId, error: distilled.error || 'Keyword distillation failed' });
      continue;
    }

    for (const keyword of distilled.keywords) {
      const norm = normalizeKeyword(keyword);
      if (!norm) continue;
      if (!force && existingByContent.has(norm)) continue;
      const result = await createMessagingKeyword({ keyword: norm, topic }, scope);
      if (result.ok) {
        created += 1;
        existingByContent.add(norm);
      } else {
        errors.push({ sourceId, error: result.error || 'Create failed' });
      }
    }
  }

  return {
    ok: created > 0 || (errors.length === 0 && transformErrors === 0),
    status: created > 0 ? 200 : (errors.length ? 500 : 200),
    data: { ...resultData, transformErrors, created, errors },
    error: errors.length && !created ? errors[0].error : '',
  };
}

module.exports = {
  distillKeywordsFromWebPage,
  runWebPageToKeywordImport,
};
