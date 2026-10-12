'use strict';

/*
 * The SERVER copy of the Galaxy normalizer must keep Tilt with Cursor on an
 * In Place galaxy (task 86bcgjr0w). The client source was changed to offer
 * it; if `npm run build:builder-template` were skipped, `lib/builder/template.js`
 * would still offer only rotate/none In Place and rewrite a saved "tilt" back
 * to "rotate" on every page load (CLAUDE.md landmine 1) — the panel would say
 * Tilt and the live site would not do it. This runs after the build, against
 * the generated file, which is the copy the server actually uses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBuilderModuleSettingsForType } = require('../../lib/builder/template');

const norm = (settings) => normalizeBuilderModuleSettingsForType('galaxy', settings).interaction;

test('an In Place galaxy saved with Tilt with Cursor reloads as tilt', () => {
  assert.equal(norm({ placement: 'inline', interaction: 'tilt' }), 'tilt');
});

test('In Place still defaults to Drag to Rotate, and a Window galaxy is unchanged', () => {
  assert.equal(norm({ placement: 'inline' }), 'rotate');
  assert.equal(norm({ placement: 'inline', interaction: 'spin' }), 'rotate');
  assert.equal(norm({ placement: 'window', interaction: 'rotate' }), 'tilt');
  assert.equal(norm({ placement: 'window', interaction: 'tilt' }), 'tilt');
});
