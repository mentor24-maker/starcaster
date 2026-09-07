'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBuilderSection,
  normalizeBuilderDocument,
  serializeBuilderDocument,
  migrateLegacyLayoutSections,
} = require('../../lib/builder');

/**
 * A module's `text` must survive every server-side round trip, for every type.
 *
 * Task 86bbq2y78 came in as two reports of text vanishing in the Builder: a
 * paragraph that was in the draft row but showed as empty in the editor, and a
 * heading in the site-header master whose "Blog" became "". Both turned out to
 * be client-side (see components/builder-editor-undo-history.test.ts and
 * lib/builder-client/editor-content-sync.test.ts), and these tests are what
 * establish that: the server preserves the text, so an empty column in the
 * database means an empty payload arrived.
 *
 * That is worth pinning rather than assuming. Text lives at the module's top
 * level, and `normalizeBuilderModuleFromRecord` is a strict field WHITELIST —
 * a type whose text was not carried through it would be emptied on every save
 * with nothing raising a word (compare the lineage fields, which that same
 * whitelist really does drop — see below).
 */

const TEXT_CARRYING_TYPES = [
  'text',
  'heading',
  'button',
  'quote',
  'code',
  'speech-bubble',
];

function sectionHolding(module) {
  return {
    id: 'section-1',
    title: 'Header',
    layout: 'one-three-one',
    modules: [module],
  };
}

function moduleOfType(type, text) {
  return {
    id: 'module-1',
    type,
    column: 'center',
    name: '',
    text,
    settings: {},
  };
}

/**
 * Unwrap whichever of the three section shapes was handed over: a bare array,
 * a normalized document (`layoutSections`) or a serialized one (`sections`).
 * Landmine 13 in CLAUDE.md is this same asymmetry biting a page write.
 */
function firstModule(input) {
  const list = Array.isArray(input) ? input : input.layoutSections || input.sections;
  assert.ok(Array.isArray(list), `expected sections, got ${JSON.stringify(Object.keys(input || {}))}`);
  return list[0].modules[0];
}

for (const type of TEXT_CARRYING_TYPES) {
  test(`a ${type} module keeps its text through a saved-section write`, () => {
    // The path a saved-section MASTER takes: lib/builderSavedSectionsStore.js
    // normalizes the incoming section before writing the row.
    const saved = normalizeBuilderSection(sectionHolding(moduleOfType(type, 'Blog')));

    assert.equal(firstModule([saved]).text, 'Blog');
  });

  test(`a ${type} module keeps its text through a page save and reload`, () => {
    // The path a PAGE takes: normalize on load, serialize on save.
    const loaded = normalizeBuilderDocument([sectionHolding(moduleOfType(type, 'Blog'))]);
    const saved = serializeBuilderDocument(loaded);
    const reloaded = normalizeBuilderDocument(saved);

    assert.equal(firstModule(reloaded).text, 'Blog');
  });

  test(`a ${type} module keeps its text through the legacy migration`, () => {
    // coerceLayoutInput runs this on every load and every save.
    const migrated = migrateLegacyLayoutSections([sectionHolding(moduleOfType(type, 'Blog'))]);

    assert.equal(firstModule(migrated).text, 'Blog');
  });
}

test('markup a heading carries is not flattened away on the way through', () => {
  // The heading stores inline markup, not a bare string — a heading that lost
  // its <strong> would read as "the operator's formatting disappeared".
  const html = '<strong>Blog</strong>';
  const saved = normalizeBuilderSection(sectionHolding(moduleOfType('heading', html)));

  assert.equal(firstModule([saved]).text, html);
});

test('the exact module reported as blank in the editor survives a page round trip', () => {
  // Copied from production revision 5127 (page 1266, the Delray home page):
  // this is the module the Builder showed with no text while the draft row
  // held it. The server keeps it, which is what localised the defect to the
  // browser.
  const reported = {
    id: 'module-47ec3e84-85ed-4c91-8ab9-408f28c18b1f',
    name: '',
    text: '<h1 style="text-align: center;"><strong>Wut?</strong></h1>',
    type: 'text',
    column: 'center',
    settings: { variant: 'paragraph' },
  };

  const loaded = normalizeBuilderDocument([sectionHolding(reported)]);
  const reloaded = normalizeBuilderDocument(serializeBuilderDocument(loaded));

  assert.equal(firstModule(reloaded).text, reported.text);
});

test('a saved-section write still drops the module lineage fields', () => {
  // NOT a fix — a record of a real, separate gap found while diagnosing this
  // one, so the next reader does not have to rediscover it.
  //
  // lib/builderSavedSectionsStore.js normalizes through normalizeBuilderSection
  // (the raw whitelist in the generated lib/builder/template.js) rather than
  // through lib/builder/document.js, which exists precisely to put these
  // fields back. So every write of a saved-section master strips its modules'
  // savedModuleId / canonical / canonicalLocked, and the section's own
  // savedSectionId / canonical with them. Module-level `canonical` absent
  // means FOLLOWS (lib/canonicalPropagation.js MODULE_LEVEL), so an explicit
  // opt-out does not survive being saved.
  //
  // If this test starts failing because the fields now survive, that is good
  // news and the assertion should be inverted — but check the propagation
  // behaviour that depends on the current polarity before doing it.
  const withLineage = {
    ...sectionHolding({
      ...moduleOfType('heading', 'Blog'),
      savedModuleId: 'saved_module_xyz',
      canonical: false,
      canonicalLocked: true,
    }),
    savedSectionId: 'saved_section_abc',
    canonical: true,
  };

  const saved = normalizeBuilderSection(withLineage);
  const module = firstModule([saved]);

  assert.equal(module.text, 'Blog', 'text does survive');
  assert.equal('savedModuleId' in module, false);
  assert.equal('canonical' in module, false);
  assert.equal('canonicalLocked' in module, false);
  assert.equal('savedSectionId' in saved, false);
  assert.equal('canonical' in saved, false);
});
