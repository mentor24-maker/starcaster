'use strict';

/**
 * Column inference (lib/site-import/columns.ts) and its use by the mapper.
 * Task 86bce4vv8: daneofearth.org's 2x2 grid and side-by-side blocks all
 * arrived in Builder as one long column.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planSectionGrid,
  chooseLayout,
  columnKeys,
  LAYOUT_RATIOS,
  mergeMappedSections,
} = require('../../lib/site-import/dist/columns.js');
const { mapSite, reportReconciles } = require('../../lib/site-import/dist/map.js');
const template = require('../../lib/builder/template.js');

const box = (x, y, w, h) => ({ x, y, w, h });
const cellsOf = (grid) => Object.fromEntries([...grid.cells].map(([id, c]) => [id, `${c.band}:${c.col}`]));

test('a 2x2 grid under a heading is one heading row and ONE two-column row', () => {
  const grid = planSectionGrid([
    { id: 'h', box: box(0, 0, 1000, 60) },
    { id: 'a', box: box(0, 100, 480, 200) },
    { id: 'b', box: box(520, 100, 480, 200) },
    { id: 'c', box: box(0, 340, 480, 200) },
    { id: 'd', box: box(520, 340, 480, 220) },
  ]);
  assert.deepEqual(cellsOf(grid), { h: '0:0', a: '1:0', b: '1:1', c: '1:0', d: '1:1' });
  assert.equal(grid.bands.length, 2);
  assert.equal(grid.bands[1].columns.length, 2);
});

test('an image beside a stack of text is a two-column row', () => {
  const grid = planSectionGrid([
    { id: 'img', box: box(0, 0, 330, 400) },
    { id: 't1', box: box(370, 10, 630, 40) },
    { id: 't2', box: box(370, 60, 630, 200) },
    { id: 'btn', box: box(370, 280, 200, 50) },
  ]);
  assert.deepEqual(cellsOf(grid), { img: '0:0', t1: '0:1', t2: '0:1', btn: '0:1' });
});

test('stacked content stays stacked — the old behaviour is the fallback', () => {
  const grid = planSectionGrid([
    { id: 'a', box: box(0, 0, 1000, 50) },
    { id: 'b', box: box(0, 60, 1000, 300) },
    { id: 'c', box: box(100, 380, 800, 40) },
  ]);
  assert.equal(grid.bands.length, 1);
  assert.deepEqual(new Set(Object.values(cellsOf(grid))), new Set(['0:0']));
});

test('no positions (a capture made before this change) means one stacked row', () => {
  const grid = planSectionGrid([{ id: 'a' }, { id: 'b', box: null }, { id: 'c' }]);
  assert.deepEqual(cellsOf(grid), { a: '0:0', b: '0:0', c: '0:0' });
});

test('an icon beside a line of text is decoration, not a column', () => {
  const grid = planSectionGrid([
    { id: 'icon', box: box(0, 0, 24, 24) },
    { id: 'text', box: box(40, 0, 900, 24) },
  ]);
  assert.equal(grid.bands[0].columns.length, 1);
});

test('six across is one six-column row; eight across wraps four + four', () => {
  const six = planSectionGrid(
    Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, box: box(i * 170, 0, 150, 100) }))
  );
  assert.equal(six.bands.length, 1);
  assert.equal(six.bands[0].columns.length, 6);

  const eight = planSectionGrid(
    Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, box: box(i * 125, 0, 110, 100) }))
  );
  assert.deepEqual(eight.bands.map((b) => b.columns.length), [4, 4]);
});

test('an unpositioned element rides with the element before it', () => {
  const grid = planSectionGrid([
    { id: 'a', box: box(0, 0, 480, 100) },
    { id: 'run' },
    { id: 'b', box: box(520, 0, 480, 100) },
  ]);
  assert.deepEqual(cellsOf(grid), { a: '0:0', run: '0:0', b: '0:1' });
});

test('chooseLayout snaps measured widths to the nearest Builder layout', () => {
  assert.equal(chooseLayout([500]), 'single');
  assert.equal(chooseLayout([480, 480]), 'two-column');
  assert.equal(chooseLayout([330, 630]), 'two-four');
  assert.equal(chooseLayout([700, 240]), 'three-one');
  assert.equal(chooseLayout([390, 590]), 'two-three');
  assert.equal(chooseLayout([300, 300, 300]), 'three-column');
  assert.equal(chooseLayout([160, 640, 160]), 'one-four-one');
  assert.equal(chooseLayout([1, 1, 1, 1]), 'four-column');
  assert.equal(chooseLayout([1, 1, 1, 1, 1, 1]), 'six-column');
});

test('the layout table matches Builder: same names, same columns, same track ratios', () => {
  for (const [layout, ratios] of Object.entries(LAYOUT_RATIOS)) {
    assert.equal(template.normalizeLayout(layout), layout, `${layout} is not a Builder layout`);
    assert.deepEqual(template.getLayoutColumns(layout), columnKeys(ratios.length), layout);
    assert.equal(
      template.getLayoutGridTemplate(layout),
      ratios.map((r) => `${r}fr`).join(' '),
      `${layout} track ratios`
    );
  }
});

function gridIr(withBoxes) {
  const el = (sourceId, cls, text, b) => ({
    sourceId,
    class: cls,
    html: cls === 'heading' ? `<h2>${text}</h2>` : `<p>${text}</p>`,
    textContent: text,
    textLength: text.length,
    computedStyles: {},
    documentPosition: 0,
    depth: 3,
    assetRefs: [],
    ...(withBoxes ? { box: b } : {}),
  });
  return {
    irVersion: '1.0',
    jobId: 'job-columns',
    sourceUrl: 'https://grid.test/',
    capturedAt: '2026-10-06T00:00:00.000Z',
    assets: [],
    taxonomy: { navs: [], pageOrder: ['/'] },
    pages: [{
      url: 'https://grid.test/',
      path: '/',
      title: 'Grid',
      metaDescription: '',
      ogTags: {},
      canonicalUrl: '',
      lang: 'en',
      screenshots: { desktop: '', tablet: '', mobile: '' },
      sections: [{
        sourceId: '0-sec',
        type: 'unknown',
        screenshot: '',
        elements: [
          el('0-h', 'heading', 'Four things', box(0, 0, 1000, 60)),
          el('0-a', 'text', 'Alpha', box(0, 100, 480, 200)),
          el('0-b', 'text', 'Bravo', box(520, 100, 480, 200)),
          el('0-c', 'text', 'Charlie', box(0, 340, 480, 200)),
          el('0-d', 'text', 'Delta', box(520, 340, 480, 200)),
        ],
      }],
    }],
    tokens: { colors: [], fontSizes: [], fontFamilies: [], spacing: [] },
    coverage: {},
  };
}

const MAP_OPTS = { existingSlugs: [] };

test('the mapper turns a positioned 2x2 grid into a heading row + a two-column row', () => {
  const out = mapSite(gridIr(true), MAP_OPTS);
  assert.ok(reportReconciles(out.report));
  const [page] = out.pages;
  assert.equal(page.sections.length, 2);
  const [head, grid] = page.sections;
  assert.equal(head.layout, 'single');
  assert.equal(head.id, 'imps_0sec');
  assert.equal(grid.layout, 'two-column');
  assert.equal(grid.id, 'imps_0secb1');
  // Prose never merges across a cell: four text modules, two per column,
  // in reading order within each column.
  assert.deepEqual(
    grid.modules.map((m) => `${m.column}:${m.text}`),
    ['left:<p>Alpha</p>', 'right:<p>Bravo</p>', 'left:<p>Charlie</p>', 'right:<p>Delta</p>']
  );
  for (const section of page.sections) {
    assert.equal(section.modules[0].settings.importSectionSourceId, '0-sec');
  }
  // Every element is accounted for in exactly one row.
  assert.deepEqual(
    page.sections.flatMap((s) => s.sourceElementIds).sort(),
    ['0-a', '0-b', '0-c', '0-d', '0-h']
  );
});

test('the same grid with no positions maps exactly as before: one single-column section', () => {
  const out = mapSite(gridIr(false), MAP_OPTS);
  const [page] = out.pages;
  assert.equal(page.sections.length, 1);
  assert.equal(page.sections[0].id, 'imps_0sec');
  assert.equal(page.sections[0].layout, 'single');
  assert.ok(page.sections[0].modules.every((m) => m.column === 'main'));
  assert.equal(page.sections[0].modules.length, 1, 'all prose merges into one text module, as it always did');
});

test('a re-import puts a split section\'s new rows straight after its first row', () => {
  const current = [{ id: 'hero' }, { id: 'imps_A' }, { id: 'hand-made' }, { id: 'imps_B' }];
  const mapped = [{ id: 'imps_A', v: 2 }, { id: 'imps_Ab1', v: 2 }, { id: 'imps_Ab2', v: 2 }, { id: 'imps_B', v: 2 }];
  const merged = mergeMappedSections(current, mapped, new Set());
  assert.deepEqual(merged.map((s) => s.id), ['hero', 'imps_A', 'imps_Ab1', 'imps_Ab2', 'hand-made', 'imps_B']);
  assert.equal(merged[1].v, 2);

  // A section a human edited keeps its content; its new sibling rows still
  // land beside it rather than at the bottom.
  const guarded = mergeMappedSections(current, mapped, new Set(['imps_A']));
  assert.equal(guarded[1].v, undefined);
  assert.deepEqual(guarded.map((s) => s.id).slice(0, 4), ['hero', 'imps_A', 'imps_Ab1', 'imps_Ab2']);

  // First import: nothing on the page yet, everything in mapping order.
  assert.deepEqual(mergeMappedSections([], mapped, new Set()).map((s) => s.id), mapped.map((s) => s.id));
});
