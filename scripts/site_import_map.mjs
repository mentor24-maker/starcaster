#!/usr/bin/env node
'use strict';
/**
 * Site Import mapper — turns a completed import job's IR into Builder
 * DRAFT pages. Spec: docs/site-import/02-mapping.md (ratified 2026-08-06).
 *
 * WHAT A RUN DOES
 *   Dry run (default): maps the IR in memory, prints + uploads the
 *   reconciliation report, writes NOTHING to Builder.
 *   --apply: takes a whole-site snapshot, backs up every page it will
 *   touch to docs/SQL/backups/, copies placeholder crops + referenced
 *   assets into the durable SiteImportApplied/<projectId>/ namespace,
 *   then creates/updates the draft pages. Never publishes anything.
 *   --nav: separate deliberate step — writes the imported header nav into
 *   the Header saved-section MASTER (backing it up first; refusing a
 *   non-empty master without --nav-replace) and attaches the master to
 *   every imported page. Site snapshots do NOT cover masters, hence the
 *   dedicated backup.
 *
 * SAFETY (all spec-mandated)
 * - Every page lands isPublished:false. The mapper cannot publish.
 * - Clobber guard: sections the mapper wrote are hash-recorded; on re-run
 *   a section whose content changed (a human redesigned it) is SKIPPED and
 *   reported as humanModified — never overwritten. --force-section <id>
 *   overrides for one section at a time.
 * - The report must reconcile (every IR element accounted) or --apply
 *   refuses to run.
 * - Rollback: restore the snapshot id printed at apply time
 *   (POST /api/builder/page-snapshots/:id/restore) and/or the JSON backup.
 *
 * USAGE
 *   doppler run --config prd -- node scripts/site_import_map.mjs --job <id>            # dry run
 *   doppler run --config prd -- node scripts/site_import_map.mjs --job <id> --apply
 *   doppler run --config prd -- node scripts/site_import_map.mjs --job <id> --nav [--nav-replace]
 *   ... --force-section <sectionId>   (repeatable)   ... --allow-local
 */

import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

// --- env resolution + guards (same pattern as site_import_worker.mjs) ----
const MAIN_CHECKOUT = '/Users/mentor/WebApps/starcaster';
const ENV_CANDIDATES = [
  process.env.STARCASTER_ENV_FILE,
  path.join(ROOT, '.env.local.cloud-backup'),
  path.join(MAIN_CHECKOUT, '.env.local.cloud-backup'),
  path.join(ROOT, '.env.local'),
  path.join(MAIN_CHECKOUT, '.env.local'),
].filter(Boolean);

if (!process.env.SUPABASE_URL) {
  for (const candidate of ENV_CANDIDATES) {
    try {
      const parsed = {};
      for (const line of readFileSync(candidate, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) parsed[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      if (parsed.SUPABASE_URL) {
        for (const [k, v] of Object.entries(parsed)) if (!process.env[k]) process.env[k] = v;
        break;
      }
    } catch { /* next */ }
  }
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) { console.error(`${name} requires a value.`); process.exit(1); }
  return v;
};
const flagValues = (name) => {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1] && !args[i + 1].startsWith('--')) out.push(args[i + 1]);
  }
  return out;
};

if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('No Supabase credentials found. Run through Doppler:');
  console.error('  doppler run --config prd -- node scripts/site_import_map.mjs --job <id>');
  process.exit(1);
}
if (/localhost|127\.0\.0\.1/.test(process.env.SUPABASE_URL) && !flag('--allow-local')) {
  console.error('Refusing a localhost database (--allow-local overrides for local testing).');
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is missing — crops/assets copy to Vercel Blob on apply.');
  process.exit(1);
}

const store = require('./lib/siteImportStore.js');
const pagesStore = require('./lib/builderPagesStore.js');
const snapshotsStore = require('./lib/builderPageSnapshotsStore.js');
const savedSectionsStore = require('./lib/builderSavedSectionsStore.js');
const assetsStore = require('./lib/assetsStore.js');
const { uploadBufferToBlobAtPath } = require('./lib/blobStorage.js');
const { mapSite, reportReconciles } = require('./lib/site-import/dist/map.js');

const APPLY = flag('--apply');
const NAV = flag('--nav');
const NAV_REPLACE = flag('--nav-replace');
const FORCED_SECTIONS = new Set(flagValues('--force-section'));
const JOB_ID = flagValue('--job');
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

const log = (...parts) => console.log(...parts);
function must(res, what) {
  if (!res || res.ok === false) throw new Error(`${what}: ${res?.error || `status ${res?.status}`}`);
  return res.data;
}
const sha256 = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

async function copyBlob(fromUrl, toPathname, mimeType) {
  const res = await fetch(fromUrl, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} copying ${fromUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const up = await uploadBufferToBlobAtPath({ pathname: toPathname, mimeType, fileBuffer: buffer });
  return must(up, `Blob copy to ${toPathname}`).location;
}

/** Deep string replace of job-namespace URLs with applied-namespace URLs. */
function rewriteUrls(value, urlMap) {
  let json = JSON.stringify(value);
  for (const [from, to] of urlMap) json = json.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
  return JSON.parse(json);
}

async function main() {
  if (!JOB_ID) {
    console.error('Usage: doppler run --config prd -- node scripts/site_import_map.mjs --job <id> [--apply] [--nav]');
    process.exit(1);
  }
  const job = must(await store.getJob(JOB_ID), 'load job');
  const scope = { projectId: job.projectId, userId: job.ownerUserId || '' };
  log(`Mode:    ${APPLY ? 'APPLY (writes drafts)' : 'DRY RUN (no writes)'}${NAV ? ' + NAV' : ''}`);
  log(`Job:     ${job.id} (${job.sourceUrl})`);
  log(`Project: ${job.projectId}`);
  const irUrl = job.checkpoints?.normalize?.blobPath;
  if (!irUrl) throw new Error('Job has no normalize checkpoint — run the import worker first.');
  const ir = await fetchJson(irUrl);

  const prior = job.checkpoints?.map || {};
  const priorPageIds = prior.pageIds || {};
  const priorHashes = prior.sectionHashes || {};

  // Existing pages: slugs the mapper must not claim + the re-run targets.
  const existingPages = must(await pagesStore.listPages(5000, scope), 'list pages');
  const importOwnedIds = new Set(Object.values(priorPageIds));
  const existingSlugs = existingPages.filter((p) => !importOwnedIds.has(String(p.id))).map((p) => p.slug).filter(Boolean);

  const out = mapSite(ir, { existingSlugs });

  // ---- Clobber guard (dry run computes it too, so reports are identical) --
  const protectedSections = [];
  for (const page of out.pages) {
    const existingId = priorPageIds[page.irPath];
    if (!existingId) continue;
    const current = existingPages.find((p) => String(p.id) === String(existingId));
    if (!current) continue;
    for (const section of page.sections) {
      const priorHash = priorHashes[section.id];
      if (!priorHash) continue;
      const live = (current.layoutSections || []).find((s) => s.id === section.id);
      if (!live) continue; // human deleted it — re-run recreates, by design
      if (sha256(live) !== priorHash && !FORCED_SECTIONS.has(section.id)) {
        protectedSections.push({ page, section, live });
        out.report.elements.humanModified += section.dispositions.mapped + section.dispositions.placeholder;
        out.report.elements.mapped -= section.dispositions.mapped;
        out.report.elements.placeholder -= section.dispositions.placeholder;
      }
    }
  }
  const protectedIds = new Set(protectedSections.map((p) => p.section.id));

  // ---- Report ------------------------------------------------------------
  log('\nReconciliation:', JSON.stringify(out.report.elements));
  if (out.report.skipped.length) log('Skipped:', JSON.stringify(out.report.skipped, null, 2));
  for (const p of out.report.pages) {
    log(`  ${p.path}  →  /${p.slug}   ${p.modules} modules (${p.placeholders} placeholders)`);
  }
  if (protectedIds.size) {
    log(`Hash guard: ${protectedIds.size} section(s) human-modified — will be left untouched:`);
    for (const { page, section } of protectedSections) log(`  ${page.slug} :: ${section.id} (${section.title})`);
  }
  log(`Assets: promote ${out.report.assets.promoted}, crops ${out.report.assets.cropsCopied}, left in namespace ${out.report.assets.leftInNamespace}`);

  if (!reportReconciles(out.report)) {
    throw new Error('Report does not reconcile — refusing to proceed. This is a mapper bug; file it.');
  }
  const reportUrl = must(await uploadBufferToBlobAtPath({
    pathname: `SiteImport/${job.id}/map-report.json`,
    mimeType: 'application/json',
    fileBuffer: Buffer.from(JSON.stringify(out.report, null, 2)),
  }), 'upload report').location;
  log(`Report: ${reportUrl}`);

  if (NAV) await runNav(job, scope, out);

  if (!APPLY) {
    log('\nDry run complete. Re-run with --apply to create the draft pages.');
    return;
  }

  // ---- APPLY -------------------------------------------------------------
  // 1. Whole-site snapshot (pages only — the nav step has its own master
  //    backup) + JSON backup of pages we will update.
  const snapshot = must(await snapshotsStore.createPageSnapshot(
    { label: `pre-site-import-map ${job.id}`, pages: existingPages }, scope
  ), 'create snapshot');
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `site_import_map_${job.id}_${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ jobId: job.id, snapshotId: snapshot.id, pages: existingPages }, null, 2));
  log(`Snapshot: ${snapshot.id}  Backup: ${path.relative(ROOT, backupPath)}`);

  // 2. Copy crops + promoted assets + overflow HTML into the durable
  //    project namespace; build the URL rewrite map.
  const applied = `SiteImportApplied/${job.projectId}`;
  const urlMap = new Map();
  for (const crop of out.copyPlan.crops) {
    if (urlMap.has(crop.fromUrl)) continue;
    urlMap.set(crop.fromUrl, await copyBlob(crop.fromUrl, `${applied}/crops/${crop.sourceId}.png`, 'image/png'));
  }
  for (const asset of out.copyPlan.assets) {
    if (!asset.fromUrl || urlMap.has(asset.fromUrl)) continue;
    const ext = (asset.fromUrl.match(/\.([a-z0-9]{2,5})(?:\?|$)/i) || [])[1] || 'bin';
    urlMap.set(asset.fromUrl, await copyBlob(asset.fromUrl, `${applied}/assets/${asset.assetId}.${ext}`, asset.mimeType || 'application/octet-stream'));
  }
  const overflowUrls = new Map();
  for (const overflow of out.copyPlan.sourceOverflows) {
    overflowUrls.set(overflow.moduleId, must(await uploadBufferToBlobAtPath({
      pathname: `${applied}/source/${overflow.sourceId}.html`,
      mimeType: 'text/html',
      fileBuffer: Buffer.from(overflow.html),
    }), 'upload overflow source').location);
  }
  log(`Copied ${urlMap.size} blob(s) + ${overflowUrls.size} overflow source(s) to ${applied}/`);

  // 3. Promote referenced assets into the project's library (URL = copied
  //    URL, same string that lands in the page JSON, so "Used In" matches).
  for (const asset of out.copyPlan.assets) {
    const location = urlMap.get(asset.fromUrl) || asset.fromUrl;
    must(await assetsStore.createAsset({
      assetName: asset.originalUrl.split('/').pop() || asset.assetId,
      assetType: (asset.mimeType || '').startsWith('image/') ? 'Image' : 'File',
      category: 'Site Import',
      location,
      caption: asset.altText,
      comments: `Imported from ${asset.originalUrl} (job ${JOB_ID})`,
    }, scope), `promote asset ${asset.assetId}`);
  }

  // 4. Write pages: rewrite URLs, attach overflow links, strip engine
  //    bookkeeping, respect the hash guard, create or update.
  const pageIds = { ...priorPageIds };
  const sectionHashes = { ...priorHashes };
  for (const page of out.pages) {
    const sections = page.sections.map(({ sourceElementIds, dispositions, ...section }) => {
      const clean = rewriteUrls(section, urlMap);
      for (const module of clean.modules) {
        const overflowUrl = overflowUrls.get(module.id);
        if (overflowUrl) module.settings.importSourceHtmlUrl = overflowUrl;
      }
      return clean;
    });

    const existingId = pageIds[page.irPath];
    const current = existingId ? existingPages.find((p) => String(p.id) === String(existingId)) : null;
    let saved;
    if (current) {
      const mappedById = new Map(sections.map((s) => [s.id, s]));
      const merged = (current.layoutSections || []).map((s) =>
        mappedById.has(s.id) && !protectedIds.has(s.id) ? mappedById.get(s.id) : s
      );
      const presentIds = new Set(merged.map((s) => s.id));
      for (const s of sections) if (!presentIds.has(s.id)) merged.push(s);
      saved = must(await pagesStore.updatePage(current.id, { ...current, layoutSections: merged }, scope), `update ${page.slug}`);
    } else {
      saved = must(await pagesStore.createPage({
        name: page.name,
        slug: page.slug,
        templateId: '',
        templateKind: 'modular',
        isPublished: false,
        layoutSections: sections,
      }, scope), `create ${page.slug}`);
    }
    pageIds[page.irPath] = String(saved.id);

    // Hash exactly what was stored (post-normalization read-back).
    const stored = must(await pagesStore.getPage(saved.id, scope), `read back ${page.slug}`);
    for (const section of sections) {
      const storedSection = (stored.layoutSections || []).find((s) => s.id === section.id);
      if (storedSection && !protectedIds.has(section.id)) sectionHashes[section.id] = sha256(storedSection);
    }
    const reportPage = out.report.pages.find((p) => p.path === page.irPath);
    if (reportPage) reportPage.builderPageId = String(saved.id);
    log(`  wrote /${page.slug} (page ${saved.id}, draft)`);
  }

  // 5. Checkpoint + final report (now carrying page ids).
  const checkpoints = {
    ...(job.checkpoints || {}),
    map: {
      at: new Date().toISOString(),
      snapshotId: snapshot.id,
      reportUrl,
      pageIds,
      sectionHashes,
      appliedNamespace: applied,
    },
  };
  must(await store.updateJob(job.id, { checkpoints }), 'record map checkpoint');
  must(await uploadBufferToBlobAtPath({
    pathname: `SiteImport/${job.id}/map-report.json`,
    mimeType: 'application/json',
    fileBuffer: Buffer.from(JSON.stringify(out.report, null, 2)),
  }), 'update report');
  log(`\nAPPLY complete: ${out.pages.length} draft page(s). Nothing was published.`);
  log(`Rollback: restore snapshot ${snapshot.id} (Builder > page snapshots) or ${path.relative(ROOT, backupPath)}`);
}

/** --nav: write the imported header tree into the Header saved-section
 *  MASTER, with its own backup (site snapshots do not cover masters). */
async function runNav(job, scope, out) {
  if (!out.navItems.length) {
    log('--nav: the IR carries no header nav items — nothing to write.');
    return;
  }
  const savedSections = must(await savedSectionsStore.listSavedSections(1000, scope), 'list saved sections');
  let master = savedSections.find((s) =>
    (s.section?.modules || []).some((m) => m.type === 'navigation')
  ) || savedSections.find((s) => /header/i.test(s.name || ''));

  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (master) {
    const backupPath = path.join(BACKUP_DIR, `site_import_nav_master_${job.id}_${stamp}.json`);
    writeFileSync(backupPath, JSON.stringify({ jobId: job.id, master }, null, 2));
    log(`--nav: master backup → ${path.relative(ROOT, backupPath)}`);
    const navModule = (master.section?.modules || []).find((m) => m.type === 'navigation');
    let existingItems = [];
    try { existingItems = JSON.parse(navModule?.settings?.navItems || '[]'); } catch { existingItems = []; }
    if (existingItems.length && !NAV_REPLACE) {
      throw new Error(
        `--nav: the Header master already carries ${existingItems.length} nav item(s). ` +
        'Replacing a live nav propagates to every linked page. Re-run with --nav-replace if that is intended.'
      );
    }
  }

  if (!APPLY) {
    log(`--nav dry run: would write ${out.navItems.length} nav item(s) to the ${master ? `existing master "${master.name}"` : 'NEW Header master'}.`);
    return;
  }

  const navItemsJson = JSON.stringify(out.navItems);
  let masterSection;
  if (master) {
    masterSection = {
      ...master.section,
      modules: (master.section.modules || []).some((m) => m.type === 'navigation')
        ? master.section.modules.map((m) =>
            m.type === 'navigation' ? { ...m, settings: { ...m.settings, navItems: navItemsJson } } : m
          )
        : [...(master.section.modules || []), {
            id: `impnavmod_${job.id}`, type: 'navigation', column: 'main',
            name: 'Imported navigation', text: '', settings: { navItems: navItemsJson },
          }],
    };
    must(await savedSectionsStore.updateSavedSection(master.id, { name: master.name, section: masterSection }, scope), 'update master');
  } else {
    masterSection = {
      id: `impnavsec_${job.id}`, title: 'Header', layout: 'single', widthMode: 'contained',
      background: { mode: 'none', color: '', color2: '', imageUrl: '', styleKey: '' },
      modules: [{
        id: `impnavmod_${job.id}`, type: 'navigation', column: 'main',
        name: 'Imported navigation', text: '', settings: { navItems: navItemsJson },
      }],
    };
    master = must(await savedSectionsStore.createSavedSection({ name: 'Header', section: masterSection }, scope), 'create master');
    masterSection = master.section || masterSection;
  }
  log(`--nav: master "${master.name}" (${master.id}) updated with ${out.navItems.length} item(s).`);

  // Attach the master instance to every imported page missing it, then
  // propagate so instances match the master exactly.
  const pageIds = Object.values(job.checkpoints?.map?.pageIds || {});
  for (const pageId of pageIds) {
    const page = must(await pagesStore.getPage(pageId, scope), `read page ${pageId}`);
    if ((page.layoutSections || []).some((s) => s.savedSectionId === master.id)) continue;
    const instance = { ...masterSection, id: `impnavinst_${pageId}`, savedSectionId: master.id, canonical: true };
    must(await pagesStore.updatePage(pageId, { ...page, layoutSections: [instance, ...(page.layoutSections || [])] }, scope), `attach nav to ${pageId}`);
  }
  const prop = await pagesStore.propagateCanonicalSection(master.id, masterSection, scope);
  log(`--nav: attached to ${pageIds.length} page(s); propagation updated ${prop.updated}/${prop.total}.`);
}

main().catch((err) => {
  console.error('\nMAPPER FAILED:', err.message || err);
  process.exit(1);
});
