'use strict';

/**
 * Substack Miner — suggest Approve or Reject for each undecided writer, from
 * the decisions Dane has already made (task 86bch3f2v).
 *
 * Dane, 2026-10-12: "Let's create a pre-filtration loop that reviews each
 * candidate website, and makes its best guess as to which keywords apply and
 * whether I will approve/reject." The "keywords" are his reason tags — the
 * decision_reasons he ticks in the Approve/Reject pop-up — because that is the
 * vocabulary he decides with.
 *
 * ONE PASS, per writer still undecided and not yet suggested (or every
 * undecided writer, with `redo`):
 *
 *   1. read the publication's newest post titles and subtitles from its public
 *      archive (`<publication>/api/v1/archive`, no sign-in) — what the writer
 *      actually writes about, which the one-line description often is not;
 *   2. ask the model, showing it every decision Dane has made (what he decided,
 *      the reasons he ticked, his sentence) and his search keywords, for
 *      { action, reasons, confidence, why } as JSON;
 *   3. store it on the writer (store.recordSuggestion), which refuses if he
 *      decided the writer in the meantime.
 *
 * A writer whose archive cannot be read is still suggested, from its name and
 * description, and the summary says so; one whose answer cannot be used is
 * named with the reason and left without a suggestion. Nothing is decided
 * here — only Dane's Agree does that.
 *
 * WHY IT REFUSES WITH TOO FEW DECISIONS. With fewer than MIN_DECISIONS, or with
 * no approvals or no rejections at all, the model has nothing to learn the
 * line from and would guess — confidently — from the writer's description
 * alone. That reads as a suggestion from Dane's history when it is not one.
 *
 * THE SAME PASS SERVES YOUTUBE (Outreach wizard 15/19, task 86bcrmbrf):
 * runYoutubeSuggestions judges the wizard's YouTube channels with the same
 * prompt, parsing and reason spelling, plus Dane's canon as background — see
 * the SUBSTACK / YOUTUBE sources below for the only things that differ.
 *
 * Every outside dependency comes in through `deps` (store, fetchJson,
 * generate, sleep, now), so scripts/builder/substackSuggestRun.test.js drives
 * it with no network and no model.
 */

const minerStore = require('../substackMinerStore');
const { fetchSubstackJson } = require('./SubstackNotesReadRun');
const { queryAnthropic } = require('../aiClient');
const { readCanonDocs, prepareCanon } = require('../canonPrompt');

const MODEL = 'claude-sonnet-5';
const MIN_DECISIONS = 5;
/** The most past decisions shown to the model, newest first. */
const MAX_EXAMPLES = 80;
/** The newest posts read per writer. */
const POSTS_READ = 8;
/** Stop starting new writers after this long — a serverless request ends at 300s. */
const DEFAULT_TIME_BUDGET_MS = 240000;
const MAX_REASONS = 4;

function text(value, max = 400) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

/** Where a writer's archive lives: its own address when it has one, else the subdomain. */
function archiveUrl(c) {
  let base = `https://${c.handle}.substack.com`;
  try {
    const url = new URL(c.publicationUrl || '');
    if (url.protocol === 'https:') base = url.origin;
  } catch { /* no usable address: the subdomain it is */ }
  return `${base}/api/v1/archive?sort=new&limit=${POSTS_READ}`;
}

/** "Title — subtitle" for each post, skipping empties. */
function postLines(posts) {
  return (Array.isArray(posts) ? posts : [])
    .map((p) => [text(p?.title, 200), text(p?.subtitle, 200)].filter(Boolean).join(' — '))
    .filter(Boolean)
    .slice(0, POSTS_READ);
}

/** Every reason Dane has used, with the decision it went with and how often. */
function reasonVocabulary(decided) {
  const tally = new Map();
  for (const c of decided) {
    for (const reason of c.decisionReasons || []) {
      const key = `${c.status}|${reason.toLowerCase()}`;
      const hit = tally.get(key) || { reason, decision: c.status, count: 0 };
      hit.count += 1;
      tally.set(key, hit);
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count);
}

/**
 * What differs between a Substack writer and a YouTube channel, in one place,
 * so one loop and one prompt serve both (Outreach wizard 15/19, task
 * 86bcrmbrf). Everything else — the examples, his reason tags, the JSON asked
 * for, the parsing — is shared, so a reason means the same thing on both.
 */
const SUBSTACK = Object.freeze({
  kind: 'substack',
  noun: 'writer',
  feature: 'substack-miner-suggest',
  intro: 'You help Dane decide which Substack writers are worth connecting with.',
  searchLine: 'What he searches Substack for',
  key: (c) => c.handle,
  label: (c) => text(c.name) || c.handle,
  postsHeading: 'Newest posts',
});

const YOUTUBE = Object.freeze({
  kind: 'youtube',
  noun: 'channel',
  feature: 'outreach-youtube-creators-suggest',
  intro: 'You help Dane decide which YouTube channels are worth commenting on and connecting with.',
  searchLine: 'What he searches YouTube for',
  key: (c) => c.channelId,
  label: (c) => text(c.name) || c.channelId,
  postsHeading: 'Newest videos',
});

function describeWriter(c, posts, source = SUBSTACK) {
  const lines = [`Name: ${source.label(c)} (${source.key(c)})`];
  if (source.kind === 'youtube' && Number.isFinite(c.subscriberCount)) lines.push(`Subscribers: ${c.subscriberCount}`);
  if (text(c.description)) lines.push(`Description: ${text(c.description, 600)}`);
  if ((c.keywordsHit || []).length) lines.push(`Matched search keywords: ${c.keywordsHit.join(', ')}`);
  if (posts && posts.length) lines.push(`${source.postsHeading}:\n${posts.map((p) => `  - ${p}`).join('\n')}`);
  return lines.join('\n');
}

/**
 * `canon` is optional background: Dane's thesis documents (lib/canonPrompt.js
 * prepareCanon). The YouTube pass adds it so a channel can be judged against
 * what he cares about while his own YouTube decisions are still few.
 */
function buildPrompt({ decided, keywords, writer, posts, source = SUBSTACK, canon = null }) {
  const vocabulary = reasonVocabulary(decided);
  const noun = source.noun;
  const system = [
    source.intro,
    `He has approved or rejected ${noun}s before, each with short reason tags and sometimes a sentence.`,
    `Predict what HE would decide for a new ${noun}, judging the way his past decisions show he judges.`,
    'Answer with JSON only, no prose around it:',
    '{"action":"approved"|"rejected","reasons":["..."],"confidence":"high"|"medium"|"low","why":"one sentence"}',
    `Use 1 to ${MAX_REASONS} reasons. Prefer his existing reason tags for that decision, spelled exactly as he spells them;`,
    'add a new short tag (a few words) only when none of his fit.',
    `confidence is how sure you are he would agree: high only when the ${noun} clearly resembles his past decisions.`,
    `"why" names what in this ${noun} led to the guess, in plain words, under 40 words.`,
  ];
  if (canon && canon.background && canon.background.length) {
    system.push(
      '',
      'BACKGROUND — what Dane thinks and cares about, from his own documents. Use it to judge whether this '
        + `${noun} talks about the things he talks about; it is not something to quote.`,
      ...canon.background.map((d) => `--- ${d.title || d.docKey} ---\n${text(d.body, 6000)}`),
    );
  }

  const examples = decided.slice(0, MAX_EXAMPLES).map((c) => {
    const tags = (c.decisionReasons || []).join(', ') || '(no tags)';
    const note = text(c.note, 300);
    return `- ${c.status.toUpperCase()}: ${source.label(c)} (${source.key(c)})`
      + `${text(c.description) ? ` — ${text(c.description, 240)}` : ''}\n  Reasons: ${tags}${note ? `\n  His words: ${note}` : ''}`;
  });
  const vocab = vocabulary.length
    ? vocabulary.map((v) => `- ${v.reason} (${v.decision === 'approved' ? 'approving' : 'rejecting'}, used ${v.count}×)`).join('\n')
    : '(none yet)';

  const prompt = [
    keywords.length ? `${source.searchLine}: ${keywords.join(', ')}` : '',
    `His reason tags so far:\n${vocab}`,
    `His past decisions (newest first):\n${examples.length ? examples.join('\n') : '(none yet)'}`,
    `The ${noun} to judge:\n${describeWriter(writer, posts, source)}`,
    'What would Dane decide? JSON only.',
  ].filter(Boolean).join('\n\n');
  return { system: system.join('\n'), prompt };
}

/** The JSON object in the model's reply, fenced or bare; null when there is none. */
function parseSuggestion(raw) {
  const body = String(raw || '').trim();
  const candidates = [body];
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.unshift(fenced[1]);
  const braces = body.match(/\{[\s\S]*\}/);
  if (braces) candidates.push(braces[0]);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* try the next shape */ }
  }
  return null;
}

/**
 * Snap each reason to Dane's spelling of it when it is one of his (any case),
 * so "Polymath" from the model counts with his "polymath" rather than as a new
 * tag; keep at most MAX_REASONS.
 */
function normaliseReasons(reasons, decided) {
  const known = new Map();
  for (const c of decided) for (const r of c.decisionReasons || []) if (!known.has(r.toLowerCase())) known.set(r.toLowerCase(), r);
  const out = [];
  for (const r of Array.isArray(reasons) ? reasons : []) {
    const t = text(r, 80);
    if (!t) continue;
    const spelled = known.get(t.toLowerCase()) || t;
    if (!out.some((o) => o.toLowerCase() === spelled.toLowerCase())) out.push(spelled);
  }
  return out.slice(0, MAX_REASONS);
}

function defaultGenerate(scope, feature = SUBSTACK.feature) {
  return (system, prompt) => queryAnthropic(system, prompt, { feature, scope, anthropicModel: MODEL });
}

/**
 * The loop both passes share. `pass` carries the source, the items, the
 * decisions to learn from, the keywords, the optional canon, how to read an
 * item's newest posts (`readPosts`, answering `{ posts, unread }`) and how to
 * store a suggestion. Answers `{ ok, data: summary }`.
 */
async function suggestEach(pass, scope, options, deps) {
  const { source, all, decided, keywords, canon, readPosts, record, capConfidence } = pass;
  const generate = deps.generate || defaultGenerate(scope, source.feature);
  const now = deps.now || Date.now;
  const timeBudgetMs = deps.timeBudgetMs || DEFAULT_TIME_BUDGET_MS;
  const started = now();
  const redo = options.redo === true;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : Infinity;
  const approvedCount = decided.filter((c) => c.status === 'approved').length;

  const undecided = all.filter((c) => c.status === 'candidate');
  const todo = undecided.filter((c) => redo || !c.suggestion);
  const summary = {
    basedOn: decided.length,
    approvedExamples: approvedCount,
    rejectedExamples: decided.length - approvedCount,
    undecided: undecided.length,
    alreadySuggested: undecided.length - todo.length,
    suggested: [],
    notSuggested: [],
    postsUnread: [],
    notReached: 0,
    model: MODEL,
  };
  if (canon) summary.canonDocs = canon.background.length;

  for (const item of todo) {
    if (summary.suggested.length + summary.notSuggested.length >= limit || now() - started > timeBudgetMs) {
      summary.notReached = todo.length - summary.suggested.length - summary.notSuggested.length;
      break;
    }
    const key = source.key(item);
    const label = source.label(item);
    const read = await readPosts(item);
    if (read.unread) summary.postsUnread.push({ handle: key, name: label, reason: read.unread });

    const { system, prompt } = buildPrompt({ decided, keywords, writer: item, posts: read.posts, source, canon });
    const reply = await generate(system, prompt);
    if (!reply?.ok) {
      summary.notSuggested.push({ handle: key, name: label, reason: `the AI did not answer: ${text(reply?.error, 300) || 'no reply'}` });
      // A missing key or exhausted credit fails every item the same way: stop.
      if (/api key|credit|billing|quota|401|403/i.test(String(reply?.error || ''))) {
        summary.notReached = todo.length - summary.suggested.length - summary.notSuggested.length;
        summary.stoppedBecause = text(reply?.error, 300);
        break;
      }
      continue;
    }
    const parsed = parseSuggestion(reply.text);
    if (!parsed) {
      summary.notSuggested.push({ handle: key, name: label, reason: 'the AI answered, but not with a suggestion that could be read' });
      continue;
    }
    const saved = await record(item.id, {
      action: parsed.action,
      reasons: normaliseReasons(parsed.reasons, decided),
      confidence: capConfidence ? capConfidence(parsed.confidence) : parsed.confidence,
      why: text(parsed.why, 600),
      basedOn: decided.length,
      model: MODEL,
      suggestedAt: new Date(now()).toISOString(),
    }, scope);
    if (!saved.ok) {
      // A tenancy or database failure is not one item's fault: stop and say so.
      if (saved.status >= 500) return saved;
      summary.notSuggested.push({ handle: key, name: label, reason: saved.error });
      continue;
    }
    summary.suggested.push({ handle: key, name: label, action: saved.data.suggestion.action, confidence: saved.data.suggestion.confidence });
  }
  return { ok: true, status: 200, data: summary };
}

const byNewest = (a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '') || 0;

/**
 * Suggest decisions for the project's undecided writers. Answers
 * `{ ok, data: summary }`; refuses (writing nothing) without a project, the
 * tables, or enough decisions to learn from.
 */
async function runSubstackSuggestions(scope = null, options = {}, deps = {}) {
  const store = deps.minerStore || minerStore;
  const fetchJson = deps.fetchJson || fetchSubstackJson;
  const wait = deps.sleep || sleep;

  const settings = await store.getSettings(scope);
  if (!settings.ok) return settings;
  const pauseMs = Math.max(0, Number(settings.data.pauseMsBetweenFetches ?? minerStore.SETTINGS_DEFAULTS.pauseMsBetweenFetches) || 0);

  const listed = await store.listCandidates(1000, scope);
  if (!listed.ok) return listed;
  const all = listed.data || [];
  const decided = all.filter((c) => c.status === 'approved' || c.status === 'rejected').sort(byNewest);
  const approvedCount = decided.filter((c) => c.status === 'approved').length;
  const rejectedCount = decided.length - approvedCount;
  if (decided.length < MIN_DECISIONS || !approvedCount || !rejectedCount) {
    return refuse(
      `There is not enough to learn from yet: ${approvedCount} approved and ${rejectedCount} rejected. `
      + `Suggestions need at least ${MIN_DECISIONS} decisions, with at least one of each, so they come from your judgement rather than a guess.`,
      409,
    );
  }

  let fetches = 0;
  const readPosts = async (writer) => {
    if (fetches > 0 && pauseMs) await wait(pauseMs);
    fetches += 1;
    const archive = await fetchJson(archiveUrl(writer));
    return archive.ok
      ? { posts: postLines(archive.data) }
      : { posts: [], unread: `its newest posts ${archive.reason}` };
  };
  return suggestEach({
    source: SUBSTACK,
    all,
    decided,
    keywords: settings.data.keywords || [],
    canon: null,
    readPosts,
    record: (id, s, sc) => store.recordSuggestion(id, s, sc),
  }, scope, options, deps);
}

/** The model's confidence, but never above "low" — used when it judged from canon alone. */
function atMostLow() {
  return 'low';
}

/**
 * Suggest Approve or Reject for each undecided YouTube channel (Outreach
 * wizard 15/19, task 86bcrmbrf), from his past YouTube decisions plus his
 * canon. Its newest video titles were stored when the channel was found, so
 * this pass fetches nothing from YouTube and spends no quota.
 *
 * WHY IT DOES NOT REFUSE ON FEW DECISIONS, when the Substack pass does: the
 * canon is something to judge from that is genuinely his. But a guess made
 * from the canon alone is not a guess from his judgement, so while there are
 * fewer than MIN_DECISIONS (or none of one kind) every suggestion is marked
 * low confidence and the summary says so. With neither decisions nor canon it
 * refuses, naming both.
 */
async function runYoutubeSuggestions(scope = null, options = {}, deps = {}) {
  const store = deps.creatorsStore || require('../youtubeCreatorsStore');
  const keywordsRead = await store.getKeywords(scope);
  if (!keywordsRead.ok) return keywordsRead;
  const listed = await store.listCreators(1000, scope);
  if (!listed.ok) return listed;
  const all = listed.data || [];
  const decided = all.filter((c) => c.status === 'approved' || c.status === 'rejected').sort(byNewest);
  const approvedCount = decided.filter((c) => c.status === 'approved').length;
  const rejectedCount = decided.length - approvedCount;
  const enoughDecisions = decided.length >= MIN_DECISIONS && approvedCount > 0 && rejectedCount > 0;

  const docs = await readCanonDocs(scope, { canonDocs: deps.canonDocs }, 'Not suggested');
  const prepared = docs.ok ? prepareCanon(docs.data) : docs;
  const canon = prepared.ok ? prepared : null;
  if (!canon && !enoughDecisions) {
    return refuse(
      `There is nothing to judge from yet: ${approvedCount} approved and ${rejectedCount} rejected YouTube channels, `
      + `and your canon is not available (${text(prepared.error, 300).replace(/^Not \w+: /, '')}). Decide a few channels yourself, or copy the canon in, and run it again.`,
      409,
    );
  }

  const res = await suggestEach({
    source: YOUTUBE,
    all,
    decided,
    keywords: keywordsRead.data.keywords || [],
    canon,
    readPosts: async (channel) => {
      const posts = (channel.latestVideos || []).map((v) => text(v.title, 200)).filter(Boolean);
      return posts.length ? { posts } : { posts: [], unread: 'no recent video titles were read when it was found' };
    },
    record: (id, s, sc) => store.recordSuggestion(id, s, sc),
    capConfidence: enoughDecisions ? null : atMostLow,
  }, scope, options, deps);
  if (res.ok) {
    res.data.fromCanonOnly = !enoughDecisions;
    if (!canon) res.data.canonUnavailable = text(prepared.error, 300).replace(/^Not \w+: /, '');
  }
  return res;
}

/** The summary as lines, for the command-line script. */
function formatSuggestSummary(s) {
  const lines = [`Learned from ${s.basedOn} decisions (${s.approvedExamples} approved, ${s.rejectedExamples} rejected).`];
  const approve = s.suggested.filter((x) => x.action === 'approved').length;
  lines.push(`Suggested ${s.suggested.length} of ${s.undecided} undecided writers: ${approve} approve, ${s.suggested.length - approve} reject.`
    + (s.alreadySuggested ? ` ${s.alreadySuggested} already had a suggestion.` : ''));
  for (const x of s.suggested) lines.push(`  ${x.action === 'approved' ? 'approve' : 'reject '} (${x.confidence}) ${x.name}`);
  for (const x of s.notSuggested) lines.push(`  not suggested: ${x.name} — ${x.reason}`);
  for (const x of s.postsUnread) lines.push(`  judged without its posts: ${x.name} — ${x.reason}`);
  if (s.notReached) lines.push(`${s.notReached} not reached${s.stoppedBecause ? ` — stopped: ${s.stoppedBecause}` : ' this time; run it again for the rest'}.`);
  return lines;
}

module.exports = {
  runSubstackSuggestions,
  runYoutubeSuggestions,
  SUBSTACK,
  YOUTUBE,
  formatSuggestSummary,
  buildPrompt,
  parseSuggestion,
  normaliseReasons,
  archiveUrl,
  MIN_DECISIONS,
  MODEL,
};
