'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  rejectedOptionalColumns,
  stripColumns,
} = require('../../lib/builderPageRevisionsStore');
const pagesStore = require('../../lib/builderPagesStore');
const routeBuilder = require('../../routes/builder');

/**
 * Grouped undo for a shared-section push.
 *
 * Saving a shared section rewrites it on every page that uses it. Each rewrite
 * already banks a restore point, so nothing is lost — but until now the rows
 * had no thread connecting them, so undoing one push meant finding and
 * restoring every affected page by hand: 46 on 2026-07-21 (Marinoff), 35 on
 * 2026-08-15 (Delray).
 *
 * The propagation_run_id column shipped in PR #254 and was applied in
 * production, but nothing wrote it and nothing read it. This makes it work.
 *
 * The properties that matter, and what breaks if each regresses:
 *
 *  - an ORDINARY save leaves the column empty (a NULL means "not part of a
 *    fan-out", and an undo that swept up unrelated single-page saves would be
 *    far worse than no undo)
 *  - the column is in the optional set, so a deployment without the migration
 *    still records history rather than losing it
 *  - the undo endpoint exists and is reachable
 */

test('propagateCanonicalSection is exported and takes an options argument', () => {
  assert.equal(typeof pagesStore.propagateCanonicalSection, 'function');
  // (savedSectionId, updatedSection, scope, options)
  assert.equal(pagesStore.propagateCanonicalSection.length, 3, 'options is defaulted, so arity is 3');
});

test('a propagation with nothing to do reports an empty run id', async () => {
  const result = await pagesStore.propagateCanonicalSection('', null, null);
  assert.equal(result.ok, false);
  assert.equal(result.runId, '', 'no writes happened, so there is no run to undo');
});

test('propagation_run_id is one of the optional columns', () => {
  // It must fall back like saved_by and change_summary: a deployment that has
  // not run the migration keeps recording history, just without the grouping.
  assert.deepEqual(
    rejectedOptionalColumns({
      error: 'column builder_page_revisions.propagation_run_id does not exist',
    }),
    ['propagation_run_id']
  );
});

test('stripping the run id leaves the revision itself intact', () => {
  const row = {
    page_id: 1266,
    propagation_run_id: 'run-abc',
    layout_sections: '[{"id":"s1"}]',
    reason: 'propagate',
    saved_by_name: 'Rich Kaplan',
  };
  const stripped = stripColumns(row, ['propagation_run_id']);
  assert.ok(!('propagation_run_id' in stripped));
  assert.equal(stripped.layout_sections, '[{"id":"s1"}]', 'the layout must survive the retry');
  assert.equal(stripped.reason, 'propagate');
  assert.equal(stripped.saved_by_name, 'Rich Kaplan');
});

test('the undo endpoint is declared on the builder route module', () => {
  assert.equal(typeof routeBuilder.handle, 'function');
  const source = require('node:fs').readFileSync(
    require.resolve('../../routes/builder.js'),
    'utf8'
  );
  assert.ok(
    source.includes('propagation-runs'),
    'POST /api/builder/propagation-runs/:runId/undo must exist'
  );
  assert.ok(
    source.includes('failedCount'),
    'the undo must report how many pages it could NOT restore — a partial run ' +
      'that claims success is the PR #21 failure repeating'
  );
});
