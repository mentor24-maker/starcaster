'use strict';

/**
 * The page-level "Back to top" switch (task SC-864), tested along the whole
 * path a new page field has to survive without an error:
 *
 *   editor payload -> buildLandingPagePatch -> mergeLayoutColumnFromPrevious
 *     -> inputToRow -> layout_sections column -> rowToPage
 *
 * It lives INSIDE the layout document (beside sections, pageBackground and
 * theme), so it needs no database column — but every one of those steps is a
 * field list or a whitelist that drops what it does not name, and the save
 * would still return 200.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildLandingPagePatch } = require('../../routes/builder');
const { inputToRow, rowToPage, mergeLayoutColumnFromPrevious } = require('../../lib/builderPagesStore');
const { serializeBuilderDocument, normalizeBuilderDocument } = require('../../lib/builder');

const SECTIONS = [{ id: 'section_1', layout: 'single', modules: [] }];

test('the route whitelist carries pageOptions instead of dropping it', () => {
  assert.deepEqual(buildLandingPagePatch({ pageOptions: { backToTop: true } }).patch.pageOptions, { backToTop: true });
  assert.deepEqual(buildLandingPagePatch({ page_options: { backToTop: true } }).patch.pageOptions, { backToTop: true });
  assert.equal('pageOptions' in buildLandingPagePatch({ name: 'x' }).patch, false);
});

test('ON survives the write and the read back', () => {
  const row = inputToRow({ layoutSections: SECTIONS, pageOptions: { backToTop: true } }, { partial: true });
  assert.deepEqual(row.layout_sections.pageOptions, { backToTop: true });
  const page = rowToPage({ id: 1, layout_sections: row.layout_sections });
  assert.deepEqual(page.pageOptions, { backToTop: true });
});

test('OFF stores nothing at all, so existing pages store byte-identically', () => {
  for (const off of [undefined, {}, { backToTop: false }, { backToTop: 'yes' }, null, []]) {
    const doc = serializeBuilderDocument({ layoutSections: SECTIONS, pageOptions: off });
    assert.equal('pageOptions' in doc, false, JSON.stringify(off));
  }
  const before = serializeBuilderDocument({ layoutSections: SECTIONS });
  assert.deepEqual(Object.keys(before).sort(), ['pageBackground', 'sections', 'theme']);
  assert.equal('pageOptions' in rowToPage({ id: 1, layout_sections: before }), false);
});

test('an editor save that does not name pageOptions keeps the page\'s switch', () => {
  // Module saves, canonical propagation and the alt-text writer all send
  // layoutSections without pageOptions; none of them may turn the button off.
  const merged = mergeLayoutColumnFromPrevious(
    { layoutSections: SECTIONS },
    { theme: {}, pageBackground: {}, pageOptions: { backToTop: true } }
  );
  assert.deepEqual(merged.pageOptions, { backToTop: true });
});

test('turning it OFF is a write, not a no-op: an explicit {} wins over the old value', () => {
  const merged = mergeLayoutColumnFromPrevious(
    { layoutSections: SECTIONS, pageOptions: {} },
    { theme: {}, pageBackground: {}, pageOptions: { backToTop: true } }
  );
  assert.deepEqual(merged.pageOptions, {});
  const row = inputToRow(merged, { partial: true });
  assert.equal('pageOptions' in row.layout_sections, false);
});

test('a legacy-shaped save (rowSettings on sections) still carries the switch', () => {
  // public/js/builder.js puts rowSettings on every section, which sends the
  // document through the legacy migrator first (lib/builder/migrate-from-legacy.js).
  const legacy = [{ id: 'section_1', layout: 'single', rowSettings: {}, containerSettings: {}, modules: [] }];
  const doc = serializeBuilderDocument({ layoutSections: legacy, pageOptions: { backToTop: true } });
  assert.deepEqual(doc.pageOptions, { backToTop: true });
  assert.deepEqual(normalizeBuilderDocument(doc).pageOptions, { backToTop: true });
});

// ---------------------------------------------------------------------------
// A save naming ONLY the switch (review of PR #1067, note 3). These drive the
// real updatePage against a stubbed database, so removing the carry's call
// site fails here even if the helpers above stay correct.
// ---------------------------------------------------------------------------

const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', 'lib');

function loadPagesStoreWithStubs({ storedRow, readFails = false }) {
  for (const mod of ['supabase.js', 'projectScope.js', 'builderPageRevisionsStore.js', 'builderPagesStore.js']) {
    delete require.cache[require.resolve(path.join(LIB, mod))];
  }
  const supa = require(path.join(LIB, 'supabase.js'));
  const scope = require(path.join(LIB, 'projectScope.js'));
  const calls = { patchBody: null, inserts: 0 };
  supa.sbQuery = async (opts) => {
    // Only the PAGE write counts: a save also syncs a content item afterwards.
    if (opts.method === 'PATCH' && opts.table === 'builder_landing_pages') {
      calls.patchBody = opts.body;
      return { ok: true, status: 200, data: [{ ...storedRow, ...opts.body }] };
    }
    if (opts.method === 'POST' && opts.table === 'builder_page_revisions') {
      calls.inserts += 1;
      return { ok: true, status: 201, data: [] };
    }
    if (readFails) return { ok: false, status: 503, error: 'database unavailable' };
    return { ok: true, status: 200, data: [{ ...storedRow }] };
  };
  supa.tableConfig = () => ({ builderPages: 'builder_landing_pages', builderPageRevisions: 'builder_page_revisions' });
  scope.scopedPatchRow = async (_table, row) => row;
  scope.scopedIdQuery = async (_table, query) => query;
  scope.scopedListQuery = async (_table, query) => query;
  scope.scopedInsertRow = async (_table, row) => row;
  const store = require(path.join(LIB, 'builderPagesStore.js'));
  return { store, calls };
}

const STORED_SECTIONS = [
  { id: 'section_a', layout: 'single', modules: [{ id: 'm1', type: 'text', settings: { text: '<p>Keep me</p>' } }] },
];

function storedPageRow() {
  return {
    id: 7,
    name: 'Long page',
    slug: 'long-page',
    template_kind: 'modular',
    layout_sections: serializeBuilderDocument({ layoutSections: STORED_SECTIONS }),
    updated_at: '2026-11-19T00:00:00Z',
  };
}

test('PATCH { pageOptions } alone writes the switch AND keeps the sections', async () => {
  const { store, calls } = loadPagesStoreWithStubs({ storedRow: storedPageRow() });
  const res = await store.updatePage(7, { pageOptions: { backToTop: true } });
  assert.equal(res.ok, true, res.error);
  assert.ok(calls.patchBody && calls.patchBody.layout_sections, 'the layout column was not written at all');
  assert.deepEqual(calls.patchBody.layout_sections.pageOptions, { backToTop: true });
  assert.equal(calls.patchBody.layout_sections.sections.length, 1, 'the sections were not carried forward');
  assert.equal(calls.patchBody.layout_sections.sections[0].id, 'section_a');
  assert.equal(calls.inserts, 0, 'a switch-only save banked a revision although the layout did not change');
});

test('a switch-only save refuses, rather than writing an empty page, when the page cannot be read', async () => {
  const { store, calls } = loadPagesStoreWithStubs({ storedRow: storedPageRow(), readFails: true });
  const res = await store.updatePage(7, { pageOptions: { backToTop: true } });
  assert.equal(res.ok, false);
  assert.equal(calls.patchBody, null, 'it wrote to the page anyway');
});
