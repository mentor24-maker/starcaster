'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Event categories over a fake database read FROM the SQL that created the
 * table, so a column the store writes but the SQL lacks fails here.
 *
 * Guarded: one project never touches another's venues; a colour that is not
 * #rrggbb never reaches a style attribute; a visitor's copy carries nothing
 * but what the legend paints.
 */

const SQL = ['events_setup.sql', 'events_programs_setup.sql']
  .map((name) => fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'SQL', name), 'utf8'))
  .join('\n;\n');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const storePath = require.resolve('../../lib/eventCategoriesStore.js');
const eventsStorePath = require.resolve('../../lib/eventsStore.js');
const A = { projectId: 'proj_a', userId: 'user_1' };
const B = { projectId: 'proj_b', userId: 'user_2' };

function withStores() {
  const db = createFakeDb(parseSchemaText(SQL));
  const real = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      isConfigured: () => true,
      tableConfig: () => ({ events: 'events', eventCategories: 'event_categories' }),
      sbQuery: async (args) => db.sbQuery(args),
    },
  };
  delete require.cache[storePath];
  delete require.cache[eventsStorePath];
  const categories = require(storePath);
  const events = require(eventsStorePath);
  return {
    categories, events,
    restore() {
      if (real) require.cache[supabasePath] = real; else delete require.cache[supabasePath];
      delete require.cache[storePath];
      delete require.cache[eventsStorePath];
    },
  };
}

test('venues are created in order, per project, with a clean colour', async (t) => {
  const { categories, restore } = withStores();
  t.after(restore);
  await categories.createEventCategory({ name: 'Pickleball', color: '#F7A600', sortOrder: 3 }, A);
  await categories.createEventCategory({ name: 'Delray Beach Tennis Center', color: '#0B2D6B', sortOrder: 1 }, A);
  await categories.createEventCategory({ name: 'Theirs', color: 'red', sortOrder: 0 }, B);

  const mine = await categories.listEventCategories(A);
  assert.deepEqual(mine.map((c) => c.name), ['Delray Beach Tennis Center', 'Pickleball']);
  assert.equal(mine[1].color, '#f7a600');
  assert.equal(mine[0].projectId, 'proj_a');
  const theirs = await categories.listEventCategories(B);
  assert.equal(theirs[0].color, '', 'a colour that is not #rrggbb must never be stored');
});

test("one project cannot rename or delete another project's venue", async (t) => {
  const { categories, restore } = withStores();
  t.after(restore);
  const mine = await categories.createEventCategory({ name: 'Ours', color: '#000000' }, A);
  assert.equal(await categories.updateEventCategory(mine.id, { name: 'Hijacked' }, B), null);
  assert.equal(await categories.deleteEventCategory(mine.id, B), null);
  const renamed = await categories.updateEventCategory(mine.id, { color: '#72b62f' }, A);
  assert.equal(renamed.name, 'Ours');
  assert.equal(renamed.color, '#72b62f');
});

test('a visitor copy carries only what the legend paints', () => {
  const { categories, restore } = withStores();
  try {
    const pub = categories.toPublic({ id: 'ecat_1', projectId: 'p', ownerUserId: 'u', name: 'N', color: '#123456', sortOrder: 2, createdAt: 'x' });
    assert.deepEqual(Object.keys(pub).sort(), ['color', 'id', 'name', 'sortOrder']);
  } finally { restore(); }
});

test('an event keeps its instructor and category, and survives the category being deleted', async (t) => {
  const { categories, events, restore } = withStores();
  t.after(restore);
  const venue = await categories.createEventCategory({ name: 'Pickleball', color: '#f7a600' }, A);
  const created = await events.createEvent({ title: 'PB 101', instructor: 'Mike C', categoryId: venue.id }, A);
  assert.equal(created.instructor, 'Mike C');
  assert.equal(created.categoryId, venue.id);

  await categories.deleteEventCategory(venue.id, A);
  const after = await events.getEvent(created.id, A);
  assert.ok(after, 'deleting a venue must not delete its events');
  assert.equal(after.categoryId, venue.id, 'the dangling id is read as "no category" by the UI');
});

test('the route refuses a nameless venue and a colour it cannot store', () => {
  const { readCategoryPatch } = require('../../routes/eventCategories');
  assert.match(readCategoryPatch({ name: '  ' }, { requireName: true }).error, /name/);
  assert.match(readCategoryPatch({ name: 'X', color: 'orange' }, { requireName: true }).error, /#rrggbb/);
  assert.deepEqual(readCategoryPatch({ color: '' }, { requireName: false }).patch, { color: '' });
  assert.deepEqual(readCategoryPatch({ sortOrder: '2.7' }, { requireName: false }).patch, { sortOrder: 2 });
});

test('a single date may name a substitute instructor', () => {
  const { parseOverrides } = require('../../lib/eventRecurrence');
  assert.deepEqual(parseOverrides([{ date: '2026-09-15', instructor: ' Danny Z ' }]), [{ date: '2026-09-15', instructor: 'Danny Z' }]);
});
