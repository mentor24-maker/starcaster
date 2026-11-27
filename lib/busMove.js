'use strict';

/**
 * Moving StarCaster's bus into the StarCaster project (SC-818): the plan,
 * worked out from what the two projects hold, and the check afterwards.
 * `scripts/move_bus_into_project.mjs` reads the projects and carries it out.
 *
 * WHY THE OLD COPIES ARE RENAMED FIRST. The starcaster project already holds
 * a ticket under every board name: the ClickUp-era copies imported with the
 * rest of the queue (SC-404 "Team chat", SC-249 "Pipeline pulse", SC-182
 * "Node roll call", SC-715 "SQL waiting for you", SC-738 "Broken links on
 * client sites", SC-155 "Pipeline pause switch"). Every board is found BY
 * NAME inside busProject, and the lookups disagree about which of two wins:
 * Team chat is the OLDEST (Spirality's lib/trackerBus.js, lib/trackerForward.js),
 * the roll call and the pulse take the first in list order. A move keeps a
 * ticket's creation date, so SC-404 (Sep 8) would beat the moved SCBUS-1
 * (Nov 12) and every post would land on the archive. With the old copies
 * renamed "<name> (ClickUp archive)" there is one ticket per name and no
 * rule has to choose.
 *
 * The archives are renamed and nothing else: no tag, so `bus-read` (which
 * reads every `noticeboard` ticket in full) does not read SC-404's thousands
 * of comments on every wake. Their history stays where it is, opened by id.
 *
 * The pause switch has no copy on the bus (there has never been a tracker
 * one), so `npm run pipeline -- status` reads "no pause switch exists" today.
 * Its old ClickUp copy is archived too, so that pointing busProject at
 * starcaster does not quietly make SC-155 the switch: the next `pause`
 * creates a fresh one, which is what happens today.
 *
 * ONLY THE CLICKUP-ERA COPIES. "Old" is measured, not assumed: a copy is
 * archived only if it was created before the bus's own oldest ticket (the
 * CUTOFF; SCBUS-1, 2026-11-12). Between merging the config switch and running
 * the move, something may create a fresh ticket under a board name (the first
 * `pipeline -- pause` creates a switch). A fresh board copy is a refusal, so
 * a person decides which is the board; a pause switch is never archived if it
 * was created, or last written, at or after the cutoff, because that is a
 * switch somebody used, and archiving it would lift a pause while Dane has
 * the deck. The switch IS its comments, so its last write is its newest
 * comment's time, which the caller reads (`lastWrittenAt`).
 *
 * Nothing here is done from a guess. A rerun after a partial run plans only
 * what is left: an old copy is renamed only while the bus still holds a
 * ticket to replace it, or (the pause switch) while the bus still holds
 * anything at all. Once the bus is empty the plan is empty.
 */

const { ALL_TASK_NAMES } = require('./spirality.cjs').requireSpirality('lib/busFallback.js');
const { SWITCH_TASK_NAME } = require('./spirality.cjs').requireSpirality('lib/pipelinePause.js');
const { NOTICEBOARD_TAG } = require('./spirality.cjs').requireSpirality('lib/loopNoticeboards.js');
const { ROLL_CALL_TASK_NAME } = require('./nodeHeartbeat.js');
const { DIGEST_TASK_NAME } = require('./pulseDigest.js');
const { SQL_TASK_NAME } = require('./unappliedSql.js');
const { TASK_NAME: BROKEN_LINKS_TASK_NAME } = require('./brokenLinksTicket.js');

/** The boards the bus moves in, each tagged `noticeboard` once moved. */
const BOARD_NAMES = Object.freeze([
  ...ALL_TASK_NAMES,
  DIGEST_TASK_NAME,
  ROLL_CALL_TASK_NAME,
  SQL_TASK_NAME,
  BROKEN_LINKS_TASK_NAME,
]);

/** Names with an old copy that is archived even though the bus holds none. */
const ARCHIVE_WITHOUT_REPLACEMENT = Object.freeze([SWITCH_TASK_NAME]);

const ARCHIVE_SUFFIX = ' (ClickUp archive)';

const norm = (name) => String(name ?? '').trim().toLowerCase();
const BOARDS = new Set(BOARD_NAMES.map(norm));
const ORPHANS = new Set(ARCHIVE_WITHOUT_REPLACEMENT.map(norm));

/** The archive name of an old copy. */
function archiveName(name) {
  return `${String(name).trim()}${ARCHIVE_SUFFIX}`;
}

/** Tags as lower-case words, from ClickUp's `[{ name }]` or plain strings. */
function tagWords(ticket) {
  const tags = Array.isArray(ticket?.tags) ? ticket.tags : [];
  return tags.map((t) => norm(t && typeof t === 'object' ? t.name : t)).filter(Boolean);
}

/** A ticket's creation time in ms, from `created` (ms or ISO), or null. */
function createdMs(ticket) {
  const v = ticket?.created;
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : (/^\d+$/.test(String(v)) ? Number(v) : Date.parse(v));
  return Number.isFinite(n) ? n : null;
}

const iso = (ms) => new Date(ms).toISOString();

/**
 * What to do, from the two projects' tickets (every ticket, Live included,
 * each `{ id, name, tags, created }`). `lastWrittenAt` maps a pause-switch
 * ticket's id to its newest comment's time (ms), or null when it has none.
 * `{ cutoff, renames: [{ id, from, to }], kept: [{ id, name, why }],
 *    moves: [{ id, name, tag }], problems: [] }`.
 * A plan with problems must not be carried out at all.
 */
function planBusMove({ projectTickets, busTickets, lastWrittenAt = {} }) {
  const problems = [];
  if (!Array.isArray(projectTickets)) problems.push('the project\'s tickets could not be read, so nothing can be planned');
  if (!Array.isArray(busTickets)) problems.push('the bus project\'s tickets could not be read, so nothing can be planned');
  if (problems.length) return { cutoff: null, renames: [], kept: [], moves: [], problems };

  const busNames = new Map();
  for (const t of busTickets) {
    const key = norm(t.name);
    if (!BOARDS.has(key)) continue;
    if (busNames.has(key)) problems.push(`the bus holds two "${t.name}" tickets (${busNames.get(key)} and ${t.id}); decide which is the board before moving either`);
    else busNames.set(key, t.id);
  }

  let cutoff = null;
  for (const t of busTickets) {
    const at = createdMs(t);
    if (at == null) { problems.push(`${t.id} on the bus has no readable creation date, so which copies are ClickUp-era cannot be told`); continue; }
    if (cutoff == null || at < cutoff) cutoff = at;
  }

  const renames = [];
  const kept = [];
  if (busTickets.length && cutoff != null) {
    for (const t of projectTickets) {
      const key = norm(t.name);
      const board = busNames.has(key);
      const orphan = ORPHANS.has(key);
      if (!board && !orphan) continue;
      const at = createdMs(t);
      if (at == null) { problems.push(`${t.id} "${t.name}" has no readable creation date, so whether it is a ClickUp-era copy cannot be told`); continue; }
      if (board) {
        if (at >= cutoff) problems.push(`${t.id} "${t.name}" was created ${iso(at)}, after the bus's own boards (${iso(cutoff)}), so it is not a ClickUp-era copy: decide whether it or ${busNames.get(key)} is the board before moving`);
        else renames.push({ id: t.id, from: t.name, to: archiveName(t.name) });
        continue;
      }
      // The pause switch: archived only when it is old AND nobody has written to it since.
      if (at >= cutoff) { kept.push({ id: t.id, name: t.name, why: `created ${iso(at)}, after ${iso(cutoff)}: a switch somebody made, left alone` }); continue; }
      if (!Object.prototype.hasOwnProperty.call(lastWrittenAt, t.id)) { problems.push(`${t.id} "${t.name}" was not read for its newest record, so whether somebody is using it cannot be told`); continue; }
      const wrote = lastWrittenAt[t.id];
      if (wrote != null && !Number.isFinite(wrote)) { problems.push(`${t.id} "${t.name}" has an unreadable newest-record time, so whether somebody is using it cannot be told`); continue; }
      if (wrote != null && wrote >= cutoff) { kept.push({ id: t.id, name: t.name, why: `last written ${iso(wrote)}, after ${iso(cutoff)}: a switch in use, left alone` }); continue; }
      renames.push({ id: t.id, from: t.name, to: archiveName(t.name) });
    }
  }
  const moves = busTickets.map((t) => ({ id: t.id, name: t.name, tag: BOARDS.has(norm(t.name)) && !tagWords(t).includes(NOTICEBOARD_TAG) }));
  return { cutoff, renames, kept, moves, problems };
}

/**
 * Comments posted on the archives at or after `sinceMs`: posts that landed on
 * an old copy between the merge and the move, named so nobody loses them.
 * `records` is `[{ id, name, comments: [{ createdAt, body }] }]`.
 */
function commentsSince(records, sinceMs) {
  const out = [];
  for (const r of records) {
    for (const c of r.comments || []) {
      const at = Date.parse(c.createdAt ?? c.date ?? '');
      const ms = Number.isFinite(at) ? at : Number(c.date);
      if (Number.isFinite(ms) && ms >= sinceMs) out.push({ id: r.id, name: r.name, at: iso(ms), firstLine: String(c.body ?? c.comment_text ?? '').split('\n')[0].slice(0, 140) });
    }
  }
  return out;
}

/**
 * After the move: every board name the project holds, plus every name in
 * `boards` (the ones a run moved), is exactly one ticket, tagged
 * `noticeboard`; and the bus is empty. `{ ok, problems }`. Checking every
 * board the project holds, not just this run's, is what lets a rerun after a
 * partial run re-check the boards an earlier run moved.
 */
function checkMoved({ projectTickets, busTickets, boards = [] }) {
  const problems = [];
  if (!Array.isArray(projectTickets) || !Array.isArray(busTickets)) {
    return { ok: false, problems: ['the projects could not be read back, so the move is unchecked'] };
  }
  const want = new Map();
  for (const name of boards) want.set(norm(name), String(name).trim());
  for (const t of projectTickets) if (BOARDS.has(norm(t.name)) && !want.has(norm(t.name))) want.set(norm(t.name), String(t.name).trim());
  for (const [key, name] of want) {
    const same = projectTickets.filter((t) => norm(t.name) === key);
    if (same.length !== 1) {
      problems.push(`the project holds ${same.length} "${name}" ticket(s) (${same.map((t) => t.id).join(', ') || 'none'}); it must hold exactly one`);
      continue;
    }
    if (!tagWords(same[0]).includes(NOTICEBOARD_TAG)) problems.push(`${same[0].id} "${name}" is not tagged ${NOTICEBOARD_TAG}`);
  }
  if (busTickets.length) problems.push(`the bus project still holds ${busTickets.length} ticket(s): ${busTickets.map((t) => t.id).join(', ')}`);
  return { ok: problems.length === 0, problems };
}

module.exports = {
  ARCHIVE_SUFFIX,
  ARCHIVE_WITHOUT_REPLACEMENT,
  BOARD_NAMES,
  archiveName,
  checkMoved,
  commentsSince,
  createdMs,
  planBusMove,
  tagWords,
};
