'use strict';

const assert = require('assert');
const {
  firstStatement,
  countWords,
  formatFilenameAsHeadline,
  resolveHeadlineFromTweetContent,
  resolveHeadlineFromImageAsset,
} = require('../lib/headlineImportTransform');

const wyrTweet = 'Would You Rather...? Eat Pizza OR Eat Salad? How do you think most people answered?';
const wyr = resolveHeadlineFromTweetContent(wyrTweet);
assert.strictEqual(wyr.ok, true);
assert.strictEqual(wyr.source, 'wyr');
assert.strictEqual(wyr.content, 'Would You Rather...? Eat Pizza OR Eat Salad?');

const long = resolveHeadlineFromTweetContent(
  'This is a very long first statement that goes on and on without punctuation and definitely exceeds twenty words easily when you keep typing more and more words here'
);
assert.strictEqual(long.ok, false);
assert.strictEqual(long.skipReason, 'too_long');

const short = resolveHeadlineFromTweetContent('Hello world. Second sentence here.');
assert.strictEqual(short.ok, true);
assert.strictEqual(short.source, 'first_statement');
assert.strictEqual(short.content, 'Hello world');

assert.strictEqual(
  formatFilenameAsHeadline('would_you_rather_eat_pizza_or_salad.jpg'),
  'Would You Rather Eat Pizza or Salad'
);

const captioned = resolveHeadlineFromImageAsset({
  assetName: 'ignored_name.jpg',
  caption: 'Custom Caption Line',
});
assert.strictEqual(captioned.ok, true);
assert.strictEqual(captioned.source, 'caption');
assert.strictEqual(captioned.content, 'Custom Caption Line');

const fromName = resolveHeadlineFromImageAsset({ assetName: 'myCoolFeatureBanner.png' });
assert.strictEqual(fromName.ok, true);
assert.strictEqual(fromName.source, 'filename');
assert.ok(fromName.content.includes('Cool'));

console.log('headline import transform tests passed');
