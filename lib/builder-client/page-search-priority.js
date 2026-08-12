'use strict';

/**
 * Per-page search ranking, as five plain choices rather than a number.
 *
 * Plain CommonJS in builder-client for the same reason as
 * public-site-page-slugs.js: the server store normalizes against this list and
 * the browser's page-settings dropdown offers it, and a second copy is how the
 * dropdown ends up offering a value the store silently turns into "normal".
 * One file, required by Node and bundled for the browser.
 *
 * A number would be more expressive and worse. "Set this page to 1.4" means
 * nothing without knowing every other page's number, and the operator is
 * ranking a site, not tuning a formula. Five named rungs answer the only
 * questions actually asked of site search: put this first, push it up, leave
 * it alone, push it down, keep it out.
 *
 * The order of PAGE_SEARCH_PRIORITIES is the order shown in the UI, top rung
 * first — the same order the results themselves come out in.
 */

const PAGE_SEARCH_PRIORITIES = [
  { value: 'pinned', label: 'Pin to top', hint: 'Always above other matches' },
  { value: 'boosted', label: 'Higher', hint: 'Ranks above equally good matches' },
  { value: 'normal', label: 'Normal', hint: 'Ranked on the match alone' },
  { value: 'lowered', label: 'Lower', hint: 'Ranks below equally good matches' },
  { value: 'hidden', label: 'Hide from search', hint: 'Never appears in results' },
];

const PAGE_SEARCH_PRIORITY_VALUES = PAGE_SEARCH_PRIORITIES.map((p) => p.value);

const DEFAULT_PAGE_SEARCH_PRIORITY = 'normal';

/**
 * Anything unrecognised becomes "normal".
 *
 * Including the empty string, which is what every page carries until someone
 * sets one — the column defaults to NULL and pages created before it existed
 * have nothing at all. "Unset means normal" is what lets this ship without a
 * backfill.
 */
function normalizePageSearchPriority(value) {
  const clean = String(value == null ? '' : value).trim().toLowerCase();
  return PAGE_SEARCH_PRIORITY_VALUES.includes(clean) ? clean : DEFAULT_PAGE_SEARCH_PRIORITY;
}

module.exports = {
  PAGE_SEARCH_PRIORITIES,
  PAGE_SEARCH_PRIORITY_VALUES,
  DEFAULT_PAGE_SEARCH_PRIORITY,
  normalizePageSearchPriority,
};
