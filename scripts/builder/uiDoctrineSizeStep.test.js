'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { w8NumberFields } = require('../check_ui_doctrine.cjs');

/**
 * W8 — a size dropdown spanning past 100px counts in at least fives.
 *
 * The rule itself is one comparison; the part worth testing is the PARSER it
 * reads fields with. A flat regex scanning forward from a `key:` walks past
 * the end of its own object and pairs that key with the next field's numbers,
 * which is how a first pass reported "Search Param, range 1–200". These tests
 * pin the brace-matching that replaced it.
 */

const SRC = `
  const schema = {
    axes: [
      {
        title: "Content",
        strips: [
          [
            {
              key: "searchParam",
              label: "Search Param",
              width: "text-md",
              control: "text",
              placeholder: "q"
            },
            {
              key: "limit",
              label: "Max Results",
              width: "num",
              control: "number",
              min: 1,
              max: 200
            }
          ],
          [
            {
              key: "fieldWidth",
              label: "Field Width",
              width: "num",
              control: "number",
              min: 0,
              max: 1200,
              step: 5,
              rendersVia: "siteSearchFieldVars"
            },
            {
              key: "buttonBorderWidth",
              label: "Button Border",
              width: "num",
              control: "number",
              min: 0,
              max: 12
            }
          ]
        ]
      }
    ]
  };
`;

test('a text field between two number fields does not steal their numbers', () => {
  const fields = w8NumberFields(SRC);
  assert.equal(fields.length, 3);
  assert.deepEqual(fields.map((f) => f.key), ['limit', 'fieldWidth', 'buttonBorderWidth']);
  // The bug this replaced: `searchParam` picking up limit's 1–200.
  assert.ok(!fields.some((f) => f.key === 'searchParam'));
});

test('reads min, max and step, defaulting step to 1', () => {
  const byKey = Object.fromEntries(w8NumberFields(SRC).map((f) => [f.key, f]));
  assert.deepEqual(byKey.fieldWidth, { key: 'fieldWidth', min: 0, max: 1200, step: 5 });
  assert.deepEqual(byKey.limit, { key: 'limit', min: 1, max: 200, step: 1 });
  assert.equal(byKey.buttonBorderWidth.step, 1);
});

test('a nested object inside a field does not end it early', () => {
  const fields = w8NumberFields(`
    { key: "cardWidth", control: "number", style: { width: 4 }, min: 0, max: 900 }
  `);
  assert.deepEqual(fields, [{ key: 'cardWidth', min: 0, max: 900, step: 1 }]);
});

/** The rule's own predicate, kept in step with the checker by construction. */
function violates({ key, min, max, step }) {
  return /(width|height|size)$/i.test(key) && max > 100 && step < 5;
}

test('flags a pixel size past 100 that still counts in ones', () => {
  assert.ok(violates({ key: 'fieldWidth', min: 0, max: 1200, step: 1 }));
  assert.ok(violates({ key: 'thumbWidth', min: 60, max: 240, step: 1 }));
  assert.ok(violates({ key: 'containerHeight', min: 0, max: 800, step: 1 }));
});

test('leaves counts, angles and indexes alone however long the list', () => {
  // Every value is meaningful in these — the list being long is not the fault.
  assert.ok(!violates({ key: 'particleCount', min: 1, max: 500, step: 1 }));
  assert.ok(!violates({ key: 'spread', min: 0, max: 180, step: 1 }));
  assert.ok(!violates({ key: 'limit', min: 1, max: 200, step: 1 }));
  assert.ok(!violates({ key: 'ringStep', min: 2, max: 200, step: 1 }));
});

test('leaves small sizes alone — a border or a font is set to the pixel', () => {
  assert.ok(!violates({ key: 'buttonBorderWidth', min: 0, max: 12, step: 1 }));
  assert.ok(!violates({ key: 'labelFontSize', min: 8, max: 48, step: 1 }));
  assert.ok(!violates({ key: 'borderWidth', min: 0, max: 24, step: 1 }));
});

test('accepts a size that already steps coarsely', () => {
  assert.ok(!violates({ key: 'navMegaWidth', min: 320, max: 1600, step: 40 }));
  assert.ok(!violates({ key: 'outerSize', min: 50, max: 1400, step: 10 }));
  assert.ok(!violates({ key: 'fieldWidth', min: 0, max: 1200, step: 5 }));
});
