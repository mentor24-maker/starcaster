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

test('server twin: getSectionContent strips id, savedSectionId, canonical — what a push overwrites', () => {
  const content = serverTwin.getSectionContent(instance());
  assert.equal('id' in content, false);
  assert.equal('savedSectionId' in content, false);
  assert.equal('canonical' in content, false);
  assert.equal(content.title, 'Footer');
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
