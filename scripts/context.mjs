#!/usr/bin/env node
/**
 * `npm run context` — read a project's Assets › Context entries as plain text,
 * for agent sessions (ticket SC-810). docs/CONTEXT_LIBRARY.md says when.
 *
 *   npm run context -- list --project <slug|id|name>            one line per entry
 *   npm run context -- get  --id <entry id> --project <p>       one entry in full
 *   npm run context -- dump --project <slug|id|name>            every note, one document
 *
 *   --save <folder>   (get, dump) also download the files, into a folder OUTSIDE the repo
 *   --local           read this machine's database instead of production
 *
 * READ-ONLY. It writes nothing anywhere but the --save folder; adding and
 * editing stays on the Context page.
 *
 * Production is read through PROD_DB_READONLY_URL with psql inside the local
 * Supabase container, the way scripts/broken_links_check.mjs does: the Doppler
 * `dev` config points SUPABASE_URL at this machine's database, so asking
 * lib/contextStore.js would answer about the wrong database. Rows are shaped
 * by the store's own rowToEntry, and every query names the project. The
 * password goes in as PG* variables, never on the process table.
 *
 * Output is on stdout; which database was read goes to stderr, so an agent
 * piping the text gets only the text.
 *
 * Exit: 0 printed (including "No context entries in <project>"),
 *       1 the question had no answer (no such project or entry, bad arguments),
 *       2 could not tell (the database or a file download could not be read).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const readout = require('../lib/contextReadout.js');
const { rowToEntry } = require('../lib/contextStore.js');
const { isContextFileUrl } = require('../lib/contextFileTypes.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_CONTAINER = 'supabase_db_starcaster';

const USAGE = `Usage:
  npm run context -- list --project <slug|id|name>
  npm run context -- get  --id <entry id> --project <slug|id|name> [--save <folder>]
  npm run context -- dump --project <slug|id|name> [--save <folder>]
Add --local to read this machine's database instead of production.`;

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
function flag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const value = argv[i + 1];
  return value && !value.startsWith('--') ? value : '';
}
const LOCAL = argv.includes('--local');
const WHERE = LOCAL ? "this machine's database" : 'production';

// Stopping is a thrown Exit, never process.exit(). On macOS a write to a pipe
// finishes later, and process.exit() throws away whatever has not gone yet:
// an agent piping a dump got the first 64 KB and exit 0 (review of PR #1017).
// Setting exitCode and letting main() return lets Node drain stdout first.
class Exit extends Error {}

function done(code, message, stream = 'err') {
  if (message) (stream === 'out' ? process.stdout : process.stderr).write(`${message}\n`);
  process.exitCode = code;
  throw new Exit();
}

const DOWNLOAD_TIMEOUT_MS = 60000;

// ------------------------------------------------------------------ reading

function connection() {
  if (LOCAL) return { env: { PGUSER: 'postgres', PGDATABASE: 'postgres' } };
  const url = String(process.env.PROD_DB_READONLY_URL || '').trim();
  if (!url) return { error: 'PROD_DB_READONLY_URL is not set (it comes from the Doppler dev config; run this through npm run context)' };
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
  if (conn.error) return { error: conn.error };
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
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 256,
    });
    return { data: JSON.parse(out.trim() || 'null') };
  } catch (err) {
    const stderr = String(err?.stderr || '');
    const detail = (stderr.split('\n').find((l) => /ERROR|error|No such container|Cannot connect/.test(l))
      || stderr.split('\n').find((l) => l.trim()) || err?.message || String(err)).trim();
    if (/No such container|Cannot connect to the Docker daemon|ENOENT/.test(detail)) {
      return { error: `psql runs inside the local Supabase container (${DB_CONTAINER}), which is not running here: ${detail.slice(0, 200)}. Start it with: supabase start` };
    }
    return { error: detail.slice(0, 300) };
  }
}

const PROJECTS_SQL = `select coalesce(json_agg(json_build_object('id', id, 'slug', slug, 'name', name) order by name), '[]'::json)
  from app_projects;`;

const ENTRIES_SQL = `select coalesce(json_agg(row_to_json(c) order by c.updated_at desc), '[]'::json)
  from context_entries c where c.project_id = :'pid';`;

const ENTRY_SQL = `select coalesce(json_agg(row_to_json(c)), '[]'::json)
  from context_entries c where c.id::text = :'eid' and c.project_id = :'pid';`;

// Production reads under row-level security as starcaster_readonly: with no
// read rule it sees zero rows and no error, which would print "No context
// entries" on every project. sql:unapplied cannot see policies, so the
// command checks for itself before it reads (review of PR #1017).
const READ_RULE_SQL = `select json_build_object(
    'table', to_regclass('public.context_entries') is not null,
    'rule', exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'context_entries'
                       and policyname = '${readout.READ_RULE}'));`;

function checkReadRule(conn) {
  if (LOCAL) return; // this machine reads as postgres, which no rule limits
  const res = psqlJson(conn, READ_RULE_SQL);
  if (res.error) done(2, `Could not check the read rule in ${WHERE}: ${res.error}`);
  const verdict = readout.readRuleVerdict(res.data, WHERE);
  if (!verdict.ok) done(2, verdict.message);
}

function readProjects(conn) {
  const res = psqlJson(conn, PROJECTS_SQL);
  if (res.error) return { error: `Could not read the project list in ${WHERE}: ${res.error}` };
  return { data: Array.isArray(res.data) ? res.data : [] };
}

function findProject(conn, wanted) {
  const projects = readProjects(conn);
  if (projects.error) done(2, projects.error);
  const found = readout.resolveProject(projects.data, wanted, WHERE);
  if (!found.ok) done(1, found.message);
  return found.project;
}

function readEntries(conn, project) {
  const res = psqlJson(conn, ENTRIES_SQL, { pid: project.id });
  if (res.error) done(2, readout.describeReadFailure(res.error, WHERE));
  return (Array.isArray(res.data) ? res.data : []).map(rowToEntry);
}

// ------------------------------------------------------------------ saving files

// The folder is checked up front but only created once there is something to
// save, so a mistyped project or entry leaves no empty folder behind.
function saveFolder() {
  const value = flag('--save');
  if (value === null) return null;
  if (!value) done(1, '--save needs a folder, for example --save /tmp/context-files');
  const refuse = (why) => done(1, `--save must be outside the repository (it is public, and these are a project's own files): ${why}`);
  // Symlinks resolved, so a link into the repo does not pass as outside it.
  const { real, existing } = readout.realFolder(value);
  if (readout.isInside(real, readout.realFolder(REPO).real)) refuse(real);
  // Any git working tree is refused, not only this one: from a worktree, the
  // main checkout is the same public repository in another folder.
  try {
    const top = execFileSync('git', ['-C', existing, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (top) refuse(`${real} is inside the git working tree at ${top}`);
  } catch (err) {
    if (err instanceof Exit) throw err;
    // git said "not a working tree" (or is not installed): outside, as wanted.
  }
  return real;
}

async function download(entry, folder) {
  if (!entry.fileUrl) return { error: `${entry.title}: no file address is recorded` };
  // The same check the store makes when it writes the address: only this
  // project's own stored files are fetched, never whatever a row holds.
  if (!isContextFileUrl(entry.fileUrl, entry.projectId)) {
    return { error: `${entry.title}: not downloaded, because ${entry.fileUrl} is not one of this project's stored context files` };
  }
  try {
    // A stalled download must not hang the whole command with nothing printed.
    const res = await fetch(entry.fileUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) return { error: `${entry.title}: the download answered ${res.status} (${entry.fileUrl})` };
    const bytes = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, readout.saveName(entry));
    fs.writeFileSync(target, bytes);
    return { path: target };
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      return { error: `${entry.title}: the download did not finish within ${DOWNLOAD_TIMEOUT_MS / 1000} seconds (${entry.fileUrl})` };
    }
    return { error: `${entry.title}: could not download ${entry.fileUrl}: ${err?.message || err}` };
  }
}

async function saveFiles(entries, folder) {
  const saved = {};
  const failed = [];
  if (!folder) return { saved, failed };
  for (const entry of entries.filter((e) => e.kind === 'file')) {
    const got = await download(entry, folder);
    if (got.error) failed.push(got.error);
    else saved[entry.id] = got.path;
  }
  return { saved, failed };
}

function reportFailedDownloads(failed) {
  if (!failed.length) return;
  done(2, `\n${failed.length} file(s) could not be saved:\n${failed.map((f) => `  - ${f}`).join('\n')}`);
}

// ------------------------------------------------------------------ commands

async function main() {
  if (argv.includes('--help') || argv.includes('-h')) done(0, USAGE, 'out');
  if (!command) done(1, USAGE);
  if (!['list', 'get', 'dump'].includes(command)) done(1, `Unknown command "${command}".\n${USAGE}`);

  const conn = connection();
  if (conn.error) done(2, `Could not read ${WHERE}: ${conn.error}`);
  process.stderr.write(`(reading ${WHERE})\n`);

  if (command === 'list' || command === 'dump') {
    const wanted = flag('--project');
    if (!wanted) done(1, `Which project? Add --project <slug or id>.\n${USAGE}`);
    if (command === 'list' && flag('--save') !== null) done(1, '--save goes with get or dump, not list.');
    const folder = command === 'dump' ? saveFolder() : null;
    const project = findProject(conn, wanted);
    checkReadRule(conn);
    const entries = readEntries(conn, project);
    if (command === 'list') done(0, readout.formatList(entries, project), 'out');
    const { saved, failed } = await saveFiles(entries, folder);
    process.stdout.write(`${readout.formatDump(entries, project, { saved })}\n`);
    reportFailedDownloads(failed);
    done(0);
  }

  // get
  const id = flag('--id');
  if (!id) done(1, `Which entry? Add --id <entry id> (the first column of list).\n${USAGE}`);
  // --project is required: an id alone could name another project's entry,
  // and "every query names the project" is the promise (review of PR #1017).
  const wantedProject = flag('--project');
  if (!wantedProject) done(1, `Which project is entry ${id} in? Add --project <slug or id>.\n${USAGE}`);
  const folder = saveFolder();
  const project = findProject(conn, wantedProject);
  checkReadRule(conn);
  const res = psqlJson(conn, ENTRY_SQL, { eid: id, pid: project.id });
  if (res.error) done(2, readout.describeReadFailure(res.error, WHERE));
  const row = (Array.isArray(res.data) ? res.data : [])[0];
  const entry = row ? rowToEntry(row) : null;
  if (!entry) done(1, `No context entry ${id} in ${readout.projectLabel(project)} in ${WHERE}.`);
  const { saved, failed } = await saveFiles([entry], folder);
  process.stdout.write(`${readout.formatEntry(entry, { project, savedPath: saved[entry.id] || '' })}\n`);
  reportFailedDownloads(failed);
  done(0);
}

main().catch((err) => {
  if (err instanceof Exit) return;
  process.stderr.write(`context: ${err?.stack || err}\n`);
  process.exitCode = 2;
});
