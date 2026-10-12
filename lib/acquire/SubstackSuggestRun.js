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
 * Every outside dependency comes in through `deps` (store, fetchJson,
 * generate, sleep, now), so scripts/builder/substackSuggestRun.test.js drives
 * it with no network and no model.
 */

const minerStore = require('../substackMinerStore');
const { fetchSubstackJson } = require('./SubstackNotesReadRun');
const { queryAnthropic } = require('../aiClient');

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

function describeWriter(c, posts) {
  const lines = [`Name: ${text(c.name) || c.handle} (${c.handle})`];
  if (text(c.description)) lines.push(`Description: ${text(c.description, 600)}`);
  if ((c.keywordsHit || []).length) lines.push(`Matched search keywords: ${c.keywordsHit.join(', ')}`);
  if (posts && posts.length) lines.push(`Newest posts:\n${posts.map((p) => `  - ${p}`).join('\n')}`);
  return lines.join('\n');
}

function buildPrompt({ decided, keywords, writer, posts }) {
  const vocabulary = reasonVocabulary(decided);
  const system = [
    'You help Dane decide which Substack writers are worth connecting with.',
    'He has approved or rejected writers before, each with short reason tags and sometimes a sentence.',
    'Predict what HE would decide for a new writer, judging the way his past decisions show he judges.',
    'Answer with JSON only, no prose around it:',
    '{"action":"approved"|"rejected","reasons":["..."],"confidence":"high"|"medium"|"low","why":"one sentence"}',
    `Use 1 to ${MAX_REASONS} reasons. Prefer his existing reason tags for that decision, spelled exactly as he spells them;`,
    'add a new short tag (a few words) only when none of his fit.',
    'confidence is how sure you are he would agree: high only when the writer clearly resembles his past decisions.',
    '"why" names what in this writer led to the guess, in plain words, under 40 words.',
  ].join('\n');

  const examples = decided.slice(0, MAX_EXAMPLES).map((c) => {
    const tags = (c.decisionReasons || []).join(', ') || '(no tags)';
    const note = text(c.note, 300);
    return `- ${c.status.toUpperCase()}: ${text(c.name) || c.handle} (${c.handle})`
      + `${text(c.description) ? ` — ${text(c.description, 240)}` : ''}\n  Reasons: ${tags}${note ? `\n  His words: ${note}` : ''}`;
  });
  const vocab = vocabulary.length
    ? vocabulary.map((v) => `- ${v.reason} (${v.decision === 'approved' ? 'approving' : 'rejecting'}, used ${v.count}×)`).join('\n')
    : '(none yet)';

  const prompt = [
    keywords.length ? `What he searches Substack for: ${keywords.join(', ')}` : '',
    `His reason tags so far:\n${vocab}`,
    `His past decisions (newest first):\n${examples.join('\n')}`,
    `The writer to judge:\n${describeWriter(writer, posts)}`,
    'What would Dane decide? JSON only.',
  ].filter(Boolean).join('\n\n');
  return { system, prompt };
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

function defaultGenerate(scope) {
  return (system, prompt) => queryAnthropic(system, prompt, { feature: 'substack-miner-suggest', scope, anthropicModel: MODEL });
}

/**
 * Suggest decisions for the project's undecided writers. Answers
 * `{ ok, data: summary }`; refuses (writing nothing) without a project, the
 * tables, or enough decisions to learn from.
 */
async function runSubstackSuggestions(scope = null, options = {}, deps = {}) {
  const store = deps.minerStore || minerStore;
  const fetchJson = deps.fetchJson || fetchSubstackJson;
  const generate = deps.generate || defaultGenerate(scope);
  const wait = deps.sleep || sleep;
  const now = deps.now || Date.now;
  const timeBudgetMs = deps.timeBudgetMs || DEFAULT_TIME_BUDGET_MS;
  const started = now();
  const redo = options.redo === true;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : Infinity;

  const settings = await store.getSettings(scope);
  if (!settings.ok) return settings;
  const pauseMs = Math.max(0, Number(settings.data.pauseMsBetweenFetches ?? minerStore.SETTINGS_DEFAULTS.pauseMsBetweenFetches) || 0);

  const listed = await store.listCandidates(1000, scope);
  if (!listed.ok) return listed;
  const all = listed.data || [];
  const byNewest = (a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '') || 0;
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

  const undecided = all.filter((c) => c.status === 'candidate');
  const todo = undecided.filter((c) => redo || !c.suggestion);
  const summary = {
    basedOn: decided.length,
    approvedExamples: approvedCount,
    rejectedExamples: rejectedCount,
    undecided: undecided.length,
    alreadySuggested: undecided.length - todo.length,
    suggested: [],
    notSuggested: [],
    postsUnread: [],
    notReached: 0,
    model: MODEL,
  };

  let fetches = 0;
  for (const writer of todo) {
    if (summary.suggested.length + summary.notSuggested.length >= limit || now() - started > timeBudgetMs) {
      summary.notReached = todo.length - summary.suggested.length - summary.notSuggested.length;
      break;
    }
    const label = text(writer.name) || writer.handle;
    if (fetches > 0 && pauseMs) await wait(pauseMs);
    fetches += 1;
    const archive = await fetchJson(archiveUrl(writer));
    const posts = archive.ok ? postLines(archive.data) : [];
    if (!archive.ok) summary.postsUnread.push({ handle: writer.handle, name: label, reason: `its newest posts ${archive.reason}` });

    const { system, prompt } = buildPrompt({ decided, keywords: settings.data.keywords || [], writer, posts });
    const reply = await generate(system, prompt);
    if (!reply?.ok) {
      summary.notSuggested.push({ handle: writer.handle, name: label, reason: `the AI did not answer: ${text(reply?.error, 300) || 'no reply'}` });
      // A missing key or exhausted credit fails every writer the same way: stop.
      if (/api key|credit|billing|quota|401|403/i.test(String(reply?.error || ''))) {
        summary.notReached = todo.length - summary.suggested.length - summary.notSuggested.length;
        summary.stoppedBecause = text(reply?.error, 300);
        break;
      }
      continue;
    }
    const parsed = parseSuggestion(reply.text);
    if (!parsed) {
      summary.notSuggested.push({ handle: writer.handle, name: label, reason: 'the AI answered, but not with a suggestion that could be read' });
      continue;
    }
    const saved = await store.recordSuggestion(writer.id, {
      action: parsed.action,
      reasons: normaliseReasons(parsed.reasons, decided),
      confidence: parsed.confidence,
      why: text(parsed.why, 600),
      basedOn: decided.length,
      model: MODEL,
      suggestedAt: new Date(now()).toISOString(),
    }, scope);
    if (!saved.ok) {
      // A tenancy or database failure is not one writer's fault: stop and say so.
      if (saved.status >= 500) return saved;
      summary.notSuggested.push({ handle: writer.handle, name: label, reason: saved.error });
      continue;
    }
    summary.suggested.push({ handle: writer.handle, name: label, action: saved.data.suggestion.action, confidence: saved.data.suggestion.confidence });
  }
  return { ok: true, status: 200, data: summary };
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
  formatSuggestSummary,
  buildPrompt,
  parseSuggestion,
  normaliseReasons,
  archiveUrl,
  MIN_DECISIONS,
  MODEL,
};
