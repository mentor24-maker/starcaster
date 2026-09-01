'use strict';

/**
 * "Did a machine write this comment, or did Dane?"
 *
 * WHY THIS EXISTS (2026-09-01, task 86bbqx2xe). The loops post to ClickUp
 * under Dane's own API token, so every card a machine writes comes back from
 * the API stamped with HIS user id. Everything downstream asked authorship the
 * only way it could — `Number(c.user.id) === OPERATOR_ID` — and got "yes" for
 * comments no human had ever seen.
 *
 * The damage was the escalation lane. `ask` posts an operator card and moves a
 * ticket to `Needs your input` with Dane assigned; the next bus-relay pass, ten
 * minutes later, read that card as a fresh answer FROM him, relayed it to the
 * bus as "Dane replied", and handed the ticket back to `Queued`. The ticket
 * left `Assigned to me` — the one view he trusts — and the next loop-build pass
 * would claim it and try to build the very thing that had been escalated. The
 * card stayed on the ticket, so from the ticket it looked handled. Only the
 * status and the assignee were gone.
 *
 * It hid well because it is self-limiting: the hand-back is gated on FRESHLY
 * relayed comments, so re-setting the status by hand sticks and only the
 * original escalation is lost.
 *
 * `waiting` was fooled by the same mechanism, in the quieter direction — it
 * under-reports. A `Ready to launch` ticket always has a machine card as its
 * newest comment, so `waiting` answered "his own comment is the newest word on
 * it" and called it NOT_WAITING. An agent asking "does anything need Dane?"
 * before writing its run report was told no while five merges sat parked.
 * That blindness was already self-confirming once: the override note on
 * 86bbpz1ed cited `waiting` as evidence that the guard had been fooled — a
 * tool fooled by the same mechanism.
 *
 * THE FIX IS A MARKER, NOT A TOKEN. The real fix is a separate ClickUp
 * identity for the loops, and it is entangled with 86bbq8qa8; this is the
 * cheap one that works today and does not depend on the token at all.
 *
 * IT IS STAMPED AT ONE CHOKE POINT. `call()` in clickup_direct.mjs stamps
 * every POST to a comment endpoint, because there are fourteen separate
 * comment-posting sites in that file and a fifteenth added later would fail
 * SILENTLY IN THE DANGEROUS DIRECTION — an unmarked machine card reads as
 * Dane's word and releases his escalation. Stamping at the door means a new
 * caller inherits the guard instead of having to remember it.
 *
 * WHICH WAY IT FAILS. Detection is deliberately anchored to the LAST non-empty
 * line, which is where the stamp is written and nowhere else. So if Dane
 * pastes a machine card INTO a comment of his own, the marker lands mid-text
 * and his comment is still read as his. If some future quoting put a marker
 * last, his answer would be ignored and the ticket would stay with him — the
 * escalation is not released, he is not told it was handled, and the failure is
 * loud rather than silent. That is the correct direction, and it is the
 * opposite of the bug this replaces.
 *
 * COMMENTS WRITTEN BEFORE THIS SHIPPED carry no marker and still read as his.
 * Nothing can be done about that from here; the legacy prefixes below catch
 * the machine comments that already announced themselves.
 */

/** The stamp. Its own line, at the end of the comment, written by `call()`. */
const MACHINE_MARKER = '[machine]';

/** The whole line, phrased for Dane — he reads these tickets, and a bare
 *  token in the margin of every card explains nothing. */
const MACHINE_MARKER_LINE = `${MACHINE_MARKER} posted by a loop under Dane's token — not his word`;

/**
 * Comments that announced themselves as machine-written before this marker
 * existed. Matched at the START of the comment, which is where these prefixes
 * are written. Kept short on purpose: every entry is a phrase Dane could in
 * principle type himself, and a false positive here ignores something he said.
 */
const LEGACY_MACHINE_PREFIXES = [
  '[CC-starcaster bus-relay]',
  '[auto-merge]',
  '[bus-relay]',
];

/** The last line with anything on it, or '' for an empty comment. */
function lastNonEmptyLine(text) {
  const lines = String(text == null ? '' : text).split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return '';
}

/**
 * Is this comment machine-written?
 *
 * `null`/`undefined` text is NOT treated as machine-written: an unreadable
 * comment is an unknown, and the callers that care already have a
 * "could not tell" path. Answering "machine" for a read we never made is the
 * DOCTRINE 3.11 failure in a new place.
 */
function isMachineComment(text) {
  if (text == null) return false;
  const s = String(text);
  if (!s.trim()) return false;
  if (lastNonEmptyLine(s).startsWith(MACHINE_MARKER)) return true;
  const head = s.trimStart();
  return LEGACY_MACHINE_PREFIXES.some((p) => head.startsWith(p));
}

/**
 * Add the stamp. Idempotent — stamping an already-stamped body returns it
 * unchanged, so a caller that stamps and then passes through `call()` (or a
 * retry of the same post) cannot end up with two.
 */
function stampMachineComment(text) {
  const s = String(text == null ? '' : text);
  if (isMachineComment(s)) return s;
  const trimmed = s.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${MACHINE_MARKER_LINE}` : MACHINE_MARKER_LINE;
}

/**
 * Does this request body post a comment, and if so which key holds the text?
 * ClickUp's task-comment endpoint takes a plain `comment_text`, OR a rich
 * `comment` array of `{ text, attributes }` blocks. Returns the key, or null
 * when this body is not a comment post at all.
 */
function commentTextKey(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.comment_text === 'string') return 'comment_text';
  if (typeof body.comment === 'string') return 'comment';
  if (Array.isArray(body.comment)) return 'comment';
  return null;
}

/**
 * Flatten the rich block form to the text ClickUp will store, which is what
 * comes back as `comment_text` on a read and what every consumer reads.
 */
function blocksToText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map((b) => String(b && b.text != null ? b.text : '')).join('');
}

/**
 * Stamp the rich block form.
 *
 * THIS IS THE ONE THAT MATTERED (2026-09-01). The operator card `ask` posts —
 * the exact comment whose misreading caused this ticket — goes out as blocks,
 * not as a string. The first cut of this module skipped non-string bodies on
 * the reasoning that guessing at an unknown shape could corrupt a comment;
 * the live break-test posted a real card and found it unmarked, with `waiting`
 * still calling it Dane's word. A guard that skips the case it was written for
 * is not a cautious guard, it is an absent one.
 */
function stampMachineCommentBlocks(blocks) {
  if (!Array.isArray(blocks)) return blocks;
  if (isMachineComment(blocksToText(blocks))) return blocks;
  return blocks.concat([{ text: `\n${MACHINE_MARKER_LINE}` }]);
}

/**
 * Stamp whichever shape this body carries. Returns the body unchanged when it
 * is not a comment post, so the caller can pass everything through.
 */
function stampCommentBody(body) {
  const key = commentTextKey(body);
  if (!key) return body;
  const value = body[key];
  if (typeof value === 'string') return { ...body, [key]: stampMachineComment(value) };
  return { ...body, [key]: stampMachineCommentBlocks(value) };
}

/** Is this the path of a comment-creating POST? Task comments and threaded
 *  replies both — a dedup marker written as a reply is a machine comment too. */
function isCommentPostPath(path) {
  const p = String(path || '');
  return /^\/api\/v2\/task\/[^/]+\/comment(\?|$)/.test(p)
    || /^\/api\/v2\/comment\/[^/]+\/reply(\?|$)/.test(p);
}

module.exports = {
  MACHINE_MARKER,
  MACHINE_MARKER_LINE,
  LEGACY_MACHINE_PREFIXES,
  isMachineComment,
  stampMachineComment,
  stampMachineCommentBlocks,
  stampCommentBody,
  blocksToText,
  commentTextKey,
  isCommentPostPath,
  lastNonEmptyLine,
};
