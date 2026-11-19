'use strict';

/**
 * The Footage screen's view of the Studio catalog (Studio Phase 1 · 8 of 8).
 *
 * Pure: it is handed the session and source rows the stores already returned
 * and decides what the screen shows — which files survive the filters, which
 * session each one sits under, the order, and what each file's transcript
 * state reads as. No database, no clock, so every
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

/**
 * Where Google Drive plays a file, or null when there is no Drive file.
 *
 * The ORIGINAL, in Drive's own player — not the small editing copy, because
 * that copy lives on the Mac Mini's disk, which the website cannot reach.
 * Drive asks the viewer to sign in to an account that can see the Studio
 * folder (docs/STUDIO.md).
 */
function driveUrlFor(driveFileId) {
  const id = text(driveFileId);
  return id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : null;
}

/**
 * The file's name as it was in Drive, or '' when it is not known.
 *
 * The catalog has no name column. Ingest saves each finished download under
 * its Drive name (workers/studio/ingest.js, cachePathsFor), so the last part
 * of `localPath` IS that name. When Drive gave no name, ingest falls back to
 * `<drive id>.media` — that is not a name anybody chose, so it reads as
 * unknown here rather than being shown as one.
 */
function fileNameOf(source) {
  const local = text(source?.localPath);
  if (!local) return '';
  const base = local.split(/[\\/]/).pop() || '';
  if (!base) return '';
  const id = text(source?.driveFileId);
  if (id && base === `${id}.media`) return '';
  return base;
}

/**
 * What the screen says about a file's transcript (Studio Phase 2 · 5 of 6).
 *
 * `transcripts` is listTranscriptStates' map (keyed by lower-cased source id),
 * or null when it could not be read. The answers:
 *
 *   done / failed / no_audio   the transcribe step's own verdict, from its row
 *   plate      no row, and the file came from Plates — never transcribed
 *   not_yet    no row. NOT "working": the job queue is a file on the Mac Mini
 *              (workers/studio/queue.js), so the website cannot know whether a
 *              job is waiting, and saying "transcribing" would be a guess.
 *   unknown    the states could not be read at all — "could not tell" is its
 *              own answer, never "not yet".
 *
 * A row outranks the plate rule: if a plate WAS transcribed, that is the truth.
 */
function transcriptStateFor(source, transcripts) {
  if (!transcripts) return { state: 'unknown', reason: '' };
  const row = transcripts[text(source?.id).toLowerCase()];
  if (row && ['done', 'failed', 'no_audio'].includes(row.state)) {
    return { state: row.state, reason: text(row.reason) };
  }
  if (text(source?.layerRole) === 'plate') return { state: 'plate', reason: '' };
  return { state: 'not_yet', reason: '' };
}

/**
 * What the screen says about a file's cut marks (Reel Spinner 1d, 86bcwaw8e).
 *
 * `cutMarks` is listCutMarkStates' map (keyed by lower-cased source id), or
 * null when it could not be read. The answers:
 *
 *   done      the find-the-cuts step finished; `cutS` is what it would remove
 *   failed    it ran and could not finish; `reason` says why
 *   not_yet   no row — not looked at. The ABSENCE of a row, never a state
 *             (lib/videoCutMarksStore.js), and not "working": that step runs
 *             on the Mac Mini, out of the website's sight.
 *   unknown   the states could not be read — its own answer, never "not yet".
 */
function cutMarksStateFor(source, cutMarks) {
  if (!cutMarks) return { state: 'unknown', reason: '', cutS: null };
  const row = cutMarks[text(source?.id).toLowerCase()];
  if (row && row.state === 'done') {
    return { state: 'done', reason: '', cutS: Number.isFinite(row.cutS) ? row.cutS : 0 };
  }
  if (row && row.state === 'failed') return { state: 'failed', reason: text(row.reason), cutS: null };
  return { state: 'not_yet', reason: '', cutS: null };
}

/**
 * The body of GET /api/studio/sources/:id/cuts: one file's cut marks, or a
 * `not_yet` answer when it has not been looked at. A missing row is the
 * ordinary answer, so it is a 200 with a state, never a 404 — the screen has
 * a sentence for it ("Not checked for cuts yet"), not an error.
 */
function cutsViewFor(sourceId, row) {
  if (!row) {
    return {
      sourceId: text(sourceId), state: 'not_yet', reason: '', durationS: null,
      verbatimWords: [], marks: [], cutS: 0, updatedAt: '',
    };
  }
  return {
    sourceId: text(row.sourceId) || text(sourceId),
    state: row.state === 'failed' ? 'failed' : 'done',
    reason: text(row.reason),
    durationS: Number.isFinite(row.durationS) ? row.durationS : null,
    verbatimWords: Array.isArray(row.verbatimWords) ? row.verbatimWords : [],
    marks: Array.isArray(row.marks) ? row.marks : [],
    cutS: Number.isFinite(row.cutS) ? row.cutS : 0,
    updatedAt: text(row.updatedAt),
  };
}

/**
 * The body of GET /api/studio/sources/:id/moments (Reel Spinner 2e, SC-830):
 * one recording's scored moments, best first, plus whether they were scored
 * against the notes Reel Spinner reads TODAY.
 *
 *   row     getMomentsBySource's data (null: not scored — the ABSENCE of a
 *           row, never a state; lib/videoMomentsStore.js)
 *   notes   readContextFor's envelope for 'reel-spinner' (lib/contextFor.js)
 *
 * `notesState` is one of:
 *   current      scored against exactly the notes switched on now
 *   stale        the notes changed since (an entry edited, added, removed,
 *                switched on or off) — the screen offers "Score again"
 *   unrecorded   the score does not say which notes it read, so whether they
 *                changed cannot be told; offered a rescore too, never "current"
 *   unknown      the notes could not be read, so it could not be compared —
 *                "could not tell" is its own answer (landmine 17)
 *   not_scored   nothing to compare
 *
 * `notesMissing` is the sentence for "Reel Spinner has nothing to read" — set
 * whenever the notes WERE read and hold no words, scored or not, because a
 * score made with no notes is a score against nothing.
 */
function momentsViewFor({ sourceId, driveFileId, row, notes, projectName } = {}) {
  const project = text(projectName) || 'this project';
  const notesOk = Boolean(notes && notes.ok && notes.data);
  const notesData = notesOk ? notes.data : null;
  let notesMissing = '';
  if (notesData && !text(notesData.text)) {
    const nothingSwitchedOn = !(notesData.entries || []).length && !(notesData.unreadable || []).length;
    notesMissing = nothingSwitchedOn
      ? `No Reel Spinner notes are switched on in ${project}.`
      : (text(notesData.reason) || `Reel Spinner could not read any of the notes switched on in ${project}.`);
  }
  const base = {
    sourceId: text(row?.sourceId) || text(sourceId),
    driveUrl: driveUrlFor(driveFileId),
    projectName: project,
    notesMissing,
    notesError: notesOk ? '' : text(notes?.error) || 'the notes did not answer',
  };
  if (!row) {
    return {
      ...base, state: 'not_yet', error: '', summary: '', moments: [], model: '', scoredAt: '',
      notesState: notesOk ? 'not_scored' : 'unknown', rescoreRequestedAt: '', canRescore: false,
    };
  }
  let notesState;
  if (!notesOk) notesState = 'unknown';
  else if (!text(row.briefFingerprint)) notesState = 'unrecorded';
  else notesState = text(row.briefFingerprint) === text(notesData.fingerprint) ? 'current' : 'stale';

  const moments = (Array.isArray(row.moments) ? row.moments : [])
    .filter((m) => m && Number.isFinite(m.start_s) && Number.isFinite(m.end_s))
    .map((m) => ({
      start_s: m.start_s,
      end_s: m.end_s,
      lengthS: Math.max(0, Math.round((m.end_s - m.start_s) * 10) / 10),
      score: Number.isFinite(m.score) ? m.score : 0,
      reasons: Array.isArray(m.reasons) ? m.reasons.map(text).filter(Boolean) : [],
      project: text(m.project),
      mood: text(m.mood),
      quote: text(m.quote),
    }))
    // Best first; a tie reads in the order it was said.
    .sort((a, b) => (b.score - a.score) || (a.start_s - b.start_s));

  return {
    ...base,
    state: row.status === 'failed' ? 'failed' : 'done',
    error: text(row.error),
    summary: text(row.summary),
    moments,
    model: text(row.model),
    scoredAt: text(row.updatedAt),
    notesState,
    rescoreRequestedAt: text(row.rescoreRequestedAt),
    canRescore: true,
  };
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
 * Why a pair was refused, in words (workers/studio/alignment.js REASONS). An
 * error is the reason code, optionally followed by `: <detail>`; an unknown
 * code is shown as written rather than dropped.
 */
const PAIR_REASON_WORDS = {
  no_recording_time: 'one of them has no recording time',
  not_an_iphone_and_a_zoom_recording: 'they are not an iPhone take and a Zoom recording',
  recording_times_overlap_less_than_half: 'their recording times overlap by less than half',
  too_short_to_check_start_and_end: 'one is too short to check the start and the end (a minute is the least)',
  overlap_too_short_to_check_start_and_end: 'the stretch both recorded is too short to check the start and the end',
  no_match: 'their sound did not match anywhere',
  start_matched_but_end_did_not: 'the start matched but the end did not',
  drift: 'the two clocks drift apart',
  audio_could_not_be_read: 'the sound of one of them could not be read',
};

function pairReasonText(error, driftS) {
  const raw = text(error);
  if (!raw) return 'no reason was recorded';
  const at = raw.indexOf(':');
  const code = at === -1 ? raw : raw.slice(0, at).trim();
  const detail = at === -1 ? '' : raw.slice(at + 1).trim();
  const words = PAIR_REASON_WORDS[code];
  if (!words) return raw;
  if (code === 'drift' && Number.isFinite(driftS)) {
    return `${words} (${Math.abs(driftS).toFixed(2)} s by the end), so the sound would slide off the lips`;
  }
  return detail ? `${words} — ${detail}` : words;
}

/**
 * The pairs one file is part of, as the Footage row shows them (Reel Spinner
 * 3b, SC-832). `pairs` is listAudioPairs' rows; `namesById` maps a lower-cased
 * source id to its file name. Each entry says who the partner is, whether the
 * two lined up (and if not, why), whose sound the edit uses and whether that
 * was measured or Dane's choice.
 */
function pairsViewFor(sourceId, pairs, namesById = new Map()) {
  const me = text(sourceId).toLowerCase();
  const nameOf = (id) => namesById.get(text(id).toLowerCase()) || '';
  const out = [];
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const a = text(pair?.sourceAId).toLowerCase();
    const b = text(pair?.sourceBId).toLowerCase();
    if (me !== a && me !== b) continue;
    const partnerId = me === a ? b : a;
    const audio = text(pair.audioSourceId).toLowerCase();
    const done = text(pair.status) === 'done';
    // Offsets are stored A→B; say them from this file's side.
    const flip = (v) => (Number.isFinite(v) && me !== a ? -v : v);
    out.push({
      pairId: text(pair.id),
      partnerId,
      partnerName: nameOf(partnerId),
      status: done ? 'done' : 'failed',
      reason: done ? '' : pairReasonText(pair.error, pair.driftS),
      offsetS: Number.isFinite(pair.offsetS) ? flip(pair.offsetS) : null,
      soundFromId: audio || null,
      soundFromName: audio ? nameOf(audio) : '',
      soundIsThisFile: Boolean(audio) && audio === me,
      chosenBy: text(pair.chosenBy) === 'dane' ? 'dane' : 'measured',
    });
  }
  return out;
}

/**
 * Sessions newest first; the files inside a session in recording order (the
 * order an editor stacks them). A session is dated by its own `recordedAt`,
 * else by its newest file, else by when it was created.
 */
function buildFootage({ sessions = [], sources = [], filters = {}, transcripts = {}, cutMarks = {}, pairs = [] } = {}) {
  const namesById = new Map(sources.filter(Boolean).map((s) => [text(s.id).toLowerCase(), fileNameOf(s)]));
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
        fileName: fileNameOf(e.source),
        driveUrl: driveUrlFor(e.source.driveFileId),
        transcript: transcriptStateFor(e.source, transcripts),
        cutMarks: cutMarksStateFor(e.source, cutMarks),
        pairs: pairsViewFor(e.source.id, pairs, namesById),
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

/** How many moments one file shows in a search; the rest are counted. */
const SEARCH_MOMENTS_PER_FILE = 5;

/** Seconds as m:ss (h:mm:ss past an hour), floored — the Footage screen's own clock. */
function clockOf(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * "Search what you said" (Studio Phase 2 · 6 of 6, 86bcdek0z): searchTranscripts'
 * hits, dressed with what the screen needs to name each file — its name,
 * session, date and Drive link — and cut to the first few moments in it.
 *
 * Pure, like buildFootage. A hit whose file is not among the rows read (past
 * the read ceiling) is still returned, with blank names, rather than dropped:
 * a recording that matched must not vanish because the page read too little.
 *
 * `transcribedCount` is how many recordings have a finished transcript, or
 * null when that could not be read. It is what lets "no match" say how much
 * was searched, so it never looks like "nothing transcribed yet".
 */
function buildSearchResults({ hits = [], sources = [], sessions = [], transcribedCount = null } = {}) {
  const sourceById = new Map();
  for (const source of sources) {
    if (source && text(source.id)) sourceById.set(text(source.id).toLowerCase(), source);
  }
  const sessionById = new Map();
  for (const session of sessions) {
    if (session && text(session.id)) sessionById.set(text(session.id), session);
  }
  const results = hits.filter(Boolean).map((hit) => {
    const source = sourceById.get(text(hit.sourceId).toLowerCase()) || null;
    const session = source ? sessionById.get(text(source.sessionId)) || null : null;
    const date = source ? effectiveDate(source, session) : { at: '', dateSource: 'none' };
    const matches = Array.isArray(hit.matches) ? hit.matches : [];
    return {
      sourceId: text(hit.sourceId),
      found: Boolean(source),
      fileName: source ? fileNameOf(source) : '',
      driveUrl: source ? driveUrlFor(source.driveFileId) : null,
      sessionTitle: session ? (text(session.title) || 'Untitled session') : '',
      date: date.at,
      dateSource: date.dateSource,
      matchCount: matches.length,
      moments: matches.slice(0, SEARCH_MOMENTS_PER_FILE).map((m) => ({
        start: Number.isFinite(m?.start) ? m.start : 0,
        time: clockOf(m?.start),
        text: typeof m?.text === 'string' ? m.text : '',
      })),
    };
  });
  return {
    results,
    transcribedCount: Number.isInteger(transcribedCount) ? transcribedCount : null,
    momentsPerFile: SEARCH_MOMENTS_PER_FILE,
  };
}

module.exports = {
  buildFootage,
  buildSearchResults,
  clockOf,
  SEARCH_MOMENTS_PER_FILE,
  readFilters,
  effectiveDate,
  driveUrlFor,
  fileNameOf,
  transcriptStateFor,
  cutMarksStateFor,
  cutsViewFor,
  momentsViewFor,
  pairsViewFor,
  pairReasonText,
  NO_SESSION_TITLE,
  UNREAD_SESSION_TITLE,
  UNKNOWN_LANE,
};
