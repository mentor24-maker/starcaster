'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildLandingPagePatch } = require('../../routes/builder');
const { inputToRow, rowToPage } = require('../../lib/builderPagesStore');
const {
  PAGE_SEARCH_PRIORITIES,
  normalizePageSearchPriority,
} = require('../../lib/builder-client/page-search-priority');

/**
 * Per-page Site Search ranking, tested along the whole path it has to survive:
 *
 *   editor payload -> buildLandingPagePatch -> inputToRow -> row -> rowToPage
 *
 * Every one of those is a place a new field disappears without an error.
 * `buildLandingPagePatch` is a WHITELIST: a field it does not name is dropped,
 * the PATCH still returns 200, and the control looks like it saved. That is
 * the failure this file exists to prevent.
 */

test('the five rungs are the ones the UI offers', () => {
  assert.deepEqual(
    PAGE_SEARCH_PRIORITIES.map((p) => p.value),
    ['pinned', 'boosted', 'normal', 'lowered', 'hidden']
  );
  for (const rung of PAGE_SEARCH_PRIORITIES) {
    assert.ok(rung.label, `${rung.value} needs a label`);
    assert.ok(rung.hint, `${rung.value} needs a hint`);
  }
});

test('unset, empty and unrecognised all mean normal — this is what skips the backfill', () => {
  for (const value of [undefined, null, '', '   ', 'urgent', 42, {}]) {
    assert.equal(normalizePageSearchPriority(value), 'normal', String(value));
  }
});

test('the route whitelist carries searchPriority instead of dropping it', () => {
  const { patch } = buildLandingPagePatch({ searchPriority: 'pinned' });
  assert.equal(patch.searchPriority, 'pinned');

  // snake_case too, matching every other field on this patch.
  assert.equal(buildLandingPagePatch({ search_priority: 'hidden' }).patch.searchPriority, 'hidden');
});

test('a payload that never mentions it leaves it untouched', () => {
  // Partial updates must not reset a ranking the operator already set.
  const { patch } = buildLandingPagePatch({ name: 'Pricing' });
  assert.ok(!('searchPriority' in patch));
});

test('the store writes the column, normalising on the way in', () => {
  assert.equal(inputToRow({ searchPriority: 'boosted' }, { partial: true }).search_priority, 'boosted');
  assert.equal(inputToRow({ searchPriority: 'NONSENSE' }, { partial: true }).search_priority, 'normal');
  // Absent from a partial update means absent from the row — not reset.
  assert.ok(!('search_priority' in inputToRow({ name: 'x' }, { partial: true })));
});

test('the store reads the column back, and copes with it not existing yet', () => {
  assert.equal(rowToPage({ id: 1, search_priority: 'lowered' }).searchPriority, 'lowered');
  // Before docs/SQL/page_search_priority.sql is applied the column is absent.
  assert.equal(rowToPage({ id: 1 }).searchPriority, 'normal');
  assert.equal(rowToPage({ id: 1, search_priority: null }).searchPriority, 'normal');
});

test('the whole path holds, for every rung', () => {
  for (const { value } of PAGE_SEARCH_PRIORITIES) {
    const { patch } = buildLandingPagePatch({ searchPriority: value });
    const row = inputToRow(patch, { partial: true });
    assert.equal(rowToPage({ id: 1, ...row }).searchPriority, value, value);
  }
});
