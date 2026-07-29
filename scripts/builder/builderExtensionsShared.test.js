'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * builder_extensions.slug carries a GLOBAL unique constraint, so an extension
 * can only ever exist once across the whole platform. Filtering the list by
 * project_id contradicted that: the first project to open the list seeded each
 * new default, and every other project's seed attempt died on duplicate key and
 * was swallowed — so Brandon Marinoff never received SEO Alt Text or Populate
 * Module Titles while Dane of Earth had them.
 *
 * These tests pin the fix: extensions are read and addressed platform-wide.
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const storePath = require.resolve('../../lib/builderExtensionsStore.js');

const ALL_DEFAULT_SLUGS = [
  'icon-builder',
  'screenshot',
  'thumbnail',
  'populate-module-titles',
  'seo-alt-text',
  'nav-probe',
];

function loadStoreWithRecorder(rows) {
  const calls = [];
  const fakeSupabase = {
    sbQuery: async (options) => {
      calls.push(options);
      if (options.method === 'GET' || !options.method) {
        return { ok: true, status: 200, data: rows };
      }
      return { ok: true, status: 200, data: [{ id: 99, slug: 'created' }] };
    },
    tableConfig: () => ({ builderExtensions: 'builder_extensions' }),
  };

  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: fakeSupabase,
  };
  delete require.cache[storePath];
  const store = require(storePath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[storePath];
  }

  return { store, calls, restore };
}

function existingRows() {
  return ALL_DEFAULT_SLUGS.map((slug, index) => ({ id: index + 1, slug, name: slug }));
}

test('listing extensions does not filter by project', async () => {
  const { store, calls, restore } = loadStoreWithRecorder(existingRows());
  try {
    await store.listExtensions(500, { projectId: 'proj_marinoff', userId: 'user_1' });

    const read = calls.find((call) => !call.method || call.method === 'GET');
    assert.ok(read, 'a read should have been issued');
    assert.ok(
      !String(read.query || '').includes('project_id'),
      `the list query must not carry a project filter, got: ${read.query}`
    );
  } finally {
    restore();
  }
});

test('every project sees the same extensions', async () => {
  const rows = existingRows();

  const first = loadStoreWithRecorder(rows);
  const daneOfEarth = await first.store.listExtensions(500, { projectId: 'proj_doe' });
  first.restore();

  const second = loadStoreWithRecorder(rows);
  const marinoff = await second.store.listExtensions(500, { projectId: 'proj_marinoff' });
  second.restore();

  const slugsFor = (result) => result.data.map((item) => item.slug).sort();
  assert.deepEqual(slugsFor(daneOfEarth), slugsFor(marinoff));
  assert.deepEqual(slugsFor(marinoff), [...ALL_DEFAULT_SLUGS].sort());
});

test('a project missing the newer defaults gets them seeded', async () => {
  // Marinoff's actual state: only the three originals.
  const { store, calls, restore } = loadStoreWithRecorder([
    { id: 1, slug: 'icon-builder', name: 'Icon Builder' },
    { id: 2, slug: 'screenshot', name: 'Screenshot' },
    { id: 3, slug: 'thumbnail', name: 'Thumbnail' },
  ]);
  try {
    await store.listExtensions(500, { projectId: 'proj_marinoff' });

    const seeded = calls
      .filter((call) => call.method === 'POST')
      .map((call) => (Array.isArray(call.body) ? call.body[0] : call.body))
      .map((row) => row.slug);

    assert.deepEqual(seeded.sort(), ['nav-probe', 'populate-module-titles', 'seo-alt-text']);
  } finally {
    restore();
  }
});

test('seeded defaults belong to the platform, not to one project', async () => {
  const { store, calls, restore } = loadStoreWithRecorder([]);
  try {
    await store.listExtensions(500, { projectId: 'proj_doe', userId: 'user_1' });

    const seeded = calls
      .filter((call) => call.method === 'POST')
      .map((call) => (Array.isArray(call.body) ? call.body[0] : call.body));

    assert.ok(seeded.length > 0, 'defaults should have been seeded');
    seeded.forEach((row) => {
      assert.equal(row.project_id, undefined, `${row.slug} must not be stamped with a project`);
    });
  } finally {
    restore();
  }
});

test('launching an extension owned elsewhere is not a 404', async () => {
  const { store, calls, restore } = loadStoreWithRecorder([
    { id: 5, slug: 'seo-alt-text', name: 'SEO Alt Text', usage_count: 3, project_id: 'proj_doe' },
  ]);
  try {
    const result = await store.trackExtensionUse(5, { projectId: 'proj_marinoff' });
    assert.equal(result.ok, true, 'a shared extension must be launchable from any project');

    const reads = calls.filter((call) => !call.method || call.method === 'GET');
    reads.forEach((call) => {
      assert.ok(
        !String(call.query || '').includes('project_id'),
        `lookup must not filter by project, got: ${call.query}`
      );
    });
  } finally {
    restore();
  }
});
