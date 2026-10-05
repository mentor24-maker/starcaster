#!/usr/bin/env node
/**
 * `npm run worker-watch` — can production reach the YouTube download helper?
 *
 * Probes `<YOUTUBE_MEDIA_WORKER_URL>/health` through the PUBLIC address (open,
 * no secret needed). The why, the verdicts and where it runs are in
 * lib/workerWatch.js; this file only probes, keeps the stamps and posts.
 *
 *   npm run worker-watch                       probe and print, write nothing
 *   npm run worker-watch -- --check            the same, and post to the bus on UNREACHABLE / CANNOT TELL
 *   npm run worker-watch -- --check --dry-run  say what it WOULD post, send nothing, stamp nothing
 *   npm run worker-watch -- --url <base>       probe a different address (rehearsal)
 *
 * Exit: 0 OK, 1 UNREACHABLE, 2 CANNOT TELL. run_bus_relay.sh guards the call
 * with `|| true` — a finding about the helper is not this script's failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const watch = require('../lib/workerWatch.js');
const heartbeat = require('../lib/nodeHeartbeat.js');
const clickup = require('./lib/clickup.cjs');

const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
const TIMEOUT_MS = 15000;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const CHECK = flag('check');
const DRY = flag('dry-run');

// One stamp per kind of alarm, so an UNREACHABLE does not reset the clock of a
// CANNOT TELL or the other way round. Beside the heartbeat's own stamps.
const STAMPS = {
  [watch.VERDICT.UNREACHABLE]: path.join(heartbeat.heartbeatDir(), 'worker-watch-unreachable.stamp'),
  [watch.VERDICT.CANNOT_TELL]: path.join(heartbeat.heartbeatDir(), 'worker-watch-cannot-tell.stamp'),
};
const readStamp = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };

async function probe(url) {
  if (!url) return null;
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.text().catch(() => '');
    return { status: res.status, body };
  } catch (err) {
    const cause = err?.cause?.code || err?.cause?.message || '';
    const msg = err?.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000}s` : String(err?.message || err);
    return { error: cause ? `${msg}: ${cause}` : msg };
  }
}

const url = (arg('url') || watch.workerUrl()).replace(/\/+$/, '');
const judged = watch.judge({ url, probe: await probe(url) });
console.log(`worker-watch: ${judged.verdict} — ${judged.reason}`);

if (CHECK) {
  const node = (require('../lib/nodeRoles.js').thisNode().name) || 'an unnamed machine';
  const at = new Date().toISOString();
  const anyOpen = Object.values(STAMPS).some((file) => readStamp(file));
  const decided = watch.plan({ verdict: judged.verdict, alarmAt: readStamp(STAMPS[judged.verdict] || ''), anyOpen });
  console.log(`worker-watch: ${decided.action} — ${decided.why}`);

  if (decided.action !== 'none') {
    const text = decided.action === 'post'
      ? watch.renderAlarm({ judged, node, at })
      : watch.renderClear({ judged, node, at });
    if (DRY) {
      console.log(`--- would post to the bus (${BUS_CHANNEL}) ---\n${text}\n--- (dry run: nothing sent, nothing stamped) ---`);
    } else {
      try {
        clickup.postBusMessage(BUS_CHANNEL, text);
        fs.mkdirSync(heartbeat.heartbeatDir(), { recursive: true });
        if (decided.action === 'post') {
          fs.writeFileSync(STAMPS[judged.verdict], `${at}\n`);
          // The other kind of alarm is no longer the current state.
          for (const [verdict, file] of Object.entries(STAMPS)) if (verdict !== judged.verdict) fs.rmSync(file, { force: true });
        } else {
          for (const file of Object.values(STAMPS)) fs.rmSync(file, { force: true });
        }
        console.log('worker-watch: posted to the bus.');
      } catch (err) {
        // Not stamped, so the next wake tries again rather than going quiet.
        console.error(`worker-watch: could NOT post to the bus (${String(err?.message || err).slice(0, 300)}); not stamping it as sent.`);
      }
    }
  }
}

process.exit(watch.EXIT[judged.verdict]);
