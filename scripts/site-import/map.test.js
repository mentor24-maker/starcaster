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
              // Same photo the slideshow carries → must dedupe away.
              el({ sourceId: '0-img', class: 'image', html: '<img src="https://map.test/hero.jpg" alt="Hero">', textContent: '', assetRefs: ['a1'] }),
              // A photo the slideshow does NOT carry → stays an image module.
              el({ sourceId: '0-imgsolo', class: 'image', html: '<img src="https://map.test/solo.jpg" alt="Solo">', textContent: '' }),
              el({ sourceId: '0-btn', class: 'button', html: '<a role="button" href="/join">Join Now</a>', textContent: 'Join Now' }),
              el({ sourceId: '0-vid', class: 'video', html: '<video src="https://map.test/clip.mp4"></video>', textContent: '' }),
              el({ sourceId: '0-vidx', class: 'video', html: '<video></video>', textContent: '', screenshot: 'https://blob.test/shots/vidx.png' }),
            ],
          },
          {
            sourceId: '0-secshow', type: 'unknown', screenshot: '',
            elements: [
              el({ sourceId: '0-sh1', class: 'image', html: '<img src="https://map.test/hero.jpg" alt="Hero">', textContent: '', assetRefs: ['a1'] }),
              el({ sourceId: '0-sh2', class: 'image', html: '<img src="https://map.test/s2.jpg" alt="S2">', textContent: '' }),
              el({ sourceId: '0-sh3', class: 'image', html: '<img src="https://map.test/s3.jpg" alt="S3">', textContent: '' }),
              el({ sourceId: '0-sh4', class: 'image', html: '<img src="https://map.test/s4.jpg" alt="S4">', textContent: '' }),
              // Clone of slide 1 — the looping-slider signal.
              el({ sourceId: '0-sh5', class: 'image', html: '<img src="https://map.test/hero.jpg" alt="Hero">', textContent: '', assetRefs: ['a1'] }),
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
          elements: [
            el({ sourceId: '1-p', class: 'text', html: '<p>Our team.</p>', textContent: 'Our team.' }),
            // Same run, no clones — qualifies via the cross-page fingerprint
            // (2 of 3 pages >= 60%) and lands in the deduped bucket.
            el({ sourceId: '1-sh1', class: 'image', html: '<img src="https://map.test/hero.jpg" alt="Hero">', textContent: '', assetRefs: ['a1'] }),
            el({ sourceId: '1-sh2', class: 'image', html: '<img src="https://map.test/s2.jpg" alt="S2">', textContent: '' }),
            el({ sourceId: '1-sh3', class: 'image', html: '<img src="https://map.test/s3.jpg" alt="S3">', textContent: '' }),
            el({ sourceId: '1-sh4', class: 'image', html: '<img src="https://map.test/s4.jpg" alt="S4">', textContent: '' }),
          ],
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
  assert.equal(r.total, 27);
  // Slideshow accounting: home run = 1 lead + 3 members mapped, 1 clone
  // deduped; team-page fingerprint run = 4 deduped.
  // clone in the home run (1) + team-page fingerprint run (4) + the
  // standalone hero image the slideshow already shows (1).
  assert.equal(r.deduped, 6);
  assert.equal(r.navConsumed, 1); // the About link
  // Placeholders: form, table, embed, svg, no-src video, unsplittable atom.
  assert.equal(r.placeholder, 6);
  assert.equal(r.skipped, 0);
  assert.equal(r.mapped, r.total - r.placeholder - r.navConsumed - r.deduped);

  // Slugs: home special-cased, collision suffixed, admin trap dodged.
  assert.deepEqual(out.pages.map((p) => p.slug),
    ['imported-home', 'about-team-imported', 'imported-admin-office']);

  const home = out.pages[0];
  const allModules = home.sections.flatMap((s) => s.modules);
  const byType = allModules.reduce((m, x) => ((m[x.type] = (m[x.type] || 0) + 1), m), {});
  assert.equal(byType.image, 1);
  assert.equal(byType.slideshow, 1);
  const show = allModules.find((m) => m.type === 'slideshow');
  const slides = JSON.parse(show.settings.slides);
  assert.equal(slides.length, 4);
  assert.equal(slides[0].url, 'https://blob.test/SiteImport/job/assets/aa.jpg'); // promoted asset URL
  assert.ok(show.settings.importSourceIds.split(',').length === 5); // whole run tracked
  // Interior page gets NO slideshow (ratified homepage-only amendment).
  const teamModules = out.pages[1].sections.flatMap((s) => s.modules);
  assert.ok(!teamModules.some((m) => m.type === 'slideshow'));
  assert.equal(byType.button, 1);
  assert.equal(byType.video, 1);
  assert.ok(byType.code >= 5);
  assert.ok(byType.text >= 3); // merged prose + oversize splits

  // Image took the downloaded asset URL; promotion plan covers it only.
  const img = allModules.find((m) => m.type === 'image');
  assert.equal(img.settings.url, 'https://map.test/solo.jpg');
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

test('layout tables become images; real tables stay placeholders', () => {
  const base = completenessIr();
  base.pages[0].sections[2].elements.push(
    // A photo wrapped in a table with a lightbox link — the delraytennis
    // pattern, 13 of its 16 "tables".
    el({ sourceId: '0-tblimg', class: 'table',
      html: '<table><tbody><tr><td><a href="https://map.test/full.jpg"><img src="https://map.test/hero.jpg" alt="Team"></a></td></tr></tbody></table>',
      textContent: '', assetRefs: ['a1'], screenshot: 'https://blob.test/shots/tblimg.png' }),
    // A table with actual copy stays a placeholder — it may be real data.
    el({ sourceId: '0-tbldata', class: 'table',
      html: '<table><tr><td>Monday</td><td>9am</td></tr></table>',
      textContent: 'Monday 9am', screenshot: 'https://blob.test/shots/tbldata.png' }),
  );
  const out = mapSite(base, { existingSlugs: [] });
  const mods = out.pages[0].sections.flatMap((s) => s.modules);

  const recovered = mods.find((m) => m.settings.importFromLayoutTable === 'true');
  assert.ok(recovered, 'the image inside the layout table became an image module');
  assert.equal(recovered.type, 'image');
  assert.equal(recovered.settings.url, 'https://blob.test/SiteImport/job/assets/aa.jpg', 'promoted asset URL');
  assert.equal(recovered.settings.alt, 'Team');
  assert.equal(recovered.settings.linkUrl, 'https://map.test/full.jpg');

  const stillPlaceholder = mods.find((m) => m.settings.importSourceId === '0-tbldata');
  assert.equal(stillPlaceholder.type, 'code', 'a table with copy is not assumed to be a photo');
  assert.ok(out.report.placeholderPatterns.some((p) => /table/.test(p.signature)));
});

test('same-site links stay on the imported site; external links do not move', () => {
  const base = completenessIr();
  base.pages[0].sections[0].elements.push(
    el({ sourceId: '0-uncaptured', class: 'link',
      html: '<a href="https://map.test/course/fees/">Court Fees</a>', textContent: 'Court Fees' }),
    el({ sourceId: '0-external', class: 'link',
      html: '<a href="https://facebook.com/someclub">Facebook</a>', textContent: 'Facebook' }),
    el({ sourceId: '0-pdf', class: 'link',
      html: '<a href="https://map.test/files/menu.pdf">Menu PDF</a>', textContent: 'Menu PDF' }),
  );
  const out = mapSite(base, { existingSlugs: [] });
  const html = out.pages[0].sections.flatMap((s) => s.modules)
    .filter((m) => m.type === 'text').map((m) => m.text).join('');
  // Page on the same site that was never captured → relative, not the live site.
  assert.ok(html.includes('href="/course-fees"'), 'uncaptured same-site page link went relative');
  assert.ok(!html.includes('map.test/course/fees'), 'no link back to the source site');
  // External and asset links are left exactly as they were.
  assert.ok(html.includes('href="https://facebook.com/someclub"'));
  assert.ok(html.includes('href="https://map.test/files/menu.pdf"'));
});

test('slideshow veto: --no-slideshow keeps image runs as plain images', () => {
  const ir = completenessIr();

  // Whole-run veto: no slideshow module anywhere, images survive, and the
  // dedupe passes stand down too (they exist to serve the slideshow).
  const off = mapSite(ir, { existingSlugs: [], skipAllSlideshows: true });
  const offModules = off.pages.flatMap((p) => p.sections).flatMap((s) => s.modules);
  assert.equal(offModules.filter((m) => m.type === 'slideshow').length, 0);
  assert.equal(off.slideshows.length, 0);
  assert.equal(off.report.elements.deduped, 0, 'nothing deduped when nothing consolidated');
  assert.ok(offModules.filter((m) => m.type === 'image').length >= 6, 'every image kept');
  assert.ok(reportReconciles(off.report), JSON.stringify(off.report.elements));

  // Per-page veto: home stays images, and the plan list is empty because
  // home is the only page that would have produced one.
  const homeOff = mapSite(ir, { existingSlugs: [], skipSlideshowPaths: ['/'] });
  const homeModules = homeOff.pages[0].sections.flatMap((s) => s.modules);
  assert.equal(homeModules.filter((m) => m.type === 'slideshow').length, 0);
  assert.equal(homeOff.slideshows.length, 0);
  assert.ok(reportReconciles(homeOff.report));

  // Default (no veto) still consolidates AND reports the plan for the dry
  // run to show before anything is written.
  const on = mapSite(ir, { existingSlugs: [] });
  assert.equal(on.slideshows.length, 1);
  assert.equal(on.slideshows[0].pagePath, '/');
  assert.equal(on.slideshows[0].slideCount, 4);
  assert.ok(on.slideshows[0].absorbedIds.length >= 5);
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
  // The homepage slider (15 unique images cloned to 30) becomes ONE
  // slideshow module; clones land in deduped. (This 2-page fixture keeps
  // the interior page's run as images: no clones there, and the cross-page
  // fingerprint needs >=3 pages.)
  const shows = out.pages.flatMap((p) => p.sections).flatMap((s) => s.modules).filter((m) => m.type === 'slideshow');
  assert.equal(shows.length, 1);
  // 13 unique slides (the 14-image run holds one clone); the page's other
  // image run - 15 copies of one lazy-load placeholder - correctly does
  // NOT become a slideshow (min 3 unique slides).
  assert.equal(JSON.parse(shows[0].settings.slides).length, 13);
  // 1 clone inside the hero run + 14 for the interior page's own run +
  // the 15-copy lazy-load run of a photo the slideshow already shows
  // (operator-reported: slideshow followed by 15 identical pictures).
  assert.equal(out.report.elements.deduped, 30);
  const slideUrls = new Set(JSON.parse(shows[0].settings.slides).map((s) => s.url));
  const redundant = out.pages[0].sections
    .flatMap((s) => s.modules)
    .filter((m) => m.type === 'image' && slideUrls.has(m.settings.url));
  assert.equal(redundant.length, 0, 'no image module repeats a photo the slideshow already shows');

  // 13 of the site's 16 "tables" are layout tables wrapping a photo — they
  // become real image modules now; only genuine tables stay placeholders.
  const allModules = out.pages.flatMap((p) => p.sections).flatMap((s) => s.modules);
  const fromTables = allModules.filter((m) => m.settings.importFromLayoutTable === 'true');
  assert.ok(fromTables.length >= 20, `expected images recovered from layout tables, got ${fromTables.length}`);
  const placeholders = allModules.filter((m) => m.type === 'code');
  assert.ok(placeholders.length <= 4, `only real tables should remain, got ${placeholders.length}`);
  assert.ok(placeholders.every((m) => m.settings.importSourceId));
  // The report names what it could not map, so the next rule is obvious.
  assert.ok(out.report.placeholderPatterns.length > 0);
  assert.ok(out.report.placeholderPatterns.every((x) => x.signature && x.count > 0));
});
