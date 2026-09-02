'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

/**
 * The events store, over a fake database whose schema is read FROM
 * docs/SQL/events_setup.sql — so a column dropped from the SQL fails here
 * rather than disagreeing quietly with the code.
 *
 * The failures worth guarding are the silent ones:
 *   - a query that forgets its project filter returns another tenant's events
 *     and looks like a perfectly successful read (landmine 12);
 *   - an unparseable date reaching a timestamptz column is a 400 that reads
 *     like a server fault;
 *   - a status nobody validated makes "published" a typo away from invisible.
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'events_setup.sql');
const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const storePath = require.resolve('../../lib/eventsStore.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function withStore() {
  const db = createFakeDb(parseSchemaFile(SQL_PATH));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ events: 'events' }),
    sbQuery: async (args) => db.sbQuery(args),
  };

  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase,
  };
  // The store caches "does this table exist" per table name, so it has to be
  // re-required per test or it answers from the previous test's database.
  delete require.cache[storePath];
  const store = require(storePath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[storePath];
  }

  return { store, restore };
}

test('an event is created against its own project and read back', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const created = await store.createEvent({
    title: 'Spring Member Mixer',
    slug: 'spring-member-mixer',
    status: 'published',
    startsAt: '2026-04-12T18:00:00.000Z',
    endsAt: '2026-04-12T21:00:00.000Z',
    locationName: 'Center Court',
  }, SCOPE_A);

  assert.ok(created, 'createEvent returned nothing');
  assert.equal(created.projectId, 'proj_a');
  assert.equal(created.ownerUserId, 'user_1');
  assert.equal(created.status, 'published');
  assert.equal(created.startsAt, '2026-04-12T18:00:00.000Z');

  const read = await store.getEvent(created.id, SCOPE_A);
  assert.equal(read.title, 'Spring Member Mixer');
});

test("one project never sees, edits or deletes another's events", async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const mine = await store.createEvent({ title: 'Ours', slug: 'ours' }, SCOPE_A);
  await store.createEvent({ title: 'Theirs', slug: 'theirs' }, SCOPE_B);

  const listA = await store.listEvents({}, SCOPE_A);
  assert.deepEqual(listA.map((e) => e.title), ['Ours']);

  // The read, the write and the delete each have to carry the filter — a
  // store that scopes its list but not its update is a tenant leak with a
  // green list beside it.
  assert.equal(await store.getEvent(mine.id, SCOPE_B), null);
  assert.equal(await store.updateEvent(mine.id, { title: 'Hijacked' }, SCOPE_B), null);
  assert.equal(await store.deleteEvent(mine.id, SCOPE_B), null);

  const stillMine = await store.getEvent(mine.id, SCOPE_A);
  assert.equal(stillMine.title, 'Ours');
});

test('events come back soonest first, and unscheduled ones last', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  await store.createEvent({ title: 'Later', slug: 'later', startsAt: '2026-06-01T00:00:00.000Z' }, SCOPE_A);
  await store.createEvent({ title: 'Someday', slug: 'someday' }, SCOPE_A);
  await store.createEvent({ title: 'Sooner', slug: 'sooner', startsAt: '2026-05-01T00:00:00.000Z' }, SCOPE_A);

  const list = await store.listEvents({}, SCOPE_A);
  assert.deepEqual(
    list.map((e) => e.title),
    ['Sooner', 'Later', 'Someday'],
    'an event with no date is unscheduled, not ancient — it sorts last, not first'
  );
});

test('status is one of three values, and anything else is a draft', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const cancelled = await store.createEvent({ title: 'Called off', status: 'cancelled' }, SCOPE_A);
  assert.equal(cancelled.status, 'cancelled');

  // "Published" with a capital P, or a typo, must not silently become a
  // status the calendar has never heard of — it becomes a draft, which is
  // the state that shows nobody anything by accident.
  const typo = await store.createEvent({ title: 'Typo', status: 'pubished' }, SCOPE_A);
  assert.equal(typo.status, 'draft');
  const cased = await store.createEvent({ title: 'Cased', status: 'Published' }, SCOPE_A);
  assert.equal(cased.status, 'published');
});

test('an unreadable date becomes null rather than reaching the database', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const created = await store.createEvent({
    title: 'Bad date',
    startsAt: 'next tuesday-ish',
    endsAt: '',
  }, SCOPE_A);

  assert.ok(created, 'a bad date must not fail the whole insert');
  assert.equal(created.startsAt, null);
  assert.equal(created.endsAt, null);
});

test('an update changes only what it is given', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const created = await store.createEvent({
    title: 'Summer Kickoff',
    slug: 'summer-kickoff',
    locationName: 'Clubhouse',
    startsAt: '2026-07-04T16:00:00.000Z',
  }, SCOPE_A);

  const updated = await store.updateEvent(created.id, { status: 'published' }, SCOPE_A);
  assert.equal(updated.status, 'published');
  assert.equal(updated.locationName, 'Clubhouse', 'a patch must not blank the fields it did not mention');
  assert.equal(updated.startsAt, '2026-07-04T16:00:00.000Z');
  assert.equal(updated.projectId, 'proj_a', 'an update must never move an event to another project');
});

test('a published event is reachable by slug; a draft one is still found by the admin', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  await store.createEvent({ title: 'Open Day', slug: 'open-day', status: 'published' }, SCOPE_A);
  const found = await store.getEventBySlug('open-day', SCOPE_A);
  assert.equal(found.title, 'Open Day');

  // The store returns drafts too; hiding them from the public is the route's
  // job (routes/events.js), which is where the session is known.
  await store.createEvent({ title: 'Secret', slug: 'secret', status: 'draft' }, SCOPE_A);
  assert.equal((await store.getEventBySlug('secret', SCOPE_A)).status, 'draft');
  assert.equal(await store.getEventBySlug('open-day', SCOPE_B), null);
});

test('an event with no slug still gets one, derived from its title', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  // A slug is what gives an event a public URL. Created through the API with
  // none — which the manager form does not do, but any other caller might —
  // the event could never be linked to, and nothing would have said so.
  const created = await store.createEvent({ title: 'Spring Member Mixer!' }, SCOPE_A);
  assert.equal(created.slug, 'spring-member-mixer');
});

test('two events with the same name do not collide', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  // The unique index is per project and partial (slug <> ''), so without this
  // the second insert is a raw 409 that the manager can only report as
  // "Failed to create event" — for two events legitimately sharing a name.
  const first = await store.createEvent({ title: 'Open Day' }, SCOPE_A);
  const second = await store.createEvent({ title: 'Open Day' }, SCOPE_A);
  assert.equal(first.slug, 'open-day');
  assert.equal(second.slug, 'open-day-2');
  assert.ok(second.id !== first.id);

  // Another project may reuse the slug — uniqueness is per tenant.
  const other = await store.createEvent({ title: 'Open Day' }, SCOPE_B);
  assert.equal(other.slug, 'open-day');
});

test('an event keeps its own slug when it is edited', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const created = await store.createEvent({ title: 'Summer Social', slug: 'summer-social' }, SCOPE_A);
  // Re-saving must not walk the event to summer-social-2 by colliding with
  // itself — the check has to exclude the row being updated.
  const updated = await store.updateEvent(created.id, { slug: 'summer-social', status: 'published' }, SCOPE_A);
  assert.equal(updated.slug, 'summer-social');

  const renamed = await store.updateEvent(created.id, { slug: 'Summer Social 2027' }, SCOPE_A);
  assert.equal(renamed.slug, 'summer-social-2027');
});

test('a delete removes exactly one event', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const a = await store.createEvent({ title: 'Doomed', slug: 'doomed' }, SCOPE_A);
  await store.createEvent({ title: 'Survivor', slug: 'survivor' }, SCOPE_A);

  const deleted = await store.deleteEvent(a.id, SCOPE_A);
  assert.equal(deleted.title, 'Doomed');
  assert.deepEqual((await store.listEvents({}, SCOPE_A)).map((e) => e.title), ['Survivor']);
  assert.equal(await store.getEvent(a.id, SCOPE_A), null);
});
