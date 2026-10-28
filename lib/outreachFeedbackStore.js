'use strict';

/**
 * Why Dane rejected a draft, and what he did with one he approved — on every
 * outreach channel (Outreach wizard 12/19, task 86bcrmbnw). One row per
 * decision in `outreach_feedback` (docs/SQL/outreach_feedback_setup.sql).
 * The reason picker offers the reasons he has used before, and slice 13
 * (lib/outreachLessons.js, task 86bcrmbpm) turns the rows into lessons the
 * drafters read — `listFeedback` is its reader, and `attachFeedback` asks it
 * to refresh after every fifth decision on a channel.
 *
 * The three channel stores call this AFTER their own decision has been
 * written: the decision is the thing he asked for, so a feedback write that
 * fails never undoes it. It is reported instead — the store puts
 * `feedback: { recorded, error }` on the decided item and the screen says
 * "the reason was not saved", naming why. A feedback row that did not land is
 * never reported as saved (landmine 15).
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10).
 *
 * TENANCY FAILS CLOSED, the way lib/redditCommentsStore.js does it: both
 * tenant columns are written explicitly from the scope rather than through
 * scopedInsertRow, whose column probe can quietly stamp neither (landmine 12),
 * and every read filters on project_id itself.
 *
 * THE DATABASE IS THE ONLY STORE. No local-file fallback (landmines 6, 15).
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

const CHANNELS = Object.freeze(['youtube', 'substack', 'reddit']);
const ACTIONS = Object.freeze(['rejected', 'approved-as-is', 'approved-edited', 'chose-option']);

/** The chips every Reject offers, before any of his own. */
const DEFAULT_REASONS = Object.freeze(['too salesy', 'not my voice', 'misses the point', 'too long', 'too generic']);

const MAX_REASON_LENGTH = 80;
const MAX_REASONS = 10;
const MAX_NOTE_LENGTH = 1000;
const MAX_TEXT_LENGTH = 20000;
/** How many past rejections the picker counts its saved reasons over. */
const REASON_HISTORY_LIMIT = 500;

const SETUP_SQL = 'docs/SQL/outreach_feedback_setup.sql';

function table() {
  return tableConfig().outreachFeedback || 'outreach_feedback';
}

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function refuse(error, status = 400, extra = {}) {
  return { ok: false, status, error, ...extra };
}

function scopeOrError(scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  const userId = safeText(scope?.userId || scope?.user_id, 120);
  if (!projectId) return { error: refuse('No project is selected, so there is no outreach feedback to read or save.') };
  if (!userId) return { error: refuse('No signed-in user was given — both tenant columns are required for outreach feedback.') };
  return { projectId, userId };
}

/** Trimmed, inner spaces collapsed — the spelling that is saved. */
function cleanReason(reason) {
  return String(reason || '').trim().replace(/\s+/g, ' ');
}

/** The same reason whatever its case and spacing ("Too salesy " and "too salesy"). */
function reasonKey(reason) {
  return cleanReason(reason).toLowerCase();
}

/** A missing table reads as a sentence naming the file to run, not a PostgREST code. */
function explainMissingTable(result) {
  if (result.ok) return result;
  const text = String(result.error || '');
  if (!/outreach_feedback|PGRST205|42P01|does not exist/i.test(text)) return result;
  return refuse(`${text} — this database does not have the outreach feedback table yet; run ${SETUP_SQL}.`, result.status || 500, { code: 'SQL_NOT_RUN' });
}

/**
 * Read a Reject's body: `{ reasons, note }`, both optional. No reasons is
 * Skip — recorded as "no reason given". Checked BEFORE the reject is written,
 * so a bad body changes nothing.
 */
function readRejectInput(input) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const unknown = unknownKeyError(body, ['reasons', 'note']);
  if (unknown) return unknown;
  const rawReasons = body.reasons === undefined || body.reasons === null ? [] : body.reasons;
  if (!Array.isArray(rawReasons) || rawReasons.some((r) => typeof r !== 'string')) {
    return refuse('reasons must be a list of short reasons, like ["too salesy"]');
  }
  const reasons = [];
  for (const raw of rawReasons) {
    const reason = cleanReason(raw);
    if (!reason) continue;
    if (reason.length > MAX_REASON_LENGTH) {
      return refuse(`A reason is a few words (${MAX_REASON_LENGTH} characters at most) — "${reason.slice(0, 40)}…" is longer. The sentence goes in the note.`);
    }
    if (!reasons.some((r) => reasonKey(r) === reasonKey(reason))) reasons.push(reason);
  }
  if (reasons.length > MAX_REASONS) return refuse(`At most ${MAX_REASONS} reasons — ${reasons.length} were sent.`);
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') return refuse('note must be a sentence');
  const note = String(body.note || '').trim();
  if (note.length > MAX_NOTE_LENGTH) return refuse(`The note is ${note.length} characters; ${MAX_NOTE_LENGTH} at most.`);
  return { ok: true, status: 200, data: { reasons, note } };
}

/**
 * What an approval says about the draft: his own words, the draft's, or one
 * of the options unchanged. `shown` is the text he started from (the picked
 * option's, or the draft's); `picked` is the option's index or null.
 */
function approvalAction({ shown, finalText, picked }) {
  const same = String(shown || '').trim() === String(finalText || '').trim();
  if (!same) return 'approved-edited';
  return picked === null || picked === undefined ? 'approved-as-is' : 'chose-option';
}

/**
 * Save one decision. `entry`: channel, itemId, itemKind, action, reasons,
 * note, draftText, finalText, chosenOption.
 */
async function recordFeedback(entry, scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const e = entry || {};
  if (!CHANNELS.includes(e.channel)) return refuse(`channel must be one of ${CHANNELS.join(', ')} — got ${JSON.stringify(e.channel)}`);
  if (!ACTIONS.includes(e.action)) return refuse(`action must be one of ${ACTIONS.join(', ')} — got ${JSON.stringify(e.action)}`);
  const itemId = safeText(e.itemId, 120);
  if (!itemId) return refuse('itemId is required — which draft was decided?');
  const chosen = Number.isInteger(e.chosenOption) ? e.chosenOption : null;
  const row = {
    project_id: s.projectId,
    owner_user_id: s.userId,
    channel: e.channel,
    item_id: itemId,
    item_kind: safeText(e.itemKind, 40),
    action: e.action,
    reason_tags: (Array.isArray(e.reasons) ? e.reasons : []).map(cleanReason).filter(Boolean).slice(0, MAX_REASONS),
    note: safeText(e.note, MAX_NOTE_LENGTH),
    draft_text: safeText(e.draftText, MAX_TEXT_LENGTH),
    final_text: safeText(e.finalText, MAX_TEXT_LENGTH),
    chosen_option: chosen,
    created_at: new Date().toISOString(),
  };
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return explainMissingTable(refuse(`The reason was not saved: ${res.error}`, res.status || 502));
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!created) return refuse('The reason was not saved — the database returned no row.', 500);
  return { ok: true, status: 201, data: rowToFeedback(created) };
}

function rowToFeedback(row) {
  const tags = Array.isArray(row.reason_tags) ? row.reason_tags : [];
  return {
    id: row.id,
    channel: row.channel,
    itemId: row.item_id,
    itemKind: row.item_kind || '',
    action: row.action,
    reasons: tags,
    // Skip records a rejection with no reasons; this is the words for it.
    reasonGiven: row.action !== 'rejected' || tags.length > 0 || Boolean(row.note),
    note: row.note || '',
    draftText: row.draft_text || '',
    finalText: row.final_text || '',
    chosenOption: Number.isInteger(row.chosen_option) ? row.chosen_option : null,
    createdAt: row.created_at || null,
  };
}

/**
 * The reasons the picker offers: the five defaults, then every reason he has
 * used on a rejection in this project that is not one of them, most used
 * first, then A–Z. `used` counts the defaults too, so a chip can say "3×".
 */
async function listReasons(scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const res = await sbQuery({
    table: table(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}&action=eq.rejected`
      + `&select=reason_tags&order=created_at.desc&limit=${REASON_HISTORY_LIMIT}`,
  });
  if (!res.ok) return explainMissingTable(refuse(`Your saved reasons could not be read: ${res.error}`, res.status || 502));
  const tally = new Map();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const seen = new Set();
    for (const raw of Array.isArray(row.reason_tags) ? row.reason_tags : []) {
      const key = reasonKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const hit = tally.get(key);
      if (hit) hit.count += 1;
      else tally.set(key, { reason: cleanReason(raw), count: 1 });
    }
  }
  const defaults = DEFAULT_REASONS.map((reason) => ({ reason, count: tally.get(reasonKey(reason))?.count || 0 }));
  const saved = [...tally.entries()]
    .filter(([key]) => !DEFAULT_REASONS.some((d) => reasonKey(d) === key))
    .map(([, value]) => value)
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return { ok: true, status: 200, data: { defaults, saved } };
}

/**
 * The newest decisions, newest first: one channel's, or every channel's when
 * `channel` is null. Slice 13's lessons and score read these.
 */
async function listFeedback(channel, limit = 50, scope = null) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  if (channel !== null && !CHANNELS.includes(channel)) {
    return refuse(`channel must be one of ${CHANNELS.join(', ')} — got ${JSON.stringify(channel)}`);
  }
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 50;
  const res = await sbQuery({
    table: table(),
    query: `project_id=eq.${encodeURIComponent(s.projectId)}`
      + (channel ? `&channel=eq.${encodeURIComponent(channel)}` : '')
      + `&select=*&order=created_at.desc&limit=${n}`,
  });
  if (!res.ok) return explainMissingTable(refuse(`Your past decisions could not be read: ${res.error}`, res.status || 502));
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToFeedback) };
}

/**
 * Put the feedback write's outcome on a decision that already succeeded. The
 * decision stands either way; `feedback.recorded` says whether WHY landed.
 */
async function attachFeedback(decision, entry, scope) {
  if (!decision || !decision.ok || !decision.data) return decision;
  const saved = await recordFeedback({ ...entry, itemId: entry.itemId || decision.data.id }, scope);
  const feedback = saved.ok ? { recorded: true, error: '' } : { recorded: false, error: saved.error };
  // Every fifth decision on a channel refreshes its lessons (slice 13). The
  // decision already stands and so does its reason; a refresh that fails is
  // reported beside them, never in place of them.
  if (saved.ok) {
    let lessons;
    try {
      lessons = await require('./outreachLessons').refreshIfDue(entry.channel, scope);
    } catch (err) {
      lessons = { refreshed: false, error: `The lessons were not refreshed: ${err?.message || 'unknown error'}` };
    }
    if (lessons) feedback.lessons = lessons;
  }
  return { ...decision, data: { ...decision.data, feedback } };
}

module.exports = {
  CHANNELS,
  ACTIONS,
  DEFAULT_REASONS,
  MAX_REASON_LENGTH,
  SETUP_SQL,
  readRejectInput,
  approvalAction,
  recordFeedback,
  listReasons,
  listFeedback,
  attachFeedback,
  reasonKey,
};
