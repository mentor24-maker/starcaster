'use strict';

/**
 * Snapshot tests: each CaptureResult fixture (three site archetypes, spec
 * §Testing) runs through the normalizer and must produce byte-identical
 * output to its committed .expected.json. Regenerate deliberately with
 *   UPDATE_SNAPSHOTS=1 npm run test:site-import
 * and review the diff like any code change — the snapshot IS the contract.
 *
 * Requires the built bundle; `npm run test:site-import` builds it first.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeSite,
  computeSourceId,
} = require('../../lib/site-import/dist/normalize.js');

const FIXTURES = ['wordpress', 'jsframework', 'tablelayout'];
const fixturesDir = path.join(__dirname, 'fixtures');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
}

for (const name of FIXTURES) {
  test(`fixture ${name}: normalizer output matches snapshot`, () => {
    const input = loadJson(`${name}.json`);
    const output = normalizeSite(input);
    const expectedPath = path.join(fixturesDir, `${name}.expected.json`);

    if (process.env.UPDATE_SNAPSHOTS) {
      fs.writeFileSync(expectedPath, JSON.stringify(output, null, 2) + '\n');
      return;
    }
    assert.ok(
      fs.existsSync(expectedPath),
      `missing snapshot ${name}.expected.json — run UPDATE_SNAPSHOTS=1 npm run test:site-import and review it`
    );
    assert.deepEqual(output, loadJson(`${name}.expected.json`));
  });
}

test('wordpress fixture: structural spot-checks behind the snapshot', () => {
  const { ir, coverage } = normalizeSite(loadJson('wordpress.json'));

  assert.equal(ir.irVersion, '1.0');
  assert.equal(ir.pages.length, 2);
  assert.deepEqual(ir.taxonomy.pageOrder, ['/', '/about/']);

  // Header/footer navs found once each — the identical trees on the about
  // page dedupe away.
  assert.deepEqual(ir.taxonomy.navs.map((n) => n.location), ['header', 'footer']);
  const header = ir.taxonomy.navs[0];
  assert.deepEqual(header.items.map((i) => i.label), ['Home', 'About', 'Contact']);
  assert.deepEqual(header.items[1].children.map((i) => i.label), ['Our Team']);

  // Home page: 5 top-level sections (header, hero, features, signup,
  // footer), each with its capture crop joined by candidate index.
  const home = ir.pages[0];
  assert.equal(home.sections.length, 5);
  assert.equal(home.sections[1].screenshot, 'SiteImport/job-fixture-wp/shots/home.desktop.s1.png');
  assert.equal(home.sections.every((s) => s.type === 'unknown'), true);

  // The relative-src <img> resolved against the page URL and matched
  // asset a2; the normalizer wrote the back-reference onto the manifest.
  const img = home.sections
    .flatMap((s) => s.elements)
    .find((e) => e.class === 'image');
  assert.deepEqual(img.assetRefs, ['a2']);
  const a2 = ir.assets.find((a) => a.id === 'a2');
  assert.deepEqual(a2.referencedBy, [{ pageUrl: 'https://example-wp.com/', sourceId: img.sourceId }]);

  // Style compaction kept the real values and dropped browser defaults.
  const h1 = home.sections[1].elements.find((e) => e.class === 'heading');
  assert.equal(h1.computedStyles['font-size'], '48px');
  assert.equal(h1.computedStyles['margin-top'], undefined); // 0px default
  assert.equal(h1.computedStyles['text-align'], undefined); // "start" default

  // Verbatim HTML with the capture markers stripped.
  assert.ok(h1.html.includes('Play Padel in Delray Beach'));
  assert.ok(!h1.html.includes('data-scim'));

  // Nothing dropped, and both sides agree.
  assert.deepEqual(coverage.dropped, {});
  assert.deepEqual(coverage.captured, coverage.emitted);
  assert.deepEqual(coverage.pages, { discovered: 2, captured: 2, failed: 0 });
});

test('element screenshot crops join by sourceId', () => {
  // The capture layer keys sanitizer-stripped elements' crops by the same
  // computeSourceId the normalizer derives — this pins that join.
  const sid = computeSourceId(0, 'body/form[0]');
  const { ir } = normalizeSite({
    jobId: 'j',
    sourceUrl: 'https://x.test/',
    capturedAt: '2026-08-05T00:00:00.000Z',
    assets: [],
    pages: [
      {
        desktop: {
          url: 'https://x.test/',
          finalUrl: 'https://x.test/',
          viewport: 'desktop',
          html: "<body><form action='/go'><input type='submit'></form></body>",
          styles: {},
          fullPageScreenshot: '',
          sectionScreenshots: {},
          elementScreenshots: { [sid]: 'SiteImport/j/shots/home.desktop.e' + sid + '.png' },
          assetUrls: [],
          fontFamilies: [],
          meta: { title: '', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: '' },
        },
      },
    ],
  });
  const form = ir.pages[0].sections[0].elements[0];
  assert.equal(form.class, 'form');
  assert.equal(form.sourceId, sid);
  assert.equal(form.screenshot, 'SiteImport/j/shots/home.desktop.e' + sid + '.png');
});
