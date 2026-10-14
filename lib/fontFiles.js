'use strict';

/**
 * What an uploaded font file is, read from its bytes (Font Library 1/7).
 *
 * The extension is what the uploader typed; the first four bytes are what the
 * file is. Both have to agree before anything reaches blob storage, so a
 * renamed .exe or a web page saved as ".woff2" is refused at the door rather
 * than served to every visitor of a client's site as a "font".
 *
 * Files are stored as uploaded — no conversion to woff2, no subsetting (both
 * out of scope for 1/7).
 */

const FORMATS = Object.freeze({
  woff2: { mime: 'font/woff2', magic: (b) => b.toString('latin1', 0, 4) === 'wOF2' },
  woff: { mime: 'font/woff', magic: (b) => b.toString('latin1', 0, 4) === 'wOFF' },
  // TrueType: version 1.0 (00 01 00 00), or Apple's 'true' tag.
  ttf: {
    mime: 'font/ttf',
    magic: (b) => b.readUInt32BE(0) === 0x00010000 || b.toString('latin1', 0, 4) === 'true',
  },
  otf: { mime: 'font/otf', magic: (b) => b.toString('latin1', 0, 4) === 'OTTO' },
});

const ACCEPTED_EXTENSIONS = Object.freeze(Object.keys(FORMATS));

/**
 * @param {string} fileName
 * @param {Buffer} buffer
 * @returns {{ ok: true, format: string, mime: string } | { ok: false, message: string }}
 */
function detectFontFormat(fileName, buffer) {
  const name = String(fileName || '').trim();
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
  const format = FORMATS[ext];
  if (!format) {
    return {
      ok: false,
      message: `"${name || 'This file'}" is not a font file Starcaster accepts. Use .woff2, .woff, .ttf or .otf.`,
    };
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || !format.magic(buffer)) {
    return {
      ok: false,
      message: `"${name}" is named like a .${ext} font but its contents are not one. Upload the original font file.`,
    };
  }
  return { ok: true, format: ext, mime: format.mime };
}

// Longest names first so "ExtraBold" is not read as "Bold".
const WEIGHT_NAMES = [
  ['extralight', 200], ['ultralight', 200], ['semibold', 600], ['demibold', 600],
  ['extrabold', 800], ['ultrabold', 800], ['hairline', 100], ['regular', 400],
  ['medium', 500], ['normal', 400], ['light', 300], ['black', 900], ['heavy', 900],
  ['bold', 700], ['thin', 100], ['book', 400],
];

/**
 * A file's weight and style guessed from its name ("Inter-SemiBoldItalic.woff2"
 * → 600 italic, "inter-latin-700-normal.woff2" → 700 normal). A name that says
 * nothing reads as 400 normal. The uploader can always say instead; this is
 * only the default.
 *
 * @returns {{ weight: number, style: 'normal' | 'italic' }}
 */
function inferFontStyle(fileName) {
  const stem = String(fileName || '').replace(/\.[a-z0-9]+$/i, '').toLowerCase();
  const style = /italic|oblique/.test(stem) ? 'italic' : 'normal';
  const numeric = /(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/.exec(stem);
  if (numeric) return { weight: Number(numeric[1]), style };
  const compact = stem.replace(/[^a-z]/g, '');
  for (const [word, weight] of WEIGHT_NAMES) {
    if (compact.includes(word)) return { weight, style };
  }
  return { weight: 400, style };
}

/** @returns {{ ok: true, weight: number, style: string } | { ok: false, message: string }} */
function checkFontStyle({ weight, style } = {}) {
  const w = Number(weight);
  if (!Number.isInteger(w) || w < 100 || w > 900 || w % 100 !== 0) {
    return { ok: false, message: `A font weight must be 100, 200, … 900 (got "${weight}").` };
  }
  const s = String(style || 'normal').trim().toLowerCase();
  if (s !== 'normal' && s !== 'italic') {
    return { ok: false, message: `A font style must be "normal" or "italic" (got "${style}").` };
  }
  return { ok: true, weight: w, style: s };
}

module.exports = {
  ACCEPTED_EXTENSIONS,
  checkFontStyle,
  detectFontFormat,
  inferFontStyle,
};
