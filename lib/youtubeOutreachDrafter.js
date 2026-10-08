'use strict';

/**
 * YouTube outreach 4/7 (task 86bcda661) — writes ONE draft comment for one
 * target video, following that video's settings and the account's voice, and
 * checks it against the rules before anyone sees it.
 *
 * Nothing here saves or posts. lib/youtubeOutreachCommentsStore.js saves what
 * this returns; posting is ticket 5/7. Dane approves every comment (his
 * decision, 2026-10-05).
 *
 * THE RULES ARE CHECKED HERE, NOT TRUSTED TO THE PROMPT. The prompt asks the
 * model to follow the link policy and the avoid list; `checkComment` then
 * reads what it actually wrote. A draft that breaks a rule gets one more try
 * with the broken rule named, and if it breaks one again it is REFUSED with
 * the rule spelled out — it is never saved, so it is never shown as something
 * that can be approved. The same check runs again on Approve, against
 * whatever Dane's edit left, so an edit cannot slip a link past a "never".
 *
 * The AI call is `options.generate` (system, prompt) → { ok, text, error };
 * the default goes through lib/aiClient.js. Tests pass a stand-in.
 */

const { queryAnthropic } = require('./aiClient');
const { resolveYoutubeApiKey } = require('./acquire/youtubeApiKey');
const { ytFetch } = require('./acquire/YoutubeCommentsRun');

/**
 * What each length setting means, in characters. A draft outside these is
 * sent back to the model; on Approve only YouTube's own ceiling applies,
 * because Dane trimming a draft is a choice, not a broken rule.
 */
const LENGTH_BOUNDS = Object.freeze({
  short: Object.freeze({ min: 20, max: 200, words: 'one or two sentences, under 200 characters' }),
  medium: Object.freeze({ min: 60, max: 500, words: 'two to four sentences, under 500 characters' }),
  long: Object.freeze({ min: 150, max: 1000, words: 'a short paragraph or two, under 1,000 characters' }),
});

/** YouTube refuses a comment longer than this. */
const YOUTUBE_MAX_COMMENT_LENGTH = 10000;

/** How many times the model is asked before a rule-breaking draft is refused. */
const DRAFT_ATTEMPTS = 2;

const OBJECTIVE_WORDS = {
  join_conversation: 'join the conversation under this video as a genuine viewer',
  awareness: 'quietly make people aware of who is commenting, without selling',
  drive_link: 'give viewers a reason to visit the link, without sounding like an ad',
  appreciation: 'thank the creator for something specific in this video',
  answer_question: 'answer a question the video or its comments raise',
};

const MESSAGE_TYPE_WORDS = {
  insight: 'share an insight',
  question: 'ask a real question',
  story: 'tell a very short personal story',
  appreciation: 'show appreciation for something specific',
  mention_work: 'mention our own work',
};

const PLACEMENT_WORDS = {
  top_level: 'a new top-level comment on the video',
  reply_top_comment: 'a reply to the top comment shown below',
  reply_specific: 'a reply to one particular comment',
};

const MENTION_WORDS = {
  never: 'Do not mention the account, its channel or its work.',
  subtle: 'You may mention the account\'s own work in passing, once, if it fits.',
  open: 'You may mention the account\'s own work openly.',
};

// A link is anything a reader (or YouTube) would take for one: a scheme, a
// "www.", or a bare domain on a common top-level name.
const LINK_RE = /\b(?:https?:\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|tv|pro|app|dev|me|ly|gg|be|us|uk|ca|info|xyz|link|site|online|store|blog)\b(?:\/[^\s<>"')\]]*)?)/gi;

function safeText(value, max = 5000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

/** Every link-looking piece of `text`, trailing punctuation dropped. */
function findLinks(text) {
  const found = String(text || '').match(LINK_RE) || [];
  return found.map((link) => link.replace(/[.,!?;:]+$/, ''));
}

/** A link reduced to what makes it the same address: no scheme, no www., no trailing slash. */
function normalizeLink(link) {
  return String(link || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The avoid-list entries `text` contains, as whole words, ignoring case. */
function findAvoidedWords(text, avoidWords) {
  const body = String(text || '');
  return (Array.isArray(avoidWords) ? avoidWords : [])
    .map((word) => String(word || '').trim())
    .filter(Boolean)
    .filter((word) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'iu').test(body));
}

/**
 * Check a comment against the target's rules. Returns every rule it breaks,
 * each with a sentence that names the rule — never just "invalid".
 *
 * `forApproval` drops the length bounds (Dane may trim a draft) and keeps
 * everything else, including YouTube's own ceiling.
 */
function checkComment(text, { target, settings }, { forApproval = false } = {}) {
  const body = String(text || '').trim();
  const problems = [];
  if (!body) {
    problems.push({ rule: 'empty', message: 'the comment is empty' });
    return { ok: false, problems };
  }

  if (body.length > YOUTUBE_MAX_COMMENT_LENGTH) {
    problems.push({ rule: 'length', message: `it is ${body.length} characters, and YouTube allows at most ${YOUTUBE_MAX_COMMENT_LENGTH}` });
  }
  if (!forApproval) {
    const bounds = LENGTH_BOUNDS[target?.commentLength] || LENGTH_BOUNDS.medium;
    if (body.length > bounds.max) {
      problems.push({ rule: 'length', message: `it is ${body.length} characters, and this video's length setting (${target?.commentLength || 'medium'}) allows at most ${bounds.max}` });
    } else if (body.length < bounds.min) {
      problems.push({ rule: 'length', message: `it is ${body.length} characters, and this video's length setting (${target?.commentLength || 'medium'}) needs at least ${bounds.min}` });
    }
  }

  const links = findLinks(body);
  const policy = target?.linkPolicy || 'never';
  if (links.length && policy === 'never') {
    problems.push({ rule: 'link', message: `it contains a link (${links.join(', ')}), and this video's link setting is Never` });
  } else if (links.length) {
    const allowed = normalizeLink(target?.linkUrl);
    const other = links.filter((link) => normalizeLink(link) !== allowed);
    if (other.length) {
      problems.push({ rule: 'link', message: `it links to ${other.join(', ')}, and the only link allowed for this video is ${target?.linkUrl || '(none set)'}` });
    }
  }

  const avoided = findAvoidedWords(body, settings?.avoidWords);
  if (avoided.length) {
    problems.push({ rule: 'avoid_words', message: `it uses ${avoided.map((w) => `"${w}"`).join(', ')}, which ${avoided.length === 1 ? 'is' : 'are'} on the account's words-to-avoid list` });
  }

  return { ok: problems.length === 0, problems };
}

/** "it contains a link …; it uses …" — the problems as one readable clause. */
function describeProblems(problems) {
  return problems.map((p) => p.message).join('; ');
}

/** Is this target's channel on the account's avoid list? Matched by name or channel id. */
function channelIsAvoided(target, settings) {
  const avoid = (settings?.avoidChannels || []).map((c) => String(c || '').trim().toLowerCase()).filter(Boolean);
  const names = [target?.channelName, target?.channelId].map((c) => String(c || '').trim().toLowerCase()).filter(Boolean);
  return avoid.find((entry) => names.includes(entry)) || '';
}

/**
 * The video's description and some top comments, for the prompt. Never
 * throws: if YouTube cannot be read the draft is written from the title the
 * target already holds, and `note` says what was missing.
 */
async function readVideoContext(videoId, options = {}) {
  const fetcher = typeof options.fetcher === 'function' ? options.fetcher : ytFetch;
  const apiKey = options.apiKey !== undefined ? options.apiKey : resolveYoutubeApiKey();
  const context = { description: '', topComments: [], note: '' };
  if (!apiKey) {
    context.note = 'No YouTube API key is configured, so only the saved title was used.';
    return context;
  }
  const notes = [];
  try {
    const body = await fetcher('videos', { part: 'snippet', id: videoId, key: apiKey });
    context.description = safeText(body?.items?.[0]?.snippet?.description, 3000);
  } catch (err) {
    notes.push(`the description could not be read (${safeText(err?.message, 200) || 'unknown error'})`);
  }
  try {
    const body = await fetcher('commentThreads', {
      part: 'snippet', videoId, order: 'relevance', maxResults: 10, textFormat: 'plainText', key: apiKey,
    });
    context.topComments = (Array.isArray(body?.items) ? body.items : [])
      .map((item) => item?.snippet?.topLevelComment?.snippet)
      .filter(Boolean)
      .map((s) => ({ author: safeText(s.authorDisplayName, 100), text: safeText(s.textDisplay || s.textOriginal, 500) }))
      .filter((c) => c.text);
  } catch (err) {
    notes.push(`the comments could not be read (${safeText(err?.message, 200) || 'unknown error'})`);
  }
  context.note = notes.length ? `YouTube: ${notes.join('; ')}.` : '';
  return context;
}

/** The settings a draft followed, kept on the row so the screen can show them. */
function followedSettings(target, settings) {
  return {
    objective: target.objective,
    commentPlacement: target.commentPlacement,
    messageTypes: [...(target.messageTypes || [])],
    commentLength: target.commentLength,
    linkPolicy: target.linkPolicy,
    linkUrl: target.linkUrl || '',
    mentionPolicy: target.mentionPolicy,
    voiceSet: Boolean(safeText(settings?.voice)),
    avoidWordCount: (settings?.avoidWords || []).length,
  };
}

/** The system message and the prompt for one draft. Pure — tested directly. */
function buildPrompt({ target, settings, video }) {
  const bounds = LENGTH_BOUNDS[target.commentLength] || LENGTH_BOUNDS.medium;
  const types = (target.messageTypes || []).map((t) => MESSAGE_TYPE_WORDS[t] || t);
  const avoid = (settings?.avoidWords || []).filter(Boolean);
  const linkRule = target.linkPolicy === 'never'
    ? 'Do not include any link or web address of any kind.'
    : target.linkPolicy === 'if_natural'
      ? `You may include this link once, only if it fits naturally: ${target.linkUrl}. No other link or web address.`
      : `You may include this link once: ${target.linkUrl}. No other link or web address.`;

  const system = [
    'You write one YouTube comment at a time for a real person, to be read and approved by them before it is posted.',
    'Write like a thoughtful human viewer: specific to this video, no hashtags, no emoji spam, no flattery, no sales language.',
    'Never invent facts about the video beyond what you are given.',
    'Reply with JSON only, exactly {"comment": "<the comment text>"}.',
  ].join(' ');

  const lines = [
    `Video title: ${target.videoTitle || '(unknown)'}`,
    `Channel: ${target.channelName || '(unknown)'}`,
  ];
  if (video?.description) lines.push(`Video description:\n${video.description}`);
  if (video?.topComments?.length) {
    lines.push('Top comments right now:');
    for (const c of video.topComments) lines.push(`- ${c.author ? `${c.author}: ` : ''}${c.text}`);
  }
  lines.push('');
  lines.push(`Goal: ${OBJECTIVE_WORDS[target.objective] || target.objective}.`);
  lines.push(`This is ${PLACEMENT_WORDS[target.commentPlacement] || 'a comment'}.`);
  if (types.length) lines.push(`In it, ${types.join(' or ')}.`);
  lines.push(`Length: ${bounds.words}.`);
  lines.push(linkRule);
  lines.push(MENTION_WORDS[target.mentionPolicy] || MENTION_WORDS.never);
  if (avoid.length) lines.push(`Never use these words: ${avoid.join(', ')}.`);
  if (safeText(settings?.voice)) lines.push(`Voice — how the account sounds: ${safeText(settings.voice, 4000)}`);
  if (safeText(target.notes)) lines.push(`Notes for this video: ${safeText(target.notes, 4000)}`);

  return { system, prompt: lines.join('\n') };
}

/** The comment out of the model's reply: `{"comment": …}`, fenced or bare, or the plain text. */
function parseReply(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return safeText(parsed?.comment, YOUTUBE_MAX_COMMENT_LENGTH + 1);
    } catch {
      return '';
    }
  }
  return safeText(raw.replace(/^"|"$/g, ''), YOUTUBE_MAX_COMMENT_LENGTH + 1);
}

function defaultGenerate(scope) {
  return (system, prompt) => queryAnthropic(system, prompt, { feature: 'youtube-outreach-draft', scope });
}

/**
 * Write one draft for `target`. Returns `{ ok: true, data: { text, followed, note } }`
 * or a refusal naming the rule that stopped it. `video` is readVideoContext's
 * answer; `options.generate` replaces the AI call.
 */
async function writeDraft({ target, settings, video }, options = {}) {
  const avoidedChannel = channelIsAvoided(target, settings);
  if (avoidedChannel) {
    return {
      ok: false,
      status: 422,
      error: `No draft was written: this video's channel (${target.channelName || target.channelId}) is on the account's channels-to-avoid list.`,
      problems: [{ rule: 'avoid_channels', message: `the channel ${avoidedChannel} is on the channels-to-avoid list` }],
    };
  }

  const generate = typeof options.generate === 'function' ? options.generate : defaultGenerate(options.scope);
  const { system, prompt } = buildPrompt({ target, settings, video });
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0 ? options.attempts : DRAFT_ATTEMPTS;

  let problems = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const ask = problems.length
      ? `${prompt}\n\nYour last draft broke these rules: ${describeProblems(problems)}. Write a new one that keeps every rule.`
      : prompt;
    // eslint-disable-next-line no-await-in-loop
    const reply = await generate(system, ask);
    if (!reply?.ok) {
      return { ok: false, status: 502, error: `The AI did not write a draft: ${safeText(reply?.error, 300) || 'no answer'}` };
    }
    const text = parseReply(reply.text);
    const checked = checkComment(text, { target, settings });
    if (checked.ok) {
      return { ok: true, status: 200, data: { text, followed: followedSettings(target, settings), note: video?.note || '' } };
    }
    problems = checked.problems;
  }

  return {
    ok: false,
    status: 422,
    error: `The draft broke a rule, so it was not kept: ${describeProblems(problems)}. Click Write a draft to try again.`,
    problems,
  };
}

module.exports = {
  LENGTH_BOUNDS,
  YOUTUBE_MAX_COMMENT_LENGTH,
  DRAFT_ATTEMPTS,
  findLinks,
  findAvoidedWords,
  checkComment,
  describeProblems,
  channelIsAvoided,
  readVideoContext,
  followedSettings,
  buildPrompt,
  parseReply,
  writeDraft,
};
