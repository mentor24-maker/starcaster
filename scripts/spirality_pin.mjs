#!/usr/bin/env node
/**
 * `npm run spirality:pin` — does `.spirality-release` (the Spirality release
 * GitHub's checks download) name the release StarCaster's lanes run? (SC-870)
 *
 *   npm run spirality:pin                       read and print, write nothing
 *   npm run spirality:pin -- --check            the same, and post to the bus (once a day per verdict)
 *   npm run spirality:pin -- --check --dry-run  say what it WOULD post, send nothing, stamp nothing
 *
 * Reads two small files, no network: the pin, and the release Spirality's
 * runner records StarCaster ran last (lib/spirality.cjs `laneRelease`). The
 * verdicts are in lib/spiralityPin.js.
 *
 * Posts only from the machine owning `bus-relay`, so "once a day" is true with
 * one poster. Not stamped on a failed post, so the next wake tries again.
 * SPIRALITY_PIN_STAMP moves the once-a-day stamp (the tests use it);
 * SPIRALITY_RELEASES_DIR moves the releases folder, as it does for Spirality.
 *
 * Exit: 0 IN STEP, 1 OUT OF STEP, 2 CANNOT TELL. run_bus_relay.sh guards the
 * call with `|| true`: a reading is not this script's failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pin = require('../lib/spiralityPin.js');
const spirality = require('../lib/spirality.cjs');

const ROLE = 'bus-relay';
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const DRY = argv.includes('--dry-run');

function stampPath() {
  if (process.env.SPIRALITY_PIN_STAMP) return process.env.SPIRALITY_PIN_STAMP;
  return path.join(require('../lib/nodeHeartbeat.js').heartbeatDir(), 'spirality-pin.json');
}
function readState() {
  try { return JSON.parse(fs.readFileSync(stampPath(), 'utf8')); } catch { return {}; }
}
function writeState(next) {
  const file = stampPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}

let pinned = '';
let error = '';
try { pinned = spirality.pinnedRelease(); } catch (err) { error = err.message; }
const lanes = spirality.laneRelease();
if (!lanes && !error) error = `no last-starcaster in ${spirality.releasesDir()}`;
const judged = pin.judge({ pinned, lanes, error });

console.log(`spirality:pin: ${judged.verdict} — ${judged.reason}`);

if (CHECK) {
  const verdict = require('../lib/nodeRoles.js').checkRole(ROLE);
  if (!verdict.owned) {
    console.log(`spirality:pin: not posting — ${verdict.message.split('\n')[0]}`);
  } else {
    const node = verdict.node.name;
    const at = new Date().toISOString();
    const decided = pin.plan({ judged, state: readState() });
    const posts = [];
    if (decided.out) posts.push(pin.renderOut({ judged, node, at }));
    if (decided.cannotTell) posts.push(pin.renderCannotTell({ judged, node, at }));
    if (decided.cleared) posts.push(pin.renderClear({ judged, node, at }));
    if (!posts.length) console.log('spirality:pin: nothing new to say on the bus.');

    if (DRY) {
      for (const text of posts) console.log(`--- would post to the bus ---\n${text}`);
      if (posts.length) console.log('--- (dry run: nothing sent, nothing stamped) ---');
    } else {
      let sent = true;
      if (posts.length) {
        const clickup = require('./lib/clickup.cjs');
        for (const text of posts) {
          try {
            clickup.postBusMessage(text);
          } catch (err) {
            sent = false;
            console.error(`spirality:pin: could NOT post to the bus (${String(err?.message || err).slice(0, 300)}); not stamping it as sent.`);
          }
        }
      }
      if (sent) {
        writeState({ ...decided.next, readAt: at, lastVerdict: judged.verdict });
        if (posts.length) console.log('spirality:pin: posted to the bus.');
      }
    }
  }
}

process.exit(pin.EXIT[judged.verdict]);
