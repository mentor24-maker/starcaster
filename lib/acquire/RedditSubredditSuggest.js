'use strict';

/**
 * "Find subreddits for my topics" — Outreach wizard 18/19 (task 86bcrmbwm).
 *
 * One AI call reads Dane's canon and the wizard's shared keywords and proposes
 * subreddits where those subjects are discussed, each with one sentence on
 * why. They land on the list as candidates (lib/redditWatchStore.js); nothing
 * is watched until he approves each one.
 *
 * The call is told which subreddits are already on the list — approved,
 * waiting or rejected — so it does not propose them again; anything it
 * proposes anyway is left exactly as it was (a rejected one stays rejected).
 *
 * No canon AND no keywords is a refusal naming both: there is nothing to base
 * a suggestion on, and a list of generic subreddits would read as an answer.
 */

const watchStore = require('../redditWatchStore');
const { queryAnthropic } = require('../aiClient');
const { readCanonDocs } = require('../canonPrompt');

const MODEL = 'claude-sonnet-5';
const FEATURE = 'outreach.reddit.subreddit-suggest';
/** How many it asks for in one go. */
const ASK_FOR = 10;
/** How much of each canon document the prompt carries. */
const CANON_CHARS_PER_DOC = 3000;
/** Documents about HOW Dane writes, not WHAT about (lib/outreachRanking.js says the same). */
const STYLE_DOCS = new Set(['VOICE', 'AIISM-BLOCKLIST']);

function text(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

/** The prompt pair. Pure — tested directly. */
function buildPrompt({ canonDocs, keywords, known }) {
  const canon = (Array.isArray(canonDocs) ? canonDocs : [])
    .filter((d) => d && !STYLE_DOCS.has(String(d.docKey || '')) && text(d.body))
    .map((d) => `## ${text(d.title || d.docKey, 200)}\n${text(d.body, CANON_CHARS_PER_DOC)}`)
    .join('\n\n');
  const system = 'You suggest Reddit communities (subreddits) where a writer could join conversations about the subjects '
    + 'he writes on. Suggest only subreddits you are confident exist and are active. Prefer communities where '
    + 'thoughtful discussion happens over ones that are mostly links or memes. Answer with JSON only.';
  const prompt = [
    keywords.length ? `His keywords: ${keywords.join(', ')}` : 'He has no keywords saved.',
    canon ? `What he writes about (his canon):\n\n${canon}` : 'He has no canon documents.',
    known.length ? `Already on his list — do NOT suggest these again: ${known.map((n) => `r/${n}`).join(', ')}` : '',
    `Suggest up to ${ASK_FOR} subreddits. For each, one plain sentence on why it fits his subjects.`,
    'Reply with ONLY this JSON: {"subreddits": [{"name": "the name without r/", "why": "one sentence"}]}',
  ].filter(Boolean).join('\n\n');
  return { system, prompt };
}

/** The proposals out of the model's reply: `[{ name, why }]`, or null if it is not the JSON asked for. */
function parseSuggestions(raw) {
  const t = String(raw || '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(t.slice(start, end + 1)); } catch { return null; }
  if (!parsed || !Array.isArray(parsed.subreddits)) return null;
  return parsed.subreddits
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({ name: text(s.name, 100), why: text(s.why, 500) }))
    .filter((s) => s.name);
}

/**
 * Run it for one project. `deps`: generate(system, prompt), canonDocs,
 * keywords (an array, skipping the keyword read), store. Answers
 * `{ ok, data: { added, kept, refused, keywords, canonDocs } }`.
 */
async function suggestSubreddits(scope, deps = {}) {
  const store = deps.store || watchStore;
  const generate = deps.generate
    || ((system, prompt) => queryAnthropic(system, prompt, { feature: FEATURE, scope, anthropicModel: MODEL }));

  let keywords = deps.keywords;
  if (!Array.isArray(keywords)) {
    const read = await require('../youtubeCreatorsStore').getKeywords(scope);
    if (!read.ok) return { ...read, error: `No subreddits suggested: the keywords could not be read (${read.error}).` };
    keywords = read.data.keywords;
  }
  keywords = keywords.map((k) => text(k, 200)).filter(Boolean);
  const canon = await readCanonDocs(scope, { canonDocs: deps.canonDocs }, 'No subreddits suggested');
  if (!canon.ok) return canon;
  const docs = (Array.isArray(canon.data) ? canon.data : []).filter((d) => !STYLE_DOCS.has(String(d?.docKey || '')) && text(d?.body));
  if (!keywords.length && !docs.length) {
    return refuse('No subreddits suggested: there are no keywords and no canon documents to base them on. Save keywords on YouTube\'s Find creators, or copy the canon in, first.', 409);
  }

  const listed = await store.listSubreddits(1000, scope);
  if (!listed.ok) return listed;
  const known = listed.data.map((r) => r.name);

  const { system, prompt } = buildPrompt({ canonDocs: docs, keywords, known });
  const reply = await generate(system, prompt);
  if (!reply?.ok) return refuse(`No subreddits suggested: the AI call failed (${text(reply?.error, 300) || 'no reason given'}).`, 502);
  const proposals = parseSuggestions(reply.text);
  if (!proposals) return refuse('No subreddits suggested: the AI answered, but not with the list it was asked for. Try again.', 502);
  if (!proposals.length) {
    return { ok: true, status: 200, data: { added: [], kept: [], refused: [], keywords: keywords.length, canonDocs: docs.length } };
  }
  const saved = await store.addSubreddits(proposals.slice(0, ASK_FOR), scope, { suggestedBy: 'ai' });
  if (!saved.ok) return saved;
  return { ok: true, status: 200, data: { ...saved.data, keywords: keywords.length, canonDocs: docs.length } };
}

module.exports = { suggestSubreddits, buildPrompt, parseSuggestions, FEATURE, ASK_FOR };
