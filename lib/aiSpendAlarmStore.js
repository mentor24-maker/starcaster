'use strict';

/**
 * The spending alarm's one row (AI Quota 4/5, task 86bcvj7zm) — its two
 * settings and its memory between scheduled runs. Table: docs/SQL/ai_spend_alarm_setup.sql.
 *
 * One row for the whole account, because the bill it guards is the whole
 * account's. Every store here returns `{ ok, status, data }` / `{ ok: false,
 * error }`, never the row (CLAUDE.md landmine 12).
 *
 * No fallback anywhere: when the database refuses, the caller hears it refused
 * (landmine 15). A local file would vanish on Vercel and report success.
 */

const ROW_ID = 'account';
const DEFAULTS = Object.freeze({ dailyLimitUsd: 5, spikeMultiple: 3, miniDailyRequests: 40 });
/** The Mini's background-AI limit (AI Quota 5/5, lib/miniAiLimit.js). */
const MINI_REQUESTS_MAX = 10000;
const LIMIT_MAX_USD = 10000;
const MULTIPLE_MAX = 100;

/** Which column remembers when each kind of alert last went out. */
const STAMP_COLUMN = Object.freeze({
  'over-limit': 'over_limit_alarm_at',
  spike: 'spike_alarm_at',
  unreadable: 'unreadable_alarm_at',
});

function sbQuery(req) {
  return require('./supabase').sbQuery(req);
}
function table() {
  return require('./supabase').tableConfig().aiSpendAlarm;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A saved request limit, or the default. Zero is a real setting: no background AI at all. */
function miniLimit(value) {
  if (value === null || value === undefined || value === '') return DEFAULTS.miniDailyRequests;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULTS.miniDailyRequests;
}

/** A row (or no row yet) as the settings and stamps the alarm works with. */
function normaliseRow(row) {
  const r = row && typeof row === 'object' ? row : {};
  return {
    exists: Boolean(row),
    dailyLimitUsd: positive(r.daily_limit_usd) ?? DEFAULTS.dailyLimitUsd,
    spikeMultiple: Math.max(1, positive(r.spike_multiple) ?? DEFAULTS.spikeMultiple),
    alertEmail: String(r.alert_email || '').trim(),
    miniDailyRequests: miniLimit(r.mini_daily_requests),
    miniLimitPostedDay: String(r.mini_limit_posted_day || ''),
    stamps: Object.fromEntries(Object.entries(STAMP_COLUMN).map(([kind, col]) => [kind, r[col] || null])),
    lastCheckAt: r.last_check_at || null,
    lastCheck: r.last_check && typeof r.last_check === 'object' ? r.last_check : {},
    updatedAt: r.updated_at || null,
  };
}

/**
 * Check what the settings form sent. Refuses rather than clamps: a limit the
 * page silently rewrote is a limit Dane did not set.
 */
function validateSettingsInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const limit = Number(b.dailyLimitUsd);
  if (!Number.isFinite(limit) || limit <= 0 || limit > LIMIT_MAX_USD) {
    return { ok: false, error: `Daily limit must be a dollar amount above $0 and at most $${LIMIT_MAX_USD}.` };
  }
  const multiple = Number(b.spikeMultiple);
  if (!Number.isFinite(multiple) || multiple < 1 || multiple > MULTIPLE_MAX) {
    return { ok: false, error: `Spike multiple must be a number from 1 to ${MULTIPLE_MAX} (3 means "three times a normal day").` };
  }
  const email = String(b.alertEmail ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: `"${email}" is not an email address.` };
  }
  const data = { dailyLimitUsd: limit, spikeMultiple: multiple, alertEmail: email };
  // Optional, so a form that does not carry it leaves the saved limit alone.
  if (b.miniDailyRequests !== undefined && b.miniDailyRequests !== null && b.miniDailyRequests !== '') {
    const requests = Number(b.miniDailyRequests);
    if (!Number.isInteger(requests) || requests < 0 || requests > MINI_REQUESTS_MAX) {
      return { ok: false, error: `The Mini's daily AI limit must be a whole number of requests from 0 to ${MINI_REQUESTS_MAX}.` };
    }
    data.miniDailyRequests = requests;
  }
  return { ok: true, data };
}

async function readAlarm() {
  const res = await sbQuery({ method: 'GET', table: table(), query: `select=*&id=eq.${ROW_ID}&limit=1` });
  if (!res.ok) {
    return { ok: false, status: res.status || 500, error: `The spending alarm's settings could not be read: ${res.error?.message || res.error || `HTTP ${res.status}`}` };
  }
  const row = Array.isArray(res.data) ? res.data[0] : null;
  return { ok: true, status: 200, data: normaliseRow(row) };
}

/** Insert-or-merge the one row. Only the columns in `fields` change. */
async function upsertAlarm(fields) {
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'on_conflict=id',
    // Without this header the second write is a 409, not an update (landmine 15).
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: { id: ROW_ID, ...fields, updated_at: new Date().toISOString() },
  });
  if (!res.ok) {
    return { ok: false, status: res.status || 500, error: `The spending alarm could not be saved: ${res.error?.message || res.error || `HTTP ${res.status}`}` };
  }
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 500, error: 'The spending alarm save returned no row, so it cannot be confirmed.' };
  return { ok: true, status: 200, data: normaliseRow(row) };
}

/** Save Dane's settings, stamping who saved them and from which project. */
async function saveSettings(input, scope) {
  return upsertAlarm({
    project_id: String(scope?.projectId || '').trim() || null,
    owner_user_id: String(scope?.userId || '').trim() || null,
    daily_limit_usd: input.dailyLimitUsd,
    spike_multiple: input.spikeMultiple,
    alert_email: input.alertEmail,
    ...(input.miniDailyRequests !== undefined ? { mini_daily_requests: input.miniDailyRequests } : {}),
  });
}

/**
 * Claim today's "Mini AI limit reached" bus line (AI Quota 5/5). Atomic: the
 * write only matches while the row does not already name `day`, so of the
 * Mini's three processes reaching the limit together exactly one gets a row
 * back and posts. `data` is true when this caller won the claim.
 */
async function claimMiniLimitPost(day) {
  const read = await readAlarm();
  if (!read.ok) return read;
  if (!read.data.exists) {
    // No saved row yet: create it with the defaults, so there is a row to claim on.
    const made = await upsertAlarm({});
    if (!made.ok) return made;
  }
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${ROW_ID}&or=(mini_limit_posted_day.is.null,mini_limit_posted_day.neq.${encodeURIComponent(day)})`,
    headers: { Prefer: 'return=representation' },
    body: { mini_limit_posted_day: day },
  });
  if (!res.ok) {
    return { ok: false, status: res.status || 500, error: `Today's limit line could not be claimed: ${res.error?.message || res.error || `HTTP ${res.status}`}` };
  }
  return { ok: true, status: 200, data: Array.isArray(res.data) && res.data.length > 0 };
}

/** Give the day back after a bus line that was not delivered, so the next refusal tries again. */
async function releaseMiniLimitPost(day) {
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${ROW_ID}&mini_limit_posted_day=eq.${encodeURIComponent(day)}`,
    body: { mini_limit_posted_day: null },
  });
  return res.ok ? { ok: true, status: 200, data: true } : { ok: false, status: res.status || 500, error: String(res.error?.message || res.error || '') };
}

/** Record a scheduled run: the stamps that changed and what it saw. */
async function writeCheck({ stamps = {}, lastCheck, at }) {
  const fields = { last_check_at: at, last_check: lastCheck || {} };
  for (const [kind, value] of Object.entries(stamps)) {
    if (STAMP_COLUMN[kind]) fields[STAMP_COLUMN[kind]] = value;
  }
  return upsertAlarm(fields);
}

module.exports = {
  ROW_ID,
  DEFAULTS,
  MINI_REQUESTS_MAX,
  STAMP_COLUMN,
  normaliseRow,
  validateSettingsInput,
  readAlarm,
  saveSettings,
  writeCheck,
  claimMiniLimitPost,
  releaseMiniLimitPost,
};
