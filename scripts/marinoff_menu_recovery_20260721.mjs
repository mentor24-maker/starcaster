#!/usr/bin/env node
'use strict';
/**
 * Marinoff canonical-header menu recovery — 2026-07-21.
 *
 * WHAT WENT WRONG
 * The "Header" saved section (the canonical master) still held the pre-punch-list
 * 28-item menu.  Saving an unrelated styling change to that master on 2026-07-21
 * at 20:35:27 fired propagateCanonicalSection(), which pushed the whole stale
 * header onto all 46 linked pages between 20:35:34 and 20:36:04 — reverting the
 * punch-list menu (Traffic/DUI, Drugs, Violent Crimes, Theft/Fraud, Domestic
 * Violence, Assaults, Restraining Orders, Federal Crimes, no family law) that had
 * been applied directly to the page rows on 2026-07-17.
 *
 * WHAT THIS DOES
 * Rebuilds the correct 26-item menu from the punch-list transform rules in
 * scripts/marinoff_punchlist_20260717.mjs, writes it into the master (preserving
 * every other setting, including the new per-item widths), then republishes the
 * master onto every canonical instance — the same convergence
 * propagateCanonicalSection() performs.
 *
 * SAFETY
 * - The rebuilt menu is asserted against EXPECTED (label + href, in order),
 *   captured from the live home page before the overwrite.  Any mismatch aborts
 *   before a single write.
 * - A full JSON backup of every page row and the master is written first.
 * - Dry run by default.  Pass --apply to write.
 *
 * Usage:  node scripts/marinoff_menu_recovery_20260721.mjs [--apply]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = require('@supabase/supabase-js');

const PROJECT_ID = 'proj_1780601274760_97i84r'; // Marinoff & Associates
const PAGES_TABLE = 'builder_landing_page';
const SAVED_TABLE = 'builder_saved_sections';
const MASTER_ID = 'saved_section_1781826409772_rcsh6r'; // "Header"
const STAMP = '20260717'; // keep the punch-list id convention for the added items
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

const APPLY = process.argv.includes('--apply');

/** The menu as it stood on the live home page before the 20:35 overwrite. */
const EXPECTED = [
  ['Home', 'home'],
  ['About', 'about'],
  ['Criminal Law', 'criminal-law'],
  ['Immigration Law', 'immigration-law'],
  ['Blog', 'blog-home'],
  ['Contact', 'contact'],
  ['Our Team', 'our-team'],
  ['Traffic/DUI', 'traffic-crimes'],
  ['Drugs', 'drug-crimes'],
  ['Sex Offenses', 'sex-offenses'],
  ['Violent Crimes', 'homicide'],
  ['Theft/Fraud', 'theft-fraud'],
  ['Domestic Violence', 'domestic-violence'],
  ['Assaults', 'assaults'],
  ['Restraining Orders', 'restraining-orders'],
  ['Federal Crimes', 'federal-crimes'],
  ['Removal Defense', 'removal-defense'],
  ['Asylum', 'asylum'],
  ['Waivers', 'waivers'],
  ['U-Visas', 'u-visas'],
  ['Business & Investment Visas', 'business-investment-visas'],
  ['VAWA', 'vawa'],
  ['Family Petitions', 'family-petitions'],
  ['Citizenship', 'citizenship'],
  ['Student Visa', 'student-visa'],
  ['Testimonials', 'testimonials'],
];

const NAV_RENAMES = new Map([
  ['Traffic Crimes', 'Traffic/DUI'],
  ['Drug Crimes', 'Drugs'],
  ['Homicide', 'Violent Crimes'],
]);
const CRIMINAL_DROP = new Set(['Theft', 'Embezzelment', 'Embezzlement', 'Fraud']);
const CRIMINAL_ADD = [
  { label: 'Theft/Fraud', href: 'theft-fraud' },
  { label: 'Domestic Violence', href: 'domestic-violence' },
  { label: 'Assaults', href: 'assaults' },
  { label: 'Restraining Orders', href: 'restraining-orders' },
  { label: 'Federal Crimes', href: 'federal-crimes' },
];

// ---------------------------------------------------------------- env / db --

function loadEnv() {
  const env = {};
  for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
// The live Marinoff data is in the cloud project; .env.local's active
// SUPABASE_URL points at the local dev stack.
const SB_URL = env.NEW_SUPABASE_URL;
const SB_KEY = env.NEW_SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error('Missing NEW_SUPABASE_URL / NEW_SUPABASE_SERVICE_KEY in .env.local');
  process.exit(1);
}
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ------------------------------------------------------------- transform ---

/**
 * Rebuild the punch-list menu from the stale one.
 *  1. drop orphans (children whose parent no longer exists — the family-law tabs)
 *  2. rename the three renamed practice areas
 *  3. drop the Theft / Embezzelment / Fraud children of Criminal Law
 *  4. insert the five new Criminal Law children after the last surviving one
 */
function rebuildMenu(items) {
  const ids = new Set(items.map((i) => i.id));
  let next = items.filter((i) => !i.parentId || ids.has(i.parentId));

  for (const item of next) {
    if (NAV_RENAMES.has(item.label)) item.label = NAV_RENAMES.get(item.label);
  }

  const criminal = next.find((i) => i.label === 'Criminal Law' && !i.parentId);
  if (!criminal) throw new Error('no top-level "Criminal Law" item found');

  next = next.filter((i) => !(i.parentId === criminal.id && CRIMINAL_DROP.has(i.label)));

  const present = new Set(next.filter((i) => i.parentId === criminal.id).map((i) => i.label));
  const additions = CRIMINAL_ADD.filter((a) => !present.has(a.label)).map((a) => ({
    id: `nav-${STAMP}-${a.href}`,
    label: a.label,
    href: a.href,
    parentId: criminal.id,
  }));

  let lastIdx = -1;
  next.forEach((i, idx) => { if (i.parentId === criminal.id) lastIdx = idx; });
  return [...next.slice(0, lastIdx + 1), ...additions, ...next.slice(lastIdx + 1)];
}

function assertMatchesExpected(items) {
  const actual = items.map((i) => [i.label || '', i.href || '']);
  const problems = [];
  if (actual.length !== EXPECTED.length) {
    problems.push(`item count ${actual.length}, expected ${EXPECTED.length}`);
  }
  for (let i = 0; i < Math.max(actual.length, EXPECTED.length); i += 1) {
    const a = actual[i];
    const e = EXPECTED[i];
    if (!a || !e || a[0] !== e[0] || a[1] !== e[1]) {
      problems.push(`#${i}: got ${a ? `${a[0]} -> ${a[1]}` : '(missing)'}, expected ${e ? `${e[0]} -> ${e[1]}` : '(none)'}`);
    }
  }
  if (problems.length) {
    console.error('\nABORT — rebuilt menu does not match the pre-overwrite capture:');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
}

// ------------------------------------------------------------------- run ---

const { data: savedRows, error: savedErr } = await sb
  .from(SAVED_TABLE).select('*').eq('id', MASTER_ID);
if (savedErr) { console.error(savedErr.message); process.exit(1); }
if (!savedRows?.length) { console.error(`master ${MASTER_ID} not found`); process.exit(1); }

const masterRow = savedRows[0];
const masterSection = typeof masterRow.section === 'string'
  ? JSON.parse(masterRow.section) : masterRow.section;

const navModule = (masterSection.modules || []).find((m) => m.type === 'navigation');
if (!navModule) { console.error('master header has no navigation module'); process.exit(1); }

const before = JSON.parse(navModule.settings.navItems || '[]');
const after = rebuildMenu(before.map((i) => ({ ...i })));

console.log(`Master "${masterRow.name}" (${MASTER_ID}), updated ${masterRow.updated_at}`);
console.log(`  before: ${before.length} items`);
console.log(`  after : ${after.length} items`);
assertMatchesExpected(after);
console.log('  ✓ rebuilt menu matches the pre-overwrite capture exactly\n');

const widths = after.filter((i) => i.width).map((i) => `${i.label}=${i.width}`);
console.log(`  per-item widths preserved: ${widths.join(', ') || '(none)'}\n`);

const { data: pageRows, error: pageErr } = await sb
  .from(PAGES_TABLE).select('*').eq('project_id', PROJECT_ID);
if (pageErr) { console.error(pageErr.message); process.exit(1); }

/**
 * Home lost its section's `canonical` flag during the 20:36:04 write — the audit
 * taken minutes earlier shows it set.  It is relinked here so it converges with
 * the rest of the site.  /module-tests is also linked-but-unflagged, but it was
 * never canonical and holds the last surviving copy of the correct menu, so it
 * is deliberately left detached.
 */
const RELINK_SLUGS = new Set(['']); // '' === home

const targets = [];
const relinked = [];
for (const row of pageRows || []) {
  const doc = typeof row.layout_sections === 'string'
    ? JSON.parse(row.layout_sections) : row.layout_sections;
  const sections = Array.isArray(doc) ? doc : (doc?.sections || []);
  const linked = sections.filter((s) => s.savedSectionId === MASTER_ID);
  if (!linked.length) continue;
  const isCanonical = linked.some((s) => s.canonical === true);
  const shouldRelink = !isCanonical && RELINK_SLUGS.has(String(row.slug || ''));
  if (!isCanonical && !shouldRelink) continue;
  targets.push({ row, doc, sections });
  if (shouldRelink) relinked.push('/' + (row.slug || '(home)'));
}

console.log(`Pages carrying a canonical instance of this master: ${targets.length} of ${pageRows.length}`);
console.log(targets.map((t) => '/' + (t.row.slug || '(home)')).join(', '));
if (relinked.length) console.log(`  (relinked, canonical flag restored: ${relinked.join(', ')})`);
console.log();

if (!APPLY) {
  console.log('DRY RUN — nothing written.  Re-run with --apply to write.');
  process.exit(0);
}

mkdirSync(BACKUP_DIR, { recursive: true });
const backupFile = path.join(BACKUP_DIR, `marinoff_menu_recovery_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backupFile, JSON.stringify({ savedAt: new Date().toISOString(), master: masterRow, pages: pageRows }, null, 2));
console.log(`Backup written: ${path.relative(ROOT, backupFile)}\n`);

// 1. Write the corrected menu into the master.
navModule.settings.navItems = JSON.stringify(after);
const nowIso = new Date().toISOString();
const { error: masterWriteErr } = await sb
  .from(SAVED_TABLE)
  .update({ section: masterSection, updated_at: nowIso })
  .eq('id', MASTER_ID);
if (masterWriteErr) { console.error('master write failed:', masterWriteErr.message); process.exit(1); }
console.log('Master updated.\n');

// 2. Converge every canonical instance onto the master — the same replacement
//    propagateCanonicalSection() performs (content from master, instance keeps
//    only its own id and its canonical markers).
let written = 0;
for (const { row, doc, sections } of targets) {
  const nextSections = sections.map((s) => (
    s.savedSectionId === MASTER_ID
      ? { ...masterSection, id: s.id, savedSectionId: MASTER_ID, canonical: true }
      : s
  ));
  const nextDoc = Array.isArray(doc) ? nextSections : { ...doc, sections: nextSections };
  const { error } = await sb
    .from(PAGES_TABLE)
    .update({ layout_sections: nextDoc, updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if (error) { console.error(`  /${row.slug || '(home)'} FAILED: ${error.message}`); continue; }
  written += 1;
  console.log(`  /${row.slug || '(home)'} updated`);
}

console.log(`\nDone. ${written} of ${targets.length} pages converged onto the corrected master.`);
console.log(`Rollback: restore page rows and the master from ${path.relative(ROOT, backupFile)}`);
