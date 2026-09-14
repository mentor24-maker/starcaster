'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// The server hand-ports getSectionContent / hasSectionDrifted from the client's
// lib/builder-client/section-drift.ts, because a server module cannot require a
// .ts file. Nothing enforces the two copies agree except a test — and it lives
// HERE, in the node suite, because document.js requires the GENERATED
// ./template. CI runs `npm run test:builder` AFTER `npm run build`, so the
// artifact exists; the client's own behaviour is pinned separately in the
// vitest file. (Moved out of vitest 2026-08-22: requiring a generated lib from
// vitest is CI-red-only — see memory "Vitest cannot require generated libs".)
const serverTwin = require('../../lib/builder/document.js');

const master = {
  id: 'master-1',
  savedSectionId: undefined,
  canonical: undefined,
  title: 'Footer',
  layout: 'main',
  modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text: 'Call us today', settings: {} }],
};

function instance(overrides = {}) {
  return {
    id: 'inst-1',
    savedSectionId: 'saved_section_footer',
    canonical: true,
    title: 'Footer',
    layout: 'main',
    modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text: 'Call us today', settings: {} }],
    ...overrides,
  };
}

/**
 * The one fixture both suites hash, and the value both pin. See the client
 * file's copy of this constant: nothing imports across the TS/CJS line, so a
 * hash changed on one side and not the other shows up here as a red test
 * rather than as two surfaces quietly disagreeing about what "drifted" means.
 */
const PINNED_FIXTURE_HASH = 'e81b0a4fd564cd2b';

test('server twin: getSectionContent strips id, savedSectionId, canonical and the lineage stamp — what a push overwrites', () => {
  const content = serverTwin.getSectionContent(instance({ canonicalSourceHash: 'abc' }));
  assert.equal('id' in content, false);
  assert.equal('savedSectionId' in content, false);
  assert.equal('canonical' in content, false);
  assert.equal('canonicalSourceHash' in content, false);
  assert.equal(content.title, 'Footer');
});

test('server twin: sectionContentHash agrees with the client on the shared fixture', () => {
  assert.equal(serverTwin.sectionContentHash(instance()), PINNED_FIXTURE_HASH);
});

test('server twin: the hash does not depend on key ORDER — jsonb rearranges them on the way back', () => {
  const reordered = {
    modules: [{ settings: {}, text: 'Call us today', name: '', column: 'main', type: 'text', id: 'm1' }],
    layout: 'main',
    title: 'Footer',
    canonical: true,
    savedSectionId: 'saved_section_footer',
    id: 'inst-1',
  };
  assert.equal(serverTwin.sectionContentHash(reordered), serverTwin.sectionContentHash(instance()));
});

test('server twin: the hash ignores provenance, and moves when content moves', () => {
  assert.equal(
    serverTwin.sectionContentHash(instance({ id: 'inst-2', canonical: false, canonicalSourceHash: 'stale' })),
    serverTwin.sectionContentHash(instance())
  );
  const edited = instance({ modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text: 'CHANGED', settings: {} }] });
  assert.notEqual(serverTwin.sectionContentHash(edited), serverTwin.sectionContentHash(instance()));
});

test('server twin: a stamped copy a failed push never wrote is NOT drifted, though the master has moved on', () => {
  const stale = serverTwin.stampSectionLineage(instance());
  const masterMovedOn = {
    ...master,
    modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text: 'the new copy', settings: {} }],
  };
  assert.equal(serverTwin.hasSectionDrifted(stale, masterMovedOn), false);
});

test('server twin: a copy edited after it was stamped IS drifted — the stamp does not launder a hand edit', () => {
  const stamped = serverTwin.stampSectionLineage(instance());
  const edited = { ...stamped, modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text: 'HAND-EDITED', settings: {} }] };
  assert.equal(serverTwin.hasSectionDrifted(edited, master), true);
});

test('server twin: a garbage stamp can only ever clear drift, never assert it', () => {
  assert.equal(serverTwin.hasSectionDrifted(instance({ canonicalSourceHash: 'not-a-real-hash' }), master), false);
});

test('server twin: an untouched copy has NOT drifted (provenance differs, content matches)', () => {
  assert.equal(serverTwin.hasSectionDrifted(instance(), master), false);
});

test('server twin: an edited module reads as drifted', () => {
  const edited = instance({ modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text: 'SOMEONE CHANGED THIS', settings: {} }] });
  assert.equal(serverTwin.hasSectionDrifted(edited, master), true);
});

test('server twin: a changed section-level setting reads as drifted', () => {
  assert.equal(serverTwin.hasSectionDrifted(instance({ widthMode: 'narrow' }), master), true);
});

test('server twin: id/savedSectionId/canonical differing alone is NOT drift (provenance, not content)', () => {
  const onlyProvenanceDiffers = { ...master, id: 'different-id', savedSectionId: 'saved_section_footer', canonical: true };
  assert.equal(serverTwin.hasSectionDrifted(onlyProvenanceDiffers, master), false);
});

test('server twin: fails open — a missing instance or master is never reported as drifted', () => {
  assert.equal(serverTwin.hasSectionDrifted(null, master), false);
  assert.equal(serverTwin.hasSectionDrifted(instance(), null), false);
  assert.equal(serverTwin.hasSectionDrifted(undefined, undefined), false);
});
