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
  const start = SRC.indexOf(`  function ${name}(`);
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
