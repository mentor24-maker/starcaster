'use strict';

const { getProviderValues } = require('./apiSettings');
const { discoverBlueskyThreads } = require('./blueskyThreadDiscovery');
const { getTrainingPromptConfig, getTrainingSettings } = require('./trainingStore');

function clean(text) {
  return String(text || '').trim();
}

function truncate(text, maxLen) {
  const value = clean(text);
  if (!value) return '';
  return value.length > maxLen ? value.slice(0, maxLen) : value;
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
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Anthropic models request failed: ${err.message}` };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = clean(body?.error?.message || body?.error || 'Anthropic models lookup failed');
    const type = clean(body?.error?.type);
    return { ok: false, status: res.status || 500, error: type ? `${type}: ${message}` : message };
  }
  const ids = (Array.isArray(body?.data) ? body.data : []).map((item) => clean(item?.id)).filter(Boolean);
  return { ok: true, status: 200, data: ids };
}

async function resolveAnthropicModel(apiKey) {
  const preferred = anthropicModel();
  const listed = await listAnthropicModels(apiKey);
  if (listed.ok) {
    const available = Array.isArray(listed.data) ? listed.data : [];
    if (available.includes(preferred)) return { ok: true, model: preferred, available };
    const fallback = ANTHROPIC_MODEL_CANDIDATES.find((candidate) => available.includes(candidate));
    if (fallback) return { ok: true, model: fallback, available };
    if (available.length) return { ok: true, model: available[0], available };
    return { ok: false, status: 404, error: 'Anthropic returned no available models.' };
  }
  return { ok: true, model: preferred, available: [], lookupError: listed.error || '' };
}

function looksLikeRealReply(text) {
  const value = clean(text).replace(/\s+/g, ' ');
  if (!value) return false;
  if (/^```/i.test(value)) return false;
  if (/^[\[{]/.test(value)) return false;
  if (value.length < 12 || value.length > 800) return false;
  if (!/[a-z]/i.test(value)) return false;
  return true;
}

function normalizeCandidates(items) {
  const out = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const text = clean(item?.text).replace(/\s+/g, ' ');
    const why = clean(item?.why).replace(/\s+/g, ' ');
    const tone = clean(item?.tone).replace(/\s+/g, ' ');
    if (!looksLikeRealReply(text)) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      text: text.slice(0, 800),
      tone: tone.slice(0, 80),
      why: why.slice(0, 240),
    });
  });
  return out.slice(0, 5);
}

function parseCandidatePayload(raw) {
  const text = clean(raw)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return normalizeCandidates(parsed);
    if (Array.isArray(parsed?.replies)) return normalizeCandidates(parsed.replies);
    return [];
  } catch {
    return [];
  }
}

function buildPrompt(input) {
  const post = input?.post || {};
  const replies = Array.isArray(input?.replies) ? input.replies : [];
  const trainingContext = clean(input?.training_context || input?.response_context);
  const trainingGuidelines = clean(input?.training_guidelines || input?.response_guidelines);
  const mixSettings = input?.training_settings || {};
  const explicitPercent = Math.max(0, Math.min(Number(mixSettings?.explicit_isitas_percent) || 0, 100));
  const subtlePercent = Math.max(0, Math.min(Number(mixSettings?.subtle_shared_framing_percent) || 0, 100));
  const genericPercent = Math.max(0, Math.min(Number(mixSettings?.generic_context_percent) || 0, 100));
  const replyBlock = replies.length
    ? replies.map((item, idx) => `${idx + 1}. ${truncate(item.text, 400)}`).join('\n')
    : '-';
  return [
    'Generate exactly 5 distinct BlueSky reply candidates for the post below.',
    'Candidate mix requirements:',
    `- Target about ${explicitPercent}% of candidates to include a light explicit reference to ISITAS, the ISIT Construct, or the ISIT Game when the post meaningfully overlaps those ideas.`,
    `- Target about ${subtlePercent}% of candidates to subtly reflect the shared project framing without naming the project directly.`,
    `- Target about ${genericPercent}% of candidates to stay generic/context-first with no project reference.`,
    '- For 5 total candidates, treat these as directional targets rather than rigid math, but stay close to them.',
    'Constraints:',
    '- Plain text only.',
    '- Natural, human, non-spammy tone.',
    '- 1-3 sentences each.',
    '- No emojis.',
    '- No hashtags unless clearly native to the post context.',
    '- No markdown bullets or numbering in the reply text.',
    '- No links unless already clearly invited by context.',
    '- Avoid sounding promotional or generic.',
    '- If the shared project context naturally fits, do not ignore it; reflect it through framing, vocabulary, or a light reference.',
    '- References to ISITAS or related ideas must be understated, context-relevant, and never feel like a pitch.',
    '- Do not force a brand reference if the post context does not support it, but do not default to generic replies when the overlap is obvious.',
    '- Prefer shared-abstraction, coordination, sensemaking, values, IS/IT, or human-AI alignment framing when the post is about alignment, consciousness, coordination, social systems, or foundational questions.',
    '- At least 3 of the 5 replies should be recognizably different in angle, not just rephrasings.',
    '- Return strict JSON only: {"replies":[{"text":"...","tone":"...","why":"..."}, ...]}',
    '',
    'How to use the shared project context:',
    '- Treat it as strategic framing, not a script to quote.',
    '- When relevant, connect the post to ideas like shared abstraction, coordination failure, alignment surfaces, IS/IT, or the ISIT Construct.',
    '- If using an explicit project mention, keep it brief and understated, like "This is close to how we frame it in ISITAS" or "This overlaps with the ISIT Construct idea of..."',
    '- The best replies should feel like a thoughtful participant who happens to think in this framework, not a marketer.',
    '',
    'Shared project context:',
    trainingContext || '-',
    '',
    'Shared reply guidelines:',
    trainingGuidelines || '-',
    '',
    `Author handle: ${clean(post.author_handle) || '-'}`,
    `Author display name: ${clean(post.author_display_name) || '-'}`,
    `Post text: ${truncate(post.text, 2500) || '-'}`,
    '',
    'Thread reply context:',
    replyBlock,
  ].join('\n');
}

async function generateReplyCandidates(input) {
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
        max_tokens: 900,
        system: 'You write concise, context-aware BlueSky replies. Output strict JSON only.',
        messages: [{ role: 'user', content: buildPrompt(input) }],
      }),
      signal: AbortSignal.timeout(25000),
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
      provider: 'anthropic',
    };
  }

  const rawText = clean((body?.content || []).map((c) => c?.text || '').join('\n'));
  const replies = parseCandidatePayload(rawText);
  if (!replies.length) {
    return { ok: false, status: 502, error: 'Anthropic returned no usable BlueSky reply candidates.', provider: 'anthropic' };
  }

  return {
    ok: true,
    status: 200,
    data: replies,
    provider: 'anthropic',
    model: modelRes.model,
    available_models: modelRes.available,
    model_lookup_error: modelRes.lookupError || '',
    raw_text: rawText,
  };
}

async function buildBlueskyReplyCandidateInput(options = {}) {
  const target = clean(options.target);
  if (!target) return { ok: false, status: 400, error: 'target is required' };
  const contextLimit = Math.max(3, Math.min(Number(options.context_limit || options.contextLimit || 8) || 8, 20));
  const promptConfig = await getTrainingPromptConfig(options.user_id || options.userId || options.userEmail || '');
  const settingsRes = await getTrainingSettings(options.user_id || options.userId || options.userEmail || '');
  const trainingSettings = settingsRes && settingsRes.ok ? settingsRes.data : null;
  const discovery = await discoverBlueskyThreads({
    target,
    source_mode: options.source_mode || options.sourceMode || 'auto',
    sort: 'new',
    max_posts: 1,
  });
  if (!discovery.ok) return discovery;
  const post = Array.isArray(discovery.data?.candidates) ? discovery.data.candidates[0] : null;
  if (!post) return { ok: false, status: 404, error: 'BlueSky post not found.' };
  const replies = Array.isArray(discovery.data?.thread_replies) ? discovery.data.thread_replies.slice(0, contextLimit) : [];
  return {
    ok: true,
    status: 200,
    data: {
      post,
      replies,
      source_mode: discovery.data?.source_mode || clean(options.source_mode || options.sourceMode || 'auto'),
      training_context: clean(options.training_context || options.response_context || promptConfig?.context),
      training_guidelines: clean(options.training_guidelines || options.response_guidelines || promptConfig?.guidelines),
      training_settings: trainingSettings || {
        explicit_isitas_percent: 50,
        subtle_shared_framing_percent: 40,
        generic_context_percent: 10,
      },
    },
  };
}

async function generateBlueskyReplyCandidates(options = {}) {
  const inputRes = await buildBlueskyReplyCandidateInput(options);
  if (!inputRes.ok) return inputRes;
  const generation = await generateReplyCandidates(inputRes.data);
  if (!generation.ok) return generation;
  return {
    ok: true,
    status: 200,
    data: {
      target: clean(options.target),
      source_mode: inputRes.data?.source_mode || clean(options.source_mode || options.sourceMode || 'auto'),
      post: inputRes.data.post,
      replies_context: inputRes.data.replies,
      training_context: inputRes.data.training_context || '',
      training_guidelines: inputRes.data.training_guidelines || '',
      training_settings: inputRes.data.training_settings || null,
      replies: generation.data,
      provider: generation.provider || '',
      model: generation.model || '',
      raw_text: generation.raw_text || '',
    },
  };
}

module.exports = {
  buildBlueskyReplyCandidateInput,
  generateBlueskyReplyCandidates,
};
