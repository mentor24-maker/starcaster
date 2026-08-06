'use strict';

/**
 * Mapping engine tests (spec docs/site-import/02-mapping.md).
 *
 * Two fixture layers, per the spec's fixture-completeness requirement:
 *  1. The real delraytennis IR (wordpress.expected.json) — the reference
 *     site must map with full reconciliation.
 *  2. A deliberate completeness fixture that exercises every disposition
 *     and settings key the mapper can emit: prose merge + split, nav
 *     consumption, image/button/video mapping, every placeholder class,
 *     capped + overflow source HTML, the oversize ladder incl. the
 *     no-split-point demotion, slug normalization edges (home, nested
 *     path, admin prefix, collision), and the round-trip proof through
 *     lib/builder/document.js (requires build:builder-template — wired
 *     into npm run test:site-import).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  mapSite,
  reportReconciles,
  normalizeImportSlug,
  splitOversizeHtml,
  TEXT_MODULE_CHAR_BUDGET,
} = require('../../lib/site-import/dist/map.js');
const { serializeBuilderDocument } = require('../../lib/builder/document.js');

function el(overrides) {
  return {
    sourceId: overrides.sourceId,
    class: overrides.class,
    html: overrides.html ?? '<p>x</p>',
    textContent: overrides.textContent ?? 'x',
    textLength: (overrides.textContent ?? 'x').length,
    computedStyles: {},
    documentPosition: 0,
    depth: 1,
    assetRefs: overrides.assetRefs ?? [],
    ...(overrides.screenshot ? { screenshot: overrides.screenshot } : {}),
  };
}

/** The completeness fixture (layer 2). */
function completenessIr() {
  const bigProse = `<p>${'word '.repeat(2500)}</p>`; // ~12.5k chars, splittable
  const bigAtom = 'x'.repeat(TEXT_MODULE_CHAR_BUDGET + 200); // no whitespace
  return {
    irVersion: '1.0',
    jobId: 'job-map-fixture',
    sourceUrl: 'https://map.test/',
    capturedAt: '2026-08-06T00:00:00.000Z',
    assets: [
      {
        id: 'a1', originalUrl: 'https://map.test/hero.jpg',
        storageUrl: 'https://blob.test/SiteImport/job/assets/aa.jpg',
        contentHash: 'aa', mimeType: 'image/jpeg', byteSize: 10,
        altText: 'Hero', referencedBy: [], status: 'downloaded', error: '',
      },
      {
        id: 'a2', originalUrl: 'https://map.test/unused.pdf',
        storageUrl: '', contentHash: '', mimeType: 'application/pdf',
        byteSize: 0, altText: '', referencedBy: [], status: 'failed', error: 'x',
      },
    ],
    taxonomy: {
      navs: [{
        location: 'header',
        pageUrl: 'https://map.test/',
        items: [
          { label: 'Home', href: '/', children: [] },
          { label: 'About', href: '/about', children: [{ label: 'Team', href: '/about/team', children: [] }] },
        ],
      }],
      pageOrder: ['/', '/about/team', '/admin-office'],
    },
    rawTokens: { colors: [], fontSizes: [], fontFamilies: [], spacing: [] },
    pages: [
      {
        url: 'https://map.test/', path: '/', title: 'Map Test Home',
        metaDescription: '', ogTags: {}, canonicalUrl: '', lang: 'en',
        screenshots: { desktop: '', tablet: '', mobile: '' },
        sections: [
          {
            sourceId: '0-sec1', type: 'unknown', screenshot: '',
            elements: [
              el({ sourceId: '0-h1', class: 'heading', html: '<h1>Welcome</h1>', textContent: 'Welcome' }),
              el({ sourceId: '0-p1', class: 'text', html: '<p>Intro prose.</p>', textContent: 'Intro prose.' }),
              // Matches the header nav → navConsumed.
              el({ sourceId: '0-navlink', class: 'link', html: '<a href="/about">About</a>', textContent: 'About' }),
              // Standalone link → mapped into prose (external — must NOT localize).
              el({ sourceId: '0-freelink', class: 'link', html: '<a href="/menu.pdf">Menu</a>', textContent: 'Menu' }),
              // Link to another imported page → must localize to its slug.
              el({ sourceId: '0-intlink', class: 'link', html: '<a href="/about/team">Meet the team</a>', textContent: 'Meet the team' }),
              el({ sourceId: '0-img', class: 'image', html: '<img src="https://map.test/hero.jpg" alt="Hero">', textContent: '', assetRefs: ['a1'] }),
              el({ sourceId: '0-btn', class: 'button', html: '<a role="button" href="/join">Join Now</a>', textContent: 'Join Now' }),
              el({ sourceId: '0-vid', class: 'video', html: '<video src="https://map.test/clip.mp4"></video>', textContent: '' }),
              el({ sourceId: '0-vidx', class: 'video', html: '<video></video>', textContent: '', screenshot: 'https://blob.test/shots/vidx.png' }),
            ],
          },
          {
            sourceId: '0-sec2', type: 'unknown', screenshot: '',
            elements: [
              el({ sourceId: '0-form', class: 'form', html: '<form><input type="email"></form>', textContent: '', screenshot: 'https://blob.test/shots/form.png' }),
              el({ sourceId: '0-table', class: 'table', html: `<table>${'<tr><td>big</td></tr>'.repeat(600)}</table>`, textContent: 'big', screenshot: 'https://blob.test/shots/table.png' }),
              el({ sourceId: '0-embed', class: 'embed', html: '<iframe src="https://youtube.com/embed/x"></iframe>', textContent: '' }),
              el({ sourceId: '0-svg', class: 'other', html: '<svg><circle r="1"></circle></svg>', textContent: '', screenshot: 'https://blob.test/shots/svg.png' }),
              el({ sourceId: '0-bigp', class: 'text', html: bigProse, textContent: 'big prose' }),
              el({ sourceId: '0-atom', class: 'text', html: bigAtom, textContent: bigAtom }),
            ],
          },
        ],
      },
      {
        url: 'https://map.test/about/team', path: '/about/team', title: 'Team',
        metaDescription: '', ogTags: {}, canonicalUrl: '', lang: 'en',
        screenshots: { desktop: '', tablet: '', mobile: '' },
        sections: [{
          sourceId: '1-sec1', type: 'unknown', screenshot: '',
          elements: [el({ sourceId: '1-p', class: 'text', html: '<p>Our team.</p>', textContent: 'Our team.' })],
        }],
      },
      {
        url: 'https://map.test/admin-office', path: '/admin-office', title: 'Office',
        metaDescription: '', ogTags: {}, canonicalUrl: '', lang: 'en',
        screenshots: { desktop: '', tablet: '', mobile: '' },
        sections: [{
          sourceId: '2-sec1', type: 'unknown', screenshot: '',
          elements: [el({ sourceId: '2-p', class: 'text', html: '<p>Office hours.</p>', textContent: 'Office hours.' })],
        }],
      },
    ],
  };
}

test('slug normalizer: home, nesting, admin trap, junk', () => {
  assert.equal(normalizeImportSlug('/'), 'imported-home');
  assert.equal(normalizeImportSlug('/about/team'), 'about-team');
  assert.equal(normalizeImportSlug('/Admin-Office'), 'imported-admin-office');
  assert.equal(normalizeImportSlug('/crm'), 'imported-crm');
  assert.equal(normalizeImportSlug('/Über uns/'), 'uber-uns');
  assert.equal(normalizeImportSlug(''), 'imported-home');
});

test('oversize ladder: splits children, hard-splits text, refuses atoms', () => {
  const big = `<p>${'a '.repeat(3000)}</p><p>short</p>`;
  const pieces = splitOversizeHtml(big, 5000);
  assert.ok(pieces && pieces.length >= 2);
  assert.ok(pieces.every((p) => p.length <= 5000));

  const atomless = 'x'.repeat(6000);
  assert.equal(splitOversizeHtml(atomless, 5000), null);

  const wrapped = `<div>${'b '.repeat(4000)}</div>`;
  const inner = splitOversizeHtml(wrapped, 5000);
  assert.ok(inner && inner.every((p) => p.length <= 5000));
});

test('completeness fixture: every disposition, reconciled', () => {
  const ir = completenessIr();
  const out = mapSite(ir, { existingSlugs: ['about-team'] });
  const r = out.report.elements;

  assert.ok(reportReconciles(out.report), JSON.stringify(out.report, null, 2));
  assert.equal(r.total, 17);
  assert.equal(r.navConsumed, 1); // the About link
  // Placeholders: form, table, embed, svg, no-src video, unsplittable atom.
  assert.equal(r.placeholder, 6);
  assert.equal(r.skipped, 0);
  assert.equal(r.mapped, r.total - r.placeholder - r.navConsumed);

  // Slugs: home special-cased, collision suffixed, admin trap dodged.
  assert.deepEqual(out.pages.map((p) => p.slug),
    ['imported-home', 'about-team-imported', 'imported-admin-office']);

  const home = out.pages[0];
  const allModules = home.sections.flatMap((s) => s.modules);
  const byType = allModules.reduce((m, x) => ((m[x.type] = (m[x.type] || 0) + 1), m), {});
  assert.equal(byType.image, 1);
  assert.equal(byType.button, 1);
  assert.equal(byType.video, 1);
  assert.ok(byType.code >= 5);
  assert.ok(byType.text >= 3); // merged prose + oversize splits

  // Image took the downloaded asset URL; promotion plan covers it only.
  const img = allModules.find((m) => m.type === 'image');
  assert.equal(img.settings.url, 'https://blob.test/SiteImport/job/assets/aa.jpg');
  assert.deepEqual(out.copyPlan.assets.map((a) => a.assetId), ['a1']);
  assert.equal(out.report.assets.leftInNamespace, 1);

  // Every text module respects the budget; nothing can truncate at 10k.
  assert.ok(allModules.filter((m) => m.type === 'text')
    .every((m) => m.text.length <= TEXT_MODULE_CHAR_BUDGET));

  // Placeholder contracts: crop copy plan, source HTML inline vs overflow.
  const form = allModules.find((m) => m.settings.importSourceId === '0-form');
  assert.ok(form.text.includes('form.png'));
  assert.ok(form.settings.importSourceHtml.includes('<form>'));
  const tablePh = allModules.find((m) => m.settings.importSourceId === '0-table');
  assert.equal(tablePh.settings.importSourceHtml, undefined); // overflowed
  // Overflows: the giant table AND the unsplittable atom (its 9.7k source
  // also exceeds the inline settings budget).
  assert.deepEqual(out.copyPlan.sourceOverflows.map((o) => o.sourceId), ['0-table', '0-atom']);
  assert.ok(out.copyPlan.crops.length >= 4);

  // Section provenance markers for the runner's hash guard.
  for (const section of out.pages.flatMap((p) => p.sections)) {
    assert.ok(section.modules[0].settings.importSectionSourceId);
    assert.ok(section.sourceElementIds.length > 0);
  }

  // Nav tree flattened with parent links, ready for settings.navItems.
  assert.equal(out.navItems.length, 3);
  const team = out.navItems.find((n) => n.label === 'Team');
  assert.equal(out.navItems.find((n) => n.id === team.parentId).label, 'About');

  // Link localization: nav + in-content links to IMPORTED pages point at
  // the imported slugs; external links untouched.
  assert.equal(team.href, '/about-team-imported'); // /about/team collided → suffixed slug
  assert.equal(out.navItems.find((n) => n.label === 'Home').href, '/imported-home');
  const proseHtml = allModules.filter((m) => m.type === 'text').map((m) => m.text).join('');
  assert.ok(proseHtml.includes('href="/about-team-imported"'), 'internal link localized');
  assert.ok(proseHtml.includes('href="/menu.pdf"'), 'external link untouched');
});

test('round-trip proof: serialized documents are stable through the normalizer', () => {
  const out = mapSite(completenessIr(), { existingSlugs: [] });
  for (const page of out.pages) {
    const sections = page.sections.map(({ sourceElementIds, ...s }) => s);
    const first = serializeBuilderDocument({ layoutSections: sections });
    const second = serializeBuilderDocument({ layoutSections: first.sections });
    assert.deepEqual(second.sections, first.sections, `round-trip drift on ${page.slug}`);
    // The markers the runner depends on survive normalization.
    for (const section of first.sections) {
      assert.ok(section.modules[0].settings.importSectionSourceId, `marker lost on ${page.slug}`);
    }
  }
});

test('delraytennis IR maps with full reconciliation', () => {
  const { ir } = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'wordpress.expected.json'), 'utf8'
  ));
  const out = mapSite(ir, { existingSlugs: [] });
  assert.ok(reportReconciles(out.report), JSON.stringify(out.report.elements));
  assert.equal(out.report.elements.skipped, 0);
  assert.equal(out.pages.length, 2);
  assert.equal(out.pages[0].slug, 'imported-home');
  assert.ok(out.navItems.length > 0);
  // The site's 16 tables all become crop-carrying placeholders.
  const placeholders = out.pages.flatMap((p) => p.sections)
    .flatMap((s) => s.modules).filter((m) => m.type === 'code');
  assert.ok(placeholders.length >= 16);
  assert.ok(placeholders.every((m) => m.settings.importSourceId));
});
