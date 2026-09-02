'use strict';

/**
 * WHICH PAGE LIVES AT THIS ADDRESS — the one rule, in one place.
 *
 * A visitor asks for `/pickleball-videos`. Something has to turn that into a
 * page. Two code paths did it independently:
 *
 *   the draft path      lib/builderPagesStore.js  getPublishedPageForProject
 *   the published path  lib/publishedPageRead.js  getPublishedPage
 *
 * `publishedPageRead` already carried a comment saying that if these two ever
 * disagree, "publishing a site would silently move its pages", and a test
 * (`publishBuilds.test.js`) checked they agreed. Both were looking at the
 * wrong half of the rule. They compared the NORMALIZATION — lower-case, trim
 * the slashes, treat '' and 'home' as the root — which did match. Neither
 * compared the TIE-BREAK, and the tie-break is where they disagreed:
 *
 *   the draft path      ordered the candidates newest-draft-first, then took
 *                       the first match. Deterministic.
 *   the published path  selected `slug=in.(...)&limit=5` with NO order clause
 *                       and took whichever row `Array.find` reached first.
 *                       Whatever Postgres felt like returning.
 *
 * A slug is not unique. Delray has both `Apparel` and `apparel`, matching is
 * case-insensitive, and a deleted or renamed page used to leave its published
 * snapshot behind at the old address forever. So on 2026-09-02 Delray's
 * `/pickleball-videos` served page 1449 — an abandoned draft with a
 * PLACEHOLDER SECTION and no header at all — while Dane edited page 1450 and
 * watched his header changes do nothing. Every gate was green; the header WAS
 * canonical; the page he was fixing was simply not the page anyone was served.
 *
 * ---------------------------------------------------------------- the fix
 *
 * The tie-break is not copied into two places any more, because two copies of
 * a rule is what produced this. It lives here, and both readers call it.
 *
 * And the published table no longer gets a vote on WHICH page an address means.
 * That question belongs to `builder_pages` — the drafts are the site's actual
 * structure; a snapshot is only ever an answer to "what did page N look like
 * when it was photographed". Resolve the address to a page id against the
 * drafts, then fetch that page's snapshot by id. An orphan snapshot then
 * cannot be chosen no matter how many of them pile up, because its page id is
 * not what the address resolves to.
 *
 * That ordering matters for a reason bigger than tidiness: on 2026-09-02 the
 * real page (1450) had NO snapshot of its own. Sorting the snapshot rows more
 * cleverly could never have fixed it — there was only one row to sort, and it
 * was the wrong page's. Only asking the drafts who owns the address gets to
 * the right answer, and from there the existing "no build? serve the draft"
 * fallback does the rest.
 */

const { isPublicSiteSlug } = require('./builder-client/public-site-page-slugs');

/**
 * A request path reduced to the form a page's stored slug is compared against.
 * Surrounding slashes go, case goes; '' and 'home' both still mean the root
 * and are told apart by `pickPageForAddress`, not here.
 */
function normalizeAddress(slugInput) {
  return String(slugInput ?? '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
}

/** A page's own slug, reduced the same way, so the two are comparable. */
function pageAddress(page) {
  return String(page?.slug ?? '').trim().toLowerCase();
}

/**
 * Candidate order — and therefore the tie-break, since the pick is "first
 * match wins".
 *
 *   the root first: a page slugged '' outranks one slugged 'home'
 *   then the most recently edited draft
 *
 * Sorts a copy; the caller's array is left alone.
 */
function sortPagesForAddressing(pages) {
  const rank = (slug) => {
    const s = String(slug ?? '').trim();
    if (s === '') return 0;
    if (s === 'home') return 1;
    return 2;
  };
  return (Array.isArray(pages) ? pages.slice() : []).sort((a, b) => {
    const diff = rank(a?.slug) - rank(b?.slug);
    if (diff !== 0) return diff;
    return String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || ''));
  });
}

/**
 * The page at this address, or null.
 *
 * `pages` must already be filtered to what the caller is allowed to serve
 * (published, not private, public slug) — this decides the address, not the
 * permission. It does NOT assume the list is sorted: it sorts its own copy, so
 * a caller that hands over rows in database order still gets the same answer
 * as one that has sorted them. That is deliberate. The old bug was a caller
 * trusting an order nobody had established.
 */
function pickPageForAddress(pages, slugInput) {
  const wanted = normalizeAddress(slugInput);
  const ordered = sortPagesForAddressing(pages);
  if (wanted === '' || wanted === 'home') {
    return ordered.find((p) => pageAddress(p) === '')
      ?? ordered.find((p) => pageAddress(p) === 'home')
      ?? null;
  }
  return ordered.find((p) => pageAddress(p) === wanted) ?? null;
}

/**
 * Is this address servable on the public site at all? Mirrors the list
 * endpoint's slug filter so a single-page read cannot answer for an address
 * the list would have hidden.
 */
function isPublicAddress(slugInput) {
  return isPublicSiteSlug(normalizeAddress(slugInput));
}

module.exports = {
  normalizeAddress,
  pageAddress,
  sortPagesForAddressing,
  pickPageForAddress,
  isPublicAddress,
};
