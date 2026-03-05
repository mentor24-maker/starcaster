'use strict';

const { getProviderValues } = require('../apiSettings');

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

function promptFromInput(payload) {
  return [
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

function normalizeComments(items) {
  const out = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((raw) => {
    const value = clean(raw).replace(/\s+/g, ' ');
    if (!value) return;
    const trimmed = value.slice(0, 280);
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  });
  return out.slice(0, 3);
}

function parseJsonComments(text) {
  const raw = clean(text);
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
  const lines = clean(text)
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean);
  return normalizeComments(lines);
}

async function generateWithOpenAI(payload) {
  const cfg = getProviderValues('openai');
  const apiKey = clean(cfg.api_key || process.env.OPENAI_API_KEY);
  if (!apiKey) return { ok: false, status: 400, error: 'OpenAI API key not configured.' };

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        messages: [
          {
            role: 'system',
            content: 'You write concise, authentic YouTube comments. Output JSON only.'
          },
          { role: 'user', content: promptFromInput(payload) }
        ]
      }),
      signal: AbortSignal.timeout(25000)
    });
  } catch (err) {
    return { ok: false, status: 502, error: `OpenAI request failed: ${err.message}` };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status || 500, error: body?.error?.message || 'OpenAI error', provider: 'openai' };
  }
  const text = clean(body?.choices?.[0]?.message?.content);
  const parsed = parseJsonComments(text);
  const comments = parsed.length ? parsed : fallbackLineParse(text);
  if (!comments.length) {
    return { ok: false, status: 502, error: 'OpenAI returned no usable suggestions.', provider: 'openai' };
  }
  return { ok: true, status: 200, data: comments, provider: 'openai' };
}

async function generateWithAnthropic(payload) {
  const cfg = getProviderValues('anthropic');
  const apiKey = clean(cfg.api_key || process.env.ANTHROPIC_API_KEY);
  if (!apiKey) return { ok: false, status: 400, error: 'Anthropic API key not configured.' };

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
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 300,
        messages: [{ role: 'user', content: promptFromInput(payload) }],
        system: 'You write concise, authentic YouTube comments. Output strict JSON only.',
      }),
      signal: AbortSignal.timeout(25000)
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Anthropic request failed: ${err.message}` };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status || 500, error: body?.error?.message || 'Anthropic error', provider: 'anthropic' };
  }
  const text = clean((body?.content || []).map((c) => c?.text || '').join('\n'));
  const parsed = parseJsonComments(text);
  const comments = parsed.length ? parsed : fallbackLineParse(text);
  if (!comments.length) {
    return { ok: false, status: 502, error: 'Anthropic returned no usable suggestions.', provider: 'anthropic' };
  }
  return { ok: true, status: 200, data: comments, provider: 'anthropic' };
}

async function generateYoutubeCommentSuggestions(input) {
  const payload = inputPayload(input);
  if (!payload.description && !payload.transcript) {
    return { ok: false, status: 400, error: 'description or transcript is required' };
  }

  const errors = [];

  const openAiRes = await generateWithOpenAI(payload);
  if (openAiRes.ok) return openAiRes;
  errors.push(`OpenAI: ${openAiRes.error || 'failed'}`);

  const anthropicRes = await generateWithAnthropic(payload);
  if (anthropicRes.ok) return anthropicRes;
  errors.push(`Anthropic: ${anthropicRes.error || 'failed'}`);

  return {
    ok: false,
    status: anthropicRes.status || openAiRes.status || 500,
    error: errors.join(' | ') || 'No LLM provider available'
  };
}

module.exports = {
  generateYoutubeCommentSuggestions
};
