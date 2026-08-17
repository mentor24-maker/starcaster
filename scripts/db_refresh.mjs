#!/usr/bin/env node
/**
 * `npm run db:refresh` — replace the local database with a copy of production.
 *
 * WHY THIS EXISTS
 * Until now nothing in this repo could bring a local database up to date: no
 * sync, no restore, no seed. The copy on the operator's machine was a
 * hand-made snapshot from 2026-08-03 that drifted a little further every day,
 * so local development kept hitting screens that were broken locally and fine
 * in production. The fastest way out of that was always to go test in
 * production instead. This is the command that ends it.
 *
 * Measured on 2026-08-16, thirteen days after that snapshot: production had
 * 191 Builder pages, local had 65. Two thirds of the content simply was not
 * there.
 *
 * WHAT IT DOES
 *   1. Copies production's structure and data down (read-only credential)
 *   2. Wipes the local `public` schema and rebuilds it from that copy
 *   3. Replaces every real person's contact details with generated ones
 *   4. Restores the local login so you can actually get in
 *
 * WHAT IT NEVER DOES
 * There is no command going the other way, deliberately. Local is a scratch
 * copy; nothing flows back up. The credential it uses cannot write to
 * production even if this script tried — it holds SELECT and nothing else.
 *
 * THE TRAP THIS ENCODES
 * A copy that half-worked is worse than one that failed, because it looks
 * finished. Every step below is checked after it runs, and the summary
 * reports what was copied, what was scrubbed, and — separately — anything
 * that could not be done (docs/DOCTRINE.md §3.11). A table that fails to come
 * across says so rather than being quietly absent.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_CONTAINER = 'supabase_db_starcaster';
const LOCAL_LOGIN_PASSWORD = 'localdev123';

// --- output -----------------------------------------------------------------

const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);
const dim = (t) => paint('2', t);
const bold = (t) => paint('1', t);

const problems = [];
const couldNotDo = [];

function step(text) {
  process.stdout.write(`\n${bold(text)}\n`);
}
function say(text) {
  process.stdout.write(`  ${text}\n`);
}
function done(text) {
  say(`${green('✓')} ${text}`);
}
function warn(text, why) {
  couldNotDo.push(text);
  say(`${yellow('?')} ${text}`);
  if (why) say(`    ${dim(why)}`);
}
function fail(text, detail) {
  problems.push(text);
  say(`${red('✗')} ${text}`);
  if (detail) say(`    ${dim(detail)}`);
}

/**
 * Pull the actual cause out of a failed command's output.
 *
 * The first version of this printed the first three lines of stderr, which on
 * a pg_dump failure are warnings about circular foreign keys — so a
 * permission error twenty lines further down was reported as a foreign-key
 * problem. Prefer the lines that say "error", and only fall back to the tail.
 */
function explain(error) {
  const text = String(error?.stderr || error?.message || '').trim();
  if (!text) return '(no output)';
  const lines = text.split('\n').filter(Boolean);
  const real = lines.filter((line) => /\berror\b|\bfatal\b|permission denied/i.test(line));
  return (real.length ? real : lines.slice(-4)).slice(0, 6).join('\n  ');
}

function die(message, fix) {
  process.stdout.write(`\n${red(bold('Stopped.'))} ${message}\n`);
  if (fix) process.stdout.write(`${yellow('→')} ${fix}\n`);
  process.stdout.write('\n');
  process.exit(1);
}

// --- environment ------------------------------------------------------------

/** Read .env.local for the LOCAL side. Production comes from Doppler only. */
function readEnvFile(file) {
  const values = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length > 1 && /^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    values[line.slice(0, eq).trim()] = value;
  }
  return values;
}

const env = readEnvFile(path.join(ROOT, '.env.local')) || {};
const localUrl = String(env.SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const prodUrl = String(process.env.PROD_DB_READONLY_URL || '').trim();

let localHost = '';
try {
  localHost = new URL(localUrl).hostname;
} catch (_) {
  localHost = '';
}

// Guard one: never let this run with the local side pointing anywhere real.
// The whole script's safety rests on "the thing being wiped is disposable".
if (localHost !== 'localhost' && localHost !== '127.0.0.1') {
  die(
    `Your settings point at ${localUrl || '(nothing)'}, which is not your own machine.\n` +
      '  This command WIPES whatever it is pointed at, so it will not run against anything else.',
    'npm run db:use local',
  );
}

if (!prodUrl) {
  die(
    'No production connection string available (PROD_DB_READONLY_URL).',
    'npm run db:refresh runs it through Doppler — if you called the script directly, use the npm command instead.',
  );
}

// --- running commands -------------------------------------------------------

function inContainer(script, { input, env: extraEnv = {}, quiet = false } = {}) {
  const args = ['exec', '-i'];
  for (const key of Object.keys(extraEnv)) args.push('-e', key);
  args.push(DB_CONTAINER, 'sh', '-c', script);
  return execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
    env: { ...process.env, ...extraEnv },
    stdio: input === undefined ? ['ignore', 'pipe', quiet ? 'pipe' : 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });
}

/** Run SQL against the LOCAL database. Returns trimmed text output. */
function local(sql, { quiet = false } = {}) {
  return inContainer('psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 -f -', {
    input: sql,
    quiet,
  }).trim();
}

/** Run SQL against PRODUCTION, read-only. The URL never reaches argv. */
function prod(sql) {
  return inContainer('psql "$PGURL" -X -q -t -A -v ON_ERROR_STOP=1 -f -', {
    input: sql,
    env: { PGURL: prodUrl },
  }).trim();
}

function count(where, table) {
  try {
    const runner = where === 'prod' ? prod : local;
    return Number(runner(`select count(*) from ${table};`)) || 0;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Check both ends are reachable before destroying anything.
// ---------------------------------------------------------------------------

step('1. Checking both databases');

try {
  execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', DB_CONTAINER], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (_) {
  die('Your local database is not running.', 'npm run doctor      (it will tell you exactly what to start)');
}

let prodPages = null;
try {
  prodPages = Number(prod('select count(*) from builder_landing_page;'));
  done(`Production reachable — ${prodPages} Builder pages.`);
} catch (error) {
  die(
    'Could not read production.\n  ' + explain(error),
    'Check the credential is still good: doppler secrets get PROD_DB_READONLY_URL --project starcaster --config dev',
  );
}

const before = count('local', 'builder_landing_page');
done(`Local reachable — ${before === null ? 'unknown' : before} Builder pages (about to be replaced).`);

// Guard two: belt and braces. The credential should be read-only; prove it
// rather than trust it, because a mistakenly-privileged one would make every
// later step capable of touching production.
// Asked, not attempted. An earlier version tried a write and treated the
// error as proof — but a probe that proves the point by succeeding is a probe
// that writes to production on the one run where it matters. Postgres will
// simply answer the question instead.
try {
  const verdict = prod(`
    select case when
      has_schema_privilege('public', 'CREATE')
      or has_table_privilege('app_projects', 'INSERT')
      or has_table_privilege('app_projects', 'UPDATE')
      or has_table_privilege('app_projects', 'DELETE')
    then 'CAN_WRITE' else 'read_only' end;
  `);
  if (verdict !== 'read_only') {
    die(
      'The production credential can WRITE. It must be read-only, and this script will not run with one that is not.',
      'Re-check its grants — see docs/LOCAL_DEVELOPMENT.md.',
    );
  }
  done('Production credential confirmed read-only.');
} catch (error) {
  die('Could not confirm the production credential is read-only.\n  ' + explain(error));
}

// ---------------------------------------------------------------------------
// 2. Copy production down.
// ---------------------------------------------------------------------------

step('2. Copying production down');

// --no-owner / --no-privileges: production's roles do not exist here, and
// carrying its grants across would produce errors on every object. The grants
// this database actually needs are re-applied in step 4.
const DUMP_FLAGS = '--schema=public --no-owner --no-privileges --quote-all-identifiers';

try {
  inContainer(`pg_dump "$PGURL" ${DUMP_FLAGS} --schema-only -f /tmp/sc_schema.sql`, { env: { PGURL: prodUrl } });
  const size = inContainer('wc -c < /tmp/sc_schema.sql').trim();
  done(`Structure copied (${Math.round(Number(size) / 1024)} KB).`);
} catch (error) {
  die('Could not copy production structure.\n  ' + explain(error));
}

try {
  inContainer(`pg_dump "$PGURL" ${DUMP_FLAGS} --data-only --disable-triggers -f /tmp/sc_data.sql`, { env: { PGURL: prodUrl } });
  const size = inContainer('wc -c < /tmp/sc_data.sql').trim();
  done(`Content copied (${Math.round(Number(size) / 1024 / 1024)} MB).`);
} catch (error) {
  die('Could not copy production content.\n  ' + explain(error));
}

// ---------------------------------------------------------------------------
// 3. Rebuild the local database from that copy.
// ---------------------------------------------------------------------------

step('3. Rebuilding your local database');

try {
  local('drop schema if exists public cascade; create schema public;');
  done('Old copy cleared.');
} catch (error) {
  die('Could not clear the old local database.\n  ' + explain(error));
}

try {
  inContainer('psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/sc_schema.sql');
  done('Structure rebuilt.');
} catch (error) {
  die('Could not rebuild the structure.\n  ' + explain(error));
}

try {
  // Not ON_ERROR_STOP: a single unhappy row must not discard the other 190
  // pages. Anything that fails is counted and reported below instead.
  const out = inContainer('psql -U postgres -d postgres -X -q -f /tmp/sc_data.sql 2>&1 | grep -c "^ERROR" || true');
  const errors = Number(out.trim()) || 0;
  if (errors > 0) fail(`Content loaded, but ${errors} statement(s) failed.`, 'Run with --verbose to see them.');
  else done('Content loaded.');
} catch (error) {
  die('Could not load the content.\n  ' + explain(error));
}

// ---------------------------------------------------------------------------
// 4. Re-apply the permissions the local stack needs.
// ---------------------------------------------------------------------------
// Dropping and recreating `public` takes its grants with it. Without these the
// local API answers "permission denied" for every table, which reads as a
// broken application rather than a missing grant.

step('4. Restoring local permissions');

try {
  local(`
    grant usage on schema public to postgres, anon, authenticated, service_role;
    grant all on all tables    in schema public to postgres, anon, authenticated, service_role;
    grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
    grant all on all functions in schema public to postgres, anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
  `);
  done('Local API can read the tables again.');
} catch (error) {
  fail('Could not restore permissions — the local app will show empty screens.', explain(error));
}

// ---------------------------------------------------------------------------
// 5. Replace real people's details.
// ---------------------------------------------------------------------------
// Row counts, project links and field settings all stay real, so the screens
// look right and tenant separation still gets exercised. Only the values that
// identify an actual human are replaced.

step('5. Replacing real contact details');

const SCRUBS = [
  {
    table: 'contacts',
    what: 'names, emails, phones and social handles',
    sql: `update contacts set
            first_name = 'Test', last_name = 'Contact ' || left(md5(id::text), 6),
            middle_name = null,
            email = 'contact+' || left(md5(id::text), 8) || '@example.invalid',
            phone = '555-01' || lpad((abs(hashtext(id::text)) % 100)::text, 2, '0'),
            company = 'Example Co', city = 'Springfield', notes = null,
            website = null, youtube = null, instagram = null, tiktok = null,
            facebook = null, x = null, bluesky = null, patreon = null, linkedin = null,
            custom_fields = '{}'::jsonb;`,
  },
  {
    table: 'people',
    what: 'names, emails, phones and social handles',
    sql: `update people set
            first_name = 'Test', last_name = 'Person ' || left(md5(id::text), 6),
            middle_name = null,
            email = 'person+' || left(md5(id::text), 8) || '@example.invalid',
            phone = '555-02' || lpad((abs(hashtext(id::text)) % 100)::text, 2, '0'),
            company = 'Example Co', city = 'Springfield',
            website = null, youtube = null, instagram = null, tiktok = null,
            facebook = null, x = null, bluesky = null, patreon = null, linkedin = null,
            custom_fields = '{}'::jsonb;`,
  },
  {
    table: 'crm_contacts',
    what: 'emails and submitted form data',
    sql: `update crm_contacts set
            email = 'crm+' || left(md5(id::text), 8) || '@example.invalid',
            data = '{}'::jsonb;`,
  },
  {
    table: 'leads',
    what: 'names and emails',
    sql: `update leads set
            email = 'lead+' || left(md5(id::text), 8) || '@example.invalid',
            name = 'Test Lead';`,
  },
  {
    table: 'app_invitations',
    what: 'invited addresses',
    sql: `update app_invitations set email = 'invite+' || left(md5(id::text), 8) || '@example.invalid';`,
  },
  {
    table: 'contact_project_invitations',
    what: 'invited addresses',
    sql: `update contact_project_invitations set
            email = 'invite+' || left(md5(id::text), 8) || '@example.invalid',
            accepted_by_email = null;`,
  },
  {
    table: 'app_project_admin_users',
    what: "tenant admins' addresses",
    sql: `update app_project_admin_users set email = 'tenantadmin+' || left(md5(id::text), 8) || '@example.invalid';`,
  },
  {
    table: 'app_project_support_requests',
    what: 'requester addresses',
    sql: `update app_project_support_requests set admin_email = 'support+' || left(md5(id::text), 8) || '@example.invalid';`,
  },
];

for (const scrub of SCRUBS) {
  const rows = count('local', scrub.table);
  if (rows === null) {
    warn(`${scrub.table} — not in this copy, nothing scrubbed.`);
    continue;
  }
  if (rows === 0) {
    say(`${dim('·')} ${dim(`${scrub.table} — empty.`)}`);
    continue;
  }
  try {
    local(scrub.sql);
    done(`${scrub.table} — ${rows} row(s), ${scrub.what} replaced.`);
  } catch (error) {
    fail(`${scrub.table} — scrub FAILED, real details are still here.`, explain(error));
  }
}

// ---------------------------------------------------------------------------
// 6. Platform logins.
// ---------------------------------------------------------------------------

step('6. Setting up your login');

// Same scheme as lib/authStore.js hashPassword(). Copied rather than imported
// because that module is CommonJS and reaches for Supabase on load; if the
// scheme there ever changes, this login stops working and the fix is here.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}

const OPERATOR_EMAIL = String(process.env.UI_HARNESS_EMAIL || 'mentor24@gmail.com').toLowerCase();

const users = count('local', 'app_auth_users');
if (users === null) {
  fail('app_auth_users is missing — you will not be able to log in.');
} else {
  try {
    // Everyone else: fake address, and a hash that matches no password at all.
    // Their real hashes are of real passwords, and those do not belong here.
    local(`
      update app_auth_users
         set email = 'user+' || left(md5(id::text), 8) || '@example.invalid',
             name = 'Test User',
             password_hash = 'disabled:no-login-on-local-copies'
       where lower(email) <> '${OPERATOR_EMAIL.replace(/'/g, "''")}';
    `);
    const others = Number(local(`select count(*) from app_auth_users where lower(email) <> '${OPERATOR_EMAIL.replace(/'/g, "''")}';`));
    done(`${others} other account(s) anonymised and their passwords disabled.`);
  } catch (error) {
    fail('Could not anonymise the other accounts — real password hashes are still here.', explain(error));
  }

  try {
    const mine = Number(local(`select count(*) from app_auth_users where lower(email) = '${OPERATOR_EMAIL.replace(/'/g, "''")}';`));
    if (mine === 0) {
      fail(`No account for ${OPERATOR_EMAIL} in this copy — you will not be able to log in.`);
    } else {
      local(`
        update app_auth_users
           set password_hash = '${hashPassword(LOCAL_LOGIN_PASSWORD)}'
         where lower(email) = '${OPERATOR_EMAIL.replace(/'/g, "''")}';
      `);
      done(`${OPERATOR_EMAIL} — password set to ${bold(LOCAL_LOGIN_PASSWORD)} on this copy only.`);
    }
  } catch (error) {
    fail('Could not set your local password.', explain(error));
  }
}

// ---------------------------------------------------------------------------
// 7. Read it back.
// ---------------------------------------------------------------------------
// The dump reporting success is not evidence the rows arrived. Compare both
// ends and say so.

step('7. Checking what actually arrived');

const CHECK_TABLES = [
  'app_projects',
  'builder_landing_page',
  'builder_saved_sections',
  'builder_themes',
  'assets',
  'contacts',
  'people',
  'app_auth_users',
];

let mismatches = 0;
for (const table of CHECK_TABLES) {
  const there = count('prod', table);
  const here = count('local', table);
  if (there === null || here === null) {
    warn(`${table} — could not compare.`);
    continue;
  }
  if (there === here) {
    done(`${table} — ${here}`);
  } else {
    mismatches += 1;
    fail(`${table} — production has ${there}, this copy has ${here}.`);
  }
}

// Tidy up the dumps: they hold a full copy of production's content.
try {
  inContainer('rm -f /tmp/sc_schema.sql /tmp/sc_data.sql');
} catch (_) {
  couldNotDo.push('Could not delete the temporary copies inside the database container.');
}

// ---------------------------------------------------------------------------

const after = count('local', 'builder_landing_page');
process.stdout.write('\n');
if (problems.length === 0 && mismatches === 0) {
  process.stdout.write(bold(green('Done. Your local copy matches production.')) + '\n');
  process.stdout.write(dim(`  Builder pages: ${before ?? '?'} → ${after ?? '?'}\n`));
  process.stdout.write(dim(`  Log in at http://localhost:3001 as ${OPERATOR_EMAIL} / ${LOCAL_LOGIN_PASSWORD}\n`));
} else {
  process.stdout.write(bold(red(`Finished with ${problems.length} problem(s).`)) + '\n');
  for (const problem of problems) process.stdout.write(`  ${red('✗')} ${problem}\n`);
}
if (couldNotDo.length) {
  process.stdout.write(bold(yellow(`\n${couldNotDo.length} thing(s) could not be checked:`)) + '\n');
  for (const item of couldNotDo) process.stdout.write(`  ${yellow('?')} ${item}\n`);
}
process.stdout.write('\n');
process.exit(problems.length > 0 || mismatches > 0 ? 1 : 0);
