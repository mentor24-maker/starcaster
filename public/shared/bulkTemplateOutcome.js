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
 * THE RULE: NO SENTENCE MAY STATE ANYTHING THE CODE DID NOT CHECK.
 *
 * Dane's answer, 2026-09-05, to the round-4 escalation. Four rounds of review
 * sent this file back for the same class of defect in four spellings — a
 * could-not-tell rendered as a definite answer (rounds 1, 2), a definite answer
 * rendered as a could-not-tell (rounds 2, 3), and after real damage a definite
 * "the archive undoes nothing" (round 4). Every round fixed the instances named
 * and left the siblings, because the fix was a list. This is the rule instead:
 *
 *   A sentence that asserts something happened is a CLAIM. A claim may only be
 *   made when the caller passed the fact that establishes it. There is no
 *   default and no "assume it worked" — a fact that is not literally `true` or
 *   `false` is UNKNOWN, and an UNKNOWN claim is not made at all.
 *
 * It is mechanical, not a habit: claims go through `claim()`, every claim is
 * listed in CLAIMS with the fact that licenses it, and
 * scripts/builder/bulkTemplateOutcome.test.js drives every function over a
 * matrix of inputs and fails if a claim's phrase ever appears in a message its
 * fact did not license. A new sentence that hard-codes "the list has been
 * reloaded" fails that test without anybody having to remember this paragraph.
 *
 * The two facts that were being INFERRED rather than checked:
 *
 *   - "the server decided, so nothing was written" was inferred from
 *     `status >= 400`. routes/index.js answers an UNHANDLED THROW with a
 *     well-formed JSON 500, and sbQuery can throw: `await res.text()`
 *     (lib/supabase.js) sits outside the try/catch that wraps fetch(), so a
 *     dropped body read escapes the store as an exception. Pages already
 *     re-poured, and the operator was told the archive "undoes nothing" — sent
 *     away from the only undo this operation has. The route now SAYS so
 *     instead: a refusal raised before any write carries the error code
 *     NOTHING_WRITTEN, which is a fact the server checked and the browser
 *     cannot.
 *   - "the list has been reloaded" was asserted flat. The reload is itself a
 *     call that can fail, on a path where the API is unhealthy by hypothesis,
 *     and refreshPagesTableAfterBulkChange swallows the failure by design. The
 *     caller now reports whether it worked.
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

  // The server's own word that a refusal was raised BEFORE any page was
  // written. It is the only thing that licenses "nothing was changed" from an
  // HTTP error, because the browser cannot tell a deliberate refusal from an
  // unhandled throw: routes/index.js renders both as a JSON error envelope.
  // Set by routes/builder.js on the bulk-set-template paths.
  const NOTHING_WRITTEN = 'NOTHING_WRITTEN';

  const UNKNOWN = 'unknown';

  /**
   * A caller-supplied fact, in one of THREE states.
   *
   * Anything that is not literally `true` or `false` is UNKNOWN — undefined, a
   * missing property, null, a string, a number. That is the whole point: a
   * caller that forgot to check gets UNKNOWN, not a cheerful default, so a new
   * call site cannot silently inherit a claim nobody verified.
   */
  function fact(value) {
    if (value === true) return true;
    if (value === false) return false;
    return UNKNOWN;
  }

  /**
   * Say one of three things depending on the fact.
   *
   * The UNKNOWN branch may not make the claim. Saying NOTHING is always a valid
   * answer there and is usually the right one — the operator is better served
   * by a sentence that omits what it does not know than by one that guesses.
   */
  function claim(value, whenTrue, whenFalse, whenUnknown) {
    const state = fact(value);
    if (state === true) return whenTrue;
    if (state === false) return whenFalse;
    return whenUnknown;
  }

  /**
   * Did the server tell us, positively, that it wrote nothing?
   *
   * Two ways to know, both evidence rather than inference:
   *   - the caller knows the endpoint it called cannot write at all (the
   *     pre-flight check), so even a request that died half way changed
   *     nothing; or
   *   - the refusal came back tagged NOTHING_WRITTEN, which the route only
   *     puts on refusals it raised before touching a page.
   *
   * An HTTP status is NOT one of them. That was round 4's defect.
   */
  function serverWroteNothing(opts) {
    return opts.wroteNothing === true || text(opts.code) === NOTHING_WRITTEN;
  }

  /**
   * EVERY claim this file can make, with the fact that licenses it.
   *
   * The test walks this table across a matrix of inputs and fails if a phrase
   * shows up in a message whose fact was not true. That is what makes the rule
   * a rule rather than four fixed bugs: it constrains sentences that have not
   * been written yet.
   */
  const CLAIMS = [
    {
      name: 'the list was reloaded',
      phrase: 'The list has been reloaded',
      licensed: (opts) => opts.listReloaded === true,
    },
    {
      name: 'the list could not be reloaded',
      phrase: 'The list could not be reloaded',
      licensed: (opts) => opts.listReloaded === false,
    },
    {
      name: 'nothing was changed',
      phrase: 'Nothing was changed',
      licensed: (opts) => serverWroteNothing(opts),
    },
    {
      name: 'the archive undoes nothing',
      phrase: 'undoes nothing',
      licensed: (opts) => serverWroteNothing(opts) && opts.archiveTaken === true,
    },
    {
      name: 'pages may already have been changed',
      phrase: 'may already have been changed',
      licensed: (opts) => !serverWroteNothing(opts),
    },
  ];

  // The server's own sentences already end in a full stop; the ones assembled
  // here do not. Appending blindly produced `Take an archive first..` in the
  // one message the operator reads after a refusal.
  function endSentence(value) {
    const body = text(value);
    if (!body) return '';
    return /[.!?]$/.test(body) ? body : `${body}.`;
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
      // The pronoun and the verb both come from the LIVE count, never one from
      // each. `live === unconfirmed.length` picked the pronoun while
      // `plural(live, ...)` picked the verb, so a single unconfirmed live page
      // read "they is live on the public site" — the one sentence the whole
      // read-back exists to produce, ungrammatical at the moment it matters
      // most. Every fixture gave the unconfirmed set two or more members, so
      // nothing caught it.
      const subject = live === unconfirmed.length ? plural(live, 'it', 'they') : `${live} of them`;
      const whereTheyAre = live
        ? `${subject} ${plural(live, 'is', 'are')} live on the public site right now, so check ${plural(live, 'it', 'them')} now or Restore All from Archives`
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
    // "N of the selected ___" is ALWAYS plural — only the verb follows the
    // count. Hanging the noun off plural(n, 'page is', 'pages are') produced
    // "1 of the selected page is live on the public site", in the one sentence
    // this whole read-back exists to produce. Round 3 fixed this in
    // describeBulkTemplateOutcome and left its sibling here holding the bug it
    // had just quoted as the BEFORE.
    const live = liveCount
      ? ` ${liveCount} of the selected pages ${plural(liveCount, 'is', 'are')} live on the public site.`
      : '';
    // THE RELOAD IS A CLAIM. refreshPagesTableAfterBulkChange swallows a failed
    // reload on purpose, and this path is the one where the API is already
    // unhealthy, so the two failures are correlated rather than independent.
    // Asserted flat, this sentence was false exactly when it mattered: the
    // table still showed the pre-change template values while telling the
    // operator it had reloaded, so he checked the column, saw nothing moved and
    // concluded nothing had happened.
    const reloaded = claim(
      opts.listReloaded,
      ' The list has been reloaded.',
      ' The list could not be reloaded, so the Template column may still show the values from before this run.',
      '',
    );
    // "Some pages may already have been changed" IS A CLAIM, and what licenses
    // it is not knowing that nothing was written. A caller that does know must
    // not get this sentence — that is rounds 1 and 2's defect in its other
    // direction, a definite answer rendered as a could-not-tell, and it ends by
    // recommending Restore All, which rolls the whole project back to the
    // archive point and takes any unrelated edit with it.
    //
    // describeBulkTemplateFailure never routes a known no-op here. This branch
    // is for a direct caller, and it exists because the rule is a property of
    // the FUNCTION, not of one path through the file. The claims test found it.
    if (serverWroteNothing(opts)) {
      return {
        message: `${endSentence(reason)} Nothing was changed.${reloaded}`,
        isError: true,
        definite: true,
      };
    }

    return {
      message: `${endSentence(reason)} The request failed part-way, so some pages may already have been changed and some may not.${reloaded}${live} Check the pages, or Restore All from Archives if this is not what you wanted.`,
      isError: true,
      definite: false,
    };
  }

  /**
   * WHICH failure was it? This is the fork the caller must not make by hand.
   *
   * A rejection from App.api is one of two completely different events, and
   * the browser cannot tell them apart by looking at the message:
   *
   *   - The SERVER REFUSED. It answered a structured JSON error with an HTTP
   *     status, which App.api attaches to the thrown Error. Every refusal this
   *     route raises — a missing archive, an id that is not an archive id, an
   *     email template, a template with no sections — happens BEFORE a single
   *     page is written, and the store itself only answers `ok:false` when
   *     zero pages were written. So the answer is definite: nothing changed.
   *
   *   - The REQUEST DIED. A serverless timeout, a dropped connection, a
   *     non-JSON body: no status, and pages may well have been re-poured
   *     already. That is the case describeBulkTemplateInterruption was
   *     written for.
   *
   * The first version ran every rejection through the interruption sentence,
   * so a flat refusal read as:
   *
   *     No archive with id "999999" — nothing was changed. Take an archive
   *     first.. The request failed part-way, so some pages may already have
   *     been changed and some may not … or Restore All from Archives if this
   *     is not what you wanted.
   *
   * — a definite answer rendered as a could-not-tell, contradicting itself in
   * one breath and then recommending Restore All, which rolls every page in
   * the project back to the archive point and takes any unrelated edit made
   * since with it. A destructive action recommended in response to a no-op.
   *
   * When the server refused, say what it said and NOTHING else — except, when
   * an archive was already taken, that the archive is there. Otherwise the
   * Archives list grows an entry the operator cannot account for.
   */
  function describeBulkTemplateFailure(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const status = Number(opts.status);

    // EVIDENCE, NOT INFERENCE. This used to be `status >= 400`, and that is a
    // guess about who decided: routes/index.js answers an unhandled throw with
    // a well-formed JSON 500, and sbQuery throws when a response body read
    // fails (await res.text() sits outside the try that wraps fetch). Measured
    // in round 4 by making the second page's PATCH die: page one HAD been
    // re-poured, and the operator was told
    //
    //   socket hang up. An archive was saved just before this, so Archives has
    //   a new entry that undoes nothing.
    //
    // — pointed away from the only undo the operation has, right after real
    // damage. So the definite branch now needs the server to SAY it wrote
    // nothing. Anything else, including a 500, is a could-not-tell and gets the
    // interruption sentence, which claims nothing in either direction.
    const wroteNothing = serverWroteNothing(opts);

    if (!wroteNothing) {
      return describeBulkTemplateInterruption({
        error: opts.error,
        liveCount: opts.liveCount,
        listReloaded: opts.listReloaded,
      });
    }

    const reason = endSentence(text(opts.error) || `The request was refused${Number.isFinite(status) ? ` (${status})` : ''}`);
    // The route's own refusals already say "nothing was changed" in their
    // message; a request that died on the pre-flight check has said nothing at
    // all, so this supplies it. Both are licensed by the same fact.
    const nothingChanged = opts.wroteNothing === true && !Number.isFinite(status) ? ' Nothing was changed.' : '';
    // Only sayable because nothing was written — that is what makes "undoes
    // nothing" true rather than a guess. Without the archive note the Archives
    // list grows an entry the operator cannot account for, on the list he is
    // being told to restore from.
    const archiveNote = opts.archiveTaken === true
      ? ' An archive was saved just before this, so Archives has a new entry that undoes nothing.'
      : '';
    return {
      message: `${reason}${nothingChanged}${archiveNote}`,
      isError: true,
      definite: true,
    };
  }

  return {
    tallyBulkTemplateRows,
    describeBulkTemplateOutcome,
    describeBulkTemplateInterruption,
    describeBulkTemplateFailure,
    // The rule's own machinery, exported so the route and the test speak the
    // same words rather than two copies of them.
    NOTHING_WRITTEN,
    CLAIMS,
    fact,
    claim,
  };
});
