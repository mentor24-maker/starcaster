#!/usr/bin/env node
'use strict';

/**
 * Take named pages off a project's public site, without deleting them.
 *
 * WHY THIS EXISTS
 * A site import brings in whatever the old site published, including pages
 * nobody meant to keep: the Dane of Earth import (task 86bcgdac6) published a
 * WordPress `/test` page, the raw RSS document at `/feed`, and a dated
 * duplicate of a post titled "404 Not Found". Unpublishing is the same move the
 * Builder makes — `is_published = false` — so each page stays in the Builder
 * and can be put back with one click. Its published copy is left where it is
 * on purpose: lib/builderPagesStore.js explains why the copy is only removed on
 * delete, and an unpublished page's copy cannot be served.
 *
 * SAFETY
 *  - Dry run by default; --apply writes.
 *  - Scoped to one project; a slug matching nothing is reported, never guessed.
 *  - A JSON backup of every row it changes is written first.
 *  - Every page is read back, and the run exits 2 unless all of them now read
 *    as unpublished.
 *
 * Usage:
 *   node scripts/unpublish_project_pages.js --project=proj_… --slugs=test,feed
 *   node scripts/unpublish_project_pages.js --project=proj_… --slugs=test,feed --apply
 */

const fs = require('fs');
const path = require('path');

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}

const { sbQuery, tableConfig } = require('../lib/supabase');

const BACKUP_DIR = path.join(__dirname, '..', 'docs', 'SQL', 'backups');

function arg(name, fallback = '') {
  const found = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function describeTarget() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  if (!url) return 'no SUPABASE_URL set';
  return `${url} ${/localhost|127\.0\.0\.1/.test(url) ? '(LOCAL database)' : '(CLOUD — the live site)'}`;
}

/** `/Feed/` and `feed` name the same page. */
function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
}

/**
 * Match the requested slugs against the project's pages.
 * A slug held by more than one page is reported as ambiguous rather than
 * unpublishing all of them, because one of them may be the page that is meant
 * to stay.
 */
function planUnpublish(pageRows, slugs) {
  const wanted = [...new Set(slugs.map(normalizeSlug).filter(Boolean))];
  const plan = { change: [], already: [], missing: [], ambiguous: [] };
  for (const slug of wanted) {
    const matches = pageRows.filter((row) => normalizeSlug(row.slug) === slug);
    if (!matches.length) plan.missing.push(slug);
    else if (matches.length > 1) plan.ambiguous.push({ slug, ids: matches.map((r) => r.id) });
    else if (matches[0].is_published === false) plan.already.push(matches[0]);
    else plan.change.push(matches[0]);
  }
  return plan;
}

async function run() {
  const projectId = arg('--project');
  const slugs = arg('--slugs').split(',');
  const apply = process.argv.includes('--apply');

  if (!projectId || !slugs.filter(Boolean).length) {
    console.error('Usage: node scripts/unpublish_project_pages.js --project=<projectId> --slugs=a,b,c [--apply]');
    process.exitCode = 1;
    return;
  }

  console.log(`[unpublish] database: ${describeTarget()}`);
  console.log(`[unpublish] project ${projectId}, mode=${apply ? 'APPLY' : 'DRY RUN'}`);

  const pagesRes = await sbQuery({
    table: tableConfig().builderPages,
    query: `select=id,slug,name,is_published,is_private&project_id=eq.${encodeURIComponent(projectId)}&limit=1000`,
  });
  if (!pagesRes.ok) {
    console.error('[unpublish] Could not load pages:', pagesRes.error);
    process.exitCode = 1;
    return;
  }
  const pageRows = Array.isArray(pagesRes.data) ? pagesRes.data : [];
  const plan = planUnpublish(pageRows, slugs);

  for (const row of plan.change) console.log(`[unpublish] ${apply ? 'will unpublish' : 'would unpublish'} /${row.slug}  (id ${row.id}, "${row.name || ''}")`);
  for (const row of plan.already) console.log(`[unpublish] already unpublished /${row.slug}  (id ${row.id})`);
  for (const slug of plan.missing) console.log(`[unpublish] NOT FOUND /${slug} — no page in this project has that address`);
  for (const a of plan.ambiguous) console.log(`[unpublish] AMBIGUOUS /${a.slug} — pages ${a.ids.join(', ')} share it; nothing changed for it`);

  const problems = plan.missing.length + plan.ambiguous.length;
  if (!apply) {
    console.log(`[unpublish] Nothing was changed. ${plan.change.length} page(s) would be unpublished. Add --apply to do it.`);
    if (problems) process.exitCode = 2;
    return;
  }
  if (!plan.change.length) {
    console.log('[unpublish] Nothing to change.');
    if (problems) process.exitCode = 2;
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(BACKUP_DIR, `unpublish_project_pages_${projectId}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ savedAt: new Date().toISOString(), projectId, pages: plan.change }, null, 2));
  console.log(`[unpublish] backup written: ${path.relative(path.join(__dirname, '..'), backupFile)}`);

  for (const row of plan.change) {
    const res = await sbQuery({
      method: 'PATCH',
      table: tableConfig().builderPages,
      query: `id=eq.${encodeURIComponent(row.id)}&project_id=eq.${encodeURIComponent(projectId)}`,
      body: { is_published: false },
    });
    if (!res.ok) console.error(`[unpublish] /${row.slug} FAILED: ${res.error}`);
  }

  // Read back: a 2xx proves a write was accepted, not that the page is off the site.
  const ids = plan.change.map((r) => r.id).join(',');
  const after = await sbQuery({
    table: tableConfig().builderPages,
    query: `select=id,slug,is_published&project_id=eq.${encodeURIComponent(projectId)}&id=in.(${ids})`,
  });
  if (!after.ok) {
    console.error('[unpublish] READ-BACK FAILED — could not tell whether the pages are unpublished:', after.error);
    process.exitCode = 2;
    return;
  }
  const stillLive = (after.data || []).filter((r) => r.is_published !== false);
  for (const r of after.data || []) console.log(`[unpublish] read back /${r.slug}: is_published=${r.is_published}`);
  console.log(`[unpublish] done. ${plan.change.length - stillLive.length} of ${plan.change.length} unpublished.`);
  console.log(`[unpublish] undo: set is_published back to true for the ids in ${path.basename(backupFile)}`);
  if (stillLive.length || problems || (after.data || []).length !== plan.change.length) process.exitCode = 2;
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[unpublish] fatal:', err?.message || err);
    process.exitCode = 1;
  });
}

module.exports = { planUnpublish, normalizeSlug };
