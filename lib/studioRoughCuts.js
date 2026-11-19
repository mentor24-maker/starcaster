'use strict';

/**
 * Assets › Footage › Rough cuts — the view Dane approves, skips or sends back
 * from (Reel Spinner 4c, SC-835). Pure: routes/studioRoughCuts.js reads the
 * rows and hands them here, so every rule below is tested without a database.
 *
 * WHICH EDITS ARE SHOWN, AND UNDER WHICH COUNT. Four groups, each a filter on
 * the screen:
 *
 *   waiting    review                      — his turn
 *   approved   approved and every step after it (finished, uploading,
 *              on_youtube) — he said yes; the Mini moving it on does not
 *              take it out of the count he made
 *   skipped    skipped
 *   sent_back  sent_back
 *
 * Edits still being made (draft, rendering) are not shown, but they are
 * COUNTED, so an empty screen can say "the Mac Mini is making 3" rather than
 * "has not made any" (CLAUDE.md landmine 17). A failed edit is neither: it has
 * no rough cut to watch.
 *
 * TIME SAVED. A full edit is the whole recording minus the cuts, so what it
 * saves is the recording's length minus what it keeps. A short is cut from a
 * stretch of the recording around its moment; the row keeps only the ranges,
 * so the stretch is read as first-kept to last-kept and what it saves is the
 * gaps inside that. The Mini's own figure (editList.js savedS) is the same
 * gaps; it can differ only by a lead-in trimmed at the very edge.
 */

const { driveUrlFor, fileNameOf } = require('./studioFootage');

const GROUPS = ['waiting', 'approved', 'skipped', 'sent_back'];

const GROUP_OF = {
  review: 'waiting',
  approved: 'approved',
  finished: 'approved',
  uploading: 'approved',
  on_youtube: 'approved',
  skipped: 'skipped',
  sent_back: 'sent_back',
};

/** Being made: counted for the empty state, never shown. */
const MAKING = ['draft', 'rendering'];

function round(n) {
  return Math.round(n * 10) / 10;
}

function keptSeconds(ranges) {
  let total = 0;
  for (const r of Array.isArray(ranges) ? ranges : []) {
    const start = Number(r?.start_s);
    const end = Number(r?.end_s);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) total += end - start;
  }
  return total;
}

/** Seconds saved, or null when it cannot be told (a full edit of a recording whose length is unknown). */
function savedSeconds(edit, source) {
  const ranges = Array.isArray(edit.keepRanges) ? edit.keepRanges : [];
  const kept = keptSeconds(ranges);
  if (edit.kind === 'full') {
    const length = Number(source?.durationS);
    if (!Number.isFinite(length) || length <= 0) return null;
    return round(Math.max(0, length - kept));
  }
  if (!ranges.length) return null;
  const span = Number(ranges[ranges.length - 1].end_s) - Number(ranges[0].start_s);
  if (!Number.isFinite(span)) return null;
  return round(Math.max(0, span - kept));
}

function recordingName(source) {
  if (!source) return 'A recording that could not be read';
  return fileNameOf(source) || `Recording ${String(source.id).slice(0, 8)}`;
}

/** The moment a short was cut from, or null (a full edit, or moments not read). */
function momentOf(edit, momentsBySource) {
  if (edit.kind !== 'short' || !Number.isInteger(edit.momentIndex)) return null;
  const row = momentsBySource?.[String(edit.sourceId).toLowerCase()];
  const moment = row && Array.isArray(row.moments) ? row.moments[edit.momentIndex] : null;
  if (!moment) return null;
  return {
    startS: Number(moment.start_s) || 0,
    endS: Number(moment.end_s) || 0,
    score: Number(moment.score) || 0,
    reasons: Array.isArray(moment.reasons) ? moment.reasons.map(String) : [],
    quote: String(moment.quote || ''),
  };
}

/** When the recording was made, for "newest recording first". */
function recordingTime(source) {
  const at = Date.parse(source?.recordedAt || source?.createdAt || '');
  return Number.isFinite(at) ? at : 0;
}

/**
 * @param {object}   args
 * @param {object[]} args.edits            rows from listEditsByStatus (rowToEdit shape)
 * @param {object[]} args.sources          rows from listSources (rowToSource shape)
 * @param {object}   [args.momentsBySource] { <source id lower-cased>: moments row }
 */
function roughCutsView({ edits = [], sources = [], momentsBySource = {} } = {}) {
  const sourceById = new Map(sources.map((s) => [String(s.id).toLowerCase(), s]));
  const counts = { waiting: 0, approved: 0, skipped: 0, sent_back: 0, making: 0 };
  const shown = [];
  for (const edit of edits) {
    if (MAKING.includes(edit.status)) { counts.making += 1; continue; }
    const group = GROUP_OF[edit.status];
    if (!group) continue;
    counts[group] += 1;
    const key = String(edit.sourceId).toLowerCase();
    const source = sourceById.get(key) || null;
    shown.push({
      id: edit.id,
      sourceId: edit.sourceId,
      recordingName: recordingName(source),
      recordedAt: source ? (source.recordedAt || source.createdAt || '') : '',
      recordingLengthS: source && Number.isFinite(Number(source.durationS)) ? Number(source.durationS) : null,
      kind: edit.kind,
      momentIndex: edit.momentIndex,
      status: edit.status,
      group,
      lengthS: round(keptSeconds(edit.keepRanges)),
      savedS: savedSeconds(edit, source),
      moment: momentOf(edit, momentsBySource),
      watchUrl: driveUrlFor(edit.roughCutDriveFileId),
      daneNote: edit.daneNote || '',
      recutCount: edit.recutCount || 0,
      updatedAt: edit.updatedAt || '',
      _at: recordingTime(source),
    });
  }
  shown.sort((a, b) => (b._at - a._at)
    || String(a.sourceId).localeCompare(String(b.sourceId))
    || (a.kind === b.kind ? (a.momentIndex ?? 0) - (b.momentIndex ?? 0) : (a.kind === 'full' ? -1 : 1)));
  return { edits: shown.map(({ _at, ...rest }) => rest), counts };
}

module.exports = { roughCutsView, GROUPS, GROUP_OF, MAKING, savedSeconds, keptSeconds };
