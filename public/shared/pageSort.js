/**
 * The one rule for ordering a list of the site's pages in a dropdown.
 *
 * The operator hit this on the Blog Post List module's "Post Page" picker,
 * where "Tennis Drills & Clinics" sat between "Events Details" and "Welcome to
 * Delray Beach Tennis Center" — the store returns pages in roughly creation
 * order, and with ~40 pages on Delray that means reading the whole list to
 * find one.
 *
 * It lives in public/shared/ rather than in lib/builder-client/ because it has
 * to be the SAME rule in two runtimes that cannot import each other: the React
 * builder (components/**, bundled by esbuild) and the frozen vanilla admin app
 * (public/js/campaigns.js, which reaches it as window.App.pageSort). One file
 * so the two can never drift into two different alphabets. Loaded as a plain
 * <script> in the admin shell and importable from the bundle and from tests —
 * the same pattern as composeXPost.js and bulkTemplateOutcome.js beside it.
 *
 * public/shared/ is also parsed by `npm run check:syntax` (landmine 9), which
 * public/js/ needs and public/js/ alone would not give this file.
 *
 * THE SORT IS DISPLAY-ONLY. It returns a new array and never mutates the one
 * it was handed, because the caller's array is the store's array — reordering
 * it in place would change what other code sees, and nothing here is allowed
 * to change what the store returns or what a setting stores.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.App = root.App || {};
    root.App.pageSort = api;
  }
})(typeof self !== 'undefined' ? self : null, function () {
  /**
   * `sensitivity: "base"` so case does not split the list ("about" and "About"
   * belong together, not in two blocks), and `numeric: true` so "Page 2" comes
   * before "Page 10" rather than after it.
   */
  const COLLATOR_OPTIONS = { sensitivity: 'base', numeric: true };

  function text(value) {
    return typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
  }

  /**
   * What a page is filed under. A page with no name falls back to its slug —
   * that is what the dropdown shows for it, so it is what the dropdown should
   * sort it by. A page with neither has nothing to file it under at all, and
   * gets an empty key; `comparePageNames` sends those to the end.
   */
  function pageSortKey(page) {
    if (page == null) return '';
    if (typeof page === 'string') return text(page);
    return text(page.name) || text(page.slug);
  }

  /**
   * Compare two already-extracted names. Empty sorts LAST, not first: an
   * unnamed page is the least useful row in the list, and default string
   * ordering would put it at the very top where the operator looks first.
   */
  function comparePageNames(a, b) {
    const left = text(a);
    const right = text(b);
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right, undefined, COLLATOR_OPTIONS);
  }

  /**
   * Sort a list of pages A-Z by the name the dropdown shows.
   *
   * `getName` is optional: without it the item is read as a page record
   * (`name`, falling back to `slug`). Pass one when the list holds something
   * else — Campaigns, for instance, holds `{ value, label }` option objects.
   *
   * Returns a NEW array. Ties keep their original order, so a list of pages
   * that all share a name does not shuffle between renders.
   */
  function sortPagesByName(pages, getName) {
    if (!Array.isArray(pages)) return [];
    const read = typeof getName === 'function' ? getName : pageSortKey;
    return pages
      .map(function (page, index) {
        return { page: page, index: index, key: text(read(page)) };
      })
      .sort(function (a, b) {
        const byName = comparePageNames(a.key, b.key);
        return byName !== 0 ? byName : a.index - b.index;
      })
      .map(function (entry) {
        return entry.page;
      });
  }

  return {
    COLLATOR_OPTIONS,
    pageSortKey,
    comparePageNames,
    sortPagesByName,
  };
});
