'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeObjectRef,
  objectKey,
  sameObject,
  canonicalPair,
  rowToAssociation,
  associationOtherSide,
} = require('../../lib/objectAssociationsStore.js');

const TWEET = { type: 'messaging_tweets', id: '42', label: 'Launch day tweet' };
const IMAGE = { type: 'asset', id: '88', label: 'Hero image' };

test('the same pair sorts to the same order whichever way it is given', () => {
  const forward = canonicalPair(TWEET, IMAGE);
  const backward = canonicalPair(IMAGE, TWEET);

  assert.equal(forward.ok, true);
  assert.equal(backward.ok, true);
  assert.equal(objectKey(forward.a), objectKey(backward.a));
  assert.equal(objectKey(forward.b), objectKey(backward.b));
  // 'asset:88' sorts before 'messaging_tweets:42'.
  assert.equal(objectKey(forward.a), 'asset:88');
});

test('labels travel with their own side when the pair is reordered', () => {
  const { a, b } = canonicalPair(TWEET, IMAGE);
  assert.equal(a.label, 'Hero image');
  assert.equal(b.label, 'Launch day tweet');
});

test('ids are compared as text, so 10 does not sort before 9', () => {
  const nine = { type: 'asset', id: '9' };
  const ten = { type: 'asset', id: '10' };
  const pair = canonicalPair(nine, ten);
  // Text ordering puts '10' first. What matters is only that it is stable —
  // both directions must agree, which the reversed call proves.
  assert.equal(objectKey(pair.a), 'asset:10');
  assert.equal(objectKey(canonicalPair(ten, nine).a), 'asset:10');
});

test('an object cannot be associated with itself', () => {
  const result = canonicalPair(TWEET, { type: 'messaging_tweets', id: '42' });
  assert.equal(result.ok, false);
  assert.match(result.error, /itself/);
});

test('an unknown object type is rejected rather than silently stored', () => {
  const result = canonicalPair(TWEET, { type: 'messaging_twets', id: '7' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown object type/);
});

test('a missing type or id is rejected', () => {
  assert.equal(canonicalPair(TWEET, { type: 'asset', id: '' }).ok, false);
  assert.equal(canonicalPair(TWEET, { type: '', id: '5' }).ok, false);
  assert.equal(canonicalPair(TWEET, null).ok, false);
});

test('normalizeObjectRef accepts snake_case and trims, or returns null', () => {
  assert.deepEqual(
    normalizeObjectRef({ object_type: '  asset ', object_id: ' 12 ', object_label: ' Logo ' }),
    { type: 'asset', id: '12', label: 'Logo' }
  );
  assert.equal(normalizeObjectRef({ type: 'asset' }), null);
  assert.equal(normalizeObjectRef('asset:12'), null);
});

test('numeric ids from the database normalize to the same key as string ids', () => {
  assert.equal(objectKey(normalizeObjectRef({ type: 'asset', id: 88 })), 'asset:88');
  assert.equal(sameObject(normalizeObjectRef({ type: 'asset', id: 88 }), IMAGE), true);
});

test('a stored row maps back to both sides', () => {
  const association = rowToAssociation({
    id: 5,
    a_type: 'asset',
    a_id: '88',
    a_label: 'Hero image',
    b_type: 'messaging_tweets',
    b_id: '42',
    b_label: 'Launch day tweet',
    created_at: '2026-07-28T00:00:00Z',
  });

  assert.equal(association.id, 5);
  assert.equal(association.a.type, 'asset');
  assert.equal(association.b.id, '42');
});

test('the other side is resolved from whichever end you looked it up by', () => {
  const association = rowToAssociation({
    id: 5,
    a_type: 'asset',
    a_id: '88',
    a_label: 'Hero image',
    b_type: 'messaging_tweets',
    b_id: '42',
    b_label: 'Launch day tweet',
  });

  assert.equal(associationOtherSide(association, TWEET).id, '88');
  assert.equal(associationOtherSide(association, IMAGE).id, '42');
  // An object that is not part of this link resolves to nothing.
  assert.equal(associationOtherSide(association, { type: 'asset', id: '999' }), null);
});
