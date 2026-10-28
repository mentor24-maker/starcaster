'use strict';

/**
 * Outreach wizard 13/19 (task 86bcrmbpm) — the drafts learn from Dane's
 * choices. His approvals, edits and rejection reasons (outreach_feedback,
 * slice 12, lib/outreachFeedbackStore.js) are turned into a short list of
 * PLAIN-SENTENCE LESSONS ("Never open with a compliment", "Shorter on Reddit:
 * two sentences"), stored per channel or for all channels in
 * `outreach_lessons` (docs/SQL/outreach_lessons_setup.sql). Every drafter adds
 * the lessons that are on to its prompt, after the canon
 * (lib/canonPrompt.js canonPromptLines), and every draft records which ones
 * it was written with as `lessons_used`.
 *
 * Dane can read, change, switch off or delete each one, and add his own, on
 * the wizard's Learn stage. Lessons never touch the canon (Non-goal: they
 * never write to the vault).
 *
 * WHERE A SUGGESTED LESSON COMES FROM IS CHECKED IN CODE. The AI is shown his
 * recent decisions under short labels (F1, F2…) and must say which ones each
 * lesson is drawn from. A lesson citing none, or only labels it was not shown,
 * is dropped. Its "why" sentence ("from 4 rejections tagged "too salesy"") is
 * then written HERE from the cited rows, never by the model, so the count it
 * states is a count.
 *
 * A REFRESH NEVER UNDOES ONE OF HIS CHOICES. It replaces only suggested
 * lessons he has left alone and left on. A lesson he switched off stays off
 * (and is not suggested again under the same words); one he edited, and his
 * own, are never touched.
 *
 * When: from the Refresh lessons button, and after every fifth decision on a
 * channel (`refreshIfDue`, called by attachFeedback).
 *
 * TENANCY FAILS CLOSED, as lib/outreachFeedbackStore.js does: both tenant
 * columns are written explicitly from the scope, and every read, change and
 * delete filters on project_id itself (landmine 12). THE DATABASE IS THE ONLY
 * STORE — no local-file fallback (landmines 6, 15). Every function returns
 * the `{ ok, status, data }` envelope.
 *
 * The AI call is `options.generate` (system, prompt) → { ok, text, error };
 * the default goes through lib/aiClient.js. Tests pass a stand-in.
 */

// Looked up on every call rather than captured at load, so a test that swaps
// lib/supabase.js between cases reaches the database it just set up — this
// module is required by every outreach store, and outlives their cache resets.
function sbQuery(req) {
  return require('./supabase').sbQuery(req);
}
function tableConfig() {
  return require('./supabase').tableConfig();
}
const { unknownKeyError } = require('./storeInput');
const feedbackStore = require('./outreachFeedbackStore');

const CHANNELS = feedbackStore.CHANNELS;
/** Where a lesson applies: one channel, or every channel. */
const LESSON_CHANNELS = Object.freeze(['all', ...CHANNELS]);

const CHANNEL_WORDS = Object.freeze({ all: 'all channels', youtube: 'YouTube', substack: 'Substack', reddit: 'Reddit' });

/** A lesson is one line. */
const MAX_LESSON_LENGTH = 160;
/** How many lessons one refresh may suggest. */
const MAX_SUGGESTED = 8;
/** How many past decisions a refresh reads. */
const FEEDBACK_WINDOW = 60;
/** A refresh runs on its own after every this-many decisions on a channel. */
const REFRESH_EVERY = 5;
/** The score counts over the newest this-many decisions. */
const SCORE_WINDOW = 20;
/** How many lessons a list reads. */
const LIST_LIMIT = 200;

const SETUP_SQL = 'docs/SQL/outreach_lessons_setup.sql';

/** The two approvals where his words were the draft's own. */
const UNEDITED = Object.freeze(['approved-as-is', 'chose-option']);

function table() {
  return tableConfig().outreachLessons || 'outreach_lessons';
}

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function refuse(error, status = 400, extra = {}) {
  return { ok: false, status, error, ...extra };
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function scopeOrError(scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  const userId = safeText(scope?.userId || scope?.user_id, 120);
  if (!projectId) return { error: refuse('No project is selected, so there are no lessons to read or change.') };
  if (!userId) return { error: refuse('No signed-in user was given — both tenant columns are required for lessons.') };
  return { projectId, userId };
}

/** A missing table or column reads as a sentence naming the file to run, not a PostgREST code. */
function explainMissingTable(result) {
  if (result.ok) return result;
  const text = String(result.error || '');
  if (!/outreach_lessons|lessons_used|PGRST20[45]|42P01|42703|does not exist/i.test(text)) return result;
  return refuse(`${text} — this database does not have the outreach lessons yet; run ${SETUP_SQL}.`, result.status || 500, { code: 'SQL_NOT_RUN' });
}

/**
 * A draft write PostgREST refused because `lessons_used` is not on the table
 * yet, turned into a refusal naming the SQL to run; anything else unchanged.
 * Loud on purpose, the way canon_used is (lib/canonPrompt.js).
 */
function explainMissingLessonsColumn(res) {
  if (res && !res.ok && /lessons_used/.test(String(res.error || ''))) {
    return { ...res, error: `The draft was written but not saved: the lessons_used column is missing — run ${SETUP_SQL}.` };
  }
  return res;
}

/** One line, inner spaces collapsed — the spelling that is saved. */
function cleanLesson(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** The same lesson whatever its case, spacing and closing full stop. */
function lessonKey(text) {
  return cleanLesson(text).toLowerCase().replace(/[.!]+$/, '');
}

function checkLessonText(raw) {
  if (typeof raw !== 'string') return refuse('A lesson is a sentence.');
  if (/[\r\n]/.test(raw.trim())) return refuse('A lesson is one line — put it in one sentence.');
  const text = cleanLesson(raw);
  if (!text) return refuse('The lesson is empty — write it as one plain sentence.');
  if (text.length > MAX_LESSON_LENGTH) return refuse(`A lesson is one line: ${MAX_LESSON_LENGTH} characters at most, and this is ${text.length}.`);
  return { ok: true, text };
}

function rowToLesson(row) {
  return {
    id: row.id,
    channel: row.channel,
    text: row.text || '',
    enabled: row.enabled !== false,
    source: row.source === 'dane' ? 'dane' : 'suggested',
    edited: Boolean(row.edited),
    why: row.why || '',
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

/**
 * The lessons that apply to `channel`: its own and the all-channel ones,
 * the all-channel ones first, then oldest first. `channel` 'all' reads only
 * the all-channel ones.
 */
async function listLessons(channel, scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  if (!LESSON_CHANNELS.includes(channel)) return refuse(`channel must be one of ${LESSON_CHANNELS.join(', ')} — got ${JSON.stringify(channel)}`);
  const channels = channel === 'all' ? ['all'] : ['all', channel];
  const res = await sbQuery({
    table: table(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&channel=in.(${channels.join(',')})`
      + `&select=*&order=created_at.asc&limit=${LIST_LIMIT}`,
  });
  if (!res.ok) return explainMissingTable(refuse(`The lessons could not be read: ${res.error}`, res.status || 502));
  const lessons = (Array.isArray(res.data) ? res.data : []).map(rowToLesson);
  lessons.sort((a, b) => (a.channel === 'all' ? 0 : 1) - (b.channel === 'all' ? 0 : 1));
  return { ok: true, status: 200, data: lessons };
}

/**
 * The lessons a drafter writes with: `options.lessons` when a test supplies
 * them, else the ones that are ON for `channel`. A failed read is a refusal —
 * never an empty list, which would read as "no lessons" and write the draft
 * without the ones he set.
 */
async function lessonsForDraft(channel, scope, options = {}) {
  if (Array.isArray(options.lessons)) return { ok: true, data: options.lessons.filter((l) => l && l.enabled !== false) };
  const res = await listLessons(channel, scope);
  if (!res.ok) return { ...res, error: `Not written: ${res.error}` };
  return { ok: true, data: res.data.filter((l) => l.enabled) };
}

/** What a draft records as `lessons_used`. */
function lessonsUsed(lessons) {
  return (Array.isArray(lessons) ? lessons : []).map((l) => ({ id: l.id || null, text: cleanLesson(l.text) })).filter((l) => l.text);
}

/** The prompt lines for the lessons that are on; none when there are none. */
function lessonPromptLines(lessons) {
  const list = lessonsUsed(lessons);
  if (!list.length) return [];
  return [
    '',
    'LESSONS FROM DANE\'S PAST CHOICES — he wrote or approved each of these; follow every one:',
    ...list.map((l) => `- ${l.text}`),
  ];
}

/** Dane's own lesson. */
async function createLesson(input, scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const unknown = unknownKeyError(body, ['channel', 'text']);
  if (unknown) return unknown;
  if (!LESSON_CHANNELS.includes(body.channel)) return refuse(`channel must be one of ${LESSON_CHANNELS.join(', ')} — got ${JSON.stringify(body.channel)}`);
  const checked = checkLessonText(body.text);
  if (!checked.ok) return checked;
  return insertRows([{
    channel: body.channel,
    text: checked.text,
    enabled: true,
    source: 'dane',
    edited: false,
    why: 'You wrote this one.',
    evidence: [],
  }], s).then((res) => (res.ok ? { ok: true, status: 201, data: res.data[0] } : res));
}

async function insertRows(rows, s) {
  if (!rows.length) return { ok: true, status: 200, data: [] };
  const now = new Date().toISOString();
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: rows.map((r) => ({ ...r, project_id: s.projectId, owner_user_id: s.userId, created_at: now, updated_at: now })),
  });
  if (!res.ok) return explainMissingTable(refuse(`The lesson was not saved: ${res.error}`, res.status || 502));
  const created = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
  if (created.length !== rows.length) {
    return refuse(`The lessons were not all saved — ${rows.length} were sent and the database returned ${created.length}.`, 500);
  }
  return { ok: true, status: 201, data: created.map(rowToLesson) };
}

function idOrError(id) {
  const clean = safeText(id, 80);
  if (!/^[0-9a-f-]{36}$/i.test(clean)) return { error: refuse(`"${clean}" is not a lesson id.`) };
  return { id: clean };
}

/**
 * Change a lesson's words (`text`) or switch it on or off (`enabled`).
 * Changing a suggested lesson's words marks it edited, so a refresh keeps it.
 */
async function updateLesson(id, input, scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const which = idOrError(id);
  if (which.error) return which.error;
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const unknown = unknownKeyError(body, ['text', 'enabled']);
  if (unknown) return unknown;
  const columns = {};
  if (body.text !== undefined) {
    const checked = checkLessonText(body.text);
    if (!checked.ok) return checked;
    columns.text = checked.text;
    columns.edited = true;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return refuse('enabled must be true (on) or false (off)');
    columns.enabled = body.enabled;
  }
  if (!Object.keys(columns).length) return refuse('Nothing to change — send text, enabled, or both.');
  columns.updated_at = new Date().toISOString();
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${encodeURIComponent(which.id)}&project_id=eq.${encodeURIComponent(s.projectId)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: columns,
  });
  if (!res.ok) return explainMissingTable(refuse(`The lesson was not changed: ${res.error}`, res.status || 502));
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return refuse('That lesson was not found in this project — it may have been deleted. Reload the list.', 404);
  return { ok: true, status: 200, data: rowToLesson(row) };
}

async function deleteLesson(id, scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const which = idOrError(id);
  if (which.error) return which.error;
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${encodeURIComponent(which.id)}&project_id=eq.${encodeURIComponent(s.projectId)}&select=id`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return explainMissingTable(refuse(`The lesson was not deleted: ${res.error}`, res.status || 502));
  const rows = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
  if (!rows.length) return refuse('That lesson was not found in this project — it may already be gone. Reload the list.', 404);
  return { ok: true, status: 200, data: { id: which.id, deleted: true } };
}

// ── The score ───────────────────────────────────────────────────────────────

/**
 * "Approved without edits, last 20: 6 of 20" — of the newest SCORE_WINDOW
 * decisions on `rows` (newest first), how many he approved in the draft's own
 * words (as it was, or one of the options unchanged). Pure.
 */
function scoreFrom(rows, window = SCORE_WINDOW) {
  const recent = (Array.isArray(rows) ? rows : []).slice(0, window);
  const unedited = recent.filter((r) => UNEDITED.includes(r.action)).length;
  return { unedited, counted: recent.length, window, sentence: scoreSentence(unedited, recent.length, window) };
}

function scoreSentence(unedited, counted, window = SCORE_WINDOW) {
  if (!counted) return 'Approved without edits: no decisions recorded yet.';
  if (counted < window) return `Approved without edits, last ${counted} (all there are so far): ${unedited} of ${counted}.`;
  return `Approved without edits, last ${window}: ${unedited} of ${window}.`;
}

async function readScore(channel, scope) {
  const res = await feedbackStore.listFeedback(channel, SCORE_WINDOW, scope);
  if (!res.ok) return res;
  return { ok: true, status: 200, data: scoreFrom(res.data) };
}

/**
 * What the Learn stage shows for `channel`: its lessons and the all-channel
 * ones, and the score. Each read is reported on its own — a score that could
 * not be read does not hide the lessons.
 */
async function learnView(channel, scope = null) {
  if (!CHANNELS.includes(channel)) return refuse(`channel must be one of ${CHANNELS.join(', ')} — got ${JSON.stringify(channel)}`);
  const lessons = await listLessons(channel, scope);
  if (!lessons.ok) return lessons;
  const score = await readScore(channel, scope);
  return {
    ok: true,
    status: 200,
    data: {
      channel,
      lessons: lessons.data,
      score: score.ok ? score.data : null,
      scoreError: score.ok ? '' : `The score could not be read: ${score.error}`,
    },
  };
}

// ── Suggesting lessons ─────────────────────────────────────────────────────

const ACTION_WORDS = Object.freeze({
  rejected: 'REJECTED',
  'approved-as-is': 'APPROVED as written',
  'approved-edited': 'APPROVED after Dane edited it',
  'chose-option': 'APPROVED — Dane picked this option and left it as written',
});

/** One decision as the model sees it, under its label. */
function describeFeedback(label, row) {
  const lines = [`[${label}] ${CHANNEL_WORDS[row.channel] || row.channel}, ${ACTION_WORDS[row.action] || row.action}`];
  if (row.action === 'rejected') {
    lines.push(`  reasons: ${row.reasons.length ? row.reasons.map((r) => `"${r}"`).join(', ') : 'none given'}`);
  }
  if (row.note) lines.push(`  his note: ${safeText(row.note, 500)}`);
  if (row.draftText) lines.push(`  the draft: ${safeText(row.draftText, 700)}`);
  if (row.action === 'approved-edited' && row.finalText) lines.push(`  his version: ${safeText(row.finalText, 700)}`);
  return lines.join('\n');
}

/**
 * The system message and prompt for one refresh. Pure — tested directly.
 * `rows` are feedback (newest first); `kept` are the lessons a refresh will
 * not replace, so the model does not repeat them.
 */
function buildSuggestPrompt({ channel, rows, kept }) {
  const where = channel === 'all' ? 'on every channel' : `on ${CHANNEL_WORDS[channel]}`;
  const system = [
    'You read the decisions Dane made about drafts written for him (comments and replies he posts as himself), and turn them into short lessons for whoever writes his next drafts.',
    'A lesson is ONE plain sentence of everyday words, an instruction a writer can follow: "Never open with a compliment.", "Shorter on Reddit: two sentences."',
    'No jargon, no hedging, no explanation. Only what the decisions actually show — never invent a preference.',
    'Every lesson must name the decisions it comes from by their labels (F1, F2, …). A lesson with no decisions behind it is thrown away.',
    `At most ${MAX_SUGGESTED} lessons, the clearest patterns first. Fewer is fine; none is fine when nothing repeats.`,
    'Reply with JSON only, exactly {"lessons": [{"text": "<the lesson>", "from": ["F1", "F4"]}]}.',
  ].join('\n');
  const lines = [`Dane's recent decisions ${where}, newest first:`, ''];
  rows.forEach((row, i) => lines.push(describeFeedback(`F${i + 1}`, row)));
  const keptOn = kept.filter((l) => l.enabled);
  const keptOff = kept.filter((l) => !l.enabled);
  if (keptOn.length) {
    lines.push('', 'Lessons already in place (do not repeat them):', ...keptOn.map((l) => `- ${l.text}`));
  }
  if (keptOff.length) {
    lines.push('', 'Lessons Dane switched OFF (do not suggest these again, in any wording):', ...keptOff.map((l) => `- ${l.text}`));
  }
  return { system, prompt: lines.join('\n') };
}

function parseSuggestions(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.lessons) ? parsed.lessons : null;
  } catch {
    return null;
  }
}

/**
 * "from 4 rejections tagged "too salesy"", "from 3 rejections (2 tagged "too
 * long") and 2 edits" — written from the cited rows, never by the model.
 */
function whyText(rows) {
  const parts = [];
  const rejected = rows.filter((r) => r.action === 'rejected');
  if (rejected.length) {
    const tally = new Map();
    for (const r of rejected) {
      for (const tag of new Set(r.reasons.map((t) => feedbackStore.reasonKey(t)))) {
        const hit = tally.get(tag);
        if (hit) hit.count += 1;
        else tally.set(tag, { tag: r.reasons.find((t) => feedbackStore.reasonKey(t) === tag), count: 1 });
      }
    }
    const top = [...tally.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))[0];
    let words = plural(rejected.length, 'rejection');
    if (top && top.count === rejected.length) words += ` tagged "${top.tag}"`;
    else if (top) words += ` (${top.count} tagged "${top.tag}")`;
    parts.push(words);
  }
  const edited = rows.filter((r) => r.action === 'approved-edited').length;
  if (edited) parts.push(plural(edited, 'edit'));
  const unedited = rows.filter((r) => UNEDITED.includes(r.action)).length;
  if (unedited) parts.push(plural(unedited, 'approval without edits', 'approvals without edits'));
  return `from ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}`;
}

/**
 * The model's suggestions, checked: one line each, citing at least one
 * decision it was shown, and not the same words as a lesson that stays.
 * Returns { kept: [{ text, rows }], dropped: [{ text, reason }] }. Pure.
 */
function checkSuggestions(suggestions, rows, kept) {
  const byLabel = new Map(rows.map((row, i) => [`F${i + 1}`, row]));
  const taken = new Set(kept.map((l) => lessonKey(l.text)));
  const out = { kept: [], dropped: [] };
  for (const s of (Array.isArray(suggestions) ? suggestions : []).slice(0, MAX_SUGGESTED * 2)) {
    const raw = typeof s?.text === 'string' ? s.text : '';
    const checked = checkLessonText(raw);
    if (!checked.ok) {
      out.dropped.push({ text: cleanLesson(raw), reason: checked.error });
      continue;
    }
    const labels = [...new Set((Array.isArray(s.from) ? s.from : []).map((l) => String(l).trim().toUpperCase()))];
    const cited = labels.map((l) => byLabel.get(l)).filter(Boolean);
    if (!cited.length) {
      out.dropped.push({ text: checked.text, reason: 'it named none of the decisions it was shown' });
      continue;
    }
    const key = lessonKey(checked.text);
    if (taken.has(key)) {
      out.dropped.push({ text: checked.text, reason: 'it is already a lesson, or one you switched off' });
      continue;
    }
    taken.add(key);
    out.kept.push({ text: checked.text, rows: cited });
    if (out.kept.length >= MAX_SUGGESTED) break;
  }
  return out;
}

function defaultGenerate(scope) {
  return (system, prompt) => require('./aiClient').queryAnthropic(system, prompt, { feature: 'outreach-lessons', scope });
}

/**
 * Suggest lessons for `channel` ('all' reads every channel's decisions) from
 * its recent feedback, and put them in place of the suggested lessons he has
 * left alone and left on. Returns `{ added, replaced, dropped, lessons }`,
 * or a refusal — in which case nothing was changed.
 */
async function refreshLessons(channel, scope = null, options = {}) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  if (!LESSON_CHANNELS.includes(channel)) return refuse(`channel must be one of ${LESSON_CHANNELS.join(', ')} — got ${JSON.stringify(channel)}`);

  const feedback = await feedbackStore.listFeedback(channel === 'all' ? null : channel, FEEDBACK_WINDOW, scope);
  if (!feedback.ok) return feedback;
  const rows = feedback.data;
  if (!rows.length) {
    return refuse(`No decisions have been recorded ${channel === 'all' ? 'on any channel' : `on ${CHANNEL_WORDS[channel]}`} yet, so there is nothing to learn from. Approve or reject a few drafts first.`, 409);
  }

  const current = await sbQuery({
    table: table(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&channel=eq.${encodeURIComponent(channel)}&select=*&limit=${LIST_LIMIT}`,
  });
  if (!current.ok) return explainMissingTable(refuse(`The lessons could not be read: ${current.error}`, current.status || 502));
  const existing = (Array.isArray(current.data) ? current.data : []).map(rowToLesson);
  const replaceable = existing.filter((l) => l.source === 'suggested' && !l.edited && l.enabled);
  const kept = existing.filter((l) => !replaceable.includes(l));

  const generate = typeof options.generate === 'function' ? options.generate : defaultGenerate(scope);
  const { system, prompt } = buildSuggestPrompt({ channel, rows, kept });
  const reply = await generate(system, prompt);
  if (!reply?.ok) return refuse(`The AI did not suggest any lessons: ${safeText(reply?.error, 300) || 'no answer'}. Nothing was changed.`, 502);
  const suggestions = parseSuggestions(reply.text);
  if (!suggestions) return refuse('The AI\'s answer could not be read as a list of lessons. Nothing was changed — click Refresh lessons to try again.', 502);

  const checked = checkSuggestions(suggestions, rows, kept);
  if (!checked.kept.length) {
    return {
      ok: true,
      status: 200,
      data: { added: 0, replaced: 0, dropped: checked.dropped, lessons: existing, note: 'No new lessons — nothing in the recent decisions repeats clearly enough. The lessons you had are unchanged.' },
    };
  }

  // Replace the old suggestions only once the new ones are in hand.
  if (replaceable.length) {
    const ids = replaceable.map((l) => l.id).join(',');
    const del = await sbQuery({
      method: 'DELETE',
      table: table(),
      query: `project_id=eq.${encodeURIComponent(s.projectId)}&id=in.(${ids})&select=id`,
      headers: { Prefer: 'return=representation' },
    });
    if (!del.ok) return explainMissingTable(refuse(`The old suggestions could not be replaced: ${del.error}. Nothing was changed.`, del.status || 502));
  }
  const inserted = await insertRows(checked.kept.map((k) => ({
    channel,
    text: k.text,
    enabled: true,
    source: 'suggested',
    edited: false,
    why: whyText(k.rows),
    evidence: k.rows.map((r) => ({ feedbackId: r.id, action: r.action, reasons: r.reasons, note: r.note, createdAt: r.createdAt })),
  })), s);
  if (!inserted.ok) {
    return { ...inserted, error: `${inserted.error} The ${plural(replaceable.length, 'old suggestion')} had already been removed; click Refresh lessons to try again.` };
  }
  return {
    ok: true,
    status: 200,
    data: { added: inserted.data.length, replaced: replaceable.length, dropped: checked.dropped, lessons: [...kept, ...inserted.data] },
  };
}

/**
 * After a decision on `channel` is recorded: refresh its lessons when it was
 * the fifth, tenth, … decision there. Returns null when not due, else
 * `{ refreshed, added, error }`. Never throws for a failed read or AI call.
 */
async function refreshIfDue(channel, scope = null, options = {}) {
  if (!CHANNELS.includes(channel)) return null;
  const s = scopeOrError(scope);
  if (s.error) return null;
  const count = await sbQuery({
    table: tableConfig().outreachFeedback || 'outreach_feedback',
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&channel=eq.${encodeURIComponent(channel)}&select=id&limit=1000`,
  });
  if (!count.ok) return { refreshed: false, added: 0, error: `Whether the lessons were due a refresh could not be read: ${count.error}` };
  const n = Array.isArray(count.data) ? count.data.length : 0;
  if (!n || n % REFRESH_EVERY !== 0) return null;
  const res = await refreshLessons(channel, scope, options);
  if (!res.ok) return { refreshed: false, added: 0, error: `The lessons were not refreshed: ${res.error}` };
  return { refreshed: true, added: res.data.added, error: '' };
}

module.exports = {
  LESSON_CHANNELS,
  MAX_LESSON_LENGTH,
  REFRESH_EVERY,
  SCORE_WINDOW,
  SETUP_SQL,
  explainMissingLessonsColumn,
  lessonKey,
  listLessons,
  lessonsForDraft,
  lessonsUsed,
  lessonPromptLines,
  createLesson,
  updateLesson,
  deleteLesson,
  scoreFrom,
  learnView,
  buildSuggestPrompt,
  checkSuggestions,
  whyText,
  refreshLessons,
  refreshIfDue,
};
