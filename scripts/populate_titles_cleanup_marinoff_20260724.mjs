#!/usr/bin/env node
'use strict';
/**
 * One-time cleanup — 2026-07-24.
 *
 * The Populate Module Titles extension shipped reading only dedicated heading
 * modules, missed the headings embedded in rich-text modules, and fell through
 * to keyword-stuffed image ALT text. That wrote ~52 wrong section titles like
 * "Colorado criminal defense attorney" onto a section actually headed
 * "Sex Offenses". The extractor is now fixed (collectHeadings parses embedded
 * <h1>-<h6>), but the already-saved wrong titles are non-blank, so a normal
 * blanks-only re-run skips them.
 *
 * WHAT THIS DOES
 * For the Marinoff project, finds sections whose current title is EXACTLY one of
 * that section's own image ALT strings (the tool's fingerprint) and re-derives
 * the title with the fixed logic (default priority = heading first). Only those
 * sections are touched; hand-written titles are left alone. Section titles are
 * Builder-editor labels only — they are not rendered on the public site.
 *
 * SAFETY
 * - Dry run by default. Pass --apply to write.
 * - Writes a full JSON backup of every Marinoff page BEFORE any update.
 * - Only string section titles are changed; the document shape is preserved.
 *
 * Usage:  node scripts/populate_titles_cleanup_marinoff_20260724.mjs [--apply]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = require('@supabase/supabase-js');
const { htmlToPlainText } = require(path.join(ROOT, 'lib/builderPageContentExtract.js'));
const { deriveTitle, DEFAULT_TITLE_PRIORITY } = require(path.join(ROOT, 'lib/populateModuleTitles.js'));

const PROJECT_ID = 'proj_1780601274760_97i84r'; // Marinoff & Associates
const PAGES_TABLE = 'builder_landing_page';
const APPLY = process.argv.includes('--apply');
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

// .env.local is gitignored and only exists in the primary checkout, not in
// worktrees — read it from the main repo.
const ENV_FILE = process.env.STARCASTER_ENV_FILE || '/Users/mentor/WebApps/starcaster/.env.local';
function loadEnv() {
  const env = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const env = loadEnv();
const sb = createClient(env.NEW_SUPABASE_URL, env.NEW_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const norm = (s) => htmlToPlainText(String(s || '')).replace(/\s+/g, ' ').trim().toLowerCase();

function docOf(row) {
  let d = row.layout_sections;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } }
  return d && typeof d === 'object' ? d : null;
}
function sectionsOf(doc) {
  if (!doc) return [];
  if (Array.isArray(doc.sections)) return doc.sections;
  if (Array.isArray(doc.layoutSections)) return doc.layoutSections;
  return [];
}

const { data, error } = await sb.from(PAGES_TABLE).select('id,name,slug,layout_sections').eq('project_id', PROJECT_ID);
if (error) { console.error('Query failed:', error.message); process.exit(1); }

const changesByPage = new Map(); // pageId -> { name, doc, changes:[{from,to}] }

for (const page of data) {
  const doc = docOf(page);
  const sections = sectionsOf(doc);
  if (!sections.length) continue;
  const pageChanges = [];
  for (const sec of sections) {
    const title = String(sec?.title || '').trim();
    if (!title) continue;
    const mods = Array.isArray(sec.modules) ? sec.modules : [];
    const altMatch = mods.some((m) =>
      ['image', 'floating-image'].includes(String(m?.type || '').toLowerCase()) &&
      norm(m?.settings?.alt) === norm(title));
    if (!altMatch) continue; // not a tool fingerprint — leave it alone
    const next = deriveTitle(mods, DEFAULT_TITLE_PRIORITY);
    if (!next || norm(next) === norm(title)) continue;
    sec.title = next; // mutate the doc we'll write back
    pageChanges.push({ from: title, to: next });
  }
  if (pageChanges.length) changesByPage.set(page.id, { name: page.name, doc, changes: pageChanges });
}

let total = 0;
console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} — Populate Titles cleanup (Marinoff)\n`);
for (const { name, changes } of changesByPage.values()) {
  console.log(`[${name}]`);
  for (const c of changes) { console.log(`   "${c.from}"  ->  "${c.to}"`); total++; }
}
console.log(`\nPages affected: ${changesByPage.size}   Section titles to change: ${total}`);

if (!APPLY) {
  console.log('\nDry run only — nothing written. Re-run with --apply to write.');
  process.exit(0);
}

// --- APPLY ---
mkdirSync(BACKUP_DIR, { recursive: true });
const backupPath = path.join(BACKUP_DIR, `populate_titles_cleanup_backup_20260724.json`);
writeFileSync(backupPath, JSON.stringify(data, null, 2));
console.log(`\nBackup of all ${data.length} Marinoff pages written to:\n  ${backupPath}\n`);

let ok = 0, fail = 0;
for (const [pageId, { name, doc }] of changesByPage.entries()) {
  const { error: upErr } = await sb.from(PAGES_TABLE).update({ layout_sections: doc }).eq('id', pageId);
  if (upErr) { console.error(`  FAIL [${name}]: ${upErr.message}`); fail++; }
  else { console.log(`  updated [${name}]`); ok++; }
}
console.log(`\nDone. Pages updated: ${ok}   Failed: ${fail}`);
