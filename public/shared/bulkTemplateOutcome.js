/**
 * What the bulk template change TELLS the operator once it has run.
 *
 * The write path lives in lib/builderPagesStore.js and is covered by
 * scripts/builder/bulkSetPageTemplateWrite.test.js. This file is the other
 * half — the sentence the operator actually reads — and it is here, in
 * public/shared/, rather than inline in public/js/builder.js for one reason:
 * public/js/ is parsed by nothing but the browser (landmine 9), so a report
 * built there can only be verified by eye. The defect below survived review,
 * a full gate run and a real browser pass precisely because nothing could
 * assert on it. Loaded as a plain <script> in the admin shell
 * (window.App.bulkTemplateOutcome) and require()-able from Node for tests —
 * the same pattern as composeXPost.js beside it.
 *
 * THE THREE VERDICTS ARE INDEPENDENT, AND THAT IS THE WHOLE POINT.
 * Each page comes back as one of:
 *
 *   ok && verified    — written, and read back holding the new template
 *   !ok               — refused; the page still holds what it had
 *   ok && !verified    — the database accepted the write and the row does not
 *                        show it. This is the 2026-08-16 shape: fourteen pages
 *                        emptied with every write reporting success.
 *
 * The first version of this report branched — `if (failed) … else if
 * (unverified) … else …` — so a run with BOTH produced "41 of 43 pages moved;
 * 2 failed" and dropped the read-back warning entirely, while counting the
 * unconfirmed pages among the 41 as moved. The one run where the warning
 * matters most is the one that hid it. Landmine 17 is this exact defect: three
 * per-page verdicts collapsed into a two-branch report.
 *
 * So: no branching over the counts. All three are stated, every time, and a
 * count of zero is simply left unsaid.
 *
 * AND WHERE THE PAGES ARE. A page with no published snapshot is served
 * straight from its draft (routes/publicSite.js -> getPublishedPage falls back
 * to getPublishedPageForProject), so on a project that has never published —
 * most of them — a re-poured page is on the tenant's public domain the moment
 * this call returns. The first version said "check them before publishing",
 * which invents a gate between the operator and the visitor. There is none.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.App = root.App || {};
    root.App.bulkTemplateOutcome = api;
  }
})(typeof self !== 'undefined' ? self : null, function () {
  function text(value) {
    return typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  /**
   * Split the per-page results into the three verdicts.
   *
   * A row that is neither shaped like a result nor readable counts as FAILED,
   * never as moved: "could not tell" must not render as "fine".
   */
  function tallyBulkTemplateRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const confirmed = [];
    const failed = [];
    const unconfirmed = [];
    for (const row of list) {
      const item = row && typeof row === 'object' ? row : {};
      if (!item.ok) failed.push(item);
      else if (item.verified) confirmed.push(item);
      else unconfirmed.push(item);
    }
    return { total: list.length, confirmed, failed, unconfirmed };
  }

  /**
   * The sentence for a run that COMPLETED — the server answered, and every
   * page has a verdict.
   *
   * `rows` are the per-page results. A row may carry `isLive: true`, meaning
   * that page is published, not private, and therefore already being served to
   * visitors. The caller decorates the rows because only the browser holds the
   * publish flags; this function only ever counts them.
   */
  function describeBulkTemplateOutcome(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const templateName = text(opts.templateName) || 'the new template';
    const { total, confirmed, failed, unconfirmed } = tallyBulkTemplateRows(opts.rows);

    if (!total) {
      return {
        message: 'The change ran but the server named no pages, so nothing can be confirmed. Check the pages, or Restore All from Archives.',
        isError: true,
        counts: { total: 0, confirmed: 0, failed: 0, unconfirmed: 0 },
      };
    }

    // The clean run is the only one that gets a single short sentence.
    if (!failed.length && !unconfirmed.length) {
      return {
        message: `${total} ${plural(total, 'page', 'pages')} moved to ${templateName}, all confirmed. Undo from Archives.`,
        isError: false,
        counts: { total, confirmed: confirmed.length, failed: 0, unconfirmed: 0 },
      };
    }

    const parts = [];
    parts.push(`${confirmed.length} of ${total} ${plural(total, 'page', 'pages')} moved to ${templateName} and confirmed`);

    if (failed.length) {
      const reason = text(failed[0].error) || 'unknown error';
      const named = text(failed[0].name);
      parts.push(`${failed.length} failed (${named ? `${named}: ` : ''}${reason}) and ${plural(failed.length, 'is', 'are')} unchanged`);
    }

    if (unconfirmed.length) {
      // The dangerous count. It is never folded into the moved figure and it
      // never says "before publishing" — see the header.
      const live = unconfirmed.filter((row) => row.isLive === true).length;
      const whereTheyAre = live
        ? `${live === unconfirmed.length ? 'they' : `${live} of them`} ${plural(live, 'is', 'are')} live on the public site right now, so check ${plural(live, 'it', 'them')} now or Restore All from Archives`
        : 'check those before trusting them, or Restore All from Archives';
      parts.push(`${unconfirmed.length} ${plural(unconfirmed.length, 'was', 'were')} written but could not be read back — ${whereTheyAre}`);
    }

    return {
      message: `${parts.join('; ')}.`,
      isError: true,
      counts: { total, confirmed: confirmed.length, failed: failed.length, unconfirmed: unconfirmed.length },
    };
  }

  /**
   * The sentence for a run that DIED MID-FLIGHT — the request threw, so there
   * are no per-page results at all.
   *
   * The store only reports failure when EVERY page failed, so a plain 500 is
   * harmless. The reachable case is the request dying after the server has
   * already written some pages: a serverless timeout, a dropped connection, or
   * a non-JSON response (App.api throws `Invalid API response` on one). This
   * repo has that exact shape on file — a canonical propagation that updated
   * 30 of 50 pages before the function was frozen.
   *
   * The first version notified the error and left the table showing the OLD
   * template values, so on a 43-page selection the operator was looking at a
   * screen saying nothing moved while the pages underneath had been re-poured.
   * "Could not tell" is the honest answer here, and it has to be said out loud.
   */
  function describeBulkTemplateInterruption(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const reason = text(opts.error) || 'the request failed';
    const liveCount = Number.isFinite(opts.liveCount) ? Math.max(0, Math.trunc(opts.liveCount)) : 0;
    const live = liveCount
      ? ` ${liveCount} of the selected ${plural(liveCount, 'page is', 'pages are')} live on the public site.`
      : '';
    return {
      message: `${reason}. The request failed part-way, so some pages may already have been changed and some may not — the list has been reloaded.${live} Check the pages, or Restore All from Archives if this is not what you wanted.`,
      isError: true,
    };
  }

  return {
    tallyBulkTemplateRows,
    describeBulkTemplateOutcome,
    describeBulkTemplateInterruption,
  };
});
