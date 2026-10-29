'use strict';

/**
 * A page's own background (task 86bctde6u). Alphire's home page puts its
 * content in a `<main>` painted #03050a; its sections are transparent. 15 of
 * the site's 17 pages are white, so the import theme's surface is white — and
 * nothing carried the home page's own colour onto it, so it came out white.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSite, pickPageBackground } = require('../../lib/site-import/dist/normalize.js');
const { mapSite } = require('../../lib/site-import/dist/map.js');
const { contrastRatio, READABLE_CONTRAST } = require('../../lib/site-import/dist/theme.js');

const DARK = 'rgb(3, 5, 10)';
const WHITE = 'rgb(255, 255, 255)';
const TEXT = { color: 'rgb(51, 51, 51)', 'font-size': '16px' };

/** One captured page. `build(box)` returns the body's inner HTML. */
function page(path, build, { pageBackground = WHITE } = {}) {
  const styles = {};
  const rects = {};
  let n = 0;
  const box = (tag, st, rect, inner, attrs = '') => {
    const key = String(n++);
    styles[key] = { ...TEXT, ...st };
    rects[key] = rect;
    return `<${tag} data-scim="${key}"${attrs}>${typeof inner === 'function' ? inner() : inner}</${tag}>`;
  };
  const url = `https://example.org${path}`;
  return {
    desktop: {
      url, finalUrl: url, viewport: 'desktop',
      html: `<html><body>${build(box)}</body></html>`,
      styles, rects, pageBackground,
      fullPageScreenshot: '', sectionScreenshots: {}, elementScreenshots: {},
      assetUrls: [], fontFamilies: [],
      meta: { title: path, metaDescription: '', ogTags: {}, canonicalUrl: '', lang: 'en' },
    },
  };
}

const whitePage = (path) =>
  page(path, (box) =>
    box('section', {}, [0, 0, 1200, 400], () =>
      box('h2', {}, [100, 40, 1000, 40], 'A white page') +
      box('p', {}, [100, 100, 1000, 60], 'Plain text on white.')) +
    box('section', {}, [0, 400, 1200, 400], () =>
      box('p', {}, [100, 440, 1000, 60], 'More text on white.')));

/** Alphire's shape: a dark <main> around transparent sections, one of which
 *  holds a white band of its own. */
const darkHome = ({ mainFill = DARK } = {}) =>
  page('/', (box) =>
    box('main', { 'background-color': mainFill }, [0, 0, 1200, 1800], () =>
      box('section', {}, [0, 0, 1200, 700], () =>
        box('h1', {}, [100, 100, 1000, 60], 'Technology that amplifies') +
        box('p', {}, [100, 200, 1000, 60], 'Dark home page copy.')) +
      box('section', {}, [0, 700, 1200, 700], () =>
        box('h2', {}, [100, 760, 1000, 40], 'What we do') +
        box('p', {}, [100, 820, 1000, 60], 'More dark copy.')) +
      box('section', {}, [0, 1400, 1200, 400], () =>
        box('div', { 'background-color': WHITE, 'padding-top': '40px' }, [0, 1400, 1200, 400], () =>
          box('p', {}, [100, 1440, 1000, 60], 'A white band on the dark page.')))),
  { pageBackground: WHITE });

function importSite(pages) {
  const { ir } = normalizeSite({
    jobId: 'j', sourceUrl: 'https://example.org/', capturedAt: '', assets: [], pages,
  });
  const out = mapSite(ir, { existingSlugs: [] });
  const byPath = (path) => out.pages.find((p) => p.irPath === path);
  return { ir, out, byPath };
}

const SITE = () => [darkHome(), whitePage('/about'), whitePage('/services')];

const holding = (sections, pattern) =>
  sections.find((s) => s.modules.some((m) => pattern.test(JSON.stringify(m.settings || {}) + (m.text || ''))));

test('normalize records what each page sits on: the dark <main>, not the white <body>', () => {
  const { ir } = importSite(SITE());
  const home = ir.pages.find((p) => p.path === '/');
  assert.equal(home.background, DARK);
  assert.equal(ir.pages.find((p) => p.path === '/about').background, WHITE);
  // The sections sit on the page's own colour, so none records a ground.
  assert.ok(home.sections.every((s) => s.ground === undefined));
});

test('a dark page on a white site imports with a dark page background and light text', () => {
  const { byPath, out } = importSite(SITE());
  const home = byPath('/');
  assert.deepEqual(home.pageBackground, { mode: 'color', color: '#03050a', color2: '', imageUrl: '', styleKey: '' });
  for (const role of ['text', 'heading', 'link']) {
    const ratio = contrastRatio(home.textColors[role], '#03050a');
    assert.ok(ratio >= READABLE_CONTRAST, `${role} ${home.textColors[role]} reads on the dark page (${ratio.toFixed(1)}:1)`);
  }
  assert.equal(out.report.pages.find((p) => p.key === home.key).background, '#03050a');
});

test('the other pages stay white: no page background, no text colours', () => {
  const { byPath, out } = importSite(SITE());
  for (const path of ['/about', '/services']) {
    assert.equal(byPath(path).pageBackground, undefined, path);
    assert.equal(byPath(path).textColors, undefined, path);
    assert.equal(out.report.pages.find((p) => p.irPath === path || p.path === path).background, undefined, path);
  }
});

test('on the dark page, a white band keeps its white; nothing repaints the dark sections', () => {
  const { byPath } = importSite(SITE());
  const sections = byPath('/').sections;
  // White is the THEME surface, so on a white page this band would be left
  // unset to follow it — on the dark page it is the band's whole point.
  assert.equal(holding(sections, /A white band/).background.color, '#ffffff');
  assert.equal(holding(sections, /Dark home page copy/).background.mode, 'none');
});

test('a page whose own colour readable text already reads on keeps that text', () => {
  const home = darkHome();
  for (const st of Object.values(home.desktop.styles)) st.color = 'rgb(245, 251, 255)';
  const { byPath } = importSite([home, whitePage('/about'), whitePage('/services')]);
  assert.equal(byPath('/').textColors.text, '#f5fbff');
});

test('the page text is the colour most WORDS wear, not the one most elements wear', () => {
  // Alphire's home: more small cyan labels than paragraphs; by element count
  // its body text came out cyan.
  const labels = page('/', (box) =>
    box('main', { 'background-color': DARK }, [0, 0, 1200, 1400], () =>
      box('section', {}, [0, 0, 1200, 700], () =>
        ['One', 'Two', 'Three'].map((w, i) => box('p', { color: 'rgb(0, 217, 255)' }, [100, 40 + i * 40, 200, 20], w)).join('') +
        box('p', { color: 'rgb(168, 189, 201)' }, [100, 200, 1000, 200],
          'A long paragraph of body copy that carries most of the words on the page.') +
        box('h2', { color: 'rgb(51, 51, 51)' }, [100, 500, 1000, 40], 'A heading the site left dark grey')) +
      box('section', {}, [0, 700, 1200, 700], () =>
        box('h2', { color: 'rgb(255, 255, 255)' }, [100, 760, 1000, 40], 'White')),
    ));
  const { byPath } = importSite([labels, whitePage('/about'), whitePage('/services')]);
  const colors = byPath('/').textColors;
  assert.equal(colors.text, '#a8bdc9');
  // The dark-grey heading has more characters but cannot be read on the page,
  // so the next heading colour that can wins.
  assert.equal(colors.heading, '#ffffff');
});

test('a transparent section on a painted wrapper the page does not wear is painted that colour', () => {
  const tinted = page('/tinted', (box) =>
    box('section', {}, [0, 0, 1200, 400], () => box('p', {}, [100, 40, 1000, 60], 'On white.')) +
    box('main', { 'background-color': 'rgb(230, 240, 250)' }, [0, 400, 1200, 300], () =>
      box('section', {}, [0, 400, 1200, 300], () => box('p', {}, [100, 440, 1000, 60], 'On the tint.'))) +
    box('section', {}, [0, 700, 1200, 400], () => box('p', {}, [100, 740, 1000, 60], 'White again.')));
  const { ir, byPath } = importSite([tinted, whitePage('/about')]);
  const irPage = ir.pages.find((p) => p.path === '/tinted');
  assert.equal(irPage.background, WHITE);
  assert.deepEqual(irPage.sections.map((s) => s.ground), [undefined, 'rgb(230, 240, 250)', undefined]);
  const sections = byPath('/tinted').sections;
  assert.equal(holding(sections, /On the tint/).background.color, '#e6f0fa');
  assert.equal(holding(sections, /White again/).background.mode, 'none');
  assert.equal(byPath('/tinted').pageBackground, undefined);
});

test('the page background is the ground under the most content area', () => {
  const box = (h) => ({ w: 100, h });
  assert.equal(pickPageBackground([{ ground: 'a', box: box(900) }, { ground: 'b', box: box(100) }, { ground: 'b', box: box(100) }]), 'a');
  assert.equal(pickPageBackground([{ ground: 'a' }, { ground: 'b' }, { ground: 'b' }]), 'b');
  assert.equal(pickPageBackground([{ ground: '' }, { ground: '' }]), '');
  assert.equal(pickPageBackground([]), '');
});

test('content on white bands over a black <body> does not make a black page', () => {
  // Strands Movie's shape (2026-10-12): every word sits on a white column
  // painted inside each section; the black only shows at the edges.
  const strands = page('/', (box) =>
    ['One', 'Two'].map((w, i) =>
      box('section', {}, [0, i * 600, 1200, 600], () =>
        box('div', { 'background-color': WHITE }, [200, i * 600, 800, 600], () =>
          box('p', { color: 'rgb(0, 0, 0)' }, [240, i * 600 + 40, 720, 60], `${w} on the white column.`)))).join(''),
  { pageBackground: 'rgb(0, 0, 0)' });
  const { ir, byPath } = importSite([strands, whitePage('/about'), whitePage('/services')]);
  assert.equal(ir.pages.find((p) => p.path === '/').background, undefined);
  assert.equal(byPath('/').pageBackground, undefined);
});

test('an IR normalized before page backgrounds existed maps exactly as it did', () => {
  const { ir } = importSite(SITE());
  for (const p of ir.pages) {
    delete p.background;
    for (const s of p.sections) delete s.ground;
  }
  const out = mapSite(ir, { existingSlugs: [] });
  assert.ok(out.pages.every((p) => p.pageBackground === undefined && p.textColors === undefined));
});
