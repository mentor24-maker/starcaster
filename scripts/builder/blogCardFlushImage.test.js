'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PREVIEW = path.join(__dirname, '..', '..', 'components', 'builder-template-preview.tsx');
const source = fs.readFileSync(PREVIEW, 'utf8');

/**
 * THE TEMPLATE'S SLOT ORDER IS NOT THE RENDERED ORDER (2026-09-02, task
 * 86bbtvnr5 — a regression from PR #522).
 *
 * The featured image's full-bleed pull-up used to be unconditional. #522 made it
 * conditional on the image being the first slot IN THE TEMPLATE, so it would
 * stop sliding up under whatever sat above it.
 *
 * Both production card templates are
 * `[["categories"],["featured_image"],["headline"],…]`, and the Delray posts
 * carry no categories — so `categories` renders NULL while still being the first
 * slot. The image was visibly at the top of the card and got no pull-up, leaving
 * the card's 1.125rem top padding as a visible gap, plus the flex column's
 * 0.625rem gap from the empty row that still emitted an element.
 *
 * The fix is NOT to pull up unconditionally again — that reintroduces the
 * sliding #522 fixed. It is to ask about the POST's content instead of the
 * template's shape. These assertions hold that distinction, which is the whole
 * lesson and the easiest thing to lose in a later edit.
 *
 * Source-level, like `blogCardTemplateUpsert.test.js`: the behaviour needs a
 * signed-in browser, a project, a seeded post and a card template, which the
 * node suite has none of. The real proof is the browser check recorded on the
 * ticket; this is what stops it silently reverting.
 */

test('the image pulls up based on what RENDERS, not on template order', () => {
  assert.match(
    source,
    /const firstRenderedSlot\s*=\s*\n?\s*tplRows\.flatMap\(\(r\) => r\.slots\.slice\(0, r\.cols\)\)\.find\(slotRenders\)/,
    'firstRenderedSlot must be found with slotRenders. `.find(Boolean)` picks the '
      + 'first slot the template HOLDS, which is what left a gap above the image '
      + 'on every template opening with an empty categories row.'
  );
  assert.doesNotMatch(
    source,
    /topOfCard: firstFilledSlot/,
    'the old template-order test must be gone, not merely renamed around'
  );
});

test('a row whose slots all render nothing emits no element', () => {
  // An empty row is invisible but still a flex child, so it contributes the
  // column's gap. That was the second half of the gap above the image.
  assert.match(
    source,
    /const hasContent = row\.slots\.slice\(0, row\.cols\)\.some\(slotRenders\);/,
    'row emptiness must be measured against the post, not against whether the '
      + 'row holds a slot id'
  );
  assert.doesNotMatch(
    source,
    /const hasContent = row\.slots\.some\(\(s\) => s &&/,
    'the old shape-only emptiness test must be gone'
  );
});

test('slotRenders answers for every card element, so none defaults to hidden', () => {
  // A missing case falls to `default: return false`, which would silently drop
  // a whole element from every card. Each id must be named.
  const fn = source.slice(source.indexOf('function slotRenders'));
  const body = fn.slice(0, fn.indexOf('\n            }'));
  for (const id of ['categories', 'headline', 'featured_image', 'excerpt', 'author', 'date', 'tags', 'read_more']) {
    assert.ok(body.includes(`case "${id}":`), `slotRenders has no case for ${id}`);
  }
});
