'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { composePost, countText } = require('../../public/shared/composeXPost.js');

const LONG_URL = 'https://example.com/2026/07/a-very-long-article-slug-that-keeps-going-and-going?utm_source=starcaster&utm_medium=social';

test('a long URL costs 23 characters, so the post still fits', () => {
  const copy = 'A'.repeat(200);
  const result = composePost({
    primaryCopy: copy,
    shareUrl: LONG_URL,
    shortenUrls: true,
  });

  assert.ok(LONG_URL.length > 100, 'fixture URL should be far longer than a t.co link');
  // 200 copy + 2 newlines + 23 for the t.co-wrapped link.
  assert.equal(result.count, 225);
  assert.equal(result.over, false);
  assert.equal(result.urlIncluded, true, 'the link must survive under t.co counting');
});

test('emoji count as two characters near the limit', () => {
  const plain = 'A'.repeat(279);
  assert.equal(countText(plain, true), 279);

  // Same visible length, but one grapheme is an emoji worth 2.
  const withEmoji = 'A'.repeat(278) + '🎉';
  assert.equal(countText(withEmoji, true), 280);

  const overByEmoji = 'A'.repeat(279) + '🎉';
  assert.equal(countText(overByEmoji, true), 281);

  // A multi-code-point emoji is still one grapheme worth 2, not 2 per part.
  assert.equal(countText('👩‍👩‍👧‍👦', true), 2);
});

test('hidden tagline and hashtags still push the post over the limit', () => {
  const visibleCopy = 'B'.repeat(208);
  const withHiddenParts = composePost({
    primaryCopy: visibleCopy,
    tagline: 'C'.repeat(60),
    hashtags: '#launch #starcaster',
    shareUrl: 'https://example.com',
    shortenUrls: true,
  });

  assert.equal(withHiddenParts.over, false, 'components are dropped rather than overflowing');
  assert.equal(withHiddenParts.removedHashtagCount, 2, 'hashtags drop first');
  assert.equal(
    withHiddenParts.urlIncluded,
    false,
    'copy + tagline alone leave no room for the link'
  );

  // Counting only the copy the operator can see would have said "under limit".
  assert.ok(countText(visibleCopy, true) < 280);

  const copyOnly = composePost({
    primaryCopy: visibleCopy,
    shareUrl: 'https://example.com',
    shortenUrls: true,
  });
  assert.equal(copyOnly.urlIncluded, true, 'without the hidden tagline the link fits');
});

test('placeholder labels are not counted as copy', () => {
  const result = composePost({ primaryCopy: 'Tweet', tagline: 'Hello', shortenUrls: true });
  assert.equal(result.text, 'Hello');
});
