'use strict';

/**
 * The Loop note, kept as a TICKET COMMENT (task 86bbzww8m).
 *
 * The Loop note is the one line that says what a pass is doing to a ticket —
 * and, for a review, the only place its CLAIM is visible to a second pass (the
 * 2026-08-22 double-review, PR #362). It lived in a ClickUp custom field. On
 * 2026-09-08 the workspace ran out of custom-field usages on the Free plan and
 * every write began failing with "Custom field usages exceeded for your plan",
 * so for five days no note could be written and the guard was off.
 *
 * Comments are not plan-limited, so every note is now also posted as a comment
 * carrying a fixed marker, and every reader prefers the newest such comment.
 * The field is still written when ClickUp allows it (the board column), but it
 * is never the source of truth: a field that works again after an upgrade would
 * otherwise disagree with an older comment, with nothing to say which is newer.
 * One store, one answer.
 *
 * Pure except `hydrateLoopNotes`, which takes its comment reader as an argument.
 */

const MARKER = '🔖 Loop note: ';

/**
 * Statuses a note matters on — a pass is working on the ticket, or just left
 * it. Queued and closed tickets are not read, so a queue listing costs a few
 * extra requests, not one per ticket.
 */
const NOTE_STATUSES = new Set(['building', 'in review', 'rework', 'ready to launch', 'needs your input']);

function renderNoteComment(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) throw new Error('a Loop note needs text');
  return `${MARKER}${line}`;
}

/** The note a comment carries, or '' when it is not a note comment. */
function noteOfComment(comment) {
  const text = String(comment?.comment_text ?? comment?.text ?? '').trim();
  if (!text.startsWith(MARKER)) return '';
  return text.slice(MARKER.length).split('\n')[0].trim();
}

/** The newest note among a ticket's comments, or ''. Order is by date, never by position. */
function latestNote(comments) {
  let best = null;
  for (const c of comments || []) {
    const note = noteOfComment(c);
    if (!note) continue;
    const at = Number(c.date) || 0;
    if (!best || at > best.at) best = { at, note };
  }
  return best ? best.note : '';
}

/** The field's text, as it always was — the fallback for tickets from before comments. */
function fieldNote(task) {
  const f = (task?.custom_fields || []).find((x) => String(x.name || '').trim().toLowerCase() === 'loop note');
  return String(f?.value ?? '').trim();
}

/**
 * THE Loop note of a task: the newest note comment when one was read, else the
 * field. `loop_note_comment` is set by hydrateLoopNotes; undefined means "not
 * read", and '' means "read, and there is none".
 */
function resolveLoopNote(task) {
  const fromComment = String(task?.loop_note_comment ?? '').trim();
  return fromComment || fieldNote(task);
}

function wantsNote(task) {
  return NOTE_STATUSES.has(String(task?.status?.status ?? task?.status ?? '').trim().toLowerCase());
}

/**
 * Read note comments onto the tasks that need them, in place. Never throws: a
 * ticket whose comments could not be read keeps its field note and is counted
 * in `failed`, so a caller can say the view is partial rather than imply it is
 * whole.
 */
async function hydrateLoopNotes(tasks, getComments) {
  let read = 0;
  let failed = 0;
  for (const task of tasks || []) {
    if (!wantsNote(task)) continue;
    try {
      const comments = await getComments(String(task.id));
      if (!Array.isArray(comments)) { failed += 1; continue; }
      task.loop_note_comment = latestNote(comments);
      read += 1;
    } catch {
      failed += 1;
    }
  }
  return { read, failed };
}

module.exports = {
  MARKER,
  NOTE_STATUSES,
  renderNoteComment,
  noteOfComment,
  latestNote,
  fieldNote,
  resolveLoopNote,
  wantsNote,
  hydrateLoopNotes,
};
