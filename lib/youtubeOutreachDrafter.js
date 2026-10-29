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
 * Since Outreach wizard 10/19 (86bcrmbm0) the screen and the scheduled pass
 * ask for THREE comments to choose from (`writeDraftOptions`, through the
 * shared lib/draftOptions.js Reddit uses); each is held to exactly the rules
 * below. `writeDraft` still writes one.
 *
 * The AI call is `options.generate` (system, prompt) → { ok, text, error };
 * the default goes through lib/aiClient.js. Tests pass a stand-in.
 */

const { queryAnthropic } = require('./aiClient');
const draftOptions = require('./draftOptions');
const { resolveYoutubeApiKey } = require('./acquire/youtubeApiKey');
const { ytFetch } = require('./acquire/YoutubeCommentsRun');
const {
  BLOCKLIST_RULE, findAvoidedWords, prepareCanon, canonPromptLines, blocklistProblem,
} = require('./canonPrompt');
const { lessonsUsed } = require('./outreachLessons');

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

/**
 * Check a comment against the target's rules. Returns every rule it breaks,
 * each with a sentence that names the rule — never just "invalid".
 *
 * `forApproval` drops the length bounds (Dane may trim a draft) and keeps
 * everything else, including YouTube's own ceiling. `blocked` is the canon's
 * AI-ism blocklist (lib/canonPrompt.js prepareCanon).
 */
function checkComment(text, { target, settings, blocked = [] }, { forApproval = false } = {}) {
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
  const aiism = blocklistProblem(body, blocked);
  if (aiism) problems.push(aiism);

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

/**
 * The account's free-text "voice" setting, shown on the screen as "Extra
 * notes for this channel". It comes AFTER the canon: the canon is how Dane
 * sounds everywhere, this is what is particular to one channel.
 */
function extraNotesLines(settings) {
  const notes = safeText(settings?.voice, 4000);
  return notes ? ['', 'EXTRA NOTES FOR THIS CHANNEL (from the account\'s settings):', notes] : [];
}

/**
 * The system message and the prompt for one draft. Pure — tested directly.
 * `canon` is prepareCanon's answer (lib/canonPrompt.js). `asOptions` leaves
 * off the one-draft answer shape, because lib/draftOptions.js adds its own
 * (three options, each with an angle).
 */
function buildPrompt({ target, settings, video, canon, lessons = [], asOptions = false }) {
  const bounds = LENGTH_BOUNDS[target.commentLength] || LENGTH_BOUNDS.medium;
  const types = (target.messageTypes || []).map((t) => MESSAGE_TYPE_WORDS[t] || t);
  const avoid = (settings?.avoidWords || []).filter(Boolean);
  const linkRule = target.linkPolicy === 'never'
    ? 'Do not include any link or web address of any kind.'
    : target.linkPolicy === 'if_natural'
      ? `You may include this link once, only if it fits naturally: ${target.linkUrl}. No other link or web address.`
      : `You may include this link once: ${target.linkUrl}. No other link or web address.`;

  const system = [
    asOptions
      ? 'You write YouTube comments for Dane, a real person, who picks one, reads it and approves it before it is posted.'
      : 'You write one YouTube comment at a time for Dane, a real person, who reads and approves it before it is posted.',
    'Write as him: a thoughtful human viewer, specific to this video, no hashtags, no emoji spam, no flattery, no sales language.',
    'Never invent facts about the video beyond what you are given.',
    '',
    'HARD RULES — a comment that breaks one is thrown away:',
    `- ${BLOCKLIST_RULE}`,
    '- Follow the link, mention and length rules in the request.',
    '',
    ...canonPromptLines(canon, { focus: 'the comment is about THIS video, in its own terms, and never lectures on these ideas', lessons }),
    ...extraNotesLines(settings),
    ...(asOptions ? [] : ['', 'Reply with JSON only, exactly {"comment": "<the comment text>"}.']),
  ].join('\n');

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
 * Write one draft for `target`. Returns `{ ok: true, data: { text, followed, note, canonUsed } }`
 * or a refusal naming the rule that stopped it. `video` is readVideoContext's
 * answer; `canonDocs` are lib/canonStore.js rows — with none, nothing is
 * written. `options.generate` replaces the AI call.
 */
async function writeDraft({ target, settings, video, canonDocs, lessons = [] }, options = {}) {
  const canon = prepareCanon(canonDocs);
  if (!canon.ok) return canon;
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
  const { system, prompt } = buildPrompt({ target, settings, video, canon, lessons });
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
    const checked = checkComment(text, { target, settings, blocked: canon.blocked });
    if (checked.ok) {
      return {
        ok: true,
        status: 200,
        data: { text, followed: followedSettings(target, settings), note: video?.note || '', canonUsed: canon.used, lessonsUsed: lessonsUsed(lessons) },
      };
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

/**
 * Outreach wizard 10/19 (task 86bcrmbm0): THREE comments for `target` to
 * choose from, in one AI call, each checked against the same rules as
 * `writeDraft` (length, link, avoid words, the canon's blocklist). An option
 * that breaks a rule twice is dropped and named; the rest are kept. Returns
 * `{ ok: true, data: { options, dropped, followed, note, canonUsed } }` or a
 * refusal (no canon, an avoided channel, no answer, or every option dropped).
 */
async function writeDraftOptions({ target, settings, video, canonDocs, lessons = [] }, options = {}) {
  const canon = prepareCanon(canonDocs);
  if (!canon.ok) return canon;
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
  const { system, prompt } = buildPrompt({ target, settings, video, canon, lessons, asOptions: true });
  const written = await draftOptions.writeOptions({
    system,
    prompt,
    generate,
    check: (text) => checkComment(text, { target, settings, blocked: canon.blocked }),
    maxLength: YOUTUBE_MAX_COMMENT_LENGTH,
  });
  if (!written.ok) {
    return written.status === 422
      ? { ...written, error: `${written.error} Click Write a draft to try again.` }
      : written;
  }
  return {
    ok: true,
    status: 200,
    data: { ...written.data, followed: followedSettings(target, settings), note: video?.note || '', canonUsed: canon.used, lessonsUsed: lessonsUsed(lessons) },
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
  writeDraftOptions,
};
