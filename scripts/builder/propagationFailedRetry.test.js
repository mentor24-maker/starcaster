'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { writeLayoutSectionsToRow, normalizeBuilderSection } = require('../../lib/builder');
const realSupabase = require('../../lib/supabase');

/**
 * Task 86bbwe530 — a shared-section push that half fails must not arm the
 * banner that wipes the hand edit it just spared.
 *
 * THE CASCADE, end to end, which is why this test drives THREE pushes rather
 * than asserting on one tally:
 *
 *   1. A page holds one clean copy of a master and one hand-edited copy. A
 *      push writes the clean one and leaves the edit alone — correct.
 *   2. That page's PATCH fails. `failed` went up and nothing else was
 *      recorded, so the toast said "1 page could not be updated. Reload and
 *      save again to finish." and said nothing about the surviving edit.
 *   3. On the retry the master has ALREADY been saved, so the "before" drift
 *      is measured against is the NEW content. The clean copy — still holding
 *      the old content because nothing was written to it — now measures as
 *      drifted too.
 *   4. Every copy on the page being drifted, the page is not written and
 *      lands in `skipped`, which is exactly what arms the editor's "1 page has
 *      local changes and was skipped. Overwrite anyway?" banner.
 *   5. Taking that offer flattens the hand edit step 1 deliberately spared.
 *
 * The fix is a copy's own lineage: the push stamps each copy it writes with a
 * hash of the content it wrote (`canonicalSourceHash`,
 * lib/builder-client/section-drift.ts), so on the retry a copy that simply was
 * not written is recognised by its own record instead of being judged against
 * a master that has moved on.
 *
 * lib/supabase.js is swapped for an in-memory recorder — same technique as
 * scripts/builder/propagationDriftSkip.test.js, with one addition that this
 * story needs: a successful PATCH writes back into the row, so the NEXT push
 * reads the state the previous one left. Without that, push 3 could not see
 * the stamp push 1 wrote, and the test would pass on a fixture rather than on
 * the round trip through the real serializer.
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

/** Normalized through the pipeline getSavedSection/updateSavedSection use. */
const MASTER_V1 = normalizeBuilderSection(section('v1'));
const MASTER_V2 = normalizeBuilderSection(section('v2'));
const MASTER_V3 = normalizeBuilderSection(section('v3'));

function pageRow(id, name, sections) {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    layout_sections: writeLayoutSectionsToRow({ pageBackground: {}, theme: {}, sections }),
    updated_at: new Date(0).toISOString(),
    created_at: new Date(0).toISOString(),
  };
}

/**
 * The recorder. `failFor` is a mutable Set of page ids whose PATCH comes back
 * refused — the serverless-freeze shape this whole ticket is about, injected
 * rather than waited for.
 */
function withMockedPagesStore(pages, failFor = new Set()) {
  const patchCalls = [];

  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => realSupabase.tableConfig(),
    sbQuery: async (opts) => {
      const isListPages = opts.method === 'GET' && opts.table === PAGES_TABLE && !/id=eq\./.test(opts.query || '');
      if (isListPages) return { ok: true, status: 200, data: pages };

      if (opts.method === 'PATCH' && opts.table === PAGES_TABLE) {
        const match = /id=eq\.(\d+)/.exec(opts.query || '');
        const id = match ? Number(match[1]) : null;
        patchCalls.push({ id, body: opts.body });
        if (failFor.has(id)) return { ok: false, status: 500, error: 'injected write failure' };
        const row = pages.find((p) => p.id === id);
        // The write lands: the next push must read what this one left.
        if (row) Object.assign(row, opts.body);
        return { ok: true, status: 200, data: [{ ...row, id }] };
      }

      if (opts.method === 'POST' && opts.table === REVISIONS_TABLE) {
        return { ok: true, status: 201, data: [{ id: 'rev', ...opts.body[0] }] };
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

  return { mod, patchCalls, restore };
}

/** The section texts a row currently holds, in order. */
function textsOf(row) {
  return row.layout_sections.sections.map((s) => s.modules[0].text);
}

/** Hand-edit one copy on a stored row, the way a page save does: content
 *  changes, the copy's lineage stamp rides along untouched. */
function handEdit(row, sectionId, text) {
  const target = row.layout_sections.sections.find((s) => s.id === sectionId);
  assert.ok(target, `no section ${sectionId} on the row to hand-edit`);
  target.modules[0].text = text;
}

test('a failed page reports the hand edit it still holds, and the retry does not offer it to "Overwrite anyway?"', async () => {
  // Two copies of one master on one page — the shape the whole bug needs, and
  // the one a single-copy fixture can never produce (landmine 17).
  const pages = [
    pageRow(1, 'Home', [section('v1')]),
    pageRow(2, 'Block States', [section('v1'), section('v1', { id: 'sec-2' })]),
  ];
  const failFor = new Set();
  const { mod, patchCalls, restore } = withMockedPagesStore(pages, failFor);

  try {
    /* -------- push 1: an ordinary, wholly successful push. It is here to
     * stamp the copies, which is what a real page's copies carry by the time
     * anything goes wrong — a copy is stamped by the push that writes it. */
    const first = await mod.propagateCanonicalSection(SAVED_SECTION_ID, MASTER_V2, null, {
      previousSection: MASTER_V1,
    });
    assert.equal(first.updated, 2, 'both pages take the ordinary push');
    assert.deepEqual(first.failedPages, [], 'nothing failed, so nothing is named as failed');

    const stamps = pages[1].layout_sections.sections.map((s) => s.canonicalSourceHash);
    assert.equal(stamps.filter(Boolean).length, 2, 'both written copies carry a lineage stamp');
    assert.ok(
      stamps[0] && /^[0-9a-f]{16}$/.test(stamps[0]),
      'and the stamp survived the round trip through the real serializer, which whitelists section fields'
    );

    /* -------- the operator hand-edits ONE copy on page 2, on the page. */
    handEdit(pages[1], 'sec-2', 'HAND-EDITED HERE');

    /* -------- push 2: the master moves to v3 and page 2's PATCH fails. */
    failFor.add(2);
    patchCalls.length = 0;
    const second = await mod.propagateCanonicalSection(SAVED_SECTION_ID, MASTER_V3, null, {
      previousSection: MASTER_V2,
    });

    assert.equal(second.updated, 1, 'Home was written');
    assert.equal(second.failed, 1, 'Block States was not');
    assert.deepEqual(
      second.failedPages,
      [{ pageId: '2', name: 'Block States', preservedCopies: 1 }],
      'the failed page is NAMED, with the hand edit still on it — the fact `failed` alone threw away'
    );
    assert.deepEqual(second.skipped, [], 'the push tried to write it, so it was not skipped');
    assert.deepEqual(
      second.writtenWithPreservedEdits,
      [],
      'and it was not written either — that bucket is a subset of updatedPages'
    );
    assert.deepEqual(textsOf(pages[1]), ['v2', 'HAND-EDITED HERE'], 'the failed page is untouched on disk');

    /* -------- push 3: the retry the toast itself advises. The master is
     * already saved, so the "before" IS the new content. */
    failFor.delete(2);
    patchCalls.length = 0;
    const retry = await mod.propagateCanonicalSection(SAVED_SECTION_ID, MASTER_V3, null, {
      previousSection: MASTER_V3,
    });

    assert.deepEqual(
      retry.skipped,
      [],
      'THE FIX: the clean copy was never written, not hand-edited — so the page is not skipped, '
        + 'and the editor arms "Overwrite anyway?" off `skipped` and only off it'
    );
    assert.deepEqual(
      retry.updatedPages,
      // Home is in here too, and that is not the fix misfiring: an ordinary
      // push rewrites every clean copy whether or not its content moved, and
      // always has. What matters is that Block States is finally among them.
      [{ pageId: '1', name: 'Home' }, { pageId: '2', name: 'Block States' }],
      'the page the first push could not reach is finally written'
    );
    assert.deepEqual(
      retry.writtenWithPreservedEdits,
      [{ pageId: '2', name: 'Block States', copies: 1 }],
      'and the hand edit on it is reported as preserved, not as something to overwrite'
    );
    assert.deepEqual(retry.overwritten, [], 'nothing was flattened');
    assert.deepEqual(
      textsOf(pages[1]),
      ['v3', 'HAND-EDITED HERE'],
      'the stale copy caught up and the hand edit survived — the whole point'
    );
  } finally {
    restore();
  }
});

test('an unstamped copy still behaves exactly as it did before — the stamp only ever clears drift', async () => {
  // Every copy on every live page is unstamped the day this ships. If the
  // absence of a stamp changed any answer, this feature would rewrite the
  // behaviour of every existing site on its first push.
  const pages = [
    pageRow(1, 'Home', [section('v1')]),
    pageRow(2, 'Rates', [section('HAND-EDITED HERE')]),
  ];
  const { mod, restore } = withMockedPagesStore(pages);
  try {
    const result = await mod.propagateCanonicalSection(SAVED_SECTION_ID, MASTER_V2, null, {
      previousSection: MASTER_V1,
    });
    assert.equal(result.updated, 1);
    assert.deepEqual(result.skipped, [{ pageId: '2', name: 'Rates' }], 'the hand-edited copy is skipped as it always was');
    assert.deepEqual(result.failedPages, []);
  } finally {
    restore();
  }
});

test('a hand edit made AFTER a push is still caught — the stamp does not launder it', async () => {
  // The failure mode that would matter most: if a stamp could make an edited
  // copy read as clean, every push would flatten hand edits silently, which is
  // the 2026-07-21 Delray incident the drift check exists to prevent.
  const pages = [pageRow(1, 'Rates', [section('v1')])];
  const { mod, restore } = withMockedPagesStore(pages);
  try {
    await mod.propagateCanonicalSection(SAVED_SECTION_ID, MASTER_V2, null, { previousSection: MASTER_V1 });
    assert.ok(pages[0].layout_sections.sections[0].canonicalSourceHash, 'the copy is stamped');

    handEdit(pages[0], 'sec-1', 'HAND-EDITED AFTER THE PUSH');

    const second = await mod.propagateCanonicalSection(SAVED_SECTION_ID, MASTER_V3, null, {
      previousSection: MASTER_V2,
    });
    assert.equal(second.updated, 0, 'nothing written');
    assert.deepEqual(second.skipped, [{ pageId: '1', name: 'Rates' }], 'the hand edit is still detected and skipped');
    assert.deepEqual(textsOf(pages[0]), ['HAND-EDITED AFTER THE PUSH'], 'and left exactly as it is');
  } finally {
    restore();
  }
});

test('a page that fails with no hand edit on it reports zero preserved copies, not a missing row', async () => {
  // "Nothing was preserved" and "we did not look" must not render the same:
  // the toast's clause is driven off the count, and an absent row would read
  // as a page that failed silently.
  const pages = [pageRow(1, 'Home', [section('v1')])];
  const failFor = new Set([1]);
  const { mod, restore } = withMockedPagesStore(pages, failFor);
  try {
    const result = await mod.propagateCanonicalSection(SAVED_SECTION_ID, MASTER_V2, null, {
      previousSection: MASTER_V1,
    });
    assert.equal(result.failed, 1);
    assert.deepEqual(result.failedPages, [{ pageId: '1', name: 'Home', preservedCopies: 0 }]);
    assert.equal(result.ok, false, 'a push that could not write every page is not ok');
  } finally {
    restore();
  }
});
