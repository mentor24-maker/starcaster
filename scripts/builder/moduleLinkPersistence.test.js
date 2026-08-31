'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  serializeBuilderDocument,
  normalizeBuilderDocument,
  readLayoutSectionsFromRow,
  writeLayoutSectionsToRow,
} = require('../../lib/builder/document');

/**
 * A module's link to the saved module it came from has to survive a save.
 *
 * The raw normalizer whitelists a module down to id/type/column/name/text/
 * settings and silently drops everything else. `lib/builder/document.js` exists
 * to rescue the fields sections need — `locked`, `savedSectionId`, `canonical`,
 * `rowBorder*` — but the module-level pair was never added to it.
 *
 * The effect was total and invisible: the link was stamped in the browser,
 * thrown away on save, and stripped again on read, so the routine that pushes
 * an edit from a saved module out to its copies searched for copies that could
 * not exist. Measured against the live Delray project on 2026-08-15: 0 of
 * ~1,579 modules carried a link, against 247 healthy section links.
 *
 * The "Linked"/"Custom" badge on a module card is gated on the same field, so
 * it never appeared after a reload either.
 */

function docWith(modules) {
  return {
    pageBackground: {},
    theme: {},
    sections: [{ id: 'sec-1', title: 'Header', layout: 'main', modules }],
  };
}

const mod = (extra) => ({
  id: 'm1', type: 'text', column: 'main', name: '', text: 'hello', settings: {}, ...extra,
});

test('the link to a saved module survives being written', () => {
  const written = writeLayoutSectionsToRow(docWith([mod({ savedModuleId: 'dmod_123' })]));
  assert.equal(written.sections[0].modules[0].savedModuleId, 'dmod_123');
});

test('the link survives being read back', () => {
  const written = writeLayoutSectionsToRow(docWith([mod({ savedModuleId: 'dmod_123' })]));
  const read = readLayoutSectionsFromRow({ layout_sections: written });
  assert.equal(read.layoutSections[0].modules[0].savedModuleId, 'dmod_123');
});

test('the per-copy opt-out survives too', () => {
  // canonicalLocked is what makes a copy "Custom" — a push must skip it.
  // Losing this field silently re-enrolled every deliberately-custom copy.
  const written = writeLayoutSectionsToRow(
    docWith([mod({ savedModuleId: 'dmod_9', canonicalLocked: true })])
  );
  assert.equal(written.sections[0].modules[0].canonicalLocked, true);

  const read = readLayoutSectionsFromRow({ layout_sections: written });
  assert.equal(read.layoutSections[0].modules[0].canonicalLocked, true);
});

test('a module with no link gains no new fields', () => {
  // The stored document must not grow for the ordinary case.
  const written = writeLayoutSectionsToRow(docWith([mod({})]));
  assert.deepEqual(
    Object.keys(written.sections[0].modules[0]).sort(),
    ['column', 'id', 'name', 'settings', 'text', 'type']
  );
});

test('section-level rescue still works alongside it', () => {
  const doc = {
    pageBackground: {},
    theme: {},
    sections: [{
      id: 'sec-1', title: 'Header', layout: 'main', locked: true,
      savedSectionId: 'saved_section_menu', canonical: true,
      modules: [mod({ savedModuleId: 'dmod_1' })],
    }],
  };
  const written = writeLayoutSectionsToRow(doc);
  const section = written.sections[0];
  assert.equal(section.savedSectionId, 'saved_section_menu');
  assert.equal(section.canonical, true);
  assert.equal(section.locked, true);
  assert.equal(section.modules[0].savedModuleId, 'dmod_1');
});

test('several modules in one section keep their own links', () => {
  const written = writeLayoutSectionsToRow(docWith([
    mod({ id: 'a', savedModuleId: 'dmod_a' }),
    mod({ id: 'b' }),
    mod({ id: 'c', savedModuleId: 'dmod_c', canonicalLocked: true }),
  ]));
  const [a, b, c] = written.sections[0].modules;
  assert.equal(a.savedModuleId, 'dmod_a');
  assert.equal(b.savedModuleId, undefined);
  assert.equal(c.savedModuleId, 'dmod_c');
  assert.equal(c.canonicalLocked, true);
});

test('normalizing raw input keeps the link', () => {
  const doc = normalizeBuilderDocument({
    sections: [{ id: 'sec-1', title: 'H', layout: 'main', modules: [mod({ savedModuleId: 'dmod_x' })] }],
  });
  assert.equal(doc.layoutSections[0].modules[0].savedModuleId, 'dmod_x');
});

test('junk in the link field is not persisted', () => {
  const written = serializeBuilderDocument(
    docWith([mod({ savedModuleId: '', canonicalLocked: 'yes' })])
  );
  const persisted = written.sections[0].modules[0];
  assert.equal(persisted.savedModuleId, undefined, 'an empty id is not a link');
  assert.equal(persisted.canonicalLocked, undefined, 'only a real boolean counts');
});

/**
 * Sync 7/7 added the ONE polarity, `canonical`, to the module level. It has to
 * survive the round trip for the same reason `canonicalLocked` does — and one
 * reason more: it is stored as a TRI-STATE. `false` means "deliberately
 * detached", absent means "never answered", and on the module side absent has
 * always meant FOLLOWING. Collapse false into absent anywhere along this path
 * and every deliberately-detached copy quietly re-enrols itself, which is the
 * silent kind of failure — a page that starts taking pushes again looks
 * exactly like a page nobody has touched.
 */
test('the one polarity survives being written and read back', () => {
  const written = writeLayoutSectionsToRow(
    docWith([mod({ savedModuleId: 'dmod_9', canonical: true })])
  );
  assert.equal(written.sections[0].modules[0].canonical, true);
  const read = readLayoutSectionsFromRow({ layout_sections: written });
  assert.equal(read.layoutSections[0].modules[0].canonical, true);
});

test('a deliberately detached copy keeps its false, rather than collapsing to absent', () => {
  const written = writeLayoutSectionsToRow(
    docWith([mod({ savedModuleId: 'dmod_9', canonical: false })])
  );
  assert.equal(written.sections[0].modules[0].canonical, false);
  const read = readLayoutSectionsFromRow({ layout_sections: written });
  assert.equal(read.layoutSections[0].modules[0].canonical, false);
});

test('a module that never answered stays unmarked, so it keeps the legacy default', () => {
  const written = writeLayoutSectionsToRow(docWith([mod({ savedModuleId: 'dmod_9' })]));
  assert.ok(
    !('canonical' in written.sections[0].modules[0]),
    'inventing an answer for an old copy is the same silent change as flipping the default'
  );
});
