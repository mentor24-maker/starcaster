'use strict';

/**
 * How worth replying to a found conversation is — Outreach wizard 14/19 (task
 * 86bcrmbqu), shared with the YouTube comment finder (16/19) and Reddit (18/19).
 *
 * Pure: no database, no network, no clock of its own. Four parts, each with a
 * ceiling, so one strong signal cannot bury the others:
 *
 *   canon fit      0-30  how many of Dane's canon words the text uses
 *   source         0-25  a writer he APPROVED (25), or a keyword search hit (15)
 *   recency        0-25  full marks inside a day, nothing after a week
 *   conversation   0-20  replies count double likes; logarithmic, so a viral
 *                        Note does not outrank a fitting one by sheer size
 *
 * The score is a whole number 0-100, and every candidate carries ONE sentence
 * naming the parts that put it there — a ranking with no reason is a ranking
 * Dane cannot argue with, and the ticket asks for the reason on every row.
 *
 * "Canon words" are read from the canon documents themselves (lib/canonStore.js
 * rows): the distinctive words the thesis documents keep coming back to. The
 * voice and blocklist documents are about HOW he writes, not WHAT about, so
 * they are left out.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const WEIGHTS = Object.freeze({ canon: 30, approved: 25, keyword: 15, recency: 25, conversation: 20 });
/** Each canon word the text uses is worth this much, up to WEIGHTS.canon. */
const CANON_POINTS_PER_WORD = 10;
/** A word counts as a canon word when the thesis documents use it this often. */
const CANON_MIN_USES = 3;
const CANON_MIN_LENGTH = 5;
/** The most canon words kept; the most-used win. */
const CANON_MAX_WORDS = 200;
/** Conversation size (replies x2 + likes) that earns the full conversation score. */
const CONVERSATION_FULL_AT = 100;

/** Documents about HOW Dane writes, not WHAT about. */
const STYLE_DOCS = new Set(['VOICE', 'AIISM-BLOCKLIST']);

// Common long words that say nothing about a subject.
const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'almost', 'along', 'already', 'although', 'always', 'among',
  'another', 'anyone', 'anything', 'around', 'because', 'become', 'becomes', 'before', 'being', 'below',
  'between', 'beyond', 'cannot', 'could', 'doing', 'during', 'either', 'every', 'everything', 'first',
  'given', 'going', 'having', 'however', 'itself', 'later', 'least', 'might', 'never', 'often', 'other',
  'others', 'otherwise', 'people', 'perhaps', 'place', 'point', 'quite', 'rather', 'really', 'right',
  'seems', 'should', 'since', 'something', 'still', 'their', 'theirs', 'themselves', 'there', 'therefore',
  'these', 'thing', 'things', 'think', 'those', 'though', 'three', 'through', 'today', 'together', 'under',
  'until', 'using', 'usually', 'where', 'whether', 'which', 'while', 'whole', 'within', 'without', 'would',
  'years', 'yourself', 'actually', 'simply', 'enough', 'means', 'makes', 'making', 'shall', 'whose',
]);

function words(text) {
  return String(text == null ? '' : text).toLowerCase().match(/[a-z][a-z'-]*[a-z]/g) || [];
}

/**
 * The canon words: distinctive words (5+ letters, not common filler) the
 * thesis documents use at least CANON_MIN_USES times, most-used first.
 */
function canonTerms(docs) {
  const tally = new Map();
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (!doc || STYLE_DOCS.has(String(doc.docKey || ''))) continue;
    for (const w of words(doc.body)) {
      if (w.length < CANON_MIN_LENGTH || STOPWORDS.has(w)) continue;
      tally.set(w, (tally.get(w) || 0) + 1);
    }
  }
  return [...tally.entries()]
    .filter(([, n]) => n >= CANON_MIN_USES)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, CANON_MAX_WORDS)
    .map(([w]) => w);
}

/** The canon words `text` uses, in the order the canon ranks them. */
function canonMatches(text, terms) {
  const present = new Set(words(text));
  return (Array.isArray(terms) ? terms : []).filter((t) => present.has(t));
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** "3 hours ago", "2 days ago", "just now". */
function ageText(ms) {
  if (ms < 60 * 60 * 1000) return 'within the hour';
  if (ms < DAY_MS) {
    const h = Math.floor(ms / (60 * 60 * 1000));
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(ms / DAY_MS);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function quoteList(list) {
  const q = list.map((w) => `"${w}"`);
  if (q.length <= 1) return q.join('');
  return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
}

function capitalise(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Score one found conversation.
 *
 *   text          what it says
 *   postedAt      when it was posted (ISO), if known
 *   foundAt       when a search found it (ISO) — used for age only when
 *                 postedAt is unknown, and then says so
 *   approved      true when its writer is one Dane approved
 *   keyword       the search keyword that found it, if any
 *   replies, likes  how much conversation it already has, if known
 *   terms         canonTerms(...) for the project
 *   now           the clock (ms)
 *
 * Answers `{ score, parts: { canon, source, recency, conversation }, matched, reason }`.
 */
function scoreConversation(c, { terms = [], now = Date.now() } = {}) {
  const item = c || {};
  const matched = canonMatches(item.text, terms);
  const canon = Math.min(WEIGHTS.canon, matched.length * CANON_POINTS_PER_WORD);

  const keyword = String(item.keyword || '').trim();
  const source = item.approved ? WEIGHTS.approved : (keyword ? WEIGHTS.keyword : 0);

  const posted = Date.parse(item.postedAt || '');
  const found = Date.parse(item.foundAt || '');
  const datedBy = Number.isFinite(posted) ? 'posted' : (Number.isFinite(found) ? 'found' : '');
  const when = datedBy === 'posted' ? posted : found;
  const age = datedBy ? Math.max(0, now - when) : null;
  let recency = 0;
  if (age !== null) recency = age <= DAY_MS ? WEIGHTS.recency : Math.max(0, Math.round(WEIGHTS.recency * (1 - (age - DAY_MS) / (WEEK_MS - DAY_MS))));

  const replies = count(item.replies);
  const likes = count(item.likes);
  const size = replies * 2 + likes;
  const conversation = size ? Math.min(WEIGHTS.conversation, Math.round(WEIGHTS.conversation * Math.log1p(size) / Math.log1p(CONVERSATION_FULL_AT))) : 0;

  const score = canon + source + recency + conversation;

  // The sentence: every part that earned something, strongest signal first.
  const bits = [];
  if (item.approved) bits.push('from a writer you approved');
  else if (keyword) bits.push(`found by your keyword "${keyword}"`);
  if (age !== null) bits.push(datedBy === 'posted' ? `posted ${ageText(age)}` : `found ${ageText(age)} (no posting date)`);
  if (matched.length) bits.push(`mentions ${quoteList(matched.slice(0, 3))} from your canon`);
  if (size) {
    const talk = [replies && `${replies} repl${replies === 1 ? 'y' : 'ies'}`, likes && `${likes} like${likes === 1 ? '' : 's'}`].filter(Boolean);
    bits.push(`already has ${talk.join(' and ')}`);
  }
  const reason = bits.length
    ? `${capitalise(bits.join(', '))}.`
    : 'Nothing marks it out: no approved writer, no keyword, no date and no canon words.';

  return { score, parts: { canon, source, recency, conversation }, matched, reason };
}

/** Best first; ties go to the newer one, then keep the order given. */
function rankConversations(list, options = {}) {
  return (Array.isArray(list) ? list : [])
    .map((c, i) => ({ c, i, s: scoreConversation(c, options) }))
    .sort((a, b) => {
      if (b.s.score !== a.s.score) return b.s.score - a.s.score;
      const ta = Date.parse(a.c.postedAt || a.c.foundAt || '') || 0;
      const tb = Date.parse(b.c.postedAt || b.c.foundAt || '') || 0;
      return tb - ta || a.i - b.i;
    })
    .map(({ c, s }) => ({ ...c, score: s.score, scoreParts: s.parts, reason: s.reason }));
}

module.exports = {
  canonTerms,
  canonMatches,
  scoreConversation,
  rankConversations,
  WEIGHTS,
  CANON_POINTS_PER_WORD,
};
