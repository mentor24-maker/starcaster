'use strict';

const aiClient = require('../aiClient');
const { doorFailureStatus } = require('../aiDoorStatus');
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

async function generateSuggestions(payload, scope = null) {
  // Through the AI door (lib/aiClient.js generate, SC-846): the first provider
  // in Settings › APIs › AI provider that can pay answers. The Claude model
  // ladder this file kept is gone; the door's order replaces it.
  const reply = await aiClient.generate({
    feature: 'youtube_comment_suggestions',
    scope,
    tier: 'strong',
    system: 'You write concise, authentic YouTube comments for exactly one active project. Output strict JSON only.',
    messages: promptFromInput(payload, scope),
    maxTokens: 300,
    timeoutMs: 25000,
  });
  if (!reply.ok) {
    return { ok: false, status: doorFailureStatus(reply), error: reply.error || 'AI generation failed', provider: reply.provider || '' };
  }

  const text = clean(reply.text);
  const parsed = parseJsonComments(text);
  const comments = parsed.length ? parsed : fallbackLineParse(text);
  if (!comments.length) {
    return { ok: false, status: 502, error: `${reply.providerLabel} returned no usable suggestions.`, provider: reply.provider };
  }
  return {
    ok: true,
    status: 200,
    data: comments,
    project: projectFromScope(scope),
    provider: reply.provider,
    model: reply.model,
  };
}

async function generateYoutubeCommentSuggestions(input, scope = null) {
  const payload = buildYoutubeCommentSuggestionInput(input);
  if (!payload.description && !payload.transcript) {
    return { ok: false, status: 400, error: 'description or transcript is required' };
  }

  return generateSuggestions(payload, scope);
}

module.exports = {
  buildYoutubeCommentSuggestionInput,
  generateYoutubeCommentSuggestions
};
