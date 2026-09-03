'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { slugify, resolveUniqueSlug } = require('../../lib/slugify');

/**
 * A slug is the address a visitor reaches a post at. Five of Delray's
 * published posts had none (86bbu23n7): the Create Post form said
 * "auto-generated if blank" and the store wrote the empty string it was
 * handed, so the rows existed, the manager listed them, and every link went
 * nowhere. Nothing failed and nothing said so.
 *
 * The rule (operator, 2026-09-03): lowercase, spaces to dashes, and nothing
 * but letters, numbers and dashes survives.
 */

test('the rule: lowercase, spaces to dashes, nothing else survives', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('ALL CAPS TITLE'), 'all-caps-title');
  assert.equal(slugify('Rock & Roll!'), 'rock-roll');
  assert.equal(slugify('10 Tennis Tips: Doubles'), '10-tennis-tips-doubles');
  assert.equal(slugify('already-a-slug'), 'already-a-slug');
});

test('runs collapse and the ends are trimmed', () => {
  // "rock--roll-" is not an address anybody would type.
  assert.equal(slugify('HELLO   WORLD'), 'hello-world');
  assert.equal(slugify('  --Trim--  '), 'trim');
  assert.equal(slugify('a...b'), 'a-b');
});

test('apostrophes close up instead of splitting the word', () => {
  // "player-s-guide" reads as a typo; WordPress drops the apostrophe too.
  assert.equal(slugify("The Tennis Player's Guide"), 'the-tennis-players-guide');
  assert.equal(slugify('The Tennis Player\u2019s Guide'), 'the-tennis-players-guide');
  assert.equal(slugify("don't stop"), 'dont-stop');
});

test('accents fold to their base letter rather than vanishing', () => {
  // Dropping the letter loses the word: "Café" would be "caf".
  assert.equal(slugify('Café Münster'), 'cafe-munster');
  assert.equal(slugify('Ünïcôdé'), 'unicode');
});

test('nothing usable in, nothing out — and never a crash', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify(undefined), '');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify(123), '123');
});

test('slugify is idempotent — running it twice changes nothing', () => {
  // The backfill and every save re-normalize existing values, so a second
  // pass must be a no-op or slugs would drift on every edit.
  for (const input of ['Hello World', 'Rock & Roll!', 'Café', '  --x--  ']) {
    assert.equal(slugify(slugify(input)), slugify(input), `not idempotent for ${input}`);
  }
});

// ── resolveUniqueSlug ──

/** A stand-in for the store lookup: these slugs are already taken. */
const takenBy = (map) => async (slug) => (map[slug] ? { id: map[slug] } : null);

test('a blank slug is derived from the title, never left empty', () => {
  return resolveUniqueSlug('', 'My First Post', takenBy({})).then((slug) => {
    assert.equal(slug, 'my-first-post');
  });
});

test('a given slug wins over the title, but is still normalized', async () => {
  const slug = await resolveUniqueSlug('My CHOSEN Address!', 'Some Other Title', takenBy({}));
  assert.equal(slug, 'my-chosen-address');
});

test('a collision is suffixed rather than left to the database', async () => {
  const slug = await resolveUniqueSlug('', 'Repeat Title', takenBy({ 'repeat-title': 'post_1' }));
  assert.equal(slug, 'repeat-title-2');
});

test('a record keeps its own slug when it is the one being updated', async () => {
  const slug = await resolveUniqueSlug('repeat-title', 'Repeat Title', takenBy({ 'repeat-title': 'post_1' }), 'post_1');
  assert.equal(slug, 'repeat-title', 'updating a post renamed its own address out from under it');
});

test('no title and no slug yields empty rather than a made-up address', async () => {
  // Deliberate: an invented address is worse than an obvious gap, and the
  // backfill reports these rather than guessing.
  assert.equal(await resolveUniqueSlug('', '', takenBy({})), '');
  assert.equal(await resolveUniqueSlug('!!!', '???', takenBy({})), '');
});

test('the collision search is bounded and still returns something usable', async () => {
  // Every candidate taken: it must stop guessing rather than loop forever,
  // and what it returns must still be a valid slug.
  const alwaysTaken = async () => ({ id: 'someone-else' });
  const slug = await resolveUniqueSlug('', 'Busy Title', alwaysTaken);
  assert.ok(slug.startsWith('busy-title-'), `unexpected fallback: ${slug}`);
  assert.equal(slug, slugify(slug), 'the fallback is not itself a valid slug');
});
