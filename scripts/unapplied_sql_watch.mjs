#!/usr/bin/env node
/**
 * `npm run sql:unapplied` — does production have every table and column the
 * docs/SQL files declare?
 *
 * Reads production's structure READ-ONLY and names every docs/SQL file that
 * declares something production lacks. The why, the verdicts and what it
 * cannot see are in lib/unappliedSql.js; this file only reads, keeps the
 * stamp and posts.
 *
 *   npm run sql:unapplied                       read and print, write nothing
 *   npm run sql:unapplied -- --check            the same, and post to the bus (once a day per file)
 *   npm run sql:unapplied -- --check --dry-run  say what it WOULD post, send nothing, stamp nothing
 *
 * HOW IT READS PRODUCTION. The Doppler `dev` config this runs under points
 * SUPABASE_URL at the database on this machine, so asking the store would
 * answer about the wrong database — every file "applied", the silent
 * all-clear this ticket is about. It uses PROD_DB_READONLY_URL instead,
 * through psql inside the local Supabase container, the way
 * site_import_watch.mjs does: the connection goes in as PG* variables, so the
 * password never reaches the process table. No reading is CANNOT TELL.
 *
 * WHICH FILES. The ones in THIS checkout. On the relay that is the main
 * checkout, which run_bus_relay.sh fast-forwards first — so it checks what
 * has merged, which is what is live.
 *
 * Exit: 0 OK, 1 UNAPPLIED, 2 CANNOT TELL. run_bus_relay.sh guards the call
 * with `|| true` — a finding about production is not this script's failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const unapplied = require('../lib/unappliedSql.js');
const heartbeat = require('../lib/nodeHeartbeat.js');
const roles = require('../lib/nodeRoles.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = path.join(ROOT, 'docs', 'SQL');
const BUS_CHANNEL = process.env.CLICKUP_BUS_CHANNEL || '2kydhxeu-474';
const DB_CONTAINER = 'supabase_db_starcaster';
// One poster, so "once a day per file" is true. The relay's owner is already
// awake every ten minutes; its being switched off is the heartbeat's to catch.
const ROLE = 'bus-relay';

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const DRY = argv.includes('--dry-run');

const STAMP = path.join(heartbeat.heartbeatDir(), 'unapplied-sql-watch.json');

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

const SQL = `select coalesce(json_agg(json_build_object('table', table_name, 'column', column_name)), '[]'::json)
from information_schema.columns where table_schema = 'public';`;

function readProduction() {
  const url = String(process.env.PROD_DB_READONLY_URL || '').trim();
  if (!url) return { live: null, error: 'PROD_DB_READONLY_URL is not set where this check runs (the Doppler dev config)' };
  let env;
  try { env = connectionEnv(url); } catch { return { live: null, error: 'PROD_DB_READONLY_URL is not a valid URL' }; }
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
      maxBuffer: 1024 * 1024 * 32,
    });
    return { live: JSON.parse(out.trim() || '[]') };
  } catch (err) {
    // stderr from psql never carries the password (it came in by environment).
    const detail = String(err?.stderr || err?.message || err).split('\n').find((l) => l.trim()) || 'unknown error';
    return { live: null, error: `psql in the ${DB_CONTAINER} container failed: ${detail.slice(0, 200)}` };
  }
}

const files = fs.readdirSync(SQL_DIR)
  .filter((name) => name.endsWith('.sql'))
  .map((file) => ({ file, sql: fs.readFileSync(path.join(SQL_DIR, file), 'utf8') }));
const { expected, superseded } = unapplied.expectedObjects(files);
const reading = readProduction();
const judged = unapplied.judge({ expected, ...reading });

console.log(`sql:unapplied: ${judged.verdict} — ${judged.reason}`);
console.log(`  read ${files.length} files in docs/SQL: ${expected.length} tables and columns to look for`
  + (superseded ? `, ${superseded} skipped because a later file renames or drops them` : ''));
for (const f of judged.files) {
  console.log(`  MISSING  ${f.file}: ${f.missing.map(unapplied.describeMissing).join(', ')}`);
}
for (const f of judged.excused) {
  console.log(`  explained  ${f.file}: ${f.missing.map(unapplied.describeMissing).join(', ')} — ${f.reason}`);
}
console.log('  (tables and columns only — indexes, policies, functions and data changes are not checked)');

if (CHECK) {
  const verdict = roles.checkRole(ROLE);
  if (!verdict.owned) {
    // 'unidentified' is said out loud rather than skipped quietly.
    console.log(`sql:unapplied: not posting — ${verdict.message.split('\n')[0]}`);
  } else {
    const node = verdict.node.name;
    const at = new Date().toISOString();
    const decided = unapplied.plan({ judged, state: readState() });
    const posts = [];
    if (decided.alarm.length) posts.push(unapplied.renderAlarm({ files: decided.alarm, node, at }));
    if (decided.cleared.length) posts.push(unapplied.renderClear({ files: decided.cleared, node, at }));
    if (decided.explained.length) posts.push(unapplied.renderExplained({ files: decided.explained, node, at }));
    if (decided.cannotTell) posts.push(unapplied.renderCannotTell({ judged, node, at }));
    if (!posts.length) console.log('sql:unapplied: nothing new to say on the bus.');

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
            console.error(`sql:unapplied: could NOT post to the bus (${String(err?.message || err).slice(0, 300)}); not stamping it as sent.`);
          }
        }
      }
      // Not stamped on a failed post, so the next wake tries again rather than going quiet.
      if (sent) {
        fs.mkdirSync(heartbeat.heartbeatDir(), { recursive: true });
        fs.writeFileSync(STAMP, `${JSON.stringify(decided.next, null, 2)}\n`);
        if (posts.length) console.log('sql:unapplied: posted to the bus.');
      }
    }
  }
}

process.exit(unapplied.EXIT[judged.verdict]);
