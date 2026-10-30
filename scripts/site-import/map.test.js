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
  writeMappedPages,
  summarizePageWrites,
  pathOfWriteKey,
  TEXT_MODULE_CHAR_BUDGET,
  buildMenuSection,
  planMenuTarget,
  attachMenuInstances,
  menuSiteLabel,
  topMenuLogoWidthPx,
  planUnplacedAssets,
  sizeVariantFamily,
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
  assert.equal(normalizeImportSlug('/'), 'home');
  assert.equal(normalizeImportSlug('/about/team'), 'about-team');
  assert.equal(normalizeImportSlug('/Admin-Office'), 'imported-admin-office');
  assert.equal(normalizeImportSlug('/crm'), 'imported-crm');
  assert.equal(normalizeImportSlug('/Über uns/'), 'uber-uns');
  assert.equal(normalizeImportSlug(''), 'home');
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
    ['home', 'about-team-imported', 'imported-admin-office']);

  const home = out.pages[0];
  const allModules = home.sections.flatMap((s) => s.modules);
  const byType = allModules.reduce((m, x) => ((m[x.type] = (m[x.type] || 0) + 1), m), {});
  assert.equal(byType.image, 1);
  // `carousel` in its slideshow format — `slideshow` was its own module type
  // until the 2026-08-16 merge, and the importer writes the new shape
  // directly rather than leaning on the normalizer's migration.
  assert.equal(byType.carousel, 1);
  const show = allModules.find((m) => m.type === 'carousel');
  assert.equal(show.settings.format, 'slideshow');
  const slides = JSON.parse(show.settings.items);
  assert.equal(slides.length, 4);
  assert.equal(slides[0].imageUrl, 'https://blob.test/SiteImport/job/assets/aa.jpg'); // promoted asset URL
  assert.ok(show.settings.importSourceIds.split(',').length === 5); // whole run tracked
  // Interior page gets NO slideshow (ratified homepage-only amendment).
  const teamModules = out.pages[1].sections.flatMap((s) => s.modules);
  assert.ok(!teamModules.some((m) => m.type === 'carousel'));
  assert.equal(byType.button, 1);
  assert.equal(byType.video, 1);
  assert.ok(byType.code >= 5);
  assert.ok(byType.text >= 3); // merged prose + oversize splits

  // Image took the downloaded asset URL; promotion plan covers it only.
  const img = allModules.find((m) => m.type === 'image');
  assert.equal(img.settings.url, 'https://map.test/solo.jpg');
  assert.deepEqual(out.copyPlan.assets.map((a) => a.assetId), ['a1']);
  // a2 failed to download, so it is owed no Assets row either.
  assert.deepEqual(out.copyPlan.unplaced, []);
  assert.equal(out.report.assets.unplaced, 0);
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
  // The site root is served at "/", never at the home page's slug.
  assert.equal(out.navItems.find((n) => n.label === 'Home').href, '/');
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
  assert.equal(offModules.filter((m) => m.type === 'carousel').length, 0);
  assert.equal(off.slideshows.length, 0);
  assert.equal(off.report.elements.deduped, 0, 'nothing deduped when nothing consolidated');
  assert.ok(offModules.filter((m) => m.type === 'image').length >= 6, 'every image kept');
  assert.ok(reportReconciles(off.report), JSON.stringify(off.report.elements));

  // Per-page veto: home stays images, and the plan list is empty because
  // home is the only page that would have produced one.
  const homeOff = mapSite(ir, { existingSlugs: [], skipSlideshowPaths: ['/'] });
  const homeModules = homeOff.pages[0].sections.flatMap((s) => s.modules);
  assert.equal(homeModules.filter((m) => m.type === 'carousel').length, 0);
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
  assert.equal(out.pages[0].slug, 'home');
  assert.ok(out.navItems.length > 0);
  // The homepage slider (15 unique images cloned to 30) becomes ONE
  // slideshow module; clones land in deduped. (This 2-page fixture keeps
  // the interior page's run as images: no clones there, and the cross-page
  // fingerprint needs >=3 pages.)
  const shows = out.pages.flatMap((p) => p.sections).flatMap((s) => s.modules).filter((m) => m.type === 'carousel');
  assert.equal(shows.length, 1);
  // 13 unique slides (the 14-image run holds one clone); the page's other
  // image run - 15 copies of one lazy-load placeholder - correctly does
  // NOT become a slideshow (min 3 unique slides).
  assert.equal(JSON.parse(shows[0].settings.items).length, 13);
  // 1 clone inside the hero run + 14 for the interior page's own run +
  // the 15-copy lazy-load run of a photo the slideshow already shows
  // (operator-reported: slideshow followed by 15 identical pictures).
  assert.equal(out.report.elements.deduped, 30);
  const slideUrls = new Set(JSON.parse(shows[0].settings.items).map((s) => s.imageUrl));
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

/* ---------------------------------------------------------------------------
 * Card-grid detection (2026-08-08)
 *
 * The Feature Cards module existed for a while before the importer could
 * emit it, so every imported site needed its card rows rebuilt by hand
 * (MODULE_STANDARDS rule 12). These tests pin BOTH directions: the grid that
 * must be found, and the shapes that must NOT be mistaken for one.
 * ------------------------------------------------------------------------ */

const { pickCardColumns } = require('../../lib/site-import/dist/map.js');

/** One card's worth of elements: icon glyph, image, heading, body, link. */
function cardGroup(n, opts = {}) {
  const els = [];
  if (opts.icon !== false) els.push(el({ sourceId: `c${n}-icon`, class: 'text', html: '<span>*</span>', textContent: '*' }));
  if (opts.image !== false) {
    els.push(el({
      sourceId: `c${n}-img`, class: 'image',
      html: `<img src="https://cards.test/${n}.jpg" alt="Card ${n} &amp; more">`,
      textContent: '', assetRefs: [],
    }));
  }
  els.push(el({ sourceId: `c${n}-h`, class: 'heading', html: `<h3>Card ${n}</h3>`, textContent: `Card ${n}` }));
  els.push(el({ sourceId: `c${n}-p`, class: 'text', html: `<p>Body ${n}</p>`, textContent: `Body ${n}` }));
  if (opts.link !== false) els.push(el({ sourceId: `c${n}-a`, class: 'link', html: '<a href="/more">Learn More</a>', textContent: 'Learn More' }));
  return els;
}

function irWithElements(elements) {
  return {
    irVersion: '1.0', jobId: 'job-cards', sourceUrl: 'https://cards.test/',
    capturedAt: '2026-08-08T00:00:00.000Z', assets: [], taxonomy: { navs: [] },
    pages: [{
      url: 'https://cards.test/', path: '/', title: 'Cards', metaDescription: '',
      ogTags: {}, canonicalUrl: '', lang: 'en',
      screenshots: { desktop: '', tablet: '', mobile: '' },
      sections: [{ sourceId: 's0', type: 'unknown', screenshot: '', elements }],
    }],
  };
}

const featureCardsOf = (out) =>
  out.pages.flatMap((p) => p.sections).flatMap((s) => s.modules).filter((m) => m.type === 'feature-cards');

test('card grid: a repeating icon/image/heading/text/link run becomes ONE feature-cards module', () => {
  const els = [...cardGroup(1), ...cardGroup(2), ...cardGroup(3)];
  const out = mapSite(irWithElements(els), { existingSlugs: [] });

  const mods = featureCardsOf(out);
  assert.equal(mods.length, 1, 'exactly one module for the whole grid');

  const cards = JSON.parse(mods[0].settings.cards);
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => c.title), ['Card 1', 'Card 2', 'Card 3']);
  assert.deepEqual(cards.map((c) => c.body), ['Body 1', 'Body 2', 'Body 3']);
  assert.equal(cards[0].icon, '*', 'a single-glyph text node is the icon, not the body');
  assert.equal(cards[0].linkUrl, '/more');
  assert.equal(cards[0].linkLabel, 'Learn More');

  // Attribute values arrive entity-encoded; alt text must be DECODED or the
  // page renders the literal string "Card 1 &amp; more".
  assert.equal(cards[0].imageAlt, 'Card 1 & more');

  // Every absorbed element is accounted for, and the run is traceable back
  // to the source elements it replaced.
  assert.equal(mods[0].settings.importSourceIds.split(',').length, els.length);
  assert.ok(reportReconciles(out.report), 'coverage must reconcile');
  assert.equal(out.report.elements.total, els.length);
  assert.equal(out.report.elements.mapped, els.length);
});

test('card grid: the dry-run plan reports what it inferred, before anything is written', () => {
  const out = mapSite(irWithElements([...cardGroup(1), ...cardGroup(2), ...cardGroup(3)]), { existingSlugs: [] });
  assert.equal(out.cardGrids.length, 1);
  assert.equal(out.cardGrids[0].cardCount, 3);
  assert.equal(out.cardGrids[0].signature, 'text+image+heading+text+link');
  assert.deepEqual(out.cardGrids[0].titles, ['Card 1', 'Card 2', 'Card 3']);
  assert.equal(out.cardGrids[0].pagePath, '/');
});

test('card grid: a nav/mega-menu run is NOT mistaken for cards', () => {
  // The exact false positive an earlier, looser rule produced against the
  // real blazefish.com capture: link+link+link+heading+link, repeated per
  // menu column. Turning a site's navigation into feature cards is far worse
  // than declining to detect a grid, so a group with no image never counts.
  const col = (n) => [
    el({ sourceId: `n${n}-1`, class: 'link', html: '<a href="/a">A</a>', textContent: 'A' }),
    el({ sourceId: `n${n}-2`, class: 'link', html: '<a href="/b">B</a>', textContent: 'B' }),
    el({ sourceId: `n${n}-3`, class: 'link', html: '<a href="/c">C</a>', textContent: 'C' }),
    el({ sourceId: `n${n}-h`, class: 'heading', html: `<h4>Menu ${n}</h4>`, textContent: `Menu ${n}` }),
    el({ sourceId: `n${n}-4`, class: 'link', html: '<a href="/d">D</a>', textContent: 'D' }),
  ];
  const out = mapSite(irWithElements([...col(1), ...col(2), ...col(3), ...col(4)]), { existingSlugs: [] });
  assert.equal(featureCardsOf(out).length, 0);
  assert.equal(out.cardGrids.length, 0);
  assert.ok(reportReconciles(out.report));
});

test('card grid: two repetitions are not enough, and a headless run is not a grid', () => {
  const twoOnly = mapSite(irWithElements([...cardGroup(1), ...cardGroup(2)]), { existingSlugs: [] });
  assert.equal(twoOnly.cardGrids.length, 0, 'a pair is ambiguous — needs 3+ repetitions');

  const noHeading = [1, 2, 3].flatMap((n) => [
    el({ sourceId: `x${n}-img`, class: 'image', html: `<img src="/${n}.jpg" alt="">`, textContent: '' }),
    el({ sourceId: `x${n}-p`, class: 'text', html: `<p>Body ${n}</p>`, textContent: `Body ${n}` }),
  ]);
  const out = mapSite(irWithElements(noHeading), { existingSlugs: [] });
  assert.equal(out.cardGrids.length, 0, 'no heading means no card title — not a card grid');
  assert.ok(reportReconciles(out.report));
});

test('card grid: column count divides evenly so the last row is full', () => {
  assert.equal(pickCardColumns(6), 3, '6 cards read as 3+3, never 4+2');
  assert.equal(pickCardColumns(4), 4);
  assert.equal(pickCardColumns(8), 4);
  assert.equal(pickCardColumns(9), 3);
  assert.equal(pickCardColumns(2), 2);
  assert.equal(pickCardColumns(5), 3, 'primes fall back to the module default');
  assert.equal(pickCardColumns(7), 3);
});

test('card grid: the real blazefish.com capture yields the six-tile grid', () => {
  // Layer-1 fixture (a real site), matching this suite's two-layer rule.
  const { normalizeSite } = require('../../lib/site-import/dist/normalize.js');
  const capture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'blazefishcards.json'), 'utf8')
  );
  const out = mapSite(normalizeSite(capture).ir, { existingSlugs: [] });

  assert.equal(out.cardGrids.length, 1, 'exactly one grid on the page — not the mega-menu too');
  const cards = JSON.parse(featureCardsOf(out)[0].settings.cards);
  assert.deepEqual(cards.map((c) => c.title), [
    'Court Fees', 'Tennis Clinics', 'Pickleball',
    'Ladies Teams & Leagues', 'Junior Tennis Programs', 'Directions & Hours',
  ]);
  assert.equal(cards[3].imageAlt, 'Ladies Teams & Leagues', 'entity-decoded alt');
  assert.ok(cards.every((c) => c.imageUrl && c.body && c.icon), 'every card is fully populated');
  assert.ok(reportReconciles(out.report), 'coverage reconciles on a real site');
});

test('card grid: --no-cards veto is honoured, and the blocks stay separate modules', () => {
  const els = [...cardGroup(1), ...cardGroup(2), ...cardGroup(3)];

  const vetoAll = mapSite(irWithElements(els), { existingSlugs: [], skipAllCardGrids: true });
  assert.equal(vetoAll.cardGrids.length, 0);
  assert.equal(featureCardsOf(vetoAll).length, 0);
  assert.ok(reportReconciles(vetoAll.report), 'a veto must not lose content');
  // The images must come back as real image modules, not vanish.
  const imgs = vetoAll.pages.flatMap((p) => p.sections).flatMap((s) => s.modules).filter((m) => m.type === 'image');
  assert.equal(imgs.length, 3, 'vetoed cards fall back to ordinary modules');

  const vetoPath = mapSite(irWithElements(els), { existingSlugs: [], skipCardGridPaths: ['/'] });
  assert.equal(vetoPath.cardGrids.length, 0, 'per-path veto matches the home path');

  const vetoElsewhere = mapSite(irWithElements(els), { existingSlugs: [], skipCardGridPaths: ['/other/'] });
  assert.equal(vetoElsewhere.cardGrids.length, 1, 'a veto on another path leaves this one alone');
});

test('a placeholder carries its rebuild caption as a setting, never as page text', () => {
  // The caption ("Imported form — rebuild with a real module.") is a note for
  // whoever rebuilds the page. Written into `text`, it was page content and
  // shipped to visitors on 24 live pages (task 86bcgdm83); as a setting, the
  // code module renders it through BuilderOnlyNote, inside the Builder only.
  const out = mapSite(completenessIr(), { existingSlugs: ['about-team'] });
  const placeholders = out.pages
    .flatMap((p) => p.sections.flatMap((s) => s.modules))
    .filter((m) => m.type === 'code' && m.settings.importClass);
  assert.equal(placeholders.length, 6);
  for (const m of placeholders) {
    assert.doesNotMatch(m.text, /rebuild/i, `${m.id} stored text still carries the caption`);
    assert.match(m.settings.importPlaceholder, /rebuild/i, `${m.id} lost its caption`);
  }
  // Both caption shapes: the default and the too-large-to-split reason.
  assert.ok(placeholders.some((m) => /real module/.test(m.settings.importPlaceholder)));
  assert.ok(placeholders.some((m) => /too large to split/.test(m.settings.importPlaceholder)));
});

// --- Two captures of the same path (task 86bch6ger) ----------------------
// Strands Movie, 2026-10-12: three captures of "/" were keyed by source path
// in the write loop, so captures 2 and 3 found capture 1's page and were
// appended onto it — one Home page with 15 sections, 41 pages for a report
// of 43, and nothing said so.

function homeCapture(url, sectionId, text) {
  return {
    url, path: '/', title: 'Home', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: 'en',
    screenshots: { desktop: '', tablet: '', mobile: '' },
    sections: [{
      sourceId: sectionId, type: 'unknown', screenshot: '',
      elements: [el({ sourceId: `${sectionId}-p`, class: 'text', html: `<p>${text}</p>`, textContent: text })],
    }],
  };
}

function irWithPages(pages) {
  return {
    irVersion: '1.0', jobId: 'job-repeat', sourceUrl: 'https://repeat.test/',
    capturedAt: '2026-10-12T00:00:00.000Z', assets: [], taxonomy: { navs: [] }, pages,
  };
}

/** An in-memory page store — enough of one to run the real write loop. */
function memoryStore(seed = []) {
  const pages = new Map(seed.map((p) => [String(p.id), { ...p }]));
  let nextId = 1000;
  return {
    pages,
    io(priorPageIds) {
      return {
        priorPageIds,
        prepareSections: (page) => page.sections.map(({ sourceElementIds, dispositions, ...section }) => section),
        getPage: async (id) => pages.get(String(id)) || null,
        createPage: async (page, sections) => {
          const row = { id: nextId++, slug: page.slug, layoutSections: sections };
          pages.set(String(row.id), row);
          return row;
        },
        updatePage: async (page, current, merged) => {
          const row = { ...current, layoutSections: merged };
          pages.set(String(row.id), row);
          return row;
        },
        // Appends, like mergeMappedSections does for sections it has not seen.
        mergeSections: (existing, incoming) => [
          ...existing.filter((s) => !incoming.some((n) => n.id === s.id)),
          ...incoming,
        ],
      };
    },
  };
}

test('two captures of the same path with different content become two Builder pages, never one', async () => {
  const out = mapSite(irWithPages([
    homeCapture('https://repeat.test/', 'h0', 'Welcome home.'),
    homeCapture('https://repeat.test/?ref=menu', 'h1', 'Welcome home, with a banner this time.'),
  ]), { existingSlugs: [] });

  assert.equal(out.pages.length, 2);
  assert.deepEqual(out.pages.map((p) => p.key), ['/', '/#2']);
  assert.notEqual(out.pages[0].slug, out.pages[1].slug);
  assert.deepEqual(out.report.pages.map((p) => p.key), ['/', '/#2']);
  assert.equal(pathOfWriteKey('/#2'), '/');
  assert.equal(pathOfWriteKey('/about'), '/about');

  const store = memoryStore();
  const { pageIds, writes } = await writeMappedPages(out.pages, store.io({}));
  assert.equal(new Set(writes.map((w) => w.pageId)).size, 2, 'each capture landed on its own page');
  assert.deepEqual(writes.map((w) => w.action), ['created', 'created']);
  for (const row of store.pages.values()) assert.equal(row.layoutSections.length, 1, `page ${row.id} holds one capture, not several`);
  assert.deepEqual(summarizePageWrites(out.pages.length, writes).problems, []);

  // A re-run updates the same two pages rather than creating more.
  const again = await writeMappedPages(out.pages, store.io(pageIds));
  assert.deepEqual(again.writes.map((w) => w.action), ['updated', 'updated']);
  assert.deepEqual(again.pageIds, pageIds);
  assert.equal(store.pages.size, 2);
});

test('two captures of the same path with the same content: one page, and the repeat is reported', async () => {
  const out = mapSite(irWithPages([
    homeCapture('https://repeat.test/', 'h0', 'Welcome home.'),
    homeCapture('https://repeat.test/index.php', 'h40', 'Welcome home.'),
    homeCapture('https://repeat.test/?p=1', 'h42', 'Welcome home.'),
  ]), { existingSlugs: [] });

  assert.equal(out.pages.length, 1);
  assert.equal(out.report.repeatCaptures.length, 2);
  assert.deepEqual(out.report.repeatCaptures.map((r) => r.url), ['https://repeat.test/index.php', 'https://repeat.test/?p=1']);
  assert.equal(out.report.elements.total, 3, 'the skipped captures are still accounted for');
  assert.equal(out.report.elements.deduped, 2);
  assert.ok(reportReconciles(out.report));
});

test('a pre-86bch6ger checkpoint keyed by path still finds its page on a re-run', async () => {
  const out = mapSite(irWithPages([homeCapture('https://repeat.test/', 'h0', 'Welcome home.')]), { existingSlugs: [] });
  const store = memoryStore([{ id: 77, slug: 'home', layoutSections: [] }]);
  const { writes } = await writeMappedPages(out.pages, store.io({ '/': '77' }));
  assert.deepEqual(writes, [{ key: '/', slug: out.pages[0].slug, pageId: '77', action: 'updated' }]);
});

test('apply summary: two mapped pages written onto one page is an error, not a success', () => {
  const summary = summarizePageWrites(3, [
    { key: '/', slug: 'home', pageId: '1497', action: 'created' },
    { key: '/#2', slug: 'home-imported', pageId: '1497', action: 'updated' },
    { key: '/about', slug: 'about', pageId: '1500', action: 'created' },
  ]);
  assert.equal(summary.created, 2);
  assert.equal(summary.updated, 1);
  assert.equal(summary.distinctPages, 2);
  assert.equal(summary.problems.length, 2);
  assert.match(summary.problems[0], /page 1497 was written 2 times: \/home, \/home-imported/);
  assert.match(summary.problems[1], /report lists 3 page\(s\) but 2 distinct/);
});

// Task 86bchydp2, round 2: footer trees built from plain link lists
// (source "footer-links") are recorded for slice 2 but must not change what
// the mapping step does today. Before that slice, those links were page
// content — reading them as a menu dropped them from the page (navConsumed)
// and, on a site with no header <nav>, made them the top menu.
const { normalizeSite } = require('../../lib/site-import/dist/normalize.js');

function strandsWith(edit) {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'strands.json'), 'utf8')
  );
  for (const page of raw.pages) page.desktop.html = edit(page.desktop.html);
  return raw;
}

const SOCIAL_LIST = /<ul class="et-social-icons">[\s\S]*?<\/ul>/;
const TEXT_LINKS =
  '<ul class="footer-links"><li><a href="/privacy">Privacy Policy</a></li>' +
  '<li><a href="/contact">Contact us</a></li></ul>';

test('footer link lists outside a <nav> stay on the page and out of navConsumed', () => {
  const { ir } = normalizeSite(strandsWith((html) => html.replace(SOCIAL_LIST, TEXT_LINKS)));
  const marked = ir.taxonomy.navs.filter((n) => n.source === 'footer-links');
  assert.equal(marked.length, 1, 'fixture must produce a footer-links tree, or this test proves nothing');
  assert.deepEqual(marked[0].items.map((i) => i.label), ['Privacy Policy', 'Contact us']);

  const without = { ...ir, taxonomy: { ...ir.taxonomy, navs: ir.taxonomy.navs.filter((n) => n.source !== 'footer-links') } };
  // Menus off (--no-menus / --nav): the tree changes nothing at all.
  const withTree = mapSite(ir, { existingSlugs: [], menus: false });
  const baseline = mapSite(without, { existingSlugs: [], menus: false });
  assert.equal(withTree.report.elements.mapped, baseline.report.elements.mapped);
  assert.equal(withTree.report.elements.navConsumed, baseline.report.elements.navConsumed);
  assert.deepEqual(withTree.navItems, baseline.navItems);

  // Menus on (task 86bchydp6): the links still stay on the page — only the
  // credits paragraph goes, and it is accounted for with a reason.
  const withMenus = mapSite(ir, { existingSlugs: [] });
  assert.equal(withMenus.report.elements.navConsumed, baseline.report.elements.navConsumed);
  assert.equal(withMenus.report.elements.mapped, baseline.report.elements.mapped - 1);
  assert.equal(withMenus.report.skipped.length, 1);
  assert.match(withMenus.report.skipped[0].reason, /theme\/platform credit .*Elegant Themes/);
  assert.ok(reportReconciles(withMenus.report));
  const text = JSON.stringify(withMenus.pages);
  assert.ok(text.includes('Privacy Policy'), 'footer links must stay on the page');
  assert.ok(!/Elegant Themes/.test(text), 'the credits paragraph must not reach the page');
});

test('a paragraph mixing a credit with the client\'s own words is kept', () => {
  const ir = normalizeSite(strandsWith((html) =>
    html.replace(/<p id="footer-info">[\s\S]*?<\/p>/, '<p id="footer-info">© 2026 Strands Movie LLC. Designed by <a href="https://www.elegantthemes.com">Elegant Themes</a></p>')
  )).ir;
  const out = mapSite(ir, { existingSlugs: [] });
  assert.equal(out.report.skipped.length, 0);
  assert.ok(JSON.stringify(out.pages).includes('Strands Movie LLC'));
});

test('a site with no header <nav> does not get its footer links as its menu', () => {
  const { ir } = normalizeSite(
    strandsWith((html) =>
      html.replace(/<nav id="top-menu-nav">[\s\S]*?<\/nav>/, '').replace(SOCIAL_LIST, TEXT_LINKS)
    )
  );
  assert.ok(!ir.taxonomy.navs.some((n) => n.location === 'header'), 'fixture must have no header menu');
  assert.ok(ir.taxonomy.navs.some((n) => n.source === 'footer-links'), 'fixture must carry a footer-links tree');
  const out = mapSite(ir, { existingSlugs: [] });
  assert.deepEqual(out.navItems, []);
});

// --- Top Menu + Footer Menu (task 86bchydp6) -------------------------------

function strandsIr(edit = (html) => html) {
  return normalizeSite(strandsWith(edit)).ir;
}

test('strands: the menu plan has a 25-link top menu with its logo, and a 2-link footer', () => {
  const out = mapSite(strandsIr(), { existingSlugs: [] });
  const { top, footer } = out.menus;
  assert.ok(top, 'top menu missing');
  assert.equal(top.items.length, 25);
  assert.equal(top.items.filter((i) => !i.parentId).length, 7);
  assert.deepEqual(out.navItems, top.items, 'navItems (used by --nav) is the top menu');
  assert.ok(top.logo, 'the logo is missing from the top menu');
  // The captured copy, never the client's server.
  assert.equal(top.logo.url, 'SiteImport/job-fixture-strands/assets/logo.png');
  assert.equal(top.logo.alt, 'Strands');
  assert.ok(
    out.copyPlan.assets.some((a) => a.assetId === 'asset-logo' && a.fromUrl === top.logo.url),
    'the logo must go through the copy plan so --apply copies it into the project'
  );
  assert.ok(footer, 'footer menu missing');
  assert.deepEqual(footer.items.map((i) => i.label), ['Facebook', 'X']);
  assert.deepEqual(out.report.menus, { top: { items: 25, topLevel: 7, logo: true }, footer: { items: 2 }, notes: [] });
});

test('strands: the Top Menu section is two columns — logo left, menu right', () => {
  const out = mapSite(strandsIr(), { existingSlugs: [] });
  const section = buildMenuSection('top', out.menus, 'job1');
  assert.equal(section.layout, 'one-three');
  assert.equal(section.title, 'Top Menu');
  const logo = section.modules.find((m) => m.type === 'image');
  const nav = section.modules.find((m) => m.type === 'navigation');
  assert.ok(logo, 'the Top Menu has no logo column');
  assert.equal(logo.column, 'left');
  assert.equal(logo.settings.url, out.menus.top.logo.url);
  assert.equal(logo.settings.linkUrl, '/');
  // 1000x300 shown 80px tall → 267px wide, not the full column.
  assert.equal(logo.settings.maxWidthPx, '267');
  assert.equal(nav.column, 'right');
  assert.equal(nav.settings.navAlignment, 'right');
  assert.equal(nav.settings.navDirection, 'horizontal');
  assert.equal(JSON.parse(nav.settings.navItems).length, 25);

  const footer = buildMenuSection('footer', out.menus, 'job1');
  assert.equal(footer.layout, 'single');
  assert.equal(footer.title, 'Footer Menu');
  assert.equal(footer.modules.length, 1);
  assert.equal(footer.modules[0].settings.menuLocation, 'footer');
  assert.deepEqual(JSON.parse(footer.modules[0].settings.navItems).map((i) => i.label), ['Facebook', 'X']);
});

test('the Top Menu sections survive the server-side normalizer as a two-column section', () => {
  const out = mapSite(strandsIr(), { existingSlugs: [] });
  const section = buildMenuSection('top', out.menus, 'job1');
  const round = serializeBuilderDocument({ layoutSections: [section] }).sections[0];
  assert.ok(round, 'section lost in serialization');
  assert.equal(round.layout, 'one-three');
  assert.deepEqual(round.modules.map((m) => [m.type, m.column]), [['image', 'left'], ['navigation', 'right']]);
  const nav = round.modules[1];
  assert.equal(JSON.parse(nav.settings.navItems).length, 25, 'nav items lost in normalization');
  assert.equal(nav.settings.navAlignment, 'right');
  assert.equal(round.modules[0].settings.maxWidthPx, '267');
});

test('no logo: the Top Menu plan is one column, and the report says why', () => {
  const ir = strandsIr();
  delete ir.taxonomy.logo;
  const out = mapSite(ir, { existingSlugs: [] });
  assert.equal(out.menus.top.logo, null);
  assert.equal(out.menus.top.items.length, 25);
  assert.equal(out.report.menus.top.logo, false);
  assert.ok(out.report.menus.notes.some((n) => /no logo found in the header/.test(n)), out.report.menus.notes.join('; '));
  const section = buildMenuSection('top', out.menus, 'job1');
  assert.equal(section.layout, 'single');
  assert.deepEqual(section.modules.map((m) => [m.type, m.column]), [['navigation', 'main']]);
});

test('no footer links: footer is null, and the report says why', () => {
  const out = mapSite(strandsIr((html) => html.replace(SOCIAL_LIST, '')), { existingSlugs: [] });
  assert.equal(out.menus.footer, null);
  assert.equal(out.report.menus.footer, null);
  assert.ok(out.report.menus.notes.some((n) => /footer/.test(n) && /no Footer Menu/.test(n)), out.report.menus.notes.join('; '));
  assert.equal(buildMenuSection('footer', out.menus, 'job1'), null);
});

test('footer links to imported pages are localised like the header', () => {
  const out = mapSite(strandsIr((html) => html.replace(SOCIAL_LIST, TEXT_LINKS)), { existingSlugs: [] });
  assert.deepEqual(
    out.menus.footer.items.map((i) => [i.label, i.href]),
    [['Privacy Policy', '/privacy'], ['Contact us', '/contact']]
  );
});

test('a logo missing from the asset manifest is still copied, never left on the old server', () => {
  const ir = strandsIr();
  delete ir.taxonomy.logo.assetId;
  ir.taxonomy.logo.src = 'https://strandsmovie.com/brand/other-logo.svg';
  const out = mapSite(ir, { existingSlugs: [] });
  const promotion = out.copyPlan.assets.find((a) => a.assetId === 'site-logo');
  assert.ok(promotion, 'the logo was not put in the copy plan');
  assert.equal(promotion.fromUrl, 'https://strandsmovie.com/brand/other-logo.svg');
  assert.equal(promotion.mimeType, 'image/svg+xml');
  // The section carries fromUrl, which --apply rewrites to the project copy.
  assert.equal(out.menus.top.logo.url, promotion.fromUrl);
});

test('logo width cap keeps proportions and never upscales a short logo', () => {
  assert.equal(topMenuLogoWidthPx({ url: '', alt: '', width: 1000, height: 300, assetId: '' }), 267);
  assert.equal(topMenuLogoWidthPx({ url: '', alt: '', width: 120, height: 40, assetId: '' }), 120);
  assert.equal(topMenuLogoWidthPx({ url: '', alt: '', width: 0, height: 0, assetId: '' }), 240);
});

test('menu names: never write to a section the project already has', () => {
  const site = menuSiteLabel('https://www.strandsmovie.com/about/');
  assert.equal(site, 'strandsmovie.com');
  assert.deepEqual(planMenuTarget('top', [], '', site), { action: 'create', id: '', name: 'Top Menu' });
  const existing = [{ id: 's1', name: 'Top Menu' }, { id: 's2', name: 'footer menu' }];
  assert.deepEqual(planMenuTarget('top', existing, '', site), { action: 'create', id: '', name: 'Top Menu (strandsmovie.com)' });
  assert.deepEqual(planMenuTarget('footer', existing, '', site), { action: 'create', id: '', name: 'Footer Menu (strandsmovie.com)' });
  const crowded = [...existing, { id: 's3', name: 'Top Menu (strandsmovie.com)' }];
  assert.equal(planMenuTarget('top', crowded, '', site).name, 'Top Menu (strandsmovie.com) 2');
});

test('menu names: a re-run updates the section this job made, even if it was renamed', () => {
  const existing = [{ id: 's1', name: 'Top Menu' }, { id: 's9', name: 'Strands header' }];
  assert.deepEqual(planMenuTarget('top', existing, 's9', 'strandsmovie.com'), { action: 'update', id: 's9', name: 'Strands header' });
  // Deleted since the last run → a new one, under a free name.
  assert.deepEqual(planMenuTarget('top', existing, 's404', 'strandsmovie.com'), { action: 'create', id: '', name: 'Top Menu (strandsmovie.com)' });
});

test('attaching menus: Top Menu first, Footer Menu last, and a second attach changes nothing', () => {
  const out = mapSite(strandsIr(), { existingSlugs: [] });
  const menus = {
    top: { savedSectionId: 'top1', section: buildMenuSection('top', out.menus, 'job1') },
    footer: { savedSectionId: 'foot1', section: buildMenuSection('footer', out.menus, 'job1') },
  };
  const body = [{ id: 'a' }, { id: 'b' }];
  const first = attachMenuInstances(body, '1497', menus);
  assert.equal(first.changed, true);
  assert.deepEqual(first.sections.map((s) => s.savedSectionId || s.id), ['top1', 'a', 'b', 'foot1']);
  assert.equal(first.sections[0].canonical, true);
  assert.equal(first.sections[3].canonical, true);
  const again = attachMenuInstances(first.sections, '1497', menus);
  assert.equal(again.changed, false);
  assert.equal(again.sections.length, 4);
  // No footer this time → only the top menu is attached.
  const topOnly = attachMenuInstances(body, '1500', { top: menus.top, footer: null });
  assert.deepEqual(topOnly.sections.map((s) => s.savedSectionId || s.id), ['top1', 'a', 'b']);
});

test('a coloured glow reaches the Button and the picture; a grey shadow does not (86bctde3a)', () => {
  const ir = completenessIr();
  const sec = ir.pages[0].sections[0];
  const btn = sec.elements.find((e) => e.sourceId === '0-btn');
  btn.computedStyles = { 'box-shadow': 'rgba(0, 217, 255, 0.18) 0px 0px 22px 0px, rgba(0, 217, 255, 0.04) 0px 0px 18px 0px inset' };
  const img = sec.elements.find((e) => e.sourceId === '0-imgsolo');
  img.computedStyles = { 'box-shadow': 'rgba(0, 217, 255, 0.15) 0px 0px 60px 0px' };
  const modules = mapSite(ir, { existingSlugs: [] }).pages[0].sections.flatMap((s) => s.modules);
  const button = modules.find((m) => m.type === 'button');
  assert.equal(button.settings.buttonGlow, 'true');
  assert.equal(button.settings.buttonGlowColor, '#00d9ff');
  assert.equal(button.settings.buttonGlowSize, '22');
  assert.equal(button.settings.buttonGlowStrength, '18');
  const picture = modules.find((m) => m.type === 'image');
  assert.equal(picture.settings.imageShadow, 'true');
  assert.equal(picture.settings.imageShadowColor, '#00d9ff');
  assert.equal(picture.settings.imageShadowBlur, '60');
  assert.equal(picture.settings.imageShadowOpacity, '15');

  // An ordinary grey drop shadow leaves both modules exactly as before.
  const plain = completenessIr();
  const s2 = plain.pages[0].sections[0];
  s2.elements.find((e) => e.sourceId === '0-btn').computedStyles = { 'box-shadow': 'rgba(0, 0, 0, 0.2) 0px 2px 6px 0px' };
  const m2 = mapSite(plain, { existingSlugs: [] }).pages[0].sections.flatMap((s) => s.modules);
  assert.ok(!Object.keys(m2.find((m) => m.type === 'button').settings).some((k) => /Glow/.test(k)));
  assert.ok(!Object.keys(m2.find((m) => m.type === 'image').settings).some((k) => /Shadow/.test(k)));
});

/* ---------------------------------------------------------------------------
 * Downloaded but never placed (task 86bctde7n): Alphire downloaded 48 files
 * and Assets showed 10. Every image and PDF gets one row; fonts none.
 * ------------------------------------------------------------------------- */

function dl(id, originalUrl, mimeType, extra = {}) {
  return {
    id, originalUrl, storageUrl: `https://blob.test/SiteImport/job/assets/${id}`,
    contentHash: id, mimeType, byteSize: 100, altText: '', referencedBy: [],
    status: 'downloaded', error: '', ...extra,
  };
}

const WP = 'https://alphire.agency/wp-content/uploads';
const alphireLeftovers = () => [
  dl('hero', `${WP}/2026/10/hero_banner.png`, 'image/png'),
  dl('circ', `${WP}/2021/09/background_blue_circles_1920x1080.png`, 'image/png'),
  dl('dane-s', `${WP}/2023/01/headshot_dane_christensen-150x150.jpeg`, 'image/jpeg'),
  dl('dane', `${WP}/2023/01/headshot_dane_christensen.jpeg`, 'image/jpeg'),
  dl('fav32', `${WP}/2021/09/cropped-favicon_512x512-32x32.png`, 'image/png'),
  dl('fav192', `${WP}/2021/09/cropped-favicon_512x512-192x192.png`, 'image/png'),
  dl('fav180', `${WP}/2021/09/cropped-favicon_512x512-180x180.png`, 'image/png'),
  dl('pdf', `${WP}/2024/03/10-Reasons.pdf`, 'application/pdf'),
  dl('font1', 'https://alphire.agency/fonts/inter.woff2', 'font/woff2'),
  dl('font2', 'https://alphire.agency/fonts/x.ttf', 'application/x-font-ttf'),
  dl('sub-s', `${WP}/2024/02/Substack-Logo-300x300.png`, 'image/png'),
  dl('sub', `${WP}/2024/02/Substack-Logo.png`, 'image/png'),
  { ...dl('gone', 'https://no-cache.hubspot.com/cta/x.png', 'image/png'), status: 'failed', storageUrl: '' },
];

test('unplaced assets: every downloaded image and PDF once, largest size variant, no fonts', () => {
  const promoted = [{ assetId: 'sub-s', fromUrl: 'x', originalUrl: `${WP}/2024/02/Substack-Logo-300x300.png`, altText: '', mimeType: 'image/png' }];
  const plan = planUnplacedAssets(alphireLeftovers(), promoted);
  const ids = plan.map((a) => a.assetId).sort();
  // hero + circles + ONE headshot (the original) + ONE favicon (192, the
  // largest) + the PDF. Not the fonts, not the failed download, and not the
  // Substack original, whose family is already in Assets via its variant.
  assert.deepEqual(ids, ['circ', 'dane', 'fav192', 'hero', 'pdf']);
  assert.ok(plan.every((a) => a.fromUrl.startsWith('https://blob.test/SiteImport/job/assets/')));
});

test('unplaced assets: the measured size wins over the name when the capture has one', () => {
  const plan = planUnplacedAssets([
    dl('small', `${WP}/a-300x200.jpg`, 'image/jpeg', { width: 300, height: 200 }),
    dl('big', `${WP}/a-100x100.jpg`, 'image/jpeg', { width: 1200, height: 800 }),
  ], []);
  assert.deepEqual(plan.map((a) => a.assetId), ['big']);
});

test('unplaced assets: a size suffix only folds when it is the whole tail', () => {
  assert.equal(sizeVariantFamily(`${WP}/b-450x300-1-300x200.jpg`), sizeVariantFamily(`${WP}/b-450x300-1.jpg`));
  assert.notEqual(sizeVariantFamily(`${WP}/circles_1920x1080.png`), sizeVariantFamily(`${WP}/circles.png`));
});

test('mapSite reports unplaced files and leaves only the rest in the namespace', () => {
  const ir = completenessIr();
  ir.assets = [...ir.assets, ...alphireLeftovers()];
  const out = mapSite(ir, { existingSlugs: [] });
  assert.deepEqual(out.copyPlan.unplaced.map((a) => a.assetId).sort(), ['circ', 'dane', 'fav192', 'hero', 'pdf', 'sub']);
  assert.equal(out.report.assets.unplaced, 6);
  assert.equal(out.report.assets.leftInNamespace, ir.assets.length - out.report.assets.promoted - 6);
});
