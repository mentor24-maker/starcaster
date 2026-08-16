'use strict';

/**
 * Image top-up engine tests (Phase 3b).
 *
 * The failures this guards against are all quiet ones: the same photo placed
 * three times because WordPress served it at three sizes, the site logo
 * pasted into every gallery, a picture already on the page added again, and
 * images dropped by a cap without anyone saying so.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planImageTopUp,
  photoStem,
  detectFurnitureImages,
  buildTopUpSection,
  topUpReconciles,
  topUpSectionId,
  SLIDESHOW_THRESHOLD,
} = require('../../lib/site-import/dist/image-topup.js');
const { serializeBuilderDocument } = require('../../lib/builder/document.js');

const BLOB = 'https://blob.test/SiteImport/job1/assets';
let seq = 0;
function asset(originalUrl, paths, extra = {}) {
  seq += 1;
  return {
    originalUrl,
    storageUrl: `${BLOB}/${seq}.jpg`,
    mimeType: 'image/jpeg',
    byteSize: extra.byteSize ?? 1000,
    width: extra.width ?? 800,
    height: extra.height ?? 600,
    altText: extra.altText ?? '',
    referencedPaths: paths,
  };
}

// --- photo identity -------------------------------------------------------

test('the same photo is one photo through every URL it wears', () => {
  const base = photoStem('https://x.test/wp-content/uploads/2018/02/Bryan-Brothers.jpg');
  assert.equal(photoStem('https://x.test/uploads/Bryan-Brothers-768x576.jpg'), base, 'size variant');
  assert.equal(photoStem('https://x.test/uploads/Bryan-Brothers-scaled.jpg'), base, 'scaled variant');
  assert.equal(photoStem('https://x.test/uploads/Bryan-Brothers.jpg?resize=768,576'), base, 'resize query');
  assert.equal(photoStem('https://blob.test/APP_Assets/1786559901016_Bryan-Brothers.jpg'), base, 'promoted copy');
  assert.equal(photoStem('https://blob.test/APP_Assets/1786559901016_1786559901015_Bryan-Brothers.jpg'), base, 'doubly promoted');
});

test('different photos stay different', () => {
  assert.notEqual(photoStem('https://x.test/a/court-1.jpg'), photoStem('https://x.test/a/court-2.jpg'));
  // A dimension-looking name that is part of the photo's identity survives.
  assert.equal(photoStem('https://x.test/a/DBTennis-124w.jpg'), 'dbtennis-124w.jpg');
});

// --- furniture ------------------------------------------------------------

test('images on most pages are furniture, not gallery content', () => {
  const pages = ['/a', '/b', '/c', '/d'];
  const assets = [
    asset('https://x.test/logo.png', pages),
    asset('https://x.test/facebook.png', pages),
    asset('https://x.test/gallery-1.jpg', ['/a']),
    asset('https://x.test/gallery-2.jpg', ['/a']),
  ];
  const furniture = detectFurnitureImages(assets);
  assert.ok(furniture.has('logo.png'));
  assert.ok(furniture.has('facebook.png'));
  assert.ok(!furniture.has('gallery-1.jpg'));
});

test('furniture detection stands down on a tiny sample', () => {
  // With two captured pages, "on both pages" is not evidence of anything.
  const assets = [asset('https://x.test/a.jpg', ['/a', '/b'])];
  assert.equal(detectFurnitureImages(assets).size, 0);
});

// --- the plan -------------------------------------------------------------

function galleryFixture(extra = {}) {
  const many = ['/a', '/b', '/c', '/d', '/gallery'];
  const assets = [
    asset('https://x.test/logo.png', many),
    asset('https://x.test/instagram.png', many),
    // One photo at three sizes — must place once, at the largest.
    asset('https://x.test/up/court.jpg', ['/gallery'], { byteSize: 300 }),
    asset('https://x.test/up/court-768x576.jpg', ['/gallery'], { byteSize: 100 }),
    asset('https://x.test/up/court-1024x768.jpg', ['/gallery'], { byteSize: 200 }),
    asset('https://x.test/up/net.jpg', ['/gallery'], { byteSize: 500 }),
    asset('https://x.test/up/players.jpg', ['/gallery'], { byteSize: 600 }),
    asset('https://x.test/up/clubhouse.jpg', ['/gallery'], { byteSize: 700 }),
    asset('https://x.test/up/coach.jpg', ['/gallery'], { byteSize: 800 }),
    asset('https://x.test/up/already-here.jpg', ['/gallery'], { byteSize: 900 }),
  ];
  const targets = [{
    sourcePath: '/gallery',
    targetId: '2001',
    targetSlug: 'photo-gallery',
    alreadyOnPage: ['https://blob.test/APP_Assets/1786559901016_already-here.jpg'],
  }];
  return { assets, targets, ...extra };
}

test('a photo served at three sizes is placed once, at the largest', () => {
  const { plans } = planImageTopUp(galleryFixture());
  const plan = plans[0];
  const courts = plan.images.filter((i) => photoStem(i.originalUrl) === 'court.jpg');
  assert.equal(courts.length, 1, 'placed once');
  assert.equal(courts[0].byteSize, 300, 'the largest file won');
  assert.equal(courts[0].variantsCollapsed, 2);
});

test('site furniture never enters a gallery', () => {
  const { plans } = planImageTopUp(galleryFixture());
  const stems = plans[0].images.map((i) => photoStem(i.originalUrl));
  assert.ok(!stems.includes('logo.png'));
  assert.ok(!stems.includes('instagram.png'));
});

test('a photo already on the page is not added again', () => {
  // It is on the page under a promoted URL, which shares no characters with
  // the captured one beyond the filename — this is why matching is by stem.
  const { plans } = planImageTopUp(galleryFixture());
  const stems = plans[0].images.map((i) => photoStem(i.originalUrl));
  assert.ok(!stems.includes('already-here.jpg'));
});

test('every captured image lands in exactly one bucket', () => {
  const { report } = planImageTopUp(galleryFixture());
  assert.ok(topUpReconciles(report), JSON.stringify(report.byPage, null, 2));
  const page = report.byPage[0];
  assert.equal(page.captured, page.furniture + page.variants + page.already + page.capped + page.planned);
});

test('a cap is reported, never silently applied', () => {
  const { plans, report } = planImageTopUp({ ...galleryFixture(), limitPerPage: 2 });
  assert.equal(plans[0].images.length, 2);
  assert.equal(report.byPage[0].capped, 3, 'the dropped ones are counted');
  assert.ok(topUpReconciles(report), 'and still accounted for');
});

test('a page with nothing to add produces no plan', () => {
  const assets = [asset('https://x.test/logo.png', ['/a', '/b', '/c', '/d'])];
  const targets = [{ sourcePath: '/a', targetId: '1', targetSlug: 'x', alreadyOnPage: [] }];
  const { plans, report } = planImageTopUp({ assets, targets });
  assert.equal(plans.length, 0);
  assert.ok(topUpReconciles(report));
});

test('two original pages feeding one new page are pooled, not duplicated', () => {
  const assets = [
    asset('https://x.test/up/shared.jpg', ['/one', '/two'], { byteSize: 100 }),
    asset('https://x.test/up/only-one.jpg', ['/one']),
    asset('https://x.test/up/only-two.jpg', ['/two']),
  ];
  const targets = [
    { sourcePath: '/one', targetId: '9', targetSlug: 'events', alreadyOnPage: [] },
    { sourcePath: '/two', targetId: '9', targetSlug: 'events', alreadyOnPage: [] },
  ];
  const { plans } = planImageTopUp({ assets, targets });
  assert.equal(plans.length, 1, 'one plan for the one target page');
  const stems = plans[0].images.map((i) => photoStem(i.originalUrl));
  assert.equal(stems.filter((s) => s === 'shared.jpg').length, 1, 'the shared photo appears once');
  assert.equal(stems.length, 3);
});

// --- presentation ---------------------------------------------------------

test('a gallery-sized set becomes one slideshow', () => {
  const { plans } = planImageTopUp(galleryFixture());
  assert.ok(plans[0].images.length >= SLIDESHOW_THRESHOLD);
  assert.equal(plans[0].presentation, 'slideshow');

  const section = buildTopUpSection(plans[0], (i) => `https://cdn.test/${photoStem(i.originalUrl)}`);
  assert.equal(section.modules.length, 1);
  assert.equal(section.modules[0].type, 'slideshow');
  const slides = JSON.parse(section.modules[0].settings.slides);
  assert.equal(slides.length, plans[0].images.length);
  assert.ok(slides.every((s) => s.url.startsWith('https://cdn.test/')), 'slides use the durable URL');
});

test('a handful of pictures stays as individual image modules', () => {
  const assets = [
    asset('https://x.test/up/one.jpg', ['/p']),
    asset('https://x.test/up/two.jpg', ['/p']),
    asset('https://x.test/filler.jpg', ['/a', '/b', '/c']),
  ];
  const targets = [{ sourcePath: '/p', targetId: '5', targetSlug: 'pickleball', alreadyOnPage: [] }];
  const { plans } = planImageTopUp({ assets, targets });
  assert.equal(plans[0].presentation, 'images');
  const section = buildTopUpSection(plans[0], (i) => i.storageUrl);
  assert.equal(section.modules.length, 2);
  assert.ok(section.modules.every((m) => m.type === 'image'));
});

test('the section id is deterministic so a re-run replaces its own work', () => {
  assert.equal(topUpSectionId('2001'), topUpSectionId('2001'));
  assert.notEqual(topUpSectionId('2001'), topUpSectionId('2002'));
});

test('the built section survives the real document serializer', () => {
  const { plans } = planImageTopUp(galleryFixture());
  const section = buildTopUpSection(plans[0], (i) => i.storageUrl);
  const doc = serializeBuilderDocument({ layoutSections: [section] });
  const sections = Array.isArray(doc) ? doc : doc.sections;
  assert.equal(sections.length, 1);
  assert.equal(sections[0].modules[0].type, 'slideshow', 'not coerced to text');
  assert.ok(sections[0].modules[0].settings.slides, 'the slides survive');
  assert.equal(
    JSON.parse(sections[0].modules[0].settings.slides).length,
    plans[0].images.length,
    'and no slide is dropped by normalization'
  );
});

test('the top-level totals agree with the per-page rows', () => {
  // The typecheck caught `capped` missing from the summary once; it was
  // undefined at runtime and the runner printed nothing rather than failing.
  const { report } = planImageTopUp({ ...galleryFixture(), limitPerPage: 2 });
  const sum = (key) => report.byPage.reduce((n, p) => n + p[key], 0);
  assert.equal(report.planned, sum('planned'));
  assert.equal(report.capped, sum('capped'));
  assert.equal(report.furnitureExcluded, sum('furniture'));
  assert.equal(report.variantsCollapsed, sum('variants'));
  assert.equal(report.alreadyOnPage, sum('already'));
  assert.equal(report.assetsConsidered, sum('captured'));
  for (const key of ['planned', 'capped', 'furnitureExcluded', 'variantsCollapsed', 'alreadyOnPage']) {
    assert.equal(typeof report[key], 'number', `${key} must be a number, not undefined`);
  }
});
