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
 *   2. resizes it to fit inside the --max box, preserving aspect ratio and
 *      never enlarging (at 400x600, a 1254x1254 square becomes 400x400 and a
 *      1672x941 wide image becomes 400x225 — nothing is cropped or squashed),
 *   3. uploads the result as a NEW asset named "<original>_<w>x<h>", and
 *   4. rewrites every reference on every Builder page from the old URL to the
 *      new one.
 *
 * Re-running at a different --max resizes from the ORIGINAL, not from whatever
 * copy the pages currently point at, so raising the size after a run that came
 * out too soft recovers the real detail instead of upscaling a small copy.
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
 * SIZING
 *   --max=WxH            fit every image inside one fixed box.
 *   --long=L --short=S   orientation-aware: cap the long edge at L and the
 *                        short edge at S, so portraits come out SxL and
 *                        landscapes LxS. Use this for a mixed sweep — a fixed
 *                        640x960 box shrinks a wide 1672x941 banner to 640x360.
 *   --over=N             skip anything whose longest edge is already <= N.
 *
 * Usage:
 *   node scripts/shrink_page_images_20260723.mjs --batch=exact
 *   node scripts/shrink_page_images_20260723.mjs --batch=exact --max=640x960 --apply
 *   node scripts/shrink_page_images_20260723.mjs --batch=all --long=960 --short=640 --over=1000 --apply
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

// Sizing comes in two flavours:
//
//   --max=WxH          a fixed box every image is fitted inside.
//   --long=L --short=S an ORIENTATION-AWARE box: the long edge of the image is
//                      capped at L and the short edge at S, so a portrait gets
//                      SxL and a landscape LxS. A fixed box cannot do this — a
//                      640x960 box shrinks a wide 1672x941 banner to 640x360,
//                      because the width binds on the wrong edge.
const LONG_ARG = process.argv.find((a) => a.startsWith('--long='));
const SHORT_ARG = process.argv.find((a) => a.startsWith('--short='));
const ORIENTED = Boolean(LONG_ARG || SHORT_ARG);
if (ORIENTED && !(LONG_ARG && SHORT_ARG)) {
  console.error('--long and --short must be given together');
  process.exit(1);
}
const LONG_EDGE = Number(String(LONG_ARG || '').split('=')[1]) || 0;
const SHORT_EDGE = Number(String(SHORT_ARG || '').split('=')[1]) || 0;
if (ORIENTED && (!LONG_EDGE || !SHORT_EDGE || SHORT_EDGE > LONG_EDGE)) {
  console.error('--long and --short must be positive, with --short no larger than --long');
  process.exit(1);
}

const MAX_ARG = (process.argv.find((a) => a.startsWith('--max=')) || '--max=400x600').split('=')[1];
const MAX_MATCH = String(MAX_ARG).match(/^(\d+)x(\d+)$/);
if (!MAX_MATCH) {
  console.error('--max must look like 400x600');
  process.exit(1);
}
const MAX_W = Number(MAX_MATCH[1]);
const MAX_H = Number(MAX_MATCH[2]);

// Only bother with images whose longest edge exceeds this. Keeps the sweep off
// images that are already a sensible size for the web.
const OVER = Number(String((process.argv.find((a) => a.startsWith('--over=')) || '--over=0')).split('=')[1]) || 0;

/** The fit-inside box for one image, which depends on its shape when oriented. */
function boxFor(width, height) {
  if (!ORIENTED) return { w: MAX_W, h: MAX_H };
  return width >= height
    ? { w: LONG_EDGE, h: SHORT_EDGE }
    : { w: SHORT_EDGE, h: LONG_EDGE };
}

function describeBox() {
  return ORIENTED
    ? `long edge ${LONG_EDGE}, short edge ${SHORT_EDGE}`
    : `${MAX_W}x${MAX_H}`;
}

const PROJECT_ID = 'proj_1780601274760_97i84r'; // Marinoff & Associates
const OWNER_USER_ID = 'usr_1773098194686_wp7vz5';
const PAGES_TABLE = 'builder_landing_page';
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
  // .rotate() applies EXIF orientation, so the box must be chosen from the
  // dimensions as they will actually come out, not as stored.
  const upright = (meta.orientation || 0) >= 5
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
  const box = boxFor(upright.width || 0, upright.height || 0);
  const pipeline = image.resize({
    width: box.w,
    height: box.h,
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

// ---- resolve generated copies back to their original ------------------------

/** Asset name with any trailing file extension removed. */
const strippedName = (asset) => {
  const name = String(asset?.asset_name || '');
  const ext = name.match(/(\.[^.]+)$/);
  return ext ? name.slice(0, -ext[1].length) : name;
};

// Generated copies drop the extension from the base ("Foo.png" -> "Foo_400x600"),
// so parents must be looked up on the stripped name. Where several rows share a
// stripped name, keep the largest — that is the one worth resizing from.
const assetByStrippedName = new Map();
for (const a of assets) {
  const key = strippedName(a);
  if (!key) continue;
  const held = assetByStrippedName.get(key);
  const area = (Number(a.image_width) || 0) * (Number(a.image_height) || 0);
  const heldArea = held ? (Number(held.image_width) || 0) * (Number(held.image_height) || 0) : -1;
  if (!held || area > heldArea) assetByStrippedName.set(key, a);
}

/**
 * A previous run of this script names its output "<original>_<w>x<h>". If the
 * page currently points at one of those copies, resizing IT again would upscale
 * an already-downscaled image; walk back to the largest ancestor and resize
 * from that instead. Only treated as a copy when the parent actually exists and
 * is genuinely bigger, so an original that merely has dimensions in its name
 * (e.g. "Testimonial_Anonymous_1024x1536") is left alone.
 */
function resolveOriginal(asset) {
  let current = asset;
  const seen = new Set([String(current.id)]);
  for (let hop = 0; hop < 4; hop += 1) {
    const match = strippedName(current).match(/^(.*)_(\d+)x(\d+)$/);
    if (!match) break;
    const parent = assetByStrippedName.get(match[1]);
    if (!parent || seen.has(String(parent.id))) break;
    const pw = Number(parent.image_width || 0) || 0;
    const ph = Number(parent.image_height || 0) || 0;
    const cw = Number(current.image_width || 0) || 0;
    const ch = Number(current.image_height || 0) || 0;
    if (!(pw > cw || ph > ch)) break;
    seen.add(String(parent.id));
    current = parent;
  }
  return current;
}

/** What sharp's fit:inside/withoutEnlargement will produce for these inputs. */
function fittedSize(w, h) {
  const box = boxFor(w, h);
  const scale = Math.min(box.w / w, box.h / h, 1);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

// ---- classify ---------------------------------------------------------------

function classify(source, referenced, use) {
  const w = Number(source.image_width || 0) || 0;
  const h = Number(source.image_height || 0) || 0;
  if (String(source.asset_type || '') !== 'Image') return null;
  if (!w || !h) return null;                        // unknown dimensions — leave alone

  const refW = Number(referenced.image_width || 0) || 0;
  const refH = Number(referenced.image_height || 0) || 0;

  // The threshold is about page weight, so it applies to what the page ACTUALLY
  // serves today. An oversized original whose pages already point at a small
  // copy is costing nothing, and re-resizing it would only lose quality.
  const servedLongEdge = Math.max(refW || w, refH || h);
  if (OVER && servedLongEdge <= OVER) return null;

  const want = fittedSize(w, h);
  if (want.width === w && want.height === h) return null;  // nothing to shrink
  if (refW === want.width && refH === want.height) return null;  // already serving this

  const isLogo = use.variants.has('logo')
    || /logo/i.test(String(source.asset_name || ''))
    || /logo/i.test(String(source.category || ''));
  if (isLogo) return 'logos';
  return (w === 1024 && h === 1536) ? 'exact' : 'rest';
}

const targets = [];
for (const [key, use] of usage) {
  const referenced = assetByKey.get(key);
  if (!referenced) continue;
  const source = resolveOriginal(referenced);
  const batch = classify(source, referenced, use);
  if (!batch) continue;
  if (BATCH !== 'all' && batch !== BATCH) continue;
  targets.push({ key, asset: source, referenced, use, batch });
}
targets.sort((a, b) => b.use.pages.size - a.use.pages.size);

if (!targets.length) {
  console.log(`Nothing to do for batch "${BATCH}".`);
  process.exit(0);
}

// "Currently served" is what the pages point at today, which is not the source
// file when an earlier run already swapped in a smaller copy.
const currentBytes = targets.reduce((sum, t) => sum + (Number(t.referenced.size) || 0), 0);
console.log(`Batch "${BATCH}" → fit inside ${describeBox()}${OVER ? `, only images over ${OVER}px` : ''}: ${targets.length} image(s) across ${pageRows.length} pages, ${fmtMB(currentBytes)} currently served.\n`);
for (const t of targets) {
  const source = `${t.asset.image_width}x${t.asset.image_height}`;
  const serving = `${t.referenced.image_width}x${t.referenced.image_height}`;
  const want = fittedSize(Number(t.asset.image_width), Number(t.asset.image_height));
  const from = serving === source ? source : `${serving} (from ${source})`;
  console.log(
    ` ${from} → ${want.width}x${want.height}`.padEnd(34),
    fmtMB(Number(t.referenced.size) || 0).padStart(9),
    `${t.use.pages.size} page(s)`.padStart(11),
    ' ',
    String(t.asset.asset_name || '').slice(0, 52)
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
    // Raising --max after an earlier, smaller run legitimately grows the file,
    // so report the delta with its own sign rather than always as a saving.
    const delta = 100 - Math.round((row.size / Math.max(1, Number(t.referenced.size) || 1)) * 100);
    const change = delta >= 0 ? `-${delta}%` : `+${-delta}%`;
    console.log(`  ${label} ${small.width}x${small.height} ${fmtKB(row.size).padStart(8)} (${change} vs served)`);
  } catch (err) {
    console.log(`  ${label} ERROR: ${err.message}`);
  }
}

if (!swapMap.size) { console.log('\nNo new images were produced — nothing to swap.'); process.exit(1); }
console.log(`\n${swapMap.size} image(s) resized: ${fmtMB(currentBytes)} → ${fmtMB(newBytes)}`);

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
