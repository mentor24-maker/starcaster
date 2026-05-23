'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SIPS_PATH = '/usr/bin/sips';
const DEFAULT_MAX_EDGE = 480;

let sharpModule = null;
let sharpLoadAttempted = false;

function loadSharp() {
  if (sharpLoadAttempted) return sharpModule;
  sharpLoadAttempted = true;
  try {
    sharpModule = require('sharp');
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

function extensionFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  return '.img';
}

function generateThumbnailWithSips(buffer, { maxEdge, mimeType }) {
  if (process.platform !== 'darwin' || !fs.existsSync(SIPS_PATH)) {
    return { ok: false, error: 'Thumbnail resize requires sharp or macOS sips' };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starcaster-thumb-'));
  try {
    const sourcePath = path.join(dir, `source${extensionFromMime(mimeType)}`);
    const outputPath = path.join(dir, 'thumbnail.jpg');
    fs.writeFileSync(sourcePath, buffer);

    const res = spawnSync(
      SIPS_PATH,
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', String(maxEdge), sourcePath, '--out', outputPath],
      { encoding: 'utf8' }
    );
    if (res.status !== 0) {
      return { ok: false, error: `${res.stderr || res.stdout || 'sips failed'}`.trim() };
    }

    const outputBuffer = fs.readFileSync(outputPath);
    const dimRes = spawnSync(SIPS_PATH, ['-g', 'pixelWidth', '-g', 'pixelHeight', outputPath], {
      encoding: 'utf8',
    });
    const output = `${dimRes.stdout || ''}\n${dimRes.stderr || ''}`;
    const widthMatch = output.match(/pixelWidth:\s*(\d+)/);
    const heightMatch = output.match(/pixelHeight:\s*(\d+)/);

    return {
      ok: true,
      data: {
        buffer: outputBuffer,
        width: widthMatch ? Number(widthMatch[1] || 0) || 0 : 0,
        height: heightMatch ? Number(heightMatch[1] || 0) || 0 : 0,
        mimeType: 'image/jpeg',
      },
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function generateThumbnailJpeg(buffer, options = {}) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!input.length) {
    return { ok: false, error: 'Image buffer is empty' };
  }

  const maxEdge = Math.max(64, Number(options.maxEdge || DEFAULT_MAX_EDGE) || DEFAULT_MAX_EDGE);
  const sharp = loadSharp();

  if (sharp) {
    try {
      const image = sharp(input, { failOn: 'none' });
      const resized = await image
        .rotate()
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      return {
        ok: true,
        data: {
          buffer: resized.data,
          width: Number(resized.info.width || 0) || 0,
          height: Number(resized.info.height || 0) || 0,
          mimeType: 'image/jpeg',
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'sharp thumbnail failed' };
    }
  }

  return generateThumbnailWithSips(input, { maxEdge, mimeType: options.mimeType });
}

module.exports = {
  DEFAULT_MAX_EDGE,
  generateThumbnailJpeg,
};
