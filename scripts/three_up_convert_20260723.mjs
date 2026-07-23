#!/usr/bin/env node
'use strict';
/**
 * Three-Up content conversion — 2026-07-23.
 *
 * WHAT THIS DOES
 * Takes a single "text" module on a Marinoff page whose HTML holds several
 * <h2> sub-sections (each an intro + bullet list) and pours those sub-sections
 * into the styled three-column "Three-Up" saved section (gradient cells, rounded
 * borders) that Dane cloned from the traffic-dui page.  For each job it INSERTS,
 * directly after the source section:
 *   1. a full-width heading row (the module's leading <h1>, downgraded to <h2>)
 *   2. a Three-Up three-column section, one sub-section per column, left→right
 *      in document order.
 * The original section is left untouched, so the page can be compared side by
 * side and the old block deleted later once approved.
 *
 * The three columns' text is restyled to match the Three-Up template:
 *   - <h2> sub-headings become <h3>
 *   - bullet items are bolded at 14px, like the traffic-dui cards
 *   - intro / context / closing paragraphs are bolded
 * The inserted section is a STANDALONE copy of the Three-Up styling — it is NOT
 * linked to the saved-section master (no savedSectionId / canonical), so editing
 * it later never propagates to other pages.
 *
 * SAFETY
 *  - Dry run by default; pass --apply to write.
 *  - The split must yield exactly as many <h2> chunks as expectedHeadings, and
 *    each heading must match (case/space-insensitive).  Any mismatch aborts
 *    before a single write.
 *  - Re-running is a no-op: a page that already carries the inserted sections
 *    (matched by their marker titles) is skipped.
 *  - A full JSON backup of every touched page row is written first.
 *
 * Usage:  node scripts/three_up_convert_20260723.mjs [--apply]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');

const PROJECT_ID = 'proj_1780601274760_97i84r'; // Marinoff & Associates
const PAGES_TABLE = 'builder_landing_page';
const SAVED_TABLE = 'builder_saved_sections';
const TEMPLATE_ID = 'saved_section_1784833934959_b5uha6'; // "Three-Up"
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

// Columns receive the sub-sections in document order (left-to-right on screen).
const COLUMN_ORDER = ['left', 'center', 'right'];

/**
 * One job per page/section to convert.  `sourceModuleId` is the text module
 * whose HTML is split; `anchorSectionId` is the section the new rows are
 * inserted after (usually the same section that holds the source module).
 */
// `expectedHeadings` lists the sub-sections that go into the three cards, in
// column order.  If the source module holds MORE <h2> sub-sections than that,
// the job must set `allowExtraChunks: true` to acknowledge the trailing ones
// are deliberately dropped from the cards (they stay in the original block,
// which the insert keeps intact) — otherwise the run aborts.
const JOBS = [
  {
    slug: 'drug-crimes',
    anchorSectionId: 'section-1f91ac86-7404-42e9-a918-2e3386311456', // "Content Block 2"
    sourceModuleId: 'module-aeeafe39-cf70-4bfb-a824-7a8e28eb9f48',
    expectedHeadings: [
      'Challenging Searches and Seizures',
      'Examining the Evidence',
      'Evaluating Defense Options',
    ],
  },
  {
    slug: 'domestic-violence',
    anchorSectionId: '6ceabe5f-1967-4e4a-b1fc-e5f1e6252e39', // "Content Block 1"
    sourceModuleId: 'ebfee161-02a4-4785-8cef-b261e8a4f7b4',
    expectedHeadings: [
      'Reviewing the Evidence',
      'Protection Orders and No-Contact Conditions',
      'Developing a Defense Strategy',
    ],
  },
  {
    slug: 'restraining-orders',
    anchorSectionId: '56fd2f17-0c63-4aaa-8a6e-27e686ced9c8',
    sourceModuleId: 'module-d19b5b30-029f-4f36-9cff-cf9b34c7a37e',
    expectedHeadings: [
      'Seeking a Protection Order',
      'Responding to a Protection Order',
      'Related Legal Consequences',
    ],
  },
  {
    // Source has a 4th sub-section, "Addressing Related Consequences", which is
    // deliberately dropped from the cards (Dane's call, 2026-07-23).
    slug: 'assaults',
    anchorSectionId: 'section-1f91ac86-7404-42e9-a918-2e3386311456', // "Content Block 2"
    sourceModuleId: 'module-aeeafe39-cf70-4bfb-a824-7a8e28eb9f48',
    allowExtraChunks: true,
    expectedHeadings: [
      'Investigating the Allegations',
      'Evaluating Self-Defense',
      'Challenging the Prosecution’s Case',
    ],
  },
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

const clone = (v) => JSON.parse(JSON.stringify(v));
const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => stripTags(s).toLowerCase();

/** Restyle a sub-section's HTML to match the Three-Up template cards. */
function styleLikeTemplate(html) {
  let out = html;
  out = out.replace(/<h2>/gi, '<h3>').replace(/<\/h2>/gi, '</h3>');
  // Bullets: 14px + bold, like the traffic-dui Three-Up.
  out = out.replace(
    /<li><p>(.*?)<\/p><\/li>/gi,
    '<li><p><span style="font-size: 14px;"><strong>$1</strong></span></p></li>'
  );
  // Remaining bare paragraphs (intro / context / closing): bold.
  out = out.replace(/<p>(?!<span)(.+?)<\/p>/gi, '<p><strong>$1</strong></p>');
  return out;
}

/**
 * Split a text module's HTML at its <h2> boundaries.
 * Returns { preamble, chunks } where preamble is everything before the first
 * <h2> (the leading <h1>) and chunks are the per-<h2> sub-sections.
 */
function splitByH2(html) {
  const parts = html.split(/(?=<h2\b)/i);
  const preamble = /^<h2\b/i.test(parts[0]) ? '' : parts.shift();
  return { preamble: preamble || '', chunks: parts };
}

function makeTextModule(column, text, settings) {
  return {
    id: `text-${randomUUID()}`,
    name: '',
    text,
    type: 'text',
    column,
    settings: clone(settings),
  };
}

// ------------------------------------------------------------------- run ---

const { data: savedRows, error: savedErr } = await sb
  .from(SAVED_TABLE).select('*').eq('id', TEMPLATE_ID);
if (savedErr) { console.error(savedErr.message); process.exit(1); }
if (!savedRows?.length) { console.error(`template ${TEMPLATE_ID} not found`); process.exit(1); }

const templateSection = typeof savedRows[0].section === 'string'
  ? JSON.parse(savedRows[0].section) : savedRows[0].section;
const templateModuleSettings = (templateSection.modules || []).find((m) => m.type === 'text')?.settings
  || { variant: 'intro', mobileHidden: 'false', desktopHidden: 'false', verticalMargin: '0' };

console.log(`Template "${savedRows[0].name}" (${TEMPLATE_ID}) — layout ${templateSection.layout}\n`);

const touched = [];

for (const job of JOBS) {
  console.log(`── ${job.slug} ──────────────────────────────────────────`);

  const { data: pageRows, error: pageErr } = await sb
    .from(PAGES_TABLE).select('id,slug,layout_sections')
    .eq('project_id', PROJECT_ID).eq('slug', job.slug);
  if (pageErr) { console.error(pageErr.message); process.exit(1); }
  if (!pageRows?.length) { console.error(`  page /${job.slug} not found`); process.exit(1); }

  const row = pageRows[0];
  const doc = typeof row.layout_sections === 'string'
    ? JSON.parse(row.layout_sections) : row.layout_sections;
  const sections = Array.isArray(doc) ? doc : (doc?.sections || []);

  const HEADING_TITLE = `Three-Up Heading — ${job.slug}`;
  const CARDS_TITLE = `Three-Up — ${job.slug}`;
  if (sections.some((s) => s.title === CARDS_TITLE || s.title === HEADING_TITLE)) {
    console.log('  already converted — skipping.\n');
    continue;
  }

  const anchorIdx = sections.findIndex((s) => s.id === job.anchorSectionId);
  if (anchorIdx < 0) { console.error(`  anchor section ${job.anchorSectionId} not found`); process.exit(1); }

  let sourceModule = null;
  for (const s of sections) {
    const m = (s.modules || []).find((mm) => mm.id === job.sourceModuleId);
    if (m) { sourceModule = m; break; }
  }
  if (!sourceModule) { console.error(`  source module ${job.sourceModuleId} not found`); process.exit(1); }

  const { preamble, chunks } = splitByH2(sourceModule.text || '');

  // ---- safety asserts -----------------------------------------------------
  const useCount = job.expectedHeadings.length;
  const problems = [];
  if (chunks.length < useCount) {
    problems.push(`found ${chunks.length} <h2> sub-sections, need at least ${useCount}`);
  }
  if (chunks.length > useCount && !job.allowExtraChunks) {
    problems.push(`found ${chunks.length} <h2> sub-sections but only ${useCount} expected; set allowExtraChunks to drop the rest`);
  }
  job.expectedHeadings.forEach((expected, i) => {
    const h = ((chunks[i] || '').match(/<h2\b[^>]*>(.*?)<\/h2>/i) || [, ''])[1];
    if (norm(h) !== norm(expected)) {
      problems.push(`#${i}: heading "${stripTags(h)}", expected "${expected}"`);
    }
  });
  if (problems.length) {
    console.error('  ABORT — source does not match expectation:');
    for (const p of problems) console.error('    ' + p);
    process.exit(1);
  }
  const usedChunks = chunks.slice(0, useCount);
  const droppedChunks = chunks.slice(useCount);
  console.log(`  ✓ ${useCount} sub-sections matched: ${job.expectedHeadings.join(' | ')}`);
  if (droppedChunks.length) {
    const dh = droppedChunks.map((c) => stripTags((c.match(/<h2\b[^>]*>(.*?)<\/h2>/i) || [, ''])[1]));
    console.log(`  ⚠ dropped from cards (stays in original block): ${dh.join(' | ')}`);
  }

  // ---- build the two new sections -----------------------------------------
  // 1. full-width heading row (leading <h1> → <h2> to avoid a duplicate H1).
  const headingHtml = (preamble || '<h2>Overview</h2>')
    .replace(/<h1>/gi, '<h2>').replace(/<\/h1>/gi, '</h2>');
  const headingSection = clone(templateSection);
  headingSection.id = `section-${randomUUID()}`;
  headingSection.title = HEADING_TITLE;
  headingSection.layout = 'single';
  headingSection.alignment = 'center';
  delete headingSection.savedSectionId;
  delete headingSection.canonical;
  headingSection.modules = [makeTextModule('main', headingHtml, templateModuleSettings)];

  // 2. the styled three-column cards.
  const cardsSection = clone(templateSection);
  cardsSection.id = `section-${randomUUID()}`;
  cardsSection.title = CARDS_TITLE;
  delete cardsSection.savedSectionId;
  delete cardsSection.canonical;
  cardsSection.modules = usedChunks.map((chunk, i) =>
    makeTextModule(COLUMN_ORDER[i] || COLUMN_ORDER[COLUMN_ORDER.length - 1], styleLikeTemplate(chunk), templateModuleSettings));

  sections.splice(anchorIdx + 1, 0, headingSection, cardsSection);

  console.log(`  heading: "${stripTags(headingHtml).slice(0, 60)}"`);
  cardsSection.modules.forEach((m) =>
    console.log(`    ${m.column.padEnd(6)} ← ${stripTags(m.text).slice(0, 60)}`));
  console.log(`  inserted after section [${anchorIdx}] (new page length ${sections.length})\n`);

  const nextDoc = Array.isArray(doc) ? sections : { ...doc, sections };
  touched.push({ row, nextDoc, backup: row.layout_sections });
}

if (!touched.length) { console.log('Nothing to do.'); process.exit(0); }

if (!APPLY) {
  console.log('DRY RUN — nothing written. Re-run with --apply to write.');
  process.exit(0);
}

mkdirSync(BACKUP_DIR, { recursive: true });
const backupFile = path.join(BACKUP_DIR, `three_up_convert_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backupFile, JSON.stringify({
  savedAt: new Date().toISOString(),
  pages: touched.map((t) => ({ id: t.row.id, slug: t.row.slug, layout_sections: t.backup })),
}, null, 2));
console.log(`Backup written: ${path.relative(ROOT, backupFile)}\n`);

let written = 0;
for (const { row, nextDoc } of touched) {
  const { error } = await sb
    .from(PAGES_TABLE)
    .update({ layout_sections: nextDoc, updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if (error) { console.error(`  /${row.slug} FAILED: ${error.message}`); continue; }
  written += 1;
  console.log(`  /${row.slug} updated`);
}

console.log(`\nDone. ${written} of ${touched.length} page(s) updated.`);
console.log(`Rollback: restore layout_sections for those pages from ${path.relative(ROOT, backupFile)}`);
