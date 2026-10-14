'use strict';

/**
 * The decisions behind the font library's starter pack (Font Library 4/7,
 * task 86bchyd4a): which Fontsource families may come in, under what licence
 * and category, and which of their files to keep.
 *
 * Everything here is pure — no network, no database — so the rules are
 * tested directly (scripts/builder/fontsourceImport.test.js) and the import
 * script (scripts/fonts_import_fontsource.mjs) only moves bytes.
 *
 * Fontsource API shape (checked 2026-10-14, api.fontsource.org/v1/fonts/<id>):
 *   { id, family, subsets: ['latin', …], weights: [400, …],
 *     styles: ['normal', 'italic'], category: 'sans-serif' | 'serif' |
 *     'display' | 'handwriting' | 'monospace' | 'other' | 'icons',
 *     license: 'OFL-1.1' | 'Apache-2.0' | 'CC0-1.0' | 'Unlicense' | 'mit' | 'UFL-1.0',
 *     variants: { '400': { normal: { latin: { url: { woff2, woff, ttf } } } } } }
 */

const { checkFontLicence, checkFontFamilyName } = require('./fontLicence');
const { slugify } = require('./slugify');

const FONTSOURCE_API = 'https://api.fontsource.org/v1/fonts';

/**
 * Fontsource licence id → the library's own. CC0 and the Unlicense are both
 * public-domain dedications. Anything else (MIT, the Ubuntu Font Licence, …)
 * maps to nothing and is refused by checkFontLicence, which stays the one
 * place that decides.
 */
const LICENCE_MAP = Object.freeze({
  'OFL-1.1': 'OFL-1.1',
  'Apache-2.0': 'Apache-2.0',
  'CC0-1.0': 'public-domain',
  Unlicense: 'public-domain',
});

const LICENCE_TEXT = Object.freeze({
  'OFL-1.1': 'SIL Open Font License, Version 1.1. Full text: https://openfontlicense.org/open-font-license-official-text/',
  'Apache-2.0': 'Apache License, Version 2.0. Full text: https://www.apache.org/licenses/LICENSE-2.0',
  'public-domain': 'Dedicated to the public domain',
});

/** Fontsource category → the library's five. "other" and "icons" are not text faces. */
const CATEGORY_MAP = Object.freeze({
  'sans-serif': 'sans',
  serif: 'serif',
  display: 'display',
  handwriting: 'handwriting',
  monospace: 'monospace',
});

/** With no weights named in the pack: regular and bold, where the family has them. */
const DEFAULT_WEIGHTS = Object.freeze([400, 700]);

/**
 * The pack file: one Fontsource id per line, optionally followed by the
 * weights to keep (`orbitron 400,700,900`). `#` starts a comment. A line that
 * cannot be read, or an id listed twice, is reported rather than guessed at.
 *
 * @returns {{ entries: Array<{ id: string, weights: number[] | null, line: number }>,
 *             problems: Array<{ line: number, message: string }> }}
 */
function parsePackFile(text) {
  const entries = [];
  const problems = [];
  const seen = new Map();
  String(text || '').split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const body = raw.replace(/#.*$/, '').trim();
    if (!body) return;
    const [id, weightsText, ...rest] = body.split(/\s+/);
    if (rest.length || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      problems.push({ line, message: `cannot read "${raw.trim()}" — expected a Fontsource id, then optional weights like 400,700` });
      return;
    }
    let weights = null;
    if (weightsText) {
      weights = weightsText.split(',').map(Number);
      if (weights.some((w) => !Number.isInteger(w) || w < 100 || w > 900 || w % 100 !== 0)) {
        problems.push({ line, message: `"${id}": weights must be 100, 200, … 900 separated by commas (got "${weightsText}")` });
        return;
      }
    }
    if (seen.has(id)) {
      problems.push({ line, message: `"${id}" is already listed on line ${seen.get(id)}` });
      return;
    }
    seen.set(id, line);
    entries.push({ id, weights, line });
  });
  return { entries, problems };
}

/**
 * Which files to keep: latin subset, woff2 only, the weights asked for (or
 * regular + bold), upright and — where the family has one — italic. A family
 * with neither 400 nor 700 (plenty of display faces come in one weight) keeps
 * the weight nearest to regular, so it still comes in.
 *
 * @returns {{ ok: true, files: Array<{ weight: number, style: string, url: string }>, missing: string[] }
 *         | { ok: false, reason: string }}
 */
function selectFiles(detail, wantedWeights) {
  const variants = detail && detail.variants && typeof detail.variants === 'object' ? detail.variants : {};
  const hasLatin = (weight, style) => {
    const url = variants[String(weight)]?.[style]?.latin?.url?.woff2;
    return typeof url === 'string' && /^https:\/\//.test(url) ? url : null;
  };
  const available = Object.keys(variants).map(Number).filter((w) => hasLatin(w, 'normal') || hasLatin(w, 'italic'));
  if (!available.length) return { ok: false, reason: 'no latin woff2 files on Fontsource' };

  const missing = [];
  let weights;
  if (Array.isArray(wantedWeights) && wantedWeights.length) {
    weights = wantedWeights.filter((w) => {
      if (available.includes(w)) return true;
      missing.push(`weight ${w}`);
      return false;
    });
    if (!weights.length) {
      return { ok: false, reason: `none of the weights listed (${wantedWeights.join(', ')}) exist; it has ${available.sort((a, b) => a - b).join(', ')}` };
    }
  } else {
    weights = DEFAULT_WEIGHTS.filter((w) => available.includes(w));
    if (!weights.length) {
      weights = [available.slice().sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400) || a - b)[0]];
    }
  }

  const files = [];
  for (const weight of weights.slice().sort((a, b) => a - b)) {
    for (const style of ['normal', 'italic']) {
      const url = hasLatin(weight, style);
      if (url) files.push({ weight, style, url });
    }
  }
  return { ok: true, files, missing };
}

/**
 * One pack entry against Fontsource's answer and the library's current slugs:
 * import it, or skip it with a reason a person can read.
 *
 * @param {{ id: string, weights: number[] | null }} entry
 * @param {object | null} detail   Fontsource /v1/fonts/<id>, or null when it has no such font
 * @param {Set<string>} presentSlugs   platform slugs already in the library
 * @returns {{ action: 'import', id, font, files, missing }
 *         | { action: 'present', id, family, slug }
 *         | { action: 'skip', id, family?, reason: string }}
 */
function planFamily(entry, detail, presentSlugs) {
  const id = entry.id;
  if (!detail) return { action: 'skip', id, reason: 'Fontsource has no font with this id' };
  const family = String(detail.family || '').trim();

  const licenceId = String(detail.license || '').trim();
  const licence = checkFontLicence(LICENCE_MAP[licenceId]);
  if (!licence.ok) {
    return { action: 'skip', id, family, reason: `licence ${licenceId || '(none given)'} does not allow use on a business website` };
  }
  const name = checkFontFamilyName(family);
  if (!name.ok) return { action: 'skip', id, family, reason: name.message };
  const category = CATEGORY_MAP[String(detail.category || '').trim()];
  if (!category) return { action: 'skip', id, family, reason: `category "${detail.category}" is not a text font the library keeps` };

  const slug = slugify(name.family);
  if (presentSlugs.has(slug)) return { action: 'present', id, family: name.family, slug };

  const picked = selectFiles(detail, entry.weights);
  if (!picked.ok) return { action: 'skip', id, family, reason: picked.reason };

  const licenceText = licenceId === licence.licence
    ? LICENCE_TEXT[licence.licence]
    : `${LICENCE_TEXT[licence.licence]} (${licenceId})`;
  return {
    action: 'import',
    id,
    font: {
      family: name.family,
      slug,
      category,
      licence: licence.licence,
      licenceText,
      sourceUrl: `https://fontsource.org/fonts/${id}`,
      sourceName: 'Fontsource',
    },
    files: picked.files,
    missing: picked.missing,
  };
}

/** Where a platform font's file lives in blob storage — fixed, so a re-run overwrites rather than piles up. */
function platformFilePath(slug, { weight, style }) {
  return `Fonts/platform/${slug}/${weight}-${style}.woff2`;
}

/** Rows read back after an import, counted by category. */
function countByCategory(rows) {
  const counts = {};
  for (const row of rows || []) counts[row.category] = (counts[row.category] || 0) + 1;
  return counts;
}

/**
 * Did every family this run imported come back from the database with the
 * files it was given? Returns the ones that did not, with why.
 */
function readBackMismatches(imported, rows) {
  const bySlug = new Map((rows || []).map((r) => [r.slug, r]));
  const problems = [];
  for (const item of imported) {
    const row = bySlug.get(item.slug);
    if (!row) {
      problems.push(`${item.family}: no row in the library after it was saved`);
      continue;
    }
    const stored = Array.isArray(row.styles) ? row.styles.length : 0;
    if (stored !== item.fileCount) problems.push(`${item.family}: ${item.fileCount} file(s) uploaded, row lists ${stored}`);
  }
  return problems;
}

module.exports = {
  CATEGORY_MAP,
  DEFAULT_WEIGHTS,
  FONTSOURCE_API,
  LICENCE_MAP,
  countByCategory,
  parsePackFile,
  planFamily,
  platformFilePath,
  readBackMismatches,
  selectFiles,
};
