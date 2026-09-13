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

test('every colour control gets a custom colour picker that writes the hex to the saved input', () => {
  const bind = lift('bindFormColorPickers');
  assert.match(bind, /picker\.type = 'color'/);
  assert.match(bind, /input\.value = safeText\(customPicker\.value\)\.toLowerCase\(\);/);
  assert.match(bind, /input\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/, 'the preview listens for change');
});
