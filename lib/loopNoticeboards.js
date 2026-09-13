'use strict';

/**
 * WHICH LOOP QUEUE TICKETS ARE NOT WORK.
 *
 * WHY THIS EXISTS (task 86bbwab1n, review round 1, 2026-09-08)
 * Four pieces of machinery keep a standing ticket in the Loop Queue and
 * rewrite it in place: the roll call (`lib/nodeHeartbeat.js`), the pipeline
 * pulse digest (`lib/pulseDigest.js`), the undelivered-alarm noticeboard
 * (`lib/busFallback.js`) and the pause switch
 * (`scripts/builder/pipelinePause.js`). None of them is work. All four are
 * created in a closed-type status — `Live` — so that no loop claims them, and
 * ClickUp stamps `date_closed` at the moment of creation. Measured on the
 * real one:
 *
 *     GET /api/v2/task/86bbwf1nr
 *     status: live  type: closed
 *     date_created: 1788869992734   date_closed: 1788869992734   (identical)
 *
 * `lib/loopThroughput.js` counts a closure off `date_closed` and nothing else,
 * so each of those creations reads as A TICKET THAT SHIPPED. On 2026-09-08 the
 * throughput report said one ticket closed that day; the one ticket was the
 * alarm noticeboard, and nothing real had shipped at all.
 *
 * THAT IS NOT A WRONG-BY-ONE NUMBER. `verdict()` short-circuits to MOVING the
 * moment anything closed inside the window, so on a quiet day during an outage
 * — zero real closures, open work sitting — saving a single alarm flips
 * STALLED to MOVING for the next 24 hours. The stall detector goes quiet on
 * exactly the day the bus is down, and the thing that silences it is the alarm
 * it was trying to save. That inverts the one property the throughput check
 * exists for: "alive but useless must never render as healthy".
 *
 * THE FOURTH ONE WAS MISSED, AND THE TEST COULD NOT SEE IT (review round 2,
 * same day). The pause switch was created by `scripts/pipeline.mjs` with the
 * seed sentence written inline, and the enforcing test scanned `lib/` only —
 * so the registry shipped stale, the test passed, and the docs stated as fact
 * that a fourth standing ticket left out of this list would fail. It was left
 * out and nothing failed. The switch is registered below now, and the seed
 * text moved to `pipelinePause.js` beside the name it seeds, so the scan is
 * structurally able to find it. The consequence it was leaking is exact: the
 * first `npm run pipeline -- pause` on a fresh switch creates a ticket that
 * reads as one that shipped, flipping STALLED to MOVING for 24 hours on a day
 * when nothing is shipping BY DESIGN because the line is paused.
 *
 * WHY BY NAME. A noticeboard's identity already IS its name — all four find
 * theirs by name and create it on first need, precisely so a recorded id
 * cannot rot when somebody deletes the ticket. Excluding by the same string
 * they are found by keeps one definition rather than two.
 *
 * WHY NOT MOVE THEM OUT OF THE LIST INSTEAD. It was the other option offered
 * in review, and it is worse in one specific way: every one of these four
 * tickets is created on first need, on a machine that may be mid-outage, into
 * whichever list it can reach. A second list is a second thing that has to
 * exist, and a create that fails because it does not is a lost alarm at the
 * exact moment the alarm matters. The list is fine; counting is what was
 * wrong.
 *
 * NOTHING HERE TOUCHES THE NETWORK OR THE CLOCK — it is a set of strings and
 * two predicates over ticket objects the caller already fetched.
 */

const busFallback = require('./busFallback.js');
const nodeHeartbeat = require('./nodeHeartbeat.js');
const pulseDigest = require('./pulseDigest.js');
// Reaching from lib/ into scripts/builder/ is the established direction here
// (lib/loopThroughput.js already requires wipCap and loopStatuses that way).
const pipelinePause = require('../scripts/builder/pipelinePause.js');

/**
 * The sentence every standing ticket's seed description opens with.
 *
 * It is repeated here so a test can find the noticeboards BY THEIR OWN WORDS
 * rather than by a list somebody has to remember to update: a fifth standing
 * ticket written in the same shape as these four, and left out of the registry
 * below, fails `loopNoticeboards.test.js`. Without that, this file is a list
 * that goes quietly stale — which is the failure mode of every other
 * hand-maintained list in this repo.
 *
 * THE SCAN ONLY REACHES WHAT IT CAN REQUIRE, so the same test refuses this
 * sentence anywhere else: an ESM script under `scripts/` runs on import and
 * cannot be required, which is exactly how the pause switch hid from round 1's
 * version of this check. Seed text belongs in the CJS module that exports the
 * `*_TASK_NAME` it seeds.
 */
const SEED_PHRASE = 'Do not build this, do not close it, do not delete it.';

/**
 * Every standing ticket, by the name its owner finds it by.
 *
 * Read from the owning modules rather than re-typed, so renaming a noticeboard
 * cannot leave the exclusion pointing at the old string — the drift that
 * `TERMINAL_STATUSES` was consolidated to end (task 86bbtujed).
 */
const NOTICEBOARD_NAMES = [
  busFallback.FALLBACK_TASK_NAME,
  nodeHeartbeat.ROLL_CALL_TASK_NAME,
  pulseDigest.DIGEST_TASK_NAME,
  pipelinePause.SWITCH_TASK_NAME,
];

const NORMALISED = new Set(NOTICEBOARD_NAMES.map((n) => String(n).trim().toLowerCase()));

/** Is this ticket a noticeboard rather than a piece of work? */
function isNoticeboard(task) {
  return NORMALISED.has(String(task?.name ?? '').trim().toLowerCase());
}

/**
 * The tickets that are actually WORK, and the array guard in one place.
 *
 * Every reader in `lib/loopThroughput.js` used to open with
 * `Array.isArray(tasks) ? tasks : []`; they call this instead, so the
 * exclusion cannot be applied to some questions and not others. A count of
 * closures that excluded the noticeboards while a backlog curve included them
 * would put two numbers for the same queue in one report — the disagreement
 * that file was written against.
 */
function workTickets(tasks) {
  return (Array.isArray(tasks) ? tasks : []).filter((t) => !isNoticeboard(t));
}

module.exports = {
  NOTICEBOARD_NAMES,
  SEED_PHRASE,
  isNoticeboard,
  workTickets,
};
