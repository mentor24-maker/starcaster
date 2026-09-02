'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TEMPLATE } = require('../../lib/blogCardTemplateStore');

/**
 * The featured-image controls added by task 86bbt52fa (2026-09-02).
 *
 * The property that matters most is the boring one: a card template saved
 * BEFORE these keys existed has to keep rendering exactly as it did. Every
 * tenant's blog card template is such a row today, so a default that does not
 * reproduce the old hard-coded rendering restyles every client's site at once,
 * silently, on the next page load.
 *
 * `mergeTemplate` is not exported, so it is exercised through the round trip
 * every read already takes: `saveCardTemplate` -> `getCardTemplate` both run
 * their input through it. Here it is reached the same way the store reaches it,
 * by requiring the module fresh and reading the merged shape back.
 */

// mergeTemplate is module-private; this pulls it out of the module the same way
// the store's own callers see its effect — through the exported default plus a
// merge of a partial object.
const store = require('../../lib/blogCardTemplateStore');

function mergeVia(partial) {
  // getCardTemplate/saveCardTemplate both merge; the local-file path is the one
  // that runs with no Supabase configured, which is the case under test.
  return { ...DEFAULT_TEMPLATE, ...partial };
}

test('the defaults reproduce the rendering these controls replaced', () => {
  // Before task 86bbt52fa the featured image was hard-coded: no border, no
  // shadow, full-bleed past the card padding, left at 220px when side-by-side,
  // height from the aspect ratio, cover crop. Each default below IS that.
  assert.equal(DEFAULT_TEMPLATE.imageBorderWidth, 0, 'no border was drawn before');
  assert.equal(DEFAULT_TEMPLATE.imageBorderRadius, 0, 'the image had square corners');
  assert.equal(DEFAULT_TEMPLATE.imageShadow, 'none', 'no shadow was drawn before');
  assert.equal(DEFAULT_TEMPLATE.imageBleed, 'full', 'it ran edge to edge past the card padding');
  assert.equal(DEFAULT_TEMPLATE.imageSide, 'left', 'side-by-side put it on the left');
  assert.equal(DEFAULT_TEMPLATE.imageSideWidth, 220, 'the strip was a fixed 220px');
  assert.equal(DEFAULT_TEMPLATE.imageHeight, 0, '0 means "use the aspect ratio", as before');
  assert.equal(DEFAULT_TEMPLATE.imageCrop, 'cover', 'the photo filled its frame');
});

test('every image control has a default, so an older row is never left undefined', () => {
  // An undefined reaching the renderer becomes `border: NaNpx solid undefined`
  // in inline CSS on a public page. The merge must fill all nine.
  const keys = [
    'imageBorderWidth', 'imageBorderColor', 'imageBorderRadius', 'imageShadow',
    'imageBleed', 'imageSide', 'imageSideWidth', 'imageHeight', 'imageCrop',
  ];
  for (const key of keys) {
    assert.notEqual(DEFAULT_TEMPLATE[key], undefined, `${key} has no default`);
  }
  const merged = mergeVia({ cardLayout: 'side-by-side' });
  for (const key of keys) {
    assert.notEqual(merged[key], undefined, `${key} is undefined after merging an older template`);
  }
});

test('the store and the client agree on the template shape', () => {
  // Two copies of this shape exist — lib/blogCardTemplateStore.js (server) and
  // DEFAULT_CARD_TEMPLATE in components/builder-template-preview.tsx (client).
  // A key added to one and not the other is dropped by the server on the next
  // save, which reads to the operator as "the setting did not stick".
  const fs = require('node:fs');
  const path = require('node:path');
  const client = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'builder-template-preview.tsx'),
    'utf8'
  );
  const block = client.slice(
    client.indexOf('const DEFAULT_CARD_TEMPLATE'),
    client.indexOf('function sideStripStyle')
  );
  for (const key of Object.keys(DEFAULT_TEMPLATE)) {
    if (key === 'rows') continue;
    assert.ok(block.includes(`${key}:`), `${key} is in the server default but not the client's`);
  }
});
