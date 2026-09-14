'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * The bulk template change, end to end through a fake database.
 *
 * The predicate tests beside this one cover which templates may be targeted.
 * These cover what actually happens to a page when one is, and every property
 * here is an incident this repo has already paid for:
 *
 *  - the template's FRAME is applied and the page's own content is kept
 *    (2026-09-13: this operation re-poured 57 Delray pages and 51 of them
 *    served "Replace this section with real content." to visitors for about
 *    eighteen hours — ticket 86bc09db9)
 *  - the frame is resolved against the LIVE saved-section masters, never the
 *    stale copy a template happens to carry (2026-08-15: a 41-minute-old menu
 *    on 34 pages)
 *  - a failed read of those masters refuses the whole run rather than writing
 *    every page with its header and footer silently dropped
 *  - the page's OWN pageBackground and theme survive (landmine 13 — naming any
 *    of the three makes the serializer write all three, so a write that sends
 *    layoutSections alone silently blanks the other two)
 *  - each page is read back after writing and the answer says whether it
 *    matched (2026-08-16: fourteen pages emptied, every write reporting
 *    success)
 *  - a page that fails does not stop the others, and is named
 */

const supabasePath = require.resolve('../../lib/supabase');
const storePath = require.resolve('../../lib/builderPagesStore');
const templatesPath = require.resolve('../../lib/builderPageTemplatesStore');
const savedSectionsPath = require.resolve('../../lib/builderSavedSectionsStore');
const revisionsPath = require.resolve('../../lib/builderPageRevisionsStore');
const scopePath = require.resolve('../../lib/projectScope');

function makeStore({
  pages,
  templates,
  // The live masters the frame resolves against. Default to the real pair the
  // fixtures below reference, so a test that is not about them still exercises
  // a resolving frame rather than an empty one.
  savedSections = [HEADER_MASTER, FOOTER_MASTER],
  failSavedSections = false,
  failPageIds = [],
  silentlyDropPageIds = [],
  blindReadBackPageIds = [],
}) {
  // builderSavedSectionsStore destructures sbQuery at load time and caches
  // whether the table is supported, so a stale copy would hold the PREVIOUS
  // test's fake. It is required lazily by the page store, which means it loads
  // after the fake is installed — but only if it was purged first.
  for (const p of [supabasePath, storePath, templatesPath, savedSectionsPath, revisionsPath, scopePath]) {
    delete require.cache[p];
  }
  const supabase = require(supabasePath);
  const rows = pages.map((r) => ({ ...r }));
  const written = new Set();
  // Every call the store makes, in order. What a write path COSTS is part of
  // its behaviour here: this runs on a serverless function that has already
  // truncated a 50-page canonical propagation at 30, so an avoidable read per
  // page is a page that does not get changed at the top of the range.
  const calls = [];

  supabase.isConfigured = () => true;
  supabase.tableConfig = () => ({
    builderPages: 'builder_landing_page',
    builderPageTemplates: 'builder_page_templates',
    builderPageRevisions: 'builder_page_revisions',
    builderSavedSections: 'builder_saved_sections',
  });
  supabase.sbQuery = async ({ method = 'GET', table = '', query = '', body }) => {
    // The tenant-column probe (lib/projectScope). Say no: these tests run with
    // no scope, so scoping is not what they are about.
    if (method === 'GET' && /select=project_id/.test(query)) {
      return { ok: false, status: 400, error: 'column does not exist' };
    }
    calls.push({ method, table, query, body });
    if (table === 'builder_page_revisions') return { ok: true, data: [] };
    if (table === 'builder_page_templates') {
      return { ok: true, data: templates.map((t) => ({ ...t })) };
    }
    if (table === 'builder_saved_sections') {
      // NOT a missing-table error: the store treats "the table is not there" as
      // a reason to fall back to its local JSON file, and the case being
      // modelled here is a table that IS there and would not answer.
      if (failSavedSections) return { ok: false, status: 500, error: 'permission denied for builder_saved_sections' };
      return { ok: true, data: savedSections.map((row) => ({ ...row })) };
    }
    if (table === 'builder_landing_page') {
      const id = (query.match(/id=eq\.(\d+)/) || [])[1];
      if (method === 'GET') {
        // Only the read-back is blinded, not the read the write itself needs —
        // otherwise the test would be about a page that cannot be loaded.
        if (blindReadBackPageIds.map(String).includes(String(id)) && written.has(String(id))) {
          return { ok: false, status: 500, error: 'read failed' };
        }
        const row = rows.find((r) => String(r.id) === String(id));
        return { ok: true, data: row ? [{ ...row }] : [] };
      }
      if (method === 'PATCH') {
        if (failPageIds.map(String).includes(String(id))) {
          return { ok: false, status: 500, error: 'permission denied for this page' };
        }
        const row = rows.find((r) => String(r.id) === String(id));
        if (!row) return { ok: false, status: 404, error: 'not found' };
        // The 2026-08-16 shape: the database answers 200 and the row does not
        // change. Fourteen pages were emptied this way with every write
        // reporting success, which is why the read-back exists at all.
        if (silentlyDropPageIds.map(String).includes(String(id))) {
          return { ok: true, data: [{ ...row }] };
        }
        Object.assign(row, body && typeof body === 'object' ? body : {});
        written.add(String(id));
        return { ok: true, data: [{ ...row }] };
      }
    }
    return { ok: false, status: 500, error: `unexpected ${method} on ${table}` };
  };

  return { store: require(storePath), rows, calls };
}

// layout_sections is a jsonb column: it is read back as an object, and the
// serializer writes an object. The seed rows below use a JSON string because
// that is the other shape the reader has to cope with, so this helper reads
// whichever one is actually there rather than assuming.
function docOf(row) {
  const raw = row.layout_sections;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/**
 * FRAME AND BODY, in the fixtures as well as in the code.
 *
 * A section is FRAME when it is a live link to a saved section (`canonical`
 * plus `savedSectionId`); everything else is the page's own body. Every
 * fixture in this file used to be body-only on both sides, which is precisely
 * why "the sections are replaced with the template's" read as correct for
 * months: with no frame anywhere, the distinction the operation turns on was
 * invisible to every test.
 */
const HEADER_MASTER = {
  id: 'ss-header',
  name: 'Public Header',
  section: {
    id: 'master-header',
    title: 'Public Header',
    canonical: true,
    savedSectionId: 'ss-header',
    // v2 — the CURRENT master. The template below carries a bare reference, so
    // this is the content that must end up on the page.
    modules: [{ id: 'm-header', type: 'text', settings: { text: 'HEADER v2' } }],
  },
};

const FOOTER_MASTER = {
  id: 'ss-footer',
  name: 'Footer Menu',
  section: {
    id: 'master-footer',
    title: 'Footer Menu',
    canonical: true,
    savedSectionId: 'ss-footer',
    modules: [{ id: 'm-footer', type: 'text', settings: { text: 'FOOTER v2' } }],
  },
};

/** A live link to a saved section, as a page or a template stores one. */
function frameRef(id, savedSectionId, title) {
  return { id, title, canonical: true, savedSectionId };
}

/**
 * A page carrying an OLD frame, two of its own content sections, and its own
 * background and theme — none of which the move may touch.
 */
function pageRow(id, name) {
  return {
    id,
    name,
    page_template_id: '27',
    layout_sections: JSON.stringify({
      sections: [
        frameRef('page-old-header', 'ss-old-header', 'Old Header'),
        { id: 'old-a', type: 'text' },
        { id: 'old-b', type: 'image' },
      ],
      pageBackground: { mode: 'color', color: '#123456' },
      theme: { typography: { colors: { text: '#ff0000' }, scale: { baseSize: 18 } } },
    }),
  };
}

/** The page's own content, in order — what must survive the change. */
const PAGE_BODY_IDS = ['old-a', 'old-b'];

/**
 * The template: a header reference, a body marker, a footer reference.
 *
 * The body marker is the template's own non-canonical section. It is NOT
 * copied onto the page — its POSITION is the whole of its job, marking where
 * the page's body belongs between the frame that leads and the frame that
 * trails.
 */
const NEW_TEMPLATE = {
  id: '47',
  name: 'Blog Home Template',
  template_kind: 'modular',
  layout_sections: JSON.stringify({
    sections: [
      frameRef('tpl-header', 'ss-header', 'Public Header'),
      { id: 'tpl-body-marker', type: 'text' },
      frameRef('tpl-footer', 'ss-footer', 'Footer Menu'),
    ],
    pageBackground: { mode: 'color', color: '#ffffff' },
    theme: { typography: { colors: { text: '#00ff00' }, scale: { baseSize: 99 } } },
  }),
};

test('every named page ends up on the new template, inside the template\'s frame', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
  });

  const res = await store.bulkSetPageTemplate([1, 2], '47');
  assert.equal(res.ok, true);
  assert.equal(res.templateName, 'Blog Home Template');
  assert.equal(res.data.length, 2);
  assert.ok(res.data.every((row) => row.ok));

  for (const row of rows) {
    assert.equal(row.page_template_id, '47');
    const doc = docOf(row);
    // Header, the page's own two sections in order, footer. The template's own
    // body marker is not copied; the page's old header is gone because the new
    // template does not carry it.
    assert.deepEqual(
      doc.sections.map((s) => s.savedSectionId || s.id),
      ['ss-header', 'old-a', 'old-b', 'ss-footer'],
    );
  }
});

/**
 * THE ONE THIS TICKET WAS FILED FOR (86bc09db9).
 *
 * On 2026-09-13 the operator selected 57 Delray Beach Tennis Center pages and
 * used Change Template to bring them onto "Public Website". Every one lost its
 * content, he published twenty minutes later, and 51 pages on
 * delraytennis.starcaster.pro read "Replace this section with real content."
 * to visitors for about eighteen hours. The single-page control in the editor
 * had never done this — it swaps the frame and keeps the body — so the two
 * controls with the same name did opposite things.
 *
 * The acceptance criterion names a real page: Delray "Managers & Staff"
 * (id 1389) with 31 body sections. This is that page.
 */
test('a page with 31 content sections keeps all 31 — only the frame is swapped', async () => {
  const body = Array.from({ length: 31 }, (_, i) => ({ id: `body-${i + 1}`, type: 'text' }));
  const managersAndStaff = {
    id: 1389,
    name: 'Managers & Staff',
    page_template_id: '27',
    layout_sections: JSON.stringify({
      sections: [frameRef('page-old-header', 'ss-old-header', 'Old Header'), ...body],
    }),
  };

  const { store, rows } = makeStore({ pages: [managersAndStaff], templates: [NEW_TEMPLATE] });

  const res = await store.bulkSetPageTemplate([1389], '47');
  assert.equal(res.ok, true);
  assert.equal(res.data[0].verified, true);
  assert.equal(res.data[0].keptBody, 31);

  const doc = docOf(rows[0]);
  const kept = doc.sections.filter((s) => !(s.canonical === true && s.savedSectionId));
  assert.equal(kept.length, 31, 'every content section survives the template change');
  assert.deepEqual(kept.map((s) => s.id), body.map((s) => s.id), 'and in the order it was in');

  // The frame really did change: the new template's header and footer are on
  // the page and the one it used to carry is gone.
  const frame = doc.sections.filter((s) => s.canonical === true && s.savedSectionId);
  assert.deepEqual(frame.map((s) => s.savedSectionId), ['ss-header', 'ss-footer']);
});

test('the frame comes from the LIVE master, not the copy the template carries', async () => {
  // A template stores a bare reference; an older one stores a full copy that
  // never receives canonical propagation. Cloning either raw shipped 34 pages
  // with a 41-minute-old menu on 2026-08-15.
  const { store, rows } = makeStore({ pages: [pageRow(1, 'Home')], templates: [NEW_TEMPLATE] });

  await store.bulkSetPageTemplate([1], '47');

  const doc = docOf(rows[0]);
  const header = doc.sections.find((s) => s.savedSectionId === 'ss-header');
  assert.ok(header, 'the header reference resolved to a real section');
  assert.equal(header.modules[0].settings.text, 'HEADER v2');
});

/**
 * A read of the masters that FAILS must stop the run, not proceed with none.
 *
 * resolveFrameSection drops a reference whose master it cannot find — right
 * for "the master was deleted", catastrophic for "the masters could not be
 * read", because every page in the selection would then be written with its
 * header and footer removed and every write would report success. That is the
 * same silent shape as the incident this whole ticket is about.
 */
test('unreadable saved sections refuse the whole run before any page is written', async () => {
  const { store, rows, calls } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
    failSavedSections: true,
  });

  const res = await store.bulkSetPageTemplate([1, 2], '47');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NOTHING_WRITTEN', 'the browser may only say "nothing was changed" when the server says so');
  assert.match(res.error, /saved sections/i);
  assert.match(res.error, /No page was changed/);

  assert.equal(calls.filter((c) => c.table === 'builder_landing_page' && c.method === 'PATCH').length, 0);
  for (const row of rows) {
    assert.equal(row.page_template_id, '27');
    assert.deepEqual(docOf(row).sections.map((s) => s.savedSectionId || s.id), ['ss-old-header', ...PAGE_BODY_IDS]);
  }
});

/**
 * The body-loss guard, tested as the pure function it is.
 *
 * It cannot be reached through bulkSetPageTemplate — applyTemplateFrame never
 * reads the body from the template, so it cannot drop one — and that is
 * exactly why it is worth having AND why it has to be tested from here. An
 * `if` in a write path that nothing can trigger is a line nobody can prove
 * still works; the operation went eighteen hours without any such check on
 * 2026-09-13.
 */
test('the body-loss guard refuses when content would be dropped, and only then', () => {
  const { store } = makeStore({ pages: [pageRow(1, 'Home')], templates: [NEW_TEMPLATE] });

  assert.equal(store.describeBodyLoss(31, 31), null, 'keeping everything is not a refusal');
  assert.equal(store.describeBodyLoss(0, 0), null, 'a page with no content of its own is fine');
  assert.equal(store.describeBodyLoss(2, 5), null, 'more than it had is not a loss');

  const refused = store.describeBodyLoss(31, 0);
  assert.ok(refused, 'dropping all 31 content sections must be refused');
  // The numbers are in the sentence: "31 pages lost their content" was the
  // whole of what the operator could see on 2026-09-13.
  assert.match(refused, /0 of this page's 31 content section\(s\)/);
  assert.match(refused, /This page was not changed/);
  assert.ok(store.describeBodyLoss(31, 30), 'losing even one is a refusal');
});

/**
 * AN EMPTY MASTERS LIST THAT LEAVES THE FRAME WITH NOTHING TO BE.
 *
 * This test used to assert the opposite — that the run went ahead and the page
 * came back holding its body alone — and that is exactly the 2026-09-14
 * send-back: every page written with its header and footer removed, nothing
 * put back, and `ok: true, verified: true` on every row.
 *
 * The refusal above it catches `ok: false` from listSavedSections, and that is
 * not the only way to be handed nothing. An error matching isMissingTableError
 * — "does not exist", "relation", "schema cache" — falls THROUGH to the local
 * JSON store and answers `ok: true` with whatever it holds, which on Vercel is
 * empty by definition because that filesystem is read-only (landmine 6). A
 * failed read is then indistinguishable from a project with no saved sections.
 *
 * So the run asks the question it actually cares about, of the data rather
 * than of the envelope: does this template's frame survive resolution? None of
 * it does here, so no page is written and the refusal is tagged as one.
 */
test('a template whose frame resolves to NOTHING is refused before a page is written', async () => {
  const { store, rows, calls } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
    savedSections: [],
  });

  const res = await store.bulkSetPageTemplate([1], '47');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NOTHING_WRITTEN');
  assert.match(res.error, /Blog Home Template/);
  assert.match(res.error, /none of them could be matched to a saved section/);
  assert.match(res.error, /no page was changed/);

  // Not a word of it was written, and the page still holds its old frame.
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
  assert.deepEqual(
    docOf(rows[0]).sections.map((s) => s.id),
    ['page-old-header', ...PAGE_BODY_IDS],
  );
});

/**
 * And the case that still has to go ahead, or the refusal above would be a
 * guard that refuses everything: an OLD-STYLE template carrying a COPY of its
 * frame rather than a reference. resolveFrameSection keeps a copy when it
 * cannot find a master (only a bare reference is dropped), so the frame
 * survives with no masters at all and the operator gets what the template
 * shows.
 */
test('an old-style template carrying its frame outright still applies with no masters', async () => {
  const OLD_STYLE = {
    id: '48',
    name: 'Old Copy Template',
    template_kind: 'modular',
    layout_sections: JSON.stringify({
      sections: [
        {
          id: 'tpl-copy-header',
          title: 'Public Header',
          canonical: true,
          savedSectionId: 'ss-header',
          modules: [{ id: 'm-copy', type: 'text', settings: { text: 'HEADER v1 (stale copy)' } }],
        },
        { id: 'tpl-body-marker', type: 'text' },
      ],
    }),
  };
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [OLD_STYLE],
    savedSections: [],
  });

  const res = await store.bulkSetPageTemplate([1], '48');
  assert.equal(res.ok, true);
  assert.equal(res.data[0].verified, true);
  assert.deepEqual(
    docOf(rows[0]).sections.map((s) => s.id),
    ['tpl-copy-header', ...PAGE_BODY_IDS],
  );
});

/**
 * ONE missing master is not the same event as all of them, and the difference
 * is deliberate: a saved section the operator genuinely deleted should not
 * refuse every bulk template change afterwards. It is dropped, as it always
 * was, and the rest of the frame still arrives.
 */
test('one missing master is dropped, not treated as a failed read', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
    savedSections: [HEADER_MASTER],
  });

  const res = await store.bulkSetPageTemplate([1], '47');
  assert.equal(res.ok, true);
  assert.equal(res.data[0].verified, true);
  // The header arrives; the footer, whose master is gone, does not.
  const ids = docOf(rows[0]).sections.map((s) => s.id);
  assert.equal(ids.length, PAGE_BODY_IDS.length + 1);
  assert.deepEqual(ids.slice(1), PAGE_BODY_IDS);
});

test('the page keeps its OWN background and theme — landmine 13', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
  });

  await store.bulkSetPageTemplate([1], '47');

  const doc = docOf(rows[0]);
  // The template's own background is #ffffff and its text colour is #00ff00.
  // If either of those appears here, the write stopped spreading the page and
  // is resetting styling it was never asked to touch. (Both values are read
  // off the NORMALISED document, which is what the column actually holds.)
  assert.equal(doc.pageBackground.mode, 'color');
  assert.equal(doc.pageBackground.color, '#123456');
  assert.equal(doc.theme.typography.colors.text, '#ff0000');
  assert.equal(doc.theme.typography.scale.baseSize, 18);
});

test('each page is read back, and the report counts what came back correct', async () => {
  const { store } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About'), pageRow(3, 'Contact')],
    templates: [NEW_TEMPLATE],
  });

  const res = await store.bulkSetPageTemplate([1, 2, 3], '47');
  assert.equal(res.verifiedCount, 3);
  assert.ok(res.data.every((row) => row.verified === true));
  // The count is per page and named, so a partial result can be reported
  // honestly rather than as one number.
  assert.deepEqual(res.data.map((row) => row.name), ['Home', 'About', 'Contact']);
});

test('one page failing does not stop the others, and it is named', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About'), pageRow(3, 'Contact')],
    templates: [NEW_TEMPLATE],
    failPageIds: [2],
  });

  const res = await store.bulkSetPageTemplate([1, 2, 3], '47');
  assert.equal(res.ok, true);
  assert.equal(res.verifiedCount, 2);
  const failed = res.data.filter((row) => !row.ok);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].name, 'About');
  assert.match(failed[0].error, /permission denied/);
  // The page that failed still holds its original sections — a failed write is
  // not a half-written one.
  const untouched = docOf(rows.find((r) => r.id === 2));
  assert.deepEqual(untouched.sections.map((s) => s.savedSectionId || s.id), ['ss-old-header', ...PAGE_BODY_IDS]);
});

test('when EVERY page fails, the whole call fails rather than reporting success', async () => {
  const { store } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
    failPageIds: [1, 2],
  });

  const res = await store.bulkSetPageTemplate([1, 2], '47');
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
});

test('an empty-layout template is refused before a single page is written', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [{ id: '50', name: 'Empty One', template_kind: 'modular', layout_sections: JSON.stringify({ sections: [] }) }],
  });

  const res = await store.bulkSetPageTemplate([1], '50');
  assert.equal(res.ok, false);
  // The refusal stands, and its wording says what is now true: an empty
  // template has no frame to apply, so it would strip the shared sections a
  // page has and put nothing back. It no longer claims the change would empty
  // the page, because since 2026-09-14 it would not.
  assert.match(res.error, /no shared header or footer to apply/);
  assert.doesNotMatch(res.error, /empty every selected page/);
  // Nothing was touched.
  assert.equal(rows[0].page_template_id, '27');
  assert.deepEqual(docOf(rows[0]).sections.map((s) => s.savedSectionId || s.id), ['ss-old-header', ...PAGE_BODY_IDS]);
});

test('an empty pageIds list and a missing template id are both refused', async () => {
  const { store } = makeStore({ pages: [pageRow(1, 'Home')], templates: [NEW_TEMPLATE] });

  assert.equal((await store.bulkSetPageTemplate([], '47')).ok, false);
  assert.equal((await store.bulkSetPageTemplate([1], '')).ok, false);
});

test('a write that reports success but does not stick is caught by the read-back', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
    silentlyDropPageIds: [2],
  });

  const res = await store.bulkSetPageTemplate([1, 2], '47');
  // The call succeeded and the database never complained, so ok is true for
  // both. Only reading the row back can tell them apart.
  assert.equal(res.ok, true);
  assert.ok(res.data.every((row) => row.ok));
  assert.equal(res.verifiedCount, 1);

  const dropped = res.data.find((row) => row.name === 'About');
  assert.equal(dropped.verified, false);
  // The message says what it found instead, not just that something is wrong.
  assert.match(dropped.error, /read back with template "27"/);
  assert.match(dropped.error, /3 section\(s\)/);
  assert.match(dropped.error, /2 content section\(s\)/);
  assert.equal(rows.find((r) => r.id === 2).page_template_id, '27');
});

test('a page that cannot be read back at all is unverified — never verified by default', async () => {
  const { store } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
    blindReadBackPageIds: [1],
  });

  const res = await store.bulkSetPageTemplate([1], '47');
  // The write went through, so this is not a failure — but nothing confirmed
  // it, and "could not tell" must not render as "fine".
  assert.equal(res.ok, true);
  assert.equal(res.data[0].ok, true);
  assert.equal(res.data[0].verified, false);
  assert.equal(res.verifiedCount, 0);
  assert.match(res.data[0].error, /could not be read back/);
});

/**
 * A run where pages fail AND pages silently do not stick, at the same time.
 *
 * Every fixture above this one sets `failPageIds` OR `silentlyDropPageIds`.
 * That is why the mixed run reached production: the report layer branched over
 * the two — `if (failed) … else if (unverified) …` — so the run with both
 * dropped the read-back warning entirely and counted the unconfirmed pages as
 * moved. The store was always right; nothing asked it this question.
 *
 * The sentence built from these numbers is asserted in
 * bulkTemplateOutcome.test.js. This test's job is to prove the store really
 * does hand back three distinguishable verdicts in one response.
 */
test('failures and silent drops in ONE run stay three separate verdicts', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About'), pageRow(3, 'Contact'), pageRow(4, 'Blog')],
    templates: [NEW_TEMPLATE],
    failPageIds: [2],
    silentlyDropPageIds: [3],
  });

  const res = await store.bulkSetPageTemplate([1, 2, 3, 4], '47');
  assert.equal(res.ok, true);

  const confirmed = res.data.filter((row) => row.ok && row.verified);
  const failed = res.data.filter((row) => !row.ok);
  const unconfirmed = res.data.filter((row) => row.ok && !row.verified);

  assert.equal(confirmed.length, 2, 'Home and Blog');
  assert.equal(failed.length, 1, 'About');
  assert.equal(unconfirmed.length, 1, 'Contact');
  // The three add up to the whole selection: no page is in two buckets and
  // none is missing.
  assert.equal(confirmed.length + failed.length + unconfirmed.length, 4);
  // verifiedCount counts ONLY the confirmed ones — not "everything that did
  // not error", which is the number the old report showed.
  assert.equal(res.verifiedCount, 2);
  assert.notEqual(res.verifiedCount, res.data.length - failed.length);

  assert.equal(failed[0].name, 'About');
  assert.equal(unconfirmed[0].name, 'Contact');
  // The silently-dropped page really did keep its old template — this is the
  // 2026-08-16 shape, and the read-back is the only thing that sees it.
  assert.equal(rows.find((r) => r.id === 3).page_template_id, '27');
  assert.equal(rows.find((r) => r.id === 1).page_template_id, '47');
});

// ── Round 3, item 2: the check that runs BEFORE the archive ─────────────────

/**
 * The archive is a complete copy of every page in the project, and it used to
 * be taken before the server had validated anything — so a refused change left
 * a full archive behind that undid nothing, on the very list the operator is
 * told to restore from. Snapshot 37 in the review run was one: 138 pages
 * archived for a change that touched zero.
 *
 * checkBulkSetPageTemplate answers the same question with no write behind it,
 * and the write path calls the same resolver, so the two cannot drift into
 * "the check said yes and the write said no".
 */
const EMAIL_TEMPLATE = {
  id: '61',
  name: 'Monthly Newsletter',
  template_kind: 'email',
  layout_sections: JSON.stringify({ sections: [{ id: 'e-1', type: 'text' }] }),
};

const EMPTY_TEMPLATE = {
  id: '62',
  name: 'Blank Starter',
  template_kind: 'modular',
  layout_sections: JSON.stringify({ sections: [] }),
};

test('the check says yes without touching a single page', async () => {
  const { store, rows, calls } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
  });

  const res = await store.checkBulkSetPageTemplate([1, 2], '47');
  assert.equal(res.ok, true);
  assert.equal(res.data.pageCount, 2);
  assert.equal(res.data.templateName, 'Blog Home Template');
  // The template's own section count, unresolved: two frame references and the
  // body marker between them. It is not a promise about what any page will end
  // up with — the check does not read the masters, so it cannot know how many
  // of those references resolve.
  assert.equal(res.data.sectionCount, 3);

  // Nothing was written, and the pages still hold what they held.
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
  assert.ok(rows.every((r) => r.page_template_id === '27'));
});

test('every refusal the write path can raise, the check raises first', async () => {
  const cases = [
    { ids: [1], templateId: '999', match: /No saved page template with id/ },
    { ids: [1], templateId: '61', match: /is an email template/ },
    { ids: [1], templateId: '62', match: /has no sections/ },
    { ids: [], templateId: '47', match: /pageIds is required/ },
    { ids: [1], templateId: '', match: /pageTemplateId is required/ },
  ];
  for (const c of cases) {
    // eslint-disable-next-line no-await-in-loop
    const { store, rows, calls } = makeStore({
      pages: [pageRow(1, 'Home')],
      templates: [NEW_TEMPLATE, EMAIL_TEMPLATE, EMPTY_TEMPLATE],
    });
    // eslint-disable-next-line no-await-in-loop
    const checked = await store.checkBulkSetPageTemplate(c.ids, c.templateId);
    assert.equal(checked.ok, false, `${c.templateId} should be refused`);
    assert.match(checked.error, c.match);
    // The browser archives only after this answers yes, so a refusal here is a
    // refusal with no archive behind it.
    assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0);
    assert.equal(rows[0].page_template_id, '27');

    // And the write path refuses the same thing with the same sentence — one
    // resolver, so they cannot disagree.
    // eslint-disable-next-line no-await-in-loop
    const written = await store.bulkSetPageTemplate(c.ids, c.templateId);
    assert.equal(written.ok, false);
    assert.equal(written.error, checked.error);
    assert.equal(written.status, checked.status);
  }
});

// ── Round 3, item 6: what one page costs ────────────────────────────────────

test('one page costs one read, one write and one read-back — not three reads', async () => {
  const { store, calls } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
  });

  const res = await store.bulkSetPageTemplate([1], '47');
  assert.equal(res.ok, true);
  assert.equal(res.data[0].verified, true);

  const pageReads = calls.filter((c) => c.table === 'builder_landing_page' && c.method === 'GET');
  const pageWrites = calls.filter((c) => c.table === 'builder_landing_page' && c.method === 'PATCH');
  // Two reads: the one the write needs, and the read-back that catches the
  // 2026-08-16 shape. The third was updatePage re-reading the same row to bank
  // a revision, because the page it had already been handed was not passed
  // through — 43 avoidable round trips on a select-all.
  assert.equal(pageReads.length, 2, `expected 2 reads, got ${pageReads.length}`);
  assert.equal(pageWrites.length, 1);
});

test('the revision is still banked, and off the page as it was BEFORE the change', async () => {
  // Passing `previous` skips a read, not the revision — losing the revision
  // would remove Page History's copy of the layout this change replaces.
  const { store, calls } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
  });

  await store.bulkSetPageTemplate([1], '47');

  const revisionWrites = calls.filter((c) => c.table === 'builder_page_revisions' && c.method === 'POST');
  assert.equal(revisionWrites.length, 1);
});

// ── Round 4, item 3: whose change was it, and what kind ─────────────────────

test('every revision names the operator and says it was a template change', async () => {
  // The revision is this operation's per-page undo, and Page History is where
  // the operator goes looking after a bulk re-pour has surprised him. Recorded
  // with saved_by null and reason 'save' -- which is what it did until round 4
  // -- a 43-page bulk change is indistinguishable from him hand-editing each
  // page one at a time, and a later stale-edit collision blames "somebody
  // else" rather than naming him.
  const { store, calls } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
  });

  const res = await store.bulkSetPageTemplate([1, 2], '47', null, {
    actor: { id: 'user-7', name: 'Dane Christensen', email: 'dane@example.com' },
  });
  assert.equal(res.ok, true);

  const revisions = calls
    .filter((c) => c.table === 'builder_page_revisions' && c.method === 'POST')
    .flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]));
  assert.equal(revisions.length, 2, 'one revision per page');
  for (const row of revisions) {
    assert.equal(row.reason, 'template', 'the reason must say what this was');
    assert.equal(row.saved_by, 'user-7');
    assert.equal(row.saved_by_name, 'Dane Christensen');
  }
});

test('no signed-in user is recorded as no author — never as a wrong one', async () => {
  // A script or a cron reaches the store with no actor. The revision still has
  // to be banked, and Page History says "Template changed" with no name rather
  // than inventing one.
  const { store, calls } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
  });

  await store.bulkSetPageTemplate([1], '47');

  const revisions = calls
    .filter((c) => c.table === 'builder_page_revisions' && c.method === 'POST')
    .flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]));
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].reason, 'template');
  assert.equal(revisions[0].saved_by, null);
});
