'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const unapplied = require('../../lib/unappliedSql.js');

const NOW = Date.parse('2026-10-28T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const live = (...pairs) => pairs.map((p) => {
  const [table, column] = p.split('.');
  return { table, column };
});

test('create table and add column are what a file declares; constraints are not columns', () => {
  const parsed = unapplied.parseSql(`
    -- create table not_this (id int);
    create table if not exists public.team_invitations (id uuid primary key, email text);
    alter table public.segments add column if not exists segment_type text not null default 'manual';
    alter table if exists public.builder_polls
      add column if not exists external_id text,
      add column personality_system text,
      add constraint builder_polls_ext unique (external_id);
    alter table public.x add primary key (id);
    create or replace function f() returns trigger as $$ begin create table nope (id int); end $$ language plpgsql;
    create table auth.not_public (id int);
  `);
  assert.deepEqual(parsed.tables, ['team_invitations']);
  assert.deepEqual(parsed.columns, [
    { table: 'segments', column: 'segment_type' },
    { table: 'builder_polls', column: 'external_id' },
    { table: 'builder_polls', column: 'personality_system' },
  ]);
});

test('a table renamed in a later file is looked for under its new name (the develop_* → builder_* rename)', () => {
  const { expected } = unapplied.expectedObjects([
    { file: 'a.sql', sql: 'create table public.develop_forms (id int); alter table develop_forms add column title text;' },
    { file: 'b.sql', sql: 'alter table if exists public.develop_forms rename to builder_forms;' },
  ]);
  assert.deepEqual(expected.map(unapplied.describeMissing), ['builder_forms (table)', 'builder_forms.title']);
});

test('a column renamed in a later file is looked for under its new name (messaging_tweets.category → topic)', () => {
  const { expected } = unapplied.expectedObjects([
    { file: 'a.sql', sql: 'alter table public.messaging_tweets add column if not exists category text;' },
    { file: 'b.sql', sql: 'alter table if exists public.messaging_tweets rename column category to topic;' },
  ]);
  assert.deepEqual(expected.map(unapplied.describeMissing), ['messaging_tweets.topic']);
});

test('a table or column a later file drops is not looked for, and is counted as skipped', () => {
  const { expected, superseded } = unapplied.expectedObjects([
    { file: 'a.sql', sql: 'create table old_thing (id int); alter table t add column gone text;' },
    { file: 'b.sql', sql: 'drop table if exists public.old_thing; alter table t drop column if exists gone;' },
  ]);
  assert.deepEqual(expected, []);
  assert.equal(superseded, 2);
});

test('a merged file production lacks is UNAPPLIED and names the file and the object (the 2026-10-28 outreach incident)', () => {
  const { expected } = unapplied.expectedObjects([
    { file: 'browser_view_sessions_setup.sql', sql: 'create table if not exists public.browser_view_sessions (id uuid);' },
    { file: 'segments.sql', sql: 'alter table segments add column segment_type text;' },
  ]);
  const judged = unapplied.judge({ expected, live: live('segments.id', 'segments.segment_type'), explained: {} });
  assert.equal(judged.verdict, unapplied.VERDICT.UNAPPLIED);
  assert.deepEqual(judged.files.map((f) => f.file), ['browser_view_sessions_setup.sql']);
  const decided = unapplied.plan({ judged, state: {}, now: NOW });
  const text = unapplied.renderAlarm({ files: decided.alarm, node: 'mac-mini', at: 'now' });
  assert.match(text, /browser_view_sessions \(table\)/);
  assert.match(text, /blob\/main\/docs\/SQL\/browser_view_sessions_setup\.sql/);
});

test('everything present is OK', () => {
  const { expected } = unapplied.expectedObjects([
    { file: 'segments.sql', sql: 'alter table segments add column segment_type text;' },
  ]);
  const judged = unapplied.judge({ expected, live: live('segments.segment_type'), explained: {} });
  assert.equal(judged.verdict, unapplied.VERDICT.OK);
  assert.equal(unapplied.EXIT[judged.verdict], 0);
});

test('an explained file stops counting but is still reported, with its reason', () => {
  const { expected } = unapplied.expectedObjects([
    { file: 'retired.sql', sql: 'create table retired_thing (id int);' },
  ]);
  const judged = unapplied.judge({ expected, live: live('other.id'), explained: { 'retired.sql': 'reader removed in #1' } });
  assert.equal(judged.verdict, unapplied.VERDICT.OK);
  assert.equal(judged.excused.length, 1);
  assert.equal(judged.excused[0].reason, 'reader removed in #1');
});

test('no reading, or a reading with no tables at all, is CANNOT TELL — never OK', () => {
  const expected = [{ file: 'a.sql', kind: 'table', table: 'a' }];
  const none = unapplied.judge({ expected, live: null, error: 'docker is not running' });
  assert.equal(none.verdict, unapplied.VERDICT.CANNOT_TELL);
  assert.match(none.reason, /docker is not running/);
  assert.equal(unapplied.EXIT[none.verdict], 2);
  const empty = unapplied.judge({ expected, live: [] });
  assert.equal(empty.verdict, unapplied.VERDICT.CANNOT_TELL);
});

test('an unapplied file is named again after a day, not every wake, and cleared once when applied', () => {
  const judged = { verdict: unapplied.VERDICT.UNAPPLIED, files: [{ file: 'a.sql', missing: [] }] };
  const first = unapplied.plan({ judged, state: {}, now: NOW });
  assert.equal(first.alarm.length, 1);
  const tenMinutes = unapplied.plan({ judged, state: first.next, now: NOW + 10 * 60 * 1000 });
  assert.equal(tenMinutes.alarm.length, 0);
  const nextDay = unapplied.plan({ judged, state: first.next, now: NOW + 25 * HOUR });
  assert.equal(nextDay.alarm.length, 1);
  const applied = unapplied.plan({ judged: { verdict: unapplied.VERDICT.OK, files: [], checked: ['a.sql'] }, state: first.next, now: NOW + HOUR });
  assert.deepEqual(applied.cleared, ['a.sql']);
  assert.deepEqual(applied.next.alarmed, {});
});

test('a named file that is now EXPLAINED is never reported as on production', () => {
  const state = { alarmed: { 'a.sql': new Date(NOW).toISOString(), 'b.sql': new Date(NOW).toISOString() } };
  const judged = {
    verdict: unapplied.VERDICT.OK,
    files: [],
    checked: ['a.sql', 'b.sql'],
    excused: [{ file: 'a.sql', missing: [{ kind: 'table', table: 'a' }], reason: 'retired with the old builder' }],
  };
  const decided = unapplied.plan({ judged, state, now: NOW + HOUR });
  assert.deepEqual(decided.cleared, ['b.sql']);
  assert.deepEqual(decided.explained.map((f) => f.file), ['a.sql']);
  assert.deepEqual(decided.next.alarmed, {});
  assert.ok(!unapplied.renderClear({ files: decided.cleared, node: 'n', at: 't' }).includes('a.sql'));
  const text = unapplied.renderExplained({ files: decided.explained, node: 'n', at: 't' });
  assert.match(text, /NOT on production/);
  assert.match(text, /a\.sql — retired with the old builder/);
});

test('a named file DELETED from docs/SQL is never reported as on production', () => {
  const state = { alarmed: { 'retired_thing.sql': new Date(NOW).toISOString(), 'b.sql': new Date(NOW).toISOString() } };
  const { expected } = unapplied.expectedObjects([{ file: 'b.sql', sql: 'create table if not exists b (id int);' }]);
  const judged = unapplied.judge({ expected, live: live('b.id'), explained: {}, present: ['b.sql'] });
  assert.deepEqual(judged.checked, ['b.sql']);
  const decided = unapplied.plan({ judged, state, now: NOW + HOUR });
  assert.deepEqual(decided.cleared, ['b.sql']);
  assert.deepEqual(decided.dropped, [{ file: 'retired_thing.sql', reason: 'it is no longer in docs/SQL' }]);
  assert.deepEqual(decided.next.alarmed, {});
  assert.ok(!unapplied.renderClear({ files: decided.cleared, node: 'n', at: 't' }).includes('retired_thing'));
  const text = unapplied.renderDropped({ files: decided.dropped, node: 'n', at: 't' });
  assert.match(text, /never confirmed on production/);
  assert.match(text, /retired_thing\.sql — it is no longer in docs\/SQL/);
});

test('a file whose tables a later file drops is not reported as on production either', () => {
  const state = { alarmed: { 'a.sql': new Date(NOW).toISOString() } };
  const { expected } = unapplied.expectedObjects([
    { file: 'a.sql', sql: 'create table if not exists a (id int);' },
    { file: 'z.sql', sql: 'drop table if exists a;' },
  ]);
  const judged = unapplied.judge({ expected, live: live('other.id'), explained: {}, present: ['a.sql', 'z.sql'] });
  const decided = unapplied.plan({ judged, state, now: NOW + HOUR });
  assert.deepEqual(decided.cleared, []);
  assert.deepEqual(decided.dropped.map((f) => f.reason), ['a later docs/SQL file drops everything it declared']);
});

test('a reading that does not say what it checked clears nothing', () => {
  const state = { alarmed: { 'a.sql': new Date(NOW).toISOString() } };
  const decided = unapplied.plan({ judged: { verdict: unapplied.VERDICT.OK, files: [] }, state, now: NOW + HOUR });
  assert.deepEqual(decided.cleared, []);
  assert.equal(decided.dropped.length, 1);
});

test('CANNOT TELL keeps the memory of what was named, and repeats at most every 6h', () => {
  const state = { alarmed: { 'a.sql': new Date(NOW).toISOString() } };
  const judged = { verdict: unapplied.VERDICT.CANNOT_TELL, files: [], reason: 'x' };
  const first = unapplied.plan({ judged, state, now: NOW });
  assert.equal(first.cannotTell, true);
  assert.deepEqual(first.cleared, []);
  assert.ok(first.next.alarmed['a.sql']);
  const soon = unapplied.plan({ judged, state: first.next, now: NOW + HOUR });
  assert.equal(soon.cannotTell, false);
});

test('every EXPLAINED entry names a file that exists in docs/SQL', () => {
  const dir = path.join(__dirname, '..', '..', 'docs', 'SQL');
  for (const file of Object.keys(unapplied.EXPLAINED)) {
    assert.ok(fs.existsSync(path.join(dir, file)), `EXPLAINED names ${file}, which is not in docs/SQL`);
    assert.ok(String(unapplied.EXPLAINED[file]).length > 20, `EXPLAINED[${file}] needs a real reason`);
  }
});

test('the relay runs the check on its wake', () => {
  const relay = fs.readFileSync(path.join(__dirname, '..', 'run_bus_relay.sh'), 'utf8');
  assert.match(relay, /npm run --silent sql:unapplied -- --check \|\| true/);
});
