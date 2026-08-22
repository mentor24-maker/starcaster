#!/usr/bin/env node
/**
 * `npm run schema:snapshot` — record what production's structure actually is.
 * `npm run schema:check`    — has it changed since that record?
 *
 * WHY THIS EXISTS
 * On 2026-08-16 nobody — person or agent — could state what production's
 * schema was. There were three candidate answers: 185 hand-run files in
 * docs/SQL, five in supabase/migrations that had never been applied anywhere,
 * and a README pointing at a tracker that did not exist. The local database
 * was thirteen days adrift and no tool in the repo could say by how much.
 *
 * This does NOT change how schema changes ship. DOCTRINE §7 is explicit that
 * docs/SQL applied by hand is the source of truth and supabase/migrations is
 * not; §6.5 hands each file to the operator as a GitHub URL, with a hook
 * enforcing it. That flow works and stays.
 *
 * What was missing was a RECORD and a CHECK:
 *   - the record: one committed file stating production's structure
 *   - the check:  a command that says whether it still matches
 *
 * With those, "did someone apply SQL without recording it?" becomes a
 * question with an answer, which is the whole of the drift problem.
 *
 * READ-ONLY, and cheap. Structure only, no table contents — about 300 KB and
 * a couple of seconds, so unlike `db:refresh` it costs production almost no
 * disk IO (DOCTRINE §1.5).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'docs', 'schema', 'production.sql');
const DB_CONTAINER = 'supabase_db_starcaster';

const ESC = String.fromCharCode(27);
const tty = process.stdout.isTTY;
const paint = (c, t) => (tty ? `${ESC}[${c}m${t}${ESC}[0m` : t);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);
const dim = (t) => paint('2', t);
const bold = (t) => paint('1', t);

function die(message, fix) {
  process.stdout.write(`\n${red(bold('Stopped.'))} ${message}\n`);
  if (fix) process.stdout.write(`${yellow('Fix:')} ${fix}\n`);
  process.stdout.write('\n');
  process.exit(1);
}

const prodUrl = String(process.env.PROD_DB_READONLY_URL || '').trim();
if (!prodUrl) {
  die(
    'No production connection string (PROD_DB_READONLY_URL).',
    'Use the npm command, which fetches it from Doppler — see docs/LOCAL_DEVELOPMENT.md.',
  );
}

function connectionEnv(url) {
  const u = new URL(url);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, '') || 'postgres',
  };
}

/**
 * Strip the parts of a pg_dump header that change on every run regardless of
 * the schema — versions and settings banners. Without this every check would
 * report a difference and the check would be ignored within a week.
 */
function normalise(sql) {
  return String(sql)
    .split('\n')
    .filter((line) => !/^-- Dumped (from|by) /.test(line))
    // pg_dump wraps its output in \restrict/\unrestrict psql commands
    // carrying a fresh random token every run. Left in, every check reports a
    // difference, and a check that always cries wolf is off within a week.
    .filter((line) => !/^\\(un)?restrict /.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dumpProduction() {
  const env = connectionEnv(prodUrl);
  try {
    return execFileSync(
      'docker',
      ['exec', '-e', 'PGHOST', '-e', 'PGPORT', '-e', 'PGUSER', '-e', 'PGPASSWORD', '-e', 'PGDATABASE',
       DB_CONTAINER, 'pg_dump', '--schema=public', '--schema-only', '--no-owner', '--no-privileges',
       '--quote-all-identifiers'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const text = String(error?.stderr || error?.message || '');
    const real = text.split('\n').filter((l) => /error|fatal|denied/i.test(l)).slice(0, 3).join('\n  ');
    die('Could not read production\'s structure.\n  ' + (real || text.split('\n').slice(-3).join('\n  ')));
  }
}

const HEADER = [
  '-- Production database structure, as recorded by `npm run schema:snapshot`.',
  '--',
  '-- THIS FILE IS A RECORD, NOT SOMETHING TO RUN. Nothing applies it, and',
  '-- applying it to production would be destructive. It exists so that the',
  '-- question "what does production actually look like?" has one answer that',
  '-- lives in the repo, and so `npm run schema:check` can tell you when the',
  '-- real thing has moved away from it.',
  '--',
  '-- Schema changes still ship the way DOCTRINE §6.5 and §7 describe: a file',
  '-- in docs/SQL, handed to the operator as a GitHub URL, applied by hand.',
  '-- After applying one, re-run `npm run schema:snapshot` and record it in',
  '-- docs/MIGRATIONS_APPLIED.md, so this file and reality stay together.',
  '',
].join('\n');

const mode = String(process.argv[2] || 'snapshot');

if (mode === 'snapshot') {
  const dumped = normalise(dumpProduction());
  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  fs.writeFileSync(SNAPSHOT, `${HEADER}${dumped}\n`);
  const tables = (dumped.match(/^CREATE TABLE /gm) || []).length;
  process.stdout.write(`\n  ${green('Recorded')} production's structure — ${tables} tables.\n`);
  process.stdout.write(`  ${dim(path.relative(ROOT, SNAPSHOT))}\n\n`);
  process.stdout.write(`  ${dim('Commit it, so the repo states what production is.')}\n\n`);
  process.exit(0);
}

if (mode === 'check') {
  let recorded;
  try {
    recorded = fs.readFileSync(SNAPSHOT, 'utf8');
  } catch (_) {
    die('There is no recorded structure to compare against.', 'npm run schema:snapshot');
  }
  const recordedBody = normalise(recorded.replace(HEADER, ''));
  const liveBody = normalise(dumpProduction());

  if (recordedBody === liveBody) {
    const tables = (liveBody.match(/^CREATE TABLE /gm) || []).length;
    process.stdout.write(`\n  ${green('Production matches the record.')} ${dim(`(${tables} tables)`)}\n\n`);
    process.exit(0);
  }

  // Line-level difference, deliberately simple: this reports THAT the schema
  // moved and roughly where, not a perfect patch. Anything more elaborate
  // invites trusting the tool over looking at the database.
  const before = new Set(recordedBody.split('\n'));
  const after = new Set(liveBody.split('\n'));
  const added = [...after].filter((l) => l.trim() && !before.has(l));
  const removed = [...before].filter((l) => l.trim() && !after.has(l));

  process.stdout.write(`\n  ${yellow(bold('Production has moved away from the record.'))}\n\n`);
  const show = (label, lines, colour) => {
    if (!lines.length) return;
    process.stdout.write(`  ${colour(`${label} (${lines.length})`)}\n`);
    for (const line of lines.slice(0, 25)) process.stdout.write(`    ${dim(line.slice(0, 140))}\n`);
    if (lines.length > 25) process.stdout.write(`    ${dim(`… and ${lines.length - 25} more`)}\n`);
    process.stdout.write('\n');
  };
  show('In production but not in the record', added, green);
  show('In the record but not in production', removed, red);

  process.stdout.write(`  ${yellow('This usually means SQL was applied without being recorded.')}\n`);
  process.stdout.write(`  ${dim('Find the file in docs/SQL that did it, note it in docs/MIGRATIONS_APPLIED.md,')}\n`);
  process.stdout.write(`  ${dim('then run `npm run schema:snapshot` to bring the record up to date.')}\n\n`);
  process.exit(1);
}

die(`"${mode}" is not something this does. Use snapshot or check.`);
