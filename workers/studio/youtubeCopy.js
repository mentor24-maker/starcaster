'use strict';

/**
 * THE YOUTUBE TEXT — each edit's title, description and tags (Reel Spinner 6a,
 * SC-839). The rules; the pass that runs them on the Mini is
 * workers/studio/youtubeCopyPass.js.
 *
 * Written for the people Dane is looking for, not for clicks. His words: "I am
 * not going to be a 'content creator'". The channel exists "to attract
 * collaborators to my various projects, especially WaveCenter and the DEO
 * movement" (cards.js). So the prompt carries his Reel Spinner notes (2a) as
 * the brief, the words the edit KEEPS (not the whole recording), and the
 * project its end card invites the viewer to (5b).
 *
 * WHAT THE AI WRITES AND WHAT IT DOES NOT. The AI writes the title, the body
 * of the description and the tags. The END of the description is never the
 * AI's: it is the end card's invitation line and web address, word for word
 * from the `Reel Spinner — end cards` note, then — when the music's licence
 * needs credit — the track's attribution line from the music shelf (5a). Code
 * appends them, so a model that drops or rewords them cannot ship a video
 * without its invitation or its licence credit.
 *
 * YOUTUBE'S LIMITS, held by code rather than asked for: a title of at most 100
 * characters, a description of at most 5,000, no `<` or `>` in either (YouTube
 * refuses both), and tags of at most 500 characters all together. A title
 * that runs long is cut at a word; a description body that runs long is cut
 * at a sentence, so the fixed ending always fits.
 *
 * NO CLICKBAIT, checked as well as asked for: an answer whose title or
 * description begs for likes, subscribes or the bell, or a title shouted in
 * capitals, is refused with the phrase named, never shipped.
 *
 * Through the AI door (lib/aiClient.js `generate`, SC-843), tier `strong`,
 * never a provider by name.
 */

const { generate } = require('../../lib/aiClient.js');

/** Bump when the prompt or a check changes. */
const RULES_VERSION = '1';
const FEATURE = 'studio_youtube_copy';
const DEFAULT_TIER = 'strong';
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_TIMEOUT_MS = 120000;

/** YouTube's own limits. */
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5000;
const TAGS_TOTAL_MAX = 500;
/** One tag longer than this is a sentence, not a tag. */
const TAG_MAX = 30;
const TAGS_MAX_COUNT = 15;

/** The kept words handed to the model, at most. A full edit of an hour is ~9,000 words. */
const WORDS_MAX = 12000;

/**
 * What a "content creator" says and Dane does not. Matched without case on
 * the title and the description body. Each entry is the phrase named in the
 * refusal.
 */
const BEGGING = [
  /\bsmash (?:that|the) (?:like|subscribe)/i,
  /\b(?:hit|ring|click|tap) (?:that|the) (?:like|bell|subscribe)/i,
  /\blike and subscribe\b/i,
  /\bdon'?t forget to (?:like|subscribe)/i,
  /\byou won'?t believe\b/i,
  /\bgone wrong\b/i,
  /\bmust[- ]watch\b/i,
  /\bshocking\b/i,
];

/** Every provider's way of saying "the answer hit the token limit". */
const CUT_OFF = new Set(['max_tokens', 'length', 'MAX_TOKENS']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** YouTube refuses `<` and `>` in a title or description. */
function youtubeSafe(value) {
  return String(value == null ? '' : value).replace(/[<>]/g, '');
}

/** One line: no newlines, runs of space closed up. */
function oneLine(value) {
  return youtubeSafe(value).replace(/\s+/g, ' ').trim();
}

/** Cut at a word so it fits in `max`, with no ellipsis (a title is not a teaser). */
function cutAtWord(value, max) {
  const said = oneLine(value);
  if (said.length <= max) return said;
  const room = said.slice(0, max);
  const at = room.lastIndexOf(' ');
  return (at > max * 0.5 ? room.slice(0, at) : room).replace(/[\s,;:–—-]+$/, '');
}

/** Cut at a sentence (or failing that a word) so it fits in `max`. */
function cutAtSentence(value, max) {
  const said = youtubeSafe(value).trim();
  if (said.length <= max) return said;
  const room = said.slice(0, max);
  const stop = Math.max(room.lastIndexOf('. '), room.lastIndexOf('.\n'), room.lastIndexOf('? '), room.lastIndexOf('! '));
  if (stop > max * 0.5) return room.slice(0, stop + 1).trim();
  const at = room.lastIndexOf(' ');
  return (at > 0 ? room.slice(0, at) : room).trim();
}

/** "wavecenter.com" → "https://wavecenter.com", so YouTube makes it a link. */
function linkFor(address) {
  const a = text(address);
  if (!a) return '';
  return /^https?:\/\//i.test(a) ? a : `https://${a}`;
}

/**
 * The fixed ending of every description: the invitation and address, then
 * the attribution where the licence needs one. Code, never the model.
 *
 * @param {{ invitation: string, address: string }} card   the end card (cards.js)
 * @param {string} attribution  the track's attribution line, '' when none is needed
 */
function descriptionEnding(card, attribution = '') {
  const parts = [`${youtubeSafe(text(card.invitation))}\n${linkFor(card.address)}`];
  const credit = youtubeSafe(text(attribution));
  if (credit) parts.push(`Music:\n${credit}`);
  return parts.join('\n\n');
}

/**
 * The body and the ending, together within 5,000 characters. The ending is
 * never cut: the body gives way. Idempotent — an ending already there is not
 * added twice.
 */
function composeDescription(body, card, attribution = '') {
  const ending = descriptionEnding(card, attribution);
  let said = youtubeSafe(body).trim();
  if (said.endsWith(ending)) said = said.slice(0, -ending.length).trim();
  const room = DESCRIPTION_MAX - ending.length - 2;
  if (room <= 0) return ending.slice(0, DESCRIPTION_MAX);
  said = cutAtSentence(said, room);
  return said ? `${said}\n\n${ending}` : ending;
}

/**
 * The attribution an edit's description must carry: the line of the track on
 * its row (video_edits.music_track) when that track's licence needs credit,
 * else ''. A track the shelf does not know is a refusal, never a silent ''
 * — a video must not go up without credit its music needs.
 */
function attributionFor(trackId, shelf) {
  const id = text(trackId);
  if (!id) return { ok: true, attribution: '', note: 'no music is picked for it yet' };
  const tracks = Array.isArray(shelf && shelf.tracks) ? shelf.tracks : [];
  const track = tracks.find((t) => t && t.id === id);
  if (!track) return { ok: false, reason: `its music, "${id}", is not on the music shelf, so its licence credit cannot be written` };
  if (!track.attributionRequired) return { ok: true, attribution: '', note: '' };
  const line = text(track.attribution);
  if (!line) return { ok: false, reason: `its music, "${track.title}", needs credit and the shelf has no attribution line for it` };
  return { ok: true, attribution: line, note: '' };
}

/** The words an edit keeps: every transcript word whose middle is inside a kept range. */
function keptWords(words, keepRanges) {
  const ranges = (Array.isArray(keepRanges) ? keepRanges : [])
    .filter((r) => r && Number.isFinite(r.start_s) && Number.isFinite(r.end_s) && r.end_s > r.start_s);
  const out = [];
  for (const w of Array.isArray(words) ? words : []) {
    if (!w || !Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
    const said = String(w.word == null ? '' : w.word).trim();
    if (!said) continue;
    const mid = (w.start + w.end) / 2;
    if (ranges.some((r) => mid >= r.start_s && mid <= r.end_s)) out.push(said);
  }
  return out;
}

/**
 * The prompt. `brief` is Dane's Reel Spinner notes; `project` the end card's
 * project; `said` the kept words.
 */
function buildPrompt({ kind, said, brief, project, invitation, quote = '' }) {
  const words = said.length > WORDS_MAX ? [...said.slice(0, WORDS_MAX), '…'] : said;
  const system = [
    'You write the YouTube title, description and tags for one of Dane\'s own videos.',
    'What his channel is for is in his own words below, between the BRIEF markers. Write for that, and nothing else.',
    '',
    '=== BRIEF (Dane\'s words) ===',
    String(brief),
    '=== END BRIEF ===',
    '',
    'He is not a "content creator" and this is not a channel chasing views. The people he wants are the ones who would',
    `want to work with him on ${project}. Write so that THEY recognise the video is for them.`,
    '',
    'Rules:',
    `- Title: plain, specific, at most 90 characters. Say what the video is about in his terms. No clickbait, no teasers,`,
    '  no questions written to make people click, no ALL CAPS, no emoji.',
    '- Description: two to four short paragraphs in plain words. What he talks about, and who it is for.',
    '  First person is fine only when quoting him. Never ask anyone to like, subscribe, comment or ring a bell.',
    '  Do NOT add a link, a sign-off, an invitation or a music credit at the end: those are added after you, word for word.',
    `  The invitation that will be added is: "${oneLine(invitation)}".`,
    '- Tags: 5 to 12 short tags, each a word or a short phrase someone looking for this subject would type.',
    '- Use only what is said in the transcript. Never invent a fact, a name or a claim he did not make.',
    '',
    'Answer with ONE JSON object and nothing else, exactly this shape:',
    '{ "title": "...", "description": "...", "tags": ["...", "..."] }',
  ].join('\n');
  const user = [
    `This is ${kind === 'short' ? 'a short clip (under a minute)' : 'a full video'} about ${project}.`,
    ...(text(quote) ? [`The words that carry it: "${oneLine(quote)}"`] : []),
    '',
    'WHAT IS SAID IN IT (the transcript of what the edit keeps):',
    words.join(' '),
  ].join('\n');
  return { system, user };
}

/** The model's text → the JSON object in it, or a reason it is not one. */
function parseAnswer(raw) {
  let body = String(raw == null ? '' : raw).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1];
  if (!body.startsWith('{')) {
    const first = body.indexOf('{');
    const last = body.lastIndexOf('}');
    if (first < 0 || last <= first) return { ok: false, reason: 'the answer had no JSON object in it' };
    body = body.slice(first, last + 1);
  }
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'the answer was JSON but not an object' };
    return { ok: true, value };
  } catch (err) {
    return { ok: false, reason: `the answer was not valid JSON (${err.message})` };
  }
}

/** Tags within YouTube's 500 characters together, each short, no repeats. */
function cleanTags(value) {
  const seen = new Set();
  const out = [];
  let total = 0;
  for (const raw of Array.isArray(value) ? value : []) {
    const tag = oneLine(raw).replace(/^#/, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    if (!tag || tag.length > TAG_MAX) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    // YouTube counts a tag with a space in it as two characters longer (its quotes), plus the comma.
    const cost = tag.length + (tag.includes(' ') ? 2 : 0) + (out.length ? 1 : 0);
    if (total + cost > TAGS_TOTAL_MAX || out.length >= TAGS_MAX_COUNT) break;
    seen.add(key);
    out.push(tag);
    total += cost;
  }
  return out;
}

function shouted(title) {
  const letters = title.replace(/[^A-Za-z]/g, '');
  return letters.length >= 12 && letters === letters.toUpperCase();
}

/**
 * The answer, checked and shaped. `{ ok: true, title, description, tags }` or
 * `{ ok: false, reason }`.
 */
function checkAnswer(answer, { card, attribution = '' }) {
  const title = cutAtWord(answer && answer.title, TITLE_MAX);
  if (!title) return { ok: false, reason: 'the answer had no title' };
  const body = typeof (answer && answer.description) === 'string' ? answer.description : '';
  if (!text(body)) return { ok: false, reason: 'the answer had no description' };
  for (const re of BEGGING) {
    const hit = re.exec(title) || re.exec(body);
    if (hit) return { ok: false, reason: `the answer asked for clicks ("${hit[0]}"), which Dane's videos never do` };
  }
  if (shouted(title)) return { ok: false, reason: `the title was shouted in capitals ("${title}")` };
  const tags = cleanTags(answer && answer.tags);
  if (!tags.length) return { ok: false, reason: 'the answer had no usable tags' };
  return { ok: true, title, description: composeDescription(body, card, attribution), tags };
}

/** Tier and budget from the environment, falling back to the defaults. */
function copyConfig(env = process.env) {
  const tier = ['fast', 'strong'].includes(text(env.STUDIO_YOUTUBE_COPY_TIER)) ? text(env.STUDIO_YOUTUBE_COPY_TIER) : DEFAULT_TIER;
  return { tier, maxTokens: DEFAULT_MAX_TOKENS, timeoutMs: DEFAULT_TIMEOUT_MS };
}

/**
 * Write one edit's YouTube text. Never throws for the model's sake.
 *
 * @returns {Promise<
 *   { state: 'done', title, description, tags, model, provider, usage } |
 *   { state: 'failed', reason, machine: boolean, code?, skipped?, model? }>}
 *   `machine` is true when no provider could serve or nothing answered at all
 *   (2d's rule: the machine's fault, not this edit's).
 */
async function writeYoutubeCopy(input, deps = {}) {
  const config = deps.config || copyConfig();
  const door = deps.door || generate;
  const said = Array.isArray(input.said) ? input.said : [];
  if (!text(input.brief)) return { state: 'failed', machine: false, reason: 'no Reel Spinner notes are switched on in this project, so there is nothing to write it for' };
  if (!said.length) return { state: 'failed', machine: false, reason: 'the edit keeps no transcribed words, so there is nothing to describe' };
  const { system, user } = buildPrompt(input);
  let res;
  try {
    res = await door({
      feature: FEATURE,
      scope: deps.scope || null,
      system,
      messages: user,
      json: false,
      tier: config.tier,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
    });
  } catch (err) {
    return { state: 'failed', machine: true, code: 'no_answer', reason: `the call to the AI door failed: ${err && err.message ? err.message : err}` };
  }
  if (!res || !res.ok) {
    const code = (res && res.code) || 'no_answer';
    const timedOut = /no answer within/i.test(text(res && res.error));
    return {
      state: 'failed',
      machine: code === 'no_provider' || (code === 'no_answer' && !timedOut),
      code,
      skipped: (res && res.skipped) || [],
      reason: (res && res.error) || 'the AI door gave no answer',
    };
  }
  const answered = { model: res.provider ? `${res.provider}/${res.model}` : (res.model || ''), provider: res.provider || '', usage: res.usage || null };
  if (CUT_OFF.has(res.stopReason)) return { state: 'failed', machine: false, reason: `the answer was cut off at the ${config.maxTokens}-token limit`, ...answered };
  const parsed = parseAnswer(res.text);
  if (!parsed.ok) return { state: 'failed', machine: false, reason: parsed.reason, ...answered };
  const checked = checkAnswer(parsed.value, input);
  if (!checked.ok) return { state: 'failed', machine: false, reason: checked.reason, ...answered };
  return { state: 'done', title: checked.title, description: checked.description, tags: checked.tags, ...answered };
}

module.exports = {
  RULES_VERSION,
  FEATURE,
  TITLE_MAX,
  DESCRIPTION_MAX,
  TAGS_TOTAL_MAX,
  BEGGING,
  copyConfig,
  descriptionEnding,
  composeDescription,
  attributionFor,
  keptWords,
  buildPrompt,
  parseAnswer,
  checkAnswer,
  cleanTags,
  cutAtWord,
  writeYoutubeCopy,
};
