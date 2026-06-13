'use strict';

const { getProviderValues } = require('./apiSettings');
const { FAMILY } = require('./messagingFormatRegistry');

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

function maxTokensForTarget(toSpec) {
  if (!toSpec) return 600;
  switch (toSpec.family) {
    case FAMILY.SUPPORT_TAGS: return 200;
    case FAMILY.SHORT_FORM:
    case FAMILY.SOCIAL_SHORT:
    case FAMILY.SUPPORT_CTA: return 400;
    case FAMILY.SOCIAL_MEDIUM:
    case FAMILY.SUPPORT: return 800;
    case FAMILY.EMAIL: return 1200;
    case FAMILY.LONG_FORM: return 4000;
    default: return 600;
  }
}

function buildPrompt(sourceText, fromSpec, toSpec) {
  const fromLabel = fromSpec ? fromSpec.label : 'content';
  const toDesc = toSpec ? toSpec.aiDescriptor : 'another format';
  const toLong = toSpec && toSpec.isLongform;
  const fromLong = fromSpec && fromSpec.isLongform;
  const toHashtags = toSpec && toSpec.family === FAMILY.SUPPORT_TAGS;

  let instruction;
  if (toHashtags) {
    instruction = `Generate hashtags from the following ${fromLabel}. Return exactly 5 to 10 relevant hashtags, one per line, each starting with #. Return nothing else — no labels, no explanations.`;
  } else if (toLong && !fromLong) {
    instruction = `Use the following ${fromLabel} as the seed idea and expand it into ${toDesc}. Preserve the core topic and intent. Return a JSON object with exactly two string keys: "title" and "content". No markdown fences, no other text.`;
  } else if (toLong && fromLong) {
    instruction = `Repurpose the following ${fromLabel} into ${toDesc}. Preserve the key insights and depth. Return a JSON object with exactly two string keys: "title" and "content". No markdown fences, no other text.`;
  } else if (!toLong && fromLong) {
    instruction = `Distill the key insight from the following ${fromLabel} into ${toDesc}. Be concise and preserve the core message. Return only the transformed text, nothing else.`;
  } else {
    instruction = `Repurpose the following ${fromLabel} into ${toDesc}. Preserve the topic, tone, and intent. Return only the transformed text — no labels, no explanations.`;
  }

  return `${instruction}\n\n${fromLabel}:\n${sourceText}`;
}

function parseHashtagLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('#'));
}

function parseLongformJson(text) {
  const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    const title = clean(obj.title);
    const content = clean(obj.content);
    if (title && content) return { title, content };
    return null;
  } catch {
    return null;
  }
}

// Transform sourceText from fromSpec's format into toSpec's format using the Anthropic API.
// Returns { ok, content, title? } on success, or { ok: false, error } on failure.
// For hashtag targets, content is a newline-separated list of hashtag strings.
// For longform targets, title is also populated.
async function transformContent(sourceText, fromSpec, toSpec) {
  const key = apiKey();
  if (!key) return { ok: false, error: 'Anthropic API key not configured.' };

  const model = anthropicModel();
  const prompt = buildPrompt(sourceText, fromSpec, toSpec);
  const maxTokens = maxTokensForTarget(toSpec);
  const toHashtags = toSpec && toSpec.family === FAMILY.SUPPORT_TAGS;
  const toLong = toSpec && toSpec.isLongform;

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
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
        system: toLong
          ? 'You are a content repurposing assistant. Output strict JSON only with keys "title" and "content".'
          : toHashtags
            ? 'You are a content repurposing assistant. Output hashtags only, one per line, each starting with #.'
            : 'You are a content repurposing assistant. Output only the transformed content, nothing else.',
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    return { ok: false, error: `Anthropic request failed: ${err.message}` };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = clean(body?.error?.message || body?.error || 'Anthropic error');
    const type = clean(body?.error?.type);
    return { ok: false, error: type ? `${type}: ${message}` : message };
  }

  const text = clean((body?.content || []).map((part) => part?.text || '').join('\n'));
  if (!text) return { ok: false, error: 'Anthropic returned an empty response.' };

  if (toHashtags) {
    const tags = parseHashtagLines(text);
    if (!tags.length) return { ok: false, error: 'Anthropic returned no valid hashtags.' };
    return { ok: true, content: tags.join('\n') };
  }

  if (toLong) {
    const parsed = parseLongformJson(text);
    if (!parsed) return { ok: false, error: 'Anthropic returned invalid long-form JSON.' };
    return { ok: true, content: parsed.content, title: parsed.title };
  }

  return { ok: true, content: text };
}

module.exports = { transformContent };
