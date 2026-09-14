'use strict';

// Clicking Save Page with no edits used to unlink every shared block on the
// page. The modular page editor in public/js/builder.js adds `rowSettings` and
// `containerSettings` to every section it sends (normalizePageTemplateLayoutSections,
// line 5446); isLegacySectionArray calls a section legacy when it carries
// either one, so EVERY ordinary save was routed through the Normie import
// migrator, which rebuilds each section from a fixed field list that has no
// `savedSectionId` and no `canonical`. The meta rescue in document.js then had
// nothing left to rescue from, the block flipped from Following to
// Independent, and the next fan-out from the original skipped the page --
// with no message to the operator and no visible change on the page.
//
// These tests drive the editor's ACTUAL payload shape through the server's own
// serializer, which is the only place that failure was observable.

const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateLegacyLayoutSections } = require('../../lib/builder/migrate-from-legacy');
const { serializeBuilderDocument, normalizeBuilderDocument } = require('../../lib/builder/document');

// The shape public/js/builder.js sends on a page save: rowSettings and
// containerSettings on every section, lineage alongside them.
function editorSection(overrides = {}) {
  return {
    id: 'section-following-copy',
    layout: '6',
    title: 'Menu banner',
    collapsed: false,
    rowSettings: { margin: '0', padding: '20', background: { mode: 'none' } },
    containerSettings: { col1: { padding: '18' } },
    modules: [{
      id: 'module-a',
      type: 'text',
      column: 'col1',
      name: 'Copy',
      text: '<p>Lunch served 11-3</p>',
      settings: {},
    }],
    ...overrides,
  };
}

test('saving a page with no edits keeps each section following its saved section', () => {
  const sections = [
    editorSection({ savedSectionId: 'saved-section-fixture-menu-banner', canonical: true }),
    editorSection({ id: 'section-independent-copy', title: 'Plain' }),
  ];

  const serialized = serializeBuilderDocument({ layoutSections: sections });

  const following = serialized.sections.find((s) => s.id === 'section-following-copy');
  assert.equal(following.savedSectionId, 'saved-section-fixture-menu-banner');
  assert.equal(following.canonical, true);

  // A section that was never linked must not GAIN a link either.
  const independent = serialized.sections.find((s) => s.id === 'section-independent-copy');
  assert.equal(independent.savedSectionId, undefined);
  assert.equal(independent.canonical, undefined);
});

test('a module keeps its link to the saved module it came from', () => {
  const sections = [editorSection({
    savedSectionId: 'saved-section-fixture-menu-banner',
    canonical: true,
    modules: [{
      id: 'module-a',
      type: 'text',
      column: 'col1',
      text: '<p>Lunch served 11-3</p>',
      settings: {},
      savedModuleId: 'saved-module-hours',
      canonical: false,
      canonicalLocked: true,
    }],
  })];

  const serialized = serializeBuilderDocument({ layoutSections: sections });
  const module = serialized.sections[0].modules[0];

  assert.equal(module.savedModuleId, 'saved-module-hours');
  // false is an explicit break, and is NOT the same as absent -- document.js
  // reads an absent `canonical` as legacy silence, which means following.
  assert.equal(module.canonical, false);
  assert.equal(module.canonicalLocked, true);
});

test('lineage survives the full read-back round trip, not just the write', () => {
  const sections = [editorSection({ savedSectionId: 'saved-section-fixture-menu-banner', canonical: true })];

  const stored = serializeBuilderDocument({ layoutSections: sections });
  const readBack = normalizeBuilderDocument(stored);

  assert.equal(readBack.layoutSections[0].savedSectionId, 'saved-section-fixture-menu-banner');
  assert.equal(readBack.layoutSections[0].canonical, true);
});

test('a genuine legacy section still migrates', () => {
  const migrated = migrateLegacyLayoutSections([{
    id: 'section_1',
    layout: '3-3',
    rowSettings: { backgroundColor: '#eef6ff', padding: '20', margin: '8' },
    containerSettings: { col1: { padding: '12' }, col2: { padding: '16' } },
    modules: [
      { id: 'module_1', type: 'headline', column: 'col1', name: 'Hero', text: 'Hello', settings: {} },
      { id: 'module_2', type: 'cta', column: 'col2', name: 'Book', text: 'Book', settings: {} },
    ],
  }]);

  const section = migrated.sections[0];
  assert.equal(section.layout, 'two-column');
  // col1/col2 map onto the modern column names, and the legacy module types
  // map onto modern ones -- the passthrough must not have short-circuited any
  // of that.
  assert.equal(section.modules[0].type, 'heading');
  assert.equal(section.modules[0].column, 'left');
  assert.equal(section.modules[1].type, 'button');
  assert.equal(section.modules[1].column, 'right');
  // An import carries no lineage, and must not invent one.
  assert.equal(section.savedSectionId, undefined);
  assert.equal(section.canonical, undefined);
  assert.equal(section.modules[0].savedModuleId, undefined);
});
