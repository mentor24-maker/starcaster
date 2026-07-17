#!/usr/bin/env node
'use strict';
/**
 * Grid-image splitter: takes a composite image laid out as a grid of photos on
 * a light background (team pages, product grids, collage exports), finds each
 * photo automatically by scanning for the whitespace gaps between them, crops
 * them into separate files, and optionally uploads each crop to Vercel Blob
 * storage so the URLs can be dropped straight into Builder image modules.
 *
 * Usage:
 *   node scripts/split_grid_image.mjs --url <imageUrl> --out <dir> [--upload <blob/path/prefix>] [--min-size 100] [--white 235]
 *
 *   --url       Source image URL (or a local file path)
 *   --out       Directory for the cropped files (created if missing)
 *   --upload    Optional Blob pathname prefix, e.g. APP_Assets/Image/Team.
 *               Requires BLOB_READ_WRITE_TOKEN in .env.local.
 *   --min-size  Smallest width/height (px) a region must have to count as a
 *               photo; filters out text lines baked into the image. Default 100.
 *   --white     Brightness threshold (0-255) above which a pixel counts as
 *               background. Default 235.
 *
 * Prints one line per crop: index, box, local file, and Blob URL if uploaded.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const URL_IN = arg('url');
const OUT_DIR = arg('out', path.join(ROOT, 'tmp_crops'));
const UPLOAD_PREFIX = arg('upload');
const MIN_SIZE = Number(arg('min-size', 100));
const WHITE = Number(arg('white', 235));

if (!URL_IN) { console.error('Missing --url'); process.exit(1); }

/** Group indexes of "occupied" scanlines into contiguous bands. */
function bands(occupied, minLen) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= occupied.length; i++) {
    const on = i < occupied.length && occupied[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= minLen) out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

async function main() {
  const buf = /^https?:/.test(URL_IN)
    ? Buffer.from(await (await fetch(URL_IN)).arrayBuffer())
    : readFileSync(URL_IN);
  const img = sharp(buf);
  const { width, height } = await img.metadata();
  console.log(`source: ${width}x${height}`);

  // Greyscale raw pixels; a pixel darker than WHITE counts as content.
  const grey = await img.clone().greyscale().raw().toBuffer();
  const rowHas = new Array(height).fill(false);
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) if (grey[y * width + x] < WHITE) dark++;
    rowHas[y] = dark > width * 0.02;
  }

  const rowBands = bands(rowHas, MIN_SIZE);
  const boxes = [];
  for (const [y0, y1] of rowBands) {
    const colHas = new Array(width).fill(false);
    for (let x = 0; x < width; x++) {
      let dark = 0;
      for (let y = y0; y < y1; y++) if (grey[y * width + x] < WHITE) dark++;
      colHas[x] = dark > (y1 - y0) * 0.02;
    }
    for (const [x0, x1] of bands(colHas, MIN_SIZE)) {
      boxes.push({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 });
    }
  }
  console.log(`detected ${boxes.length} photo region(s)`);

  mkdirSync(OUT_DIR, { recursive: true });
  let uploader = null;
  if (UPLOAD_PREFIX) {
    for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^BLOB_READ_WRITE_TOKEN="?([^"]*)"?$/);
      if (m) process.env.BLOB_READ_WRITE_TOKEN = m[1].trim();
    }
    uploader = require('@vercel/blob');
  }

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const file = path.join(OUT_DIR, `crop_${i + 1}.jpg`);
    const cropped = await sharp(buf).extract(box).jpeg({ quality: 92 }).toBuffer();
    writeFileSync(file, cropped);
    let url = '';
    if (uploader) {
      const res = await uploader.put(`${UPLOAD_PREFIX}/crop_${Date.now()}_${i + 1}.jpg`, cropped, {
        access: 'public', contentType: 'image/jpeg',
      });
      url = res.url;
    }
    console.log(`crop ${i + 1}: [${box.left},${box.top} ${box.width}x${box.height}] -> ${file}${url ? `  ${url}` : ''}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
