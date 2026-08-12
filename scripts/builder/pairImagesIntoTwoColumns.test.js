'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * The script is a CLI, so its pairing logic is exercised here through a tiny
 * harness that requires the file with a stubbed database. What matters is that
 * reading order survives and that styling is not lost — a page rearranged wrong
 * is far worse than a page left alone.
 */

const SCRIPT = path.join(__dirname, '..', 'pair_images_into_two_columns.js');

function loadPairSection() {
  // The script guards its own execution behind run(); requiring it is safe, but
  // it does not export. Re-read and evaluate just the pure function instead.
  const source = require('fs').readFileSync(SCRIPT, 'utf8');
  const start = source.indexOf('/** Only these are worth pairing');
  const end = source.indexOf('async function run()');
  const body = source.slice(start, end);
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${body}\nmodule.exports = { pairSection, cloneSectionShell };`)(
    module,
    module.exports
  );
  return module.exports.pairSection;
}

const pairSection = loadPairSection();

const img = (id) => ({ id, type: 'image', column: 'main', settings: { url: `${id}.jpg` } });
const txt = (id) => ({ id, type: 'text', column: 'main', settings: { html: id } });

function section(modules, extra = {}) {
  return {
    id: 'orig',
    layout: 'single',
    background: { mode: 'color', color: '#eef' },
    paddingTop: '40',
    joinWithPrevious: false,
    modules,
    ...extra,
  };
}

test('two adjacent images become one two-column row', () => {
  const result = pairSection(section([img('a'), img('b')]));
  assert.strictEqual(result.pairs, 1);
  assert.strictEqual(result.sections.length, 1);
  assert.strictEqual(result.sections[0].layout, 'two-column');
  assert.deepStrictEqual(result.sections[0].modules.map((m) => [m.id, m.column]), [
    ['a', 'left'],
    ['b', 'right'],
  ]);
});

test('reading order is preserved exactly', () => {
  // The real Delray shape: text, image, image, text, image, image…
  const result = pairSection(section([txt('t1'), img('a'), img('b'), txt('t2'), img('c'), img('d')]));
  const flat = result.sections.flatMap((s) => s.modules.map((m) => m.id));
  assert.deepStrictEqual(flat, ['t1', 'a', 'b', 't2', 'c', 'd']);
  assert.strictEqual(result.pairs, 2);
  assert.deepStrictEqual(result.sections.map((s) => s.layout), ['single', 'two-column', 'single', 'two-column']);
});

test('an odd image keeps its own full-width row rather than being paired with text', () => {
  const result = pairSection(section([img('a'), img('b'), img('c'), txt('t')]));
  assert.strictEqual(result.pairs, 1);
  const flat = result.sections.flatMap((s) => s.modules.map((m) => m.id));
  assert.deepStrictEqual(flat, ['a', 'b', 'c', 't']);
  assert.strictEqual(result.sections[0].layout, 'two-column');
  assert.strictEqual(result.sections[1].layout, 'single');
  assert.deepStrictEqual(result.sections[1].modules.map((m) => m.column), ['main', 'main']);
});

test('a run of three pairs the first two and leaves the third alone', () => {
  const result = pairSection(section([img('a'), img('b'), img('c')]));
  assert.strictEqual(result.pairs, 1);
  assert.deepStrictEqual(result.sections.map((s) => s.layout), ['two-column', 'single']);
});

test('every row inherits the original styling, and they stay one visual block', () => {
  const result = pairSection(section([txt('t'), img('a'), img('b')]));
  for (const s of result.sections) {
    assert.deepStrictEqual(s.background, { mode: 'color', color: '#eef' });
    assert.strictEqual(s.paddingTop, '40');
  }
  // Only the first starts a new background run; the rest extend it.
  assert.strictEqual(result.sections[0].joinWithPrevious, false);
  assert.ok(result.sections.slice(1).every((s) => s.joinWithPrevious === true));
});

test('a section already joined to the one above stays joined', () => {
  const result = pairSection(section([img('a'), img('b')], { joinWithPrevious: true }));
  assert.strictEqual(result.sections[0].joinWithPrevious, true);
});

test('new rows get unique ids and never reuse the original', () => {
  const result = pairSection(section([txt('t'), img('a'), img('b'), txt('u'), img('c'), img('d')]));
  const ids = result.sections.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'ids must be unique');
  assert.ok(!ids.includes('orig'));
});

test('nothing to do is reported as nothing to do', () => {
  assert.strictEqual(pairSection(section([txt('a'), txt('b')])), null, 'no images');
  assert.strictEqual(pairSection(section([txt('a'), img('b'), txt('c')])), null, 'no two images adjacent');
  assert.strictEqual(pairSection(section([img('a')])), null, 'a single module');
  assert.strictEqual(
    pairSection(section([img('a'), img('b')], { layout: 'two-column' })),
    null,
    'already two-column — a re-run must be a no-op'
  );
});

test('non-image modules are never paired', () => {
  const slideshow = { id: 's', type: 'slideshow', column: 'main', settings: {} };
  const table = { id: 'tb', type: 'table', column: 'main', settings: {} };
  assert.strictEqual(pairSection(section([slideshow, table])), null);
});

test('modules are otherwise untouched', () => {
  const result = pairSection(section([img('a'), img('b')]));
  assert.deepStrictEqual(result.sections[0].modules[0].settings, { url: 'a.jpg' });
  assert.strictEqual(result.sections[0].modules[0].type, 'image');
});
