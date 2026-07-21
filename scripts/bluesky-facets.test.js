'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildLinkFacets, firstLinkInText } = require('../lib/blueskyClient');

test('no links yields no facets', () => {
  assert.deepEqual(buildLinkFacets('Just some text, no link here.'), []);
  assert.deepEqual(buildLinkFacets(''), []);
  assert.equal(firstLinkInText('nothing'), '');
});

test('single link gets correct UTF-8 byte offsets', () => {
  const text = 'Read it: https://daneofearth.com/launch';
  const facets = buildLinkFacets(text);
  assert.equal(facets.length, 1);
  const { index, features } = facets[0];
  const uri = 'https://daneofearth.com/launch';
  assert.equal(features[0].$type, 'app.bsky.richtext.facet#link');
  assert.equal(features[0].uri, uri);
  // Offsets must slice back to exactly the URL.
  const bytes = Buffer.from(text, 'utf8');
  assert.equal(bytes.slice(index.byteStart, index.byteEnd).toString('utf8'), uri);
});

test('multibyte emoji before a link shifts byte offsets past char offsets', () => {
  const text = '🚀 launch day https://daneofearth.com';
  const facets = buildLinkFacets(text);
  assert.equal(facets.length, 1);
  const { index } = facets[0];
  const bytes = Buffer.from(text, 'utf8');
  assert.equal(bytes.slice(index.byteStart, index.byteEnd).toString('utf8'), 'https://daneofearth.com');
  // The rocket emoji is 4 UTF-8 bytes, so byteStart must exceed the char index.
  assert.ok(index.byteStart > text.indexOf('https'));
});

test('trailing sentence punctuation is trimmed from the link', () => {
  const facets = buildLinkFacets('Out now (https://daneofearth.com/launch).');
  assert.equal(facets.length, 1);
  assert.equal(facets[0].features[0].uri, 'https://daneofearth.com/launch');
});

test('multiple links each get a facet', () => {
  const text = 'A https://a.com and B http://b.org done';
  const facets = buildLinkFacets(text);
  assert.equal(facets.length, 2);
  assert.equal(facets[0].features[0].uri, 'https://a.com');
  assert.equal(facets[1].features[0].uri, 'http://b.org');
  const bytes = Buffer.from(text, 'utf8');
  for (const f of facets) {
    assert.equal(
      bytes.slice(f.index.byteStart, f.index.byteEnd).toString('utf8'),
      f.features[0].uri
    );
  }
});

test('firstLinkInText returns the first URL only', () => {
  assert.equal(firstLinkInText('go https://a.com then https://b.com'), 'https://a.com');
});
