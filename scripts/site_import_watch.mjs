#!/usr/bin/env node
/**
 * `npm run site-import-watch` — is a Site Import waiting with nothing to run it?
 *
 * Reads production's import queue READ-ONLY and names any job queued over an
 * hour with no claim. The why, the verdicts and where it runs are in
 * lib/siteImportWatch.js; this file only reads, keeps the stamp and posts.
 *
 *   npm run site-import-watch                       read and print, write nothing
 *   npm run site-import-watch -- --check            the same, and post to the bus (once per job)
 *   npm run site-import-watch -- --check --dry-run  say what it WOULD post, send nothing, stamp nothing
 *
 * HOW IT READS PRODUCTION. The Doppler `dev` config this runs under points
 * SUPABASE_URL at the database on this machine, so reading through the store
 * would answer "no imports waiting" about the wrong database — the silent
 * all-clear this whole ticket is about. It uses PROD_DB_READONLY_URL instead,
 * through psql inside the local Supabase container, the way db_refresh.mjs
 * does: the connection is handed over as PG* variables, so the password never
 * reaches the process table. No reading is CANNOT TELL, never OK.
 *
 * Exit: 0 OK, 1 WAITING, 2 CANNOT TELL. run_bus_relay.sh guards the call with
 * `|| true` — a finding about the queue is not this script's failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const watch = require('../lib/siteImportWatch.js');
const heartbeat = require('../lib/nodeHeartbeat.js');
const roles = require('../lib/nodeRoles.js');

const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
const DB_CONTAINER = 'supabase_db_starcaster';
const ROLE = 'site-import-worker';

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const DRY = argv.includes('--dry-run');

const STAMP = path.join(heartbeat.heartbeatDir(), 'site-import-watch.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch { return {}; }
}

function connectionEnv(url) {
  const parsed = new URL(url);
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: parsed.pathname.replace(/^\//, '') || 'postgres',
  };
}

const SQL = `select coalesce(json_agg(json_build_object(
  'id', id, 'sourceUrl', source_url, 'projectId', project_id, 'status', status,
  'claimedAt', claimed_at, 'createdAt', created_at)), '[]'::json)
from app_site_import_jobs where status = 'queued';`;

function readQueue() {
  const url = String(process.env.PROD_DB_READONLY_URL || '').trim();
  if (!url) return { jobs: null, error: 'PROD_DB_READONLY_URL is not set where this check runs (the Doppler dev config)' };
  let env;
  try { env = connectionEnv(url); } catch { return { jobs: null, error: 'PROD_DB_READONLY_URL is not a valid URL' }; }
  const args = ['exec', '-i'];
  for (const key of Object.keys(env)) args.push('-e', key);
  args.push(DB_CONTAINER, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-');
  try {
    const out = execFileSync('docker', args, {
      input: SQL,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { jobs: JSON.parse(out.trim() || '[]') };
  } catch (err) {
    // stderr from psql never carries the password (it came in by environment).
    const detail = String(err?.stderr || err?.message || err).split('\n').find((l) => l.trim()) || 'unknown error';
    return { jobs: null, error: `psql in the ${DB_CONTAINER} container failed: ${detail.slice(0, 200)}` };
  }
}

const reading = readQueue();
const judged = watch.judge(reading);
console.log(`site-import-watch: ${judged.verdict} — ${judged.reason}`);
for (const job of judged.stale) {
  console.log(`  ${job.id}  ${job.sourceUrl}  ${job.waitedMs == null ? 'unreadable date' : `waiting ${watch.waitText(job.waitedMs)}`}`);
}

if (CHECK) {
  const verdict = roles.checkRole(ROLE);
  if (!verdict.owned) {
    // Only the owning machine posts, so "once per job" is true (see the lib).
    // 'unidentified' is said out loud rather than skipped quietly.
    console.log(`site-import-watch: not posting — ${verdict.message.split('\n')[0]}`);
  } else {
    const node = verdict.node.name;
    const at = new Date().toISOString();
    const decided = watch.plan({ judged, state: readState() });
    const posts = [];
    if (decided.alarm.length) posts.push(watch.renderAlarm({ jobs: decided.alarm, node, at }));
    if (decided.cleared.length) posts.push(watch.renderClear({ ids: decided.cleared, node, at }));
    if (decided.cannotTell) posts.push(watch.renderCannotTell({ judged, node, at }));
    if (!posts.length) console.log('site-import-watch: nothing new to say on the bus.');

    if (DRY) {
      for (const text of posts) console.log(`--- would post to the bus (${BUS_CHANNEL}) ---\n${text}`);
      if (posts.length) console.log('--- (dry run: nothing sent, nothing stamped) ---');
    } else {
      let sent = true;
      if (posts.length) {
        const clickup = require('./lib/clickup.cjs');
        for (const text of posts) {
          try {
            clickup.postBusMessage(BUS_CHANNEL, text);
          } catch (err) {
            sent = false;
            console.error(`site-import-watch: could NOT post to the bus (${String(err?.message || err).slice(0, 300)}); not stamping it as sent.`);
          }
        }
      }
      // Not stamped on a failed post, so the next wake tries again rather than going quiet.
      if (sent) {
        fs.mkdirSync(heartbeat.heartbeatDir(), { recursive: true });
        fs.writeFileSync(STAMP, `${JSON.stringify(decided.next, null, 2)}\n`);
        if (posts.length) console.log('site-import-watch: posted to the bus.');
      }
    }
  }
}

process.exit(watch.EXIT[judged.verdict]);
