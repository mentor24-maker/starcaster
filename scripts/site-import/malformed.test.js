'use strict';

/**
 * The normalizer must NEVER throw (spec §1c) — deliberately broken HTML
 * degrades to countable elements with the raw content preserved, and both
 * coverage counters walk the same tree, so even pathological pages report
 * dropped: {}. This suite is the torture chamber for that guarantee.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSite } = require('../../lib/site-import/dist/normalize.js');

function pageWith(html) {
  return {
    jobId: 'j',
    sourceUrl: 'https://broken.test/',
    capturedAt: '2026-08-05T00:00:00.000Z',
    assets: [],
    pages: [
      {
        desktop: {
          url: 'https://broken.test/',
          finalUrl: 'https://broken.test/',
          viewport: 'desktop',
          html,
          styles: {},
          fullPageScreenshot: '',
          sectionScreenshots: {},
          elementScreenshots: {},
          assetUrls: [],
          fontFamilies: [],
          meta: { title: '', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: '' },
        },
      },
    ],
  };
}

function allElements(ir) {
  return ir.pages.flatMap((p) => p.sections.flatMap((s) => s.elements));
}

test('unclosed tags: no throw, text preserved, nothing dropped', () => {
  const { ir, coverage } = normalizeSite(
    pageWith('<body><div><p>hello <b>world</div><h2>dangling')
  );
  const text = allElements(ir).map((e) => e.textContent).join(' ');
  assert.ok(text.includes('hello world'));
  assert.ok(text.includes('dangling'));
  assert.deepEqual(coverage.dropped, {});
});

test('mis-nested table content: foster-parented text still counted', () => {
  const { ir, coverage } = normalizeSite(
    pageWith('<body><table><div>stray words</div><tr><td>cell</td></tr></table></body>')
  );
  const text = allElements(ir).map((e) => e.textContent).join(' ');
  assert.ok(text.includes('stray words'));
  assert.deepEqual(coverage.dropped, {});
});

test('exotic and invalid entities: no throw', () => {
  const { coverage } = normalizeSite(
    pageWith('<body><p>&nbsp;&copy;&#x1F600;&bogus; &#999999999;</p></body>')
  );
  assert.deepEqual(coverage.dropped, {});
});

test('10 MB single node: no throw, full text length recorded', () => {
  const big = 'x'.repeat(10 * 1000 * 1000);
  const { ir, coverage } = normalizeSite(pageWith('<body><div>' + big + '</div></body>'));
  const el = allElements(ir).find((e) => e.class === 'text');
  assert.equal(el.textLength, big.length);
  assert.deepEqual(coverage.dropped, {});
});

test('5000-deep nesting: iterative walk survives, content reached', () => {
  const depth = 5000;
  const html =
    '<body>' + '<div>'.repeat(depth) + 'deep content' + '</div>'.repeat(depth) + '</body>';
  const { ir, coverage } = normalizeSite(pageWith(html));
  const el = allElements(ir).find((e) => e.textContent === 'deep content');
  assert.ok(el, 'text at the bottom of the nesting was emitted');
  assert.deepEqual(coverage.dropped, {});
});

test('sanitizer-hostile atoms degrade to their class with raw HTML kept', () => {
  const { ir, coverage } = normalizeSite(
    pageWith("<body><svg viewBox='0 0 1 1'><circle r='1'></svg><audio src='x.mp3'></audio></body>")
  );
  const others = allElements(ir).filter((e) => e.class === 'other');
  assert.equal(others.length, 2);
  assert.ok(others[0].html.includes('<svg'));
  assert.ok(others[1].html.includes('audio'));
  assert.deepEqual(coverage.dropped, {});
});

test('non-string and empty html values: no throw', () => {
  for (const html of [null, undefined, 0, '', '   ', '<<<>>>']) {
    const out = normalizeSite(pageWith(html));
    assert.ok(out.ir);
    assert.deepEqual(out.coverage.dropped, {});
  }
});

test('garbage input object: no throw, empty IR', () => {
  for (const input of [null, undefined, {}, { pages: 'nope' }]) {
    const out = normalizeSite(input);
    assert.ok(out.ir);
    assert.equal(out.ir.pages.length, 0);
  }
});
