#!/usr/bin/env node
'use strict';
/**
 * Site Import worker — the engine that turns a queued import job into
 * captured pages, downloaded assets, and the final IR. Runs on the
 * operator's Mac, NEVER on Vercel (Playwright cannot run there and a full
 * capture outlives the 300 s function ceiling).
 *
 * WHAT A RUN DOES (spec docs/site-import/01-capture-and-ir.md)
 *   1. capture   — honor robots.txt, discover pages (sitemap + BFS link
 *                  crawl), capture each at 3 viewports with Playwright,
 *                  upload capture JSON + screenshots to Vercel Blob under
 *                  SiteImport/<jobId>/, create pending asset rows.
 *   2. assets    — download every referenced image/PDF/video/font, dedupe
 *                  by sha256, upload to Blob, record every failure on its
 *                  row (never silently skipped).
 *   3. normalize — run the captured pages through the normalizer, upload
 *                  ir.json, write coverage to the job row. A non-empty
 *                  coverage.dropped is a bug and is shouted about.
 * Each stage checkpoints its Blob output on the job row before the next
 * begins, so any stage can be re-run alone with --stage.
 *
 * USAGE (always through Doppler so the cloud credentials come along):
 *   doppler run --config prd -- node scripts/site_import_worker.mjs --job <id>
 *   doppler run --config prd -- node scripts/site_import_worker.mjs --watch
 *   doppler run --config prd -- node scripts/site_import_worker.mjs --stage capture --job <id>
 *   doppler run --config prd -- node scripts/site_import_worker.mjs --reclaim-stale 30
 *
 * FLAGS
 *   --job <id>                run one specific job
 *   --watch                   claim queued jobs in a loop (Ctrl+C to stop)
 *   --stage <name>            re-run one stage (capture | assets | normalize); needs --job
 *   --reclaim-stale <min>     free claims of jobs untouched for <min> minutes, then exit
 *   --client-authorized <ref> proceed past robots.txt; <ref> (client name or
 *                             deal reference) is stamped on the job row so
 *                             every override is attributable. Value REQUIRED.
 *   --caps k=v[,k=v...]       raise/lower this run's budgets, e.g.
 *                             --caps maxBrowserSeconds=3600,maxPages=120
 *                             (keys = DEFAULT_CAPS in lib/siteImportStore.js).
 *                             The standard way to re-import a site that a
 *                             budget cut short: queue a fresh job, run with
 *                             bigger caps.
 *   --allow-local             permit a localhost database (local testing only)
 *
 * SAFETY
 * - Writes ONLY app_site_import_* tables and the job's own Blob namespace;
 *   never touches Builder data, so there is no --apply gate.
 * - Refuses a localhost database unless --allow-local: imports feed the
 *   production review UI, and a local capture would silently vanish.
 * - robots.txt is honored by default; a blocked job fails naming the rule.
 * - Serial page fetches with a politeness delay; identifying user agent.
 */

import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

// ---------------------------------------------------------------------------
// Env resolution — Doppler-first (doppler run injects process.env), with the
// worktree-tolerant .env.local.cloud-backup fallback the one-off scripts use.
// ---------------------------------------------------------------------------

const MAIN_CHECKOUT = '/Users/mentor/WebApps/starcaster';
const ENV_CANDIDATES = [
  process.env.STARCASTER_ENV_FILE,
  path.join(ROOT, '.env.local.cloud-backup'),
  path.join(MAIN_CHECKOUT, '.env.local.cloud-backup'),
  path.join(ROOT, '.env.local'),
  path.join(MAIN_CHECKOUT, '.env.local'),
].filter(Boolean);

function loadEnvFileInto(target) {
  for (const candidate of ENV_CANDIDATES) {
    try {
      const text = readFileSync(candidate, 'utf8');
      const parsed = {};
      for (const line of text.split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) parsed[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      if (parsed.SUPABASE_URL) {
        for (const [k, v] of Object.entries(parsed)) {
          if (!target[k]) target[k] = v;
        }
        return candidate;
      }
    } catch { /* try the next candidate */ }
  }
  return '';
}

let envSource = 'process env (doppler)';
if (!process.env.SUPABASE_URL) {
  const file = loadEnvFileInto(process.env);
  envSource = file || 'none';
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) {
    console.error(`${name} requires a value.`);
    process.exit(1);
  }
  return v;
};

if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('No Supabase credentials found. Run through Doppler:');
  console.error('  doppler run --config prd -- node scripts/site_import_worker.mjs ...');
  process.exit(1);
}
if (/localhost|127\.0\.0\.1/.test(process.env.SUPABASE_URL) && !flag('--allow-local')) {
  console.error('Refusing to run against a localhost database: imports feed the production');
  console.error('review UI and a local capture would silently vanish. Run through Doppler:');
  console.error('  doppler run --config prd -- node scripts/site_import_worker.mjs ...');
  console.error('(--allow-local overrides for local testing.)');
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is missing — captures upload to Vercel Blob.');
  console.error('Run through Doppler: doppler run --config prd -- node scripts/site_import_worker.mjs ...');
  process.exit(1);
}

// Required after env so lib/supabase.js sees the credentials.
const store = require('./lib/siteImportStore.js');
const { uploadBufferToBlobAtPath } = require('./lib/blobStorage.js');
const { normalizeSite, computeSourceId } = require('./lib/site-import/dist/normalize.js');
const {
  parseRobots, robotsVerdict, fetchSitemapUrls, extractLinks,
  normalizeCrawlUrl, CrawlQueue, looksLikeHtmlUrl,
} = require('./lib/site-import/dist/crawl.js');
const {
  PlaywrightCaptureProvider, VIEWPORTS, DEFAULT_USER_AGENT,
} = require('./lib/site-import/dist/capture-playwright.js');

const CLAIMED_BY = `${os.hostname()}:${process.pid}`;
const POLITENESS_DELAY_MS = 750;
const WATCH_IDLE_MS = 15000;

const log = (...parts) => console.log(new Date().toISOString(), ...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function must(res, what) {
  if (!res.ok) throw new Error(`${what}: ${res.error || `status ${res.status}`}`);
  return res.data;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': DEFAULT_USER_AGENT },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function pageSlug(url, used) {
  let slug = 'home';
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '');
    if (p && p !== '/') {
      slug = p.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'page';
    }
  } catch { slug = 'page'; }
  let unique = slug;
  let n = 2;
  while (used.has(unique)) unique = `${slug}-${n++}`;
  used.add(unique);
  return unique;
}

async function uploadPng(jobId, relPath, png) {
  const res = await uploadBufferToBlobAtPath({
    pathname: `SiteImport/${jobId}/${relPath}`,
    mimeType: 'image/png',
    fileBuffer: Buffer.from(png),
  });
  return must(res, `Blob upload ${relPath}`).location;
}

async function uploadJson(jobId, relPath, value) {
  const res = await uploadBufferToBlobAtPath({
    pathname: `SiteImport/${jobId}/${relPath}`,
    mimeType: 'application/json',
    fileBuffer: Buffer.from(JSON.stringify(value)),
  });
  return must(res, `Blob upload ${relPath}`).location;
}

async function setCheckpoint(job, stage, data) {
  const checkpoints = { ...(job.checkpoints || {}), [stage]: { at: new Date().toISOString(), ...data } };
  const updated = must(await store.updateJob(job.id, { checkpoints }), 'update checkpoints');
  return updated;
}

function cancellationRequested(job) {
  return Boolean(job.checkpoints && job.checkpoints.cancelRequested);
}

// ---------------------------------------------------------------------------
// Stage 1: capture
// ---------------------------------------------------------------------------

async function runCaptureStage(job, opts) {
  const caps = job.caps;
  const seed = normalizeCrawlUrl(job.sourceUrl);
  if (!seed) throw new Error(`Source URL is not crawlable: ${job.sourceUrl}`);

  // robots.txt gate (ratified decision 4).
  let robots = parseRobots('');
  try {
    const origin = new URL(seed).origin;
    robots = parseRobots(await fetchText(`${origin}/robots.txt`));
  } catch {
    /* no robots.txt → everything allowed */
  }
  const seedVerdict = robotsVerdict(robots, DEFAULT_USER_AGENT, new URL(seed).pathname);
  let override = job.clientAuthorization || opts.clientAuthorized || '';
  if (!seedVerdict.allowed) {
    if (!override) {
      throw new Error(
        `robots.txt disallows this crawl (${seedVerdict.rule}). If the client has authorized the ` +
        'import, re-run with --client-authorized "<client name or deal reference>".'
      );
    }
    log(`robots.txt override active (${seedVerdict.rule}) — authorized by: ${override}`);
  }
  if (opts.clientAuthorized && opts.clientAuthorized !== job.clientAuthorization) {
    job = must(await store.updateJob(job.id, { client_authorization: opts.clientAuthorized }), 'stamp authorization');
  }

  const queue = new CrawlQueue({ seedUrl: seed, maxPages: caps.maxPages, maxDepth: caps.maxDepth });
  const sitemapUrls = await fetchSitemapUrls(fetchText, seed, {
    limit: caps.maxPages * 2,
    robotsSitemaps: robots.sitemaps,
  });
  for (const url of sitemapUrls) queue.add(url, 0, 'sitemap');
  log(`crawl plan: seed ${seed}, ${sitemapUrls.length} sitemap URLs`);

  const provider = new PlaywrightCaptureProvider();
  const usedSlugs = new Set();
  const pages = [];               // capture index entries
  const assetMap = new Map();     // url -> { altText, referencedBy: [] }
  let failed = 0;
  let duplicates = 0;
  let robotsSkipped = 0;
  let browserMs = 0;
  const capsHit = new Set();
  if (queue.hitDepthCap) capsHit.add('maxDepth');

  try {
    for (;;) {
      if (browserMs / 1000 >= caps.maxBrowserSeconds) {
        capsHit.add('maxBrowserSeconds');
        break;
      }
      const item = queue.next();
      if (!item) break;
      const verdict = robotsVerdict(robots, DEFAULT_USER_AGENT, new URL(item.url).pathname);
      if (!verdict.allowed && !override) {
        robotsSkipped += 1;
        continue;
      }
      const pageIdx = pages.length;
      const slug = pageSlug(item.url, usedSlugs);
      log(`capture [${pageIdx}] ${item.url} (depth ${item.depth})`);
      const started = Date.now();
      try {
        // screenshots map feeds the status UI's page gallery directly —
        // full-page shot URLs without having to download the capture JSON.
        const entry = { url: item.url, slug, depth: item.depth, viewports: {}, screenshots: {} };
        let duplicateOf = '';
        for (const label of ['desktop', 'tablet', 'mobile']) {
          const raw = await provider.capture(item.url, {
            viewport: VIEWPORTS[label],
            timeoutMs: caps.pageTimeoutMs,
            userAgent: DEFAULT_USER_AGENT,
          });
          // Redirect aliases only reveal themselves here, once the browser
          // has landed. Checked before any upload so a duplicate costs
          // nothing but the fetch.
          if (label === 'desktop') {
            const finalUrl = raw.finalUrl || item.url;
            if (!queue.claimCaptured(finalUrl)) {
              duplicateOf = finalUrl;
              break;
            }
          }
          // Upload screenshots, then persist the CaptureResult with Blob
          // URLs in place of binaries — element crops re-keyed by sourceId.
          const fullPageScreenshot = await uploadPng(job.id, `shots/${slug}.${label}.full.png`, raw.screenshots.fullPage);
          const sectionScreenshots = {};
          for (const s of raw.screenshots.sections) {
            sectionScreenshots[String(s.index)] = await uploadPng(job.id, `shots/${slug}.${label}.s${s.index}.png`, s.png);
          }
          const elementScreenshots = {};
          for (const e of raw.screenshots.elements) {
            const sourceId = computeSourceId(pageIdx, e.domPath);
            elementScreenshots[sourceId] = await uploadPng(job.id, `shots/${slug}.${label}.e${sourceId}.png`, e.png);
          }
          const captureResult = {
            url: raw.url,
            finalUrl: raw.finalUrl,
            viewport: raw.viewport,
            html: raw.html,
            styles: raw.styles,
            assetUrls: raw.assetUrls,
            fontFamilies: raw.fontFamilies,
            meta: raw.meta,
            fullPageScreenshot,
            sectionScreenshots,
            elementScreenshots,
          };
          entry.viewports[label] = await uploadJson(job.id, `capture/${slug}.${label}.json`, captureResult);
          entry.screenshots[label] = fullPageScreenshot;

          if (label === 'desktop') {
            for (const ref of raw.assetUrls) {
              const known = assetMap.get(ref.url) || { altText: '', referencedBy: [] };
              if (ref.alt && !known.altText) known.altText = ref.alt;
              known.referencedBy.push({ pageUrl: item.url, sourceId: '' });
              assetMap.set(ref.url, known);
            }
            for (const link of extractLinks(raw.html, raw.finalUrl || item.url)) {
              queue.add(link, item.depth + 1);
            }
          }
        }
        if (duplicateOf) {
          duplicates += 1;
          log(`  duplicate: redirects to ${duplicateOf}, already captured — skipped`);
        } else {
          pages.push(entry);
        }
      } catch (err) {
        failed += 1;
        log(`  FAILED: ${err.message}`);
      }
      browserMs += Date.now() - started;
      await sleep(POLITENESS_DELAY_MS);
    }
  } finally {
    await provider.close();
  }
  if (queue.hitPageCap) capsHit.add('maxPages');
  if (queue.hitDepthCap) capsHit.add('maxDepth');

  if (!pages.length) {
    throw new Error(`Capture produced no pages (${failed} failed, ${robotsSkipped} robots-skipped).`);
  }

  // Pending asset rows — one per unique URL, alt + page references attached.
  const assetRows = Array.from(assetMap.entries()).map(([url, info]) => ({
    jobId: job.id,
    projectId: job.projectId,
    originalUrl: url,
    altText: info.altText,
    referencedBy: info.referencedBy,
  }));
  must(await store.insertAssets(assetRows), 'insert asset rows');

  const index = {
    seed,
    pages,
    robotsSkipped,
    stats: { discovered: queue.discovered, captured: pages.length, failed, duplicates },
    capsHit: Array.from(capsHit),
  };
  const indexUrl = await uploadJson(job.id, 'capture/index.json', index);
  job = await setCheckpoint(job, 'capture', { blobPath: indexUrl, notes: `${pages.length} pages, ${failed} failed, ${robotsSkipped} robots-skipped` });
  job = must(await store.updateJob(job.id, {
    coverage: { ...(job.coverage || {}), pages: index.stats, caps: { hit: index.capsHit } },
    cost: {
      ...(job.cost || {}),
      browserSeconds: Math.round(browserMs / 1000),
      pagesCaptured: pages.length,
    },
  }), 'record capture stats');
  log(`capture done: ${pages.length} pages, ${duplicates} redirect-duplicate(s) skipped, ${assetRows.length} unique assets, ${Math.round(browserMs / 1000)} browser-seconds`);
  return job;
}

// ---------------------------------------------------------------------------
// Stage 2: assets
// ---------------------------------------------------------------------------

const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico',
  'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf',
};

function extFor(mime, url) {
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const m = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url);
  return m ? m[1].toLowerCase() : 'bin';
}

async function runAssetsStage(job) {
  const caps = job.caps;
  const assets = must(await store.listAssets(job.id), 'list assets');
  const pending = assets.filter((a) => a.status === 'pending');
  log(`assets: ${pending.length} pending of ${assets.length}`);

  let totalBytes = Number(job.cost.assetBytes || 0);
  const byHash = new Map(assets.filter((a) => a.contentHash).map((a) => [a.contentHash, a]));
  let downloaded = 0;
  let failed = 0;
  let skipped = 0;
  let hitTotalCap = false;

  for (const asset of pending) {
    if (hitTotalCap || totalBytes >= caps.maxTotalAssetBytes) {
      hitTotalCap = true;
      await store.updateAsset(asset.id, { status: 'skipped_cap', error: 'total asset byte budget reached' });
      skipped += 1;
      continue;
    }
    try {
      const res = await fetch(asset.originalUrl, {
        headers: { 'user-agent': DEFAULT_USER_AGENT },
        signal: AbortSignal.timeout(30000),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > caps.maxSingleAssetBytes) {
        await store.updateAsset(asset.id, {
          status: 'skipped_cap',
          error: `asset is ${buffer.length} bytes; single-asset cap is ${caps.maxSingleAssetBytes}`,
        });
        skipped += 1;
        continue;
      }
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const mime = String(res.headers.get('content-type') || '').split(';')[0].trim() || 'application/octet-stream';
      const existing = byHash.get(hash);
      let storageUrl;
      if (existing && existing.storageUrl) {
        storageUrl = existing.storageUrl; // dedupe: same bytes, same blob
      } else {
        storageUrl = (await uploadPngOrRaw(job.id, hash, mime, buffer, asset.originalUrl));
        totalBytes += buffer.length;
      }
      let width = null;
      let height = null;
      if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
        try {
          const sharp = require('sharp');
          const meta = await sharp(buffer).metadata();
          width = meta.width || null;
          height = meta.height || null;
        } catch { /* dimensions are nice-to-have */ }
      }
      const updated = must(await store.updateAsset(asset.id, {
        status: 'downloaded',
        storage_url: storageUrl,
        content_hash: hash,
        mime_type: mime,
        byte_size: buffer.length,
        width,
        height,
      }), `record asset ${asset.id}`);
      byHash.set(hash, updated);
      downloaded += 1;
    } catch (err) {
      // The failure ledger: recorded, never silently skipped (spec §1d).
      await store.updateAsset(asset.id, { status: 'failed', error: String(err.message || err).slice(0, 500) });
      failed += 1;
    }
    await sleep(150);
  }

  const capsHit = new Set((job.coverage.caps && job.coverage.caps.hit) || []);
  if (hitTotalCap) capsHit.add('maxTotalAssetBytes');
  if (skipped && !hitTotalCap) capsHit.add('maxSingleAssetBytes');
  job = await setCheckpoint(job, 'assets', { notes: `${downloaded} downloaded, ${failed} failed, ${skipped} cap-skipped` });
  job = must(await store.updateJob(job.id, {
    coverage: { ...(job.coverage || {}), caps: { hit: Array.from(capsHit) } },
    cost: { ...(job.cost || {}), assetBytes: totalBytes, assetsDownloaded: downloaded, assetsFailed: failed },
  }), 'record asset stats');
  log(`assets done: ${downloaded} downloaded, ${failed} failed, ${skipped} cap-skipped, ${totalBytes} bytes total`);
  return job;
}

async function uploadPngOrRaw(jobId, hash, mime, buffer, originalUrl) {
  const res = await uploadBufferToBlobAtPath({
    pathname: `SiteImport/${jobId}/assets/${hash}.${extFor(mime, originalUrl)}`,
    mimeType: mime,
    fileBuffer: buffer,
  });
  return must(res, `Blob upload asset ${originalUrl}`).location;
}

// ---------------------------------------------------------------------------
// Stage 3: normalize
// ---------------------------------------------------------------------------

async function runNormalizeStage(job) {
  const capture = job.checkpoints.capture;
  if (!capture || !capture.blobPath) {
    throw new Error('No capture checkpoint — run the capture stage first.');
  }
  const index = JSON.parse(await fetchText(capture.blobPath));
  const pages = [];
  for (const entry of index.pages) {
    const captures = {};
    for (const [label, url] of Object.entries(entry.viewports)) {
      captures[label] = JSON.parse(await fetchText(url));
    }
    if (captures.desktop) pages.push(captures);
  }
  const assets = must(await store.listAssets(job.id), 'list assets');
  const assetRefs = assets.map((a) => ({
    id: a.id,
    originalUrl: a.originalUrl,
    storageUrl: a.storageUrl,
    contentHash: a.contentHash,
    mimeType: a.mimeType,
    byteSize: a.byteSize,
    width: a.width,
    height: a.height,
    altText: a.altText,
    referencedBy: a.referencedBy,
    status: a.status,
    error: a.error,
  }));

  const { ir, coverage } = normalizeSite({
    jobId: job.id,
    sourceUrl: job.sourceUrl,
    capturedAt: job.startedAt || new Date().toISOString(),
    pages,
    assets: assetRefs,
    pageStats: index.stats,
    capsHit: (job.coverage.caps && job.coverage.caps.hit) || [],
  });

  const irUrl = await uploadJson(job.id, 'ir.json', ir);
  // Write the normalizer's referencedBy (keyed by real sourceIds) back to
  // the asset rows so the DB matches the IR.
  for (const assetIr of ir.assets) {
    if (Array.isArray(assetIr.referencedBy) && assetIr.referencedBy.length) {
      await store.updateAsset(assetIr.id, { referenced_by: assetIr.referencedBy });
    }
  }
  job = await setCheckpoint(job, 'normalize', { blobPath: irUrl, notes: `${ir.pages.length} pages normalized` });
  job = must(await store.updateJob(job.id, { coverage }), 'record coverage');

  const droppedClasses = Object.keys(coverage.dropped || {});
  if (droppedClasses.length) {
    // Spec §1c: any non-empty dropped is a bug — make it impossible to miss.
    log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    log(`!!! COVERAGE DROPPED CONTENT: ${JSON.stringify(coverage.dropped)}`);
    log('!!! This is a normalizer bug — the IR is missing content the');
    log('!!! capture saw. File it before trusting this import.');
    log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  } else {
    log(`normalize done: ${ir.pages.length} pages, dropped {} — coverage clean`);
  }
  return job;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const STAGES = [
  { name: 'capture', status: 'capturing', run: runCaptureStage },
  { name: 'assets', status: 'extracting', run: runAssetsStage },
  { name: 'normalize', status: 'normalizing', run: runNormalizeStage },
];

// CLI cap overrides win over the job row's caps for this run only —
// nothing is written back, so a later plain re-run uses the row's caps.
function applyCapsOverride(job, opts) {
  if (!opts.capsOverride || !Object.keys(opts.capsOverride).length) return job;
  return { ...job, caps: { ...job.caps, ...opts.capsOverride } };
}

async function runJob(jobId, opts) {
  let job = applyCapsOverride(must(await store.getJob(jobId), 'load job'), opts);
  if (!opts.stageOnly) {
    if (!opts.alreadyClaimed) {
      const claimed = await store.claimJob(jobId, CLAIMED_BY);
      if (!claimed.ok && claimed.status === 409) {
        log(`job ${jobId} is already claimed (${job.claimedBy || 'unknown'}) — use --reclaim-stale if it died`);
        return false;
      }
      job = must(claimed, 'claim job');
    }
    job = must(await store.updateJob(job.id, { started_at: new Date().toISOString(), error: '' }), 'mark started');
  }

  const stages = opts.stageOnly
    ? STAGES.filter((s) => s.name === opts.stageOnly)
    : STAGES;
  if (!stages.length) {
    throw new Error(`Unknown stage "${opts.stageOnly}". Stages: ${STAGES.map((s) => s.name).join(', ')}`);
  }

  try {
    for (const stage of stages) {
      job = applyCapsOverride(must(await store.getJob(job.id), 'refresh job'), opts);
      if (cancellationRequested(job)) {
        log(`job ${job.id}: cancellation requested — stopping before ${stage.name}`);
        must(await store.updateJob(job.id, {
          status: 'failed',
          error: 'Cancelled by operator',
          finished_at: new Date().toISOString(),
        }), 'mark cancelled');
        return false;
      }
      // applyCapsOverride again: updateJob's response re-normalizes caps
      // from the row, which silently discarded --caps overrides (found on
      // the 2026-08-06 scratch run: --caps maxPages=8 captured 42 pages).
      job = applyCapsOverride(must(await store.updateJob(job.id, { status: stage.status }), `enter ${stage.name}`), opts);
      log(`job ${job.id}: stage ${stage.name}`);
      job = await stage.run(job, opts);
    }
    if (!opts.stageOnly || opts.stageOnly === 'normalize') {
      job = must(await store.updateJob(job.id, {
        status: 'complete',
        finished_at: new Date().toISOString(),
      }), 'mark complete');
      log(`job ${job.id}: COMPLETE`);
    } else {
      log(`job ${job.id}: stage ${opts.stageOnly} done (job left in status ${job.status})`);
    }
    return true;
  } catch (err) {
    const message = String(err && err.message ? err.message : err).slice(0, 1000);
    log(`job ${jobId}: FAILED — ${message}`);
    await store.updateJob(jobId, {
      status: 'failed',
      error: message,
      finished_at: new Date().toISOString(),
    });
    return false;
  }
}

async function main() {
  log(`site-import worker starting (claimed_by ${CLAIMED_BY}, env: ${envSource})`);

  const reclaim = flagValue('--reclaim-stale');
  if (reclaim) {
    const freed = must(await store.reclaimStale(Number(reclaim)), 'reclaim stale');
    log(`reclaimed ${freed.length} stale claim(s):`, freed.map((j) => j.id).join(', ') || '(none)');
    return;
  }

  const capsOverride = {};
  const capsFlag = flagValue('--caps');
  if (capsFlag) {
    for (const pair of capsFlag.split(',')) {
      const [key, value] = pair.split('=');
      if (key && Number.isFinite(Number(value)) && Number(value) > 0) {
        capsOverride[key.trim()] = Math.floor(Number(value));
      } else {
        console.error(`--caps: cannot read "${pair}" — use k=v, e.g. maxBrowserSeconds=3600`);
        process.exit(1);
      }
    }
    log('caps override:', JSON.stringify(capsOverride));
  }

  const opts = {
    clientAuthorized: flagValue('--client-authorized'),
    stageOnly: flagValue('--stage'),
    capsOverride,
  };
  const jobId = flagValue('--job');

  if (opts.stageOnly && !jobId) {
    console.error('--stage needs --job <id>.');
    process.exit(1);
  }

  if (jobId) {
    const ok = await runJob(jobId, opts);
    process.exit(ok ? 0 : 1);
  }

  if (flag('--watch')) {
    log(`watching for queued jobs (poll every ${WATCH_IDLE_MS / 1000}s, Ctrl+C to stop)`);
    for (;;) {
      const claimed = must(await store.claimNextQueued(CLAIMED_BY), 'claim next');
      if (claimed) {
        await runJob(claimed.id, { ...opts, alreadyClaimed: true, stageOnly: null });
      } else {
        await sleep(WATCH_IDLE_MS);
      }
    }
  }

  console.error('Nothing to do. Pass --job <id>, --watch, or --reclaim-stale <minutes>.');
  process.exit(1);
}

main().catch((err) => {
  console.error('worker crashed:', err);
  process.exit(1);
});
