'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * theme_wizard_candidates.parent_candidate_id carries a foreign key back to the
 * same table: it names the winner a round-2 candidate was derived from, and is
 * empty in round 1.
 *
 * The store used to write '' for "no parent". An empty string is a real value,
 * not an absence — Postgres looked for a candidate whose id is '', found none,
 * and rejected the insert. Every first-round candidate failed, which is every
 * generation the wizard has ever been asked to do. Unit tests with a stubbed
 * database could not see it; it only showed up against a real table.
 *
 * These tests pin the column to NULL so it cannot regress.
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const scopePath = require.resolve('../../lib/projectScope.js');
const snapshotsPath = require.resolve('../../lib/builderPageSnapshotsStore.js');
const themesPath = require.resolve('../../lib/builderThemesStore.js');
const storePath = require.resolve('../../lib/themeWizardStore.js');

function loadStore() {
  const writes = [];
  const saved = new Map();
  for (const p of [supabasePath, scopePath, snapshotsPath, themesPath, storePath]) {
    saved.set(p, require.cache[p]);
  }
  const stub = (path, exports) => { require.cache[path] = { id: path, filename: path, loaded: true, exports }; };

  stub(supabasePath, {
    sbQuery: async (options) => {
      if (options.method === 'POST' || options.method === 'PATCH') {
        writes.push({ table: options.table, body: options.body });
      }
      const row = Array.isArray(options.body) ? options.body[0] : options.body;
      return { ok: true, status: 200, data: [row || { id: 'x' }] };
    },
    tableConfig: () => ({
      themeWizardSessions: 'theme_wizard_sessions',
      themeWizardCandidates: 'theme_wizard_candidates',
      themeWizardJobs: 'theme_wizard_jobs',
      themeWizardLibraryEntries: 'theme_wizard_library_entries',
    }),
  });
  // Pass rows through untouched so the assertions see exactly what the store built.
  stub(scopePath, {
    scopedListQuery: async (_t, q) => q,
    scopedIdQuery: async (_t, q) => q,
    scopedInsertRow: async (_t, row) => row,
    scopedPatchRow: async (_t, row) => row,
  });
  stub(snapshotsPath, { createPageSnapshot: async () => ({ ok: true }), getPageSnapshot: async () => ({ ok: true }) });
  stub(themesPath, { createTheme: async () => ({ ok: true }) });

  delete require.cache[storePath];
  const store = require(storePath);
  return {
    store,
    writes,
    restore() {
      for (const [p, mod] of saved) { if (mod) require.cache[p] = mod; else delete require.cache[p]; }
    },
  };
}

test('a round-1 candidate writes NULL for parent_candidate_id, not an empty string', async () => {
  const h = loadStore();
  try {
    await h.store.createCandidate({ sessionId: 's1', projectId: 'p1', round: 1, slot: 1 }, {});
    const row = h.writes[0].body[0];
    assert.equal(row.parent_candidate_id, null,
      "'' is a value the foreign key will reject; absence must be NULL");
  } finally { h.restore(); }
});

test('a derived candidate keeps the parent id it was given', async () => {
  const h = loadStore();
  try {
    await h.store.createCandidate({ sessionId: 's1', projectId: 'p1', round: 2, slot: 1, parentCandidateId: 'twcd_9' }, {});
    assert.equal(h.writes[0].body[0].parent_candidate_id, 'twcd_9');
  } finally { h.restore(); }
});

test('clearing a parent on update also writes NULL', async () => {
  const h = loadStore();
  try {
    await h.store.updateCandidate('twcd_1', { parentCandidateId: '' }, {});
    assert.equal(h.writes[0].body.parent_candidate_id, null);
  } finally { h.restore(); }
});

test('the job functions the route depends on are actually exported', () => {
  const h = loadStore();
  try {
    for (const fn of ['createJob', 'getJob', 'updateJob', 'listJobs']) {
      assert.equal(typeof h.store[fn], 'function', `${fn} must be exported — the route calls it`);
    }
  } finally { h.restore(); }
});
