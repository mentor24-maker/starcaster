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

const { mapSite, ownColorOnBand, bandHeightFor, styleProseHtml } = require('../../lib/site-import/dist/map.js');

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
