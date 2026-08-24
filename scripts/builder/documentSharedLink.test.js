'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBuilderDocument,
  serializeBuilderDocument,
  readLayoutSectionsFromRow,
  writeLayoutSectionsToRow,
} = require('../../lib/builder/document.js');

/**
 * A shared section's link must survive EVERY shape `layout_sections` is stored
 * in — accepting a shape and quietly discarding half of it is the failure here.
 *
 * `savedSectionId` and `canonical` answer two different questions ("where did
 * this come from" and "does it still follow"), and `normalizeLayoutSections`
 * strips both, so `document.js` re-attaches them by hand afterwards. That
 * re-attachment knew two spellings of the input — `{ sections: [...] }` and
 * `{ layoutSections: [...] }` — and not the third: the bare array, which is
 * how older rows are stored.
 *
 * A bare-array page LOADED and RENDERED perfectly. Every section was there.
 * They just came back with no link, so a shared section read as "Independent"
 * and its header promised a save would stay on this page when in fact it fans
 * out to every follower. Found in review of Sync 6a/7 (PR #387), where the
 * fixture was corrected to the wrapped shape rather than the behaviour — a
 * display-only ticket, correctly scoped. This is the behaviour.
 */

const SAVED_ID = 'saved_menu_banner_42';

function linkedSection(over = {}) {
  return {
    id: 'section-1',
    layout: 'single',
    title: 'Menu Banner',
    savedSectionId: SAVED_ID,
    canonical: true,
    locked: true,
    modules: [{ id: 'module-1', type: 'text', column: 'main', text: '<p>Book a court.</p>' }],
    ...over,
  };
}

/** Every shape a stored `layout_sections` value is found in. */
const STORED_SHAPES = {
  'the wrapped shape written today': (sections) => ({ sections }),
  'wrapped under layoutSections': (sections) => ({ layoutSections: sections }),
  'a BARE ARRAY, as older rows hold it': (sections) => sections,
};

test('reading a page preserves the shared-section link in every stored shape', async (t) => {
  for (const [label, wrap] of Object.entries(STORED_SHAPES)) {
    await t.test(label, () => {
      const doc = readLayoutSectionsFromRow({ layout_sections: wrap([linkedSection()]) });
      const section = doc.layoutSections[0];

      assert.equal(doc.layoutSections.length, 1, 'the section itself always survived — that is why nobody noticed');
      assert.equal(section.savedSectionId, SAVED_ID, 'the link to its master must survive too');
      assert.equal(section.canonical, true, 'and whether it still follows that master');
      assert.equal(section.locked, true, 'locked travels with them and was dropped the same way');
    });
  }
});

test('normalizeBuilderDocument accepts the bare array directly', () => {
  // readLayoutSectionsFromRow is a thin wrapper; pinning the layer underneath
  // too, so a future caller reaching for it directly is covered.
  const doc = normalizeBuilderDocument([linkedSection()]);
  assert.equal(doc.layoutSections[0].savedSectionId, SAVED_ID);
  assert.equal(doc.layoutSections[0].canonical, true);
});

test('an unlinked section is not given a link that was never there', () => {
  // The opposite error: restoring meta must not invent it. A plain section
  // stays plain in every shape.
  for (const wrap of Object.values(STORED_SHAPES)) {
    const plain = linkedSection({ savedSectionId: undefined, canonical: undefined, locked: undefined });
    delete plain.savedSectionId;
    delete plain.canonical;
    delete plain.locked;

    const doc = readLayoutSectionsFromRow({ layout_sections: wrap([plain]) });
    const section = doc.layoutSections[0];
    assert.equal(section.savedSectionId, undefined, 'no link may be invented');
    assert.notEqual(section.canonical, true, 'nor a following flag');
  }
});

test('a round trip through write and read keeps the link', async (t) => {
  // The acceptance criterion: write it, read it back, and check the value
  // rather than trusting that the write reported success (landmine 13).
  for (const [label, wrap] of Object.entries(STORED_SHAPES)) {
    await t.test(`stored as ${label}`, () => {
      const loaded = readLayoutSectionsFromRow({ layout_sections: wrap([linkedSection()]) });
      const written = writeLayoutSectionsToRow(loaded);

      assert.equal(written.sections.length, 1, 'the write must not empty the page');
      assert.equal(written.sections[0].savedSectionId, SAVED_ID, 'the link must reach the column');
      assert.equal(written.sections[0].canonical, true);

      // And read what was written back again — the second hop is where an
      // accept-then-strip would show up if one survived anywhere.
      const reloaded = readLayoutSectionsFromRow({ layout_sections: written });
      assert.equal(reloaded.layoutSections[0].savedSectionId, SAVED_ID, 'still linked after a full round trip');
      assert.equal(reloaded.layoutSections[0].canonical, true);
    });
  }
});

test('the write path keeps the link for both section-array spellings', async (t) => {
  // serializeBuilderDocument reads `input.layoutSections ?? input.sections`,
  // and both must carry the link through.
  for (const [label, build] of Object.entries({
    'layoutSections: [ ... ]': (sections) => ({ layoutSections: sections }),
    'sections: [ ... ]': (sections) => ({ sections }),
  })) {
    await t.test(label, () => {
      const written = serializeBuilderDocument(build([linkedSection()]));
      assert.equal(written.sections[0].savedSectionId, SAVED_ID);
      assert.equal(written.sections[0].canonical, true);
    });
  }
});

test('several sections keep their own links, not the first one\'s', () => {
  // Meta is restored by id. A lookup keyed wrongly would smear one section's
  // link across the page, which is worse than dropping it.
  const stored = [
    linkedSection({ id: 'a', savedSectionId: 'saved_a' }),
    linkedSection({ id: 'b', savedSectionId: 'saved_b', canonical: false }),
    (() => {
      const plain = linkedSection({ id: 'c' });
      delete plain.savedSectionId;
      delete plain.canonical;
      return plain;
    })(),
  ];
  const doc = readLayoutSectionsFromRow({ layout_sections: stored });
  const byId = Object.fromEntries(doc.layoutSections.map((s) => [s.id, s]));

  assert.equal(byId.a.savedSectionId, 'saved_a');
  assert.equal(byId.a.canonical, true);
  assert.equal(byId.b.savedSectionId, 'saved_b');
  assert.notEqual(byId.b.canonical, true, 'a copy that stopped following must not read as following');
  assert.equal(byId.c.savedSectionId, undefined, 'and a section with no master gets none');
});
