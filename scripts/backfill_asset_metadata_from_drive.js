#!/usr/bin/env node
'use strict';

/**
 * Backfill asset metadata (size + image dimensions) from Google Drive links.
 *
 * Default mode is dry-run.
 *
 * Usage:
 *   node scripts/backfill_asset_metadata_from_drive.js
 *   node scripts/backfill_asset_metadata_from_drive.js --apply
 *   node scripts/backfill_asset_metadata_from_drive.js --apply --limit=100
 */

const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('../lib/supabase');
const {
  isConfigured: isGoogleDriveConfigured,
  extractDriveFileIdFromUrl,
  getDriveFileMetadataById,
} = require('../lib/googleDrive');

function parseArgs(argv) {
  const args = {
    apply: false,
    limit: null,
  };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--dry-run') args.apply = false;
    else if (raw.startsWith('--limit=')) {
      const n = Number(raw.split('=')[1]);
      args.limit = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return args;
}

async function fetchAssets(limit) {
  const table = tableConfig().assets || 'assets';
  const pageSize = 1000;
  let offset = 0;
  const rows = [];
  let selectFields = 'id,asset_name,asset_type,location,size,image_width,image_height';

  while (true) {
    const query = `select=${selectFields}&order=id.asc&limit=${pageSize}&offset=${offset}`;
    let res = await sbQuery({ table, query });
    if (!res.ok && /image_width|image_height/i.test(String(res.error || '')) && selectFields.includes('image_width')) {
      // Backward-compatible fallback when dimension columns have not been added yet.
      selectFields = 'id,asset_name,asset_type,location,size';
      res = await sbQuery({ table, query: `select=${selectFields}&order=id.asc&limit=${pageSize}&offset=${offset}` });
    }
    if (!res.ok) return res;
    const chunk = Array.isArray(res.data) ? res.data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    if (limit && rows.length >= limit) break;
    offset += pageSize;
  }

  return { ok: true, data: limit ? rows.slice(0, limit) : rows };
}

function buildPatch(row, drive) {
  const currentSize = Math.max(0, Number(row.size || 0) || 0);
  const currentW = Math.max(0, Number(row.image_width || 0) || 0);
  const currentH = Math.max(0, Number(row.image_height || 0) || 0);

  const nextSize = Math.max(0, Number(drive.sizeBytes || 0) || 0);
  const nextW = Math.max(0, Number(drive.imageWidth || 0) || 0);
  const nextH = Math.max(0, Number(drive.imageHeight || 0) || 0);

  const patch = {};
  if (nextSize !== currentSize) patch.size = nextSize;
  if (Object.prototype.hasOwnProperty.call(row, 'image_width') && nextW !== currentW) {
    patch.image_width = nextW || null;
  }
  if (Object.prototype.hasOwnProperty.call(row, 'image_height') && nextH !== currentH) {
    patch.image_height = nextH || null;
  }
  return patch;
}

async function applyPatch(assetId, patch) {
  const table = tableConfig().assets || 'assets';
  return sbQuery({
    method: 'PATCH',
    table,
    query: `id=eq.${Number(assetId)}&select=id`,
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!isSupabaseConfigured()) {
    console.error('Supabase is not configured. Set env vars or Settings > APIs > Supabase.');
    process.exit(1);
  }
  if (!isGoogleDriveConfigured()) {
    console.error('Google Drive is not configured. Set credentials in Settings > APIs > Google Drive.');
    process.exit(1);
  }

  const assetsRes = await fetchAssets(args.limit);
  if (!assetsRes.ok) {
    console.error(`Failed reading assets: ${assetsRes.error || 'unknown error'}`);
    process.exit(1);
  }

  const assets = Array.isArray(assetsRes.data) ? assetsRes.data : [];
  const candidates = assets.filter((row) => {
    const id = Number(row.id || 0) || 0;
    if (id <= 0) return false;
    return Boolean(extractDriveFileIdFromUrl(row.location));
  });

  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Assets scanned: ${assets.length}`);
  console.log(`Drive-linked candidates: ${candidates.length}`);

  let checked = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of candidates) {
    checked += 1;
    const fileId = extractDriveFileIdFromUrl(row.location);
    if (!fileId) {
      failed += 1;
      console.log(`[skip] asset id=${row.id} name="${row.asset_name || ''}" reason=no-drive-id`);
      continue;
    }

    const metaRes = await getDriveFileMetadataById(fileId);
    if (!metaRes.ok) {
      failed += 1;
      console.log(`[fail] asset id=${row.id} fileId=${fileId} error=${metaRes.error || 'metadata lookup failed'}`);
      continue;
    }

    const patch = buildPatch(row, metaRes.data || {});
    if (!Object.keys(patch).length) {
      unchanged += 1;
      continue;
    }

    if (!args.apply) {
      updated += 1;
      console.log(`[dry-run] asset id=${row.id} patch=${JSON.stringify(patch)}`);
      continue;
    }

    const saveRes = await applyPatch(row.id, patch);
    if (!saveRes.ok) {
      failed += 1;
      console.log(`[fail] asset id=${row.id} update error=${saveRes.error || 'unknown update error'}`);
      continue;
    }
    updated += 1;
    console.log(`[updated] asset id=${row.id} patch=${JSON.stringify(patch)}`);
  }

  console.log('\nSummary');
  console.log(`Checked:   ${checked}`);
  console.log(`Updated:   ${updated}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Failed:    ${failed}`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
