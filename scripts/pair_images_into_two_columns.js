#!/usr/bin/env node
'use strict';

/**
 * Put side-by-side images back side by side.
 *
 * WHY THIS EXISTS
 * The site importer flattens a page body into one column. On the Delray home
 * page that produced a single section holding 46 modules in the order
 *
 *   text, image, image, text, image, image, text, image, image, …
 *
 * — thirteen perfect pairs, every one of them a pair of photos that sat beside
 * each other on the original site, now stacked full-width one under the other.
 * The page became 26 screens of scrolling and every photo asked the browser for
 * a full-width file.
 *
 * So this is not a redesign. The pairing is recovered from the order the
 * importer already preserved: a run of two adjacent images becomes one
 * two-column row, left and right.
 *
 * IT ALSO HALVES THE DOWNLOAD. An image in a half-width column tells the
 * browser its slot is ~600px rather than ~1200px, so it fetches the 600px copy.
 * The layout fix and the weight work compound.
 *
 * WHAT IS PRESERVED
 *  - Reading order, exactly. Text between pairs stays between pairs.
 *  - Every section setting — background, padding, borders, alignment — is
 *    copied onto each row the original is split into, and the split rows are
 *    joined so they still render as one continuous block with one background.
 *  - Modules themselves are untouched apart from which column they sit in.
 *
 * SAFETY
 *  - Dry run by default; --apply writes.
 *  - A full JSON backup of every touched page row is written before any write.
 *  - Re-runnable: a row that is already two-column is left alone, so a second
 *    run finds nothing to do.
 *
 * Usage:
 *   node scripts/pair_images_into_two_columns.js --project=proj_… --slug=home
 *   node scripts/pair_images_into_two_columns.js --project=proj_… --slug=home --apply
 *   node scripts/pair_images_into_two_columns.js --project=proj_… --apply     # every page
 */

const fs = require('fs');
const path = require('path');

const envFileArg = process.argv.slice(2).find((a) => a.startsWith('--env-file='));
try {
  const dotenv = require('dotenv');
  if (envFileArg) dotenv.config({ path: path.resolve(process.cwd(), envFileArg.slice('--env-file='.length)) });
  dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}

const { sbQuery, tableConfig } = require('../lib/supabase');

const BACKUP_DIR = path.join(__dirname, '..', 'docs', 'SQL', 'backups');

/** Only these are worth pairing. A slideshow or a table owns its full width. */
const PAIRABLE_TYPES = new Set(['image']);

function arg(name, fallback = '') {
  const found = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function describeTarget() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  if (!url) return 'no SUPABASE_URL set';
  return `${url} ${/localhost|127\.0\.0\.1/.test(url) ? '(LOCAL database)' : '(CLOUD — the live site)'}`;
}

let idCounter = 0;
function newSectionId() {
  idCounter += 1;
  return `pair_${Date.now().toString(36)}_${idCounter}`;
}

/**
 * One row split into several, each inheriting the original's styling.
 * `joinWithPrevious` on everything after the first keeps them rendering as a
 * single block under one background, exactly as the one row did.
 */
function cloneSectionShell(section, { layout, modules, isFirst }) {
  const shell = { ...section };
  delete shell.modules;
  return {
    ...shell,
    id: newSectionId(),
    layout,
    modules,
    joinWithPrevious: isFirst ? section.joinWithPrevious === true : true,
  };
}

/**
 * Split one single-column section into rows, pairing adjacent images.
 * Returns null when there is nothing worth changing.
 */
function pairSection(section) {
  if (String(section.layout || 'single') !== 'single') return null;

  const modules = Array.isArray(section.modules) ? section.modules : [];
  if (modules.length < 2) return null;

  // Is there anything to do? A run of two or more adjacent images.
  let hasRun = false;
  for (let i = 1; i < modules.length; i += 1) {
    if (PAIRABLE_TYPES.has(modules[i].type) && PAIRABLE_TYPES.has(modules[i - 1].type)) {
      hasRun = true;
      break;
    }
  }
  if (!hasRun) return null;

  const out = [];
  let buffer = [];
  let pairs = 0;

  const flushBuffer = () => {
    if (!buffer.length) return;
    out.push(
      cloneSectionShell(section, {
        layout: 'single',
        modules: buffer.map((m) => ({ ...m, column: 'main' })),
        isFirst: out.length === 0,
      })
    );
    buffer = [];
  };

  for (let i = 0; i < modules.length; i += 1) {
    const current = modules[i];
    const next = modules[i + 1];

    if (PAIRABLE_TYPES.has(current.type) && next && PAIRABLE_TYPES.has(next.type)) {
      flushBuffer();
      out.push(
        cloneSectionShell(section, {
          layout: 'two-column',
          modules: [
            { ...current, column: 'left' },
            { ...next, column: 'right' },
          ],
          isFirst: out.length === 0,
        })
      );
      pairs += 1;
      i += 1; // the partner is consumed
      continue;
    }

    // A lone image, or anything that is not an image, keeps its own full width.
    buffer.push(current);
  }
  flushBuffer();

  return { sections: out, pairs };
}

async function run() {
  const projectId = arg('--project');
  const slug = arg('--slug');
  const apply = process.argv.includes('--apply');

  if (!projectId) {
    console.error('Usage: node scripts/pair_images_into_two_columns.js --project=<projectId> [--slug=home] [--apply]');
    process.exitCode = 1;
    return;
  }

  console.log(`[pair] database: ${describeTarget()}`);

  let query = `select=*&project_id=eq.${encodeURIComponent(projectId)}&limit=1000`;
  if (slug) query += `&slug=eq.${encodeURIComponent(slug)}`;

  const pagesRes = await sbQuery({ table: tableConfig().builderPages, query });
  if (!pagesRes.ok) {
    console.error('[pair] Could not load pages:', pagesRes.error);
    process.exitCode = 1;
    return;
  }

  const pageRows = Array.isArray(pagesRes.data) ? pagesRes.data : [];
  const touched = [];

  for (const row of pageRows) {
    const doc = row.layout_sections;
    const sections = doc && Array.isArray(doc.sections) ? doc.sections : null;
    if (!sections) continue;

    const nextSections = [];
    let pairs = 0;
    let rowsAdded = 0;

    for (const section of sections) {
      const result = pairSection(section);
      if (!result) {
        nextSections.push(section);
        continue;
      }
      pairs += result.pairs;
      rowsAdded += result.sections.length - 1;
      nextSections.push(...result.sections);
    }

    if (pairs) touched.push({ row, next: { ...doc, sections: nextSections }, pairs, rowsAdded });
  }

  console.log(
    `[pair] mode=${apply ? 'APPLY' : 'DRY RUN'} pages=${pageRows.length} ` +
      `pages to change=${touched.length} pairs=${touched.reduce((a, t) => a + t.pairs, 0)}`
  );

  if (!touched.length) {
    console.log('[pair] Nothing to pair — every adjacent image is already in its own column.');
    return;
  }

  for (const t of touched.slice(0, 20)) {
    console.log(
      `[pair] /${String(t.row.slug || t.row.id).padEnd(34)} ${String(t.pairs).padStart(3)} pair(s), ` +
        `${t.rowsAdded} extra row(s)`
    );
  }
  if (touched.length > 20) console.log(`[pair] …and ${touched.length - 20} more page(s)`);

  if (!apply) {
    console.log('[pair] Nothing was changed. Add --apply to rearrange them.');
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(
    BACKUP_DIR,
    `pair_images_${projectId}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(
    backupFile,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        projectId,
        slug: slug || '(all pages)',
        pages: touched.map((t) => ({ id: t.row.id, slug: t.row.slug, layout_sections: t.row.layout_sections })),
      },
      null,
      2
    )
  );
  console.log(`[pair] backup written: ${path.relative(path.join(__dirname, '..'), backupFile)}`);

  let written = 0;
  for (const t of touched) {
    const res = await sbQuery({
      method: 'PATCH',
      table: tableConfig().builderPages,
      query: `id=eq.${encodeURIComponent(t.row.id)}`,
      body: { layout_sections: t.next, updated_at: new Date().toISOString() },
    });
    if (!res.ok) {
      console.error(`[pair] /${t.row.slug || t.row.id} FAILED: ${res.error}`);
      continue;
    }
    written += 1;
  }

  console.log(`[pair] done. ${written} of ${touched.length} page(s) rearranged.`);
  console.log(`[pair] rollback: restore layout_sections from ${path.basename(backupFile)}`);
}

run().catch((err) => {
  console.error('[pair] fatal:', err?.message || err);
  process.exitCode = 1;
});
