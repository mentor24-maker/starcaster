'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * CRM form editor colour controls (task 86bbzxdf6). The swatches came only from
 * a theme NAMED "Go Navy" (Marinoff's), so in every other project each colour
 * control offered nothing but "None" and read as dead. public/js/crm.js is a
 * browser script with no module exports, so the rule is lifted from its source
 * and run here; the swatches themselves were checked in a real browser.
 */

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'crm.js'), 'utf8');

function lift(name) {
  const plain = SRC.indexOf(`  function ${name}(`);
  const start = plain > -1 ? plain : SRC.indexOf(`  async function ${name}(`);
  assert.ok(start > -1, `${name} is gone from crm.js — re-point this test`);
  const end = SRC.indexOf('\n  }\n', start);
  return SRC.slice(start, end + 4);
}

const safeText = (v) => String(v ?? '').trim();
const pickFormEditorTheme = new Function('safeText', `${lift('pickFormEditorTheme')}; return pickFormEditorTheme;`)(safeText);

test("the editor offers the theme the project's pages use most, whatever it is called", () => {
  const themes = [{ id: 't1', name: 'Delray 1' }, { id: 't2', name: 'Theme Wizard — Scoreboard Green' }];
  const pages = [{ themeId: 't2' }, { theme_id: 't2' }, { themeId: 't1' }, { themeId: '' }];
  assert.equal(pickFormEditorTheme(themes, pages).id, 't2');
});

test('a project whose pages name no theme still gets its first theme, and none means none', () => {
  assert.equal(pickFormEditorTheme([{ id: 'a', name: 'Delray 1' }], []).id, 'a');
  assert.equal(pickFormEditorTheme([], [{ themeId: 'x' }]), null);
});

test('nothing chooses a theme by the name "Go Navy" any more', () => {
  assert.doesNotMatch(SRC, /go\[\\s-\]\*navy/i, 'a name match found nothing in Delray, IZIT and Normie');
});

const THEME_COLOR_FALLBACKS = { 'theme:primary': '#18324a', 'theme:heading': '#18324a' };
const isThemeColorToken = (v) => String(v).startsWith('theme:');
const conversions = new Function('safeText', 'isThemeColorToken', 'THEME_COLOR_FALLBACKS',
  `${lift('pickerColorForSaved')}\n${lift('savedValueForPicked')}; return { pickerColorForSaved, savedValueForPicked };`,
)(safeText, isThemeColorToken, THEME_COLOR_FALLBACKS);
const SWATCHES = [
  { label: 'Primary', token: 'theme:primary', hex: '#0B2D6B' },
  { label: 'Accent', token: 'theme:accent', hex: '#72b62f' },
];

test('the standard picker keeps theme LINKS: a theme colour saves as its token, not as a fixed hex (86bbzxg9c)', () => {
  assert.equal(conversions.savedValueForPicked('#0b2d6b', SWATCHES), 'theme:primary',
    'picking the theme swatch must keep following the theme when its colour changes');
  assert.equal(conversions.savedValueForPicked('#C0392B', SWATCHES), '#c0392b');
});

test('a saved value opens the picker on the colour it stands for', () => {
  assert.equal(conversions.pickerColorForSaved('theme:primary', SWATCHES), '#0b2d6b');
  assert.equal(conversions.pickerColorForSaved('theme:heading', SWATCHES), '#18324a', 'a link the theme lacks shows its fallback');
  assert.equal(conversions.pickerColorForSaved('none', SWATCHES), '');
  assert.equal(conversions.pickerColorForSaved('#abcdef', SWATCHES), '#abcdef');
});

test('every colour control mounts the standard field, and the old row is only the fallback', () => {
  const render = lift('renderStandardColorField');
  assert.match(render, /if \(!bridge \|\| typeof bridge\.mount !== 'function' \|\| !control \|\| !input\) return;/);
  assert.match(render, /bridge\.mount\(host, \{/);
  assert.match(render, /onClear: \(\) => commit\('none'\)/);
  assert.match(lift('syncFormColorPickerUI'), /renderStandardColorField\(inputId\);/);
});

test('a reload on the editor address starts the editor instead of showing a dead page (86bbzxjx4)', () => {
  // Dane hard-refreshed on #page=crmFormEditorPage: no form, no theme, no
  // pickers — every colour control dead and the theme swatches blank. Every
  // earlier test opened the editor through Edit or New Form.
  const start = SRC.indexOf('onPageActivated(targetPageId) {');
  assert.ok(start > -1, 'onPageActivated moved — re-point this test');
  const hook = SRC.slice(start, SRC.indexOf('\n    },', start));
  assert.match(hook, /if \(targetPageId === 'crmFormEditorPage'\) \{\s*if \(!formEditorReady\) return openFormEditorFromAddress\(\);/);
  assert.match(hook, /if \(targetPageId === 'crmPage'\) \{\s*formEditorReady = false;/, 'leaving to the CRM page must make the next editor visit start fresh');
  const fromAddress = lift('openFormEditorFromAddress');
  assert.match(fromAddress, /App\.readHashParam\('crmForm'\)/);
  assert.match(fromAddress, /await openFormEditor\(form\);/);
  assert.match(fromAddress, /await openFormEditor\(null\);/);
  assert.match(lift('openFormEditor'), /formEditorReady = true;\s*\n\s*setActivePage\('crmFormEditorPage'\);/,
    'the flag must be set BEFORE setActivePage, or its own activation re-enters openFormEditorFromAddress');
});

/*
 * SC-866 — Background Color could not be seen to be a control. The shared
 * picker painted its round button with the bare hex behind a 12%-grey
 * hairline, so a white, cleared or half-see-through background was a white
 * circle on a white page. The CRM editor now gives that button a fill that
 * carries the opacity (painted over a checkerboard in _crm.css), and a saved
 * opacity of 0 is no longer read as "not given" and turned back into 100.
 */
const { crmFormStylesToRenderStyles, normalizeCrmFormStyles } = require('../../lib/crmFormStyles.js');

const hexToRgbForTest = new Function('normalizeHexColor', `${lift('hexToRgb')}; return hexToRgb;`)(
  (value, fallback) => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(value)) ? String(value) : fallback),
);
const clampOpacityForTest = new Function(`${lift('clampOpacity')}; return clampOpacity;`)();
const swatchFillForSaved = new Function(
  'pickerColorForSaved', 'clampOpacity', 'hexToRgb',
  `${lift('swatchFillForSaved')}; return swatchFillForSaved;`,
)(conversions.pickerColorForSaved, clampOpacityForTest, hexToRgbForTest);

test('the swatch shows the colour WITH its opacity, and nothing at all once cleared (SC-866)', () => {
  assert.equal(swatchFillForSaved('#3366ff', '50', SWATCHES), 'rgba(51, 102, 255, 0.5)');
  assert.equal(swatchFillForSaved('theme:primary', '100', SWATCHES), 'rgba(11, 45, 107, 1)');
  assert.equal(swatchFillForSaved('#ffffff', '0', SWATCHES), 'rgba(255, 255, 255, 0)');
  assert.equal(swatchFillForSaved('none', '100', SWATCHES), 'transparent');
});

test('the editor paints that fill onto the swatch every time it renders it', () => {
  assert.match(lift('renderStandardColorField'), /host\.style\.setProperty\(\s*'--crm-swatch-fill',\s*swatchFillForSaved\(/);
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'css', '_crm.css'), 'utf8');
  assert.match(css, /\.crm-form-standard-color\[style\*="--crm-swatch-fill"\] \.builder-button-background-swatch \{\s*background:\s*linear-gradient\(var\(--crm-swatch-fill\)/);
  assert.match(css, /\.crm-form-standard-color \.builder-button-background-swatch \{\s*border: 2px solid/, 'the swatch needs an outline a white fill cannot hide');
});

test('the background colour and opacity saved in the editor reach the live form', () => {
  const live = crmFormStylesToRenderStyles({ backgroundColor: '#3366ff', backgroundColorOpacity: '50' });
  assert.equal(live.form.background, 'rgba(51, 102, 255, 0.5)');
  assert.equal(live.cssVars['--crm-form-background'], 'rgba(51, 102, 255, 0.5)');
});

test('opacity 0 means see-through on the live form, whether it arrives as "0" or 0', () => {
  for (const zero of ['0', 0]) {
    assert.equal(normalizeCrmFormStyles({ backgroundColorOpacity: zero }).backgroundColorOpacity, '0', `opacity ${JSON.stringify(zero)}`);
    assert.equal(
      crmFormStylesToRenderStyles({ backgroundColor: '#3366ff', backgroundColorOpacity: zero }).form.background,
      'rgba(51, 102, 255, 0)',
    );
    assert.equal(normalizeCrmFormStyles({ borderColorOpacity: zero }).borderColorOpacity, '0');
    assert.equal(normalizeCrmFormStyles({ button_background_color_opacity: zero }).buttonBackgroundColorOpacity, '0');
  }
});

test('Clear gives the live form no background, and a form that saved nothing is still white', () => {
  assert.equal(crmFormStylesToRenderStyles({ backgroundColor: 'none' }).form.background, 'transparent');
  const untouched = crmFormStylesToRenderStyles({}, '', null);
  assert.equal(untouched.form.background, 'var(--crm-theme-background, #ffffff)');
});

test("the editor's own reading of the styles keeps opacity 0 too", () => {
  assert.match(SRC, /backgroundColorOpacity: clampOpacity\(firstSetOpacity\(source\.backgroundColorOpacity, source\.background_color_opacity\)\)/);
  const firstSetOpacity = new Function(`${lift('firstSetOpacity')}; return firstSetOpacity;`)();
  assert.equal(firstSetOpacity(0, '80'), 0);
  assert.equal(firstSetOpacity(undefined, ''), undefined);
  assert.equal(firstSetOpacity('', '40'), '40');
});
