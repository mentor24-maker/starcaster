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
 * Team chat is the OLDEST (loop/lib/trackerBus.js, lib/trackerForward.js),
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
 * Nothing here is done from a guess. A rerun after a partial run plans only
 * what is left: an old copy is renamed only while the bus still holds a
 * ticket to replace it, or (the pause switch) while the bus still holds
 * anything at all. Once the bus is empty the plan is empty.
 */

const { ALL_TASK_NAMES } = require('../loop/lib/busFallback.js');
const { SWITCH_TASK_NAME } = require('../loop/lib/pipelinePause.js');
const { NOTICEBOARD_TAG } = require('../loop/lib/loopNoticeboards.js');
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

/**
 * What to do, from the two projects' tickets (every ticket, Live included).
 * `{ renames: [{ id, from, to }], moves: [{ id, name, tag }], problems: [] }`.
 * A plan with problems must not be carried out at all.
 */
function planBusMove({ projectTickets, busTickets }) {
  const problems = [];
  if (!Array.isArray(projectTickets)) problems.push('the project\'s tickets could not be read, so nothing can be planned');
  if (!Array.isArray(busTickets)) problems.push('the bus project\'s tickets could not be read, so nothing can be planned');
  if (problems.length) return { renames: [], moves: [], problems };

  const busNames = new Map();
  for (const t of busTickets) {
    const key = norm(t.name);
    if (!BOARDS.has(key)) continue;
    if (busNames.has(key)) problems.push(`the bus holds two "${t.name}" tickets (${busNames.get(key)} and ${t.id}); decide which is the board before moving either`);
    else busNames.set(key, t.id);
  }

  const renames = [];
  if (busTickets.length) {
    for (const t of projectTickets) {
      const key = norm(t.name);
      if (busNames.has(key) || ORPHANS.has(key)) renames.push({ id: t.id, from: t.name, to: archiveName(t.name) });
    }
  }
  const moves = busTickets.map((t) => ({ id: t.id, name: t.name, tag: BOARDS.has(norm(t.name)) && !tagWords(t).includes(NOTICEBOARD_TAG) }));
  return { renames, moves, problems };
}

/**
 * After the move: one ticket per moved board name in the project, tagged
 * `noticeboard`, and the bus empty. `{ ok, problems }`. `boards` is the names that were moved.
 */
function checkMoved({ projectTickets, busTickets, boards }) {
  const problems = [];
  if (!Array.isArray(projectTickets) || !Array.isArray(busTickets)) {
    return { ok: false, problems: ['the projects could not be read back, so the move is unchecked'] };
  }
  for (const name of boards) {
    const same = projectTickets.filter((t) => norm(t.name) === norm(name));
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
  planBusMove,
  tagWords,
};
