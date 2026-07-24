#!/usr/bin/env node
'use strict';
/**
 * Merge the two Marinoff "Team Member Photos" rows into one full-width section.
 *
 * WHY
 * /our-team currently holds the six team headshots in TWO separate
 * three-column sections ("Row 1" and "Row 2"), each with its own background
 * (Row 1 a solid, Row 2 a gradient) — which is exactly why the two rows don't
 * match. A single three-column section already renders a 3xN grid, because
 * modules stacked in a column render top-to-bottom. So merging the two rows
 * into one section, set to full width, gives one continuous background behind
 * the whole 3x2 grid.
 *
 * WHAT
 * Keeps the first row's section as the survivor, sets it to full width, gives
 * it ONE background (the gradient, by default — override with --bg=solid), and
 * appends the second row's modules so each column holds its two people stacked
 * (photo, caption, photo, caption). The second section is then removed. Module
 * column assignments already line up (left/center/right), so the left column
 * becomes Brandon over Maria, center Carin over Ivon, right Andrea over Nancy.
 *
 * SAFETY
 *  - Dry run by default; pass --apply to write.
 *  - Aborts unless it finds exactly the two expected sections, each a
 *    three-column section carrying six modules — so it cannot run twice or
 *    against an unexpected page shape.
 *  - Backs up the whole page row first.
 *
 * Usage:
 *   node scripts/merge_team_photos_20260724.mjs           # dry run
 *   node scripts/merge_team_photos_20260724.mjs --apply
 *   node scripts/merge_team_photos_20260724.mjs --bg=solid --apply
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');
const BG_CHOICE = (process.argv.find((a) => a.startsWith('--bg=')) || '--bg=gradient').split('=')[1];

const PROJECT_ID = 'proj_1780601274760_97i84r';
const SLUG = 'our-team';
const PAGES_TABLE = 'builder_landing_page';
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

const ROW1_ID = 'd7302fe9-ff68-431e-a686-d900e683c284'; // Team Member Photos -Row 1 (survivor)
const ROW2_ID = '85414563-66ff-462e-8bdb-8db6a36c42af'; // Team Member Photos -Row 2 (absorbed)

function loadEnv() {
  const env = {};
  for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEW_SUPABASE_URL, env.NEW_SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const { data: rows, error } = await sb
  .from(PAGES_TABLE).select('id,slug,layout_sections')
  .eq('project_id', PROJECT_ID).eq('slug', SLUG);
if (error) { console.error(error.message); process.exit(1); }
if (!rows?.length) { console.error(`page /${SLUG} not found`); process.exit(1); }

const row = rows[0];
const doc = typeof row.layout_sections === 'string' ? JSON.parse(row.layout_sections) : row.layout_sections;
const sections = Array.isArray(doc) ? doc : (doc?.sections || []);

const i1 = sections.findIndex((s) => s.id === ROW1_ID);
const i2 = sections.findIndex((s) => s.id === ROW2_ID);

// ---- safety asserts --------------------------------------------------------
const problems = [];
if (i1 < 0) problems.push(`survivor section ${ROW1_ID} not found (already merged?)`);
if (i2 < 0) problems.push(`second section ${ROW2_ID} not found (already merged?)`);
if (i1 >= 0 && i2 >= 0) {
  if (i2 !== i1 + 1) problems.push(`sections are not adjacent (indices ${i1}, ${i2})`);
  for (const [label, idx] of [['row1', i1], ['row2', i2]]) {
    const s = sections[idx];
    if (s.layout !== 'three-column') problems.push(`${label} layout is "${s.layout}", expected three-column`);
    if ((s.modules || []).length !== 6) problems.push(`${label} has ${(s.modules || []).length} modules, expected 6`);
  }
}
if (problems.length) {
  console.error('ABORT — page is not in the expected shape:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

const survivor = sections[i1];
const absorbed = sections[i2];

// Chosen unified background: the gradient from Row 2 by default.
const gradientBg = { mode: 'gradient', color: '#fff5db', color2: '#eaf4ff', opacity: 100, imageUrl: '', styleKey: '', imageAssetId: '' };
const solidBg = { mode: 'color', color: '#58d9f9', color2: '#eaf4ff', opacity: 100, imageUrl: '', styleKey: '', imageAssetId: '' };
const chosenBg = BG_CHOICE === 'solid' ? solidBg : gradientBg;

// Build the merged section: survivor + row2's modules, one background, full width.
const merged = {
  ...survivor,
  title: 'Team Member Photos',
  widthMode: 'full-width',
  background: chosenBg,
  modules: [...(survivor.modules || []), ...(absorbed.modules || [])],
};

// Confirm each column ends up with two people stacked.
const byCol = {};
for (const m of merged.modules) (byCol[m.column] ||= []).push(m.type);

console.log(`Page /${SLUG} (id ${row.id})`);
console.log(`Merging sections [${i1}] + [${i2}] → one full-width section, background: ${BG_CHOICE}`);
for (const col of ['left', 'center', 'right']) {
  console.log(`   ${col.padEnd(6)} → ${(byCol[col] || []).join(', ')}`);
}
console.log(`   merged module count: ${merged.modules.length} (was ${survivor.modules.length} + ${absorbed.modules.length})`);

// Splice: replace the two sections with the single merged one.
const nextSections = sections.slice();
nextSections.splice(i1, 2, merged);
console.log(`   section count: ${sections.length} → ${nextSections.length}`);

const nextDoc = Array.isArray(doc) ? nextSections : { ...doc, sections: nextSections };

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  process.exit(0);
}

mkdirSync(BACKUP_DIR, { recursive: true });
const backupFile = path.join(BACKUP_DIR, `merge_team_photos_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backupFile, JSON.stringify({ savedAt: new Date().toISOString(), id: row.id, slug: row.slug, layout_sections: row.layout_sections }, null, 2));
console.log(`\nBackup written: ${path.relative(ROOT, backupFile)}`);

const { error: upErr } = await sb
  .from(PAGES_TABLE)
  .update({ layout_sections: nextDoc, updated_at: new Date().toISOString() })
  .eq('id', row.id);
if (upErr) { console.error(`FAILED: ${upErr.message}`); process.exit(1); }

console.log(`/${SLUG} updated.`);
console.log(`Rollback: restore layout_sections for page ${row.id} from ${path.relative(ROOT, backupFile)}`);
