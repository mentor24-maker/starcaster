#!/usr/bin/env node
'use strict';
/**
 * One-time cleanup — 2026-07-25.
 *
 * The Populate Module Titles extension filled blank image-module names from the
 * image ALT text, which on these pages is SEO-keyword-stuffed (e.g.
 * "Trial attorney Colorado"). Unlike section titles there is no better source
 * for a lone image, so the fix (per operator decision) is to BLANK those names
 * rather than re-derive them — reverting the module to unnamed.
 *
 * SCOPE (deliberately narrow)
 * Only image / floating-image modules whose current name is EXACTLY that
 * module's own alt text. That is the tool's fingerprint; hand-set names like
 * "Logo" or "Justice" (which differ from the alt) are left untouched.
 *
 * SAFETY
 * - Dry run by default. Pass --apply to write.
 * - Full JSON backup of every Marinoff page written before any update.
 * - Only clears string module names; document shape is preserved.
 * - Module names are Builder-editor labels; not rendered on the public site.
 *
 * Usage:  node scripts/populate_module_names_cleanup_marinoff_20260725.mjs [--apply]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = require('@supabase/supabase-js');
const { htmlToPlainText } = require(path.join(ROOT, 'lib/builderPageContentExtract.js'));

const PROJECT_ID = 'proj_1780601274760_97i84r'; // Marinoff & Associates
const PAGES_TABLE = 'builder_landing_page';
const IMAGE_TYPES = new Set(['image', 'floating-image']);
const APPLY = process.argv.includes('--apply');
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');
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
function docOf(row) { let d = row.layout_sections; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } } return d && typeof d === 'object' ? d : null; }
const sectionsOf = (doc) => (doc && Array.isArray(doc.sections)) ? doc.sections : (doc && Array.isArray(doc.layoutSections)) ? doc.layoutSections : [];

const { data, error } = await sb.from(PAGES_TABLE).select('id,name,layout_sections').eq('project_id', PROJECT_ID);
if (error) { console.error('Query failed:', error.message); process.exit(1); }

const changesByPage = new Map();
for (const page of data) {
  const doc = docOf(page);
  const pageChanges = [];
  for (const sec of sectionsOf(doc)) {
    for (const m of (Array.isArray(sec.modules) ? sec.modules : [])) {
      const nm = String(m?.name || '').trim();
      if (!nm) continue;
      if (!IMAGE_TYPES.has(String(m?.type || '').toLowerCase())) continue;
      if (norm(m?.settings?.alt) !== norm(nm)) continue; // only the tool's alt=name fingerprint
      m.name = '';
      pageChanges.push(nm);
    }
  }
  if (pageChanges.length) changesByPage.set(page.id, { name: page.name, doc, cleared: pageChanges });
}

let total = 0;
console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} — image module-name cleanup (Marinoff)\n`);
for (const { name, cleared } of changesByPage.values()) {
  console.log(`[${name}]  clearing ${cleared.length}: ${cleared.map((c) => `"${c}"`).join(', ')}`);
  total += cleared.length;
}
console.log(`\nPages affected: ${changesByPage.size}   Image module names to blank: ${total}`);

if (!APPLY) { console.log('\nDry run only — nothing written. Re-run with --apply to write.'); process.exit(0); }

mkdirSync(BACKUP_DIR, { recursive: true });
const backupPath = path.join(BACKUP_DIR, 'populate_module_names_cleanup_backup_20260725.json');
writeFileSync(backupPath, JSON.stringify(data, null, 2));
console.log(`\nBackup of all ${data.length} Marinoff pages written to:\n  ${backupPath}\n`);

let ok = 0, fail = 0;
for (const [pageId, { name, doc }] of changesByPage.entries()) {
  const { error: upErr } = await sb.from(PAGES_TABLE).update({ layout_sections: doc }).eq('id', pageId);
  if (upErr) { console.error(`  FAIL [${name}]: ${upErr.message}`); fail++; } else { console.log(`  updated [${name}]`); ok++; }
}
console.log(`\nDone. Pages updated: ${ok}   Failed: ${fail}`);
