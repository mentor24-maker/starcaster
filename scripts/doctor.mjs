#!/usr/bin/env node
/**
 * `npm run doctor` — plain-English answer to "is my machine ready to work?"
 *
 * WHY THIS EXISTS
 * Every way local development can be broken looks identical from the outside:
 * the app misbehaves. Docker off, a stale database, an unbuilt bundle and a
 * server that never started all present as the same shrug. On 2026-08-16 the
 * operator shut Docker down and the only feedback the machine could give him
 * was an npm error about a missing package.json — from the wrong folder, about
 * the wrong problem.
 *
 * So this reports each thing separately, says which ones it could NOT check
 * and why, and hands back the exact command that fixes every failure.
 *
 * READ-ONLY. It starts nothing, stops nothing and writes nothing. Running it
 * when everything is on fire is always safe.
 *
 * THE TRAP THIS ENCODES
 * A check that cannot run must never report a pass. If Docker is down, the
 * schema is not "fine" — it is UNKNOWN, and saying so is the whole point
 * (docs/DOCTRINE.md §3.11). Every check below returns one of three states,
 * never two.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- output -----------------------------------------------------------------

const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);
const dim = (t) => paint('2', t);
const bold = (t) => paint('1', t);

const out = [];
let failures = 0;
let unknowns = 0;

function heading(text) {
  out.push('', bold(text));
}

/** A check that passed. */
function ok(text, detail) {
  out.push(`  ${green('✓')}  ${text}`);
  if (detail) out.push(`     ${dim(detail)}`);
}

/** A check that failed, with the command that fixes it. */
function bad(text, fix, detail) {
  failures += 1;
  out.push(`  ${red('✗')}  ${text}`);
  if (detail) out.push(`     ${dim(detail)}`);
  if (fix) out.push(`     ${yellow('→')} ${fix}`);
}

/**
 * A check that could not run. Not a pass and not a failure — the honest
 * third state, and the one this whole script exists to make visible.
 */
function unknown(text, why) {
  unknowns += 1;
  out.push(`  ${yellow('?')}  ${text}`);
  if (why) out.push(`     ${dim(why)}`);
}

function note(text) {
  out.push(`     ${dim(text)}`);
}

// --- small helpers ----------------------------------------------------------

function sh(command, args) {
  try {
    return {
      ok: true,
      text: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    };
  } catch (error) {
    return { ok: false, text: String(error?.stdout || '').trim() };
  }
}

/**
 * Read .env.local ourselves rather than letting dotenv load it into the
 * process. We are reporting on the FILE — what it would do on the next run —
 * not on whatever this process happens to have inherited.
 */
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
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes, the way dotenv does.
    if (value.length > 1 && /^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

async function reachable(url, timeoutMs = 2500) {
  const stop = AbortSignal.timeout(timeoutMs);
  try {
    await fetch(url, { signal: stop });
    return true; // Any HTTP answer proves something is listening.
  } catch (_) {
    return false;
  }
}

/** Newest modification time under a set of files/folders, or 0 if none exist. */
function newestMtime(entries, extensions) {
  let newest = 0;
  const visit = (target) => {
    let stat;
    try {
      stat = fs.statSync(target);
    } catch (_) {
      return;
    }
    if (stat.isDirectory()) {
      if (/node_modules|[/\\]\.git/.test(target)) return;
      for (const child of fs.readdirSync(target)) visit(path.join(target, child));
      return;
    }
    if (extensions && !extensions.some((ext) => target.endsWith(ext))) return;
    if (stat.mtimeMs > newest) newest = stat.mtimeMs;
  };
  for (const entry of entries) visit(path.join(ROOT, entry));
  return newest;
}

function ageWords(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// --- 1. which database ------------------------------------------------------
// First, loudest, and the one that matters most: the difference between a
// scratch copy and 21 live tenant sites is invisible everywhere else.

const envPath = path.join(ROOT, '.env.local');
const env = readEnvFile(envPath);
const supabaseUrl = String(env?.SUPABASE_URL || '').trim();

let host = '';
try {
  host = new URL(supabaseUrl).hostname;
} catch (_) {
  host = '';
}
// Three states, not two. "No config at all" is a different problem from
// "configured, and pointed at production" — and a fresh worktree is always
// the first one, so conflating them sends you hunting the wrong fault.
const dbTarget = !env || !supabaseUrl ? 'unknown' : host === 'localhost' || host === '127.0.0.1' ? 'local' : 'production';
const isLocalDb = dbTarget === 'local';

heading('WHICH DATABASE');

if (!env) {
  // The normal cause is a brand-new work folder: `npm run thread` installs
  // and builds, but settings files are deliberately not in git, so a fresh
  // worktree starts with no way to reach any database at all.
  bad(
    'This folder has no settings file, so it cannot reach any database.',
    'cp ../../../.env.local .      (copies your settings from the main folder)',
    envPath,
  );
} else if (!supabaseUrl) {
  bad('.env.local does not say which database to use.', 'ask CC to set SUPABASE_URL', 'SUPABASE_URL is empty');
} else if (isLocalDb) {
  ok(`${green('LOCAL')} — your own machine. Safe to break.`, supabaseUrl);
} else {
  // Not a failure. Sometimes deliberate. But it must never be quiet.
  out.push(`  ${red('!')}  ${red(bold('PRODUCTION'))} — the live database, serving real tenant sites.`);
  note(supabaseUrl);
  note('Anything you change here is real and immediate.');
  out.push(`     ${yellow('→')} to work safely:  npm run db:use local`);
}

// --- 2. the local stack -----------------------------------------------------

heading('YOUR LOCAL STACK');

const dockerUp = sh('docker', ['info', '--format', '{{.ServerVersion}}']).ok;

if (dockerUp) {
  ok('Docker is running.');
} else {
  bad(
    'Docker is not running — so there is no local database at all.',
    'open -a Docker      (then wait for its whale icon to stop animating)',
  );
}

// Container names come from supabase/config.toml's project_id.
const PROJECT = 'starcaster';
const DB_CONTAINER = `supabase_db_${PROJECT}`;

let containersUp = false;
if (!dockerUp) {
  unknown('Cannot tell whether the local database is up.', 'Docker is down, so there is nothing to ask.');
} else {
  const ps = sh('docker', ['ps', '--format', '{{.Names}}']);
  const running = ps.text.split('\n').filter((name) => name.endsWith(`_${PROJECT}`));
  containersUp = running.includes(DB_CONTAINER);
  if (containersUp) {
    ok(`The local database is up. ${dim(`(${running.length} containers)`)}`);
  } else {
    bad(
      'Docker is running, but the local database is not started.',
      'supabase start      (takes about a minute the first time)',
    );
  }
}

if (dbTarget === 'unknown') {
  unknown('Did not check the database connection.', 'This folder has no .env.local, so there is nothing to connect to.');
} else if (dbTarget === 'production') {
  unknown('Did not check the local database connection.', 'You are pointed at production, so it would not be used.');
} else if (!containersUp) {
  unknown('Cannot tell whether the app could connect.', 'The local database is not running.');
} else if (await reachable(supabaseUrl)) {
  ok('The app can reach it.', supabaseUrl);
} else {
  bad(
    `Local database is running but not answering on ${host}.`,
    'supabase stop && supabase start',
    supabaseUrl,
  );
}

// --- 3. is this copy of the database current --------------------------------

heading('DATABASE CONTENTS');

const migrationsDir = path.join(ROOT, 'supabase', 'migrations');
let migrationFiles = [];
try {
  migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort();
} catch (_) {
  migrationFiles = [];
}

if (dbTarget === 'unknown') {
  unknown('Did not check the database contents.', 'This folder has no .env.local, so no database is in play.');
} else if (dbTarget === 'production') {
  unknown('Did not check the database contents.', 'This only applies to your local copy.');
} else if (!containersUp) {
  unknown('Cannot tell how current your copy is.', 'The local database is not running.');
} else {
  // The question this SHOULD answer.
  //
  // The first version compared migration files on disk against the database's
  // migration ledger, and reported — correctly — that there was no ledger to
  // compare against. True, and useless: it named a real problem the operator
  // could do nothing with, on every single run.
  //
  // `db:refresh` copies production wholesale, so afterwards local IS
  // production. The honest question is not which changes are applied, it is
  // how old the copy is. That has an answer.
  let stamp = null;
  try {
    stamp = JSON.parse(fs.readFileSync(path.join(ROOT, '.local-db-refreshed'), 'utf8'));
  } catch (_) {
    stamp = null;
  }

  const pages = (() => {
    const out = sh('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc',
      'select count(*) from builder_landing_page']);
    return out.ok ? Number(out.text.trim()) : null;
  })();

  if (!stamp?.at) {
    bad(
      'This copy has never been refreshed from production — or was made before the tool existed.',
      'npm run db:refresh      (about two minutes)',
      pages === null ? undefined : `It currently holds ${pages} Builder pages.`,
    );
  } else {
    const days = Math.floor((Date.now() - Date.parse(stamp.at)) / 86400000);
    const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    const age = days === 1 ? 'a day old' : `${days} days old`;
    const detail = pages === null ? '' : `${pages} Builder pages.`;
    if (days >= 7) {
      bad(`Your copy of production is ${age}.`, 'npm run db:refresh      (about two minutes)', detail);
    } else {
      // Refreshing costs production disk IO — six runs in a day left it
      // unresponsive on 2026-08-17 — so this says "fine" rather than nudging.
      ok(`Copied from production ${when}. ${dim(detail)}`);
    }
  }
}

// --- 4. built files ---------------------------------------------------------
// These are generated, gitignored, and absent after a fresh clone. A missing
// app-shell.html serves a 404 that reads as a broken route (CLAUDE.md, "One
// worktree per thread" — it cost an hour twice on 2026-08-15).

heading('BUILT FILES');

const ARTIFACTS = [
  { built: 'public/app-shell.html', sources: ['src/layout.html', 'src/pages'], name: 'the admin app' },
  { built: 'public/styles.css', sources: ['src/css'], name: 'the stylesheet' },
  { built: 'public/builder-bundle.js', sources: ['builder-react-entry.tsx', 'components', 'lib/builder-client'], name: 'the Builder' },
  { built: 'lib/builder/template.js', sources: ['lib/builder-client/builder-template.ts'], name: 'the page renderer' },
  { built: 'public/bundle.js', sources: ['react-entry.js'], name: 'the campaigns screens' },
];

const missing = [];
const stale = [];

for (const artifact of ARTIFACTS) {
  const builtPath = path.join(ROOT, artifact.built);
  let builtAt = 0;
  try {
    builtAt = fs.statSync(builtPath).mtimeMs;
  } catch (_) {
    missing.push(artifact);
    continue;
  }
  const sourceAt = newestMtime(artifact.sources);
  if (sourceAt > builtAt) stale.push({ ...artifact, sourceAt });
}

if (missing.length) {
  bad(
    `${missing.length} built file${missing.length === 1 ? ' is' : 's are'} missing — the app will serve blank pages.`,
    'npm run build',
    missing.map((a) => `${a.built} (${a.name})`).join('\n     '),
  );
} else if (stale.length) {
  bad(
    `${stale.length} built file${stale.length === 1 ? ' is' : 's are'} older than the code behind ${stale.length === 1 ? 'it' : 'them'}.`,
    'npm run build',
    `You are looking at an old version of ${stale.map((a) => a.name).join(', ')}.`,
  );
} else {
  ok('All present, and newer than the code behind them.');
}

// --- the vault (canon nothing else reads) ----------------------------------

heading('VAULT');

// Read-only drift check: canon committed-but-unpushed, or doctrine citing a
// file that does not exist. A missing vault is CANNOT TELL, never a failure —
// worktrees and CI do not carry one.
try {
  const { checkVaultDrift } = await import('./builder/vaultDrift.js').then((m) => m.default || m);
  const vaultDir = path.join(os.homedir(), 'vault');
  const { findings, cannotTell, ok: vaultOk, checked } = checkVaultDrift(vaultDir);
  if (findings.length) {
    for (const f of findings) bad(f, 'see `npm run check:vault-drift`');
  }
  for (const c of cannotTell) unknown(c);
  if (checked && vaultOk) ok('Committed, pushed, and every doctrine citation resolves.');
} catch (err) {
  unknown(`Vault check could not run (${err.message}).`);
}

// --- 5. the app itself ------------------------------------------------------

heading('THE APP');

const port = String(env?.PORT || '3001').trim();
const appUrl = `http://localhost:${port}`;

if (await reachable(appUrl, 1500)) {
  ok(`Running at ${appUrl}`);
} else {
  // Not a failure — not having started it yet is the normal state.
  out.push(`  ${dim('·')}  Not started.`);
  out.push(`     ${yellow('→')} npm run dev      ${dim(`then open ${appUrl}`)}`);
}

// --- verdict ----------------------------------------------------------------

out.push('');
if (failures === 0 && unknowns === 0) {
  out.push(bold(green('Ready to work.')));
} else if (failures === 0) {
  out.push(bold(yellow(`Nothing broken, but ${unknowns} thing${unknowns === 1 ? '' : 's'} could not be checked.`)));
  out.push(dim('Read the ? lines above — an unchecked thing is not a working thing.'));
} else {
  out.push(bold(red(`${failures} thing${failures === 1 ? '' : 's'} to fix.`)));
  out.push(dim('Work down the → lines in order; the earlier ones often fix the later ones.'));
}
out.push('');

console.log(out.join('\n'));
process.exit(failures > 0 ? 1 : 0);
