'use strict';

/**
 * ONE definition of what a slug looks like.
 *
 * A slug is the address a visitor reaches a thing at, so the rule has to be
 * the same everywhere or two features disagree about where the same content
 * lives. It was already written twice (events, poll categories) before this
 * file existed; the blog needed a third, which is where a shared one earns
 * its keep.
 *
 * The rule (operator, 2026-09-03): lowercase everything, spaces become
 * dashes, and anything that is not a letter, a number or a dash goes.
 * Runs collapse to a single dash and the ends are trimmed, because
 * "rock--roll-" is not an address anybody would type.
 *
 * Accents are folded rather than dropped: "Café" is "cafe", not "caf".
 * Deleting the letter loses a word; folding it keeps the one a reader would
 * type anyway.
 */

/** A title (or a hand-typed slug) as a URL-safe slug. */
function slugify(text) {
  return String(text || '')
    // Split accented letters into letter + mark, then drop the marks, so the
    // base letter survives the strip below instead of becoming a dash.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The slug a record will actually be saved under, unique within its project.
 *
 * `requested` wins when it is given — normalized, never stored raw. When it
 * is blank the title is used, because a record with no slug has no address:
 * nothing can link to it and nothing says so at the time. That silence is
 * what put five of Delray's published posts beyond reach of their own blog
 * (86bbu23n7); the Create Post form even promised "auto-generated if blank"
 * while the store wrote an empty string.
 *
 * Uniqueness is per project (a partial unique index, `where slug <> ''`), so
 * a collision is suffixed here rather than surfacing as a raw database error
 * a manager screen can only report as "failed to save". Bounded: after a
 * handful of tries it stops guessing and lets the database have the last
 * word, rather than looping on something it cannot fix.
 *
 * @param {string} requested         the slug the caller asked for, if any
 * @param {string} title             fallback source when there is no slug
 * @param {(slug: string) => Promise<{id?: string}|null>} findBySlug
 *        looks up an existing record in the SAME project scope
 * @param {string} [excludeId]       the record being updated, which may keep its own slug
 */
async function resolveUniqueSlug(requested, title, findBySlug, excludeId = '') {
  const base = slugify(requested) || slugify(title);
  if (!base) return '';
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await findBySlug(candidate);
    if (!clash || (excludeId && String(clash.id) === String(excludeId))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

module.exports = { slugify, resolveUniqueSlug };
