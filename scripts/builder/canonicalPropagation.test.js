'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  SECTION_LEVEL,
  MODULE_LEVEL,
  followsMaster,
  markFollowing,
  propagateCanonicalSection,
  propagateCanonicalModule,
} = require('../../lib/canonicalPropagation');

/**
 * Sync 7/7: sections and modules push through ONE engine.
 *
 * Two of these existed and they disagreed in five ways. The one that matters
 * most is that the module push was fire-and-forget — the exact serverless
 * freeze that left 20 of 50 pages stale in July (PR #21), where the response
 * goes out, the function is frozen, and the fan-out stops wherever it got to.
 *
 * The properties below are what a future edit must not quietly undo. Every one
 * of them is a bug that has already happened here at least once.
 *
 * The stores are injected (`options.deps`), so these exercise the real engine
 * against recorded writes rather than a re-implementation of it. A test that
 * re-implements the branch it is checking cannot fail.
 */

const SAVED_SECTION_ID = 'ss_footer';
const SAVED_MODULE_ID = 'dmod_cta';

/** Records every write, so a test can assert what did NOT happen too. */
function recorder({ pages = [], templates = [] } = {}) {
  const pageWrites = [];
  const templateWrites = [];
  return {
    pageWrites,
    templateWrites,
    deps: {
      listPages: async () => ({ ok: true, data: pages }),
      listPageTemplates: async () => ({ ok: true, data: templates }),
      updatePage: async (id, input, scope, options) => {
        pageWrites.push({ id, input, options });
        return { ok: true, status: 200, data: input };
      },
      updatePageTemplate: async (id, input) => {
        templateWrites.push({ id, input });
        return { ok: true, status: 200, data: input };
      },
    },
  };
}

const textModule = (extra = {}) => ({
  id: 'm1', type: 'text', column: 'main', name: '', text: 'old', settings: {}, ...extra,
});

const page = (id, name, layoutSections) => ({
  id, name, slug: String(name).toLowerCase(), pageBackground: {}, theme: {}, layoutSections,
});

/* ------------------------------------------------------------ the polarity */

test('the one polarity reads every spelling that has ever been stored', () => {
  // The written spelling, both levels.
  assert.equal(followsMaster({ savedSectionId: SAVED_SECTION_ID, canonical: true }, SECTION_LEVEL, SAVED_SECTION_ID), true);
  assert.equal(followsMaster({ savedSectionId: SAVED_SECTION_ID, canonical: false }, SECTION_LEVEL, SAVED_SECTION_ID), false);
  assert.equal(followsMaster({ savedModuleId: SAVED_MODULE_ID, canonical: true }, MODULE_LEVEL, SAVED_MODULE_ID), true);
  assert.equal(followsMaster({ savedModuleId: SAVED_MODULE_ID, canonical: false }, MODULE_LEVEL, SAVED_MODULE_ID), false);

  // The module side's legacy opt-out, which outranks a stale canonical:true a
  // push stamped before the copy was locked.
  assert.equal(followsMaster({ savedModuleId: SAVED_MODULE_ID, canonicalLocked: true }, MODULE_LEVEL, SAVED_MODULE_ID), false);
  assert.equal(
    followsMaster({ savedModuleId: SAVED_MODULE_ID, canonical: true, canonicalLocked: true }, MODULE_LEVEL, SAVED_MODULE_ID),
    false,
    'the lock wins, or locking a copy a push already touched would do nothing'
  );

  // An instance of a DIFFERENT master is never this push's business.
  assert.equal(followsMaster({ savedSectionId: 'ss_other', canonical: true }, SECTION_LEVEL, SAVED_SECTION_ID), false);
});

test('an unmarked copy keeps the default its own level has always had', () => {
  // These two defaults are the whole reason the levels differed, and flipping
  // either one silently changes what live client pages do. A section that
  // carries provenance but never opted in is a COPY; a module that carries
  // provenance and never opted out is FOLLOWING.
  assert.equal(followsMaster({ savedSectionId: SAVED_SECTION_ID }, SECTION_LEVEL, SAVED_SECTION_ID), false);
  assert.equal(followsMaster({ savedModuleId: SAVED_MODULE_ID }, MODULE_LEVEL, SAVED_MODULE_ID), true);
});

test('writing the answer emits one field and removes the other', () => {
  const written = markFollowing({ id: 'm1', savedModuleId: SAVED_MODULE_ID, canonicalLocked: true }, true);
  assert.equal(written.canonical, true);
  assert.ok(!('canonicalLocked' in written), 'two fields for one fact is how they came to disagree');
  assert.equal(markFollowing({ id: 'm1' }, false).canonical, false);
});

/* -------------------------------------------------- the module push, awaited */

test('the module push is awaited at its call site', () => {
  // The behaviour cannot be observed from outside a live serverless freeze, so
  // this guards the shape instead. `pushCanonicalModuleToPages(...).catch(() => {})`
  // is what shipped for a year: a promise nobody held, cut off mid-fan-out
  // every time the response went out first.
  const source = fs.readFileSync(require.resolve('../../routes/builder.js'), 'utf8');
  const calls = source.match(/[\w.]*propagateCanonicalModule\s*\(/g) || [];
  assert.ok(calls.length >= 1, 'the module PATCH route must still run a push');
  for (const match of source.matchAll(/(.{8})propagateCanonicalModule\s*\(/g)) {
    if (match[1].includes('{')) continue; // the import binding, not a call
    assert.match(match[1], /await\s*$/, 'every module push must be awaited');
  }
  assert.doesNotMatch(
    source,
    /propagateCanonicalModule\([^)]*\)\s*\.catch/,
    'fire-and-forget is the bug this slice exists to remove'
  );
});

test('a module push writes every following copy, banks a restore point, and groups the run', async () => {
  const pages = [
    page(1, 'Home', [{ id: 's1', modules: [textModule({ savedModuleId: SAVED_MODULE_ID })] }]),
    page(2, 'About', [{ id: 's1', modules: [textModule({ id: 'm2', savedModuleId: SAVED_MODULE_ID })] }]),
    page(3, 'Contact', [{ id: 's1', modules: [textModule({ id: 'm3' })] }]),
  ];
  const rec = recorder({ pages });

  const tally = await propagateCanonicalModule(
    SAVED_MODULE_ID,
    [{ type: 'text', name: 'CTA', text: 'new', settings: { align: 'center' } }],
    null,
    { deps: rec.deps, actor: { id: 'u1', name: 'Dane' } }
  );

  assert.equal(tally.ok, true);
  assert.equal(tally.updated, 2, 'the page with no copy of this module is not written');
  assert.equal(rec.pageWrites.length, 2);

  const runIds = new Set(rec.pageWrites.map((w) => w.options.propagationRunId));
  assert.equal(runIds.size, 1, 'one push is one undoable run');
  assert.equal(tally.runId, [...runIds][0]);
  for (const write of rec.pageWrites) {
    assert.equal(write.options.reason, 'propagate', 'module pushes never recorded an undo before this slice');
    assert.ok(write.options.previous, 'the pre-push page IS the restore point');
    assert.equal(write.options.actor.name, 'Dane');
    // Landmine 13: a page write takes the whole page, not layoutSections alone.
    assert.ok('pageBackground' in write.input && 'theme' in write.input);
  }

  const written = rec.pageWrites[0].input.layoutSections[0].modules[0];
  assert.equal(written.text, 'new');
  assert.equal(written.id, 'm1', 'an in-place replacement keeps the copy where it is');
  assert.equal(written.canonical, true, 'a written copy states the one polarity outright');
});

test('a run with nothing to write reports no run id, because an undo of nothing is a button that lies', async () => {
  const rec = recorder({ pages: [page(1, 'Home', [{ id: 's1', modules: [textModule()] }])] });
  const tally = await propagateCanonicalModule(SAVED_MODULE_ID, [{ type: 'text', text: 'new', settings: {} }], null, { deps: rec.deps });
  assert.equal(tally.updated, 0);
  assert.equal(tally.runId, '');
  assert.equal(rec.pageWrites.length, 0);
});

/* -------------------------------------------------- opt-out, at both levels */

test('a locked copy is skipped at the module level', async () => {
  const pages = [page(1, 'Home', [{
    id: 's1',
    modules: [
      textModule({ id: 'legacy', savedModuleId: SAVED_MODULE_ID, canonicalLocked: true }),
      textModule({ id: 'modern', savedModuleId: SAVED_MODULE_ID, canonical: false }),
      textModule({ id: 'following', savedModuleId: SAVED_MODULE_ID }),
    ],
  }])];
  const rec = recorder({ pages });

  const tally = await propagateCanonicalModule(SAVED_MODULE_ID, [{ type: 'text', text: 'new', settings: {} }], null, { deps: rec.deps });

  assert.equal(tally.instances.locked, 2);
  assert.equal(tally.instances.updated, 1);
  const modules = rec.pageWrites[0].input.layoutSections[0].modules;
  assert.equal(modules[0].text, 'old', 'the legacy opt-out still holds');
  assert.equal(modules[0].canonicalLocked, true, 'a skipped copy is left byte-for-byte alone');
  assert.equal(modules[1].text, 'old', 'the new spelling of the opt-out holds too');
  assert.equal(modules[2].text, 'new');
});

test('a locked copy is skipped at the section level', async () => {
  const master = { title: 'Footer', modules: [textModule({ text: 'new' })] };
  const pages = [
    page(1, 'Following', [{ id: 's1', savedSectionId: SAVED_SECTION_ID, canonical: true, modules: [textModule()] }]),
    page(2, 'Detached', [{ id: 's1', savedSectionId: SAVED_SECTION_ID, canonical: false, modules: [textModule()] }]),
    page(3, 'Unmarked', [{ id: 's1', savedSectionId: SAVED_SECTION_ID, modules: [textModule()] }]),
    page(4, 'Locked', [{ id: 's1', savedSectionId: SAVED_SECTION_ID, canonical: true, canonicalLocked: true, modules: [textModule()] }]),
  ];
  const rec = recorder({ pages });

  const tally = await propagateCanonicalSection(SAVED_SECTION_ID, master, null, { deps: rec.deps });

  assert.equal(tally.updated, 1, 'only the copy that actually follows is written');
  assert.equal(rec.pageWrites[0].id, 1);
  assert.equal(tally.instances.locked, 3);
});

test('a copy hand-edited on its own page is skipped and named, not flattened', async () => {
  const previousSection = { title: 'Footer', modules: [textModule({ text: 'old' })] };
  const updatedSection = { title: 'Footer', modules: [textModule({ text: 'new' })] };
  const pages = [
    page(1, 'Untouched', [{ id: 's1', savedSectionId: SAVED_SECTION_ID, canonical: true, ...previousSection }]),
    page(2, 'Hand edited', [{ id: 's1', savedSectionId: SAVED_SECTION_ID, canonical: true, title: 'Footer', modules: [textModule({ text: 'local wording' })] }]),
  ];
  const rec = recorder({ pages });

  const tally = await propagateCanonicalSection(SAVED_SECTION_ID, updatedSection, null, { deps: rec.deps, previousSection });

  assert.equal(tally.updated, 1);
  assert.deepEqual(tally.skipped, [{ pageId: 2, name: 'Hand edited' }]);
  assert.equal(rec.pageWrites.length, 1, 'a skipped page gets no PATCH and no revision at all');
});

/* ------------------------------------------------------------- and templates */

test('a template reference survives a section push as a reference', async () => {
  const reference = { id: 't-s1', title: 'Footer', canonical: true, savedSectionId: SAVED_SECTION_ID, modules: [] };
  const rec = recorder({ templates: [{ id: 9, layoutSections: [reference] }] });

  const tally = await propagateCanonicalSection(
    SAVED_SECTION_ID,
    { title: 'Footer', modules: [textModule({ text: 'new' })] },
    null,
    { deps: rec.deps }
  );

  assert.equal(rec.templateWrites.length, 0, 'there is nothing to do to a reference');
  assert.equal(tally.templates.total, 0);
  // Writing content back into it would recreate the second source of truth
  // cb27a65 deleted, and hand every template a header that goes stale again.
  assert.deepEqual(reference.modules, [], 'and nothing was materialized into it');
});

test('a template holding a legacy COPY is normalized down to a reference, not filled with content', async () => {
  const legacyCopy = {
    id: 't-s1',
    title: 'Footer',
    canonical: true,
    savedSectionId: SAVED_SECTION_ID,
    modules: [textModule({ text: 'six weeks old' })],
  };
  const rec = recorder({ templates: [{ id: 9, layoutSections: [legacyCopy, { id: 't-s2', modules: [textModule({ id: 'body' })] }] }] });

  const tally = await propagateCanonicalSection(
    SAVED_SECTION_ID,
    { title: 'Footer', modules: [textModule({ text: 'new' })] },
    null,
    { deps: rec.deps }
  );

  assert.equal(tally.templates.normalized, 1);
  assert.equal(rec.templateWrites.length, 1);
  const [frame, body] = rec.templateWrites[0].input.layoutSections;
  assert.deepEqual(frame, { id: 't-s1', title: 'Footer', canonical: true, savedSectionId: SAVED_SECTION_ID });
  assert.ok(!('modules' in frame), 'a reference carries no content — it resolves against the live master');
  assert.equal(body.modules[0].id, 'body', "the template's own body is not the push's business");
  assert.equal(tally.templates.undoable, false, 'templates have no revision history — shipped that way on purpose');
});

test("a module push reaches a template's body and steps over its frame", async () => {
  const templates = [{
    id: 9,
    layoutSections: [
      // A pure reference. `modules: []` is what a stored one looks like — the
      // content is resolved from the live master when the template is applied.
      { id: 't-ref', title: 'Header', canonical: true, savedSectionId: SAVED_SECTION_ID, modules: [] },
      // A LEGACY frame copy: the same link, but still carrying its own content
      // because this template has not been re-saved since cb27a65. It holds a
      // copy of the module being pushed, so it is the case that can actually
      // be written by mistake.
      {
        id: 't-legacy',
        title: 'Header',
        canonical: true,
        savedSectionId: SAVED_SECTION_ID,
        modules: [textModule({ id: 'in-frame', savedModuleId: SAVED_MODULE_ID, text: 'six weeks old' })],
      },
      { id: 't-body', modules: [textModule({ id: 'in-body', savedModuleId: SAVED_MODULE_ID })] },
    ],
  }];
  const rec = recorder({ templates });

  const tally = await propagateCanonicalModule(SAVED_MODULE_ID, [{ type: 'text', text: 'new', settings: {} }], null, { deps: rec.deps });

  assert.equal(rec.templateWrites.length, 1);
  const [reference, legacy, body] = rec.templateWrites[0].input.layoutSections;
  assert.deepEqual(reference.modules, [], 'a reference stays empty, whatever is being pushed');
  assert.equal(
    legacy.modules[0].text,
    'six weeks old',
    "a template's frame belongs to the shared section it links to — it resolves from that master, so a module push has no business writing into it"
  );
  assert.equal(body.modules[0].text, 'new', "the template's own body is content, and takes the push");
  assert.equal(tally.instances.updated, 1);
});

/* ----------------------------------------------- the multi-module run shape */

test('a multi-module run stops at a locked copy instead of swallowing it', async () => {
  // The previous version checked the lock only on the module that STARTED the
  // run, so a locked copy sitting behind a following one was replaced anyway.
  const pages = [page(1, 'Home', [{
    id: 's1',
    modules: [
      textModule({ id: 'a', savedModuleId: SAVED_MODULE_ID }),
      textModule({ id: 'b', savedModuleId: SAVED_MODULE_ID, canonicalLocked: true, text: 'keep me' }),
      textModule({ id: 'c', savedModuleId: SAVED_MODULE_ID }),
    ],
  }])];
  const rec = recorder({ pages });

  const masters = [
    { type: 'text', column: 'main', name: 'one', text: 'first', settings: {} },
    { type: 'text', column: 'main', name: 'two', text: 'second', settings: {} },
  ];
  await propagateCanonicalModule(SAVED_MODULE_ID, masters, null, { deps: rec.deps });

  const written = rec.pageWrites[0].input.layoutSections[0].modules;
  const kept = written.filter((m) => m.text === 'keep me');
  assert.equal(kept.length, 1, 'the locked copy is still there');
  assert.equal(kept[0].id, 'b');
  assert.equal(written.filter((m) => m.text === 'first').length, 2, 'the two following copies each expand to the master pair');
  assert.equal(new Set(written.map((m) => m.id)).size, written.length, 'minted ids are unique — the old ones folded in Date.now() and collided');
});
