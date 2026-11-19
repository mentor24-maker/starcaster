'use strict';

const aiClient = require('./aiClient');
const { doorFailureStatus } = require('./aiDoorStatus');
const redditClient = require('./redditClient');
const { projectBoundaryText, projectFromScope } = require('./projectLlmContext');

function clean(text) {
  return String(text || '').trim();
}

function truncate(text, maxLen) {
  const value = clean(text);
  if (!value) return '';
  return value.length > maxLen ? value.slice(0, maxLen) : value;
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
  const comments = Array.isArray(input?.comments) ? input.comments : [];
  const commentBlock = comments.length
    ? comments.map((item, idx) => `${idx + 1}. ${truncate(item.body, 400)}`).join('\n')
    : '-';
  return [
    projectBoundaryText(input?.scope),
    '',
    'Generate exactly 5 distinct Reddit reply candidates for the post below.',
    'Constraints:',
    '- Plain text only.',
    '- Natural, human, non-spammy tone.',
    '- 1-3 sentences each.',
    '- No emojis.',
    '- No hashtags.',
    '- No markdown bullets or numbering in the reply text.',
    '- No links unless already clearly invited by context.',
    '- Avoid sounding promotional or generic.',
    '- Return strict JSON only: {"replies":[{"text":"...","tone":"...","why":"..."}, ...]}',
    '',
    `Subreddit: ${clean(post.subreddit) || '-'}`,
    `Title: ${clean(post.title) || '-'}`,
    `Author: ${clean(post.author) || '-'}`,
    `Post body: ${truncate(post.selftext, 2500) || '-'}`,
    '',
    'Top comment context:',
    commentBlock,
  ].join('\n');
}

async function generateReplyCandidates(input) {
  // Through the AI door (lib/aiClient.js generate, SC-846): the first provider
  // in Settings › APIs › AI provider that can pay answers. The Claude model
  // ladder this file kept is gone; the door's order replaces it.
  const reply = await aiClient.generate({
    feature: 'reddit_reply_candidates',
    scope: input?.scope,
    tier: 'strong',
    system: 'You write concise, context-aware Reddit replies. Output strict JSON only.',
    messages: buildPrompt(input),
    maxTokens: 900,
    timeoutMs: 25000,
  });
  if (!reply.ok) {
    return { ok: false, status: doorFailureStatus(reply), error: reply.error || 'AI generation failed', provider: reply.provider || '' };
  }

  const rawText = clean(reply.text);
  const replies = parseCandidatePayload(rawText);
  if (!replies.length) {
    return { ok: false, status: 502, error: `${reply.providerLabel} returned no usable Reddit reply candidates.`, provider: reply.provider };
  }

  return {
    ok: true,
    status: 200,
    data: replies,
    project: projectFromScope(input?.scope),
    provider: reply.provider,
    model: reply.model,
    raw_text: rawText,
  };
}

async function buildRedditReplyCandidateInput(options = {}) {
  const target = clean(options.target);
  if (!target) return { ok: false, status: 400, error: 'target is required' };
  const thread = await redditClient.getPostThread({
    target,
    sourceMode: options.source_mode || options.sourceMode || 'auto',
    includeReplies: false,
    limit: Math.max(3, Math.min(Number(options.comment_limit || options.commentLimit || 8) || 8, 20)),
    depth: 3,
  });
  if (!thread.ok) return thread;
  const post = thread.data?.post || null;
  const comments = Array.isArray(thread.data?.comments) ? thread.data.comments.slice(0, Number(options.comment_limit || options.commentLimit || 8) || 8) : [];
  if (!post) return { ok: false, status: 404, error: 'Reddit post not found.' };
  return {
    ok: true,
    status: 200,
    data: {
      post,
      comments,
      scope: options.scope || null,
      auth_mode: thread.data?.auth_mode || 'public',
    },
  };
}

async function generateRedditReplyCandidates(options = {}) {
  const inputRes = await buildRedditReplyCandidateInput(options);
  if (!inputRes.ok) return inputRes;
  const generation = await generateReplyCandidates(inputRes.data);
  if (!generation.ok) return generation;
  return {
    ok: true,
    status: 200,
    data: {
      target: clean(options.target),
      source_mode: inputRes.data?.auth_mode || clean(options.source_mode || options.sourceMode || 'auto'),
      post: inputRes.data.post,
      comments: inputRes.data.comments,
      project: generation.project || projectFromScope(options.scope),
      replies: generation.data,
      provider: generation.provider || '',
      model: generation.model || '',
      raw_text: generation.raw_text || '',
    },
  };
}

module.exports = {
  generateReplyCandidates,
  buildRedditReplyCandidateInput,
  generateRedditReplyCandidates,
};
