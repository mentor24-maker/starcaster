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
