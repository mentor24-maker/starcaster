#!/usr/bin/env node
/**
 * `npm run broken-links` — which links on client sites point at a page that
 * no longer exists? (task 86bcxn69z)
 *
 * Renaming a page cannot break a link to it any more — links store the page
 * itself (86bcxmrw2). Deleting one still can. The Pages screen warns at the
 * moment of deleting; this is the backstop, across every project, once a week.
 * The scan is lib/pageInboundLinks.js — the same one the delete warning uses —
 * and the ticket text is lib/brokenLinksTicket.js.
 *
 *   npm run broken-links                         read production and print, write nothing
 *   npm run broken-links -- --local              the same against this machine's database
 *   npm run broken-links -- --project <id>       one project only
 *   npm run broken-links -- --check              the scheduled pass: weekly, owner only,
 *                                                rewrites the "Broken links on client sites" ticket
 *   npm run broken-links -- --check --dry-run    say what it WOULD write, write nothing, stamp nothing
 *   npm run broken-links -- --check --force      ignore the weekly throttle
 *
 * READ-ONLY. It never changes a site. Production is read through
 * PROD_DB_READONLY_URL with psql inside the local Supabase container, the way
 * scripts/unapplied_sql_watch.mjs does — the Doppler `dev` config points
 * SUPABASE_URL at this machine's database, so asking the stores would answer
 * about the wrong database. The password goes in as PG* variables, never on
 * the process table.
 *
 * ONE PROJECT AT A TIME, so a project that cannot be read is named — "could not
 * check: <project>" — and never counted as clean.
 *
 * Exit: 0 nothing broken, 1 broken links found, 2 CANNOT TELL (a project could
 * not be read, or the ticket could not be written). run_bus_relay.sh guards the
 * call with `|| true` — a finding about client sites is not this script's
 * failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scan = require('../lib/pageInboundLinks.js');
const ticketText = require('../lib/brokenLinksTicket.js');
const heartbeat = require('../lib/nodeHeartbeat.js');
const roles = require('../lib/nodeRoles.js');
const digest = require('../lib/pulseDigest.js');

const ROLE = 'broken-links-check';
// Created in Live, as every standing ticket is, so no loop ever claims it
// (lib/loopNoticeboards.js); the assignee is what puts it in front of Dane.
const TICKET_STATUS = 'Live';
const DB_CONTAINER = 'supabase_db_starcaster';
// A reading that could not be taken is retried hourly, not weekly — and not
// every ten minutes either, which would spend production disk IO on a failure.
const RETRY_AFTER_CANNOT_TELL_MS = 60 * 60 * 1000;

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const DRY = argv.includes('--dry-run');
const FORCE = argv.includes('--force');
const LOCAL = argv.includes('--local');
const ONLY = argv.includes('--project') ? String(argv[argv.indexOf('--project') + 1] || '') : '';

const STAMP = path.join(heartbeat.heartbeatDir(), 'broken-links-check.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch { return {}; }
}

function writeState(next) {
  fs.mkdirSync(heartbeat.heartbeatDir(), { recursive: true });
  fs.writeFileSync(STAMP, `${JSON.stringify(next, null, 2)}\n`);
}

// ------------------------------------------------------------------ reading

function connection() {
  if (LOCAL) return { env: { PGUSER: 'postgres', PGDATABASE: 'postgres' } };
  const url = String(process.env.PROD_DB_READONLY_URL || '').trim();
  if (!url) return { error: 'PROD_DB_READONLY_URL is not set where this check runs (the Doppler dev config)' };
  try {
    const parsed = new URL(url);
    return {
      env: {
        PGHOST: parsed.hostname,
        PGPORT: parsed.port || '5432',
        PGUSER: decodeURIComponent(parsed.username),
        PGPASSWORD: decodeURIComponent(parsed.password),
        PGDATABASE: parsed.pathname.replace(/^\//, '') || 'postgres',
      },
    };
  } catch {
    return { error: 'PROD_DB_READONLY_URL is not a valid URL' };
  }
}

function psqlJson(conn, sql, vars = {}) {
  const args = ['exec', '-i'];
  for (const key of Object.keys(conn.env)) args.push('-e', key);
  args.push(DB_CONTAINER, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1');
  for (const [key, value] of Object.entries(vars)) args.push('-v', `${key}=${value}`);
  args.push('-f', '-');
  try {
    const out = execFileSync('docker', args, {
      input: sql,
      encoding: 'utf8',
      env: { ...process.env, ...conn.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 256,
    });
    return { data: JSON.parse(out.trim() || 'null') };
  } catch (err) {
    // stderr from psql never carries the password (it came in by environment).
    const detail = String(err?.stderr || err?.message || err).split('\n').find((l) => l.trim()) || 'unknown error';
    return { error: `psql in the ${DB_CONTAINER} container failed: ${detail.slice(0, 200)}` };
  }
}

const PROJECTS_SQL = `select coalesce(json_agg(p order by p.id), '[]'::json) from (
  select ids.id, ap.name, ap.domain
  from (select distinct project_id as id from builder_landing_page where coalesce(project_id, '') <> '') ids
  left join app_projects ap on ap.id = ids.id
) p;`;

const PROJECT_SQL = `select json_build_object(
  'pages', coalesce((select json_agg(json_build_object('id', id::text, 'name', name, 'slug', slug, 'layout_sections', layout_sections))
                     from builder_landing_page where project_id = :'pid'), '[]'::json),
  'savedSections', coalesce((select json_agg(json_build_object('id', id::text, 'name', name, 'section', section))
                     from builder_saved_sections where project_id = :'pid'), '[]'::json),
  'forms', coalesce((select json_agg(json_build_object('id', id::text, 'name', name, 'fields', fields))
                     from crm_forms where project_id = :'pid'), '[]'::json)
);`;

function readProjects(conn) {
  if (conn.error) return { error: conn.error };
  const listed = psqlJson(conn, PROJECTS_SQL);
  if (listed.error) return { error: `listing the projects: ${listed.error}` };
  const projects = (Array.isArray(listed.data) ? listed.data : [])
    .filter((p) => !ONLY || p.id === ONLY)
    .map((p) => ({ id: String(p.id), name: String(p.name || ''), domain: String(p.domain || '') }));
  if (ONLY && !projects.length) return { error: `no project ${ONLY} has any pages` };
  for (const project of projects) {
    const got = psqlJson(conn, PROJECT_SQL, { pid: project.id });
    if (got.error || !got.data) { project.error = got.error || 'the read returned nothing'; continue; }
    const links = scan.collectProjectLinks({ ...got.data, domain: project.domain });
    project.pageCount = got.data.pages.length;
    project.broken = scan.brokenLinks(links, got.data.pages);
  }
  return { projects };
}

// ------------------------------------------------------------------ the scheduled half

let state = readState();
let verdict = null;
if (CHECK) {
  verdict = roles.checkRole(ROLE);
  if (!verdict.owned) {
    // 'unidentified' is said out loud rather than skipped quietly.
    console.log(`broken-links: not running — ${verdict.message.split('\n')[0]}`);
    process.exit(0);
  }
  const everyMs = state.lastVerdict === 'cannot-tell' ? RETRY_AFTER_CANNOT_TELL_MS : ticketText.CHECK_EVERY_MS;
  // A ticket remembered from ClickUp was never written on the tracker (SC-794),
  // so the first wake after the move takes its reading now rather than up to a
  // week later, and files the ticket where Dane now looks.
  const movedToTracker = !state.ticket || require('./lib/trackerDoor.cjs').isTrackerId(state.ticket.id);
  if (!FORCE && !DRY && movedToTracker && !ticketText.checkDue({ state, everyMs })) {
    console.log(`broken-links: last checked ${state.checkedAt}; the next check is not due yet.`);
    process.exit(0);
  }
}

const reading = readProjects(connection());
const projects = reading.error ? [{ id: 'every project', name: 'every project', domain: '', error: reading.error }] : reading.projects;
const read = projects.filter((p) => !p.error);
const failed = projects.filter((p) => p.error);
const brokenCount = read.reduce((sum, p) => sum + p.broken.length, 0);

console.log(`broken-links: ${read.length} project(s) read${LOCAL ? ' (this machine\'s database)' : ' (production)'}, `
  + `${brokenCount} broken link(s), ${failed.length} could not be checked.`);
for (const p of read) {
  console.log(`  ${p.broken.length ? 'BROKEN ' : 'ok     '} ${p.name || p.id}${p.domain ? ` (${p.domain})` : ''}: ${p.pageCount} page(s), ${p.broken.length} broken`);
  for (const link of p.broken) console.log(`      - ${scan.describeLink(link)} — ${link.reason}`);
}
for (const p of failed) console.log(`  COULD NOT CHECK ${p.name || p.id}: ${p.error}`);

const exitCode = failed.length ? 2 : brokenCount ? 1 : 0;

/**
 * Find the ticket (by the id this machine remembers, else by NAME — the name is
 * its identity, as with every standing ticket), create it if it does not
 * exist, rewrite its description and assignees, and read both back. Never adds
 * a comment and never touches another ticket. Same routine as the "SQL
 * waiting for you" writer in scripts/unapplied_sql_watch.mjs.
 */
async function writeTicket(rendered, remembered) {
  // The tracker, through the ticket door (SC-794): the ticket lives in the bus
  // project, beside "Team chat", and Dane's seat is the tracker's operator id.
  const tracker = require('./lib/trackerDoor.cjs');
  return tracker.writeStandingTicket({
    name: ticketText.TASK_NAME,
    body: rendered.body,
    assign: rendered.assign,
    remembered,
    status: TICKET_STATUS,
    // A description write that normalises to nothing still says ok (DOCTRINE §3.10).
    verdict: digest.digestWriteVerdict,
  });
}

if (!CHECK) process.exit(exitCode);

const rendered = ticketText.renderBrokenLinksTicket({
  projects,
  now: Date.now(),
  node: verdict?.node?.name || '',
  lastGood: (state.ticket && state.ticket.lastGood) || null,
});

if (DRY) {
  console.log(`--- would write the "${ticketText.TASK_NAME}" ticket (assign Dane: ${rendered.assign}) ---\n${rendered.body}`);
  console.log('--- (dry run: nothing written, nothing stamped) ---');
  process.exit(exitCode);
}

const wrote = await writeTicket(rendered, state.ticket && state.ticket.id);
const cannotTell = !read.length;
if (!wrote.ok) {
  // Not stamped as checked, so a later wake tries again — hourly, via lastVerdict.
  console.error(`broken-links: could NOT rewrite the "${ticketText.TASK_NAME}" ticket — ${wrote.why}`);
  writeState({ ...state, checkedAt: new Date().toISOString(), lastVerdict: 'cannot-tell' });
  process.exit(2);
}
console.log(`broken-links: rewrote "${ticketText.TASK_NAME}" ${wrote.url || wrote.id} — `
  + `${rendered.count === null ? 'CANNOT TELL' : `${rendered.count} broken`}.`);
writeState({
  checkedAt: new Date().toISOString(),
  lastVerdict: cannotTell ? 'cannot-tell' : 'read',
  ticket: { id: wrote.id, writtenAt: new Date().toISOString(), fingerprint: rendered.fingerprint, assign: rendered.assign, lastGood: rendered.lastGood },
});
// A beat means a reading was TAKEN and reported — not that the sites are clean.
// A pass that read nothing does not beat, so a check stuck blind goes quiet on
// the roll call and the stale-check notices (CLAUDE.md "A job that stops firing").
if (!cannotTell) {
  const beat = heartbeat.recordBeat({ role: ROLE, node: verdict.node.name });
  if (!beat.ok) console.error(`broken-links: the beat could not be written — ${beat.why}`);
}
process.exit(exitCode);
