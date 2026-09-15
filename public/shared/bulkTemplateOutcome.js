/**
 * What the bulk template change TELLS the operator — before it runs, and after.
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
 * THE SENTENCE BEFORE THE BUTTON IS PRESSED (2026-09-14, ticket 86bc09db9).
 *
 * describeBulkTemplateChangePlan is the newest thing here and the only one
 * that runs before anything happens. Until that date the dialog said the
 * sections on these pages "will be REPLACED with the chosen template's
 * layout", which was true — the operation re-poured — and it is what the
 * operator read on 2026-09-13 before moving 57 Delray Beach Tennis Center
 * pages onto the "Public Website" template. Every one lost its content. He
 * published twenty minutes later, so 51 pages read "Replace this section with
 * real content." to visitors for about eighteen hours.
 *
 * The write path keeps the body now. So the warning leads with what is KEPT,
 * the way describeTemplateFrameChange already does for the single-page control
 * in the editor — and it names the number, because "your content is safe" with
 * no figure attached is exactly the reassurance this control has spent two
 * incidents disproving.
 *
 * The count comes from the rows the browser is holding, and it is a CLAIM
 * under the rule above: a page whose layout this screen could not read
 * contributes nothing to the number, so the number is not stated at all. The
 * sentence says how many pages it could not read instead.
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
   * FRAME OR BODY — the browser's copy of the one rule that matters here.
   *
   * A section is frame when it is a live link to a saved section; everything
   * else is the page's own work. The authority is isFrameSection in
   * lib/builder-client/builder-template-frame.ts, which the server reaches
   * through the generated lib/builder/template-frame.js. This is a second
   * copy, deliberately and for the same reason NOTHING_WRITTEN is: nothing
   * under public/ can require out of lib/, because these files load as plain
   * <script> tags. bulkTemplateOutcome.test.js drives BOTH over the same
   * matrix and fails if they ever classify one section differently, so the
   * dialog cannot start counting a different thing from the code that writes.
   */
  function isFrameSectionLike(section) {
    if (!section || typeof section !== 'object') return false;
    return section.canonical === true && Boolean(section.savedSectionId);
  }

  /**
   * How much of the operator's own work is in this selection.
   *
   * `pageSections` is one entry per selected page: that page's section list,
   * or anything at all if the browser does not have it. An entry that is not
   * an array is counted as UNREADABLE and contributes nothing to the total —
   * never zero, which would quietly shrink the number the operator is about to
   * trust.
   */
  function countBulkTemplateBody(pageSections) {
    const list = Array.isArray(pageSections) ? pageSections : [];
    let bodyCount = 0;
    let unreadable = 0;
    for (const sections of list) {
      if (!Array.isArray(sections)) {
        unreadable += 1;
        continue;
      }
      for (const section of sections) {
        if (!isFrameSectionLike(section)) bodyCount += 1;
      }
    }
    return { pages: list.length, readable: list.length - unreadable, unreadable, bodyCount };
  }

  /**
   * HOW MUCH OF THE SELECTION THIS SCREEN ACTUALLY READ.
   *
   * `countBulkTemplateBody` can only count what it was handed, and the caller
   * hands it one entry per selected page — when it remembers to. Called with
   * no `pageSections` at all it answers `pages: 0, unreadable: 0`, which reads
   * as "every page was read and none of them has any content", and the plan
   * then tells the operator "there is nothing to lose here" about five pages
   * it never looked at. That is round 4's rule broken in its original
   * direction: a could-not-tell rendered as a definite answer, on the one
   * sentence this dialog exists to make trustworthy.
   *
   * So completeness is a question about the SELECTION, not about the entries:
   * every selected page must have contributed a readable layout. An entry that
   * was never supplied and an entry that could not be parsed are the same fact
   * and are counted together.
   */
  function readBulkTemplateBody(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const counted = countBulkTemplateBody(opts.pageSections);
    // A `pageCount` THAT WAS NEVER GIVEN IS A COULD-NOT-TELL, not a zero and
    // not "however many layouts I happen to hold" (2026-09-14 round-3 review).
    // It used to fall back to `counted.pages`, which makes the selection size
    // agree with the layouts by construction — so `complete` came out true and
    // the whole family of counted sentences was licensed about a selection
    // nobody had stated the size of. That is the exact hole this function's own
    // comment says it closed, surviving in the one shape the comment does not
    // cover: the function was reading the selection off its own input.
    const pageCountKnown = Number.isFinite(Number(opts.pageCount));
    const pageCount = pageCountKnown
      ? Math.max(0, Math.trunc(Number(opts.pageCount)))
      : counted.pages;
    return {
      counted,
      pageCount,
      pageCountKnown,
      // Both directions. More layouts than pages is a caller bug rather than a
      // reachable state, and it would make the count an OVERstate — the same
      // defect with the sign flipped, so it is not licensed either.
      complete: pageCountKnown && counted.unreadable === 0 && counted.pages === pageCount,
      missing: pageCountKnown ? Math.max(0, pageCount - counted.readable) : 0,
    };
  }

  // The operator's name for a section, or an honest placeholder. Mirrors
  // sectionLabel in lib/builder-client/builder-template-frame.ts.
  function sectionLabelLike(section) {
    const title = section && typeof section.title === 'string' ? section.title.trim() : '';
    return title || 'Untitled section';
  }

  /**
   * WHICH SHARED SECTIONS THE SELECTION LOSES.
   *
   * applyTemplateFrame keeps the page's body and replaces its frame with the
   * template's, so a shared section the chosen template does not carry is
   * DROPPED. The single-page control in the editor says so by name
   * (describeTemplateFrameChange); the bulk dialog said only that the shared
   * sections are "replaced", which describes a swap and hides a removal.
   *
   * `templateSections` is the chosen template's layout. Until a template is
   * picked there is nothing to compare against and the answer is `known:
   * false` — not an empty list, which would read as "nothing is lost".
   */
  /**
   * Does the chosen template carry a shared header or footer AT ALL?
   *
   * `known: false` until a template is picked. A template made entirely of
   * ordinary sections carries no frame, and applying it takes each page's
   * shared sections off and puts nothing back — the server refuses it
   * (describeBulkTemplateTarget), and the dialog has to say so before the
   * button is pressed rather than letting the operator walk into the refusal.
   */
  function countBulkTemplateFrame(templateSections) {
    if (!Array.isArray(templateSections)) return { known: false, count: 0 };
    let count = 0;
    for (const section of templateSections) {
      if (isFrameSectionLike(section)) count += 1;
    }
    return { known: true, count };
  }

  function countBulkTemplateFrameLoss(pageSections, templateSections) {
    if (!Array.isArray(templateSections)) return { known: false, names: [], pages: 0 };
    const incoming = new Set();
    for (const section of templateSections) {
      if (isFrameSectionLike(section)) incoming.add(String(section.savedSectionId));
    }
    const list = Array.isArray(pageSections) ? pageSections : [];
    // DEDUPED ON THE SAVED SECTION, NOT ON WHAT IT IS CALLED.
    //
    // `seen` used to key on the display label, and the label for a section with
    // no title is the constant 'Untitled section' — so two genuinely different
    // untitled shared sections collapsed into one entry and the operator
    // approved the removal of one while two went (2026-09-14 round-2 review).
    // savedSectionId is what identifies a shared section, and
    // isFrameSectionLike has already guaranteed it is there.
    //
    // An untitled one is COUNTED but not named, because it has no name to give:
    // listing 'Untitled section' twice reads as a rendering fault rather than
    // as two sections. The sentence says how many there are instead.
    const names = [];
    const seen = new Set();
    let untitled = 0;
    let pages = 0;
    for (const sections of list) {
      if (!Array.isArray(sections)) continue;
      let lost = 0;
      for (const section of sections) {
        if (!isFrameSectionLike(section)) continue;
        const id = String(section.savedSectionId);
        if (incoming.has(id)) continue;
        lost += 1;
        if (seen.has(id)) continue;
        seen.add(id);
        const title = section && typeof section.title === 'string' ? section.title.trim() : '';
        if (title) names.push(title);
        else untitled += 1;
      }
      if (lost) pages += 1;
    }
    // `removed` is the number the operator is approving; `names` is only what
    // can be said out loud about it. They differ exactly when a removed shared
    // section has no title, which is why the count is reported separately
    // rather than derived from the list's length.
    return { known: true, names, untitled, removed: seen.size, pages };
  }

  /**
   * WHICH PAGES WOULD END UP SHOWING THEIR HEADER TWICE.
   *
   * 2026-09-14 round-3 review, ticket 86bc09db9. A section counts as shared
   * furniture only when it is a live LINK to a saved section, so a page
   * carrying a plain, UNLINKED copy of the same header is body — kept,
   * correctly — and the template's live header is then added around it. The
   * page comes out with both, and the dialog's own sentence is what stops the
   * operator looking: "All 5 content sections on this page are kept exactly as
   * they are" is literally true, and four of those five ARE his header and
   * footer.
   *
   * The server refuses such a page rather than writing it
   * (describeFrameDuplication in lib/builderPagesStore.js). This is the half
   * that says so BEFORE the button is pressed, so the refusal is not walked
   * into blind — the same reason the frameless-template block is stated here
   * rather than left as an error afterwards.
   *
   * `templateSections` must be the RESOLVED frame the server will apply, not
   * the template's stored references; the two differ whenever a master has
   * been deleted. The dialog gets it from the check endpoint, which computes
   * it from the live masters.
   *
   * Matched by NAME or by section id, which is the same resemblance test the
   * server refuses on — stated once in each place rather than shared, because
   * one runs in Node against sections and the other in the browser against
   * whatever the rows are holding; scripts/builder/bulkTemplateOutcome.test.js
   * walks a matrix across both and fails if they ever disagree about a page.
   */
  function countBulkTemplateFrameDuplicates(pageSections, templateSections) {
    if (!Array.isArray(templateSections)) return { known: false, names: [], untitled: 0, sections: 0, pages: 0 };
    const incomingTitles = new Set();
    const incomingIds = new Set();
    for (const section of templateSections) {
      if (!isFrameSectionLike(section)) continue;
      const title = section && typeof section.title === 'string' ? section.title.trim().toLowerCase() : '';
      if (title) incomingTitles.add(title);
      const id = String(section?.id ?? '');
      if (id) incomingIds.add(id);
    }
    const list = Array.isArray(pageSections) ? pageSections : [];
    const names = [];
    const seen = new Set();
    let untitled = 0;
    let sections = 0;
    let pages = 0;
    for (const page of list) {
      if (!Array.isArray(page)) continue;
      let doubled = 0;
      for (const section of page) {
        if (isFrameSectionLike(section)) continue;
        const raw = section && typeof section.title === 'string' ? section.title.trim() : '';
        const title = raw ? raw.toLowerCase() : '';
        const id = String(section?.id ?? '');
        // An empty title is not a name and matches nothing, or every untitled
        // section on the page would read as a duplicate of every untitled
        // shared section.
        if (!((title && incomingTitles.has(title)) || (id && incomingIds.has(id)))) continue;
        doubled += 1;
        const key = title || `id:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (raw) names.push(raw);
        else untitled += 1;
      }
      if (doubled) { pages += 1; sections += doubled; }
    }
    // THREE counts, and they are three different questions: how many PAGES are
    // affected, how many DISTINCT sections are named, and how many occurrences
    // there are in total. A page carrying four of them is one page and four
    // sections; two pages both carrying the footer is two pages, one distinct
    // name and two occurrences. `distinct` is the one the printed list matches,
    // so it is the one the sentence's nouns agree with — quoting `sections`
    // beside a list of `names` invites the operator to count them and find they
    // do not add up.
    return { known: true, names, untitled, distinct: seen.size, sections, pages };
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
    // ── The sentence shown BEFORE the button is pressed ──────────────────
    {
      // The count of content sections that survive the change. Licensed only
      // when the browser could read EVERY selected page's layout: one page it
      // could not read makes the total an undercount, and an undercount of
      // "how much of your work is safe" is the same defect as the one this
      // whole dialog was reworded for.
      //
      // "Every selected page" is the test, not "every entry I was given".
      // Licensing this on `unreadable === 0` alone let a caller that passed no
      // layouts at all — the shape a new call site arrives in — license the
      // whole family of counted sentences.
      name: 'a content-section count',
      phrase: 'kept exactly as',
      licensed: (opts) => readBulkTemplateBody(opts).complete,
    },
    {
      // The same fact, and the sentence that needs it most: this one tells the
      // operator there is NOTHING to lose. Read off a selection nobody looked
      // at, it is the most reassuring sentence in the file and the least
      // supported.
      name: 'the pages have no content to lose',
      phrase: 'nothing to lose here',
      licensed: (opts) => readBulkTemplateBody(opts).complete,
    },
    {
      // Naming the shared sections that go needs BOTH the chosen template's
      // layout to compare against and every page's layout to look in.
      name: 'which shared sections are removed',
      phrase: 'will be removed',
      licensed: (opts) => readBulkTemplateBody(opts).complete
        && countBulkTemplateFrameLoss(opts.pageSections, opts.templateSections).known,
    },
    {
      // "Nothing is lost" is a claim too, and a stronger one than naming what
      // is: it has to hold for every page in the selection.
      name: 'no shared section is removed',
      phrase: 'No shared section is removed',
      licensed: (opts) => readBulkTemplateBody(opts).complete
        && countBulkTemplateFrameLoss(opts.pageSections, opts.templateSections).known,
    },
    {
      // Naming the pages the server will refuse needs BOTH the resolved frame
      // to compare against and every page's layout to look in — the same two
      // facts the removal sentence needs, and for the same reason: a page this
      // screen could not read is a page whose doubling it cannot see.
      name: 'which pages would show a section twice',
      phrase: 'would show',
      licensed: (opts) => readBulkTemplateBody(opts).complete
        && countBulkTemplateFrameDuplicates(opts.pageSections, opts.templateSections).known,
    },
    {
      // And the reassuring direction, which is the stronger claim: it has to
      // hold for every page in the selection, so an unread page forbids it.
      name: 'no page would show a section twice',
      phrase: 'No page ends up showing',
      licensed: (opts) => readBulkTemplateBody(opts).complete
        && countBulkTemplateFrameDuplicates(opts.pageSections, opts.templateSections).known,
    },
    {
      name: 'pages are live on the public site',
      phrase: 'live on the public site',
      licensed: (opts) => Number(opts.liveCount) > 0,
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

  /**
   * WHAT IS ABOUT TO HAPPEN — the dialog's warning, before anything is written.
   *
   * Leads with what is KEPT, because the fear this control has earned is "will
   * it eat my page again" and the first line has to answer that. Same order
   * describeTemplateFrameChange uses for the single-page control in the
   * editor, and now the same underlying behaviour.
   *
   *   pageCount    how many pages are selected
   *   pageSections one entry per selected page: that page's section list
   *   liveCount    how many of them a visitor can already see
   *   archived     whether an archive is taken first (the caller knows; it is)
   *
   * The COUNT is the claim. A page this screen could not read contributes
   * nothing to it, and the sentence then says how many it could not read
   * rather than quoting a total that is quietly short.
   */
  function describeBulkTemplateChangePlan(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const reading = readBulkTemplateBody(opts);
    const { counted, pageCount } = reading;
    const liveCount = Number.isFinite(Number(opts.liveCount))
      ? Math.max(0, Math.trunc(Number(opts.liveCount)))
      : 0;
    const frameLoss = countBulkTemplateFrameLoss(opts.pageSections, opts.templateSections);

    // THE DEAD END, NAMED BEFORE IT IS WALKED INTO. A template with no shared
    // header or footer of its own is refused by the server, and the reason is
    // worth more here than in an error afterwards: nothing about the picker
    // distinguishes such a template, and in a copy of the production database
    // 36 of 43 page templates are that shape. `blocked` is what the caller
    // reads to keep the button off.
    const templateFrame = countBulkTemplateFrame(opts.templateSections);
    if (templateFrame.known && templateFrame.count === 0) {
      return {
        message: 'The chosen template carries no shared header or footer of its own, so moving pages onto it '
          + 'would take the shared sections off them and put nothing back. Pick a template that has a shared '
          + 'header or footer, or change the template on a single page from inside the page editor, where you '
          + 'can see exactly what each page loses.',
        isError: true,
        blocked: true,
        counts: {
          pages: reading.pageCount,
          bodyCount: null,
          unreadable: counted.unreadable,
          unread: reading.missing,
          frameRemoved: null,
          frameDuplicated: null,
          liveCount,
        },
      };
    }

    const parts = [];

    if (!reading.complete) {
      // No number. The claims table refuses every counted phrasing here, and
      // the reason is said out loud rather than left as a vaguer sentence — an
      // operator who cannot see why a count is missing reads the omission as
      // the count being zero.
      //
      // TWO WAYS TO BE INCOMPLETE, and the sentence has to fit the one that
      // happened. A layout that could not be read and a page whose layout was
      // never handed over are the same fact to the operator, so they share a
      // sentence; being given MORE layouts than pages is a caller bug and
      // cannot be phrased as "could not read N of M" without inventing a
      // number, so it says what it actually has.
      const keepsRule = 'Each page keeps its own content sections; only the shared header and footer '
        + 'sections are replaced with the ones the chosen template carries. ';
      // THREE ways to be incomplete, and the sentence has to fit the one that
      // happened. A layout that could not be read and a page whose layout was
      // never handed over are the same fact to the operator, so they share a
      // sentence; being given MORE layouts than pages is a caller bug and
      // cannot be phrased as "could not read N of M" without inventing a
      // number; and not being told the size of the selection at all is neither
      // of those — there is no M to count against, so saying "N of M" would be
      // quoting a total this screen made up out of its own input.
      parts.push(
        !reading.pageCountKnown
          ? `${keepsRule}This screen was not told how many pages are selected, so it cannot tell you the `
            + 'exact number it is keeping.'
          : reading.missing > 0
            ? `${keepsRule}This screen could not read the layout of `
              + `${reading.missing} of the ${pageCount} selected ${plural(pageCount, 'page', 'pages')}, `
              + 'so it cannot tell you the exact number it is keeping.'
            : `${keepsRule}This screen was handed `
              + `${counted.pages} page ${plural(counted.pages, 'layout', 'layouts')} for `
              + `${pageCount} selected ${plural(pageCount, 'page', 'pages')}, so it cannot tell you the exact `
              + 'number it is keeping.',
      );
    } else if (counted.bodyCount === 0) {
      parts.push(
        plural(
          pageCount,
          'This page has no content sections of its own',
          'These pages have no content sections of their own',
        ) + ', so there is nothing to lose here — only the shared header and footer sections change.',
      );
    } else {
      // "on these pages" is wrong for a selection of one, and a warning whose
      // grammar does not match what the operator ticked reads as a warning
      // about somebody else's pages.
      const where = plural(pageCount, 'on this page', 'on these pages');
      parts.push(
        counted.bodyCount === 1
          ? `The 1 content section ${where} is kept exactly as it is.`
          : `All ${counted.bodyCount} content sections ${where} are kept exactly as they are.`,
        'Only the shared header and footer sections are replaced with the ones the chosen template carries.',
      );
    }

    // WHAT GOES, NOT ONLY WHAT ARRIVES. "Replaced" describes a swap, and a
    // shared section the chosen template does not carry is not swapped — it is
    // removed, and nothing takes its place. The single-page control in the
    // editor has always named those; this one said only "replaced", so an
    // operator moving 57 pages was told about the arrivals and not the
    // departures.
    //
    // Until a template is chosen there is nothing to compare against, so the
    // rule is stated instead of the outcome. That is a description of the
    // operation rather than a claim about this selection, which is why it is
    // sayable with no facts in hand.
    if (!frameLoss.known || !reading.complete) {
      parts.push(
        'Any shared section a page carries that the chosen template does not is taken off that page — it '
          // Same claim, stated as the rule rather than about this selection —
          // and with the same condition on it, for the same reason.
          + 'stays in Saved Sections and can be added back from there, as long as it is still on that list.',
      );
    } else if (!frameLoss.removed) {
      parts.push(
        'No shared section is removed: every shared section these pages carry is in the chosen template too.',
      );
    } else {
      const wherePages = frameLoss.pages === pageCount
        ? plural(pageCount, 'this page', 'every selected page')
        : `${frameLoss.pages} of the ${pageCount} selected ${plural(pageCount, 'page', 'pages')}`;
      // The count comes from `removed`, never from the list's length: an
      // untitled shared section is removed just the same and has no name to
      // print, so a sentence counting the names would understate what goes.
      const untitledPart = frameLoss.untitled
        ? `${frameLoss.names.length ? ' and ' : ''}${frameLoss.untitled} `
          + `${plural(frameLoss.untitled, 'shared section with no title', 'shared sections with no title')}`
        : '';
      parts.push(
        `${plural(frameLoss.removed, 'This shared section is', 'These shared sections are')} not in the `
          + `chosen template and will be removed from ${wherePages}: `
          + `${frameLoss.names.join(', ')}${untitledPart}. `
          // "can be put back" IS A CLAIM, and it has a case where it is false.
          // Measured on the local database while closing this ticket: a
          // template referencing a master that has since been DELETED resolves
          // without it, so the page's copy is removed — and there is nothing
          // left in Saved Sections to add back. The archive, which the last
          // line of this dialog already names, is the undo that always exists.
          + `${plural(frameLoss.removed, 'It is a saved section', 'They are saved sections')}, so `
          + `${plural(frameLoss.removed, 'it', 'they')} can be added back from Saved Sections as long as `
          + `${plural(frameLoss.removed, 'it is', 'they are')} still on that list.`,
      );
    }

    // AND WHAT THE SERVER WILL REFUSE. A page carrying its own unlinked copy of
    // a section the template also brings would come out showing it twice, so
    // that page is not written at all — and the operator has to know which
    // pages those are BEFORE he presses the button, or a 57-page run comes
    // back with two refusals he cannot account for.
    //
    // This does not block the button: the other pages in the selection are
    // fine and go through. It is the one sentence in this dialog that is about
    // a subset rather than about all of them, so it names them.
    const doubled = countBulkTemplateFrameDuplicates(opts.pageSections, opts.templateSections);
    if (doubled.known && reading.complete) {
      if (doubled.pages) {
        const untitledPart = doubled.untitled
          ? `${doubled.names.length ? ', and ' : ''}${doubled.untitled} `
            + `${plural(doubled.untitled, 'section with no title', 'sections with no title')}`
          : '';
        const listed = doubled.names.length || doubled.untitled
          ? ` — ${doubled.names.join(', ')}${untitledPart}`
          : '';
        const who = doubled.pages === pageCount
          ? plural(pageCount, 'This page', `All ${pageCount} of these pages`)
          : `${doubled.pages} of the ${pageCount} selected ${plural(pageCount, 'page', 'pages')}`;
        // TWO counts govern two different words in the same clause, and it is
        // exactly the slip landmine 17 names. The VERB and the possessive
        // follow how many PAGES are affected; the noun — "copy of a section"
        // against "copies of sections" — follows how many DISTINCT sections are
        // named, because that is what the list after the dash holds. Keying
        // both off the page count produced "This page carries its own copy of a
        // section … — Contact Strip, Footer Menu", which reads as a rendering
        // fault.
        const verb = plural(doubled.pages, 'carries', 'carry');
        const possessive = plural(doubled.pages, 'its own', 'their own');
        const object = plural(doubled.distinct, 'copy of a section', 'copies of sections');
        parts.push(
          `${who} ${verb} ${possessive} ${object} the chosen template also brings as `
            + `${plural(doubled.distinct, 'a shared header or footer', 'shared headers or footers')}`
            + `${listed}. ${plural(doubled.pages, 'It', 'They')} would show both, so `
            + `${plural(doubled.pages, 'this page is', 'those pages are')} left unchanged and named in the `
            + `report; open ${plural(doubled.pages, 'it', 'them')} in the page editor, delete `
            + `${plural(doubled.pages, "the page's", "each page's")} own `
            + `${plural(doubled.distinct, 'copy', 'copies')}, then run this again.`,
        );
      } else {
        parts.push(
          'No page ends up showing a section twice: none of these pages carries its own copy of a section '
            + 'the chosen template brings.',
        );
      }
    }

    parts.push('Each page also keeps its own background and theme.');

    if (liveCount) {
      // WHERE THE PAGES ARE. A page with no published snapshot is served
      // straight from its draft, so on a project that has never published
      // there is no publish step between this button and a visitor.
      //
      // THE SUBJECT IS THE LIVE COUNT AND SO IS THE VERB. Taking one from the
      // live count and the other from the selection is the defect round 3
      // found in describeBulkTemplateOutcome — "they is live on the public
      // site" — and the first draft of this sentence had it back again as
      // "1 of these pages are live". `${liveCount} of the ${pageCount}` is
      // also wrong when the two are equal ("1 of the 1 selected page"), so
      // that case gets its own phrasing rather than a shared template.
      const subject = liveCount === pageCount
        ? plural(pageCount, 'This page', `All ${pageCount} of these pages`)
        : `${liveCount} of the ${pageCount} selected ${plural(pageCount, 'page', 'pages')}`;
      parts.push(
        `${subject} ${plural(liveCount, 'is', 'are')} live on the public site, `
          + 'so a visitor sees the new header and footer as soon as this finishes — there is no separate '
          + 'publish step.',
      );
    }

    parts.push(
      'An archive of all your pages is saved first, and Restore All on that archive undoes this — along '
        + 'with any other page edits made after it was taken.',
    );

    return {
      message: parts.join(' '),
      isError: false,
      blocked: false,
      counts: {
        pages: pageCount,
        // null, never a number, when the reading was incomplete — a caller
        // reading this back must not find a figure the message refused to say.
        bodyCount: reading.complete ? counted.bodyCount : null,
        unreadable: counted.unreadable,
        unread: reading.missing,
        frameRemoved: frameLoss.known && reading.complete ? frameLoss.removed : null,
        // How many pages the server will refuse, and null — never 0 — when
        // this screen could not work it out.
        frameDuplicated: doubled.known && reading.complete ? doubled.pages : null,
        liveCount,
      },
    };
  }

  return {
    tallyBulkTemplateRows,
    isFrameSectionLike,
    countBulkTemplateBody,
    readBulkTemplateBody,
    countBulkTemplateFrame,
    countBulkTemplateFrameLoss,
    countBulkTemplateFrameDuplicates,
    describeBulkTemplateChangePlan,
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
