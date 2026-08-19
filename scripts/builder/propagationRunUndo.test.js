'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  rejectedOptionalColumns,
  stripColumns,
} = require('../../lib/builderPageRevisionsStore');
const pagesStore = require('../../lib/builderPagesStore');
const routeBuilder = require('../../routes/builder');
const { writeLayoutSectionsToRow } = require('../../lib/builder/document');
const realSupabase = require('../../lib/supabase');

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

// ── End-to-end: propagateCanonicalSection actually stamps a run id ─────────
//
// Everything above proves the column and the endpoint exist. Nothing above
// drives propagateCanonicalSection with more than one real page and checks
// what lands on the wire — which is exactly what the ClickUp task's own test
// steps ask for ("a run id is attached to every page in one propagation; two
// separate saves get two different ids"). These tests fill that gap.
//
// lib/supabase.js is swapped for a recorder so no network call is made and
// the exact PATCH/POST bodies can be inspected — same technique as
// scripts/builder/projectSupportRequests.test.js.

const PAGES_TABLE = realSupabase.tableConfig().builderPages;
const REVISIONS_TABLE = realSupabase.tableConfig().builderPageRevisions;

const SAVED_SECTION_ID = 'saved_section_footer';

function canonicalSection(text) {
  return {
    id: 'sec-1',
    title: 'Footer',
    layout: 'main',
    savedSectionId: SAVED_SECTION_ID,
    canonical: true,
    modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text, settings: {} }],
  };
}

function pageRow(id, name, text) {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    layout_sections: writeLayoutSectionsToRow({
      pageBackground: {},
      theme: {},
      sections: [canonicalSection(text)],
    }),
    updated_at: new Date(0).toISOString(),
    created_at: new Date(0).toISOString(),
  };
}

/** Swap lib/supabase (and the modules that cached a reference to it) for an
 *  in-memory recorder, so propagateCanonicalSection can run for real without
 *  touching a network. */
function withMockedPagesStore(pages) {
  const patchCalls = [];
  const revisionCalls = [];

  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => realSupabase.tableConfig(),
    sbQuery: async (opts) => {
      const isListPages = opts.method === 'GET' && opts.table === PAGES_TABLE && !/id=eq\./.test(opts.query || '');
      if (isListPages) return { ok: true, status: 200, data: pages };

      if (opts.method === 'PATCH' && opts.table === PAGES_TABLE) {
        patchCalls.push(opts);
        const match = /id=eq\.(\d+)/.exec(opts.query || '');
        const id = match ? Number(match[1]) : null;
        const original = pages.find((p) => p.id === id);
        const merged = { ...original, ...opts.body, id };
        return { ok: true, status: 200, data: [merged] };
      }

      if (opts.method === 'POST' && opts.table === REVISIONS_TABLE) {
        revisionCalls.push(opts);
        return { ok: true, status: 201, data: [{ id: `rev_${revisionCalls.length}`, ...opts.body[0] }] };
      }

      // Column-support probes, history pruning reads, and anything else this
      // test does not care about pinning: succeed with nothing, which is what
      // a real probe against an absent/irrelevant table also looks like.
      return { ok: true, status: 200, data: [] };
    },
  };

  const supabasePath = require.resolve('../../lib/supabase.js');
  const scopePath = require.resolve('../../lib/projectScope.js');
  const revisionsStorePath = require.resolve('../../lib/builderPageRevisionsStore.js');
  const pagesStorePath = require.resolve('../../lib/builderPagesStore.js');

  const savedEntries = [supabasePath, scopePath, revisionsStorePath, pagesStorePath]
    .map((p) => [p, require.cache[p]]);

  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  delete require.cache[scopePath];
  delete require.cache[revisionsStorePath];
  delete require.cache[pagesStorePath];

  const mod = require(pagesStorePath);

  function restore() {
    for (const [p, entry] of savedEntries) {
      if (entry) require.cache[p] = entry;
      else delete require.cache[p];
    }
  }

  return { mod, patchCalls, revisionCalls, restore };
}

test('one propagation stamps every page it touches with the SAME run id', async () => {
  const pages = [pageRow(1, 'Home', 'old copy'), pageRow(2, 'About', 'old copy'), pageRow(3, 'Rates', 'unrelated section')];
  // Rates does not carry the canonical section at all — it must be left alone.
  pages[2].layout_sections = writeLayoutSectionsToRow({
    pageBackground: {}, theme: {},
    sections: [{ id: 'sec-x', title: 'Other', layout: 'main', modules: [] }],
  });

  const { mod, revisionCalls, restore } = withMockedPagesStore(pages);
  try {
    const result = await mod.propagateCanonicalSection(
      SAVED_SECTION_ID,
      canonicalSection('new copy'),
      null,
      { actor: { id: 'admin_1', name: 'Dane' } }
    );

    assert.equal(result.ok, true);
    assert.equal(result.total, 2, 'only the two pages carrying the canonical section are targets');
    assert.equal(result.updated, 2);
    assert.ok(result.runId, 'a real push returns a non-empty run id');

    assert.equal(revisionCalls.length, 2, 'Home and About each bank one revision; Rates banks none');
    const runIds = revisionCalls.map((c) => c.body[0].propagation_run_id);
    assert.deepEqual(runIds, [result.runId, result.runId], 'every revision in the push shares the SAME run id');
    for (const call of revisionCalls) {
      assert.equal(call.body[0].reason, 'propagate');
    }
  } finally {
    restore();
  }
});

test('two separate propagation pushes get two different run ids', async () => {
  const pagesA = [pageRow(1, 'Home', 'old copy')];
  const { mod: modA, restore: restoreA } = withMockedPagesStore(pagesA);
  let firstRunId;
  try {
    const result = await modA.propagateCanonicalSection(SAVED_SECTION_ID, canonicalSection('push one'), null);
    firstRunId = result.runId;
    assert.ok(firstRunId);
  } finally {
    restoreA();
  }

  const pagesB = [pageRow(1, 'Home', 'old copy')];
  const { mod: modB, restore: restoreB } = withMockedPagesStore(pagesB);
  try {
    const result = await modB.propagateCanonicalSection(SAVED_SECTION_ID, canonicalSection('push two'), null);
    assert.ok(result.runId);
    assert.notEqual(result.runId, firstRunId, 'a second, independent push must not reuse the first run id');
  } finally {
    restoreB();
  }
});

test('a page whose canonical section a run never touched is invisible to that run', async () => {
  // listRunRevisions filters by propagation_run_id, so this is really a
  // property of the WRITE side: a page outside the fan-out must never receive
  // a revision carrying this run's id, or an undo would restore a page that
  // was never part of the push.
  const pages = [pageRow(1, 'Home', 'old copy'), pageRow(2, 'Untouched', 'unrelated')];
  pages[1].layout_sections = writeLayoutSectionsToRow({
    pageBackground: {}, theme: {},
    sections: [{ id: 'sec-y', title: 'Other', layout: 'main', modules: [] }],
  });

  const { mod, revisionCalls, restore } = withMockedPagesStore(pages);
  try {
    const result = await mod.propagateCanonicalSection(SAVED_SECTION_ID, canonicalSection('new copy'), null);
    assert.equal(result.total, 1);
    assert.equal(revisionCalls.length, 1);
    assert.equal(revisionCalls[0].body[0].page_id, 1, 'only the touched page banks a revision for this run');
  } finally {
    restore();
  }
});
