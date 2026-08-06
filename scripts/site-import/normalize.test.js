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

test('wordpress fixture (real delraytennis.com capture): structural spot-checks', () => {
  // This fixture is a REAL capture (capture_fixture.mjs) of the launch
  // client's site — assertions pin what the committed file contains, not
  // what the live site currently serves.
  const { ir, coverage } = normalizeSite(loadJson('wordpress.json'));

  assert.equal(ir.irVersion, '1.0');
  assert.equal(ir.pages.length, 2);
  const home = ir.pages[0];
  assert.equal(home.path, '/');
  assert.ok(home.title.includes('Delray Beach Tennis'));
  assert.equal(home.lang, 'en-US');
  assert.equal(home.canonicalUrl, 'https://www.delraytennis.com/');

  const elements = home.sections.flatMap((s) => s.elements);
  assert.ok(elements.length > 100, `home should be content-rich, got ${elements.length}`);
  assert.equal(home.sections.every((s) => s.type === 'unknown'), true);

  // The site's schedule/pricing tables are sanitizer-stripped atoms, so
  // each must carry its screenshot crop, joined by sourceId.
  const tables = elements.filter((e) => e.class === 'table');
  assert.ok(tables.length >= 10, `expected the table-heavy home page, got ${tables.length}`);
  assert.ok(
    tables.every((t) => t.screenshot && t.screenshot.startsWith('fixture://')),
    'every table crop joined via computeSourceId across serialize/re-parse'
  );

  // Real images matched to the asset manifest, back-references written.
  const img = elements.find((e) => e.class === 'image' && e.assetRefs.length);
  assert.ok(img, 'at least one image resolved to an asset');
  const asset = ir.assets.find((a) => a.id === img.assetRefs[0]);
  assert.ok(asset.referencedBy.some((r) => r.sourceId === img.sourceId));

  // Computed styles rode along from the real browser.
  const styled = elements.find((e) => e.computedStyles['font-family']);
  assert.ok(styled, 'computed styles joined via data-scim');
  assert.ok(!elements.some((e) => e.html.includes('data-scim')), 'markers stripped');

  // Raw design tokens extracted from the live styles.
  assert.ok(ir.rawTokens.colors.length > 5);
  assert.ok(ir.rawTokens.fontFamilies.some((f) => /verdana/i.test(f.value)));

  // Nothing dropped on a real site, and both counters agree.
  assert.deepEqual(coverage.dropped, {});
  assert.deepEqual(coverage.captured, coverage.emitted);
  assert.equal(coverage.pages.captured, 2);
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
