'use strict';

/**
 * video_edits — each output of Reel Spinner, a full video or a short clip, as
 * it moves from rough cut to YouTube. One row per output.
 *
 * Table: docs/SQL/video_reel_spinner_setup.sql. Reel Spinner 2b (SC-827).
 *
 * A row is a set of DECISIONS — which parts of the source stay in, whose sound
 * is used, what Dane said — never an edited file. A rough cut lives on Drive;
 * this row carries its Drive file id.
 *
 * THE STATUS MOVES ONLY ALONG ALLOWED STEPS (EDIT_STEPS below), and any other
 * move is refused naming both statuses. Each move is also guarded on the
 * status it was read in (`status=eq.<from>` on the write), so two writers
 * moving the same edit at once cannot both succeed: the second is told the
 * edit moved underneath it.
 *
 * TWO WRITERS, TWO DOORS. The Mini moves an edit through the machine steps
 * (moveEdit). The website writes only the review half (reviewEdit): approved,
 * skipped or sent back, Dane's note and the YouTube text. The Mini polls for
 * those (listEditsByStatus), because the website cannot reach the Mini's queue.
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10).
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { getSourceById } = require('./videoSourcesStore');
const { readField, unknownKeyError } = require('./storeInput');
const {
  safeText, safeNumber, isSeconds, optionalText, firstRow, limitOrError,
} = require('./reelSpinnerInput');

const EDIT_KINDS = ['full', 'short'];

const EDIT_STATUSES = [
  'draft', 'rendering', 'review', 'approved', 'skipped', 'sent_back',
  'finished', 'uploading', 'on_youtube', 'failed',
];

/**
 * Where an edit may go from each status. Anything not listed is refused.
 *
 *   draft → rendering → review → approved | skipped | sent_back
 *   sent_back → rendering            (a recut; recut_count goes up by one)
 *   sent_back → review               (handed back UNCHANGED, with `error` saying
 *                                     why: a note no valid edit could be made
 *                                     from, or the re-cut cap — Reel Spinner 4d)
 *   approved → finished → uploading → on_youtube
 *   every machine step → failed      failed → draft (try again from the start)
 *
 * `review` cannot fail: nothing runs while it waits on Dane. `skipped` and
 * `on_youtube` are the two ends.
 */
const EDIT_STEPS = {
  draft: ['rendering', 'failed'],
  rendering: ['review', 'failed'],
  review: ['approved', 'skipped', 'sent_back'],
  sent_back: ['rendering', 'review', 'failed'],
  approved: ['finished', 'failed'],
  finished: ['uploading', 'failed'],
  uploading: ['on_youtube', 'failed'],
  failed: ['draft'],
  skipped: [],
  on_youtube: [],
};

/** The statuses the website may set — Dane's verdict on a rough cut. */
const REVIEW_STATUSES = ['approved', 'skipped', 'sent_back'];

/** Once an edit is going up, or is up, its YouTube text is no longer his to change here. */
const TEXT_LOCKED_STATUSES = ['uploading', 'on_youtube'];

const CREATE_FIELDS = ['kind', 'momentIndex', 'keepRanges', 'audioSourceId'];
const MOVE_FIELDS = ['keepRanges', 'audioSourceId', 'roughCutDriveFileId', 'musicTrack', 'youtubeVideoId', 'error'];
const REVIEW_FIELDS = ['status', 'daneNote', 'youtubeTitle', 'youtubeDescription', 'youtubeTags'];

const COLUMNS = [
  'id', 'project_id', 'owner_user_id', 'source_id', 'kind', 'moment_index', 'keep_ranges',
  'audio_source_id', 'status', 'rough_cut_drive_file_id', 'dane_note', 'recut_count',
  'music_track', 'youtube_title', 'youtube_description', 'youtube_tags', 'youtube_video_id',
  'error', 'created_at', 'updated_at',
].join(',');

function table() {
  return tableConfig().videoEdits;
}

/** Is `from → to` an allowed step? A refusal names both statuses. */
function stepError(from, to) {
  if (!EDIT_STATUSES.includes(to)) {
    return { ok: false, status: 400, error: `status must be one of ${EDIT_STATUSES.join(', ')} (got ${JSON.stringify(to)})` };
  }
  const allowed = EDIT_STEPS[from] || [];
  if (allowed.includes(to)) return null;
  const options = allowed.length ? `it can go to ${allowed.join(' or ')}` : `${from} is the end of the line`;
  return { ok: false, status: 409, error: `An edit cannot move from ${from} to ${to}: ${options}` };
}

/**
 * `[{ start_s, end_s }]` in order and not overlapping, or a 400 naming the
 * first bad range. Only the declared keys are kept.
 */
function keepRangesOrError(value) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'keepRanges must be an array' };
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    const refuse = (why) => ({ ok: false, status: 400, error: `keepRanges[${i}]: ${why}` });
    if (!item || typeof item !== 'object' || Array.isArray(item)) return refuse('must be { start_s, end_s }');
    if (!isSeconds(item.start_s) || !isSeconds(item.end_s)) {
      return refuse('start_s and end_s must be numbers of seconds');
    }
    if (item.start_s >= item.end_s) {
      return refuse(`start_s (${item.start_s} s) must be before end_s (${item.end_s} s)`);
    }
    const previous = out[out.length - 1];
    if (previous && item.start_s < previous.end_s) {
      return refuse(`starts at ${item.start_s} s, before the range before it ends (${previous.end_s} s)`);
    }
    out.push({ start_s: item.start_s, end_s: item.end_s });
  }
  return { ok: true, value: out };
}

function tagsOrError(value) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    return { ok: false, status: 400, error: 'youtubeTags must be a list of words' };
  }
  return { ok: true, value: value.map((tag) => tag.trim()).filter(Boolean) };
}

function rowToEdit(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    sourceId: safeText(row.source_id, 120),
    kind: safeText(row.kind, 40),
    momentIndex: safeNumber(row.moment_index),
    keepRanges: Array.isArray(row.keep_ranges) ? row.keep_ranges : [],
    audioSourceId: safeText(row.audio_source_id, 120) || null,
    status: safeText(row.status, 40),
    roughCutDriveFileId: safeText(row.rough_cut_drive_file_id, 200),
    daneNote: safeText(row.dane_note, 4000),
    recutCount: safeNumber(row.recut_count) ?? 0,
    musicTrack: safeText(row.music_track, 400),
    youtubeTitle: safeText(row.youtube_title, 200),
    youtubeDescription: safeText(row.youtube_description, 5000),
    youtubeTags: Array.isArray(row.youtube_tags) ? row.youtube_tags : [],
    youtubeVideoId: safeText(row.youtube_video_id, 200),
    error: safeText(row.error, 2000),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

/** A source in THIS project, or the envelope saying why not. */
async function sourceInProject(id, scope, what) {
  const owner = await getSourceById(id, scope);
  if (!owner.ok && owner.status !== 404) return owner;
  if (!owner.ok || !owner.data) {
    return { ok: false, status: 404, error: `${what} does not exist in this project` };
  }
  return { ok: true, data: owner.data };
}

/** One edit by id, in scope, or `data: null`. */
async function getEditById(id, scope = null) {
  const editId = safeText(id, 120);
  if (!editId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(editId)}&select=${COLUMNS}&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const found = firstRow(res.data);
  return { ok: true, status: 200, data: found ? rowToEdit(found) : null };
}

/**
 * Start an edit, as a `draft`. A full edit has no moment; a short names the
 * moment it is cut from. One full edit per source and one short per moment —
 * a second is a 409, not a second row.
 */
async function createEdit(sourceId, input, scope = null) {
  const id = safeText(sourceId, 120);
  if (!id) return { ok: false, status: 400, error: 'sourceId is required' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, error: 'edit data must be an object' };
  }
  const unknown = unknownKeyError(input, CREATE_FIELDS);
  if (unknown) return unknown;

  const suppliedKind = readField(input, 'kind');
  if (!suppliedKind.ok) return suppliedKind;
  const kind = safeText(suppliedKind.value, 40);
  if (!EDIT_KINDS.includes(kind)) {
    return { ok: false, status: 400, error: `kind must be one of ${EDIT_KINDS.join(', ')}` };
  }

  const suppliedIndex = readField(input, 'momentIndex');
  if (!suppliedIndex.ok) return suppliedIndex;
  const hasIndex = suppliedIndex.value !== undefined && suppliedIndex.value !== null;
  if (kind === 'full' && hasIndex) {
    return { ok: false, status: 400, error: 'a full edit is the whole recording, so it has no momentIndex' };
  }
  if (kind === 'short' && (!Number.isInteger(suppliedIndex.value) || suppliedIndex.value < 0)) {
    return { ok: false, status: 400, error: 'a short needs momentIndex, the number of the moment it is cut from (0 or more)' };
  }

  const suppliedRanges = readField(input, 'keepRanges');
  if (!suppliedRanges.ok) return suppliedRanges;
  const ranges = keepRangesOrError(suppliedRanges.value);
  if (!ranges.ok) return ranges;

  const owner = await sourceInProject(id, scope, 'That source');
  if (!owner.ok) return owner;

  const suppliedAudio = readField(input, 'audioSourceId');
  if (!suppliedAudio.ok) return suppliedAudio;
  let audioSourceId = null;
  if (suppliedAudio.value !== undefined && suppliedAudio.value !== null) {
    const audio = await sourceInProject(safeText(suppliedAudio.value, 120), scope, 'The sound source');
    if (!audio.ok) return audio;
    audioSourceId = audio.data.id;
  }

  const row = await scopedInsertRow(table(), {
    source_id: owner.data.id,
    kind,
    moment_index: kind === 'short' ? suppliedIndex.value : null,
    keep_ranges: ranges.value,
    audio_source_id: audioSourceId,
    status: 'draft',
  }, scope);

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: `select=${COLUMNS}`,
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) {
    if (res.status === 409 && /idx_video_edits_project_source_(full|short)|duplicate key/i.test(String(res.error || ''))) {
      return {
        ok: false,
        status: 409,
        error: kind === 'full'
          ? 'This recording already has a full edit in this project'
          : `This recording already has a short for moment ${suppliedIndex.value} in this project`,
      };
    }
    return res;
  }
  const saved = firstRow(res.data);
  if (!saved) return { ok: false, status: 502, error: 'The database accepted the edit but returned no row' };
  return { ok: true, status: 200, data: rowToEdit(saved) };
}

/**
 * Write `body` onto the edit, guarded on the status it was read in. A guard
 * that matches nothing is read again, so "moved underneath you" and "gone"
 * say different things.
 */
async function guardedPatch(current, body, scope) {
  const patch = await scopedPatchRow(table(), body, scope);
  const query = await scopedIdQuery(
    table(),
    `id=eq.${encodeURIComponent(current.id)}&status=eq.${encodeURIComponent(current.status)}&select=${COLUMNS}`,
    scope
  );
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
  if (!res.ok) return res;
  const updated = firstRow(res.data);
  if (updated) return { ok: true, status: 200, data: rowToEdit(updated) };
  const now = await getEditById(current.id, scope);
  if (!now.ok) return now;
  if (!now.data) return { ok: false, status: 404, error: 'That edit does not exist in this project' };
  return {
    ok: false,
    status: 409,
    error: `The edit moved from ${current.status} to ${now.data.status} while this was being written; nothing was changed`,
  };
}

async function readForMove(id, scope) {
  const current = await getEditById(id, scope);
  if (!current.ok) return current;
  if (!current.data) return { ok: false, status: 404, error: 'That edit does not exist in this project' };
  return current;
}

/**
 * The Mini's door: move an edit one allowed step, with what that step
 * produced (`patch`). Moving to `failed` needs an `error`; moving anywhere
 * else clears the last one, except `sent_back → review` (handed back unchanged),
 * which needs an `error` and keeps it. `sent_back → rendering` counts a recut.
 */
async function moveEdit(id, toStatus, patch = {}, scope = null) {
  const to = safeText(toStatus, 40);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, status: 400, error: 'patch must be an object' };
  }
  const unknown = unknownKeyError(patch, MOVE_FIELDS);
  if (unknown) return unknown;

  const body = { status: to };
  const suppliedRanges = readField(patch, 'keepRanges');
  if (!suppliedRanges.ok) return suppliedRanges;
  if (suppliedRanges.present) {
    const ranges = keepRangesOrError(suppliedRanges.value);
    if (!ranges.ok) return ranges;
    body.keep_ranges = ranges.value;
  }
  for (const [key, column, max] of [
    ['roughCutDriveFileId', 'rough_cut_drive_file_id', 200],
    ['musicTrack', 'music_track', 400],
    ['youtubeVideoId', 'youtube_video_id', 200],
    ['error', 'error', 2000],
  ]) {
    const supplied = readField(patch, key);
    if (!supplied.ok) return supplied;
    if (!supplied.present) continue;
    const parsed = optionalText(supplied.value, key, max);
    if (!parsed.ok) return parsed;
    body[column] = parsed.value;
  }
  if (to === 'failed' && !body.error) {
    return { ok: false, status: 400, error: 'error is required when an edit moves to failed' };
  }
  if (to === 'on_youtube' && !body.youtube_video_id) {
    return { ok: false, status: 400, error: 'youtubeVideoId is required when an edit moves to on_youtube' };
  }

  const current = await readForMove(id, scope);
  if (!current.ok) return current;
  const refused = stepError(current.data.status, to);
  if (refused) return refused;
  // Handed back unchanged: the reason IS the point of the move, and it is
  // what the card shows him, so it is required and it is kept. Every other
  // move clears the last error.
  const handBack = current.data.status === 'sent_back' && to === 'review';
  if (handBack && !body.error) {
    return { ok: false, status: 400, error: 'error is required when a sent-back edit goes back to review unchanged: it is the reason he reads' };
  }
  if (to !== 'failed' && !handBack) body.error = null;
  // The website's verdicts come through reviewEdit, never through here.
  if (REVIEW_STATUSES.includes(to)) {
    return { ok: false, status: 409, error: `${to} is Dane's verdict, set through reviewEdit, not a machine step` };
  }

  const suppliedAudio = readField(patch, 'audioSourceId');
  if (!suppliedAudio.ok) return suppliedAudio;
  if (suppliedAudio.present) {
    if (suppliedAudio.value === null) {
      body.audio_source_id = null;
    } else {
      const audio = await sourceInProject(safeText(suppliedAudio.value, 120), scope, 'The sound source');
      if (!audio.ok) return audio;
      body.audio_source_id = audio.data.id;
    }
  }
  if (current.data.status === 'sent_back' && to === 'rendering') {
    body.recut_count = current.data.recutCount + 1;
  }
  return guardedPatch(current.data, body, scope);
}

/**
 * The website's door: Dane's verdict on a rough cut and the YouTube text.
 * `status`, when given, must be approved, skipped or sent_back, and the edit
 * must be in review. Sending one back needs a note saying what to change,
 * sent in the same call — never the note left from an earlier send-back.
 * The text alone can be saved at any point before the edit starts uploading.
 */
async function reviewEdit(id, input, scope = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, error: 'review data must be an object' };
  }
  const unknown = unknownKeyError(input, REVIEW_FIELDS);
  if (unknown) return unknown;

  const body = {};
  const suppliedStatus = readField(input, 'status');
  if (!suppliedStatus.ok) return suppliedStatus;
  if (suppliedStatus.present) {
    const status = safeText(suppliedStatus.value, 40);
    if (!REVIEW_STATUSES.includes(status)) {
      return { ok: false, status: 400, error: `the website can set status only to ${REVIEW_STATUSES.join(', ')}` };
    }
    body.status = status;
  }
  for (const [key, column, max] of [
    ['daneNote', 'dane_note', 4000],
    ['youtubeTitle', 'youtube_title', 100],
    ['youtubeDescription', 'youtube_description', 5000],
  ]) {
    const supplied = readField(input, key);
    if (!supplied.ok) return supplied;
    if (!supplied.present) continue;
    const parsed = optionalText(supplied.value, key, max);
    if (!parsed.ok) return parsed;
    body[column] = parsed.value;
  }
  const suppliedTags = readField(input, 'youtubeTags');
  if (!suppliedTags.ok) return suppliedTags;
  if (suppliedTags.present) {
    const tags = tagsOrError(suppliedTags.value);
    if (!tags.ok) return tags;
    body.youtube_tags = tags.value;
  }
  if (!Object.keys(body).length) return { ok: false, status: 400, error: 'Nothing to update' };

  const current = await readForMove(id, scope);
  if (!current.ok) return current;
  if (body.status) {
    const refused = stepError(current.data.status, body.status);
    if (refused) return refused;
    // The note must come WITH this send-back. The one already on the row is
    // the last send-back's, and a recut made from it would act on stale
    // instructions while the send-back answered 200 (review of PR #1025).
    if (body.status === 'sent_back' && !body.dane_note) {
      return { ok: false, status: 400, error: 'sending an edit back needs a note, in the same save, saying what to change this time' };
    }
  } else if (TEXT_LOCKED_STATUSES.includes(current.data.status)) {
    return { ok: false, status: 409, error: `The edit is ${current.data.status}, so its text can no longer be changed here` };
  }
  return guardedPatch(current.data, body, scope);
}

/**
 * The statuses the Mini may write YouTube text into (Reel Spinner 6a, SC-839).
 * Never once it is going up (TEXT_LOCKED_STATUSES), and never before there is
 * a rough cut for the text to describe.
 */
const COPY_WRITABLE_STATUSES = ['review', 'approved', 'finished'];

/**
 * Every reason the Mini writes on an edit about its YouTube text starts with
 * this, so the card can tell it from a re-cut's hand-back reason (both live
 * in `error` while the edit is in review), and so clearing it can never wipe
 * a hand-back reason by mistake.
 */
const COPY_PROBLEM_PREFIX = 'YouTube text not written yet: ';

/**
 * Every reason the Mini writes when it moves an edit to `failed` because
 * YouTube refused the UPLOAD starts with this (Reel Spinner 6c, SC-842), so
 * the Rough cuts screen can keep showing that edit under Approved with the
 * reason, instead of letting an approved video vanish from the screen.
 */
const UPLOAD_PROBLEM_PREFIX = 'YouTube refused the upload: ';

/**
 * The Mini's door for the YouTube text: write each field ONLY WHERE IT IS
 * EMPTY, guarded on it still being empty at write time. A field Dane typed in
 * is never touched, however late the Mini's answer lands; a box he cleared
 * (saved empty, which reviewEdit stores as null) is filled again.
 *
 * One guarded PATCH per field, so a title he typed does not stop his empty
 * description being filled. Returns `{ written: [...], kept: [...], data }`
 * where `kept` names the fields that were already filled and left alone, and
 * `data` is the edit read back AFTER the writes.
 */
async function fillYoutubeCopy(id, input, scope = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, error: 'YouTube text must be an object' };
  }
  const unknown = unknownKeyError(input, ['youtubeTitle', 'youtubeDescription', 'youtubeTags']);
  if (unknown) return unknown;
  const writes = [];
  for (const [key, column, max] of [
    ['youtubeTitle', 'youtube_title', 100],
    ['youtubeDescription', 'youtube_description', 5000],
  ]) {
    const supplied = readField(input, key);
    if (!supplied.ok) return supplied;
    if (!supplied.present) continue;
    const parsed = optionalText(supplied.value, key, max);
    if (!parsed.ok) return parsed;
    if (!parsed.value) return { ok: false, status: 400, error: `${key} is empty; the Mini only writes text, never a blank` };
    writes.push({ key, column, value: parsed.value, empty: 'is.null' });
  }
  const suppliedTags = readField(input, 'youtubeTags');
  if (!suppliedTags.ok) return suppliedTags;
  if (suppliedTags.present) {
    const tags = tagsOrError(suppliedTags.value);
    if (!tags.ok) return tags;
    if (!tags.value.length) return { ok: false, status: 400, error: 'youtubeTags is empty; the Mini only writes tags, never an empty list' };
    writes.push({ key: 'youtubeTags', column: 'youtube_tags', value: tags.value, empty: 'eq.[]' });
  }
  if (!writes.length) return { ok: false, status: 400, error: 'Nothing to write' };

  const editId = safeText(id, 120);
  if (!editId) return { ok: false, status: 400, error: 'id is required' };
  const written = [];
  for (const w of writes) {
    const query = await scopedIdQuery(
      table(),
      `id=eq.${encodeURIComponent(editId)}&status=in.(${COPY_WRITABLE_STATUSES.join(',')})`
        + `&${w.column}=${encodeURIComponent(w.empty)}&select=id`,
      scope
    );
    const res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: { [w.column]: w.value },
    });
    if (!res.ok) return { ...res, written };
    if (firstRow(res.data)) written.push(w.key);
  }
  const back = await getEditById(editId, scope);
  if (!back.ok) return { ...back, written };
  if (!back.data) return { ok: false, status: 404, error: 'That edit does not exist in this project', written };
  const kept = writes.map((w) => w.key).filter((k) => !written.includes(k));
  return { ok: true, status: 200, data: back.data, written, kept };
}

/**
 * Say on the card why the YouTube text is not written. Only on an edit whose
 * `error` is empty or already one of these reasons: a re-cut's hand-back
 * reason is never written over. Guarded on the status and the error read.
 */
async function noteYoutubeCopyProblem(id, reason, scope = null) {
  const said = safeText(reason, 2000 - COPY_PROBLEM_PREFIX.length);
  if (!said) return { ok: false, status: 400, error: 'a reason is required' };
  const current = await readForMove(id, scope);
  if (!current.ok) return current;
  const edit = current.data;
  if (!COPY_WRITABLE_STATUSES.includes(edit.status)) {
    return { ok: true, status: 200, data: edit, noted: false, why: `the edit is ${edit.status}` };
  }
  if (edit.error && !edit.error.startsWith(COPY_PROBLEM_PREFIX)) {
    return { ok: true, status: 200, data: edit, noted: false, why: 'the edit already carries another reason (a re-cut hand-back), which is kept' };
  }
  const next = `${COPY_PROBLEM_PREFIX}${said}`;
  if (edit.error === next) return { ok: true, status: 200, data: edit, noted: true };
  return guardedErrorPatch(edit, next, scope);
}

/** Take the Mini's YouTube-text reason off the card, and only that reason. */
async function clearYoutubeCopyProblem(id, scope = null) {
  const current = await readForMove(id, scope);
  if (!current.ok) return current;
  const edit = current.data;
  if (!edit.error || !edit.error.startsWith(COPY_PROBLEM_PREFIX)) return { ok: true, status: 200, data: edit, cleared: false };
  const done = await guardedErrorPatch(edit, null, scope);
  return done.ok ? { ...done, cleared: true } : done;
}

/** Write `error`, guarded on the status AND the error it was read with. */
async function guardedErrorPatch(edit, value, scope) {
  const errorGuard = edit.error ? `eq.${encodeURIComponent(edit.error)}` : 'is.null';
  const query = await scopedIdQuery(
    table(),
    `id=eq.${encodeURIComponent(edit.id)}&status=eq.${encodeURIComponent(edit.status)}&error=${errorGuard}&select=${COLUMNS}`,
    scope
  );
  const res = await sbQuery({
    method: 'PATCH', table: table(), query, headers: { Prefer: 'return=representation' }, body: { error: value },
  });
  if (!res.ok) return res;
  const updated = firstRow(res.data);
  if (!updated) return { ok: false, status: 409, error: 'The edit changed while its YouTube-text reason was being written; nothing was changed' };
  return { ok: true, status: 200, data: rowToEdit(updated), noted: value !== null };
}

/** Every edit of one source, oldest first. `(sourceId, scope)`. */
async function listEditsForSource(sourceId, scope = null) {
  const id = safeText(sourceId, 120);
  if (!id) return { ok: false, status: 400, error: 'sourceId is required' };
  const query = await scopedListQuery(
    table(),
    `source_id=eq.${encodeURIComponent(id)}&select=${COLUMNS}&order=created_at.asc`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToEdit) };
}

/**
 * Edits in any of `statuses`, oldest change first — how the Mini finds the
 * verdicts the website wrote. The limit comes FIRST (landmine 12).
 */
async function listEditsByStatus(limit, statuses, scope = null) {
  const checked = limitOrError(limit, 'listEditsByStatus');
  if (!checked.ok) return checked;
  if (!Array.isArray(statuses) || !statuses.length) {
    return { ok: false, status: 400, error: 'statuses must be a non-empty list' };
  }
  const bad = statuses.find((status) => !EDIT_STATUSES.includes(status));
  if (bad !== undefined) {
    return { ok: false, status: 400, error: `status must be one of ${EDIT_STATUSES.join(', ')} (got ${JSON.stringify(bad)})` };
  }
  const query = await scopedListQuery(
    table(),
    `status=in.(${statuses.join(',')})&select=${COLUMNS}&order=updated_at.asc&limit=${checked.value}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToEdit) };
}

module.exports = {
  EDIT_KINDS,
  EDIT_STATUSES,
  EDIT_STEPS,
  REVIEW_STATUSES,
  COPY_WRITABLE_STATUSES,
  COPY_PROBLEM_PREFIX,
  UPLOAD_PROBLEM_PREFIX,
  stepError,
  keepRangesOrError,
  rowToEdit,
  getEditById,
  createEdit,
  moveEdit,
  reviewEdit,
  fillYoutubeCopy,
  noteYoutubeCopyProblem,
  clearYoutubeCopyProblem,
  listEditsForSource,
  listEditsByStatus,
};
