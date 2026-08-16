'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  describeChange,
  rejectedOptionalColumns,
  stripColumns,
} = require('../../lib/builderPageRevisionsStore');

/**
 * What each page revision CHANGED.
 *
 * Why it exists: on 2026-08-15 the Delray home page history showed five
 * consecutive rows reading "41 sections · 84 modules". Every one accurate,
 * none of them useful — the operator had just overwritten a collaborator's
 * work and could not tell which row held it. Working that out took a script
 * that pulled layout JSON out of production and diffed it by hand.
 *
 * The properties that matter, and what breaks if each regresses:
 *
 *  - a MOVED section is not reported as removed-and-added (the history is
 *    where you go when something has gone missing; a false "Removed" there
 *    sends the search in exactly the wrong direction)
 *  - a section with no title still gets a usable name, never "undefined"
 *  - a long list is capped so the row cannot wrap into a wall of names
 *  - the write survives a database missing ANY subset of the optional
 *    columns, since three separate migrations now feed this table
 */

const section = (id, title, extra = {}) => ({ id, title, modules: [], ...extra });

test('adding a section names it', () => {
  const before = [section('a', 'Hero')];
  const after = [section('a', 'Hero'), section('b', 'Events')];
  assert.equal(describeChange(before, after), 'Added "Events"');
});

test('removing a section names it', () => {
  const before = [section('a', 'Hero'), section('b', 'Events')];
  const after = [section('a', 'Hero')];
  assert.equal(describeChange(before, after), 'Removed "Events"');
});

test('THE 2026-08-15 CASE: the save that dropped Delray\'s Events section', () => {
  // The shape of what actually happened: a collaborator's section present in
  // the banked version, absent in what replaced it. This is the row the
  // operator needed to be able to find, and could not.
  const richsVersion = [
    section('hero', 'Hero'),
    section('events', 'Events'),
    section('footer', 'Footer'),
  ];
  const staleOverwrite = [section('hero', 'Hero'), section('footer', 'Footer')];
  assert.equal(describeChange(richsVersion, staleOverwrite), 'Removed "Events"');
});

test('editing a section\'s contents names it, without touching the section list', () => {
  const before = [section('a', 'Hero', { modules: [{ type: 'text', text: 'old' }] })];
  const after = [section('a', 'Hero', { modules: [{ type: 'text', text: 'new' }] })];
  assert.equal(describeChange(before, after), 'Edited "Hero"');
});

test('MOVING a section is reordering, not removal', () => {
  // Tracked by id, not position. Reported as removed-and-added, this would
  // send someone hunting for a section that never left the page.
  const before = [section('a', 'Hero'), section('b', 'Events'), section('c', 'Footer')];
  const after = [section('b', 'Events'), section('a', 'Hero'), section('c', 'Footer')];
  assert.equal(describeChange(before, after), 'Reordered sections');
});

test('an unnamed section falls back to its position, never "undefined"', () => {
  const before = [section('a', 'Hero'), { id: 'b', modules: [] }];
  const after = [section('a', 'Hero')];
  const summary = describeChange(before, after);
  assert.equal(summary, 'Removed "Section 2"');
  assert.ok(!summary.includes('undefined'));
});

test('two changes in one save are both reported', () => {
  const before = [section('a', 'Hero'), section('b', 'Events')];
  const after = [section('a', 'Hero'), section('c', 'Gallery')];
  const summary = describeChange(before, after);
  assert.ok(summary.includes('Added "Gallery"'), summary);
  assert.ok(summary.includes('Removed "Events"'), summary);
});

test('a long list is capped so the row cannot wrap into a wall', () => {
  const before = [];
  const after = ['A', 'B', 'C', 'D', 'E'].map((n, i) => section(`s${i}`, n));
  const summary = describeChange(before, after);
  assert.equal(summary, 'Added "A", "B", "C" and 2 more');
  assert.ok(summary.length < 60, 'must stay on one line');
});

test('an identical layout produces no summary', () => {
  const layout = [section('a', 'Hero')];
  assert.equal(describeChange(layout, layout), '');
});

test('the {sections:[...]} document shape is understood', () => {
  // The DB doc sometimes keys the array this way; sectionsOf handles both and
  // describeChange must go through it rather than assuming a bare array.
  const before = { sections: [section('a', 'Hero'), section('b', 'Events')] };
  const after = { sections: [section('a', 'Hero')] };
  assert.equal(describeChange(before, after), 'Removed "Events"');
});

test('garbage input never throws — a summary must not be able to fail a save', () => {
  assert.doesNotThrow(() => describeChange(null, undefined));
  assert.doesNotThrow(() => describeChange('not json', 42));
  assert.equal(describeChange(null, null), '');
});

test('each optional column is detected independently', () => {
  assert.deepEqual(
    rejectedOptionalColumns({ error: 'column builder_page_revisions.change_summary does not exist' }),
    ['change_summary']
  );
  assert.deepEqual(
    rejectedOptionalColumns({ error: 'column builder_page_revisions.saved_by does not exist' }),
    ['saved_by']
  );
  assert.deepEqual(rejectedOptionalColumns({ error: 'some unrelated failure' }), []);
  assert.deepEqual(rejectedOptionalColumns(null), []);
});

test('saved_by is NOT reported missing just because saved_by_name is', () => {
  // Substring matching said both were missing whenever the longer one was,
  // and the retry then dropped a column the database actually had.
  assert.deepEqual(
    rejectedOptionalColumns({ error: 'column builder_page_revisions.saved_by_name does not exist' }),
    ['saved_by_name']
  );
});

test('stripping removes only the named columns and never mutates the input', () => {
  const row = {
    page_id: 1266,
    saved_by: 'usr_1',
    saved_by_name: 'Rich Kaplan',
    change_summary: 'Removed "Events"',
    layout_sections: '[{"id":"s1"}]',
    section_count: 41,
  };
  const stripped = stripColumns(row, ['change_summary']);
  assert.ok(!('change_summary' in stripped));
  assert.equal(stripped.saved_by_name, 'Rich Kaplan', 'other optional columns survive');
  assert.equal(stripped.layout_sections, '[{"id":"s1"}]', 'the layout must survive');
  assert.equal(row.change_summary, 'Removed "Events"', 'input must not be mutated');
});
