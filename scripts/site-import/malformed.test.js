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


test('nav: submenus survive wrapper elements (nav > div > ul)', () => {
  // The delraytennis.com shape: the menu list is wrapped in a div, and
  // three top-level items carry submenus. Before the fix this produced 18
  // flat items via the link-scan fallback.
  const html = `<body><div class="site-container"><nav class="nav-primary"><div class="wrap"><ul>
    <li><a href="/">Home</a></li>
    <li><a href="/info">Tennis Center Info</a>
      <ul>
        <li><a href="/about">About Us</a></li>
        <li><a href="/fees">Court Fees</a></li>
      </ul>
    </li>
    <li><a href="/programs">Programs &amp; Events</a>
      <div class="sub-wrap"><ul><li><a href="/schedule">Program Schedule</a></li></ul></div>
    </li>
  </ul></div></nav></div></body>`;
  const { ir } = normalizeSite(pageWith(html));
  const nav = ir.taxonomy.navs[0];
  assert.ok(nav, 'a nav was extracted');
  assert.equal(nav.items.length, 3, 'three TOP-LEVEL items, not a flattened list');
  assert.deepEqual(nav.items.map((i) => i.label), ['Home', 'Tennis Center Info', 'Programs & Events']);
  assert.deepEqual(nav.items[1].children.map((c) => c.label), ['About Us', 'Court Fees']);
  // Submenu wrapped in its own div still resolves.
  assert.deepEqual(nav.items[2].children.map((c) => c.label), ['Program Schedule']);
  assert.equal(nav.items[1].href, '/info', "a parent item keeps its own link, not a child's");
  // Class-based location: no <header> tag anywhere, but nav-primary is the
  // site's header menu (delray classified as "other" before the fix).
  assert.equal(nav.location, 'header');
});

test('nav: body/html classes never decide a nav location', () => {
  // WordPress themes put region words on the body ("footer-widgets"), which
  // describes the page, not where the nav sits. delraytennis.com's header
  // menu was labelled "footer" because of exactly this.
  const html = `<body class="home wp-singular footer-widgets"><div class="site-container">
    <nav class="nav-primary"><div><ul><li><a href="/">Home</a></li></ul></div></nav>
  </div></body>`;
  const { ir } = normalizeSite(pageWith(html));
  assert.equal(ir.taxonomy.navs[0].location, 'header');
});

test('nav: no list markup still yields a flat menu (fallback intact)', () => {
  const html = '<body><header><nav><div><a href="/">Home</a><a href="/x">About</a></div></nav></header></body>';
  const { ir } = normalizeSite(pageWith(html));
  assert.deepEqual(ir.taxonomy.navs[0].items.map((i) => i.label), ['Home', 'About']);
  assert.equal(ir.taxonomy.navs[0].location, 'header');
});

test('nav: parent item without its own link keeps only its own label', () => {
  const html = `<body><footer><nav><ul>
    <li><span>Resources</span><ul><li><a href="/a">Guides</a></li></ul></li>
  </ul></nav></footer></body>`;
  const { ir } = normalizeSite(pageWith(html));
  const item = ir.taxonomy.navs[0].items[0];
  assert.equal(item.label, 'Resources', 'child labels are not absorbed into the parent');
  assert.deepEqual(item.children.map((c) => c.label), ['Guides']);
  assert.equal(ir.taxonomy.navs[0].location, 'footer');
});

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
