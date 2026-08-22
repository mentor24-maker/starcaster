'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { writeLayoutSectionsToRow, normalizeBuilderSection } = require('../../lib/builder');
const realSupabase = require('../../lib/supabase');

/**
 * Sync 5/7: a following copy that was hand-edited on its own page, while
 * still marked canonical, is no longer indistinguishable from an ordinary
 * untouched copy. A push must skip it by default — naming it — rather than
 * flattening a deliberate local edit the way every push has done until now.
 *
 * lib/supabase.js is swapped for an in-memory recorder, same technique as
 * scripts/builder/propagationRunUndo.test.js — no network call, and the
 * exact PATCH bodies (or their absence) can be inspected directly.
 */

const PAGES_TABLE = realSupabase.tableConfig().builderPages;
const REVISIONS_TABLE = realSupabase.tableConfig().builderPageRevisions;
const SAVED_SECTION_ID = 'saved_section_footer';

function section(text, extra = {}) {
  return {
    id: 'sec-1',
    title: 'Footer',
    layout: 'main',
    savedSectionId: SAVED_SECTION_ID,
    canonical: true,
    modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text, settings: {} }],
    ...extra,
  };
}

// Normalized through the SAME pipeline getSavedSection/updateSavedSection use
// in production (normalizeBuilderSection -> normalizeLayoutSections), not a
// hand-typed raw object — comparing a normalized page instance (every real
// instance IS normalized, via listPages -> rowToPage) against an
// unnormalized master would report drift on every page, always, since
// normalization adds default fields the raw object never had. That is not a
// hypothetical: it is exactly what a first draft of this test caught.

/** The master's content as it stood BEFORE this push — what drift is measured against. */
const PREVIOUS_MASTER = normalizeBuilderSection(section('old copy'));
/** What this push is about to write. */
const NEW_MASTER = normalizeBuilderSection(section('new copy'));

function pageRow(id, name, sectionOverride) {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    layout_sections: writeLayoutSectionsToRow({
      pageBackground: {},
      theme: {},
      sections: [sectionOverride],
    }),
    updated_at: new Date(0).toISOString(),
    created_at: new Date(0).toISOString(),
  };
}

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

test('a page whose copy was hand-edited (drifted from the previous master) is skipped, named, and left untouched', async () => {
  const pages = [
    pageRow(1, 'Home', section('old copy')), // untouched: matches the previous master
    pageRow(2, 'Rates', section('HAND-EDITED HERE')), // drifted
  ];
  const { mod, patchCalls, revisionCalls, restore } = withMockedPagesStore(pages);
  try {
    const result = await mod.propagateCanonicalSection(SAVED_SECTION_ID, NEW_MASTER, null, {
      previousSection: PREVIOUS_MASTER,
    });

    assert.equal(result.total, 2, 'both pages carry a matching canonical instance');
    assert.equal(result.updated, 1, 'only Home was actually written');
    assert.deepEqual(result.skipped, [{ pageId: '2', name: 'Rates' }]);

    assert.equal(patchCalls.length, 1, 'the drifted page must never be PATCHed');
    assert.equal(patchCalls[0].query.includes('id=eq.1'), true);
    assert.equal(revisionCalls.length, 1, 'no revision is banked for a page never written');
  } finally {
    restore();
  }
});

test('overwriteDrifted:true forces the push through anyway — reported as OVERWRITTEN, never as skipped', async () => {
  const pages = [pageRow(1, 'Rates', section('HAND-EDITED HERE'))];
  const { mod, patchCalls, restore } = withMockedPagesStore(pages);
  try {
    const result = await mod.propagateCanonicalSection(SAVED_SECTION_ID, NEW_MASTER, null, {
      previousSection: PREVIOUS_MASTER,
      overwriteDrifted: true,
    });
    assert.equal(result.updated, 1);
    assert.deepEqual(result.skipped, [], 'a page that was written was not skipped');
    assert.deepEqual(result.overwritten, [{ pageId: '1', name: 'Rates' }], 'the overwrite is named in its own bucket');
    assert.equal(patchCalls.length, 1, 'the explicit opt-in must actually write the page');
  } finally {
    restore();
  }
});

test('onlyPageIds narrows a force run to the named pages — the other followers are not touched', async () => {
  // The review finding: a force run rewrote EVERY follower to overwrite two
  // drifted copies. The banner knows which pages were skipped; it names them.
  const pages = [
    pageRow(1, 'Home', section('old copy')),          // untouched follower
    pageRow(2, 'Rates', section('HAND-EDITED HERE')),  // drifted — the one to overwrite
    pageRow(3, 'FAQ', section('old copy')),           // untouched follower
  ];
  const { mod, patchCalls, revisionCalls, restore } = withMockedPagesStore(pages);
  try {
    const result = await mod.propagateCanonicalSection(SAVED_SECTION_ID, NEW_MASTER, null, {
      overwriteDrifted: true,
      onlyPageIds: ['2'],
    });
    assert.equal(result.total, 1, 'only the named page is a target');
    assert.equal(result.updated, 1);
    assert.equal(patchCalls.length, 1, 'exactly one write');
    assert.ok(patchCalls[0].query.includes('id=eq.2'), 'and it is the named page');
    assert.equal(revisionCalls.length, 1, 'one restore point, so the undo run covers exactly what was written');
    assert.ok(result.runId, 'a real run id for the undo banner');
  } finally {
    restore();
  }
});

test('onlyPageIds with an id that carries no copy of the section writes nothing', async () => {
  const pages = [pageRow(1, 'Home', section('old copy'))];
  const { mod, patchCalls, restore } = withMockedPagesStore(pages);
  try {
    const result = await mod.propagateCanonicalSection(SAVED_SECTION_ID, NEW_MASTER, null, {
      overwriteDrifted: true,
      onlyPageIds: ['999'],
    });
    assert.equal(result.total, 0);
    assert.equal(result.updated, 0);
    assert.equal(patchCalls.length, 0);
    assert.equal(result.runId, '', 'nothing written, nothing to undo');
  } finally {
    restore();
  }
});

test('the force-propagate route requires pageIds and passes them as onlyPageIds', () => {
  const source = require('node:fs').readFileSync(require.resolve('../../routes/builder.js'), 'utf8');
  const start = source.indexOf('force-propagate$/');
  const block = source.slice(start, start + 2000);
  assert.match(block, /pageIds is required/, 'a bodiless force call must be refused, or it rewrites every follower');
  assert.match(block, /onlyPageIds:\s*pageIds/, 'the named pages must reach propagateCanonicalSection');
  assert.match(block, /sendOk\(res, 200, \{\}, \{\}, \{ propagation \}\)/, 'the tally rides meta.propagation — clients read it there');
});

test('omitting previousSection disables the drift check entirely — the pre-Sync-5/7 behavior', async () => {
  const pages = [pageRow(1, 'Rates', section('anything at all'))];
  const { mod, patchCalls, restore } = withMockedPagesStore(pages);
  try {
    const result = await mod.propagateCanonicalSection(SAVED_SECTION_ID, NEW_MASTER, null, {});
    assert.equal(result.updated, 1);
    assert.deepEqual(result.skipped, []);
    assert.equal(patchCalls.length, 1);
  } finally {
    restore();
  }
});

test('a page whose only matching instance is drifted never gets an empty PATCH', async () => {
  const pages = [pageRow(1, 'Rates', section('HAND-EDITED HERE'))];
  const { mod, patchCalls, restore } = withMockedPagesStore(pages);
  try {
    await mod.propagateCanonicalSection(SAVED_SECTION_ID, NEW_MASTER, null, { previousSection: PREVIOUS_MASTER });
    assert.equal(patchCalls.length, 0, 'nothing changed on this page, so nothing should be written');
  } finally {
    restore();
  }
});

test('id/savedSectionId/canonical differing between the instance and the previous master is not drift', () => {
  // Regression guard for the exact bug this feature must not introduce: every
  // instance legitimately differs from the master in its own id. If that were
  // read as drift, EVERY push would skip EVERY page, every time.
  const { hasSectionDrifted } = require('../../lib/builder/document.js');
  const instance = { ...PREVIOUS_MASTER, id: 'inst-77' };
  assert.equal(hasSectionDrifted(instance, PREVIOUS_MASTER), false);
});
