'use strict';

/**
 * Which fonts Starcaster will keep, decided in one place (Font Library 1/7,
 * task 86bchyd3n).
 *
 * The sites built here are businesses. A font marked "free for personal use"
 * is free to download and not free to put on a client's shop front, and
 * nobody uploading one is thinking about that at the time. So the library
 * accepts exactly three licences that allow commercial web use and refuses
 * everything else, including anything it does not recognise.
 *
 * The same three values are the `check (licence in (...))` in
 * docs/SQL/fonts_library_setup.sql. This function is what callers ask; the
 * database constraint is the backstop.
 */

const ACCEPTED_LICENCES = Object.freeze(['OFL-1.1', 'Apache-2.0', 'public-domain']);

const LICENCE_REFUSED_MESSAGE =
  "This font's licence does not allow use on a business website. "
  + 'Starcaster accepts fonts under the SIL Open Font License, Apache 2.0, or public domain.';

const CATEGORIES = Object.freeze(['serif', 'sans', 'display', 'monospace', 'handwriting']);

/**
 * @param {unknown} licence  the licence id as sent
 * @returns {{ ok: true, licence: string } | { ok: false, message: string }}
 */
function checkFontLicence(licence) {
  const value = String(licence == null ? '' : licence).trim();
  if (ACCEPTED_LICENCES.includes(value)) return { ok: true, licence: value };
  return { ok: false, message: LICENCE_REFUSED_MESSAGE };
}

/**
 * A family name ends up inside CSS (`font-family: "Space Grotesk"`) and inside
 * a URL, so it is held to letters, digits, single spaces and hyphens. Anything
 * else is refused rather than cleaned up: a quietly rewritten name is a font
 * the operator then cannot find under the name he typed.
 *
 * @returns {{ ok: true, family: string } | { ok: false, message: string }}
 */
function checkFontFamilyName(family) {
  const value = String(family == null ? '' : family).trim();
  if (!value) return { ok: false, message: 'A font needs a family name, for example "Space Grotesk".' };
  if (value.length > 80) return { ok: false, message: 'A font family name can be at most 80 characters.' };
  if (!/^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/.test(value)) {
    return {
      ok: false,
      message: `"${value}" cannot be used as a font name. Use letters, digits, single spaces and hyphens only.`,
    };
  }
  return { ok: true, family: value };
}

/** @returns {{ ok: true, category: string } | { ok: false, message: string }} */
function checkFontCategory(category) {
  const value = String(category == null ? '' : category).trim().toLowerCase();
  if (CATEGORIES.includes(value)) return { ok: true, category: value };
  return { ok: false, message: `A font's category must be one of: ${CATEGORIES.join(', ')}.` };
}

module.exports = {
  ACCEPTED_LICENCES,
  CATEGORIES,
  LICENCE_REFUSED_MESSAGE,
  checkFontCategory,
  checkFontFamilyName,
  checkFontLicence,
};
