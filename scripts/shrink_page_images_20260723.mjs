#!/usr/bin/env node
'use strict';
/**
 * Shrink oversized page images — 2026-07-23.
 *
 * WHAT THIS DOES
 * The Marinoff site serves ~120 MB of AI-generated PNGs at 1024x1536 and
 * similar, displayed in columns a few hundred pixels wide. For every oversized
 * image that is actually placed on a page, this script:
 *   1. downloads the original,
 *   2. resizes it to fit inside a 400x600 box, preserving aspect ratio and
 *      never enlarging (a 1254x1254 square becomes 400x400, a 1672x941 wide
 *      image becomes 400x225 — nothing is cropped or squashed),
 *   3. uploads the result as a NEW asset named "<original>_<w>x<h>", and
 *   4. rewrites every reference on every Builder page from the old URL to the
 *      new one.
 *
 * The original asset row and file are left untouched, so reverting is a matter
 * of restoring the page rows from the backup this script writes.
 *
 * BATCHES  (--batch=, default "exact")
 *   exact  — only images that are exactly 1024x1536
 *   rest   — every other oversized content image
 *   logos  — images placed as a logo (header/footer marks). Separate because a
 *            400px-wide logo can look soft on high-resolution screens; review
 *            these before deciding.
 *   all    — all three
 *
 * SAFETY
 *  - Dry run by default; pass --apply to write.
 *  - A full JSON backup of every touched page row is written before any write.
 *  - Re-running is safe: an already-shrunk source (an asset whose generated
 *    twin exists and is already referenced) is skipped, and the URL swap is a
 *    no-op once no page still points at the original.
 *  - Images with transparency stay PNG; everything else becomes JPEG.
 *
 * Usage:
 *   node scripts/shrink_page_images_20260723.mjs --batch=exact
 *   node scripts/shrink_page_images_20260723.mjs --batch=exact --apply
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

const APPLY = process.argv.includes('--apply');
const BATCH = (process.argv.find((a) => a.startsWith('--batch=')) || '--batch=exact').split('=')[1];
const VALID_BATCHES = new Set(['exact', 'rest', 'logos', 'all']);
if (!VALID_BATCHES.has(BATCH)) {
  console.error(`--batch must be one of: ${Array.from(VALID_BATCHES).join(', ')}`);
  process.exit(1);
}

const PROJECT_ID = 'proj_1780601274760_97i84r'; // Marinoff & Associates
const OWNER_USER_ID = 'usr_1773098194686_wp7vz5';
const PAGES_TABLE = 'builder_landing_page';
const MAX_W = 400;
const MAX_H = 600;
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

// ---------------------------------------------------------------- env / db --

function loadEnv() {
  for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

// The live Marinoff data is in the cloud project; .env.local's active
// SUPABASE_URL points at the local dev stack. Repoint before loading any lib
// that reads these at require time.
if (!process.env.NEW_SUPABASE_URL || !process.env.NEW_SUPABASE_SERVICE_KEY) {
  console.error('Missing NEW_SUPABASE_URL / NEW_SUPABASE_SERVICE_KEY in .env.local');
  process.exit(1);
}
process.env.SUPABASE_URL = process.env.NEW_SUPABASE_URL;
process.env.SUPABASE_SERVICE_KEY = process.env.NEW_SUPABASE_SERVICE_KEY;

const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { urlKey } = require(path.join(ROOT, 'lib/assetUsage.js'));
const { uploadAssetFile } = require(path.join(ROOT, 'lib/assetStorage.js'));
const { generateThumbnailJpeg } = require(path.join(ROOT, 'lib/assetThumbnail.js'));
const { inferAspectFromDimensions } = require(path.join(ROOT, 'lib/assetAspect.js'));

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ------------------------------------------------------------ page walking --

const MEDIA_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i;
const EMBEDDED_URL_RE = /(?:src\s*=\s*["']|url\(\s*["']?)(https?:\/\/[^"')\s]+)/gi;

function looksLikeMediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) return false;
  if (!/^(?:https?:)?\/\//i.test(raw)) return false;
  return MEDIA_EXT_RE.test(raw.split(/[?#]/)[0]);
}

/** Collect `{ key, url, variant }` for every image reference on a page. */
function scanPage(doc) {
  const hits = [];
  const push = (value, variant) => {
    if (looksLikeMediaUrl(value)) hits.push({ key: urlKey(value), url: String(value).trim(), variant });
    const text = String(value || '');
    if (text.includes('://') && /[<(]/.test(text)) {
      for (const m of text.matchAll(EMBEDDED_URL_RE)) {
        if (looksLikeMediaUrl(m[1])) hits.push({ key: urlKey(m[1]), url: m[1], variant: 'html' });
      }
    }
  };
  const walk = (node, variant, depth = 0) => {
    if (node == null || depth > 12) return;
    if (typeof node === 'string') return push(node, variant);
    if (Array.isArray(node)) return node.forEach((v) => walk(v, variant, depth + 1));
    if (typeof node === 'object') for (const v of Object.values(node)) walk(v, variant, depth + 1);
  };

  for (const section of doc?.sections || []) {
    const { modules, ...shell } = section || {};
    walk(shell, 'background');
    for (const module of modules || []) {
      walk(module, String(module?.settings?.variant || module?.type || 'module'));
    }
  }
  walk(doc?.pageBackground, 'background');
  walk(doc?.theme, 'theme');
  return hits;
}

/** Rewrite every URL in `node` whose urlKey appears in `map` (key -> new URL). */
function rewrite(node, map, stats, depth = 0) {
  if (node == null || depth > 12) return node;

  if (typeof node === 'string') {
    if (looksLikeMediaUrl(node)) {
      const next = map.get(urlKey(node));
      if (next) { stats.swapped += 1; return next; }
      return node;
    }
    if (node.includes('://') && /[<(]/.test(node)) {
      return node.replace(EMBEDDED_URL_RE, (whole, url) => {
        const next = map.get(urlKey(url));
        if (!next) return whole;
        stats.swapped += 1;
        return whole.replace(url, next);
      });
    }
    return node;
  }

  if (Array.isArray(node)) return node.map((v) => rewrite(v, map, stats, depth + 1));

  if (typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = rewrite(v, map, stats, depth + 1);
    return out;
  }

  return node;
}

// ------------------------------------------------------------------ resize --

async function shrink(buffer) {
  const image = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await image.metadata();
  const pipeline = image.resize({
    width: MAX_W,
    height: MAX_H,
    fit: 'inside',
    withoutEnlargement: true,
  });
  // Flattening a transparent image onto JPEG would paint a black box behind it,
  // so anything with an alpha channel stays PNG.
  const out = meta.hasAlpha
    ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer({ resolveWithObject: true })
    : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return {
    buffer: out.data,
    width: out.info.width,
    height: out.info.height,
    mimeType: meta.hasAlpha ? 'image/png' : 'image/jpeg',
    ext: meta.hasAlpha ? '.png' : '.jpg',
  };
}

// -------------------------------------------------------------------- main --

const fmtMB = (n) => `${(n / 1048576).toFixed(2)} MB`;
const fmtKB = (n) => `${(n / 1024).toFixed(0)} KB`;

const [{ data: assets, error: assetErr }, { data: pageRows, error: pageErr }] = await Promise.all([
  sb.from('assets').select('*').eq('project_id', PROJECT_ID).limit(5000),
  sb.from('builder_landing_page').select('id,slug,name,layout_sections').eq('project_id', PROJECT_ID),
]);
if (assetErr) { console.error(assetErr.message); process.exit(1); }
if (pageErr) { console.error(pageErr.message); process.exit(1); }

const readDoc = (row) => (typeof row.layout_sections === 'string'
  ? JSON.parse(row.layout_sections)
  : row.layout_sections) || {};

// url key -> { pages: Set<slug>, variants: Set<string> }
const usage = new Map();
for (const row of pageRows) {
  for (const hit of scanPage(readDoc(row))) {
    if (!usage.has(hit.key)) usage.set(hit.key, { pages: new Set(), variants: new Set() });
    usage.get(hit.key).pages.add(row.slug || String(row.id));
    usage.get(hit.key).variants.add(hit.variant);
  }
}

const assetByKey = new Map();
for (const a of assets) {
  const key = urlKey(a.location);
  if (key && !assetByKey.has(key)) assetByKey.set(key, a);
}
const assetNames = new Set(assets.map((a) => String(a.asset_name || '')));

// ---- classify ---------------------------------------------------------------

function classify(asset, use) {
  const w = Number(asset.image_width || 0) || 0;
  const h = Number(asset.image_height || 0) || 0;
  if (String(asset.asset_type || '') !== 'Image') return null;
  if (!w || !h) return null;                        // unknown dimensions — leave alone
  if (w <= MAX_W && h <= MAX_H) return null;        // already small enough
  const variants = use.variants;
  const isLogo = variants.has('logo')
    || /logo/i.test(String(asset.asset_name || ''))
    || /logo/i.test(String(asset.category || ''));
  if (isLogo) return 'logos';
  return (w === 1024 && h === 1536) ? 'exact' : 'rest';
}

const targets = [];
for (const [key, use] of usage) {
  const asset = assetByKey.get(key);
  if (!asset) continue;
  const batch = classify(asset, use);
  if (!batch) continue;
  if (BATCH !== 'all' && batch !== BATCH) continue;
  targets.push({ key, asset, use, batch });
}
targets.sort((a, b) => b.use.pages.size - a.use.pages.size);

if (!targets.length) {
  console.log(`Nothing to do for batch "${BATCH}".`);
  process.exit(0);
}

const originalBytes = targets.reduce((sum, t) => sum + (Number(t.asset.size) || 0), 0);
console.log(`Batch "${BATCH}": ${targets.length} image(s) across ${pageRows.length} pages, ${fmtMB(originalBytes)} of originals.\n`);
for (const t of targets) {
  console.log(
    `  ${String(t.asset.image_width)}x${String(t.asset.image_height)}`.padEnd(14),
    fmtMB(Number(t.asset.size) || 0).padStart(9),
    `${t.use.pages.size} page(s)`.padStart(11),
    ' ',
    String(t.asset.asset_name || '').slice(0, 60)
  );
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing downloaded, uploaded or written. Re-run with --apply.');
  process.exit(0);
}

// ---- resize + upload --------------------------------------------------------

console.log('\nResizing…');
const swapMap = new Map(); // old url key -> new url
let newBytes = 0;

for (const t of targets) {
  const name = String(t.asset.asset_name || `asset_${t.asset.id}`);
  const label = name.slice(0, 46).padEnd(46);
  try {
    const res = await fetch(t.asset.location);
    if (!res.ok) { console.log(`  ${label} FETCH FAILED (${res.status})`); continue; }
    const source = Buffer.from(await res.arrayBuffer());
    const small = await shrink(source);

    const extMatch = name.match(/(\.[^.]+)$/);
    const nameBase = extMatch ? name.slice(0, -extMatch[1].length) : name;
    const newAssetName = `${nameBase}_${small.width}x${small.height}`;

    // Re-run guard: if this script already made this asset, reuse it.
    const existing = assets.find((a) => String(a.asset_name || '') === newAssetName && a.location);
    if (existing) {
      swapMap.set(t.key, existing.location);
      newBytes += Number(existing.size) || 0;
      console.log(`  ${label} reuse existing ${small.width}x${small.height}`);
      continue;
    }

    const safeBase = nameBase.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100)
      || `asset_${t.asset.id}`;
    const fileName = `${safeBase}_${small.width}x${small.height}${small.ext}`;

    const upload = await uploadAssetFile({
      assetType: 'Image',
      category: String(t.asset.category || '').trim(),
      fileName,
      mimeType: small.mimeType,
      fileBase64: small.buffer.toString('base64'),
      makePublic: true,
    });
    if (!upload.ok) { console.log(`  ${label} UPLOAD FAILED: ${upload.error}`); continue; }

    const row = {
      asset_name: newAssetName,
      asset_type: 'Image',
      category: String(t.asset.category || '').trim(),
      tags: Array.isArray(t.asset.tags) ? t.asset.tags : [],
      topic: String(t.asset.topic || '').trim(),
      caption: t.asset.caption || null,
      comments: String(t.asset.comments || '').trim(),
      location: String(upload.data.location || '').trim(),
      size: Math.max(0, Number(upload.data.sizeBytes || small.buffer.length) || 0),
      image_width: small.width,
      image_height: small.height,
      aspect: inferAspectFromDimensions(small.width, small.height),
      project_id: PROJECT_ID,
      owner_user_id: OWNER_USER_ID,
    };

    const thumb = await generateThumbnailJpeg(small.buffer, { mimeType: small.mimeType });
    if (thumb.ok) {
      const thumbUpload = await uploadAssetFile({
        assetType: 'Image',
        category: 'Asset Thumbnail',
        fileName: `${safeBase}_${small.width}x${small.height}_thumb.jpg`,
        mimeType: 'image/jpeg',
        fileBase64: thumb.data.buffer.toString('base64'),
        makePublic: true,
      });
      if (thumbUpload.ok) {
        row.thumbnail_location = String(thumbUpload.data.location || '').trim();
        row.thumbnail_width = thumb.data.width || null;
        row.thumbnail_height = thumb.data.height || null;
        row.thumbnail_size = thumb.data.buffer.length;
        row.thumbnail_generated_at = new Date().toISOString();
      }
    }

    const { data: created, error: createErr } = await sb.from('assets').insert(row).select().single();
    if (createErr) { console.log(`  ${label} DB INSERT FAILED: ${createErr.message}`); continue; }

    assets.push(created);
    assetNames.add(newAssetName);
    swapMap.set(t.key, created.location);
    newBytes += row.size;
    const saved = 100 - Math.round((row.size / Math.max(1, Number(t.asset.size) || 1)) * 100);
    console.log(`  ${label} ${small.width}x${small.height} ${fmtKB(row.size).padStart(8)} (-${saved}%)`);
  } catch (err) {
    console.log(`  ${label} ERROR: ${err.message}`);
  }
}

if (!swapMap.size) { console.log('\nNo new images were produced — nothing to swap.'); process.exit(1); }
console.log(`\n${swapMap.size} image(s) resized: ${fmtMB(originalBytes)} → ${fmtMB(newBytes)}`);

// ---- rewrite pages ----------------------------------------------------------

const touched = [];
for (const row of pageRows) {
  const doc = readDoc(row);
  const stats = { swapped: 0 };
  const next = rewrite(doc, swapMap, stats);
  if (stats.swapped) touched.push({ row, next, swapped: stats.swapped });
}

if (!touched.length) { console.log('\nNo page still referenced these images — nothing to rewrite.'); process.exit(0); }

mkdirSync(BACKUP_DIR, { recursive: true });
const backupFile = path.join(
  BACKUP_DIR,
  `shrink_page_images_${BATCH}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);
writeFileSync(backupFile, JSON.stringify({
  savedAt: new Date().toISOString(),
  batch: BATCH,
  swaps: Array.from(swapMap.entries()),
  pages: touched.map((t) => ({ id: t.row.id, slug: t.row.slug, layout_sections: t.row.layout_sections })),
}, null, 2));
console.log(`\nBackup written: ${path.relative(ROOT, backupFile)}\n`);

let written = 0;
for (const t of touched) {
  const { error } = await sb
    .from(PAGES_TABLE)
    .update({ layout_sections: t.next, updated_at: new Date().toISOString() })
    .eq('id', t.row.id);
  if (error) { console.log(`  /${t.row.slug} FAILED: ${error.message}`); continue; }
  written += 1;
  console.log(`  /${String(t.row.slug || t.row.id).padEnd(34)} ${t.swapped} reference(s) swapped`);
}

console.log(`\nDone. ${written} of ${touched.length} page(s) updated.`);
console.log(`Rollback: restore layout_sections for those pages from ${path.relative(ROOT, backupFile)}`);
