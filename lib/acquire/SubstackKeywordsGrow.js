'use strict';

/**
 * Substack Miner — grow a wider keyword list from the writers Dane approved
 * (Substack Miner upgrade 2/4, task 86bcuxwkr).
 *
 * The search list (`substack_miner_settings.keywords`) is typed by hand and
 * nothing added to it. This pass learns a WIDER list from three things, and
 * only from writers whose status is `approved`:
 *
 *   - reason   the reasons he ticked when approving (`decision_reasons`), word
 *              for word after the reason picker's own cleaning (trimmed,
 *              spaces collapsed; compared ignoring case);
 *   - post     topics in their newest posts (`recent_posts` — titles,
 *              subtitles, excerpts — kept by the posts pass, upgrade 1/4);
 *   - note     topics in his "Why did you Approve?" sentence (`note`).
 *
 * Topics in posts and notes come from ONE AI call per pass, through
 * lib/aiClient.js queryAnthropic — the client the suggestion pass uses, so the
 * call is logged and priced the same way. It is asked for short topic phrases
 * (1-3 words) and which writers each came from; a phrase longer than that, or
 * naming no writer that was shown to it, is dropped and counted.
 *
 * The merge (store.mergeWiderKeywords) skips anything already searched for and
 * anything he removed, ignoring case, and stops the list at 300.
 *
 * NEVER A SILENT PARTIAL RUN. If the AI call fails, the reason keywords are
 * still added and the summary says in plain words that topics from posts and
 * notes were skipped, and why (`topicsSkipped`).
 *
 * Runs from the Run tab's "Grow keywords now" button and at the end of the
 * daily posts pass (lib/acquire/SubstackPostsReadRun.js runPostsReadDue).
 *
 * Every outside dependency comes in through `deps` (minerStore, generate,
 * now), so scripts/builder/substackKeywordsGrow.test.js drives it with no
 * network and no model.
 */

const minerStore = require('../substackMinerStore');
const { queryAnthropic } = require('../aiClient');

const MODEL = 'claude-sonnet-5';
const FEATURE = 'substack-miner-keywords-grow';
/** A topic longer than this many words is a sentence, not a keyword. */
const MAX_TOPIC_WORDS = 3;
/** How much of each writer is shown to the model, so one call stays small. */
const MAX_POSTS_SHOWN = 8;
const MAX_WRITERS_SHOWN = 120;

function text(value, max = 400) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The reason picker's cleanReason (components/outreach-wizard/reason-picker.tsx). */
function cleanReason(reason) {
  return String(reason || '').trim().replace(/\s+/g, ' ');
}

/** Each approved writer's ticked reasons, as wider-keyword candidates. */
function reasonKeywords(approved) {
  const out = [];
  for (const c of approved) {
    for (const raw of c.decisionReasons || []) {
      const keyword = cleanReason(raw);
      if (keyword) out.push({ keyword, sources: [{ kind: 'reason', handle: c.handle }] });
    }
  }
  return out;
}

/** What the model is shown about one writer, or '' when there is nothing to read. */
function writerBlock(c) {
  const posts = (c.recentPosts || []).slice(0, MAX_POSTS_SHOWN)
    .map((p) => [text(p.title, 200), text(p.subtitle, 200), text(p.excerpt, 300)].filter(Boolean).join(' — '))
    .filter(Boolean);
  const note = text(c.note, 600);
  if (!posts.length && !note) return '';
  const lines = [`WRITER ${c.handle}${text(c.name) ? ` (${text(c.name, 120)})` : ''}`];
  if (posts.length) lines.push(`Posts:\n${posts.map((p) => `  - ${p}`).join('\n')}`);
  if (note) lines.push(`Dane's words on approving: ${note}`);
  return lines.join('\n');
}

function buildPrompt(blocks, keywords) {
  const system = [
    'You help Dane find more Substack writers like the ones he has approved.',
    'From the posts of writers he approved, and his own words about why he approved them, pull out the TOPICS they write about.',
    `Each topic is a short phrase of 1 to ${MAX_TOPIC_WORDS} words, lower case unless it is a name — the kind of thing someone would search for. Never a sentence.`,
    'For each topic, list the handles of the writers whose POSTS show it under "posts", and the handles whose DANE\'S WORDS show it under "notes".',
    'Use only handles shown to you. Prefer topics more than one writer shares. At most 40 topics.',
    'Answer with JSON only, no prose around it:',
    '{"topics":[{"topic":"...","posts":["handle"],"notes":["handle"]}]}',
  ].join('\n');
  const prompt = [
    keywords.length ? `He already searches for these, so do not repeat them: ${keywords.join(', ')}` : '',
    blocks.join('\n\n'),
    'The topics, as JSON only.',
  ].filter(Boolean).join('\n\n');
  return { system, prompt };
}

/** The JSON object in the model's reply, fenced or bare; null when there is none. */
function parseTopics(raw) {
  const body = String(raw || '').trim();
  const shapes = [body];
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) shapes.unshift(fenced[1]);
  const braces = body.match(/\{[\s\S]*\}/);
  if (braces) shapes.push(braces[0]);
  for (const shape of shapes) {
    try {
      const parsed = JSON.parse(shape);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.topics)) return parsed.topics;
    } catch { /* try the next shape */ }
  }
  return null;
}

/**
 * The model's topics as wider-keyword candidates. A topic over
 * MAX_TOPIC_WORDS words, or naming no writer that was shown, is dropped and
 * counted in `dropped`.
 */
function topicKeywords(topics, shownHandles) {
  const out = [];
  let dropped = 0;
  for (const t of Array.isArray(topics) ? topics : []) {
    const keyword = cleanReason(typeof t?.topic === 'string' ? t.topic : '');
    if (!keyword || keyword.split(' ').length > MAX_TOPIC_WORDS || keyword.length > minerStore.MAX_WIDER_KEYWORD_LENGTH) {
      dropped += 1;
      continue;
    }
    const sources = [];
    for (const [field, kind] of [['posts', 'post'], ['notes', 'note']]) {
      for (const h of Array.isArray(t[field]) ? t[field] : []) {
        const handle = String(h || '').trim().toLowerCase();
        if (shownHandles.has(handle) && !sources.some((s) => s.kind === kind && s.handle === handle)) sources.push({ kind, handle });
      }
    }
    if (!sources.length) { dropped += 1; continue; }
    out.push({ keyword, sources });
  }
  return { keywords: out, dropped };
}

/**
 * Grow the project's wider keyword list. Answers `{ ok, data: summary }`:
 *   { approved, withPostsRead, withNotes, fromReasons, fromTopics,
 *     topicsDropped, topicsSkipped?, added: [keyword], grew, alreadySearched,
 *     removedBefore, overCap, widerKeywords }
 * or a refusal naming why nothing was written.
 */
async function runKeywordsGrow(scope = null, deps = {}) {
  const store = deps.minerStore || minerStore;
  const generate = deps.generate
    || ((system, prompt) => queryAnthropic(system, prompt, { feature: FEATURE, scope, anthropicModel: MODEL }));

  const settings = await store.getSettings(scope);
  if (!settings.ok) return settings;
  const listed = await store.listCandidates(1000, scope);
  if (!listed.ok) return listed;
  const approved = (listed.data || []).filter((c) => c.status === 'approved');

  const summary = {
    approved: approved.length,
    withPostsRead: approved.filter((c) => c.postsReadAt).length,
    withNotes: approved.filter((c) => text(c.note)).length,
    fromReasons: 0,
    fromTopics: 0,
    topicsDropped: 0,
    added: [],
    grew: 0,
    alreadySearched: 0,
    removedBefore: 0,
    overCap: 0,
    model: MODEL,
  };

  const found = reasonKeywords(approved);
  summary.fromReasons = found.length;

  const shown = approved.map((c) => ({ c, block: writerBlock(c) })).filter((x) => x.block).slice(0, MAX_WRITERS_SHOWN);
  if (!approved.length) {
    summary.topicsSkipped = 'there are no approved writers to learn from';
  } else if (!shown.length) {
    summary.topicsSkipped = `none of your ${approved.length} approved writer${approved.length === 1 ? ' has' : 's have'} posts read yet, or a note saying why you approved them`;
  } else {
    const { system, prompt } = buildPrompt(shown.map((x) => x.block), settings.data.keywords || []);
    const reply = await generate(system, prompt);
    if (!reply?.ok) {
      // Its own full stop is dropped: the summary sentence supplies one.
      summary.topicsSkipped = `the AI did not answer: ${text(reply?.error, 300).replace(/[.!\s]+$/, '') || 'no reply'}`;
    } else {
      const topics = parseTopics(reply.text);
      if (!topics) {
        summary.topicsSkipped = 'the AI answered, but not with a list of topics that could be read';
      } else {
        const read = topicKeywords(topics, new Set(shown.map((x) => x.c.handle)));
        summary.fromTopics = read.keywords.length;
        summary.topicsDropped = read.dropped;
        found.push(...read.keywords);
      }
    }
  }

  if (!approved.length) {
    return { ok: true, status: 200, data: { ...summary, widerKeywords: settings.data.widerKeywords || [] } };
  }
  const merged = await store.mergeWiderKeywords(found, scope, { now: deps.now ? deps.now() : undefined });
  if (!merged.ok) return merged;
  const { settings: saved, ...report } = merged.data;
  return { ok: true, status: 200, data: { ...summary, ...report, widerKeywords: saved.widerKeywords } };
}

/** The summary as lines, for logs. The Run tab words its own (substack-miner-panel.tsx). */
function formatKeywordsGrowSummary(s) {
  if (!s.approved) return ['No wider keywords learned: there are no approved writers yet.'];
  const lines = [`Learned from ${s.approved} approved writer${s.approved === 1 ? '' : 's'}: `
    + `${s.added.length} new keyword${s.added.length === 1 ? '' : 's'}`
    + (s.grew ? `, ${s.grew} already listed found again` : '')
    + '.'];
  if (s.topicsSkipped) lines.push(`Topics from posts and notes were skipped: ${s.topicsSkipped}. Keywords from your reasons were still added.`);
  if (s.overCap) lines.push(`${s.overCap} not added — the wider list is full (${minerStore.MAX_WIDER_KEYWORDS}).`);
  return lines;
}

module.exports = {
  runKeywordsGrow,
  formatKeywordsGrowSummary,
  reasonKeywords,
  topicKeywords,
  parseTopics,
  buildPrompt,
  MAX_TOPIC_WORDS,
  MODEL,
};
