#!/usr/bin/env node
'use strict';

/**
 * Take the site importer's "rebuild with a real module" caption off live pages.
 *
 * WHY THIS EXISTS
 * The importer turns what it cannot rebuild (a form, a video, a table, an
 * embed) into a `code` module showing a screenshot. Until task 86bcgdm83 it
 * wrote a caption for whoever rebuilds the page — "Imported form — rebuild
 * with a real module." — straight into the module's text, which made it page
 * content: visitors read it on 22 live pages of Dane of Earth and 2 of another
 * site. The importer now puts the caption in `settings.importPlaceholder`,
 * which the renderer shows inside the Builder only. This moves the pages that
 * were imported before that change onto the same shape.
 *
 * WHAT IT DOES, per placeholder module (a `code` module with `importClass`):
 *   - removes the caption paragraph from `text`, leaving the screenshot,
 *   - keeps the caption as `settings.importPlaceholder`, so the Builder still
 *     shows it,
 * in the draft AND in the page's published copy (builder_published_pages) —
 * the copy is what a visitor is served, so a run that only fixed drafts would
 * report success while the live site kept showing the caption.
 *
 * SAFETY
 *  - Dry run by default; --apply writes.
 *  - A full JSON backup of every touched row is written before any write.
 *  - Re-runnable: once no caption is left in `text`, it changes nothing.
 *  - A published copy that was in step with its draft is stamped in step
 *    afterwards (with the draft's STORED timestamp — a trigger overrides the
 *    one written), so a page does not start reading as "has unpublished
 *    changes". One already behind its draft keeps its stamp.
 *  - Everything is read back, and the run exits 2 if any caption survives.
 *
 * Usage:
 *   node scripts/strip_import_placeholder_captions.js --project=proj_a,proj_b
 *   node scripts/strip_import_placeholder_captions.js --project=proj_a,proj_b --apply
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

const BACKUP_DIR = path.join(__dirname, '..', 'docs', 'SQL', 'backups');

/** The two caption shapes the importer wrote: `<p><em>…rebuild…</em></p>`. */
const CAPTION_RE = /<p><em>([^<]*?\brebuild\b[^<]*?)<\/em><\/p>/gi;

function arg(name, fallback = '') {
  const found = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function describeTarget() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  if (!url) return 'no SUPABASE_URL set';
  return `${url} ${/localhost|127\.0\.0\.1/.test(url) ? '(LOCAL database)' : '(CLOUD — the live site)'}`;
}

function unescapeHtml(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function isPlaceholder(node) {
  return Boolean(
    node &&
      typeof node === 'object' &&
      node.type === 'code' &&
      node.settings &&
      typeof node.settings === 'object' &&
      node.settings.importClass &&
      typeof node.text === 'string'
  );
}

/**
 * Move every placeholder's caption out of its text, anywhere in a page
 * document (draft `layout_sections` or a published payload). Pure: returns a
 * new value and how many modules changed.
 */
function stripCaptions(node, stats = { modules: 0 }, depth = 0) {
  if (node == null || depth > 16) return node;
  if (Array.isArray(node)) return node.map((v) => stripCaptions(v, stats, depth + 1));
  if (typeof node !== 'object') return node;

  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = stripCaptions(v, stats, depth + 1);

  if (isPlaceholder(out)) {
    const captions = [];
    const text = out.text.replace(CAPTION_RE, (_, caption) => {
      captions.push(unescapeHtml(caption).trim());
      return '';
    });
    if (captions.length) {
      out.text = text;
      out.settings = { ...out.settings };
      if (!out.settings.importPlaceholder) out.settings.importPlaceholder = captions[0];
      stats.modules += 1;
    }
  }
  return out;
}

/** How many captions remain in a module's text across these documents. */
function countCaptions(values) {
  let count = 0;
  const walk = (node, depth = 0) => {
    if (node == null || depth > 16 || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((v) => walk(v, depth + 1));
    if (isPlaceholder(node)) count += (node.text.match(CAPTION_RE) || []).length;
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  for (const v of values) walk(v);
  return count;
}

/** A published copy's payload is stored as a JSON string; older rows hold an object. */
function parsePayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return { value: payload, wasString: false };
  if (typeof payload === 'string') {
    try {
      const value = JSON.parse(payload);
      if (value && typeof value === 'object' && !Array.isArray(value)) return { value, wasString: true };
    } catch (_) {}
  }
  return null;
}

/**
 * Rewrite one published copy and decide its new source stamp — the same rule
 * scripts/import_external_page_images.js uses: a copy in step with its draft
 * before the run is stamped `now` (the draft's stored stamp) after it; one
 * already behind keeps its old stamp. Pass `now` as null when the draft is not
 * being rewritten. Returns null when the copy has no caption to remove.
 */
function rewritePublishedCopy(buildRow, draftUpdatedAt, now) {
  const parsed = parsePayload(buildRow && buildRow.payload);
  if (!parsed) return null;
  const stats = { modules: 0 };
  const next = stripCaptions(parsed.value, stats);
  if (!stats.modules) return null;

  const builtAt = Date.parse(String(buildRow.source_updated_at || '')) || 0;
  const draftAt = Date.parse(String(draftUpdatedAt || '')) || 0;
  const inStep = Boolean(now) && builtAt > 0 && builtAt >= draftAt;
  if (inStep && next && typeof next === 'object' && 'updatedAt' in next) next.updatedAt = now;

  return {
    modules: stats.modules,
    payload: parsed.wasString ? JSON.stringify(next) : next,
    sourceUpdatedAt: inStep ? now : buildRow.source_updated_at || null,
    inStep,
  };
}

async function runProject(projectId, apply, backupPages) {
  const { sbQuery, tableConfig } = require('../lib/supabase');
  const pid = encodeURIComponent(projectId);

  const pagesRes = await sbQuery({
    table: tableConfig().builderPages,
    query: `select=id,slug,layout_sections,updated_at&project_id=eq.${pid}&limit=1000`,
  });
  if (!pagesRes.ok) throw new Error(`could not load pages for ${projectId}: ${pagesRes.error}`);
  const pageRows = Array.isArray(pagesRes.data) ? pagesRes.data : [];

  const buildsRes = await sbQuery({
    table: tableConfig().builderPublishedPages,
    query: `select=page_id,slug,payload,source_updated_at&project_id=eq.${pid}&limit=1000`,
  });
  if (!buildsRes.ok) throw new Error(`could not load published copies for ${projectId}: ${buildsRes.error}`);
  const buildByPage = new Map((buildsRes.data || []).map((b) => [String(b.page_id), b]));

  const touched = [];
  for (const row of pageRows) {
    const stats = { modules: 0 };
    const next = stripCaptions(row.layout_sections, stats);
    const build = buildByPage.get(String(row.id));
    const copy = build ? rewritePublishedCopy(build, row.updated_at, stats.modules ? 'pending' : null) : null;
    if (stats.modules || copy) touched.push({ row, next, modules: stats.modules, build, copy });
  }
  // A published copy whose draft was deleted cannot be reached by a visitor
  // (lib/publishedPageRead.js keys the read on the draft's id), but it still
  // carries the caption, and the read-back counts every copy in the project.
  // Cleaned with its stamp kept — there is no draft for it to be in step with.
  const draftIds = new Set(pageRows.map((r) => String(r.id)));
  for (const build of buildByPage.values()) {
    if (draftIds.has(String(build.page_id))) continue;
    const copy = rewritePublishedCopy(build, '', null);
    if (copy) touched.push({ row: { id: build.page_id, slug: `${build.slug} (draft deleted)` }, modules: 0, build, copy });
  }

  console.log(`[captions] ${projectId}: ${pageRows.length} page(s), ${touched.length} carry the caption`);
  for (const t of touched) {
    console.log(
      `[captions]   /${t.row.slug || t.row.id}  draft: ${t.modules} module(s)` +
        `  published copy: ${t.copy ? `${t.copy.modules} module(s)` : t.build ? 'clean' : 'none'}`
    );
  }
  if (!apply || !touched.length) return { touched: touched.length, written: 0, copies: 0, remaining: null };

  for (const t of touched) {
    backupPages.push({
      projectId,
      id: t.row.id,
      slug: t.row.slug,
      updated_at: t.row.updated_at,
      layout_sections: t.row.layout_sections,
      published_copy: t.build ? { payload: t.build.payload, source_updated_at: t.build.source_updated_at } : null,
    });
  }
  return { touched, pageRows, buildByPage };
}

async function writeProject(projectId, plan) {
  const { sbQuery, tableConfig } = require('../lib/supabase');
  const pid = encodeURIComponent(projectId);
  const now = new Date().toISOString();
  let written = 0;
  let copies = 0;

  for (const t of plan.touched) {
    let copy = t.copy;
    if (t.modules) {
      const res = await sbQuery({
        method: 'PATCH',
        table: tableConfig().builderPages,
        query: `id=eq.${encodeURIComponent(t.row.id)}&select=updated_at`,
        headers: { Prefer: 'return=representation' },
        body: { layout_sections: t.next, updated_at: now },
      });
      if (!res.ok) {
        console.error(`[captions] page /${t.row.slug || t.row.id} FAILED: ${res.error}`);
        continue;
      }
      // A trigger replaces updated_at with the database's own clock; the copy
      // must carry the STORED stamp or the page reads as having unpublished
      // changes.
      const stored = Array.isArray(res.data) && res.data[0] && res.data[0].updated_at;
      if (t.build) copy = rewritePublishedCopy(t.build, t.row.updated_at, stored || now);
    } else if (t.build) {
      copy = rewritePublishedCopy(t.build, t.row.updated_at, null);
    }
    if (copy) {
      const res = await sbQuery({
        method: 'PATCH',
        table: tableConfig().builderPublishedPages,
        query: `project_id=eq.${pid}&page_id=eq.${encodeURIComponent(t.row.id)}`,
        body: { payload: copy.payload, source_updated_at: copy.sourceUpdatedAt },
      });
      if (!res.ok) {
        console.error(`[captions] published copy of /${t.row.slug || t.row.id} FAILED: ${res.error}`);
        continue;
      }
      copies += 1;
    }
    written += 1;
  }

  // Read back: a 2xx proves a write happened, not that the caption is gone.
  const pagesAfter = await sbQuery({
    table: tableConfig().builderPages,
    query: `select=layout_sections&project_id=eq.${pid}&limit=1000`,
  });
  const buildsAfter = await sbQuery({
    table: tableConfig().builderPublishedPages,
    query: `select=payload&project_id=eq.${pid}&limit=1000`,
  });
  let remaining = null;
  if (pagesAfter.ok && buildsAfter.ok) {
    remaining = countCaptions([
      ...(pagesAfter.data || []).map((r) => r.layout_sections),
      ...(buildsAfter.data || []).map((b) => (parsePayload(b.payload) || {}).value),
    ]);
  }
  return { written, copies, remaining };
}

async function run() {
  const projects = arg('--project').split(',').map((s) => s.trim()).filter(Boolean);
  const apply = process.argv.includes('--apply');
  if (!projects.length) {
    console.error('Usage: node scripts/strip_import_placeholder_captions.js --project=<id>[,<id>…] [--apply]');
    process.exitCode = 1;
    return;
  }

  console.log(`[captions] database: ${describeTarget()}`);
  console.log(`[captions] mode=${apply ? 'APPLY' : 'DRY RUN'}`);

  const backupPages = [];
  const plans = [];
  for (const projectId of projects) {
    const plan = await runProject(projectId, apply, backupPages);
    if (apply && Array.isArray(plan.touched) && plan.touched.length) plans.push({ projectId, plan });
  }

  if (!apply) {
    console.log('[captions] Nothing was changed. Add --apply to remove them.');
    return;
  }
  if (!plans.length) {
    console.log('[captions] No page carries the caption; nothing to do.');
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(
    BACKUP_DIR,
    `strip_import_placeholder_captions_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(backupFile, JSON.stringify({ savedAt: new Date().toISOString(), pages: backupPages }, null, 2));
  console.log(`[captions] backup written: ${path.relative(path.join(__dirname, '..'), backupFile)}`);

  let failed = false;
  for (const { projectId, plan } of plans) {
    const res = await writeProject(projectId, plan);
    console.log(
      `[captions] ${projectId}: ${res.written} of ${plan.touched.length} page(s) rewritten (${res.copies} published copies)`
    );
    if (res.remaining === null) {
      console.log(`[captions] ${projectId}: READ-BACK FAILED — whether any caption remains is unknown.`);
      failed = true;
    } else {
      console.log(`[captions] ${projectId}: read back — ${res.remaining} caption(s) remain in drafts and published copies.`);
      if (res.remaining !== 0 || res.written !== plan.touched.length) failed = true;
    }
  }
  console.log(`[captions] rollback: restore layout_sections / payload from ${path.basename(backupFile)}`);
  if (failed) process.exitCode = 2;
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[captions] fatal:', err?.message || err);
    process.exitCode = 1;
  });
}

module.exports = { stripCaptions, countCaptions, rewritePublishedCopy, parsePayload };
