'use strict';

/**
 * AI tags for fonts (Font Library 5/7, task 86bchyd4k).
 *
 * A font gets 3–6 lowercase tags — "sci-fi", "rounded", "headline" — so the
 * Fonts screen can be filtered by style. The tags come from a FIXED list,
 * docs/fonts/tag-vocabulary.txt, plus at most one free tag per font: an
 * unbounded AI vocabulary would give every font its own words, and a filter
 * nobody else's font matches is not a filter.
 *
 * Two callers: routes/fonts.js tags an upload that arrived without tags, and
 * scripts/fonts_autotag.mjs backfills the library. Neither ever replaces tags
 * a font already has — the person who edited them outranks the model.
 *
 * The AI call is passed in (`deps.query`) so the tests never reach a provider;
 * the real one is lib/aiClient.js queryAnthropic, metered under the
 * `font-autotag` feature like every other AI spend (lib/aiUsage.js).
 */

const fs = require('fs');
const path = require('path');
const { queryAnthropic } = require('./aiClient');

const VOCABULARY_PATH = path.join(__dirname, '..', 'docs', 'fonts', 'tag-vocabulary.txt');
const MIN_TAGS = 3;
const MAX_TAGS = 6;
const MAX_FREE_TAGS = 1;
const FEATURE = 'font-autotag';
/**
 * The small model: choosing a handful of words from a list needs no more, it
 * answers in a second or two (the upload waits on it), and it is priced in
 * lib/aiPricing.js, so the spend shows in dollars on Observe.
 */
const MODEL = 'claude-haiku-4-5';

/** A tag as the library stores it: lowercase words joined by hyphens. */
const TAG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Tags a font of each category is safe to carry when the model gave too few —
 * a floor, so "3–6 tags" holds even on a thin answer. Every one is on the list.
 */
const CATEGORY_FALLBACK = {
  serif: ['classic', 'body-text', 'elegant'],
  sans: ['minimal', 'body-text', 'ui'],
  display: ['headline', 'bold-display', 'logo'],
  monospace: ['monospace', 'code', 'typewriter'],
  handwriting: ['handwritten', 'script', 'playful'],
};

let cachedVocabulary = null;

function parseVocabulary(text) {
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim().toLowerCase();
    if (line && TAG_SHAPE.test(line)) seen.add(line);
  }
  return [...seen];
}

function loadVocabulary() {
  if (!cachedVocabulary) cachedVocabulary = parseVocabulary(fs.readFileSync(VOCABULARY_PATH, 'utf8'));
  return cachedVocabulary;
}

/** "Sci Fi" → "sci-fi". Anything that cannot become a tag becomes ''. */
function normaliseTag(value) {
  const tag = String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return tag.length <= 30 && TAG_SHAPE.test(tag) ? tag : '';
}

/**
 * The model's answer → the tags a font may carry. Listed tags are kept in the
 * order given; the FIRST unlisted tag is kept as the free tag and every later
 * one is dropped; the result is capped at six and topped up to three from the
 * category's fallbacks.
 */
function pickTags(suggested, { category, vocabulary = loadVocabulary() } = {}) {
  const allowed = new Set(vocabulary);
  const out = [];
  let free = 0;
  for (const raw of Array.isArray(suggested) ? suggested : []) {
    const tag = normaliseTag(raw);
    if (!tag || out.includes(tag)) continue;
    if (!allowed.has(tag)) {
      if (free >= MAX_FREE_TAGS) continue;
      free += 1;
    }
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  for (const tag of CATEGORY_FALLBACK[category] || CATEGORY_FALLBACK.sans) {
    if (out.length >= MIN_TAGS) break;
    if (allowed.has(tag) && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** The first JSON array of strings in the model's text, or null. */
function readTagList(text) {
  const body = String(text || '');
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : null;
  } catch {
    return null;
  }
}

function buildPrompt(font, vocabulary) {
  const system = 'You label typefaces for a website builder so people can find them by style. '
    + 'Answer with a JSON array of lowercase tags and nothing else.';
  const lines = [
    `Font family: ${font.family}`,
    `Category: ${font.category || 'unknown'}`,
  ];
  if (font.description) lines.push(`Description: ${String(font.description).slice(0, 600)}`);
  lines.push(
    '',
    `Choose ${MIN_TAGS} to ${MAX_TAGS} tags that describe how this font looks and what it suits.`,
    `Use only tags from this list: ${vocabulary.join(', ')}.`,
    `You may add at most ${MAX_FREE_TAGS} tag that is not on the list, only if none of the list fits an important quality.`,
    'If you do not recognise the family, judge from its name and category.',
    'Example answer: ["geometric", "futuristic", "headline", "wide"]',
  );
  return { system, prompt: lines.join('\n') };
}

/**
 * Suggest tags for one font.
 *
 * @param {{ family: string, category?: string, description?: string }} font
 * @param {{ query?: Function, scope?: object, vocabulary?: string[] }} [deps]
 * @returns {Promise<{ ok: true, tags: string[] } | { ok: false, error: string }>}
 */
async function suggestFontTags(font, deps = {}) {
  const family = String(font?.family || '').trim();
  if (!family) return { ok: false, error: 'A font with no family name cannot be tagged.' };
  const vocabulary = deps.vocabulary || loadVocabulary();
  const query = deps.query
    || ((system, prompt) => queryAnthropic(system, prompt, { feature: FEATURE, scope: deps.scope, anthropicModel: MODEL }));
  const { system, prompt } = buildPrompt({ ...font, family }, vocabulary);
  let answer;
  try {
    answer = await query(system, prompt);
  } catch (err) {
    return { ok: false, error: `The AI could not be reached: ${err?.message || err}` };
  }
  if (!answer || !answer.ok) return { ok: false, error: `The AI refused: ${answer?.error || 'no answer'}` };
  const list = readTagList(answer.text);
  if (!list) return { ok: false, error: `The AI did not answer with a list of tags: ${String(answer.text || '').slice(0, 120)}` };
  return { ok: true, tags: pickTags(list, { category: font.category, vocabulary }) };
}

/**
 * Tag a font that has no tags, and save them. Used on upload. Never throws and
 * never fails the caller: the font is saved either way, and the answer says
 * whether tagging worked so the screen can say so.
 *
 * @returns {Promise<{ ok: true, font: object } | { ok: false, font: object, error: string }>}
 */
async function autoTagFont(font, deps = {}) {
  if (!font || (Array.isArray(font.tags) && font.tags.length)) return { ok: true, font };
  const suggested = await suggestFontTags(font, deps);
  if (!suggested.ok) return { ok: false, font, error: suggested.error };
  // Required here, not at the top, so it is whichever store is loaded now.
  const store = deps.store || require('./fontsStore');
  const saved = await store.fillEmptyFontTags(font.id, suggested.tags);
  if (!saved.ok) return { ok: false, font, error: saved.error || 'The tags could not be saved.' };
  return { ok: true, font: saved.data };
}

module.exports = {
  autoTagFont,
  FEATURE,
  MAX_TAGS,
  MIN_TAGS,
  MODEL,
  VOCABULARY_PATH,
  buildPrompt,
  loadVocabulary,
  normaliseTag,
  parseVocabulary,
  pickTags,
  readTagList,
  suggestFontTags,
};
