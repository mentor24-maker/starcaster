'use strict';

/**
 * Task 86bc0d1fg — an ordinary Save Page must not wipe the page's own
 * typography or its page background.
 *
 * `layout_sections` is ONE database column holding THREE things: the sections,
 * the page background and the page theme. `inputToRow` rebuilds that whole
 * column whenever a patch names any one of them — so a patch naming only
 * `layoutSections` writes the other two as `undefined` and the serializer
 * fills each with its default.
 *
 * That is what the page editor sends. Measured 2026-09-14 by capturing the
 * request in a real browser: its PATCH to /api/builder/landing-pages/<id>
 * carries `layoutSections` and 31 other fields, and neither `theme` nor
 * `pageBackground`. So pressing Save Page with nothing changed reset the
 * page's heading sizes, line heights and heading weights, silently, on all
 * 183 stored pages that carry a theme of their own.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeLayoutColumnFromPrevious } = require('../../lib/builderPagesStore');

/** The editor's real save payload, trimmed to the fields that matter here. */
const EDITOR_PATCH = {
  id: '1445',
  name: 'Panel Lattice Check',
  templateKind: 'modular',
  layoutSections: [{ id: 'section_1', layout: 'single', modules: [] }],
  slug: 'panel-lattice-check',
  isPublished: true,
};

const PREVIOUS = {
  theme: { typography: { scale: { baseSize: 18, ratio: 1.25, baseLineHeight: 1.6, h1: 44 } } },
  pageBackground: { mode: 'color', color: '#112233', color2: '', imageUrl: '', styleKey: '' },
};

test('an editor save that names no theme keeps the page theme it already had', () => {
  const merged = mergeLayoutColumnFromPrevious(EDITOR_PATCH, PREVIOUS);
  assert.deepEqual(merged.theme, PREVIOUS.theme);
});

test('an editor save that names no page background keeps the one it already had', () => {
  const merged = mergeLayoutColumnFromPrevious(EDITOR_PATCH, PREVIOUS);
  assert.deepEqual(merged.pageBackground, PREVIOUS.pageBackground);
});

test('the sections the patch DID send still win', () => {
  const merged = mergeLayoutColumnFromPrevious(EDITOR_PATCH, PREVIOUS);
  assert.deepEqual(merged.layoutSections, EDITOR_PATCH.layoutSections);
});

test('a patch that names a theme is left alone — even when it names an empty one', () => {
  // Resetting a page to the default typography is a real move, and it arrives
  // as `theme: {}`. hasInputField asks whether the KEY is present, never
  // whether the value is truthy, so the carry must not fire here — otherwise
  // the reset silently does nothing.
  const merged = mergeLayoutColumnFromPrevious({ ...EDITOR_PATCH, theme: {} }, PREVIOUS);
  assert.deepEqual(merged.theme, {});
});

test('a patch that names a page background is left alone, including an empty one', () => {
  const merged = mergeLayoutColumnFromPrevious(
    { ...EDITOR_PATCH, pageBackground: { mode: 'none' } },
    PREVIOUS
  );
  assert.deepEqual(merged.pageBackground, { mode: 'none' });
});

test('a metadata-only save is not touched, and never invents a layout field', () => {
  // A rename does not rebuild the layout column at all, so adding theme or
  // pageBackground to it would make it start doing so.
  const rename = { id: '1445', name: 'Renamed' };
  const merged = mergeLayoutColumnFromPrevious(rename, PREVIOUS);
  assert.equal(merged, rename);
  assert.equal(Object.prototype.hasOwnProperty.call(merged, 'theme'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(merged, 'pageBackground'), false);
});

test('with no previous row to read there is nothing to carry, and the input stands', () => {
  const merged = mergeLayoutColumnFromPrevious(EDITOR_PATCH, null);
  assert.equal(merged, EDITOR_PATCH);
});
