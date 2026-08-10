'use strict';

/**
 * Coverage accounting (spec §1c amendment C): the captured-side counter
 * walks raw HTML, the emitted-side counter tallies the IR, and any
 * difference must surface as `dropped`. The methodology pins here encode
 * the COUNTING METHODOLOGY block in lib/site-import/ir.ts — if one of
 * these fails after an intentional methodology change, update ir.ts and
 * the snapshots together.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeSite,
  countCapturedByClass,
  tallyEmittedByClass,
  computeCoverage,
} = require('../../lib/site-import/dist/normalize.js');

test('methodology pins: what counts as one countable', () => {
  const cases = [
    // Inline link inside a text atom is part of the text, not a countable.
    ["<body><p>Hello <a href='/x'>link</a></p></body>", { text: 1 }],
    // <li> is a container: its link counts, its bare text counts as text.
    ["<body><ul><li><a href='/a'>A</a></li><li>plain</li></ul></body>", { link: 1, text: 1 }],
    // Bare text run in a descended div + a paragraph.
    ['<body><div>words<p>para</p></div></body>', { text: 2 }],
    // Only submit/button inputs are buttons; a text input is not content.
    ["<body><input type='submit'><input type='text'></body>", { button: 1 }],
    // A layout table is ONE table atom — everything inside rides along.
    ["<body><table><tr><td><img src='x.png'></td></tr></table></body>", { table: 1 }],
    // role=button on a div.
    ["<body><div role='button'>Go</div></body>", { button: 1 }],
    // Linked image: the anchor atom swallows the img (counted as link).
    ["<body><a href='/'><img src='logo.png'></a></body>", { link: 1 }],
    // Headings and media.
    ['<body><h1>T</h1><video src="v.mp4"></video><iframe src="f"></iframe></body>',
      { heading: 1, video: 1, embed: 1 }],
    // script/style/template content is not countable.
    ['<body><script>var x=1;</script><style>.a{}</style><p>real</p></body>', { text: 1 }],
  ];
  for (const [html, expected] of cases) {
    assert.deepEqual(countCapturedByClass(html), expected, html);
  }
});

for (const name of ['wordpress', 'jsframework', 'tablelayout']) {
  test(`fixture ${name}: dropped is empty and both counters agree`, () => {
    const input = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8')
    );
    const { coverage } = normalizeSite(input);
    assert.deepEqual(coverage.dropped, {});
    assert.deepEqual(coverage.captured, coverage.emitted);
    // A healthy fixture actually counted something.
    assert.ok(Object.keys(coverage.captured).length > 0);
  });
}

test('mutation: removing an element from the IR is caught as dropped', () => {
  const input = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'wordpress.json'), 'utf8')
  );
  const { ir, coverage } = normalizeSite(input);

  // Vandalize the IR: silently delete one element, the exact failure mode
  // coverage accounting exists to catch.
  const section = ir.pages[0].sections.find((s) => s.elements.length > 0);
  const removed = section.elements.splice(0, 1)[0];

  const recomputed = computeCoverage({
    captured: coverage.captured,
    emitted: tallyEmittedByClass(ir),
    pages: coverage.pages,
    capsHit: coverage.caps.hit,
  });
  assert.deepEqual(recomputed.dropped, { [removed.class]: 1 });
});
