'use strict';

const { getProviderValues } = require('./apiSettings');
const { listWebPagesAsMessagingSources } = require('./webPageContentRollup');
const { listMessagingTags, createMessagingTag } = require('./messagingTagsStore');
const {
  normalizeMessagingTag,
  normalizeMessagingTagKey,
  parseMessagingTagLines,
} = require('./messagingTagNormalize');
const {
  getFormatSpec,
  getSourceText,
  contentMatchesIncludes,
} = require('./messagingFormatRegistry');

function clean(value) {
  return String(value || '').trim();
}

function apiKey() {
  const cfg = getProviderValues('anthropic');
  return clean(cfg?.api_key || process.env.ANTHROPIC_API_KEY);
}

function anthropicModel() {
  return clean(process.env.ANTHROPIC_MODEL) || 'claude-sonnet-4-20250514';
}

function buildTagDistillPrompt(pageTitle, pageText) {
  return `Extract content tags from the following web page. Return 5 to 10 short tags, one per line.

Rules:
- Tags are plain labels, NOT hashtags — never use # symbols.
- Prefer single words; use at most 3 words per tag with spaces between words.
- Use Title Case (example: "Climate", "Social Media", "Product Launch").
- No numbering, bullets, or explanations — tags only.

Page title: ${pageTitle}

Page content:
${pageText}`;
}

async function distillTagsFromWebPage(page) {
  const key = apiKey();
  if (!key) return { ok: false, error: 'Anthropic API key not configured.' };

  const webPageSpec = getFormatSpec('web-page');
  const sourceText = getSourceText(webPageSpec, page);
  if (!sourceText) return { ok: false, error: 'Page has no extractable text.' };

  const title = clean(page.title || page.pageName || 'Untitled');
  const model = anthropicModel();
  const prompt = buildTagDistillPrompt(title, sourceText);

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
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
        system: 'You extract plain content tags from web pages. Output tags only, one per line, no # symbols.',
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
  const tags = parseMessagingTagLines(text);
  if (!tags.length) return { ok: false, error: 'Anthropic returned no valid tags.' };
  return { ok: true, tags };
}

async function runWebPageToTagImport(options = {}) {
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

  const existingRes = await listMessagingTags(5000, scope);
  if (!existingRes.ok) {
    return {
      ok: false,
      status: existingRes.status || 500,
      error: existingRes.error || 'Could not load existing tags',
    };
  }

  const existingByContent = new Set();
  for (const row of existingRes.data || []) {
    const key = normalizeMessagingTagKey(row.tag);
    if (key) existingByContent.add(key);
  }

  const preview = candidates.slice(0, 3).map((row) => ({
    sourceId: Number(row.id || 0),
    sourcePreview: String(row.title || row.pageName || '').slice(0, 120),
  }));

  const resultData = {
    fromType: 'web-page',
    toType: 'tag',
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
    const distilled = await distillTagsFromWebPage(page);
    if (!distilled.ok) {
      transformErrors += 1;
      errors.push({ sourceId, error: distilled.error || 'Tag distillation failed' });
      continue;
    }

    for (const tag of distilled.tags) {
      const normalized = normalizeMessagingTag(tag);
      const key = normalizeMessagingTagKey(normalized);
      if (!key) continue;
      if (!force && existingByContent.has(key)) continue;
      const topic = clean(page.topic || page.category || '');
      const result = await createMessagingTag({ tag: normalized, topic }, scope);
      if (result.ok) {
        created += 1;
        existingByContent.add(key);
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
  distillTagsFromWebPage,
  runWebPageToTagImport,
};
