#!/usr/bin/env node
/**
 * `npm run db:use local` / `npm run db:use cloud` - point this checkout at a
 * database, and say plainly which one it is now on.
 *
 * WHY THIS EXISTS
 * Switching used to mean copying one of three `.env.local.*` backup files over
 * `.env.local` by hand. Nothing said which was active, nothing stopped a
 * session that believed it was local from writing to 21 live tenant sites,
 * and the backups were hand-maintained, so they went stale silently.
 *
 * VALUES ARE FETCHED, NEVER STORED
 * Local settings come from `supabase status`, cloud settings from Doppler.
 * Both are asked at the moment of the switch, so neither can go stale, and no
 * production credential is ever written into a file this script maintains.
 *
 * THE ASYMMETRY IS THE POINT
 * `local` just works. `cloud` makes you type the word "production", because
 * the whole exercise is moving work OFF production - a switch that costs
 * nothing to flick is a switch that gets flicked absent-mindedly.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// One classifier, shared with the banner and the dev guard. Three copies of
// "is this local?" is three chances for them to disagree about the one
// question the whole setup rests on.
const { classify } = createRequire(import.meta.url)(path.join(ROOT, 'lib/environmentBanner.js'));
const ENV_FILE = path.join(ROOT, '.env.local');

// Built from a character code so no escape byte ever sits in this source file.
const ESC = String.fromCharCode(27);
const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `${ESC}[${code}m${text}${ESC}[0m` : text);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);
const dim = (t) => paint('2', t);
const bold = (t) => paint('1', t);

/** The three settings that decide which database this checkout talks to. */
const MANAGED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'];

function die(message, fix) {
  process.stdout.write(`\n${red(bold('Stopped.'))} ${message}\n`);
  if (fix) process.stdout.write(`${yellow('Fix:')} ${fix}\n`);
  process.stdout.write('\n');
  process.exit(1);
}

function usage() {
  process.stdout.write(`
${bold('npm run db:use local')}    ${dim('- your own machine. Safe to break.')}
${bold('npm run db:use cloud')}    ${dim('- the live database. Asks first.')}
${bold('npm run db:use')}          ${dim('- just say which one I am on.')}

`);
}

/**
 * The settings a brand-new work folder needs, and NOTHING else.
 *
 * WHY THIS IS NOT A COPY OF THE MAIN FOLDER'S FILE
 * That file carries eighty-odd live API keys. Copying it is the advice this
 * script used to give, and it is advice an agent may not follow: agents never
 * handle live credentials. So the one gate CI cannot run - `check:panels`,
 * which needs a logged-in app, which needs a database - was also the one gate
 * an unattended pass could not run. Three tickets hit that on 2026-08-23.
 *
 * The three Supabase lines are filled in by `localSettings()` from
 * `supabase status`, so they are the development defaults printed on every
 * machine. They are not secrets and they are not the production values.
 *
 * A folder that later needs one real key gets that ONE line copied across by
 * hand, by the operator. Never the whole file.
 */
function seedTemplate() {
  return `# Local development settings for this work folder.
#
# Written by \`npm run env:local\`. Everything below points at the Supabase
# running on THIS machine. Its keys are the development defaults that
# \`supabase start\` prints identically on every machine - not secrets, and not
# the production values. Nothing here reaches production, and .gitignore keeps
# this file out of git.
#
# Deliberately absent: the live API keys the main folder carries. A work folder
# does not need them to build, test, or look at the app. If the one feature you
# are on needs one, copy that single line across by hand.

# Which database this folder talks to. \`npm run db:use\` switches it, and the
# strip across the top of the app says which one is live.
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# Production scopes every query to one tenant. Match it, or a bug that only
# shows up under scoping will not show up here.
STRICT_PROJECT_SCOPE=true

# Where the app believes it is served from.
PUBLIC_APP_ORIGIN=http://localhost:3001

# PORT is deliberately unset. Every worktree wants 3001, the first one started
# wins, and the rest fail quietly - which is how a browser check gets driven
# against another thread's code. Give this folder its own:
#     PORT=3057 node server.js
`;
}

/** The file as it stands, or null if this folder has never had one. */
function readEnvOrNull() {
  try {
    return fs.readFileSync(ENV_FILE, 'utf8');
  } catch (_) {
    return null;
  }
}

function valueOf(text, key) {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
  if (!match) return '';
  let value = match[1].trim();
  if (value.length > 1 && /^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
  return value;
}

/**
 * Replace each managed key in place, keeping every other line - comments,
 * ordering and the seventy-odd unrelated settings - exactly as it was.
 * A switcher that rewrites the whole file is a switcher that loses things.
 */
function writeEnv(text, values) {
  let next = text;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    next = new RegExp(`^${key}=.*$`, 'm').test(next)
      ? next.replace(new RegExp(`^${key}=.*$`, 'm'), line)
      : `${next.replace(/\n*$/, '')}\n${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, next);
}

const LABELS = {
  unknown: () => yellow('nothing - no database configured'),
  local: () => green('LOCAL - your own machine'),
  production: () => red(bold('PRODUCTION - the live database')),
};

function describe(url) {
  const kind = classify(url);
  // `cloud` is the word the command takes; `production` is what the shared
  // classifier calls it. Map once, here, rather than teaching either side
  // the other's vocabulary.
  return { kind: kind === 'production' ? 'cloud' : kind, label: LABELS[kind]() };
}

function localSettings() {
  let raw;
  try {
    raw = execFileSync('supabase', ['status', '-o', 'json'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    die('Could not read your local Supabase settings.', 'npm run doctor      (it will tell you what to start)');
  }
  // `supabase status` prints a line about stopped services before the JSON.
  const json = raw.slice(raw.indexOf('{'));
  let status;
  try {
    status = JSON.parse(json);
  } catch (_) {
    die('Could not understand what `supabase status` returned.');
  }
  if (!status.API_URL) die('Your local Supabase is not reporting an address.', 'supabase start');
  return {
    SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_KEY: status.SERVICE_ROLE_KEY,
  };
}

function cloudSettings() {
  const out = {};
  for (const key of MANAGED) {
    try {
      out[key] = execFileSync(
        'doppler',
        ['secrets', 'get', key, '--plain', '--project', 'starcaster', '--config', 'prd', '--no-check-version'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    } catch (_) {
      die(`Doppler has no ${key} in the prd config, so the switch would half-work.`);
    }
    if (!out[key]) die(`Doppler returned an empty ${key}.`);
  }
  return out;
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim().toLowerCase());
    });
  });
}

const target = String(process.argv[2] || '').toLowerCase();
let text = readEnvOrNull();
// A folder with no settings file at all is a THIRD state, not a failure of the
// switch. Which of the three things you asked for decides what it means.
const bootstrapping = text === null && target === 'local';
if (text === null) {
  if (bootstrapping) {
    text = seedTemplate();
  } else if (!target) {
    // "Which database am I on?" has a true answer here: none.
    process.stdout.write(`\n  Currently on: ${LABELS.unknown()}\n`);
    process.stdout.write(`  ${yellow('Fix:')} npm run env:local   ${dim('- writes one pointed at this machine')}\n`);
    usage();
    process.exit(0);
  } else {
    die(
      'This folder has no .env.local, so there is nothing to point at the live database.',
      'npm run env:local      (writes one pointed at the database on this machine)',
    );
  }
}
const current = describe(valueOf(text, 'SUPABASE_URL'));

if (!target) {
  process.stdout.write(`\n  Currently on: ${current.label}\n`);
  process.stdout.write(`  ${dim(valueOf(text, 'SUPABASE_URL') || '(nothing set)')}\n`);
  usage();
  process.exit(0);
}

if (!['local', 'cloud'].includes(target)) {
  process.stdout.write(`\n"${target}" is not something I can switch to.\n`);
  usage();
  process.exit(1);
}

if (target === 'cloud') {
  process.stdout.write(`\n${red(bold('  This points your app at the LIVE database.'))}\n`);
  process.stdout.write('  21 tenant sites read from it. Anything you change is real and immediate,\n');
  process.stdout.write('  and `npm run db:refresh` will refuse to run while you are on it.\n\n');
  // Typing a word, not pressing y. The cost is the point.
  const answer = await confirm('  Type production to continue, or press Enter to cancel: ');
  if (answer !== 'production') {
    process.stdout.write(`\n  ${green('Cancelled - still on ' + current.kind + '.')}\n\n`);
    process.exit(0);
  }
}

const values = target === 'local' ? localSettings() : cloudSettings();
writeEnv(text, values);

// Read it back. The write reporting success is not evidence the file says
// what we meant - a .org-for-.com typo in a saved setting cost an hour once.
const after = describe(valueOf(fs.readFileSync(ENV_FILE, 'utf8'), 'SUPABASE_URL'));
if (after.kind !== target) {
  die(`Wrote the settings, but this folder still reads as ${after.kind}. Nothing is switched.`);
}

if (bootstrapping) {
  process.stdout.write(`\n  ${green('Wrote .env.local')} ${dim('- this folder can reach a database now.')}\n`);
  process.stdout.write(`  ${dim('No live credential is in it. See the comments at the top of the file.')}\n`);
}
process.stdout.write(`\n  Now on: ${after.label}\n`);
process.stdout.write(`  ${dim(values.SUPABASE_URL)}\n\n`);
if (target === 'local') {
  process.stdout.write(`  ${dim('Restart the app for it to take effect:  npm run dev')}\n\n`);
} else {
  process.stdout.write(`  ${yellow('Switch back when you are done:  npm run db:use local')}\n\n`);
}
