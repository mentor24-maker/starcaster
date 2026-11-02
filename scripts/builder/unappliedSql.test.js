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

// ── the "SQL waiting for you" ticket (task 86bcwam1k) ────────────────────────

const CREATORS = `-- youtube_creators_setup.sql
-- Outreach wizard 15/19: a list of YouTube creators.
--
-- FEATURE: the YouTube Creators screen shows no creators and Approve does
-- nothing.
create table if not exists youtube_creators (id uuid primary key, project_id text);`;
const CONVERSATIONS = `-- youtube_conversations_setup.sql
-- Outreach wizard 16/19: the comments worth replying to.
--
create table if not exists youtube_conversations (id uuid primary key,
  creator_id uuid references youtube_creators(id));
alter table youtube_creators add column if not exists last_scanned_at timestamptz;`;
const OLDER = `-- segments_type.sql
alter table segments add column if not exists segment_type text;`;

function waitingReading() {
  const files = [
    { file: 'youtube_creators_setup.sql', sql: CREATORS },
    { file: 'youtube_conversations_setup.sql', sql: CONVERSATIONS },
    { file: 'segments_type.sql', sql: OLDER },
  ];
  const { expected } = unapplied.expectedObjects(files);
  const judged = unapplied.judge({ expected, live: live('segments.id', 'campaigns.id'), explained: {} });
  const added = {
    'youtube_creators_setup.sql': '2026-10-30T10:00:00Z',
    // Merged AFTER the file it depends on, and also the newest of all.
    'youtube_conversations_setup.sql': '2026-10-31T10:00:00Z',
    'segments_type.sql': '2026-10-01T10:00:00Z',
  };
  const waiting = files.map((f) => ({ file: f.file, addedAt: added[f.file], feature: unapplied.featureOf(f.sql, f.file) }));
  return { files, judged, waiting, deps: unapplied.runAfter(files) };
}

test('a FEATURE line is what breaks; without one the first comment is used AND marked as a guess', () => {
  assert.deepEqual(unapplied.featureOf(CREATORS, 'youtube_creators_setup.sql'),
    { text: 'the YouTube Creators screen shows no creators and Approve does nothing.', guessed: false });
  assert.deepEqual(unapplied.featureOf(CONVERSATIONS, 'youtube_conversations_setup.sql'),
    { text: 'Outreach wizard 16/19: the comments worth replying to.', guessed: true });
});

test('a file that references or alters a table another waiting file creates runs after it', () => {
  const { deps } = waitingReading();
  assert.deepEqual(deps['youtube_conversations_setup.sql'], ['youtube_creators_setup.sql']);
  assert.deepEqual(deps['youtube_creators_setup.sql'], []);
  assert.deepEqual(unapplied.statedRunAfter('-- RUN AFTER docs/SQL/a_setup.sql — columns on its table.\nselect 1;'), ['a_setup.sql']);
});

test('with 2+ files waiting, each has a link, a "Without it", a run order that respects dependencies, and Dane is assigned', () => {
  const { judged, waiting, deps } = waitingReading();
  const t = unapplied.renderSqlTicket({ judged, waiting, deps, now: NOW, node: 'mac-mini', explained: {} });
  assert.equal(t.assign, true);
  assert.equal(t.count, 3);
  assert.match(t.body, /^# 3 files waiting/);
  assert.match(t.body, /Supabase → \*\*StarCaster\*\* project \(not WaveCenter\)/);
  for (const f of ['youtube_creators_setup.sql', 'youtube_conversations_setup.sql', 'segments_type.sql']) {
    assert.ok(t.body.includes(`(https://github.com/mentor24-maker/starcaster/blob/main/docs/SQL/${f})`), `${f} has a GitHub link`);
  }
  assert.equal((t.body.match(/\*\*Without it:\*\*/g) || []).length, 3);
  assert.match(t.body, /guessed from the file's first comment/);
  assert.match(t.body, /\*\*Run after:\*\* youtube_creators_setup\.sql/);
  // Newest first, except a dependency always comes before what needs it.
  const order = [...t.body.matchAll(/^### (\d+)\. \[([^\]]+)\]/gm)].map((m) => m[2]);
  assert.deepEqual(order, ['youtube_creators_setup.sql', 'youtube_conversations_setup.sql', 'segments_type.sql']);
});

test('nothing waiting clears the assignee and says so with a Mountain-time clock', () => {
  const judged = unapplied.judge({ expected: [{ file: 'a.sql', kind: 'table', table: 'a' }], live: live('a.id'), explained: {} });
  const t = unapplied.renderSqlTicket({ judged, waiting: [], now: Date.parse('2026-11-02T02:15:00Z') });
  assert.equal(t.assign, false);
  assert.equal(t.count, 0);
  assert.match(t.body, /^# Nothing waiting — last checked Sun, Nov 1, 7:15 PM MST/);
  assert.deepEqual(unapplied.assigneeChange({ current: [{ id: 48012725 }, { id: 7 }], assign: false, operatorId: 48012725 }), { add: [], rem: [48012725, 7] });
  assert.deepEqual(unapplied.assigneeChange({ current: [{ id: 7 }], assign: true, operatorId: 48012725 }), { add: [48012725], rem: [7] });
  assert.deepEqual(unapplied.assigneeChange({ current: [{ id: 7 }], assign: null, operatorId: 48012725 }), { add: [], rem: [] });
});

test('an EXPLAINED file is never listed as work — only in the "deliberately not run" line', () => {
  const files = [{ file: 'team_invitations_setup.sql', sql: 'create table team_invitations (id int);' }];
  const { expected } = unapplied.expectedObjects(files);
  const judged = unapplied.judge({ expected, live: live('segments.id') });
  assert.equal(judged.files.length, 0);
  const t = unapplied.renderSqlTicket({ judged, waiting: judged.files, now: NOW });
  assert.equal(t.assign, false);
  assert.doesNotMatch(t.body, /^### /m);
  assert.match(t.body, /4 files deliberately not run — do NOT run these[^\n]*team_invitations_setup\.sql/);
});

test('a failed reading never shows "Nothing waiting" — it says CANNOT TELL and keeps the last good list', () => {
  const { judged, waiting, deps } = waitingReading();
  const good = unapplied.renderSqlTicket({ judged, waiting, deps, now: NOW, explained: {} });
  const blind = unapplied.judge({ expected: [], live: null, error: 'psql failed' });
  const t = unapplied.renderSqlTicket({ judged: blind, waiting: blind.files, now: NOW + HOUR, lastGood: good.lastGood });
  assert.doesNotMatch(t.body, /Nothing waiting/);
  assert.match(t.body, /^# ⚠️ CANNOT TELL/);
  assert.match(t.body, /The last good list, from/);
  assert.ok(t.body.includes('youtube_creators_setup.sql'));
  assert.equal(t.assign, true, 'Dane stays assigned while the last good list had work on it');
  // With nothing kept, it still says CANNOT TELL and leaves the assignee alone.
  const bare = unapplied.renderSqlTicket({ judged: blind, waiting: [], now: NOW });
  assert.doesNotMatch(bare.body, /Nothing waiting/);
  assert.equal(bare.assign, null);
});

test('an unchanged ticket is rewritten at most hourly; a change or an assignment change rewrites at once', () => {
  const rendered = { fingerprint: 'x', assign: true };
  const at = new Date(NOW).toISOString();
  assert.equal(unapplied.ticketDue({ rendered, state: {}, now: NOW }), true);
  assert.equal(unapplied.ticketDue({ rendered, state: { writtenAt: at, fingerprint: 'x', assign: true }, now: NOW + 10 * 60 * 1000 }), false);
  assert.equal(unapplied.ticketDue({ rendered, state: { writtenAt: at, fingerprint: 'y', assign: true }, now: NOW + 60 * 1000 }), true);
  assert.equal(unapplied.ticketDue({ rendered, state: { writtenAt: at, fingerprint: 'x', assign: false }, now: NOW + 60 * 1000 }), true);
  assert.equal(unapplied.ticketDue({ rendered, state: { writtenAt: at, fingerprint: 'x', assign: true }, now: NOW + HOUR }), true);
});

test('the ticket is a registered noticeboard, so no throughput count reads it as shipped work', () => {
  const noticeboards = require('../../lib/loopNoticeboards.js');
  assert.equal(noticeboards.isNoticeboard({ name: 'SQL waiting for you' }), true);
});
