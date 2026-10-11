'use strict';

/**
 * scripts/strip_import_placeholder_captions.js — task 86bcgdm83.
 *
 * The importer used to write "Imported form — rebuild with a real module."
 * into a placeholder's text, where visitors read it. The data pass moves the
 * caption into `settings.importPlaceholder` (shown in the Builder only) in
 * drafts AND published copies, and must leave everything else alone.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stripCaptions,
  countCaptions,
  rewritePublishedCopy,
} = require('../strip_import_placeholder_captions.js');

const crop = '<img src="https://blob.test/crop.png" alt="Screenshot of imported form" style="max-width:100%" />';

function placeholder(caption, extra = {}) {
  return {
    id: 'm1',
    type: 'code',
    column: 'main',
    text: `${crop}<p><em>${caption}</em></p>`,
    settings: { label: 'Imported form', importClass: 'form', ...extra },
  };
}

function sections(...modules) {
  return { sections: [{ id: 's1', modules }] };
}

test('the caption leaves the text, the screenshot stays, the Builder keeps the caption', () => {
  const stats = { modules: 0 };
  const out = stripCaptions(sections(placeholder('Imported form — rebuild with a real module.')), stats);
  const m = out.sections[0].modules[0];
  assert.equal(stats.modules, 1);
  assert.equal(m.text, crop);
  assert.equal(m.settings.importPlaceholder, 'Imported form — rebuild with a real module.');
  assert.equal(countCaptions([out]), 0);
});

test('the too-large-to-split caption is moved too, and entities are decoded', () => {
  const out = stripCaptions(sections(placeholder('Imported other too large to split &amp; rebuild manually.')));
  assert.equal(out.sections[0].modules[0].settings.importPlaceholder, 'Imported other too large to split & rebuild manually.');
});

test('a hand-made code module and an ordinary text module are untouched', () => {
  const handMade = { id: 'c', type: 'code', text: '<p><em>please rebuild me</em></p>', settings: { label: 'x' } };
  const prose = { id: 't', type: 'text', text: '<p><em>rebuild with a real module</em></p>', settings: {} };
  const stats = { modules: 0 };
  const out = stripCaptions(sections(handMade, prose), stats);
  assert.equal(stats.modules, 0);
  assert.deepEqual(out, sections(handMade, prose));
});

test('a second run changes nothing', () => {
  const once = stripCaptions(sections(placeholder('Imported video — rebuild with a real module.')));
  const stats = { modules: 0 };
  assert.deepEqual(stripCaptions(once, stats), once);
  assert.equal(stats.modules, 0);
});

test('a published copy in step with its draft is stamped in step; one already behind keeps its stamp', () => {
  const payload = JSON.stringify({ updatedAt: '2026-10-01T00:00:00Z', layoutSections: sections(placeholder('Imported form — rebuild with a real module.')).sections });
  const inStep = rewritePublishedCopy(
    { payload, source_updated_at: '2026-10-01T00:00:00Z' }, '2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z'
  );
  assert.equal(inStep.sourceUpdatedAt, '2026-10-10T00:00:00Z');
  assert.equal(typeof inStep.payload, 'string');
  assert.equal(countCaptions([JSON.parse(inStep.payload)]), 0);

  const behind = rewritePublishedCopy(
    { payload, source_updated_at: '2026-09-01T00:00:00Z' }, '2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z'
  );
  assert.equal(behind.sourceUpdatedAt, '2026-09-01T00:00:00Z');

  const clean = rewritePublishedCopy({ payload: JSON.stringify({ layoutSections: [] }) }, '', 'x');
  assert.equal(clean, null);
});
