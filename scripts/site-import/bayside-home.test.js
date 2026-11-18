'use strict';

/**
 * Bayside Partners (task SC-849). A Divi site whose import, on 2026-11-17,
 * showed the logo twice and Divi's hidden phone-menu label "Select Page",
 * painted the white hero heading dark on the dark photo, shrank the 750px
 * hero to a strip around its one line of text, and stacked the contact form
 * under the contact details behind an empty picture. The fixture is the real
 * capture of the home page (job simp_1794945570334_oh518a), trimmed to it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { mapSite, ownColorOnBand, bandHeightFor, styleProseHtml, blocksStack } = require('../../lib/site-import/dist/map.js');

const IR = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bayside-home.json'), 'utf8'));
const LOGO = IR.taxonomy.logo.assetId;

function home() {
  const out = mapSite(JSON.parse(JSON.stringify(IR)), { existingSlugs: [] });
  return { out, sections: out.pages[0].sections };
}
const modulesOf = (sections) => sections.flatMap((s) => s.modules);
const reconciles = (e) =>
  e.total === e.mapped + e.placeholder + (e.form || 0) + e.navConsumed + e.deduped + e.humanModified + e.skipped;

test('the header the Top Menu is built from pours nothing onto the page', () => {
  const { out, sections } = home();
  const all = modulesOf(sections);
  const logoUrl = IR.assets.find((a) => a.id === LOGO).storageUrl;
  const logos = all.filter((m) => m.type === 'image' && m.settings.url === logoUrl);
  assert.equal(logos.length, 0, 'the logo is the Top Menu\'s, not page content');
  assert.ok(!all.some((m) => /Select Page/.test(String(m.text || ''))), '"Select Page" never reaches the page');
  assert.ok(out.report.skipped.some((s) => /Select Page/.test(s.reason)), 'and it is accounted, with its reason');
  assert.ok(out.menus.top && out.menus.top.logo, 'the Top Menu still carries the logo');
  assert.ok(reconciles(out.report.elements), JSON.stringify(out.report.elements));
});

test('a header logo stays content when menus are off', () => {
  const out = mapSite(JSON.parse(JSON.stringify(IR)), { existingSlugs: [], menus: false });
  const all = modulesOf(out.pages[0].sections);
  assert.ok(all.some((m) => m.type === 'image' && String(m.settings.importSourceIds || '').includes('54868c56')));
});

test('the hero heading keeps its white over the photo the import reproduced', () => {
  const { sections } = home();
  const hero = sections.find((s) => s.background.mode === 'image' && modulesOf([s]).some((m) => /<h1/.test(m.text || '')));
  assert.ok(hero, 'the hero row exists with its photo');
  const h1 = hero.modules.find((m) => /<h1/.test(m.text || ''));
  assert.match(h1.text, /<h1 style="color:#ffffff">/);
  assert.doesNotMatch(h1.text, /divi:paragraph/, 'the empty Divi paragraph is not merged into it');
});

test('the hero keeps its height, with its text at the foot', () => {
  const { sections } = home();
  const hero = sections.find((s) => modulesOf([s]).some((m) => /<h1/.test(m.text || '')));
  assert.equal(hero.minHeight, '750');
  assert.deepEqual(hero.cellVAlign, { main: 'bottom' });
  // Content-sized bands stay content-sized.
  for (const s of sections.filter((x) => x !== hero)) assert.equal(s.minHeight, undefined, s.title);
});

test('the contact details and the form sit side by side, with no empty picture', () => {
  const { sections } = home();
  const contact = sections.find((s) => s.modules.some((m) => m.type === 'crm-form'));
  assert.notEqual(contact.layout, 'single');
  const form = contact.modules.find((m) => m.type === 'crm-form');
  const words = contact.modules.find((m) => /Contact Us/.test(m.text || ''));
  assert.notEqual(form.column, words.column);
  const empty = modulesOf(sections).filter((m) => m.type === 'image' && !m.settings.url);
  assert.equal(empty.length, 0, 'no image module without a picture');
});

test('one plain band split over two rows stays one band', () => {
  // Services is one white band on the original; split into a heading row and
  // a cards row, the theme's alternating bands painted the heading row grey.
  const { sections } = home();
  const heading = sections.findIndex((s) => s.modules.some((m) => /<h2>Services<\/h2>/.test(m.text || '')));
  const rows = sections.findIndex((s) => s.modules.some((m) => /Early Stage CEO Advisory/.test(m.text || '')));
  assert.equal(rows, heading + 1);
  assert.equal(sections[heading].joinWithPrevious, undefined, 'the band starts at the heading');
  for (let i = rows; i < rows + 4; i++) assert.equal(sections[i].joinWithPrevious, true, 'each service row joins it');
  // A row from a different band never joins the one above it.
  const contact = sections.findIndex((s) => s.modules.some((m) => m.type === 'crm-form'));
  assert.notEqual(sections[contact].joinWithPrevious, true);
});

test('ownColorOnBand: a picture is trusted, a fill must be readable, the theme colour adds nothing', () => {
  const look = { headingWeights: {}, linkColor: '', headingColor: '#333333', textColor: '#333333' };
  const white = { class: 'heading', html: '<h1>x</h1>', computedStyles: { color: 'rgb(255, 255, 255)' } };
  const photo = { mode: 'image', color: '', color2: '', imageUrl: 'x.jpg', styleKey: '' };
  const pale = { mode: 'color', color: '#eeeeee', color2: '', imageUrl: '', styleKey: '' };
  const navy = { mode: 'color', color: '#102040', color2: '', imageUrl: '', styleKey: '' };
  assert.equal(ownColorOnBand(white, look, photo), '#ffffff');
  assert.equal(ownColorOnBand(white, look, navy), '#ffffff');
  assert.equal(ownColorOnBand(white, look, pale), '', 'white on a pale fill would vanish');
  assert.equal(ownColorOnBand(white, look, null), '', 'no band came along: leave it to the theme');
  const themed = { ...white, computedStyles: { color: 'rgb(51, 51, 51)' } };
  assert.equal(ownColorOnBand(themed, look, photo), '', 'the theme already paints it this colour');
  // The prose styler writes it on a band, and leaves the html alone without one.
  const plain = { ...white, computedStyles: { color: 'rgb(255, 255, 255)', 'font-weight': '700' }, inlineStyles: [] };
  const look700 = { ...look, headingWeights: { 1: 700 } };
  assert.equal(styleProseHtml(plain, look700, photo), '<h1 style="color:#ffffff">x</h1>');
  assert.equal(styleProseHtml(plain, look700), '<h1>x</h1>');
});

test('bandHeightFor: only a band with real empty space keeps its height', () => {
  // Bayside's hero: 750 tall, one 94px heading near the foot.
  assert.deepEqual(bandHeightFor({ y: 91, h: 750 }, [{ y: 622, h: 94 }], 54, 54), { minHeight: '750', vAlign: 'bottom' });
  assert.deepEqual(bandHeightFor({ y: 0, h: 600 }, [{ y: 60, h: 80 }], 20, 20), { minHeight: '600', vAlign: 'top' });
  assert.deepEqual(bandHeightFor({ y: 0, h: 600 }, [{ y: 260, h: 80 }], 20, 20), { minHeight: '600', vAlign: 'center' });
  // Bayside's About band: content-sized (805 against 751).
  assert.equal(bandHeightFor({ y: 841, h: 805 }, [{ y: 922, h: 40 }, { y: 1364, h: 201 }], 54, 54), null);
  assert.equal(bandHeightFor(undefined, [{ y: 0, h: 10 }], 0, 0), null);
  assert.equal(bandHeightFor({ y: 0, h: 900 }, [undefined], 0, 0), null);
  assert.equal(bandHeightFor({ y: 0, h: 5000 }, [{ y: 10, h: 10 }], 0, 0).minHeight, '1200', 'Builder caps a row at 1200');
});

// SC-858: Services on the original is four rows, each a 108px round icon on
// the left with a heading and paragraph beside it. It repeats
// image+heading+text four times, so the card-grid guess made it four tall
// squeezed cards with huge icons.
test('Services imports as four stacked icon-left rows, not a row of cards', () => {
  const { out, sections } = home();
  assert.ok(!modulesOf(sections).some((m) => m.type === 'feature-cards'), 'no card grid on this page');
  assert.equal(out.cardGrids.length, 0);
  const titles = ['Early Stage CEO Advisory', 'Later Stage CEO Advisory', 'Family-Run Business Advisory', 'Non-Profit Advisory'];
  const at = sections.findIndex((s) => s.modules.some((m) => m.text && m.text.includes(titles[0])));
  titles.forEach((title, i) => {
    const row = sections[at + i];
    assert.ok(row.layout !== 'single', `${title}: a two-column row (${row.layout})`);
    assert.equal(row.modules.length, 2, `${title}: an icon and its words`);
    const [icon, words] = [row.modules.find((m) => m.type === 'image'), row.modules.find((m) => m.type === 'text')];
    assert.ok(icon && words, title);
    assert.equal(icon.column, 'left', `${title}: the icon on the left`);
    assert.equal(words.column, 'right', `${title}: the words on the right`);
    assert.match(words.text, new RegExp(`<h3[^>]*>${title}</h3>`), `${title}: its own heading, in its own row`);
    // The file is 108px, as the original showed it, and the image module never
    // draws a picture larger than its file — so no cap is needed to keep it so.
    const asset = IR.assets.find((a) => a.storageUrl === icon.settings.url);
    assert.equal(asset && asset.width, 108, `${title}: the icon is the 108px file`);
    assert.ok(!icon.settings.maxWidthPx || Number(icon.settings.maxWidthPx) <= 108);
  });
  assert.ok(reconciles(out.report.elements), JSON.stringify(out.report.elements));
});

test('blocksStack: a list of blocks one above another, never a row of cards', () => {
  const b = (x, y, w, h) => ({ box: { x, y, w, h } });
  // Bayside's Services: icon tops 1821, 2117, 2413, 2641; each block ends before the next starts.
  assert.equal(blocksStack([[b(239, 1821, 108, 108), b(485, 1873, 755, 170)], [b(239, 2117, 108, 108), b(485, 2169, 755, 170)], [b(239, 2413, 108, 108), b(485, 2465, 755, 102)]]), true);
  // A row of three cards shares a line.
  assert.equal(blocksStack([[b(0, 100, 300, 400)], [b(320, 100, 300, 400)], [b(640, 100, 300, 400)]]), false);
  // Six cards as 3 + 3: the second row stacks under the first, but cards share lines within it.
  const six = [0, 1, 2, 3, 4, 5].map((i) => [b((i % 3) * 320, i < 3 ? 0 : 500, 300, 400)]);
  assert.equal(blocksStack(six), false);
  // Unknown positions leave the old behaviour.
  assert.equal(blocksStack([[{ box: null }], [b(0, 500, 10, 10)], [b(0, 900, 10, 10)]]), false);
});

/*
 * The white curve over the Contact Us photo (task SC-859). Divi draws it as a
 * background mask, an SVG filling the RIGHT side, and flips it to the left
 * with `transform: scale(-1,1)`, so the address sits on white and the photo
 * shows on the right. The fixture predates the capture recording `transform`,
 * so these tests add what the capture now records — `matrix(-1, 0, 0, 1, 0, 0)`
 * is how a browser reports `scale(-1,1)` — on a copy, never in the fixture.
 */
const MASK = 'p2a0c975e-fe98da15';
function withMaskTransform(transform) {
  const ir = JSON.parse(JSON.stringify(IR));
  for (const s of ir.pages[0].sections) for (const el of s.elements || []) {
    if (el.sourceId === MASK) el.computedStyles.transform = transform;
  }
  return mapSite(ir, { existingSlugs: [] });
}

test('the Contact Us curve becomes a white shape on the left of its row', () => {
  const out = withMaskTransform('matrix(-1, 0, 0, 1, 0, 0)');
  const sections = out.pages[0].sections;
  const contact = sections.find((s) => s.modules.some((m) => m.type === 'crm-form'));
  assert.deepEqual(contact.shapeLayer, { shape: 'curve', side: 'left', color: '#ffffff', opacity: 71 });
  // Only the contact band has one.
  assert.equal(sections.filter((s) => s.shapeLayer).length, 1);
  // Counted as mapped, reported, and not skipped.
  assert.ok(!out.report.skipped.some((s) => s.sourceId === MASK), 'the mask is not skipped');
  assert.deepEqual(out.report.shapes.map((s) => [s.sourceId, s.shape]), [[MASK, 'curve']]);
  assert.ok(reconciles(out.report.elements), JSON.stringify(out.report.elements));
  // Still no empty picture.
  assert.equal(modulesOf(sections).filter((m) => m.type === 'image' && !m.settings.url).length, 0);
});

test('without a mirror the same curve stays on the right, as drawn', () => {
  const { out } = home();
  const contact = out.pages[0].sections.find((s) => s.modules.some((m) => m.type === 'crm-form'));
  assert.equal(contact.shapeLayer.side, 'right');
});

test('a mask that cannot be matched is skipped with a reason naming it', () => {
  const ir = JSON.parse(JSON.stringify(IR));
  for (const s of ir.pages[0].sections) for (const el of s.elements || []) {
    if (el.sourceId === MASK) {
      // Two drawings in one SVG — not a single built-in shape.
      const svg = '<svg viewBox="0 0 10 10" fill="#fff"><path d="M0,0H1V1Z"/><path d="M2,2H3V3Z"/></svg>';
      el.computedStyles['background-image'] = `url("data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}")`;
    }
  }
  const out = mapSite(ir, { existingSlugs: [] });
  const skip = out.report.skipped.find((s) => s.sourceId === MASK);
  assert.ok(skip, 'accounted');
  assert.match(skip.reason, /background shape.*not carried over.*2 drawings/);
  assert.equal(out.pages[0].sections.filter((s) => s.shapeLayer).length, 0);
  assert.ok(reconciles(out.report.elements));
});

test('an Elementor shape divider is named in the report, not poured onto the page', () => {
  const ir = JSON.parse(JSON.stringify(IR));
  const contact = ir.pages[0].sections.find((s) => s.elements.some((e) => e.sourceId === MASK));
  contact.elements.push({
    sourceId: 'elementor-divider', class: 'image', textContent: '', textLength: 0, assetRefs: [],
    html: '<div class="elementor-shape elementor-shape-bottom"><svg viewBox="0 0 1000 100"><path class="elementor-shape-fill" d="M0,0L1000,100H0Z"></path></svg></div>',
    computedStyles: {}, documentPosition: 999, depth: 14, containers: ['97'],
  });
  const out = mapSite(ir, { existingSlugs: [] });
  const skip = out.report.skipped.find((s) => s.sourceId === 'elementor-divider');
  assert.ok(skip);
  assert.match(skip.reason, /Elementor shape divider.*stylesheet/);
  assert.ok(!modulesOf(out.pages[0].sections).some((m) => String(m.settings.importSourceIds || '').includes('elementor-divider')));
  assert.ok(reconciles(out.report.elements));
});

/*
 * The report must only say a shape landed when a row took it (SC-859 review).
 */
function maskElement(ir) {
  for (const s of ir.pages[0].sections) for (const el of s.elements || []) if (el.sourceId === MASK) return { section: s, el };
  throw new Error('fixture has no mask');
}

test('a mask in a band with nothing else carried over is skipped, not reported as landed', () => {
  const ir = JSON.parse(JSON.stringify(IR));
  const { section, el } = maskElement(ir);
  const lone = JSON.parse(JSON.stringify(section));
  lone.sourceId = 'lone-mask-band';
  lone.elements = [{ ...JSON.parse(JSON.stringify(el)), sourceId: 'lone-mask' }];
  ir.pages[0].sections.push(lone);
  const out = mapSite(ir, { existingSlugs: [] });
  const skip = out.report.skipped.find((s) => s.sourceId === 'lone-mask');
  assert.ok(skip, 'accounted as skipped');
  assert.match(skip.reason, /background shape.*no row to put it on/);
  assert.ok(!out.report.shapes.some((s) => s.sourceId === 'lone-mask'), 'not listed as carried over');
  assert.ok(reconciles(out.report.elements), JSON.stringify(out.report.elements));
});

test('a second mask on a row that already has one is reported as not carried over', () => {
  const ir = JSON.parse(JSON.stringify(IR));
  const { section, el } = maskElement(ir);
  section.elements.push({ ...JSON.parse(JSON.stringify(el)), sourceId: 'mask-two', documentPosition: el.documentPosition + 0.5 });
  const out = mapSite(ir, { existingSlugs: [] });
  assert.deepEqual(out.report.shapes.map((s) => s.sourceId), [MASK]);
  const skip = out.report.skipped.find((s) => s.sourceId === 'mask-two');
  assert.ok(skip, 'the one that lost is accounted');
  assert.match(skip.reason, /already carries another shape/);
  assert.equal(out.pages[0].sections.filter((s) => s.shapeLayer).length, 1);
  assert.ok(reconciles(out.report.elements), JSON.stringify(out.report.elements));
});

test('a mask whose size was not measured is refused, not guessed to fill its band', () => {
  const ir = JSON.parse(JSON.stringify(IR));
  delete maskElement(ir).el.box;
  const out = mapSite(ir, { existingSlugs: [] });
  const skip = out.report.skipped.find((s) => s.sourceId === MASK);
  assert.ok(skip);
  assert.match(skip.reason, /size .*was not measured/);
  assert.equal(out.pages[0].sections.filter((s) => s.shapeLayer).length, 0);
  assert.ok(reconciles(out.report.elements));
});
