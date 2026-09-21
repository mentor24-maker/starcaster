'use strict';

/**
 * The Footage screen's view of the Studio catalog (Studio Phase 1 · 8 of 8).
 *
 * Pure: it is handed the session and source rows the stores already returned
 * and decides what the screen shows — which files survive the filters, which
 * session each one sits under, and the order. No database, no clock, so every
 * rule here is a unit test rather than a browser check.
 *
 * THE DATE A FILE IS FILED UNDER. A file's own `recordedAt` comes from its
 * container metadata (5/8) and is the truth when it exists. Before the probe
 * has run it is blank, so the file falls back to its session's date and then
 * to when the catalog first saw it. The fallback is NAMED on every source
 * (`dateSource`) rather than applied quietly: "recorded 14 Sep" and "added to
 * the catalog 14 Sep" are different claims, and the screen says which one it
 * is making.
 *
 * A FILE WITH NO SESSION IS STILL SHOWN. Ingest files everything into a
 * holding session, so a source without one should not happen — which is
 * exactly why it must not vanish if it does. Those land in one group named
 * for what they are, at the end.
 *
 * A file whose session was NOT READ is a different claim, and gets its own
 * group. `video_sources.session_id` cascades on delete, so a session id with
 * no matching session in hand means the session sat outside the rows this
 * request read (past the read ceiling), not that the file has none. Filing
 * those under "Not in a session yet" was a positive false statement that the
 * route's `truncated` flag did not take back (review round 1, 86bbjv68z).
 */

const NO_SESSION_ID = '';
const NO_SESSION_TITLE = 'Not in a session yet';
const UNREAD_SESSION_ID = '?unread';
const UNREAD_SESSION_TITLE = 'Session not loaded — it is older than the sessions this page read';

/** The lane filter's value for files the probe has not given a lane. */
const UNKNOWN_LANE = 'unknown';

function text(value) {
  return String(value === 0 || value ? value : '').trim();
}

/** Epoch milliseconds, or null for a blank or unreadable timestamp. */
function instant(value) {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function laneOf(source) {
  return text(source?.deviceLane).toLowerCase() || UNKNOWN_LANE;
}

/**
 * The date a file is filed under, and which field it came from.
 * @returns {{ at: string, ms: number|null, dateSource: 'recorded'|'session'|'added'|'none' }}
 */
function effectiveDate(source, session) {
  const candidates = [
    ['recorded', source?.recordedAt],
    ['session', session?.recordedAt],
    ['added', source?.createdAt],
  ];
  for (const [dateSource, value] of candidates) {
    const ms = instant(value);
    if (ms !== null) return { at: new Date(ms).toISOString(), ms, dateSource };
  }
  // Unreachable for a stored row: video_sources.created_at is `not null
  // default now()` (docs/SQL/video_studio_setup.sql), so 'added' always
  // answers. Kept as a guard for a row shape the database does not allow,
  // rather than inventing a date for it.
  return { at: '', ms: null, dateSource: 'none' };
}

/**
 * Read the filters off a query string. A date that does not parse is REFUSED,
 * not dropped: a dropped filter shows every file while the screen still reads
 * "filtered", which is a wrong answer that looks like a right one.
 *
 * @returns {{ ok: true, filters: { lane: string, fromMs: number|null, toMs: number|null } }
 *          | { ok: false, error: string }}
 */
function readFilters({ lane, from, to } = {}) {
  const fromMs = instant(from);
  const toMs = instant(to);
  if (text(from) && fromMs === null) return { ok: false, error: `"from" is not a date: ${text(from)}` };
  if (text(to) && toMs === null) return { ok: false, error: `"to" is not a date: ${text(to)}` };
  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    return { ok: false, error: 'The "from" date is after the "to" date, so nothing could match.' };
  }
  return { ok: true, filters: { lane: text(lane).toLowerCase(), fromMs, toMs } };
}

function matches(entry, filters) {
  if (filters.lane && entry.lane !== filters.lane) return false;
  if (filters.fromMs !== null || filters.toMs !== null) {
    // A file with no date at all cannot be placed in a range, so a date filter
    // excludes it. It is still counted in `undated` so the screen can say so.
    if (entry.ms === null) return false;
    if (filters.fromMs !== null && entry.ms < filters.fromMs) return false;
    if (filters.toMs !== null && entry.ms > filters.toMs) return false;
  }
  return true;
}

/**
 * Sessions newest first; the files inside a session in recording order (the
 * order an editor stacks them). A session is dated by its own `recordedAt`,
 * else by its newest file, else by when it was created.
 */
function buildFootage({ sessions = [], sources = [], filters = {} } = {}) {
  const f = {
    lane: text(filters.lane).toLowerCase(),
    fromMs: Number.isFinite(filters.fromMs) ? filters.fromMs : null,
    toMs: Number.isFinite(filters.toMs) ? filters.toMs : null,
  };
  const sessionById = new Map();
  for (const session of sessions) {
    if (session && text(session.id)) sessionById.set(text(session.id), session);
  }

  const laneCounts = new Map();
  const stateCounts = {};
  let newestAddedMs = null;
  let undated = 0;
  const groups = new Map();

  for (const source of sources) {
    if (!source) continue;
    const sessionId = text(source.sessionId);
    const session = sessionById.get(sessionId) || null;
    const lane = laneOf(source);
    const date = effectiveDate(source, session);
    const entry = { source, lane, ...date };

    laneCounts.set(lane, (laneCounts.get(lane) || 0) + 1);
    const state = text(source.state) || 'new';
    stateCounts[state] = (stateCounts[state] || 0) + 1;
    const addedMs = instant(source.createdAt);
    if (addedMs !== null && (newestAddedMs === null || addedMs > newestAddedMs)) newestAddedMs = addedMs;
    if (date.ms === null) undated += 1;

    if (!matches(entry, f)) continue;
    const key = session ? text(session.id) : (sessionId ? UNREAD_SESSION_ID : NO_SESSION_ID);
    if (!groups.has(key)) groups.set(key, { session, entries: [] });
    groups.get(key).entries.push(entry);
  }

  const shaped = [...groups.entries()].map(([key, { session, entries }]) => {
    entries.sort((a, b) => {
      if (a.ms === b.ms) return text(a.source.id).localeCompare(text(b.source.id));
      if (a.ms === null) return 1;
      if (b.ms === null) return -1;
      return a.ms - b.ms;
    });
    const newestFileMs = entries.reduce((max, e) => (e.ms !== null && (max === null || e.ms > max) ? e.ms : max), null);
    const sortMs = instant(session?.recordedAt) ?? newestFileMs ?? instant(session?.createdAt);
    return {
      id: key,
      title: session
        ? (text(session.title) || 'Untitled session')
        : (key === UNREAD_SESSION_ID ? UNREAD_SESSION_TITLE : NO_SESSION_TITLE),
      recordedAt: session ? text(session.recordedAt) : '',
      state: session ? text(session.state) || 'new' : '',
      sortMs,
      sources: entries.map((e) => ({
        id: text(e.source.id),
        lane: e.lane,
        layerRole: text(e.source.layerRole) || 'reference',
        durationS: Number.isFinite(e.source.durationS) ? e.source.durationS : null,
        width: Number.isFinite(e.source.width) ? e.source.width : null,
        height: Number.isFinite(e.source.height) ? e.source.height : null,
        state: text(e.source.state) || 'new',
        date: e.at,
        dateSource: e.dateSource,
        hasDriveFile: Boolean(text(e.source.driveFileId)),
      })),
    };
  });

  shaped.sort((a, b) => {
    // The two leftover groups always sort last: neither is a shoot.
    const leftover = (id) => (id === NO_SESSION_ID ? 2 : id === UNREAD_SESSION_ID ? 1 : 0);
    if (leftover(a.id) || leftover(b.id)) return leftover(a.id) - leftover(b.id) || 0;
    if (a.sortMs === b.sortMs) return a.id.localeCompare(b.id);
    if (a.sortMs === null) return 1;
    if (b.sortMs === null) return -1;
    return b.sortMs - a.sortMs;
  });

  const lanes = [...laneCounts.entries()]
    .map(([lane, count]) => ({ lane, count }))
    .sort((a, b) => (a.lane === UNKNOWN_LANE) - (b.lane === UNKNOWN_LANE) || a.lane.localeCompare(b.lane));

  return {
    totalSources: sources.filter(Boolean).length,
    shownSources: shaped.reduce((n, g) => n + g.sources.length, 0),
    undated,
    newestAddedAt: newestAddedMs === null ? '' : new Date(newestAddedMs).toISOString(),
    stateCounts,
    lanes,
    sessions: shaped.map(({ sortMs, ...rest }) => rest),
  };
}

module.exports = {
  buildFootage,
  readFilters,
  effectiveDate,
  NO_SESSION_TITLE,
  UNREAD_SESSION_TITLE,
  UNKNOWN_LANE,
};
