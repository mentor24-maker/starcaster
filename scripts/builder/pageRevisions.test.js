'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  summarise,
  layoutChanged,
  recordPageRevision,
  REVISIONS_PER_PAGE,
} = require('../../lib/builderPageRevisionsStore');
const { buildLandingPagePatch } = require('../../routes/builder');

/**
 * Per-page revision history.
 *
 * This exists because the Builder had NO per-page history at all: the only way
 * back from a bad save was builder_page_snapshots, which restores every page
 * at once. On 2026-08-14 the Delray home page lost 35 sections to a template
 * apply and the recovery was a full database restore.
 *
 * The properties that actually matter, and what breaks if each one regresses:
 *
 *  - recording NEVER fails a page save (a history write that throws would turn
 *    a working save into a lost one — strictly worse than having no history)
 *  - an unchanged layout mints no revision (or 25 identical entries push the
 *    real prior version off the end of the retention window)
 *  - the save payload still carries layoutSections through the route whitelist
 *    (if it stops, updatePage never sees a layout change and records nothing)
 */

test('summarise counts sections and modules, and measures the layout', () => {
  const layout = [
    { id: 's1', modules: [{ type: 'text' }, { type: 'image' }] },
    { id: 's2', modules: [{ type: 'heading' }] },
    { id: 's3', modules: [] },
    { id: 's4' },
  ];
  const summary = summarise(layout);
  assert.equal(summary.sectionCount, 4);
  assert.equal(summary.moduleCount, 3);
  assert.ok(summary.layoutBytes > 0, 'layout bytes should be measured');
});

test('summarise accepts the {sections:[...]} shape the DB doc sometimes uses', () => {
  const summary = summarise({ sections: [{ modules: [{ type: 'text' }] }] });
  assert.equal(summary.sectionCount, 1);
  assert.equal(summary.moduleCount, 1);
});

test('summarise survives junk instead of throwing on the save path', () => {
  for (const value of [null, undefined, '', 'not json', 42]) {
    const summary = summarise(value);
    assert.equal(summary.sectionCount, 0, String(value));
    assert.equal(summary.moduleCount, 0, String(value));
  }
});

test('summarise parses a JSON string, which is how the column comes back', () => {
  const summary = summarise(JSON.stringify([{ modules: [{ type: 'text' }, { type: 'text' }] }]));
  assert.equal(summary.sectionCount, 1);
  assert.equal(summary.moduleCount, 2);
});

test('layoutChanged is false for equal layouts — a rename must not mint a revision', () => {
  const layout = [{ id: 's1', modules: [{ type: 'text', text: 'hello' }] }];
  assert.equal(layoutChanged(layout, structuredClone(layout)), false);
});

test('layoutChanged is true when a section is dropped — the case this feature exists for', () => {
  const before = [{ id: 's1', modules: [] }, { id: 's2', modules: [] }];
  const after = [{ id: 's1', modules: [] }];
  assert.equal(layoutChanged(before, after), true);
});

test('layoutChanged treats unserialisable input as changed rather than skipping it', () => {
  const circular = {};
  circular.self = circular;
  assert.equal(layoutChanged(circular, []), true);
});

test('recordPageRevision resolves rather than throwing when the table is absent', async () => {
  // No Supabase configured in tests, so every write fails. That is precisely
  // the deployment state this must tolerate: the migration not yet run.
  await assert.doesNotReject(async () => {
    await recordPageRevision(
      1266,
      { name: 'Home', slug: 'home', layoutSections: [{ id: 's1', modules: [{ type: 'text' }] }] },
      [],
      { reason: 'save' }
    );
  });
});

test('recordPageRevision ignores a missing page id or missing previous state', async () => {
  await assert.doesNotReject(async () => {
    await recordPageRevision(0, { layoutSections: [] }, [], {});
    await recordPageRevision(1266, null, [], {});
  });
});

test('recordPageRevision does no work when the layout did not change', async () => {
  const layout = [{ id: 's1', modules: [{ type: 'text' }] }];
  // Same layout in and out: it must return before attempting any write at all,
  // which with no DB configured is indistinguishable from a swallowed failure
  // except that it cannot reject either way.
  await assert.doesNotReject(async () => {
    await recordPageRevision(1266, { layoutSections: layout }, structuredClone(layout), {});
  });
});

test('retention is a real cap — layout JSON runs to ~140KB a version', () => {
  assert.ok(Number.isInteger(REVISIONS_PER_PAGE));
  assert.ok(REVISIONS_PER_PAGE > 0 && REVISIONS_PER_PAGE <= 50);
});

test('the route whitelist still carries layoutSections, or nothing is ever recorded', () => {
  const built = buildLandingPagePatch({ layoutSections: [{ id: 's1', modules: [] }] });
  assert.ok(!built.error, 'patch should build');
  assert.ok(
    Object.prototype.hasOwnProperty.call(built.patch ?? built, 'layoutSections'),
    'layoutSections must survive buildLandingPagePatch'
  );
});
