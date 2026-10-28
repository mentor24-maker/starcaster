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
 *   MENUS (task 86bchydp6, Dane 2026-10-13): --apply also builds two saved
 *   sections, LAST, after every page write — "Top Menu" (the site's logo
 *   left, its menu with dropdowns right) and "Footer Menu" (its footer
 *   links, only when it has any) — and attaches them as canonical
 *   instances: Top Menu first on every imported page, Footer Menu last.
 *   A saved section the project already has is never written to: a name in
 *   use gets "Top Menu (strandsmovie.com)" instead. A re-run updates the
 *   sections this job created (their ids live in the map checkpoint), after
 *   backing each one up. Only pages this import created are touched.
 *   --no-menus skips both.
 *   --nav: the OLDER, deliberate step, kept for projects that already have a
 *   header master of their own — writes the imported header nav into that
 *   master (backing it up first; refusing a non-empty master without
 *   --nav-replace) and attaches it to every imported page. --nav turns the
 *   new menus off for the run, so no page ever gets two menus. Site
 *   snapshots do NOT cover masters, hence the dedicated backups.
 *
 * SAFETY (all spec-mandated)
 * - Every page lands isPublished:false. The mapper cannot publish.
 * - Clobber guard: sections the mapper wrote are hash-recorded; on re-run
 *   a section whose content changed (a human redesigned it) is SKIPPED and
 *   reported as humanModified — never overwritten. --force-section <id>
 *   overrides for one section at a time.
 * - The report must reconcile (every IR element accounted) or --apply
 *   refuses to run.
 * - IMPORT THEME (task 86bce9wx0, Dane 2026-10-06): --apply also creates a
 *   NEW theme named after the site ("daneofearth 1", then "… 2" on a
 *   re-import — never overwriting one he adjusted) from the captured styles
 *   (lib/site-import/theme.ts) and makes it the project's DEFAULT. The
 *   previous default's id is printed and recorded on the job; making that
 *   theme the default again undoes it. --no-theme skips it.
 * - THEME ONLY (task 86bctakkk, 2026-10-27): --theme-only makes that same
 *   theme from a completed job and does NOTHING else — no page, snapshot,
 *   asset, menu or Blob write. Dry run unless --apply. For a project whose
 *   pages were built without a theme (Alphire), which used to mean
 *   re-running the whole import. The Site Import screen's "Create theme
 *   from this import" does the same (lib/siteImportTheme.js, shared).
 * - Rollback: restore the snapshot id printed at apply time
 *   (POST /api/builder/page-snapshots/:id/restore) and/or the JSON backup.
 *
 * USAGE
 *   doppler run --config prd -- node scripts/site_import_map.mjs --job <id>            # dry run
 *   doppler run --config prd -- node scripts/site_import_map.mjs --job <id> --apply
 *   doppler run --config prd -- node scripts/site_import_map.mjs --job <id> --nav [--nav-replace]
 *   ... --force-section <sectionId>   (repeatable)   ... --allow-local
 *   ... --no-theme   skip the import theme (see below)
 *   ... --theme-only [--apply]   ONLY the import theme; touches no page
 *   ... --no-menus   skip the Top Menu / Footer Menu (see MENUS above)
 *   ... --nav-master <savedSectionId> pin which header master --nav writes
 *       to (default: the one the most pages reference)
 */

import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mainCheckoutDir } from './lib/main_checkout.mjs';
import { copyPromotedAssets, SourceUnreachableError } from './lib/site_import_copy.mjs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

// --- env resolution + guards (same pattern as site_import_worker.mjs) ----
const MAIN_CHECKOUT = mainCheckoutDir(ROOT);
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
if (!process.env.BLOB_READ_WRITE_TOKEN && !flag('--theme-only')) {
  console.error('BLOB_READ_WRITE_TOKEN is missing — crops/assets copy to Vercel Blob on apply.');
  process.exit(1);
}

// Compiled code older than its source once crashed an import with no word as
// to why (86bctakmc). Rebuild it — or stop, naming the command — first.
try {
  require('./scripts/lib/build_inputs.cjs').ensureBuildCurrent(ROOT, ['site-import', 'builder-template']);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const store = require('./lib/siteImportStore.js');
const pagesStore = require('./lib/builderPagesStore.js');
const snapshotsStore = require('./lib/builderPageSnapshotsStore.js');
const savedSectionsStore = require('./lib/builderSavedSectionsStore.js');
const assetsStore = require('./lib/assetsStore.js');
const { uploadBufferToBlobAtPath } = require('./lib/blobStorage.js');
const {
  mapSite, reportReconciles, mergeMappedSections,
  writeMappedPages, summarizePageWrites,
  buildMenuSection, planMenuTarget, attachMenuInstances, menuSiteLabel,
} = require('./lib/site-import/dist/map.js');
const { planImportTheme, saveImportTheme, undoLine } = require('./lib/siteImportTheme.js');

const APPLY = flag('--apply');
const NAV = flag('--nav');
const NAV_REPLACE = flag('--nav-replace');
const NO_THEME = flag('--no-theme');
const THEME_ONLY = flag('--theme-only');
// --nav writes the project's own header master instead; doing both would
// put two menus on every imported page.
const NO_MENUS = flag('--no-menus') || NAV;
const NAV_MASTER_ID = flagValue('--nav-master');
const FORCED_SECTIONS = new Set(flagValues('--force-section'));
const NO_CARDS_PATHS = flagValues('--no-cards');
const NO_CARDS_ALL = flag('--no-cards') && NO_CARDS_PATHS.length === 0;
const NO_SLIDESHOW_PATHS = flagValues('--no-slideshow');
const NO_SLIDESHOW_ALL = flag('--no-slideshow') && NO_SLIDESHOW_PATHS.length === 0;
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
  let buffer;
  try {
    const res = await fetch(fromUrl, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    throw new SourceUnreachableError(`${err.message || err} copying ${fromUrl}`);
  }
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
    console.error('Usage: doppler run --config prd -- node scripts/site_import_map.mjs --job <id> [--apply] [--no-menus] [--nav]');
    process.exit(1);
  }
  let job = must(await store.getJob(JOB_ID), 'load job');
  const scope = { projectId: job.projectId, userId: job.ownerUserId || '' };
  if (!THEME_ONLY) log(`Mode:    ${APPLY ? 'APPLY (writes drafts)' : 'DRY RUN (no writes)'}${NAV ? ' + NAV' : ''}${NO_MENUS ? ' (no menus)' : ''}`);
  log(`Job:     ${job.id} (${job.sourceUrl})`);
  log(`Project: ${job.projectId}`);
  if (THEME_ONLY) return runThemeOnly(job, scope);
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

  const out = mapSite(ir, {
    existingSlugs,
    skipAllSlideshows: NO_SLIDESHOW_ALL,
    skipSlideshowPaths: NO_SLIDESHOW_PATHS,
    skipAllCardGrids: NO_CARDS_ALL,
    skipCardGridPaths: NO_CARDS_PATHS,
    menus: !NO_MENUS,
  });

  // ---- Clobber guard (dry run computes it too, so reports are identical) --
  const protectedSections = [];
  for (const page of out.pages) {
    const existingId = priorPageIds[page.key];
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
  if (out.report.repeatCaptures.length) {
    // Capture reached one page by more than one URL. Mapped once — the
    // alternative was every copy piled onto one page (task 86bch6ger).
    log(`${out.report.repeatCaptures.length} duplicate capture(s) skipped (same path, same content as one already mapped):`);
    for (const r of out.report.repeatCaptures) log(`  ${r.path}  (${r.url}, ${r.elements} elements)`);
  }
  log(`Pages: ${out.pages.length} — each becomes its own Builder page.`);
  if (protectedIds.size) {
    log(`Hash guard: ${protectedIds.size} section(s) human-modified — will be left untouched:`);
    for (const { page, section } of protectedSections) log(`  ${page.slug} :: ${section.id} (${section.title})`);
  }
  if (NO_SLIDESHOW_ALL) {
    log('Slideshows: vetoed for this run (--no-slideshow) — image runs stay as images.');
  } else if (NO_SLIDESHOW_PATHS.length) {
    log(`Slideshows: vetoed on ${NO_SLIDESHOW_PATHS.join(', ')}`);
  }
  if (out.slideshows.length) {
    log('\nWill consolidate image runs into slideshows (an intent guess — veto below):');
    for (const plan of out.slideshows) {
      log(`  ${plan.pagePath || '/'}  →  ${plan.slideCount} slides, absorbs ${plan.absorbedIds.length} image element(s)`);
      log(`     keep them as images with: --no-slideshow ${plan.pagePath || '/'}`);
    }
    log('  (already applied? scripts/site_import_revert_slideshow.mjs restores the images)\n');
  }
  if (NO_CARDS_ALL) {
    log('Card grids: vetoed for this run (--no-cards) — repeated blocks stay as separate modules.');
  } else if (NO_CARDS_PATHS.length) {
    log(`Card grids: vetoed on ${NO_CARDS_PATHS.join(', ')}`);
  }
  if (out.cardGrids?.length) {
    // Same reasoning as slideshows: this is an inference about INTENT, so
    // the guess and the evidence for it are printed before anything is
    // written, with the veto right next to them.
    log('\nWill consolidate repeated blocks into Feature Cards (an intent guess — veto below):');
    for (const plan of out.cardGrids) {
      log(`  ${plan.pagePath || '/'}  →  ${plan.cardCount} cards, absorbs ${plan.absorbedIds.length} element(s)`);
      log(`     matched shape: ${plan.signature}`);
      log(`     titles: ${plan.titles.join(' | ')}`);
      log(`     keep them separate with: --no-cards ${plan.pagePath || '/'}`);
    }
    log('');
  }
  if (out.report.placeholderPatterns?.length) {
    // Placeholders are the importer admitting it has no rule for
    // something. Grouped and ranked, a big group with a simple shape is a
    // mapping rule waiting to be written — that is how image-only tables
    // were found (13 of delraytennis.com's 16 "tables").
    log('\nPlaceholders by shape (each is content with no mapping rule yet):');
    for (const pattern of out.report.placeholderPatterns.slice(0, 8)) {
      log(`  ${String(pattern.count).padStart(3)}x  ${pattern.signature}`);
    }
    log('');
  }
  log(`Assets: promote ${out.report.assets.promoted}, crops ${out.report.assets.cropsCopied}, left in namespace ${out.report.assets.leftInNamespace}`);
  logMenuPlan(job, out, prior);

  if (!reportReconciles(out.report)) {
    throw new Error('Report does not reconcile — refusing to proceed. This is a mapper bug; file it.');
  }
  const reportUrl = must(await uploadBufferToBlobAtPath({
    pathname: `SiteImport/${job.id}/map-report.json`,
    mimeType: 'application/json',
    fileBuffer: Buffer.from(JSON.stringify(out.report, null, 2)),
  }), 'upload report').location;
  log(`Report: ${reportUrl}`);

  // Dry-run nav preview only. On --apply the nav step runs LAST (below):
  // it mutates pages (attaching the master instance), and any page write
  // that follows from pre-fetched state would silently strip those
  // attachments — which is exactly what happened on 2026-08-06 (the menu
  // vanished from the public site after a combined --nav --apply run).
  if (NAV && !APPLY) await runNav(job, scope, out);

  // The import theme: derived now so the dry run shows exactly what --apply
  // would save. Named against the project's CURRENT themes.
  const themePlan = NO_THEME ? null : await planImportTheme(job, scope, { ir });
  if (themePlan) {
    log(`\nImport theme "${themePlan.name}" (becomes the project default on --apply):`);
    for (const note of themePlan.notes) log(`  ${note}`);
  } else {
    log('\nImport theme: skipped (--no-theme).');
  }

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
  const uncopyable = await copyPromotedAssets(out.copyPlan.assets, copyBlob, applied, urlMap);
  if (uncopyable.length) {
    log(`${uncopyable.length} image(s) could not be copied — the original site refused them; they keep their original address:`);
    for (const s of uncopyable) log(`  ${s.fromUrl}  (${s.reason})`);
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
  //    Keyed by location, because --apply is re-run routinely — a second
  //    pass, a later --nav pass — and an unconditional create minted a
  //    fresh row every time. The blob copy above is idempotent (a
  //    deterministic path), so this must be too, or the library fills with
  //    rows pointing at one file: 335 rows for 48 images in Delray inside
  //    three days (2026-08-09).
  const libraryRows = must(await assetsStore.listAssets(scope), 'list project assets');
  const knownLocations = new Set(libraryRows.map((row) => row.location).filter(Boolean));
  let promoted = 0;
  for (const asset of out.copyPlan.assets) {
    const location = urlMap.get(asset.fromUrl) || asset.fromUrl;
    if (!location || knownLocations.has(location)) continue;
    knownLocations.add(location);
    must(await assetsStore.createAsset({
      assetName: asset.originalUrl.split('/').pop() || asset.assetId,
      assetType: (asset.mimeType || '').startsWith('image/') ? 'Image' : 'File',
      category: 'Site Import',
      location,
      caption: asset.altText,
      comments: `Imported from ${asset.originalUrl} (job ${JOB_ID})`,
    }, scope), `promote asset ${asset.assetId}`);
    promoted += 1;
  }
  log(`Assets promoted: ${promoted} new, ${out.copyPlan.assets.length - promoted} already in the library.`);

  // 4. Write pages: rewrite URLs, attach overflow links, strip engine
  //    bookkeeping, respect the hash guard, create or update.
  const sectionHashes = { ...priorHashes };
  /** pageId -> section ids this run owns; hashed at the very end. */
  const ownedSectionIds = new Map();
  // Keyed by page.key, never by source path: two captures of "/" keyed by
  // path found each other's page and were appended onto it (86bch6ger).
  const { pageIds, writes } = await writeMappedPages(out.pages, {
    priorPageIds,
    prepareSections: (page) => page.sections.map(({ sourceElementIds, dispositions, ...section }) => {
      const clean = rewriteUrls(section, urlMap);
      for (const module of clean.modules) {
        const overflowUrl = overflowUrls.get(module.id);
        if (overflowUrl) module.settings.importSourceHtmlUrl = overflowUrl;
      }
      return clean;
    }),
    getPage: async (id) => {
      const fresh = await pagesStore.getPage(id, scope);
      return fresh.ok ? fresh.data : null;
    },
    createPage: async (page, sections) => must(await pagesStore.createPage({
      name: page.name,
      slug: page.slug,
      templateId: '',
      templateKind: 'modular',
      isPublished: false,
      layoutSections: sections,
    }, scope), `create ${page.slug}`),
    updatePage: async (page, current, merged) =>
      must(await pagesStore.updatePage(current.id, { ...current, layoutSections: merged }, scope), `update ${page.slug}`),
    mergeSections: (existing, incoming) => mergeMappedSections(existing, incoming, protectedIds),
    onWrite: (page, pageId, sections, action) => {
      ownedSectionIds.set(pageId, sections.map((s) => s.id).filter((id) => !protectedIds.has(id)));
      const reportPage = out.report.pages.find((p) => p.key === page.key);
      if (reportPage) reportPage.builderPageId = pageId;
      log(`  ${action === 'created' ? 'created' : 'updated'} /${page.slug} (page ${pageId}, draft)`);
    },
  });
  const writeSummary = summarizePageWrites(out.pages.length, writes);
  log(`Pages: ${writeSummary.created} created, ${writeSummary.updated} updated — ${writeSummary.distinctPages} distinct page(s) for ${out.pages.length} in the report.`);
  if (writeSummary.problems.length) {
    // Not thrown: the pages are already written, and the checkpoint below
    // must still record them so a re-run finds them. But the run fails.
    console.error('\nERROR: what was written does not match the report:');
    for (const problem of writeSummary.problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  }

  // 4b. The import theme: create, make default, READ BACK (landmine 12 —
  //     an insert that "succeeds" can still land without its tenant).
  let themeCheckpoint = null;
  if (themePlan) {
    themeCheckpoint = await saveImportTheme(themePlan, scope, { makeDefault: true });
    log(`Theme "${themeCheckpoint.name}" created (${themeCheckpoint.id}) and is now the project default.`);
    log(`  ${undoLine(themeCheckpoint)}`);
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
      ...(themeCheckpoint ? { theme: themeCheckpoint } : {}),
      // Carried over until the menu step below replaces it: these ids are
      // how a re-run finds the sections it made instead of minting twins.
      ...(prior.menus ? { menus: prior.menus } : {}),
    },
  };
  job = must(await store.updateJob(job.id, { checkpoints }), 'record map checkpoint');
  must(await uploadBufferToBlobAtPath({
    pathname: `SiteImport/${job.id}/map-report.json`,
    mimeType: 'application/json',
    fileBuffer: Buffer.from(JSON.stringify(out.report, null, 2)),
  }), 'update report');
  log(`\nAPPLY complete: ${writeSummary.distinctPages} draft page(s) (${writeSummary.created} created, ${writeSummary.updated} updated). Nothing was published.`);
  log(`Rollback: restore snapshot ${snapshot.id} (Builder > page snapshots) or ${path.relative(ROOT, backupPath)}`);

  // Menus and nav LAST: nothing may write pages after the master instances
  // attach (2026-08-06: a page write from pre-fetched state stripped them).
  if (!NO_MENUS) {
    const menuIds = await runMenus(job, scope, out, urlMap, checkpoints);
    checkpoints.map = { ...checkpoints.map, menus: menuIds };
  }
  if (NAV) await runNav(job, scope, out);

  // Fingerprint the sections only NOW, once every write in this run has
  // landed. Hashing them during the write loop recorded a state the nav
  // step then changed (attaching the master re-serializes the whole page),
  // so the next run saw a mismatch and the clobber guard protected the
  // pages from the mapper itself — 150 elements reported human-modified
  // on 2026-08-07 with nobody having touched them.
  const settledHashes = { ...sectionHashes };
  for (const [pageId, sectionIds] of ownedSectionIds) {
    if (!sectionIds.length) continue;
    const settled = await pagesStore.getPage(pageId, scope);
    if (!settled.ok) continue;
    for (const section of settled.data.layoutSections || []) {
      if (sectionIds.includes(section.id)) settledHashes[section.id] = sha256(section);
    }
  }
  must(await store.updateJob(job.id, {
    checkpoints: { ...checkpoints, map: { ...checkpoints.map, sectionHashes: settledHashes } },
  }), 'record settled section hashes');
  log(`Clobber guard: fingerprinted ${Object.keys(settledHashes).length} import-owned section(s).`);
}

/**
 * --theme-only: the import theme and nothing else (task 86bctakkk). The
 * pages' updated_at is read before and after, and a change fails the run —
 * "touches no page" is checked, not assumed.
 */
async function runThemeOnly(job, scope) {
  log(`Mode:    THEME ONLY — ${APPLY ? 'creates the import theme' : 'dry run, writes nothing'}; no page is touched`);
  const stampsOf = async () => new Map(must(await pagesStore.listPages(5000, scope), 'list pages').map((p) => [String(p.id), p.updatedAt]));
  const before = await stampsOf();
  const plan = await planImportTheme(job, scope);
  log(`\nImport theme "${plan.name}" (becomes the project default on --apply):`);
  for (const note of plan.notes) log(`  ${note}`);
  if (!APPLY) {
    log('\nDry run complete. Re-run with --theme-only --apply to create it.');
    return;
  }
  const checkpoint = await saveImportTheme(plan, scope, { makeDefault: true });
  log(`Theme "${checkpoint.name}" created (${checkpoint.id}) and is now the project default.`);
  log(`  ${undoLine(checkpoint)}`);
  must(await store.updateJob(job.id, {
    checkpoints: { ...(job.checkpoints || {}), theme: { ...checkpoint, at: new Date().toISOString() } },
  }), 'record theme checkpoint');
  const after = await stampsOf();
  const changed = [...after].filter(([id, at]) => before.get(id) !== at).map(([id]) => id);
  if (changed.length) {
    console.error(`ERROR: ${changed.length} page(s) changed while the theme was made: ${changed.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  log(`Pages untouched: all ${after.size} page(s) read back with the same updated_at as before.`);
}

/** What the menu step will build — the dry run's promise, and --apply's. */
function logMenuPlan(job, out, prior) {
  if (NO_MENUS) {
    log(`\nMenus: skipped (${NAV ? '--nav writes the header master instead' : '--no-menus'}).`);
    return;
  }
  const menus = out.report.menus;
  const reused = (kind) => (prior.menus?.[kind] ? ` (re-run: updates saved section ${prior.menus[kind]} if it still exists)` : '');
  log('\nMenus (attached to every imported page on --apply):');
  log(menus.top
    ? `  Top Menu: ${menus.top.items} link(s), ${menus.top.topLevel} at the top level; logo ${menus.top.logo ? 'yes (left column)' : 'no'}${reused('top')}`
    : '  Top Menu: none');
  log(menus.footer ? `  Footer Menu: ${menus.footer.items} link(s)${reused('footer')}` : '  Footer Menu: none');
  for (const note of menus.notes) log(`  - ${note}`);
}

/**
 * --apply's menu step (task 86bchydp6): create or update the Top Menu and
 * Footer Menu saved sections, attach them to the imported pages, propagate.
 * Returns the saved-section ids for the job's map checkpoint.
 */
async function runMenus(job, scope, out, urlMap, checkpoints) {
  const prior = job.checkpoints?.map?.menus || {};
  const ids = { ...prior };
  const siteLabel = menuSiteLabel(job.sourceUrl);
  const savedSections = must(await savedSectionsStore.listSavedSections(1000, scope), 'list saved sections');
  const attached = {};
  /** kind -> did the master's content change this run? */
  const masterChanged = {};
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  for (const kind of ['top', 'footer']) {
    const built = buildMenuSection(kind, out.menus, job.id);
    if (!built) {
      const why = out.menus.notes.filter((n) => (kind === 'top' ? /Top Menu/ : /Footer Menu/).test(n));
      log(`Menus: no ${kind === 'top' ? 'Top' : 'Footer'} Menu — ${why.join('; ') || 'nothing to build'}.`);
      continue;
    }
    // The logo's URL becomes the project's own copy, like every image.
    const section = rewriteUrls(built, urlMap);
    const target = planMenuTarget(kind, savedSections, prior[kind] || '', siteLabel);
    let saved;
    let before = '';
    if (target.action === 'update') {
      const current = savedSections.find((s) => String(s.id) === target.id);
      before = sha256(current?.section || null);
      const backupPath = path.join(BACKUP_DIR, `site_import_menu_${kind}_${job.id}_${stamp}.json`);
      writeFileSync(backupPath, JSON.stringify({ jobId: job.id, master: current }, null, 2));
      saved = must(await savedSectionsStore.updateSavedSection(target.id, { name: target.name, section }, scope), `update "${target.name}"`);
      log(`Menus: updated "${target.name}" (${target.id}) — this job made it; backup → ${path.relative(ROOT, backupPath)}`);
    } else {
      saved = must(await savedSectionsStore.createSavedSection({ name: target.name, section }, scope), `create "${target.name}"`);
      log(`Menus: created "${target.name}" (${saved.id}).`);
      if (target.name !== (kind === 'top' ? 'Top Menu' : 'Footer Menu')) {
        log(`  (the project already has a section named "${kind === 'top' ? 'Top Menu' : 'Footer Menu'}" — left untouched)`);
      }
    }
    ids[kind] = String(saved.id);
    // Record the id at once: a run that dies before the end must still find
    // this section next time, not make a second one.
    must(await store.updateJob(job.id, {
      checkpoints: { ...checkpoints, map: { ...checkpoints.map, menus: { ...ids } } },
    }), 'record menu section ids');
    // Read it back (landmine 12): the insert succeeding is not the row
    // landing in this project.
    const reread = must(await savedSectionsStore.getSavedSection(ids[kind], scope), `re-read "${target.name}"`);
    if (!reread) throw new Error(`"${target.name}" (${ids[kind]}) was saved but is not readable in this project.`);
    attached[kind] = { savedSectionId: ids[kind], section: reread.section || section };
    masterChanged[kind] = sha256(reread.section || null) !== before;
  }
  if (!attached.top && !attached.footer) return ids;

  const pageIds = [...new Set(Object.values(job.checkpoints?.map?.pageIds || {}).map(String))];
  let changedPages = 0;
  for (const pageId of pageIds) {
    const page = must(await pagesStore.getPage(pageId, scope), `read page ${pageId}`);
    const next = attachMenuInstances(page.layoutSections || [], pageId, attached);
    if (!next.changed) continue;
    // Spread the page and pass the ARRAY (landmine 13), then read it back.
    must(await pagesStore.updatePage(pageId, { ...page, layoutSections: next.sections }, scope), `attach menus to ${pageId}`);
    const after = must(await pagesStore.getPage(pageId, scope), `re-read page ${pageId}`);
    const sections = after.layoutSections || [];
    if (attached.top && !sections.some((s) => s.savedSectionId === attached.top.savedSectionId)) {
      throw new Error(`page ${pageId}: the Top Menu did not stick (${sections.length} section(s) read back).`);
    }
    if (attached.footer && !sections.some((s) => s.savedSectionId === attached.footer.savedSectionId)) {
      throw new Error(`page ${pageId}: the Footer Menu did not stick (${sections.length} section(s) read back).`);
    }
    changedPages += 1;
  }
  for (const kind of ['top', 'footer']) {
    if (!attached[kind]) continue;
    // An unchanged master on pages that already carried it has nothing to
    // propagate; running it anyway rewrote every imported page per re-run.
    if (!masterChanged[kind] && !changedPages) {
      log(`Menus: ${kind === 'top' ? 'Top' : 'Footer'} Menu unchanged — no propagation needed.`);
      continue;
    }
    const prop = await pagesStore.propagateCanonicalSection(attached[kind].savedSectionId, attached[kind].section, scope);
    log(`Menus: ${kind === 'top' ? 'Top' : 'Footer'} Menu propagation updated ${prop?.updated ?? '?'}/${prop?.total ?? '?'}.`);
  }
  log(`Menus: attached to ${changedPages} of ${pageIds.length} imported page(s) (the rest already carried them).`);
  return ids;
}

/** --nav: write the imported header tree into the Header saved-section
 *  MASTER, with its own backup (site snapshots do not cover masters). */
async function runNav(job, scope, out) {
  if (!out.navItems.length) {
    log('--nav: the IR carries no header nav items — nothing to write.');
    return;
  }
  const savedSections = must(await savedSectionsStore.listSavedSections(1000, scope), 'list saved sections');
  // Which master is the SITE actually using? Saved sections list
  // newest-updated first, so "first one with a nav module" silently picks
  // a half-built spare over the header every page carries — the write
  // succeeds, the site does not change, and nothing reports a problem.
  // Delray had exactly that pair on 2026-08-09. Page references are the
  // ground truth; the name/order heuristics are only a fresh-import
  // fallback, when no page references anything yet.
  const allPages = must(await pagesStore.listPages(5000, scope), 'list pages for nav master');
  const refCount = new Map();
  for (const p of allPages) {
    for (const s of p.layoutSections || []) {
      if (!s.savedSectionId) continue;
      refCount.set(s.savedSectionId, (refCount.get(s.savedSectionId) || 0) + 1);
    }
  }
  const navMasters = savedSections.filter((s) =>
    (s.section?.modules || []).some((m) => m.type === 'navigation')
  );
  const byUsage = [...navMasters].sort(
    (a, b) => (refCount.get(b.id) || 0) - (refCount.get(a.id) || 0)
  );
  let master;
  if (NAV_MASTER_ID) {
    master = savedSections.find((s) => s.id === NAV_MASTER_ID);
    if (!master) throw new Error(`--nav-master ${NAV_MASTER_ID}: no such saved section in this project.`);
  } else {
    master = (refCount.get(byUsage[0]?.id) ? byUsage[0] : null)
      || navMasters[0]
      || savedSections.find((s) => /header/i.test(s.name || ''));
  }
  if (navMasters.length > 1) {
    log(`--nav: ${navMasters.length} masters carry a nav module; chose "${master?.name}" (${master?.id}, ${refCount.get(master?.id) || 0} page reference(s)).`);
    log(`--nav: override with --nav-master <id>. Others: ${navMasters.filter((s) => s.id !== master?.id).map((s) => `${s.name} (${s.id}, ${refCount.get(s.id) || 0} ref)`).join('; ')}`);
  }

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
  const pageIds = [...new Set(Object.values(job.checkpoints?.map?.pageIds || {}).map(String))];
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
