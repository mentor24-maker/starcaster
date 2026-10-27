'use strict';

/**
 * Which account each outreach channel posts as (Outreach wizard 2/19, task
 * 86bcrmba0). THE one place it is read and written, for YouTube, Substack and
 * Reddit alike — by the Outreach screen's Connect stage (routes/outreach.js)
 * and by the Mini's posting worker (workers/youtube-outreach/).
 *
 * Before this the names were constants in lib/openclawSignIn.js: Substack
 * expected "Dane of Earth" while the Mini was signed in as "Dane Christensen",
 * and Reddit's was blank, so Reddit refused to post at all. Now each lives on
 * the channel's settings row (docs/SQL/outreach_expected_account.sql):
 *
 *   expectedAccount   the account Dane CONFIRMED. Blank: nothing posts on that
 *                     channel, and every approved item says so. The constants
 *                     are not a stand-in for a confirmation.
 *   compareWith       what the hourly sign-in check compares the browser with:
 *                     the confirmed account, or — until there is one — the old
 *                     constant, kept only as a first-run default so the check
 *                     still says something useful before he has chosen.
 *   observedAccount   who the Mini last saw signed in. The screen offers it:
 *                     "The Mini is signed in to Substack as Dane Christensen."
 *   checkRequestedAt  the screen's "Check now", waiting for the worker.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10).
 * Writes name both tenant columns explicitly rather than through
 * scopedInsertRow (landmine 12), and there is no fallback anywhere — a refusal
 * is returned as-is (landmine 15).
 */

const { sbQuery, tableConfig } = require('./supabase');
const signIn = require('./openclawSignIn');
const { REDDIT_PACE } = require('./redditPace');

const DEFAULT_ACCOUNT_KEY = 'dane_of_earth';
const ACCOUNT_KEY_RE = /^[a-z0-9_-]{1,60}$/;
const MAX_ACCOUNT_LENGTH = 200;

/** The settings table each channel's account lives on. */
const SITES = Object.freeze({
  youtube: { label: 'YouTube', table: () => tableConfig().youtubeOutreachSettings || 'youtube_outreach_settings' },
  substack: { label: 'Substack', table: () => tableConfig().substackNotesSettings || 'substack_notes_settings' },
  reddit: { label: 'Reddit', table: () => tableConfig().redditCommentSettings || 'reddit_comment_settings' },
});

/** Reddit's pace, as the Outreach screen may set it. */
const PACE_LIMITS = Object.freeze({
  maxCommentsPerDay: { min: 1, max: 50, column: 'max_comments_per_day' },
  minMinutesBetween: { min: 0, max: 1440, column: 'min_minutes_between' },
});

function text(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function siteOrError(site) {
  if (SITES[site]) return { ok: true, value: site };
  return refuse(`Unknown channel "${site}". Known: ${Object.keys(SITES).join(', ')}.`);
}

function accountKeyOrError(value) {
  const key = text(value, 80) || DEFAULT_ACCOUNT_KEY;
  if (!ACCOUNT_KEY_RE.test(key)) return refuse(`accountKey "${key}" is not valid — use lowercase letters, numbers, dashes or underscores`);
  return { ok: true, value: key };
}

/** An account name as the channel spells it: Reddit's without "u/". */
function tidyAccount(site, value) {
  const name = text(value, MAX_ACCOUNT_LENGTH);
  return site === 'reddit' ? signIn.redditUsername(name) : name;
}

/** The constant from before this ticket — a first-run default, never a confirmation. */
function defaultAccountFor(site) {
  return tidyAccount(site, signIn.SITES[site]?.expected);
}

/** Reddit's pace from its row: the saved numbers, or the plain defaults. */
function paceFromRow(row) {
  const pick = (value, fallback) => (Number.isInteger(value) ? value : fallback);
  return {
    maxCommentsPerDay: pick(row?.max_comments_per_day, REDDIT_PACE.maxCommentsPerDay),
    minMinutesBetween: pick(row?.min_minutes_between, REDDIT_PACE.minMinutesBetween),
    jitterMinutes: REDDIT_PACE.jitterMinutes,
  };
}

/** One settings row, as the screen and the worker read it. Pure. */
function rowToAccount(site, row, accountKey = DEFAULT_ACCOUNT_KEY) {
  const expectedAccount = tidyAccount(site, row?.expected_account);
  const out = {
    site,
    accountKey: text(row?.account_key, 80) || accountKey,
    expectedAccount,
    confirmedAt: row?.expected_account_confirmed_at || null,
    defaultAccount: defaultAccountFor(site),
    compareWith: expectedAccount || defaultAccountFor(site),
    observedAccount: tidyAccount(site, row?.browser_account),
    checkRequestedAt: row?.check_requested_at || null,
    browserState: text(row?.browser_state, 40),
    browserCheckedAt: row?.browser_checked_at || null,
  };
  if (site === 'reddit') out.pace = paceFromRow(row);
  return out;
}

async function readRow(site, projectId, accountKey) {
  const res = await sbQuery({
    method: 'GET',
    table: SITES[site].table(),
    query: `project_id=eq.${encodeURIComponent(projectId)}&account_key=eq.${encodeURIComponent(accountKey)}&select=*&limit=1`,
  });
  if (!res.ok) return refuse(`Could not read the ${SITES[site].label} account settings: ${res.error}`, res.status || 502);
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: found || null };
}

/**
 * The worker's read: by project alone, because the worker acts for a project,
 * not for a signed-in person. A project with no row yet reads as "nobody has
 * chosen", which holds every post.
 */
async function readAccountForWorker(site, projectId, accountKey = DEFAULT_ACCOUNT_KEY) {
  const s = siteOrError(site);
  if (!s.ok) return s;
  const project = text(projectId, 120);
  if (!project) return refuse('No project was given, so there is no account to read.');
  const key = accountKeyOrError(accountKey);
  if (!key.ok) return key;
  const found = await readRow(site, project, key.value);
  if (!found.ok) return found;
  return { ok: true, status: 200, data: rowToAccount(site, found.data, key.value) };
}

function scopeOrError(scope) {
  const projectId = text(scope?.projectId || scope?.project_id, 120);
  const userId = text(scope?.userId || scope?.user_id, 120);
  if (!projectId) return { error: refuse('No project is selected, so there is no account to read or change.') };
  if (!userId) return { error: refuse('No signed-in user was given — both tenant columns are required to save an account.') };
  return { projectId, userId };
}

/** The screen's read. */
async function getAccount(site, scope = null, options = {}) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  return readAccountForWorker(site, s.projectId, options.accountKey);
}

/**
 * Patch the row when it exists, create it when it does not. A first insert
 * racing another is retried once as a patch (the unique index makes the race a
 * 409).
 */
async function writeColumns(site, scope, accountKey, columns, attempt = 0) {
  const label = SITES[site].label;
  const existing = await readRow(site, scope.projectId, accountKey);
  if (!existing.ok) return existing;
  const body = { ...columns, updated_at: new Date().toISOString() };
  let res;
  if (existing.data) {
    res = await sbQuery({
      method: 'PATCH',
      table: SITES[site].table(),
      query: `id=eq.${encodeURIComponent(existing.data.id)}&project_id=eq.${encodeURIComponent(scope.projectId)}&select=*`,
      headers: { Prefer: 'return=representation' },
      body,
    });
  } else {
    res = await sbQuery({
      method: 'POST',
      table: SITES[site].table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [{ project_id: scope.projectId, owner_user_id: scope.userId, account_key: accountKey, ...body }],
    });
    if (!res.ok && res.status === 409 && attempt === 0) return writeColumns(site, scope, accountKey, columns, attempt + 1);
  }
  if (!res.ok) return refuse(`The ${label} account settings were not saved: ${res.error}`, res.status || 502);
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) return refuse(`The ${label} account settings were not saved — the database returned no row.`, 500);
  return { ok: true, status: 200, data: rowToAccount(site, saved, accountKey) };
}

async function prepare(site, scope, options) {
  const s = siteOrError(site);
  if (!s.ok) return { error: s };
  const sc = scopeOrError(scope);
  if (sc.error) return { error: sc.error };
  const key = accountKeyOrError(options?.accountKey);
  if (!key.ok) return { error: key };
  return { scope: sc, accountKey: key.value };
}

/**
 * Dane names the account this channel posts as — the one the Mini is signed in
 * as ("Post as this account"), or another one he is about to sign in as.
 */
async function chooseAccount(site, account, scope = null, options = {}) {
  const p = await prepare(site, scope, options);
  if (p.error) return p.error;
  const name = tidyAccount(site, account);
  if (!name) return refuse(`Name the ${SITES[site].label} account to post as.`);
  return writeColumns(site, p.scope, p.accountKey, {
    expected_account: name,
    expected_account_confirmed_at: new Date().toISOString(),
  });
}

/** "Check now": leave a request the worker picks up on its next pass. */
async function requestCheck(site, scope = null, options = {}) {
  const p = await prepare(site, scope, options);
  if (p.error) return p.error;
  return writeColumns(site, p.scope, p.accountKey, { check_requested_at: new Date().toISOString() });
}

/** Reddit's pace. Each number is whole and inside PACE_LIMITS. */
async function saveRedditPace(input, scope = null, options = {}) {
  const p = await prepare('reddit', scope, options);
  if (p.error) return p.error;
  const columns = {};
  for (const [field, rule] of Object.entries(PACE_LIMITS)) {
    if (input?.[field] === undefined) continue;
    const n = Number(input[field]);
    if (!Number.isInteger(n) || n < rule.min || n > rule.max) {
      return refuse(`${field} must be a whole number from ${rule.min} to ${rule.max}.`);
    }
    columns[rule.column] = n;
  }
  if (!Object.keys(columns).length) return refuse('Nothing to save: send maxCommentsPerDay and/or minMinutesBetween.');
  return writeColumns('reddit', p.scope, p.accountKey, columns);
}

/**
 * Has the screen asked for a check since `sinceMs`? The worker asks this every
 * pass. A site whose row cannot be read says no — the hourly check still runs.
 */
async function checkRequestedSince(projectIds, sinceMs) {
  for (const [site, projectId] of Object.entries(projectIds || {})) {
    if (!projectId) continue;
    const res = await readAccountForWorker(site, projectId);
    if (!res.ok) continue;
    const at = Date.parse(res.data.checkRequestedAt || '');
    if (Number.isFinite(at) && at > sinceMs) return true;
  }
  return false;
}

module.exports = {
  SITES,
  DEFAULT_ACCOUNT_KEY,
  PACE_LIMITS,
  tidyAccount,
  defaultAccountFor,
  paceFromRow,
  rowToAccount,
  readAccountForWorker,
  getAccount,
  chooseAccount,
  requestCheck,
  saveRedditPace,
  checkRequestedSince,
};
