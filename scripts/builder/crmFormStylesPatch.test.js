'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mergeCrmFormStylesPatch } = require('../../lib/crmFormStyles.js');
const { resolveStylesPatch } = require('../../lib/crmFormsStore.js');

/**
 * Ticket 86bcgcnkw, 2026-10-10: a Padding change made in the Builder put every
 * colour on a CRM form back to its default. The Builder's Form Appearance
 * panel PUT the whole styles object it had loaded when it opened, so colours
 * saved in the CRM editor since then were overwritten with the old copy.
 *
 * The panel now sends `stylesPatch` — only what changed — and the store merges
 * it onto the row it has just read inside the same update. These pin both
 * halves of that: the merge, and the route actually passing it through.
 */

const SAVED_IN_CRM_EDITOR = {
  headingColor: 'theme:secondary',
  buttonBackgroundColor: 'theme:secondary',
  buttonBackgroundColorOpacity: '50',
  backgroundColor: '#ff3300',
  padding: '18px',
};

test('a patch changes only the keys it names and keeps every saved colour', () => {
  const merged = mergeCrmFormStylesPatch(SAVED_IN_CRM_EDITOR, { padding: '15px' });
  assert.equal(merged.padding, '15px');
  assert.equal(merged.headingColor, 'theme:secondary');
  assert.equal(merged.buttonBackgroundColor, 'theme:secondary');
  assert.equal(merged.buttonBackgroundColorOpacity, '50');
  assert.equal(merged.backgroundColor, '#ff3300');
});

test('keys that are not form styles are dropped, not stored', () => {
  const merged = mergeCrmFormStylesPatch(SAVED_IN_CRM_EDITOR, { padding: '15px', evil: 'x' });
  assert.equal('evil' in merged, false);
});

test('the store turns a stylesPatch into full styles from the row it holds now', () => {
  const existing = { accentColor: '#1DC3FF', styles: SAVED_IN_CRM_EDITOR };
  const input = resolveStylesPatch({ stylesPatch: { borderSize: '2px' } }, existing);
  assert.equal('stylesPatch' in input, false);
  assert.equal(input.styles.borderSize, '2px');
  assert.equal(input.styles.headingColor, 'theme:secondary');
  assert.equal(input.styles.backgroundColor, '#ff3300');
});

test('a whole styles object still wins when the CRM editor sends one', () => {
  const existing = { styles: SAVED_IN_CRM_EDITOR };
  const whole = { headingColor: 'theme:accent' };
  const input = resolveStylesPatch({ styles: whole, stylesPatch: { padding: '1px' } }, existing);
  assert.equal(input.styles, whole);
});

test('the PUT route hands stylesPatch to the store', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'crm.js'), 'utf8');
  assert.match(source, /patch\.stylesPatch\s*=\s*body\.stylesPatch/);
});
