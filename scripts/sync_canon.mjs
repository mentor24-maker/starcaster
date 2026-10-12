#!/usr/bin/env node
/**
 * npm run canon:sync [-- --apply] [-- --project <slug-or-id>] [-- --vault <dir>]
 *
 * Reddit comments 1/4 (task 86bch3jmr). Copies Dane of Earth's canon — the
 * fixed list in lib/canonSync.js — from his vault into the canon_documents
 * table, so a drafter on Vercel can write in his voice. The vault exists only
 * on the machines, never on Vercel; this is the bridge.
 *
 * DRY RUN BY DEFAULT: without --apply it reads the vault and the table and
 * says, per document, unchanged / would update, with the size. With --apply it
 * writes, then reads every row back and checks its hash and both tenant
 * columns. A missing vault file is named and fails the run (exit 1) before
 * anything is written. Exit 0 only when everything agrees.
 *
 *   --project  slug or id in app_projects; default dane-of-earth. The rows'
 *              owner_user_id is that project's created_by_user_id.
 *   --vault    the vault folder to read; default ~/vault. Point it at a fresh
 *              export of the vault's origin/main when the local checkout is
 *              behind (the Mini's often is).
 *
 * The npm script runs it under Doppler's prd config, so it talks to the LIVE
 * database. It prints the database host it is using as its first line.
 * Re-running it is how the canon is refreshed; there is no schedule.
 */

import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const supabase = require('../lib/supabase.js');
const store = require('../lib/canonStore.js');
const { runSync } = require('../lib/canonSync.js');

function parseArgs(argv) {
  const out = { apply: false, project: 'dane-of-earth', vault: path.join(os.homedir(), 'vault') };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--project') out.project = argv[++i] || '';
    else if (a === '--vault') out.vault = argv[++i] || '';
    else if (a === '--help' || a === '-h') out.help = true;
    else { out.unknown = a; }
  }
  return out;
}

async function resolveProject(ref) {
  const table = supabase.tableConfig().appProjects || 'app_projects';
  const v = encodeURIComponent(ref);
  const res = await supabase.sbQuery({
    table,
    query: `select=id,slug,name,created_by_user_id&or=(id.eq.${v},slug.eq.${v})&limit=2`,
  });
  if (!res.ok) return { error: `could not look up project "${ref}": ${res.error}` };
  const rows = Array.isArray(res.data) ? res.data : [];
  if (rows.length !== 1) return { error: `project "${ref}" matched ${rows.length} rows in ${table}; expected exactly one` };
  const row = rows[0];
  if (!row.created_by_user_id) return { error: `project "${ref}" has no created_by_user_id, so the rows would have no owner` };
  return { projectId: row.id, userId: row.created_by_user_id, name: row.name };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('npm run canon:sync [-- --apply] [-- --project <slug-or-id>] [-- --vault <dir>]');
    return 0;
  }
  if (args.unknown) {
    console.error(`canon:sync: unknown argument "${args.unknown}". Try --help.`);
    return 1;
  }
  if (!args.project || !args.vault) {
    console.error('canon:sync: --project and --vault need a value.');
    return 1;
  }

  const { url } = supabase.credentials();
  let host = '(no SUPABASE_URL)';
  try { host = new URL(url).host; } catch { /* reported below */ }
  console.log(`database: ${host}`);
  if (!url) {
    console.error('canon:sync: no database is configured. Run it through `npm run canon:sync`, which supplies one.');
    return 1;
  }

  const project = await resolveProject(args.project);
  if (project.error) {
    console.error(`canon:sync: ${project.error}`);
    return 1;
  }
  console.log(`project:  ${project.name}`);

  const { exitCode } = await runSync(
    { vaultDir: path.resolve(args.vault), apply: args.apply, scope: { projectId: project.projectId, userId: project.userId } },
    { store }
  );
  return exitCode;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => { console.error(`canon:sync crashed: ${err?.stack || err}`); process.exitCode = 1; }
);
