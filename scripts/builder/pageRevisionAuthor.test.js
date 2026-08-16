'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  describeActor,
  rejectedOptionalColumns,
  stripColumns,
} = require('../../lib/builderPageRevisionsStore');

/**
 * Who saved each page revision.
 *
 * Why it exists: on 2026-08-15 the Delray home page history showed five
 * consecutive rows all reading "41 sections · 84 modules". Every one of them
 * was accurate and none of them helped — working out which version belonged to
 * which person meant pulling layout JSON out of production and diffing it by
 * hand. A name on the row answers it at a glance.
 *
 * The properties that matter, and what breaks if each regresses:
 *
 *  - a project-admin session (no display name, only an email) is still
 *    credited, or every tenant-side save records as anonymous
 *  - the write survives a database WITHOUT the saved_by columns, or every
 *    deployment that has not run the migration silently stops recording
 *    history entirely — trading a cosmetic gap for the actual safety net
 *  - stripping removes ONLY the author columns, or the retry drops the
 *    layout it was supposed to be preserving
 */

test('a platform user is credited by display name', () => {
  const actor = describeActor({ id: 'usr_1', name: 'Rich Kaplan', email: 'rich@example.com' });
  assert.equal(actor.id, 'usr_1');
  assert.equal(actor.name, 'Rich Kaplan');
});

test('a project-admin session with no name falls back to its email', () => {
  // routes/index.js builds this shape for tenant admin sessions: id, email,
  // role — and no name at all.
  const actor = describeActor({ id: 'admin_9', email: 'brandon@example.com', role: 'admin' });
  assert.equal(actor.id, 'admin_9');
  assert.equal(actor.name, 'brandon@example.com');
});

test('an unauthenticated write records no author rather than inventing one', () => {
  assert.deepEqual(describeActor(null), { id: '', name: '' });
  assert.deepEqual(describeActor(undefined), { id: '', name: '' });
  assert.deepEqual(describeActor('nonsense'), { id: '', name: '' });
});

test('a database without the saved_by columns is detected from the error', () => {
  assert.deepEqual(
    rejectedOptionalColumns({ error: "column builder_page_revisions.saved_by does not exist" }),
    ['saved_by']
  );
  assert.deepEqual(
    rejectedOptionalColumns({ error: "column builder_page_revisions.saved_by_name does not exist" }),
    ['saved_by_name']
  );
});

test('an unrelated failure is NOT treated as a missing column', () => {
  // Retrying an unrelated failure without the author columns would hide the
  // real error and write a revision that silently lost its attribution.
  assert.deepEqual(rejectedOptionalColumns({ error: 'duplicate key value violates unique constraint' }), []);
  assert.deepEqual(rejectedOptionalColumns({}), []);
  assert.deepEqual(rejectedOptionalColumns(null), []);
});

test('stripping drops the author columns and nothing else', () => {
  const row = {
    page_id: 1266,
    saved_by: 'usr_1',
    saved_by_name: 'Rich Kaplan',
    layout_sections: '[{"id":"s1"}]',
    section_count: 41,
    module_count: 84,
    reason: 'save',
  };
  const stripped = stripColumns(row, ['saved_by', 'saved_by_name']);
  assert.ok(!('saved_by' in stripped));
  assert.ok(!('saved_by_name' in stripped));
  assert.equal(stripped.layout_sections, '[{"id":"s1"}]', 'the layout must survive the retry');
  assert.equal(stripped.section_count, 41);
  assert.equal(stripped.module_count, 84);
  assert.equal(stripped.reason, 'save');
  assert.equal(row.saved_by, 'usr_1', 'the original row must not be mutated');
});
