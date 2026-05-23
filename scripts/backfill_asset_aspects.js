#!/usr/bin/env node
'use strict';

try { require('dotenv').config(); } catch (_) {}

const { listAssets, rowToAsset, updateAsset } = require('../lib/assetsStore');
const { inferAspectFromDimensions, normalizeAspect } = require('../lib/assetAspect');

function parseArgs(argv) {
  const args = { apply: false, limit: null, force: false };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--dry-run') args.apply = false;
    else if (raw === '--force') args.force = true;
    else if (raw.startsWith('--limit=')) {
      const n = Number(raw.split('=')[1]);
      args.limit = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return args;
}

function inferDimensionsFromText(asset) {
  const text = `${asset.assetName || ''} ${asset.location || ''}`;
  const match = text.match(/(?:^|[^0-9])([1-9][0-9]{1,4})\s*x\s*([1-9][0-9]{1,4})(?:[^0-9]|$)/i);
  if (!match) return { width: 0, height: 0, source: '' };
  return {
    width: Number(match[1] || 0) || 0,
    height: Number(match[2] || 0) || 0,
    source: 'filename',
  };
}

function resolveAspectCandidate(asset) {
  const imageWidth = Number(asset.imageWidth || 0) || 0;
  const imageHeight = Number(asset.imageHeight || 0) || 0;
  if (imageWidth > 0 && imageHeight > 0) {
    return {
      aspect: inferAspectFromDimensions(imageWidth, imageHeight),
      width: imageWidth,
      height: imageHeight,
      source: 'image_dimensions',
    };
  }

  const thumbnailWidth = Number(asset.thumbnailWidth || 0) || 0;
  const thumbnailHeight = Number(asset.thumbnailHeight || 0) || 0;
  if (thumbnailWidth > 0 && thumbnailHeight > 0) {
    return {
      aspect: inferAspectFromDimensions(thumbnailWidth, thumbnailHeight),
      width: thumbnailWidth,
      height: thumbnailHeight,
      source: 'thumbnail_dimensions',
    };
  }

  const named = inferDimensionsFromText(asset);
  if (named.width > 0 && named.height > 0) {
    return {
      aspect: inferAspectFromDimensions(named.width, named.height),
      width: named.width,
      height: named.height,
      source: named.source,
    };
  }

  return {
    aspect: normalizeAspect(asset.aspect) || 'square',
    width: 0,
    height: 0,
    source: 'fallback',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const res = await listAssets();
  if (!res.ok) {
    console.error(`[aspect] Could not load assets: ${res.status || ''} ${res.error || 'unknown error'}`.trim());
    process.exit(1);
  }

  const rows = (Array.isArray(res.data) ? res.data : []).map(rowToAsset).filter(Boolean);
  const assets = rows
    .filter((asset) => String(asset.assetType || '').trim() === 'Image')
    .slice(0, args.limit || rows.length);

  let changed = 0;
  let unchanged = 0;
  let failed = 0;
  const counts = { wide: 0, square: 0, tall: 0 };

  console.log(`[aspect] mode=${args.apply ? 'APPLY' : 'DRY_RUN'} images=${assets.length}${args.force ? ' force=true' : ''}`);

  for (const asset of assets) {
    const candidate = resolveAspectCandidate(asset);
    counts[candidate.aspect] = (counts[candidate.aspect] || 0) + 1;
    const current = normalizeAspect(asset.aspect) || 'square';
    if (!args.force && current === candidate.aspect) {
      unchanged += 1;
      continue;
    }

    changed += 1;
    if (!args.apply) {
      console.log(`[aspect] DRY id=${asset.id} ${asset.assetName} ${current} -> ${candidate.aspect} (${candidate.width}x${candidate.height}, ${candidate.source})`);
      continue;
    }

    const update = await updateAsset(asset.id, { aspect: candidate.aspect });
    if (!update.ok) {
      failed += 1;
      console.error(`[aspect] FAIL id=${asset.id} ${asset.assetName}: ${update.error || 'update failed'}`);
      continue;
    }
    console.log(`[aspect] OK id=${asset.id} ${asset.assetName} -> ${candidate.aspect}`);
  }

  console.log(`[aspect] complete changed=${changed} unchanged=${unchanged} failed=${failed} target_counts=${JSON.stringify(counts)}`);
  if (failed) process.exitCode = 2;
}

main().catch((err) => {
  console.error('[aspect] fatal:', err?.message || err);
  process.exit(1);
});
