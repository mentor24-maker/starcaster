#!/usr/bin/env node
'use strict';

/**
 * Bring a site's images off somebody else's server and into this library.
 *
 * WHY THIS EXISTS
 * The Delray Beach Tennis Center pages were imported without their images: 98
 * pages still pointed at www.delraytennis.com for 242 distinct files, 2,083
 * references in total. Two problems with that. The pages stay as heavy as the
 * old site made them — nothing here can offer a smaller copy of a file we do
 * not hold — and the new site silently depends on the old one staying online.
 * The day that domain lapses, a third of the home page turns into broken icons.
 *
 * WHAT IT DOES, per distinct image file:
 *   1. downloads it from the old host, preferring the unresized original,
 *   2. uploads it into this project's own storage,
 *   3. creates an asset row with the real dimensions and byte size,
 *   4. builds the scaled-down copies (the same ladder as everywhere else),
 *   5. rewrites every reference on every page to the new address.
 *
 * WordPress serves the same picture at many widths via `?w=`. Those are all one
 * file here: the largest available is fetched once, and every `?w=` variant of
 * it is rewritten to the new copy.
 *
 * SAFETY
 *  - Dry run by default; --apply writes.
 *  - A full JSON backup of every touched page row is written before any write.
 *  - Re-runnable: a URL already imported is detected by its recorded source and
 *    skipped, and rewriting is a no-op once no page points at the old host.
 *  - Assets are created first and pages rewritten second, so a failure part way
 *    leaves pages pointing at images that still work.
 *
 * Usage:
 *   node scripts/import_external_page_images.js --project=proj_… --host=delraytennis.com
 *   node scripts/import_external_page_images.js --project=proj_… --host=delraytennis.com --apply
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
const { createAsset, updateAsset, rowToAsset } = require('../lib/assetsStore');
const { uploadAssetFile, isConfigured: isStorageConfigured } = require('../lib/assetStorage');
const { buildRenditionPatchForAsset } = require('../lib/assetRenditions');

const BACKUP_DIR = path.join(__dirname, '..', 'docs', 'SQL', 'backups');

// Tracking pixels and spacers are not pictures anyone chose to put on a page;
// importing them would only preserve someone else's analytics beacon.
const IGNORED_HOSTS = /(^|\.)pixel\.wp\.com$|(^|\.)stats\.wp\.com$/i;
const IMAGE_URL_RE = /https?:\/\/[^"'\\ )]+\.(?:png|jpe?g|webp|gif)(?:\?[^"'\\ )]*)?/gi;

function arg(name, fallback = '') {
  const found = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function describeTarget() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  if (!url) return 'no SUPABASE_URL set';
  return `${url} ${/localhost|127\.0\.0\.1/.test(url) ? '(LOCAL database)' : '(CLOUD — the live site)'}`;
}

function kb(bytes) {
  return `${Math.round((Number(bytes) || 0) / 1024)} KB`;
}

function mb(bytes) {
  return `${((Number(bytes) || 0) / 1048576).toFixed(1)} MB`;
}

/** The identity of a picture, ignoring the width query WordPress appends. */
function fileKey(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

function cleanFileName(url) {
  const base = decodeURIComponent(fileKey(url).split('/').pop() || 'image');
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'image';
}

function assetNameFor(url) {
  return cleanFileName(url).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 120) || 'Imported image';
}

function mimeFromName(name) {
  const ext = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/** Every image URL on the target host, grouped into one entry per real file. */
function collectExternalImages(pageRows, host) {
  const hostRe = new RegExp(`(^|\\.)${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const files = new Map();

  for (const row of pageRows) {
    const json = JSON.stringify(row);
    for (const raw of json.match(IMAGE_URL_RE) || []) {
      let parsed;
      try {
        parsed = new URL(raw);
      } catch {
        continue;
      }
      if (!hostRe.test(parsed.hostname) || IGNORED_HOSTS.test(parsed.hostname)) continue;

      const key = fileKey(raw);
      const entry = files.get(key) || { key, variants: new Set(), pages: new Set(), refs: 0 };
      entry.variants.add(raw);
      entry.pages.add(row.slug || row.id);
      entry.refs += 1;
      files.set(key, entry);
    }
  }
  return [...files.values()];
}

/**
 * Fetch the best version available. The bare path is WordPress's original; the
 * widest `?w=` is the fallback when the original 404s or is blocked.
 */
async function downloadBest(entry) {
  const widest = [...entry.variants].sort((a, b) => {
    const w = (u) => Number(new URL(u).searchParams.get('w') || 0);
    return w(b) - w(a);
  });
  const candidates = [entry.key, ...widest];

  let lastError = 'no candidate URL worked';
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { accept: 'image/*,*/*;q=0.8' } });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      if (type.startsWith('text/') || type.includes('json')) {
        lastError = 'the server returned a page, not an image';
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) {
        lastError = 'empty response';
        continue;
      }
      return { ok: true, buffer, sourceUrl: url, contentType: type };
    } catch (err) {
      lastError = err.message || 'request failed';
    }
  }
  return { ok: false, error: lastError };
}

/** Swap every known old URL for its new one, anywhere in the page document. */
function rewriteValue(node, swaps, stats, depth = 0) {
  if (node == null || depth > 14) return node;

  if (typeof node === 'string') {
    let next = node;
    for (const [oldUrl, newUrl] of swaps) {
      if (next.includes(oldUrl)) {
        next = next.split(oldUrl).join(newUrl);
        stats.swapped += 1;
      }
    }
    return next;
  }

  if (Array.isArray(node)) return node.map((v) => rewriteValue(v, swaps, stats, depth + 1));

  if (typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = rewriteValue(v, swaps, stats, depth + 1);
    return out;
  }

  return node;
}

async function run() {
  const projectId = arg('--project');
  const host = arg('--host');
  const apply = process.argv.includes('--apply');
  const limit = Number(arg('--limit', '0')) || 0;

  if (!projectId || !host) {
    console.error('Usage: node scripts/import_external_page_images.js --project=<projectId> --host=<domain> [--apply]');
    process.exitCode = 1;
    return;
  }

  console.log(`[import] database: ${describeTarget()}`);
  console.log(`[import] project ${projectId}, pulling images off ${host}`);

  if (apply && !isStorageConfigured()) {
    console.error('[import] File storage is not configured — nothing could be saved.');
    process.exitCode = 1;
    return;
  }

  const pagesRes = await sbQuery({
    table: tableConfig().builderPages,
    query: `select=*&project_id=eq.${encodeURIComponent(projectId)}&limit=1000`,
  });
  if (!pagesRes.ok) {
    console.error('[import] Could not load pages:', pagesRes.error);
    process.exitCode = 1;
    return;
  }
  const pageRows = Array.isArray(pagesRes.data) ? pagesRes.data : [];

  // Anything already imported carries its origin in `comments`, so a re-run
  // recognises it instead of uploading a second copy.
  const existingRes = await sbQuery({
    table: tableConfig().assets,
    query:
      `select=id,location,comments&asset_type=eq.Image` +
      `&project_id=eq.${encodeURIComponent(projectId)}&limit=5000`,
  });
  const alreadyImported = new Map();
  for (const row of (existingRes.ok && existingRes.data) || []) {
    const match = String(row.comments || '').match(/Imported from (\S+)/);
    if (match) alreadyImported.set(fileKey(match[1]), row.location);
  }

  let files = collectExternalImages(pageRows, host);
  const totalRefs = files.reduce((sum, f) => sum + f.refs, 0);
  const pending = files.filter((f) => !alreadyImported.has(f.key));
  if (limit) files = pending.slice(0, limit);
  else files = pending;

  console.log(
    `[import] mode=${apply ? 'APPLY' : 'DRY RUN'} pages=${pageRows.length} ` +
      `files=${pending.length + alreadyImported.size} references=${totalRefs} ` +
      `already imported=${alreadyImported.size} to do=${files.length}`
  );

  if (!apply) {
    for (const f of files.slice(0, 20)) {
      console.log(`[import] would import ${f.refs} ref(s) on ${f.pages.size} page(s)  ${f.key.split('/').pop()}`);
    }
    if (files.length > 20) console.log(`[import] …and ${files.length - 20} more`);
    console.log('[import] Nothing was changed. Add --apply to import them.');
    return;
  }

  const swaps = new Map();
  for (const [key, location] of alreadyImported) swaps.set(key, location);

  let imported = 0;
  let failed = 0;
  let originalBytes = 0;
  const failures = [];

  for (const entry of files) {
    const label = entry.key.split('/').pop().slice(0, 44);
    const media = await downloadBest(entry);
    if (!media.ok) {
      failed += 1;
      failures.push({ url: entry.key, error: media.error, pages: entry.pages.size });
      console.error(`[import] FAIL ${label}: ${media.error}`);
      continue;
    }

    const fileName = cleanFileName(entry.key);
    const mimeType = media.contentType.startsWith('image/') ? media.contentType : mimeFromName(fileName);

    const upload = await uploadAssetFile({
      assetType: 'Image',
      category: 'Site Import',
      // uploadAssetFile already prefixes a timestamp; adding another gives
      // every file a doubled one that lives in the URL forever.
      fileName,
      mimeType,
      fileBase64: media.buffer.toString('base64'),
      makePublic: true,
    });
    if (!upload.ok) {
      failed += 1;
      failures.push({ url: entry.key, error: upload.error, pages: entry.pages.size });
      console.error(`[import] FAIL ${label}: upload — ${upload.error}`);
      continue;
    }

    const created = await createAsset(
      {
        assetName: assetNameFor(entry.key),
        assetType: 'Image',
        category: 'Site Import',
        location: String(upload.data.location || '').trim(),
        size: media.buffer.length,
        // Recorded so this image can never be mistaken for one nobody measured.
        comments: `Imported from ${media.sourceUrl}`,
        tags: [],
      },
      { projectId }
    );
    if (!created.ok) {
      failed += 1;
      failures.push({ url: entry.key, error: created.error, pages: entry.pages.size });
      console.error(`[import] FAIL ${label}: database — ${created.error}`);
      continue;
    }

    const createdRow = Array.isArray(created.data) ? created.data[0] : created.data;
    const asset = rowToAsset(createdRow);

    // Same ladder as every other image in the library. A failure here costs the
    // smaller copies, not the import — the picture is already safely ours.
    const built = await buildRenditionPatchForAsset(asset, media.buffer);
    let copiesNote = 'no copies needed';
    if (built.ok) {
      await updateAsset(asset.id, built.patch, { projectId });
      copiesNote = built.built ? `${built.renditions.length} copies` : 'no copies needed';
    } else {
      copiesNote = `copies failed: ${built.error}`;
    }

    swaps.set(entry.key, asset.location);
    imported += 1;
    originalBytes += media.buffer.length;
    console.log(`[import] OK ${label} — ${kb(media.buffer.length)}, ${copiesNote}, ${entry.refs} ref(s)`);
  }

  if (!swaps.size) {
    console.log('[import] Nothing was imported, so no page was changed.');
    process.exitCode = failed ? 2 : 0;
    return;
  }

  // Rewrite by full URL including every ?w= variant, so no reference is missed.
  const urlSwaps = [];
  for (const entry of collectExternalImages(pageRows, host)) {
    const replacement = swaps.get(entry.key);
    if (!replacement) continue;
    for (const variant of entry.variants) urlSwaps.push([variant, replacement]);
  }
  // Longest first: a bare URL is a prefix of its own ?w= variants, and replacing
  // the short one first would leave a dangling "?w=1024" on the new address.
  urlSwaps.sort((a, b) => b[0].length - a[0].length);

  const touched = [];
  for (const row of pageRows) {
    const stats = { swapped: 0 };
    const next = rewriteValue(row.layout_sections, urlSwaps, stats);
    if (stats.swapped) touched.push({ row, next, swapped: stats.swapped });
  }

  if (!touched.length) {
    console.log(`[import] ${imported} image(s) imported; no page still referenced them.`);
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(
    BACKUP_DIR,
    `import_external_page_images_${host.replace(/[^a-z0-9]+/gi, '_')}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(
    backupFile,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        projectId,
        host,
        swaps: urlSwaps,
        pages: touched.map((t) => ({ id: t.row.id, slug: t.row.slug, layout_sections: t.row.layout_sections })),
      },
      null,
      2
    )
  );
  console.log(`[import] backup written: ${path.relative(path.join(__dirname, '..'), backupFile)}`);

  let written = 0;
  for (const t of touched) {
    const res = await sbQuery({
      method: 'PATCH',
      table: tableConfig().builderPages,
      query: `id=eq.${encodeURIComponent(t.row.id)}`,
      body: { layout_sections: t.next, updated_at: new Date().toISOString() },
    });
    if (!res.ok) {
      console.error(`[import] page /${t.row.slug || t.row.id} FAILED: ${res.error}`);
      continue;
    }
    written += 1;
  }

  console.log('');
  console.log(`[import] done. ${imported} image(s) imported (${mb(originalBytes)}), ${failed} failed.`);
  console.log(`[import] ${written} of ${touched.length} page(s) rewritten to the new addresses.`);
  if (failures.length) {
    console.log('');
    console.log('[import] could not be fetched — these stay pointing at the old site:');
    for (const f of failures.slice(0, 15)) {
      console.log(`   ${f.error.padEnd(28)} ${f.pages} page(s)  ${f.url.split('/').pop()}`);
    }
  }
  console.log(`[import] rollback: restore layout_sections from ${path.basename(backupFile)}`);
  if (failed) process.exitCode = 2;
}

run().catch((err) => {
  console.error('[import] fatal:', err?.message || err);
  process.exitCode = 1;
});
