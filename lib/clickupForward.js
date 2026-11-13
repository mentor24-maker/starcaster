'use strict';

/**
 * What is left of the app's ClickUp door: the ClickUp ids two scheduled
 * scripts still read (scripts/broken_links_check.mjs and
 * scripts/unapplied_sql_watch.mjs, both on SC-791's last slice).
 *
 * Every WRITE the live app made through this file (a bug report filed as a
 * held task, an AI alarm posted to the ClickUp bus) moved to the tracker on
 * SC-796 and lives in lib/trackerForward.js now. Nothing here talks to
 * ClickUp any more, on purpose: a second door that still worked would be
 * where the next alarm went quietly to a list nobody reads.
 */

const LOOP_QUEUE_LIST_ID = String(process.env.CLICKUP_LOOP_QUEUE_LIST_ID || '901418546619');
const OPERATOR_USER_ID_RAW = Number(process.env.CLICKUP_OPERATOR_ID || 48012725);
// A garbage env value must not become NaN — fall back to the real id.
const OPERATOR_USER_ID = Number.isFinite(OPERATOR_USER_ID_RAW) ? OPERATOR_USER_ID_RAW : 48012725;
const MACHINE_USER_ID = 54254347;

module.exports = {
  LOOP_QUEUE_LIST_ID,
  OPERATOR_USER_ID,
  MACHINE_USER_ID,
};
