'use strict';

/**
 * Substack Notes 3/7 (task 86bcet6pa) — writes ONE draft Note or reply in the
 * account's voice and checks it against the account's rules before anyone
 * sees it. The shape is lib/youtubeOutreachDrafter.js's on purpose, and the
 * link and avoid-word readers are that file's, so the two agents cannot
 * disagree about what counts as a link.
 *
 * Nothing here saves or posts. lib/substackNotesStore.js saves what this
 * returns; posting is ticket 6/7. Dane approves every item.
 *
 * THE RULES ARE CHECKED HERE, NOT TRUSTED TO THE PROMPT. A draft that breaks
 * one gets one more try with the broken rule named; if it breaks one again it
 * is REFUSED with the rule spelled out and never saved, so it is never shown
 * as something that can be approved. The same check runs on Approve, against
 * whatever Dane's edit left.
 *
 * The AI call is `options.generate` (system, prompt) → { ok, text, error };
 * the default goes through lib/aiClient.js. Tests pass a stand-in.
 */

const { queryAnthropic } = require('./aiClient');
const { findLinks, findAvoidedWords, describeProblems } = require('./youtubeOutreachDrafter');

/**
 * The longest a Note may be. 10,000 characters, links counted in full:
 * Buffer's Substack guide, which publishes Notes through Substack's own
 * interface (https://support.buffer.com/articles/using-substack-with-buffer-lDbUYyIq4R,
 * "Character limit", read 2026-10-08). Substack itself documents no number.
 */
const NOTE_MAX_LENGTH = 10000;

/**
 * The longest a reply may be. NOT FOUND: neither Substack nor Buffer documents
 * a limit for a reply to a Note (searched 2026-10-08), and nothing here may
 * post one by hand to find out. So this is the ticket's stated fallback, 1,000
 * characters — deliberately tight, since a reply that long is already unusual.
 * Raise it when the poster (6/7) measures the real one.
 */
const REPLY_MAX_LENGTH = 1000;

const MAX_LENGTH = Object.freeze({ note: NOTE_MAX_LENGTH, reply: REPLY_MAX_LENGTH });

/** How long a draft should aim to be — asked for, not enforced (Dane may want longer). */
const AIM_WORDS = Object.freeze({
  note: 'short: two to five sentences, under 600 characters',
  reply: 'short: one to three sentences, under 300 characters',
});

/** How many times the model is asked before a rule-breaking draft is refused. */
const DRAFT_ATTEMPTS = 2;

const KIND_WORDS = Object.freeze({ note: 'Note', reply: 'reply' });

function safeText(value, max = 5000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

/**
 * Check a Note or reply against the account's rules. Returns every rule it
 * breaks, each with a sentence naming the rule — never just "invalid". The
 * same rules apply to a fresh draft and to Dane's edit on Approve.
 */
function checkNoteText(text, { kind, settings }) {
  const body = String(text || '').trim();
  const what = KIND_WORDS[kind] || 'Note';
  const problems = [];
  if (!body) {
    problems.push({ rule: 'empty', message: `the ${what} is empty` });
    return { ok: false, problems };
  }

  const max = MAX_LENGTH[kind] || NOTE_MAX_LENGTH;
  if (body.length > max) {
    problems.push({ rule: 'length', message: `it is ${body.length} characters, and a ${what} may be at most ${max}` });
  }

  const links = findLinks(body);
  if (links.length && (settings?.linkPolicy || 'if_natural') === 'never') {
    problems.push({ rule: 'link', message: `it contains a link (${links.join(', ')}), and the account's link setting is Never` });
  }

  const avoided = findAvoidedWords(body, settings?.avoidWords);
  if (avoided.length) {
    problems.push({ rule: 'avoid_words', message: `it uses ${avoided.map((w) => `"${w}"`).join(', ')}, which ${avoided.length === 1 ? 'is' : 'are'} on the account's words-to-avoid list` });
  }

  return { ok: problems.length === 0, problems };
}

/** The system message and the prompt for one draft. Pure — tested directly. */
function buildPrompt({ item, settings }) {
  const kind = item.kind === 'reply' ? 'reply' : 'note';
  const avoid = (settings?.avoidWords || []).filter(Boolean);
  const policy = settings?.linkPolicy || 'if_natural';
  const linkRule = policy === 'never'
    ? 'Do not include any link or web address of any kind.'
    : policy === 'if_natural'
      ? 'Include a link only if it fits naturally, and at most one.'
      : 'You may include one link if it helps.';

  const system = [
    `You write one Substack ${kind === 'reply' ? 'reply to a Note' : 'Note'} at a time for a real person, to be read and approved by them before it is posted.`,
    'Write in their voice as a thoughtful human: specific, plain, no hashtags, no emoji spam, no flattery, no sales language.',
    'Never invent facts beyond what you are given.',
    'Reply with JSON only, exactly {"text": "<the Note text>"}.',
  ].join(' ');

  const lines = [];
  if (kind === 'reply') {
    lines.push('Write a reply to this Substack Note.');
    lines.push(`Their Note: ${safeText(item.targetText, 5000) || '(not available)'}`);
    if (safeText(item.ideaText)) lines.push(`What the account wants to say, roughly: ${safeText(item.ideaText)}`);
  } else if (item.source === 'new_content') {
    lines.push('Write a Note telling readers about this new piece of the account\'s own work.');
    if (safeText(item.contentTitle)) lines.push(`Title: ${safeText(item.contentTitle, 500)}`);
    if (safeText(item.contentUrl)) lines.push(`Address: ${safeText(item.contentUrl, 2000)}`);
    if (safeText(item.ideaText)) lines.push(`Notes: ${safeText(item.ideaText)}`);
  } else {
    lines.push('Write a Note of the account\'s own about this idea.');
    lines.push(`Idea: ${safeText(item.ideaText)}`);
  }
  lines.push('');
  lines.push(`Length: ${AIM_WORDS[kind]}.`);
  lines.push(linkRule);
  if (avoid.length) lines.push(`Never use these words: ${avoid.join(', ')}.`);
  if (safeText(settings?.voice)) lines.push(`Voice — how the account sounds: ${safeText(settings.voice, 4000)}`);

  return { system, prompt: lines.join('\n') };
}

/** The text out of the model's reply: `{"text": …}`, fenced or bare, or the plain text. */
function parseReply(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return safeText(parsed?.text ?? parsed?.note, NOTE_MAX_LENGTH + 1);
    } catch {
      return '';
    }
  }
  return safeText(raw.replace(/^"|"$/g, ''), NOTE_MAX_LENGTH + 1);
}

function defaultGenerate(scope) {
  return (system, prompt) => queryAnthropic(system, prompt, { feature: 'substack-notes-draft', scope });
}

/**
 * Write one draft for `item` (a note or a reply). Returns
 * `{ ok: true, data: { text } }` or a refusal naming the rule that stopped it.
 */
async function writeDraft({ item, settings }, options = {}) {
  if (item?.kind !== 'note' && item?.kind !== 'reply') {
    return { ok: false, status: 409, error: `A ${item?.kind || 'item'} has no words to draft — approve it as it is.` };
  }
  if (item.kind === 'reply' && !safeText(item.targetText)) {
    return { ok: false, status: 409, error: 'The text of the Note being replied to is needed before a reply can be written.' };
  }
  const generate = typeof options.generate === 'function' ? options.generate : defaultGenerate(options.scope);
  const { system, prompt } = buildPrompt({ item, settings });
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
    const checked = checkNoteText(text, { kind: item.kind, settings });
    if (checked.ok) return { ok: true, status: 200, data: { text } };
    problems = checked.problems;
  }

  return {
    ok: false,
    status: 422,
    error: `The draft broke a rule, so it was not kept: ${describeProblems(problems)}. Click Write a draft to try again.`,
    problems,
  };
}

// ── Reading the Note being replied to ──────────────────────────────────────

/**
 * CAN THE SERVER READ A NOTE? Yes — measured 2026-10-08 with a plain fetch
 * (no browser, no sign-in) of https://substack.com/@substack/note/c-1:
 *
 *   - the page answers 200 with the Note's text already in the HTML, in
 *     <meta name="description">, og:description and twitter:description
 *     ("First post!") — it is not drawn by JavaScript;
 *   - https://substack.com/api/v1/reader/comment/<number> answers 200 JSON
 *     with the full text at item.comment.body (also "First post!").
 *
 * A link to a Note that does NOT exist also answers 200 (checked the same
 * day with c-1001): the page is Substack's generic one, titled "Substack" and
 * described as "The app for independent voices". So the description is only
 * trusted when the title has a real Note's shape, `Name (@handle): "text"`,
 * or a missing Note would be drafted against Substack's slogan.
 *
 * The JSON is read first because a meta description may be shortened for a
 * long Note; the page is the fallback because the JSON address is not
 * documented and could change. If both fail, the caller asks Dane to paste
 * the text, with the reason this returns.
 */
const NOTE_ID_RE = /\/note\/c-(\d+)\/?$/;

function decodeEntities(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** A real Note page's title: `Chris Best (@cb): "First post!"`. Substack's generic page is just "Substack". */
const NOTE_TITLE_RE = /<title\b[^>]*>[^<]*\(@[^)<]+\):\s*(?:"|&quot;)/i;

/** The Note text from a Note page's HTML, or '' when the page is not a Note's. */
function noteTextFromHtml(html) {
  if (!NOTE_TITLE_RE.test(String(html || ''))) return '';
  const metas = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const wanted of ['og:description', 'description', 'twitter:description']) {
    for (const tag of metas) {
      const key = tag.match(/\b(?:property|name)\s*=\s*"([^"]*)"/i);
      if (!key || key[1].toLowerCase() !== wanted) continue;
      const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i);
      const text = safeText(decodeEntities(content ? content[1] : ''), 5000);
      if (text) return text;
    }
  }
  return '';
}

async function defaultFetcher(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Starcaster Substack Notes)', Accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(10000),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/**
 * The text of the Note at `targetUrl`. Never throws: `{ ok: true, text }`, or
 * `{ ok: false, reason }` with a sentence saying what was tried.
 */
async function readNoteText(targetUrl, options = {}) {
  const fetcher = typeof options.fetcher === 'function' ? options.fetcher : defaultFetcher;
  const id = String(targetUrl || '').match(NOTE_ID_RE);
  if (!id) return { ok: false, reason: 'the link is not to a Note, so there was nothing to read' };
  const tried = [];

  try {
    const res = await fetcher(`https://substack.com/api/v1/reader/comment/${id[1]}`);
    if (res.ok) {
      let body = '';
      try { body = safeText(JSON.parse(res.text)?.item?.comment?.body, 5000); } catch { body = ''; }
      if (body) return { ok: true, text: body };
      tried.push('Substack answered but sent no Note text');
    } else {
      tried.push(`Substack answered ${res.status}`);
    }
  } catch (err) {
    tried.push(`Substack could not be reached (${safeText(err?.message, 200) || 'unknown error'})`);
  }

  try {
    const res = await fetcher(targetUrl);
    if (res.ok) {
      const text = noteTextFromHtml(res.text);
      if (text) return { ok: true, text };
      tried.push('the Note\'s page showed no Note — it may have been deleted, or the link is wrong');
    } else {
      tried.push(`the Note's page answered ${res.status}`);
    }
  } catch (err) {
    tried.push(`the Note's page could not be reached (${safeText(err?.message, 200) || 'unknown error'})`);
  }

  return { ok: false, reason: tried.join('; ') };
}

module.exports = {
  NOTE_MAX_LENGTH,
  REPLY_MAX_LENGTH,
  DRAFT_ATTEMPTS,
  checkNoteText,
  describeProblems,
  buildPrompt,
  parseReply,
  writeDraft,
  noteTextFromHtml,
  readNoteText,
};
