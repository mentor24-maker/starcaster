/**
 * Section and element ids are named by the page's ADDRESS, not its place in
 * the crawl (task 86bcyrt21).
 *
 * Two captures of wavecenter.com found 10 and 7 pages; the three that moved
 * position (/forgot-password, /register, /sign-in) got a new id for every
 * section — 18 of 42 — so "Import again" could not recognise them. These
 * tests pin: the same address gives the same ids whatever the crawl order,
 * a second capture of one path still gets its own ids, element crops still
 * join (new keys and the old ones older captures carry), and a page built
 * under the old names is recognised rather than given a second copy.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSite,
  computeSourceId,
  legacySourceId,
  pageSourceKey,
  pageKeyCounter,
} = require('../../lib/site-import/dist/normalize.js');
const { mapSite, adoptLegacySectionIds, mergeMappedSections } = require('../../lib/site-import/dist/map.js');

const META = { title: '', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: '' };

function page(url, html, elementScreenshots = {}) {
  return {
    desktop: {
      url,
      finalUrl: url,
      viewport: 'desktop',
      html,
      styles: {},
      fullPageScreenshot: '',
      sectionScreenshots: {},
      elementScreenshots,
      assetUrls: [],
      fontFamilies: [],
      meta: { ...META, title: url },
    },
  };
}

const HOME = '<body><section><h1>Welcome</h1><p>Home page copy.</p></section><section><h2>More</h2><p>Second band.</p></section></body>';
const SIGN_IN = '<body><section><h1>Sign in</h1><p>Enter your details.</p></section></body>';
const REGISTER = '<body><section><h1>Register</h1><p>Make an account.</p></section></body>';
const ABOUT = '<body><section><h1>About</h1><p>Who we are.</p></section></body>';

function normalize(pages) {
  return normalizeSite({ jobId: 'j', sourceUrl: 'https://wave.test/', capturedAt: '2026-11-05T00:00:00.000Z', assets: [], pages }).ir;
}

/** path -> every section id and element id on that page, in order. */
function idsByPath(ir) {
  const out = {};
  for (const p of ir.pages) {
    const key = out[p.path] ? `${p.path}#2` : p.path;
    out[key] = p.sections.flatMap((s) => [s.sourceId, ...s.elements.map((e) => e.sourceId)]);
  }
  return out;
}

test('stable ids: the same address gets the same ids whatever the crawl order', () => {
  // First capture finds four pages; the second finds three, in another order.
  const first = normalize([
    page('https://wave.test/', HOME),
    page('https://wave.test/about', ABOUT),
    page('https://wave.test/register', REGISTER),
    page('https://wave.test/sign-in', SIGN_IN),
  ]);
  const second = normalize([
    page('https://wave.test/', HOME),
    page('https://wave.test/sign-in', SIGN_IN),
    page('https://wave.test/register', REGISTER),
  ]);
  const a = idsByPath(first);
  const b = idsByPath(second);
  let compared = 0;
  for (const path of Object.keys(b)) {
    assert.deepEqual(b[path], a[path], `ids on ${path} changed between captures`);
    compared += b[path].length;
  }
  assert.ok(compared >= 9, `compared ${compared} ids — the fixture must actually exercise the pages that moved`);
});

test('stable ids: mapped section ids match across the two captures too', () => {
  const sectionIds = (ir) => {
    const out = {};
    for (const p of mapSite(ir, { existingSlugs: [], menus: false }).pages) out[p.key] = p.sections.map((s) => s.id);
    return out;
  };
  const a = sectionIds(normalize([page('https://wave.test/about', ABOUT), page('https://wave.test/sign-in', SIGN_IN)]));
  const b = sectionIds(normalize([page('https://wave.test/sign-in', SIGN_IN)]));
  assert.ok(b['/sign-in'].length > 0);
  assert.deepEqual(b['/sign-in'], a['/sign-in']);
});

test('stable ids: a second capture of the same path still gets ids of its own', () => {
  const ir = normalize([page('https://wave.test/', HOME), page('https://wave.test/?lang=en', SIGN_IN)]);
  assert.equal(ir.pages[0].path, ir.pages[1].path);
  const first = new Set(ir.pages[0].sections.map((s) => s.sourceId));
  for (const s of ir.pages[1].sections) assert.ok(!first.has(s.sourceId), `${s.sourceId} is used on both copies of "/"`);
  assert.match(ir.pages[1].sections[0].sourceId, /^p[0-9a-f]{8}~2-/);
});

test('stable ids: element crops join on the new key and on the old crawl-position key', () => {
  const html = "<body><form action='/go'><input type='submit'></form></body>";
  const fresh = computeSourceId(pageSourceKey('/contact'), 'body/form[0]');
  const viaNew = normalize([page('https://wave.test/contact', html, { [fresh]: 'shots/new.png' })]);
  assert.equal(viaNew.pages[0].sections[0].elements[0].sourceId, fresh);
  assert.equal(viaNew.pages[0].sections[0].elements[0].screenshot, 'shots/new.png');

  // A capture taken before the change keyed its crops by crawl position.
  const old = legacySourceId(1, 'body/form[0]');
  const viaOld = normalize([page('https://wave.test/', HOME), page('https://wave.test/contact', html, { [old]: 'shots/old.png' })]);
  assert.equal(viaOld.pages[1].sections[0].elements[0].screenshot, 'shots/old.png');
});

test('stable ids: the worker and normalize count page keys the same way', () => {
  const keys = pageKeyCounter();
  // peek does not count: a page that fails before it is kept shifts nothing.
  assert.equal(keys.peek('https://wave.test/'), pageSourceKey('/'));
  assert.equal(keys.peek('https://wave.test/'), pageSourceKey('/'));
  assert.equal(keys.take('https://wave.test/'), pageSourceKey('/'));
  assert.equal(keys.take('https://wave.test/?x=1'), pageSourceKey('/', 2));
  assert.equal(keys.take('https://wave.test/about'), pageSourceKey('/about'));
});

// --- pages built under the old names -----------------------------------

/** What a page built before the change holds: the same sections, with the
 *  crawl-position half (e.g. page 3) where the address half is now. */
function legacyLive(mappedPage, crawlIdx) {
  return mappedPage.sections.map((s) => {
    const sourceId = s.modules[0].settings.importSectionSourceId;
    const dom = sourceId.slice(sourceId.indexOf('-') + 1);
    const base = `imps_${sourceId.replace(/[^a-zA-Z0-9]+/g, '')}`;
    return { ...s, id: `imps_${crawlIdx}${dom.replace(/[^a-zA-Z0-9]+/g, '')}${s.id.slice(base.length)}`, built: 'old' };
  });
}

test('old names: a page built under crawl-order ids is updated in place, never given a second copy', () => {
  const ir = normalize([page('https://wave.test/', HOME), page('https://wave.test/sign-in', SIGN_IN)]);
  const mapped = mapSite(ir, { existingSlugs: [], menus: false }).pages;
  for (const [i, mp] of mapped.entries()) {
    const live = [{ id: 'hand-made' }, ...legacyLive(mp, i + 3)];
    const { sections, renames } = adoptLegacySectionIds(live, mp.sections);
    assert.equal(renames.size, mp.sections.length, `every section on ${mp.key} recognised`);
    const merged = mergeMappedSections(sections, mp.sections, new Set());
    assert.equal(merged.length, live.length, `no section added twice on ${mp.key}`);
    assert.deepEqual(merged.map((s) => s.id), ['hand-made', ...mp.sections.map((s) => s.id)]);
    assert.ok(merged.slice(1).every((s) => s.built !== 'old'), 'the mapper refreshed the recognised sections');
  }
});

test('old names: a recognised section somebody edited keeps their content when protected', () => {
  const ir = normalize([page('https://wave.test/sign-in', SIGN_IN)]);
  const [mp] = mapSite(ir, { existingSlugs: [], menus: false }).pages;
  const live = legacyLive(mp, 7).map((s) => ({ ...s, title: 'Edited by Dane' }));
  const { sections } = adoptLegacySectionIds(live, mp.sections);
  const merged = mergeMappedSections(sections, mp.sections, new Set(mp.sections.map((s) => s.id)));
  assert.equal(merged.length, mp.sections.length);
  assert.ok(merged.every((s) => s.title === 'Edited by Dane'));
});

test('old names: nothing is renamed when the page already carries the new ids, or the match is ambiguous', () => {
  const ir = normalize([page('https://wave.test/sign-in', SIGN_IN)]);
  const [mp] = mapSite(ir, { existingSlugs: [], menus: false }).pages;
  assert.equal(adoptLegacySectionIds(mp.sections, mp.sections).renames.size, 0);
  // Two old copies claiming the same section: guessing would pick one at
  // random, so neither is renamed.
  const twice = [...legacyLive(mp, 2), ...legacyLive(mp, 5)];
  assert.equal(adoptLegacySectionIds(twice, mp.sections).renames.size, 0);
  // A hand-made section is never mistaken for an imported one.
  assert.equal(adoptLegacySectionIds([{ id: 'hero' }, { id: 'imps_A' }], mp.sections).renames.size, 0);
});
