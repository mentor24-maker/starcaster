'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * The Site Search box has to undo two ambient rules, and this pins the
 * coupling so neither side can drift silently.
 *
 * `legacy.css` styles BARE element selectors — `input, textarea, select` and
 * `button[type="submit"]`. Those were written for admin screens, but they
 * load on published tenant pages too, so every module gets them whether it
 * wants them or not. Two of them landed on the search box at once:
 *
 *   input,textarea,select { margin: 0.3rem 0 }    -> field pushed down 4.8px
 *   button[type=submit]   { align-self: flex-start } -> button pinned to the top
 *
 * Net effect was a 4.8px offset between the field and the button, reported by
 * the operator on 2026-08-12 as "the slight vertical offset". Undoing only one
 * would have halved it and read as a rounding error.
 *
 * Nothing tests CSS in this repo (MODULE_STANDARDS rule 4's incident: a
 * regeneration deleted the CRM modal styles and nobody noticed for a month).
 * This is the cheapest guard that would catch a well-meaning tidy-up of rules
 * whose purpose is not visible from the declaration alone.
 */

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const OVERRIDES = 'src/css/_builder-react-overrides.css';
const LEGACY = 'src/css/legacy.css';

/** The declaration block for a selector, or null. */
function ruleFor(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  return css.slice(open + 1, close);
}

test('the field cancels the ambient input margin', () => {
  const rule = ruleFor(read(OVERRIDES), '.builder-react-root .builder-site-search-input {');
  assert.ok(rule, 'the input rule should exist');
  assert.match(
    rule,
    /margin:\s*0\s*;/,
    'without margin:0 the field sits 4.8px below the button (legacy.css input margin)'
  );
});

test('the button rejoins the row it was opting out of', () => {
  const rule = ruleFor(read(OVERRIDES), '.builder-react-root .builder-site-search-submit {');
  assert.ok(rule, 'the submit rule should exist');
  assert.match(
    rule,
    /align-self:\s*center\s*;/,
    'without align-self the button obeys legacy.css button[type=submit] and pins to the top'
  );
});

test('the form still asks for centred items, which the button now honours', () => {
  const rule = ruleFor(read(OVERRIDES), '.builder-react-root .builder-site-search-form {');
  assert.ok(rule);
  assert.match(rule, /align-items:\s*center/);
});

test('the ambient rules being undone still exist — if not, the overrides are removable', () => {
  const legacy = read(LEGACY);
  // Not a failure of Site Search if these ever go; a signal that the two
  // overrides above have become dead weight and can be deleted with them.
  assert.match(
    legacy,
    /input,\s*\n\s*textarea,\s*\n\s*select\s*\{[^}]*margin:\s*0\.3rem 0/,
    'legacy.css no longer sets a block margin on bare inputs — the override in ' +
      OVERRIDES + ' can go too'
  );
  assert.match(
    legacy,
    /button\[type="submit"\]\s*\{[^}]*align-self:\s*flex-start/,
    'legacy.css no longer pins submit buttons — the override in ' + OVERRIDES + ' can go too'
  );
});
