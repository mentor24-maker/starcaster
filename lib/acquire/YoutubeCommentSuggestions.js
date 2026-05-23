'use strict';

const { getProviderValues } = require('../apiSettings');
const { projectBoundaryText, projectFromScope } = require('../projectLlmContext');

function clean(text) {
  return String(text || '').trim();
}

function truncate(text, maxLen) {
  const s = clean(text);
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function inputPayload(input) {
  return {
    video_url: clean(input?.video_url),
    title: clean(input?.title),
    channel_name: clean(input?.channel_name),
    description: truncate(input?.description, 3000),
    transcript: truncate(input?.transcript, 9000),
  };
}

function buildYoutubeCommentSuggestionInput(input) {
  return inputPayload(input);
}

function anthropicModel() {
  return clean(process.env.ANTHROPIC_MODEL) || 'claude-3-7-sonnet-20250219';
}

const ANTHROPIC_MODEL_CANDIDATES = [
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
];

async function listAnthropicModels(apiKey) {
  const key = clean(apiKey);
  if (!key) return { ok: false, status: 400, error: 'Anthropic API key not configured.' };

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Anthropic models request failed: ${err.message}` };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = clean(body?.error?.message || body?.error || 'Anthropic models lookup failed');
    const type = clean(body?.error?.type);
    return {
      ok: false,
      status: res.status || 500,
      error: type ? `${type}: ${message}` : message,
    };
  }

  const ids = (Array.isArray(body?.data) ? body.data : [])
    .map((item) => clean(item?.id))
    .filter(Boolean);
  return { ok: true, status: 200, data: ids };
}

async function resolveAnthropicModel(apiKey) {
  const preferred = anthropicModel();
  const listed = await listAnthropicModels(apiKey);
  if (listed.ok) {
    const available = Array.isArray(listed.data) ? listed.data : [];
    if (available.includes(preferred)) {
      return { ok: true, model: preferred, available };
    }
    const fallback = ANTHROPIC_MODEL_CANDIDATES.find((candidate) => available.includes(candidate));
    if (fallback) return { ok: true, model: fallback, available };
    if (available.length) return { ok: true, model: available[0], available };
    return { ok: false, status: 404, error: 'Anthropic returned no available models.' };
  }
  return { ok: true, model: preferred, available: [], lookupError: listed.error || '' };
}

function promptFromInput(payload, scope = null) {
  return [
    projectBoundaryText(scope),
    '',
    'Generate exactly 3 distinct YouTube comment ideas.',
    'Constraints:',
    '- Positive, natural, human tone.',
    '- 1-2 sentences each.',
    '- No emojis.',
    '- No hashtags.',
    '- No numbered prefixes.',
    '- Must be suitable to post publicly.',
    '- Return strict JSON only: {"comments":["...","...","..."]}',
    '',
    `Video URL: ${payload.video_url || '-'}`,
    `Video title: ${payload.title || '-'}`,
    `Channel name: ${payload.channel_name || '-'}`,
    '',
    'Description:',
    payload.description || '-',
    '',
    'Transcript:',
    payload.transcript || '-',
  ].join('\n');
}

function stripCodeFences(text) {
  const raw = clean(text);
  if (!raw) return '';
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function looksLikeRealComment(text) {
  const value = clean(text).replace(/\s+/g, ' ');
  if (!value) return false;
  if (/^```/i.test(value)) return false;
  if (/^json$/i.test(value)) return false;
  if (/^[\[{]/.test(value)) return false;
  if (/^[\]}"'`]+$/.test(value)) return false;
  if (/^"comments"?\s*:/i.test(value)) return false;
  if (value.length < 12) return false;
  return /[a-z]/i.test(value);
}

function normalizeComments(items) {
  const out = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((raw) => {
    const value = clean(raw).replace(/\s+/g, ' ');
    if (!looksLikeRealComment(value)) return;
    const trimmed = value.slice(0, 280);
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  });
  return out.slice(0, 3);
}

function parseJsonComments(text) {
  const raw = stripCodeFences(text);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeComments(parsed);
    if (Array.isArray(parsed?.comments)) return normalizeComments(parsed.comments);
    return [];
  } catch {
    return [];
  }
}

function fallbackLineParse(text) {
  const lines = stripCodeFences(text)
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean);
  return normalizeComments(lines);
}

async function generateWithAnthropic(payload, scope = null) {
  const cfg = getProviderValues('anthropic');
  const apiKey = clean(cfg.api_key || process.env.ANTHROPIC_API_KEY);
  if (!apiKey) return { ok: false, status: 400, error: 'Anthropic API key not configured.' };
  const modelRes = await resolveAnthropicModel(apiKey);
  if (!modelRes.ok) {
    return { ok: false, status: modelRes.status || 500, error: modelRes.error || 'Could not resolve an Anthropic model.' };
  }

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
        model: modelRes.model,
        max_tokens: 300,
        messages: [{ role: 'user', content: promptFromInput(payload, scope) }],
        system: 'You write concise, authentic YouTube comments for exactly one active project. Output strict JSON only.',
      }),
      signal: AbortSignal.timeout(25000)
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Anthropic request failed: ${err.message}` };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = clean(body?.error?.message || body?.error || 'Anthropic error');
    const type = clean(body?.error?.type);
    return {
      ok: false,
      status: res.status || 500,
      error: type ? `${type}: ${message}` : message,
      provider: 'anthropic'
    };
  }
  const text = clean((body?.content || []).map((c) => c?.text || '').join('\n'));
  const parsed = parseJsonComments(text);
  const comments = parsed.length ? parsed : fallbackLineParse(text);
  if (!comments.length) {
    return { ok: false, status: 502, error: 'Anthropic returned no usable suggestions.', provider: 'anthropic' };
  }
  return {
    ok: true,
    status: 200,
    data: comments,
    project: projectFromScope(scope),
    provider: 'anthropic',
    model: modelRes.model,
    available_models: modelRes.available,
    model_lookup_error: modelRes.lookupError || ''
  };
}

async function generateYoutubeCommentSuggestions(input, scope = null) {
  const payload = buildYoutubeCommentSuggestionInput(input);
  if (!payload.description && !payload.transcript) {
    return { ok: false, status: 400, error: 'description or transcript is required' };
  }

  const anthropicRes = await generateWithAnthropic(payload, scope);
  if (anthropicRes.ok) return anthropicRes;

  return {
    ok: false,
    status: anthropicRes.status || 500,
    error: anthropicRes.error || 'Anthropic generation failed'
  };
}

module.exports = {
  buildYoutubeCommentSuggestionInput,
  generateYoutubeCommentSuggestions
};
