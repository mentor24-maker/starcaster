#!/usr/bin/env node
'use strict';
/**
 * Site Import — Phase 3 runner: merge imported pages into hand-built pages.
 *
 * Phase 2 (site_import_map.mjs) made one Builder draft per captured URL.
 * Since then the operator has hand-built a fresh set of pages from the NEW
 * menu, each carrying a "PLACEHOLDER SECTION". This run works out which
 * imported page belongs to which new page and moves the content across.
 *
 * WHAT A RUN DOES
 *   Dry run (default): classifies every imported page, matches the real
 *   ones against the new pages, prints and writes the reconciliation
 *   report plus an editable decisions file. Writes NOTHING to Builder.
 *   --apply: takes a whole-site snapshot, backs up every page it will
 *   touch to docs/SQL/backups/, then replaces each target's PLACEHOLDER
 *   SECTION with the imported content. Never publishes, never unpublishes.
 *
 * HOW IT DECIDES
 *   The ORIGINAL site's own menu says which captured pages are real pages
 *   (DOCTRINE.md §5.6). Everything else — tag/category/author archives,
 *   blog posts, pages the old menu never linked — is set aside with a
 *   reason and left untouched. Real pages are then matched on nav label,
 *   page title and slug; anything below the confidence bar, or too close
 *   to its runner-up, goes to the review pile rather than being guessed.
 *
 * THE DECISIONS FILE — how you resolve the review pile
 *   Every run writes docs/site-import/reconcile-decisions.json listing each
 *   set-aside page with its best candidates. Fill in a target slug to pair
 *   it, or null to set it aside for good, then re-run. The file outranks
 *   every score, in both directions, and is the permanent record of why.
 *
 * SAFETY
 * - Dry run by default; the report must reconcile or --apply refuses.
 * - Whole-site snapshot + per-page JSON backup before the first write.
 * - Clobber guard: what this run writes is hash-recorded on the job row.
 *   On re-run, a section a human has since edited is SKIPPED and reported,
 *   never overwritten. --force-section <id> overrides one at a time.
 * - Copied sections are stripped of savedSectionId/canonical, so a later
 *   edit can never fan out across the tenant (the 2026-07-21 menu loss).
 * - is_published is never changed, in either direction.
 *
 * ROLLBACK
 *   Restore the snapshot id printed at apply time
 *   (POST /api/builder/page-snapshots/:id/restore), or the per-page JSON
 *   backups written to docs/SQL/backups/reconcile-<jobId>-<timestamp>/.
 *
 * USAGE
 *   doppler run --config prd -- node scripts/site_import_reconcile.mjs --job <id>
 *   doppler run --config prd -- node scripts/site_import_reconcile.mjs --job <id> --apply
 *
 * FLAGS
 *   --job <id>            the completed import job to reconcile (required)
 *   --apply               write; without it nothing is written
 *   --decisions <path>    use a different decisions file
 *   --write-decisions     refresh the decisions file from this run
 *   --keep-placeholder    leave PLACEHOLDER SECTION above the new content
 *   --images              ALSO place the images the capture downloaded but
 *                         never put on a page (galleries, carousels). A
 *                         separate, deliberate step: it copies files and
 *                         creates asset rows, so it never runs by default.
 *   --image-limit <n>     cap images placed per page (0 = no cap)
 *   --keep-boilerplate    keep the WordPress site-title block on each section
 *   --force-section <id>  overwrite one hash-protected section (repeatable)
 *   --allow-local         permit a localhost database (local testing only)
 */

import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

// --- env resolution + guards (same pattern as site_import_map.mjs) -------
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
  console.error('  doppler run --config prd -- node scripts/site_import_reconcile.mjs --job <id>');
  process.exit(1);
}
if (/localhost|127\.0\.0\.1/.test(process.env.SUPABASE_URL) && !flag('--allow-local')) {
  console.error('Refusing a localhost database (--allow-local overrides for local testing).');
  process.exit(1);
}
if (flag('--images') && flag('--apply') && !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is missing — --images copies files into durable storage.');
  process.exit(1);
}

const store = require('./lib/siteImportStore.js');
const assetsStore = require('./lib/assetsStore.js');
const { uploadBufferToBlobAtPath } = require('./lib/blobStorage.js');
const pagesStore = require('./lib/builderPagesStore.js');
const snapshotsStore = require('./lib/builderPageSnapshotsStore.js');
const { reconcile, reportReconciles, toPath, mergeDecisions } = require('./lib/site-import/dist/reconcile.js');
const {
  planImageTopUp, buildTopUpSection, topUpReconciles, topUpSectionId, photoStem,
} = require('./lib/site-import/dist/image-topup.js');

const JOB_ID = flagValue('--job');
const APPLY = flag('--apply');
const KEEP_PLACEHOLDER = flag('--keep-placeholder');
const KEEP_BOILERPLATE = flag('--keep-boilerplate');
const WRITE_DECISIONS = flag('--write-decisions');
const IMAGES = flag('--images');
const IMAGE_LIMIT = Math.max(0, Number(flagValue('--image-limit') || 0) || 0);
const FORCED_SECTIONS = new Set(flagValues('--force-section'));
const DECISIONS_PATH = flagValue('--decisions') || path.join(ROOT, 'docs/site-import/reconcile-decisions.json');
const BACKUP_DIR = path.join(ROOT, 'docs/SQL/backups');

if (!JOB_ID) {
  console.error('--job <id> is required. List jobs with: GET /api/site-import/jobs');
  process.exit(1);
}

const log = (...parts) => console.log(...parts);

/** The stores return { ok, status, data } envelopes — never the row itself. */
function must(res, what) {
  if (!res || res.ok === false) throw new Error(`${what}: ${res?.error || `status ${res?.status}`}`);
  return res.data;
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function sectionHash(section) {
  return crypto.createHash('sha256').update(JSON.stringify(section)).digest('hex');
}

function docSections(page) {
  const doc = page?.layoutSections ?? page?.layout_sections ?? page?.sections;
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc?.sections)) return doc.sections;
  return [];
}

/** Flatten the IR's header nav tree to { label, path } in menu order. */
function flattenNav(navs) {
  const header = (navs || []).find((n) => n.location === 'header') || (navs || [])[0];
  const out = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (item?.href) out.push({ label: String(item.label || '').trim(), path: toPath(item.href) });
      if (item?.children?.length) walk(item.children);
    }
  };
  walk(header?.items);
  return out;
}

/**
 * WordPress serves posts from the site root, so a path alone cannot tell a
 * blog post from a real page the menu forgot. The listings can: the blog
 * page and every tag/category/author archive link to posts and to little
 * else. Anything they link to, that the menu does not, is a post.
 */
function collectPostPaths(ir) {
  const listings = (ir?.pages || []).filter((page) => {
    const p = toPath(page?.path || page?.url || '');
    return /^\/(tag|category|author)\//.test(p) || /(^|\/)blog(\/|$)/.test(p);
  });
  const paths = new Set();
  for (const page of listings) {
    for (const section of page?.sections || []) {
      for (const element of section?.elements || []) {
        const html = String(element?.html || '');
        for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
          const href = match[1];
          // Only same-site links; the IR keeps absolute URLs from the capture.
          if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
          if (/^https?:\/\//i.test(href) && !href.includes(new URL(ir.sourceUrl).host)) continue;
          const p = toPath(href);
          if (p && p !== '/' && !/^\/(tag|category|author)\//.test(p)) paths.add(p);
        }
      }
    }
  }
  return [...paths];
}

function loadDecisions() {
  if (!existsSync(DECISIONS_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(DECISIONS_PATH, 'utf8'));
    const raw = parsed?.decisions && typeof parsed.decisions === 'object' ? parsed.decisions : {};
    // Only entries the operator actually filled in count as decisions;
    // "" is the untouched default the file ships with.
    const out = {};
    for (const [slug, value] of Object.entries(raw)) {
      if (value === null) out[slug] = null;
      else if (typeof value === 'string' && value.trim()) out[slug] = value.trim();
    }
    return out;
  } catch (err) {
    console.error(`Could not read ${DECISIONS_PATH}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Most actionable first. Four real judgment calls buried under seventy-nine
 * archives and blog posts is a file nobody opens twice.
 */
const REVIEW_ORDER = ['nav-page', 'orphan', 'home', 'post', 'archive'];

function writeDecisionsFile(output, decisions) {
  const ordered = [...output.setAside].sort((a, b) => {
    const byClass = REVIEW_ORDER.indexOf(a.sourceClass) - REVIEW_ORDER.indexOf(b.sourceClass);
    if (byClass !== 0) return byClass;
    // Within a class, the strongest candidate first — that is the one most
    // likely to be a real page the score merely could not prove.
    return (b.candidates[0]?.score || 0) - (a.candidates[0]?.score || 0);
  });
  const entries = mergeDecisions(decisions, output);

  const notes = ordered.map((item) => ({
    sourceSlug: item.sourceSlug,
    originalPath: item.sourcePath,
    title: item.sourceTitle,
    setAsideBecause: item.reason,
    class: item.sourceClass,
    bestCandidates: item.candidates.map((c) => `${c.targetSlug} (${c.score.toFixed(2)}, ${c.reason})`),
  }));

  // Pages paired BY this file are recorded too, so the file explains every
  // call it is making rather than only the ones still outstanding.
  const applied = output.pairings
    .filter((p) => p.reason === 'decision-file')
    .map((p) => ({
      sourceSlug: p.sourceSlug,
      originalPath: p.sourcePath,
      title: p.sourceTitle,
      pairedWith: p.targetSlug,
      by: 'decision file',
      modules: p.moduleCount,
    }));
  const payload = {
    _readme: [
      'Fill in "decisions" to resolve the review pile, then re-run the script.',
      'A target page slug pairs the imported page there, regardless of score.',
      'null sets it aside for good. "" means undecided — the run skips it.',
      'This file outranks every score and is the record of why each call was made.',
    ],
    jobId: JOB_ID,
    generatedAt: new Date().toISOString(),
    decisions: entries,
    appliedByThisFile: applied,
    notes,
  };
  mkdirSync(path.dirname(DECISIONS_PATH), { recursive: true });
  writeFileSync(DECISIONS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  const undecided = Object.values(entries).filter((v) => v === '').length;
  log(`\nDecisions file: ${path.relative(ROOT, DECISIONS_PATH)} — ${applied.length} call(s) applied, ${undecided} still undecided`);
}


/** Every image URL on a page's imported sections — module settings and inline. */
function imageUrlsOnPage(sections) {
  const out = [];
  for (const section of sections) {
    for (const module of section.modules || []) {
      const st = module.settings || {};
      const url = st.url || st.imageUrl || st.src;
      if (url && (module.type === 'image' || module.type === 'slideshow')) out.push(String(url));
      if (module.type === 'slideshow' && st.slides) {
        try {
          for (const slide of JSON.parse(st.slides) || []) if (slide?.url) out.push(String(slide.url));
        } catch { /* a malformed slides blob just means we place a few duplicates */ }
      }
      if (typeof module.text === 'string') {
        for (const m of module.text.matchAll(/<img[^>]+src\s*=\s*["\']([^"\']+)["\']/gi)) out.push(m[1]);
      }
    }
  }
  return out;
}

/** Page every row: the delraytennis job alone downloaded over 2,000 assets. */
async function fetchAllImportAssets(jobId) {
  const all = [];
  const PAGE = 1000;
  for (let page = 0; ; page += 1) {
    const res = await store.listAssets(jobId, { limit: PAGE, offset: page * PAGE });
    const batch = res?.ok === false ? null : (res?.data ?? res);
    if (!Array.isArray(batch) || !batch.length) break;
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

async function copyToDurable(fromUrl, pathname, mimeType) {
  const res = await fetch(fromUrl, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${fromUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const up = must(await uploadBufferToBlobAtPath({ pathname, mimeType, fileBuffer: buffer }), `copy ${pathname}`);
  return up.location;
}



/**
 * Pairings for the image step, which runs AFTER content has landed.
 *
 * Once a page has been filled its PLACEHOLDER SECTION is gone, so it is no
 * longer an eligible target and reconcile() reports zero pairings — correct
 * for content (a built page must never be overwritten) and useless here.
 * Every copied module carries `reconciledFromPath`, so the pages themselves
 * are the record of what was paired with what.
 */
function pairingsFromProvenance(pages) {
  const seen = new Set();
  const out = [];
  for (const page of pages) {
    for (const section of docSections(page)) {
      if (!String(section.id).startsWith('recs_')) continue;
      for (const module of section.modules || []) {
        const from = module?.settings?.reconciledFromPath;
        if (!from) continue;
        const key = `${from}|${page.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          sourcePath: toPath(from),
          targetId: String(page.id),
          targetSlug: String(page.slug || ''),
        });
      }
    }
  }
  return out;
}

/** Live pairings plus everything already applied, de-duplicated. */
function allPairings(livePairings, pages) {
  const merged = [];
  const seen = new Set();
  for (const p of [...livePairings, ...pairingsFromProvenance(pages)]) {
    const key = `${p.sourcePath}|${p.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }
  return merged;
}

/**
 * The image top-up. Deliberately a separate flagged step: it copies files
 * into durable storage and creates asset rows, which is not something a
 * default dry-run-then-apply should do as a side effect.
 */
async function runImageTopUp({ job, scope, pairings, pagesById, projectId, snapshot, backupDir }) {
  log('\n================ IMAGES ================');
  const rawAssets = await fetchAllImportAssets(job.id);
  const images = rawAssets.filter(
    (a) => /^image\//.test(a.mimeType || a.mime_type || '') && (a.status === 'downloaded')
  );
  log(`Import downloaded ${rawAssets.length} file(s), ${images.length} of them images.`);

  const assets = images.map((a) => {
    const refs = a.referencedBy || a.referenced_by || [];
    return {
      originalUrl: a.originalUrl || a.original_url || '',
      storageUrl: a.storageUrl || a.storage_url || '',
      mimeType: a.mimeType || a.mime_type || '',
      byteSize: Number(a.byteSize || a.byte_size || 0) || 0,
      width: Number(a.width || 0) || 0,
      height: Number(a.height || 0) || 0,
      altText: a.altText || a.alt_text || '',
      referencedPaths: (Array.isArray(refs) ? refs : [])
        .map((r) => toPath(r?.pageUrl || r?.page_url || ''))
        .filter(Boolean),
    };
  }).filter((a) => a.storageUrl && a.referencedPaths.length);

  const targets = pairings.map((p) => {
    const page = pagesById.get(p.targetId);
    const sections = page ? docSections(page).filter((s) => String(s.id).startsWith('recs')) : [];
    return {
      sourcePath: p.sourcePath,
      targetId: p.targetId,
      targetSlug: p.targetSlug,
      alreadyOnPage: imageUrlsOnPage(sections),
    };
  });

  const { plans, report } = planImageTopUp({ assets, targets, limitPerPage: IMAGE_LIMIT });

  log('\npage                      captured  furniture  sizeVariants  already  capped  toPlace  as');
  for (const row of report.byPage) {
    log(`${row.targetSlug.padEnd(24)} ${String(row.captured).padStart(8)} ${String(row.furniture).padStart(10)} ${String(row.variants).padStart(13)} ${String(row.already).padStart(8)} ${String(row.capped).padStart(7)} ${String(row.planned).padStart(8)}  ${row.planned ? row.presentation : '-'}`);
  }
  const mb = (plans.reduce((n, p) => n + p.totalBytes, 0) / 1048576).toFixed(1);
  log(`\nTo place: ${report.planned} image(s) across ${plans.length} page(s), ${mb} MB copied into durable storage.`);
  log(`Excluded: ${report.furnitureExcluded} site furniture, ${report.variantsCollapsed} duplicate size variants, ${report.alreadyOnPage} already on the page${report.capped ? `, ${report.capped} over the --image-limit` : ''}.`);

  const balances = topUpReconciles(report);
  log(`Accounting: every captured image is in exactly one bucket — ${balances ? 'OK' : 'MISMATCH'}`);
  if (!balances) {
    console.error('Image accounting does not balance — refusing to place images.');
    process.exit(1);
  }
  if (!APPLY) {
    log('\nDry run — no files copied, no pages changed.');
    return;
  }
  if (!plans.length) { log('Nothing to place.'); return; }

  const durable = `SiteImportApplied/${projectId}/topup`;
  let placed = 0;
  for (const plan of plans) {
    const page = must(await pagesStore.getPage(plan.targetId, scope), `get ${plan.targetSlug}`);
    writeFileSync(path.join(backupDir, `${plan.targetSlug}.images-before.json`), `${JSON.stringify(page, null, 2)}\n`);

    // Copy first, then register, then write the page — so a page never
    // references a file that is not there yet.
    const urlByOriginal = new Map();
    for (const image of plan.images) {
      const stem = photoStem(image.originalUrl) || 'image';
      const target = `${durable}/${plan.targetSlug}/${stem}`;
      const url = await copyToDurable(image.storageUrl, target, /\.png$/i.test(stem) ? 'image/png' : 'image/jpeg');
      urlByOriginal.set(image.originalUrl, url);

      must(await assetsStore.createAsset({
        assetName: stem,
        assetType: 'Image',
        category: 'Site Import',
        location: url,
        size: image.byteSize,
        imageWidth: image.width,
        imageHeight: image.height,
        caption: image.alt,
        topic: `Imported from ${plan.sourcePaths.join(', ')}`,
        tags: ['site-import', 'image-topup'],
      }, scope), `register asset ${stem}`);
    }
    log(`  ${plan.targetSlug}: copied ${plan.images.length} image(s) into the asset library`);

    const section = buildTopUpSection(plan, (image) => urlByOriginal.get(image.originalUrl) || image.storageUrl);
    const current = docSections(page);
    // Sit directly after the content this run already placed, so images stay
    // above the footer rather than below the copyright.
    const withoutOld = current.filter((s) => String(s.id) !== String(section.id));
    let at = withoutOld.length;
    for (let i = withoutOld.length - 1; i >= 0; i -= 1) {
      if (String(withoutOld[i].id).startsWith('recs_')) { at = i + 1; break; }
    }
    const nextSections = [...withoutOld.slice(0, at), section, ...withoutOld.slice(at)];

    must(await pagesStore.updatePage(
      plan.targetId,
      { ...page, layoutSections: nextSections },
      scope,
      { previous: page, reason: 'save', actor: 'site-import-reconcile-images' }
    ), `update ${plan.targetSlug}`);

    const after = must(await pagesStore.getPage(plan.targetId, scope), `verify ${plan.targetSlug}`);
    const afterSections = docSections(after);
    const landed = afterSections.find((s) => String(s.id) === String(section.id));
    const landedImages = landed ? imageUrlsOnPage([landed]).length : 0;
    if (afterSections.length !== nextSections.length || landedImages !== plan.images.length) {
      console.error(`\n${plan.targetSlug}: expected ${nextSections.length} sections with ${plan.images.length} images, found ${afterSections.length} with ${landedImages}.`);
      console.error('STOPPING before any further page is touched.');
      console.error(`Restore: POST /api/builder/page-snapshots/${snapshot.id}/restore`);
      process.exit(1);
    }
    placed += plan.images.length;
    log(`  ${plan.targetSlug}: placed ${plan.images.length} as ${plan.presentation}, verified on the page`);
  }
  log(`\nImages placed: ${placed}`);
}

async function main() {
  const job = must(await store.getJob(JOB_ID), 'get job');
  if (job.status !== 'complete') {
    console.error(`Job ${JOB_ID} is "${job.status}" — reconcile runs on a complete import.`);
    process.exit(1);
  }
  const projectId = job.projectId;
  const scope = { projectId };
  const mapCheckpoint = job.checkpoints?.map;
  if (!mapCheckpoint?.pageIds) {
    console.error(`Job ${JOB_ID} has no map checkpoint — run site_import_map.mjs --apply first.`);
    process.exit(1);
  }

  log(`Job ${JOB_ID}  project ${projectId}  source ${job.sourceUrl}`);
  log(`${APPLY ? 'APPLY — writes are real' : 'DRY RUN — nothing will be written'}`);

  // The IR carries the original site's menu, which decides what is a page.
  const irPath = job.checkpoints?.normalize?.blobPath;
  if (!irPath) { console.error('Job has no normalize checkpoint — cannot read the IR.'); process.exit(1); }
  const ir = await (await fetch(irPath)).json();
  const navEntries = flattenNav(ir?.taxonomy?.navs);
  log(`Original menu: ${navEntries.length} entries, ${new Set(navEntries.map((n) => n.path)).size} distinct pages`);
  const postPaths = collectPostPaths(ir);
  log(`Blog/archive listings link to ${postPaths.length} path(s) — those are posts, not pages`);

  // path -> builderPageId, inverted to id -> path.
  const sourcePaths = {};
  for (const [irPath_, pageId] of Object.entries(mapCheckpoint.pageIds)) {
    sourcePaths[String(pageId)] = irPath_;
  }

  // listPages takes (limit, scope) — passing the scope first silently returns
  // every project's pages, which is how this went wrong the first time.
  const list = must(await pagesStore.listPages(5000, scope), 'list pages');
  const full = [];
  for (const summary of list) {
    const page = must(await pagesStore.getPage(summary.id, scope), `get page ${summary.id}`);
    if (page) full.push(page);
  }
  const shaped = full.map((page) => ({
    id: String(page.id),
    slug: String(page.slug || ''),
    name: String(page.name || page.title || ''),
    sections: docSections(page),
    _raw: page,
  }));

  const importedIds = new Set(Object.keys(sourcePaths));
  const sources = shaped.filter((p) => importedIds.has(p.id));
  const targets = shaped.filter((p) => !importedIds.has(p.id));
  log(`Pages: ${shaped.length} total — ${sources.length} imported, ${targets.length} hand-built`);

  const decisions = loadDecisions();
  if (Object.keys(decisions).length) log(`Decisions file supplies ${Object.keys(decisions).length} call(s)`);

  const output = reconcile({
    sources,
    targets,
    sourcePaths,
    navEntries,
    postPaths,
    decisions,
    stripBoilerplate: !KEEP_BOILERPLATE,
    keepPlaceholder: KEEP_PLACEHOLDER,
  });
  const { report } = output;

  log('\n===== CLASSIFICATION =====');
  for (const [cls, count] of Object.entries(report.sources.byClass)) log(`  ${cls.padEnd(10)} ${count}`);
  log('\n===== CHROME (repeated across the imported set, never copied) =====');
  for (const sig of report.chromeSignatures) log(`  x${String(sig.pageCount).padStart(3)}  ${sig.signature.slice(0, 110)}`);

  log(`\n===== PAIRED (${output.pairings.length}) =====`);
  for (const p of output.pairings) {
    log(`  ${p.sourcePath.padEnd(30)} -> ${p.targetSlug.padEnd(24)} ${p.score.toFixed(2)} ${p.reason.padEnd(16)} ${p.moduleCount} modules`);
  }

  log(`\n===== SET ASIDE (${output.setAside.length}) =====`);
  const grouped = {};
  for (const item of output.setAside) (grouped[item.sourceClass] ||= []).push(item);
  for (const [cls, items] of Object.entries(grouped)) {
    log(`\n  -- ${cls} (${items.length}) --`);
    for (const item of items) {
      const best = item.candidates[0];
      log(`  ${item.sourcePath.slice(0, 44).padEnd(44)} ${item.reason}${best ? `  [best: ${best.targetSlug} ${best.score.toFixed(2)}]` : ''}`);
    }
  }

  if (report.collisions.length) {
    log('\n===== COLLISIONS (several imported pages onto one new page) =====');
    for (const c of report.collisions) log(`  ${c.targetSlug} <- ${c.sourceSlugs.join(', ')}`);
  }

  log('\n===== PLAN =====');
  for (const plan of output.plans) {
    const modules = plan.sections.reduce((n, s) => n + (s.modules || []).length, 0);
    log(`  ${plan.targetSlug.padEnd(24)} insert ${plan.sections.length} section(s) / ${modules} module(s) at index ${plan.insertAt}${plan.removesSectionIds.length ? ', replacing the placeholder' : ''}  <- ${plan.fromSourceSlug}`);
  }
  log(`\nTargets: ${report.targets.eligible} eligible, ${report.targets.filled} filled, ${report.targets.leftEmpty.length} left empty`);
  log(`Left empty: ${report.targets.leftEmpty.join(', ') || '(none)'}`);
  log(`Boilerplate blocks stripped: ${report.boilerplateStripped}`);
  log(`Shared title suffix discounted: ${report.siteSuffix ? JSON.stringify(report.siteSuffix) : '(none detected)'}`);
  const affixSummary = (lengths) => (lengths.length ? `${lengths.join(' / ')} chars` : 'none found');
  log(`Shared prose furniture removed: header ${affixSummary(report.commonAffixes.prefixLengths)}, footer ${affixSummary(report.commonAffixes.suffixLengths)}`);

  const reconciles = reportReconciles(report);
  log(`\nReconciliation: ${report.sources.total} imported = ${report.sources.paired} paired + ${report.sources.setAside} set aside — ${reconciles ? 'OK' : 'MISMATCH'}`);

  if (WRITE_DECISIONS || !APPLY) writeDecisionsFile(output, decisions);

  if (!APPLY) {
    if (IMAGES) {
      await runImageTopUp({
        job, scope, pairings: allPairings(output.pairings, full), projectId,
        pagesById: new Map(full.map((p) => [String(p.id), p])),
        snapshot: null, backupDir: null,
      });
    }
    log('\nDry run complete. Nothing was written.');
    log('Resolve the review pile in the decisions file, then re-run with --apply.');
    return;
  }
  if (!reconciles) {
    console.error('\nReport does not reconcile — refusing to apply.');
    process.exit(1);
  }
  // No content left to place is normal on a re-run — the placeholders are
  // gone because this tool already filled them. It must not short-circuit
  // --images, which works on pages that are ALREADY filled.
  if (!output.plans.length && !IMAGES) {
    log('\nNothing to write.');
    return;
  }
  if (!output.plans.length) log('\nNo new content sections to place — going straight to images.');

  // --- writes start here -------------------------------------------------
  const snapshot = must(await snapshotsStore.createPageSnapshot(
    { label: `pre-site-import-reconcile ${JOB_ID}`, pages: full }, scope
  ), 'create snapshot');
  if (!snapshot?.id) { console.error('Snapshot returned no id — refusing to write.'); process.exit(1); }
  log(`\nWhole-site snapshot: ${snapshot.id} (${full.length} pages)`);

  const backupDir = path.join(BACKUP_DIR, `reconcile-${JOB_ID}-${stamp}`);
  mkdirSync(backupDir, { recursive: true });

  const priorHashes = job.checkpoints?.reconcile?.sectionHashes || {};
  const nextHashes = { ...priorHashes };
  let written = 0;
  let skippedProtected = 0;

  for (const plan of output.plans) {
    const page = must(await pagesStore.getPage(plan.targetId, scope), `get ${plan.targetSlug}`);
    if (!page) { log(`  ${plan.targetSlug}: gone, skipped`); continue; }
    writeFileSync(path.join(backupDir, `${plan.targetSlug}.json`), `${JSON.stringify(page, null, 2)}\n`);

    const current = docSections(page);
    const byId = new Map(current.map((s) => [String(s.id), s]));

    // Clobber guard: a section this tool wrote, that a human has since
    // edited, is left exactly as the human left it.
    const insertable = [];
    for (const section of plan.sections) {
      const existing = byId.get(String(section.id));
      const recorded = priorHashes[String(section.id)];
      if (existing && recorded && sectionHash(existing) !== recorded && !FORCED_SECTIONS.has(String(section.id))) {
        log(`  ${plan.targetSlug}: section ${section.id} edited since the last run — skipped (humanModified)`);
        skippedProtected += 1;
        continue;
      }
      insertable.push(section);
    }
    if (!insertable.length) continue;

    const insertIds = new Set(insertable.map((s) => String(s.id)));
    const kept = current.filter(
      (s) => !plan.removesSectionIds.includes(String(s.id)) && !insertIds.has(String(s.id))
    );
    const anchor = current.findIndex((s) => plan.removesSectionIds.includes(String(s.id)));
    const at = anchor === -1 ? Math.min(plan.insertAt, kept.length) : Math.min(anchor, kept.length);
    const nextSections = [...kept.slice(0, at), ...insertable, ...kept.slice(at)];

    // `layoutSections` must be the ARRAY of sections, with pageBackground and
    // theme as siblings — wrapping it in { sections: [...] } makes the
    // serializer read no sections at all and write an EMPTY page. Spreading
    // the page keeps every field that is not being changed.
    must(await pagesStore.updatePage(
      plan.targetId,
      { ...page, layoutSections: nextSections },
      scope,
      { previous: page, reason: 'save', actor: 'site-import-reconcile' }
    ), `update ${plan.targetSlug}`);

    // Read it back before touching another page. A write that silently
    // normalizes to nothing looks identical to a success from here, and the
    // first version of this script emptied fourteen pages in a row that way.
    const after = must(await pagesStore.getPage(plan.targetId, scope), `verify ${plan.targetSlug}`);
    const afterSections = docSections(after);
    const expected = nextSections.length;
    const landed = new Set(afterSections.map((s) => String(s.id)));
    const missing = insertable.filter((s) => !landed.has(String(s.id)));
    if (afterSections.length !== expected || missing.length) {
      console.error(
        `\n${plan.targetSlug}: wrote ${expected} section(s) but the page now has ` +
        `${afterSections.length}${missing.length ? `, missing ${missing.map((s) => s.id).join(', ')}` : ''}.`
      );
      console.error('STOPPING before any further page is touched.');
      console.error(`Restore: POST /api/builder/page-snapshots/${snapshot.id}/restore`);
      console.error(`Per-page backups: ${path.relative(ROOT, backupDir)}`);
      process.exit(1);
    }

    for (const section of insertable) nextHashes[String(section.id)] = sectionHash(section);
    written += 1;
    log(`  ${plan.targetSlug}: wrote ${insertable.length} section(s), verified ${afterSections.length} on the page`);
  }

  must(await store.updateJob(JOB_ID, {
    checkpoints: {
      ...(job.checkpoints || {}),
      reconcile: {
        at: new Date().toISOString(),
        snapshotId: snapshot.id,
        pagesWritten: written,
        pairings: output.pairings.map((p) => ({
          sourcePath: p.sourcePath, targetId: p.targetId, targetSlug: p.targetSlug,
        })),
        sectionHashes: nextHashes,
      },
    },
  }), 'record reconcile checkpoint');

  if (IMAGES) {
    const fresh = [];
    for (const summary of list) {
      const page = must(await pagesStore.getPage(summary.id, scope), `re-read ${summary.id}`);
      if (page) fresh.push(page);
    }
    await runImageTopUp({
      job, scope, pairings: allPairings(output.pairings, fresh), projectId,
      pagesById: new Map(fresh.map((p) => [String(p.id), p])),
      snapshot, backupDir,
    });
  }

  log(`\nApplied. ${written} page(s) written, ${skippedProtected} section(s) protected.`);
  log(`Backups: ${path.relative(ROOT, backupDir)}`);
  log(`Rollback: POST /api/builder/page-snapshots/${snapshot.id}/restore`);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
