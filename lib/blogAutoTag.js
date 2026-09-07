'use strict';

/**
 * Deterministic, meaning-based tag suggestions for blog posts.
 *
 * Dane, 2026-09-07 (ticket 86bbw4dcd): "read every page and blog post and
 * associate any clearly related tags. Do not use simple string matching …
 * match based on the meaning of the words, not just the letters … Deterministic
 * algorithm preferred, if quality is adequate."
 *
 * HOW IT MATCHES ON MEANING WITHOUT A MODEL
 * Every tag gets a word PROFILE: the tag's own words, plus the TF-IDF centroid
 * of every post that already carries it. A post about kids' camps matches
 * "junior tennis" because the posts an author already tagged that way use
 * those words -- the vocabulary is learned from the project's own tagging.
 * A post is scored against every profile by cosine similarity, and a tag is
 * suggested when the score clears THRESHOLD and at least one word in the post
 * actually contributed (the evidence, shown to the operator).
 *
 * Two thirds of every tag on Delray and Marinoff sits on exactly one post, so
 * for that long tail the profile is mostly the tag's own words. The evaluation
 * script (scripts/blog_auto_tag_eval.mjs) reports head and tail separately so
 * a good head score cannot hide a useless tail.
 *
 * THRESHOLD — chosen by leave-one-out against the tags authors already chose
 * (scripts/blog_auto_tag_eval.mjs, read-only against production, 2026-09-07):
 *
 *   Delray (56 posts, 50 tagged, 159 tags, 111 of them on one post)
 *   threshold  suggested  precision  recall  coverage
 *   0.25       150        50%        27%     90%
 *   0.30       105        57%        22%     80%   <- chosen
 *   0.35        69        55%        14%     62%
 *   0.40        52        50%         9%     48%
 *   Marinoff (10 posts, 62 tags): 0.30 -> 34 suggested, 32% precision, 70% coverage.
 *
 * "precision" there is a FLOOR: the answer key is what the author happened to
 * type, and reading every suggestion the author had not chosen (68 of them)
 * found 6 of 45 wrong on Delray and 5 of 23 wrong on Marinoff -- the rest were
 * tags the author would plausibly have added ("tennis camp" on the summer camp
 * post, where the author typed "tennis camo"). Judged that way: ~90% right on
 * Delray, ~85% on Marinoff. 0.35 buys two points of strict precision for
 * eighteen points of coverage; 0.25 adds 45 suggestions of visibly lower
 * quality. The misses that remain come from a duplicated post whose tags
 * leak into the profiles, and from sentence-length SEO tags that are really
 * one post's title. OWN_TERM_WEIGHT 0.3/0.5/0.8 and minEvidence 1/2 moved the
 * table by at most three points either way; 0.5 and 1 are kept.
 *
 * DETERMINISM: no randomness, no clock, no network. Same posts in, same
 * suggestions out -- the test asserts it by running twice.
 *
 * NO GENERATED LIB, NO TS IMPORT: the singular/plural rule is a port of
 * `siteSearchQueryVariants` in lib/builder-client/site-search.ts (its twin);
 * that rule deliberately refuses to be a full stemmer, because a stemmer maps
 * "tennis" to "tenni" and "universe" to "univers", which costs more than the
 * plural case buys. Change one, change the other.
 */

const DEFAULT_THRESHOLD = 0.3;
const DEFAULT_MAX = 5;
/** Weight of each of the tag's own words in its profile, relative to a unit centroid. */
const OWN_TERM_WEIGHT = 0.5;
const FIELD_WEIGHTS = Object.freeze({ title: 3, excerpt: 2, seoTitle: 2, seoDescription: 2, body: 1 });
const EVIDENCE_LIMIT = 4;

const STOP_WORDS = new Set((
  'a about above after again against all also am an and any are as at be because been before being ' +
  'below between both but by can could did do does doing down during each few for from further had has ' +
  'have having he her here hers herself him himself his how i if in into is it its itself just let me ' +
  'more most my myself no nor not now of off on once only or other our ours ourselves out over own same ' +
  'she should so some such than that the their theirs them themselves then there these they this those ' +
  'through to too under until up very was we were what when where which while who whom why will with ' +
  'would you your yours yourself yourselves get got like one two three make made many much new way well ' +
  'even ever every however still yet may might must shall etc via per also come came took take went go ' +
  'going see seen say said know known thing things year years day days time times http https www com'
).split(/\s+/));

function safeText(value) {
  return String(value == null ? '' : value);
}

/** Rich text arrives as HTML; the words are what matter. */
function stripHtml(html) {
  return safeText(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Singular form of one word, or the word unchanged. Port of the last-word rule
 * in site-search.ts `siteSearchQueryVariants`; the order of the branches is
 * the rule ("classes" must reach the strip rule before "class" reaches the
 * add rule).
 */
function singular(word) {
  const w = safeText(word);
  if (w.length < 4) return w;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ch|sh|ss|x|z)es$/.test(w)) return w.slice(0, -2);
  if (/ss$/.test(w)) return w;
  if (/(us|is)$/.test(w)) return w; // "tennis", "campus", "chassis" — not plurals
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Lowercase letter-only words, three letters or more, stop words gone, singularised. */
function tokenize(text) {
  return stripHtml(text)
    .toLowerCase()
    .replace(/[^a-z\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map(singular)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/** The exact key the Blog Links manager uses (lib/blogTagsStore.js tagKey). */
function tagKey(tag) {
  return safeText(tag).trim().toLowerCase();
}

/**
 * Near-duplicate key: "round robin", "roundrobin", "Round Robins" collapse to
 * one. Spaces removed, each word singularised, so the run spreads ONE spelling.
 */
function collapseKey(tag) {
  return tagKey(tag).replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean).map(singular).join('');
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : safeText(tags).split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = safeText(raw).trim();
    if (!tag) continue;
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function field(post, camel, snake) {
  if (!post) return '';
  if (post[camel] != null) return post[camel];
  if (post[snake] != null) return post[snake];
  return '';
}

/** Weighted term counts for one post: title words count three times, body once. */
function weightedCounts(post) {
  const counts = new Map();
  const add = (text, weight) => {
    for (const term of tokenize(text)) counts.set(term, (counts.get(term) || 0) + weight);
  };
  add(field(post, 'title', 'title'), FIELD_WEIGHTS.title);
  add(field(post, 'excerpt', 'excerpt'), FIELD_WEIGHTS.excerpt);
  add(field(post, 'seoTitle', 'seo_title'), FIELD_WEIGHTS.seoTitle);
  add(field(post, 'seoDescription', 'seo_description'), FIELD_WEIGHTS.seoDescription);
  add(field(post, 'body', 'body'), FIELD_WEIGHTS.body);
  return counts;
}

function unit(vector) {
  let sum = 0;
  for (const v of vector.values()) sum += v * v;
  const norm = Math.sqrt(sum);
  const out = new Map();
  if (!norm) return out;
  for (const [k, v] of vector) out.set(k, v / norm);
  return out;
}

function dot(a, b) {
  // Iterate the shorter map.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w) sum += v * w;
  }
  return sum;
}

/**
 * Build the tag profiles for a project.
 *
 * @param {Array<object>} posts   Every post in the project (camelCase from the
 *   store or snake_case rows — both are read).
 * @param {object} [options]
 * @param {string[]} [options.vocabulary]  Tags that must exist as profiles even
 *   if no post in `posts` carries them (the evaluation uses this so a hidden
 *   tag stays in the vocabulary as an own-words-only profile).
 * @param {number} [options.ownTermWeight]
 */
function buildTagProfiles(posts, options = {}) {
  const list = Array.isArray(posts) ? posts : [];
  const ownTermWeight = Number.isFinite(options.ownTermWeight) ? options.ownTermWeight : OWN_TERM_WEIGHT;

  const docs = list.map((post) => ({ counts: weightedCounts(post), tags: normalizeTags(field(post, 'tags', 'tags')) }));
  const df = new Map();
  for (const doc of docs) for (const term of doc.counts.keys()) df.set(term, (df.get(term) || 0) + 1);
  const n = docs.length;
  const idf = (term) => Math.log((n + 1) / ((df.get(term) || 0) + 1)) + 1;
  const vectorFor = (counts) => {
    const v = new Map();
    for (const [term, c] of counts) v.set(term, (1 + Math.log(c)) * idf(term));
    return unit(v);
  };

  /** collapseKey -> { spellings: Map<spelling, postCount>, centroid: Map, count } */
  const groups = new Map();
  const group = (tag) => {
    const key = collapseKey(tag);
    if (!key) return null;
    let g = groups.get(key);
    if (!g) { g = { key, spellings: new Map(), centroid: new Map(), count: 0 }; groups.set(key, g); }
    return g;
  };
  for (const tag of normalizeTags(options.vocabulary || [])) {
    const g = group(tag);
    if (g && !g.spellings.has(tag)) g.spellings.set(tag, 0);
  }
  for (const doc of docs) {
    const v = vectorFor(doc.counts);
    for (const tag of doc.tags) {
      const g = group(tag);
      if (!g) continue;
      g.spellings.set(tag, (g.spellings.get(tag) || 0) + 1);
      g.count += 1;
      for (const [term, w] of v) g.centroid.set(term, (g.centroid.get(term) || 0) + w);
    }
  }

  const profiles = [];
  for (const g of groups.values()) {
    // Canonical spelling: most posts; on a tie the spaced, readable form
    // ("round robin" over "roundrobin"); then alphabetical — deterministic.
    const words = (s) => s.trim().split(/\s+/).length;
    const spellings = [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || words(b[0]) - words(a[0]) || a[0].localeCompare(b[0]));
    const tag = spellings[0][0];
    const own = tokenize(tag);
    const combined = new Map(unit(g.centroid));
    for (const term of own) combined.set(term, (combined.get(term) || 0) + ownTermWeight * idf(term) / idf(term));
    profiles.push({ tag, key: tagKey(tag), collapseKey: g.key, count: g.count, ownTerms: own, spellings: spellings.map(([s, c]) => ({ spelling: s, count: c })), vector: unit(combined) });
  }
  profiles.sort((a, b) => a.tag.localeCompare(b.tag));

  return { profiles, postCount: n, idf, vectorFor: (post) => vectorFor(weightedCounts(post)) };
}

/** The spelling the run should spread for this tag (the one on the most posts). */
function canonicalSpelling(tag, model) {
  const key = collapseKey(tag);
  const profile = (model?.profiles || []).find((p) => p.collapseKey === key);
  return profile ? profile.tag : safeText(tag).trim();
}

/**
 * Suggested tags for one post: existing tags only, never one it already
 * carries (by near-duplicate key), at most `max`, every one with evidence.
 *
 * @returns {Array<{ tag: string, score: number, evidence: string[] }>}
 */
function suggestTags(post, model, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : DEFAULT_THRESHOLD;
  const max = Math.max(1, Number(options.max) || DEFAULT_MAX);
  const minEvidence = Math.max(1, Number(options.minEvidence) || 1);
  const v = model.vectorFor(post);
  if (!v.size) return [];
  const carried = new Set(normalizeTags(field(post, 'tags', 'tags')).map(collapseKey));
  const out = [];
  for (const profile of model.profiles) {
    if (carried.has(profile.collapseKey)) continue;
    const score = dot(v, profile.vector);
    if (score < threshold) continue;
    const evidence = [];
    for (const [term, w] of v) {
      const pw = profile.vector.get(term);
      if (pw) evidence.push([term, w * pw]);
    }
    if (evidence.length < minEvidence) continue;
    evidence.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out.push({ tag: profile.tag, score: Math.round(score * 10000) / 10000, evidence: evidence.slice(0, EVIDENCE_LIMIT).map(([t]) => t) });
  }
  out.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
  return out.slice(0, max);
}

module.exports = {
  DEFAULT_THRESHOLD,
  DEFAULT_MAX,
  OWN_TERM_WEIGHT,
  STOP_WORDS,
  stripHtml,
  singular,
  tokenize,
  tagKey,
  collapseKey,
  normalizeTags,
  weightedCounts,
  buildTagProfiles,
  canonicalSpelling,
  suggestTags,
};
