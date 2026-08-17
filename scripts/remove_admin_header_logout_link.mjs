#!/usr/bin/env node
'use strict';
/**
 * Remove the Logout text link from a project's Admin Header. 2026-08-17.
 *
 * Signing out is the fixed corner button, which BuilderPublicSitePage now
 * renders as "Logout" on every admin page. A text link in the header as well
 * was two controls doing one job, and the operator asked for the duplicate to
 * go. lib/projectAdminScaffold.js no longer adds one, so this only cleans up
 * the projects scaffolded (or hand-built) before that change.
 *
 * WHY IT TOUCHES BOTH THE MASTER AND THE PAGES
 * The live site resolves canonical sections from the master on the way out
 * (lib/publicPageFrameResolve.js), so editing the master alone would fix what a
 * visitor sees. The Builder canvas reads each page's STORED copy, though, so
 * leaving those behind means the link is gone from the site but still sitting
 * in the editor. Both get the same edit, in one pass.
 *
 * It does NOT call the propagation endpoint. That rewrites every linked page
 * from the master and can be cut off mid-run by a serverless freeze — 30 of 50
 * pages on 2026-07-22. Editing each row directly cannot half-finish.
 *
 * SAFETY
 * - Dry run by default; --apply writes.
 * - Backs up the master and every touched page to docs/SQL/backups/ first.
 * - Idempotent: a header with no logout link is reported and skipped.
 * - Reads every row back afterwards and reports what it could not verify.
 *
 * Usage:
 *   doppler run --project starcaster --config prd -- \
 *     node scripts/remove_admin_header_logout_link.mjs --project proj_xxx [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { sbQuery, isConfigured } = require(path.join(ROOT, 'lib/supabase.js'));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return '';
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}

const APPLY = process.argv.includes('--apply');
const projectId = arg('project');

if (!projectId) {
  console.error('Usage: node scripts/remove_admin_header_logout_link.mjs --project <projectId> [--apply]');
  process.exit(1);
}
if (!isConfigured()) {
  console.error('Supabase is not configured. Run through Doppler.');
  process.exit(1);
}

/** A module is the logout link if it is text pointing at the virtual logout path. */
function isLogoutTextModule(module) {
  if (!module || module.type !== 'text') return false;
  return /["'\s]\/admin-logout["'\s?#]|href="\/admin-logout"/.test(String(module.text || ''));
}

function stripLogout(section) {
  const modules = Array.isArray(section?.modules) ? section.modules : [];
  const kept = modules.filter((m) => !isLogoutTextModule(m));
  return { section: { ...section, modules: kept }, removed: modules.length - kept.length };
}

const must = (res, what) => {
  if (!res?.ok) throw new Error(`${what} failed: ${res?.error || 'unknown error'}`);
  return res.data;
};

// ── read ────────────────────────────────────────────────────────────────────
const sections = must(
  await sbQuery({
    table: 'builder_saved_sections',
    query: `select=id,name,section&project_id=eq.${encodeURIComponent(projectId)}`,
  }),
  'read saved sections'
);
const master = sections.find((s) => String(s.name || '').trim().toLowerCase() === 'admin header');
if (!master) {
  console.error(`Project ${projectId} has no "Admin Header" saved section — nothing to do.`);
  process.exit(1);
}

const pages = must(
  await sbQuery({
    table: 'builder_landing_page',
    query: `select=id,slug,layout_sections&project_id=eq.${encodeURIComponent(projectId)}`,
  }),
  'read pages'
);
const linked = pages.filter((p) =>
  (p.layout_sections?.sections || []).some((s) => String(s.savedSectionId || '') === master.id)
);

console.log(`\nProject : ${projectId}`);
console.log(`Master  : "${master.name}" (${master.id})`);
console.log(`Linked  : ${linked.length} page(s) — ${linked.map((p) => p.slug).join(', ') || '(none)'}`);
console.log(`Mode    : ${APPLY ? 'APPLY — this writes' : 'dry run — nothing will be written'}\n`);

const masterPlan = stripLogout(master.section);
console.log(`master "${master.name}": ${masterPlan.removed} logout link(s) to remove`);

const pagePlans = [];
for (const page of linked) {
  const list = page.layout_sections?.sections || [];
  let removed = 0;
  const next = list.map((s) => {
    if (String(s.savedSectionId || '') !== master.id) return s;
    const plan = stripLogout(s);
    removed += plan.removed;
    return plan.section;
  });
  console.log(`  ${page.slug.padEnd(24)} ${removed} logout link(s) to remove`);
  if (removed) pagePlans.push({ page, sections: next, removed });
}

const totalRemoved = masterPlan.removed + pagePlans.reduce((n, p) => n + p.removed, 0);
if (!totalRemoved) {
  console.log('\nNothing to remove — already clean.\n');
  process.exit(0);
}

if (!APPLY) {
  console.log(`\nWould remove ${totalRemoved} link(s). Re-run with --apply.\n`);
  process.exit(0);
}

// ── back up, then write ─────────────────────────────────────────────────────
const dir = path.join(ROOT, 'docs/SQL/backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(dir, `admin_header_logout_removal_${projectId}_${stamp}.json`);
writeFileSync(backup, JSON.stringify({ master, pages: linked }, null, 2));
console.log(`\nBackup written: ${path.relative(ROOT, backup)}`);

must(
  await sbQuery({
    method: 'PATCH',
    table: 'builder_saved_sections',
    query: `id=eq.${encodeURIComponent(master.id)}`,
    headers: { Prefer: 'return=representation' },
    body: { section: masterPlan.section },
  }),
  'update master'
);
console.log('master updated');

for (const plan of pagePlans) {
  must(
    await sbQuery({
      method: 'PATCH',
      table: 'builder_landing_page',
      query: `id=eq.${plan.page.id}`,
      headers: { Prefer: 'return=representation' },
      // Spread the stored document so pageBackground and theme are not reset —
      // writing a bare { sections } drops them (CLAUDE.md landmine 13).
      body: { layout_sections: { ...plan.page.layout_sections, sections: plan.sections } },
    }),
    `update page ${plan.page.slug}`
  );
  console.log(`  ${plan.page.slug} updated`);
}

// ── read back ───────────────────────────────────────────────────────────────
console.log('\nVerifying...');
const freshSections = must(
  await sbQuery({
    table: 'builder_saved_sections',
    query: `select=id,name,section&id=eq.${encodeURIComponent(master.id)}`,
  }),
  'verify master'
);
const masterClean = !(freshSections[0]?.section?.modules || []).some(isLogoutTextModule);
console.log(`  master: ${masterClean ? 'clean' : '*** STILL HAS A LOGOUT LINK'}`);

const freshPages = must(
  await sbQuery({
    table: 'builder_landing_page',
    query: `select=id,slug,layout_sections&project_id=eq.${encodeURIComponent(projectId)}`,
  }),
  'verify pages'
);
let dirty = 0;
for (const page of freshPages) {
  const has = (page.layout_sections?.sections || []).some((s) =>
    (s.modules || []).some(isLogoutTextModule)
  );
  const sectionCount = (page.layout_sections?.sections || []).length;
  if (has) {
    dirty += 1;
    console.log(`  ${page.slug}: *** STILL HAS A LOGOUT LINK`);
  } else if (linked.some((p) => p.id === page.id)) {
    console.log(`  ${page.slug}: clean (${sectionCount} sections intact)`);
  }
}

console.log(masterClean && !dirty ? '\nDone — verified.\n' : '\n*** Verification failed; see above.\n');
process.exit(masterClean && !dirty ? 0 : 1);
