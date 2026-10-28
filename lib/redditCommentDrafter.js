'use strict';

/**
 * Reddit comments 2/4 (task 86bch3jp3) — writes ONE Reddit comment in Dane's
 * voice, from his canon (1/4, lib/canonStore.js), and checks it against his
 * rules before anyone sees it. The canon half (voice, blocklist, background)
 * is lib/canonPrompt.js, shared with the YouTube and Substack drafters since
 * Outreach wizard 8/19 (86bcrmbje). Shaped like lib/substackNotesDrafter.js, and
 * the link and avoid-word readers are lib/youtubeOutreachDrafter.js's, so the
 * three agents cannot disagree about what counts as a link.
 *
 * Since Outreach wizard 9/19 (86bcrmbke) the screen asks for THREE comments
 * to choose from (`writeDraftOptions`, through lib/draftOptions.js); each is
 * held to exactly the rules below. `writeDraft` still writes one.
 *
 * Nothing here saves or posts. lib/redditCommentsStore.js saves what this
 * returns; posting is 4/4. Dane approves every comment.
 *
 * THE RULES ARE CHECKED HERE, NOT TRUSTED TO THE PROMPT. A draft that breaks
 * one gets one more try with the broken rule named; if it breaks one again it
 * is REFUSED with the rule spelled out and never saved. On Approve the same
 * check runs against Dane's edit — except the self-promotion rule, because
 * anything promotional in his edit is there because he put it there (Dane,
 * 2026-10-12: "Never unless I add it").
 *
 * The AI call is `options.generate` (system, prompt) → { ok, text, error };
 * the default goes through lib/aiClient.js. Tests pass a stand-in.
 */

const { queryAnthropic } = require('./aiClient');
const draftOptions = require('./draftOptions');
const { findLinks, describeProblems } = require('./youtubeOutreachDrafter');
const {
  NO_CANON_ERROR, BLOCKLIST_RULE, parseBlocklist, prepareCanon, canonPromptLines, blocklistProblem,
} = require('./canonPrompt');
const { lessonsUsed } = require('./outreachLessons');

/**
 * The longest a Reddit comment may be: 10,000 characters, Markdown and spaces
 * counted: typecount.com, "Reddit Post Character Limit"
 * (https://typecount.com/blog/reddit-post-character-limit, read 2026-10-12),
 * and the same figure from every other counter a search turned up. Reddit's
 * own help pages, as searched that day, state no number, so this is a
 * secondary source; the poster (4/4) meets the real limit first.
 */
const REDDIT_COMMENT_MAX_LENGTH = 10000;

/** How long a draft should aim to be — asked for, not enforced (Dane may want longer). */
const AIM = 'two to five sentences';

/** How many times the model is asked before a rule-breaking draft is refused. */
const DRAFT_ATTEMPTS = 2;

/**
 * Names that make a comment self-promotion (Dane, 2026-10-12). Matched as
 * whole words, ignoring case, with or without the spaces between the parts —
 * so "daneofearth" and "Star Caster" count too.
 */
const SELF_PROMOTION_NAMES = Object.freeze(['Dane of Earth', 'DEO', 'ISITAS', 'WaveCenter', 'StarCaster', 'Alphire']);

function safeText(value, max = 20000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function nameRegExp(name) {
  const parts = name.split(/\s+|(?<=[a-z])(?=[A-Z])/).filter(Boolean)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[\\s_-]*')}(?![\\p{L}\\p{N}])`, 'iu');
}
const SELF_PROMOTION_RES = SELF_PROMOTION_NAMES.map((name) => ({ name, re: nameRegExp(name) }));

/** The self-promotion names `text` contains. */
function findSelfPromotion(text) {
  const body = String(text || '');
  return SELF_PROMOTION_RES.filter(({ re }) => re.test(body)).map(({ name }) => name);
}

/**
 * Check a comment against Dane's rules. Returns every rule it breaks, each
 * with a sentence naming it. `allowSelfPromotion` is set on Approve: links
 * and project names in his own edit are his to add.
 */
function checkCommentText(text, { blocked = [], allowSelfPromotion = false } = {}) {
  const body = String(text || '').trim();
  const problems = [];
  if (!body) {
    problems.push({ rule: 'empty', message: 'the comment is empty' });
    return { ok: false, problems };
  }
  if (body.length > REDDIT_COMMENT_MAX_LENGTH) {
    problems.push({ rule: 'length', message: `it is ${body.length} characters, and Reddit allows at most ${REDDIT_COMMENT_MAX_LENGTH}` });
  }
  if (!allowSelfPromotion) {
    const links = findLinks(body);
    if (links.length) {
      problems.push({ rule: 'self_promotion', message: `it contains a link (${links.join(', ')}), and a drafted comment may never carry one — no self-promotion unless Dane adds it` });
    }
    const names = findSelfPromotion(body);
    if (names.length) {
      problems.push({ rule: 'self_promotion', message: `it names ${names.join(', ')}, and a drafted comment may never mention Dane's own projects — no self-promotion unless Dane adds it` });
    }
  }
  const aiism = blocklistProblem(body, blocked);
  if (aiism) problems.push(aiism);
  return { ok: problems.length === 0, problems };
}

/**
 * The system message and the prompt for one draft. Pure — tested directly.
 * `asOptions` leaves off the one-draft answer shape, because lib/draftOptions.js
 * adds its own (three options, each with an angle).
 */
function buildPrompt({ post, canon, lessons = [], asOptions = false }) {
  const system = [
    asOptions
      ? 'You write Reddit comments for Dane, a real person, who picks one, reads it and approves it before it is posted.'
      : 'You write one Reddit comment at a time for Dane, a real person, who reads and approves it before it is posted.',
    'Write as him: a thoughtful human talking to the people in this thread, specific and plain.',
    'No hashtags, no emoji, no flattery, no sales language. Never invent facts beyond what you are given.',
    '',
    'HARD RULES — a comment that breaks one is thrown away:',
    '- No links or web addresses of any kind.',
    `- Never mention ${SELF_PROMOTION_NAMES.join(', ')}, or anything else Dane makes. This is a reply to a stranger's post, not an advert.`,
    `- ${BLOCKLIST_RULE}`,
    '',
    ...canonPromptLines(canon, { focus: 'the comment answers THIS post, in its own terms, and never explains or names these ideas', lessons }),
    ...(asOptions ? [] : ['', 'Reply with JSON only, exactly {"text": "<the comment>"}.']),
  ].join('\n');

  const lines = [];
  lines.push(`Subreddit: r/${safeText(post.subreddit, 100) || '(unknown)'}`);
  lines.push(`Post title: ${safeText(post.title, 1000) || '(none)'}`);
  if (safeText(post.author)) lines.push(`Posted by: u/${safeText(post.author, 100)}`);
  lines.push(`Post text: ${safeText(post.body, 20000) || '(no text — a link or image post)'}`);
  const top = Array.isArray(post.topComments) ? post.topComments.filter((c) => safeText(c?.body)) : [];
  if (top.length) {
    lines.push('');
    lines.push('What others have already said (do not repeat them):');
    for (const c of top) lines.push(`- u/${safeText(c.author, 100)}: ${safeText(c.body, 1500)}`);
  }
  lines.push('');
  if (post.comment && safeText(post.comment.body)) {
    lines.push(`Write a reply to this comment on the post, by u/${safeText(post.comment.author, 100)}:`);
    lines.push(safeText(post.comment.body, 4000));
  } else {
    lines.push('Write a top-level comment on this post.');
  }
  lines.push(`Length: ${AIM}.`);
  return { system, prompt: lines.join('\n') };
}

/** The text out of the model's reply: `{"text": …}`, fenced or bare, or the plain text. */
function parseReply(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (raw.startsWith('{')) {
    try {
      return safeText(JSON.parse(raw)?.text, REDDIT_COMMENT_MAX_LENGTH + 1);
    } catch {
      return '';
    }
  }
  return safeText(raw.replace(/^"|"$/g, ''), REDDIT_COMMENT_MAX_LENGTH + 1);
}

function defaultGenerate(scope) {
  return (system, prompt) => queryAnthropic(system, prompt, { feature: 'reddit-comment-draft', scope });
}

/**
 * Write one comment on `post` from `canonDocs` (lib/canonStore.js rows).
 * Returns `{ ok: true, data: { text, canonUsed } }` or a refusal naming the
 * rule that stopped it. Never writes without the canon.
 */
async function writeDraft({ post, canonDocs, lessons = [] }, options = {}) {
  const canon = prepareCanon(canonDocs);
  if (!canon.ok) return canon;
  if (!safeText(post?.title) && !safeText(post?.body)) {
    return { ok: false, status: 409, error: 'The post\'s title and text are needed before a comment can be written.' };
  }
  const generate = typeof options.generate === 'function' ? options.generate : defaultGenerate(options.scope);
  const { system, prompt } = buildPrompt({ post, canon, lessons });
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
    const checked = checkCommentText(text, { blocked: canon.blocked });
    if (checked.ok) return { ok: true, status: 200, data: { text, canonUsed: canon.used, lessonsUsed: lessonsUsed(lessons) } };
    problems = checked.problems;
  }

  return {
    ok: false,
    status: 422,
    error: `The draft broke a rule, so it was not kept: ${describeProblems(problems)}. Click Write another to try again.`,
    problems,
  };
}

/**
 * Outreach wizard 9/19 (task 86bcrmbke): THREE comments on `post` to choose
 * from, in one AI call, each checked against the same rules as `writeDraft`.
 * An option that breaks a rule twice is dropped and named; the rest are kept.
 * Returns `{ ok: true, data: { options, dropped, canonUsed } }` or a refusal
 * (no canon, no post, no answer, or every option dropped).
 */
async function writeDraftOptions({ post, canonDocs, lessons = [] }, options = {}) {
  const canon = prepareCanon(canonDocs);
  if (!canon.ok) return canon;
  if (!safeText(post?.title) && !safeText(post?.body)) {
    return { ok: false, status: 409, error: 'The post\'s title and text are needed before a comment can be written.' };
  }
  const generate = typeof options.generate === 'function' ? options.generate : defaultGenerate(options.scope);
  const { system, prompt } = buildPrompt({ post, canon, lessons, asOptions: true });
  const written = await draftOptions.writeOptions({
    system,
    prompt,
    generate,
    check: (text) => checkCommentText(text, { blocked: canon.blocked }),
    maxLength: REDDIT_COMMENT_MAX_LENGTH,
  });
  if (!written.ok) {
    return written.status === 422
      ? { ...written, error: `${written.error} Click Write with AI to try again.` }
      : written;
  }
  return { ok: true, status: 200, data: { ...written.data, canonUsed: canon.used, lessonsUsed: lessonsUsed(lessons) } };
}

module.exports = {
  REDDIT_COMMENT_MAX_LENGTH,
  DRAFT_ATTEMPTS,
  SELF_PROMOTION_NAMES,
  NO_CANON_ERROR,
  findSelfPromotion,
  parseBlocklist,
  prepareCanon,
  checkCommentText,
  describeProblems,
  buildPrompt,
  parseReply,
  writeDraft,
  writeDraftOptions,
};
