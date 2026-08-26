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
const { readLayoutSectionsFromRow } = require('../../lib/builder');

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

/* ----------------------------- the template write, through the REAL store */

/**
 * Every test above injects a fake `updatePageTemplate` that records
 * `{ id, input }` and stops there. That is the right shape for asking WHICH
 * templates a push reaches — and it is exactly why the first cut of this PR
 * shipped a template write that blanked the template.
 *
 * `inputToRow` in lib/builderPageTemplatesStore.js builds all 34 columns
 * unconditionally from `input?.x`, and `safeText(undefined)` is `''`. So a
 * partial `{ layoutSections }` is not a one-column patch: it PATCHes every
 * column and empties the 33 it never mentioned. A template named
 * "Delray — Main Site Template" came back named "". There is no revision row
 * for a template, so there is nothing to restore it from.
 *
 * These run the real store with only `sbQuery` — the database call itself —
 * stubbed, so the column-building actually happens and the test can read the
 * body that would have gone over the wire.
 */

const REAL_STORE_PATHS = {
  supabase: require.resolve('../../lib/supabase'),
  projectScope: require.resolve('../../lib/projectScope'),
  store: require.resolve('../../lib/builderPageTemplatesStore'),
};

/** A template row with every column carrying a value worth losing. */
function populatedTemplateRow(layoutSections) {
  return {
    id: 7,
    name: 'Delray — Main Site Template',
    template_kind: 'modular',
    template_id: 'tpl_delray',
    email_function: 'magic_link',
    summary: 'The main site template',
    subject: 'Welcome to Delray Beach Tennis Center',
    email_slug: 'delray-main',
    primary_color: '#1f6feb',
    background_color: '#ffffff',
    accent_color: '#f0b429',
    form_id: 'form_1',
    lead_magnet_id: 'lm_1',
    headline_id: 'hl_1',
    pitch_id: 'pi_1',
    cta_id: 'cta_1',
    website_banner_image_id: 'img_banner',
    background_image_id: 'img_bg',
    feature_image_id: 'img_feature',
    highlight_image_id: 'img_highlight',
    feature_headline_id: 'fh_1',
    feature_subheading_id: 'fs_1',
    feature_title: 'Book a court',
    feature_copy: 'Courts are open seven days a week.',
    highlight_headline_id: 'hh_1',
    highlight_pitch_id: 'hp_1',
    highlight_title: 'Junior programs',
    highlight_copy: 'Coaching for every age.',
    body_headline_id: 'bh_1',
    body_subheading_id: 'bs_1',
    body_pitch_id: 'bp_1',
    logo_wide_id: 'logo_wide',
    logo_square_id: 'logo_square',
    content_overrides: { greeting: 'Hello' },
    layout_sections: {
      pageBackground: { color: '#101010' },
      theme: { typography: { scale: { baseSize: 18, baseLineHeight: 1.6 } } },
      sections: layoutSections,
    },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  };
}

/**
 * Load a FRESH copy of the real template store with `lib/supabase` replaced by
 * a stub. The store and projectScope both destructure `sbQuery` at require
 * time, so patching the module object afterwards would not reach them — both
 * have to be evicted and re-required behind the stub.
 */
function realTemplateStoreWithStubbedDatabase(row) {
  const saved = {};
  Object.values(REAL_STORE_PATHS).forEach((p) => { saved[p] = require.cache[p]; });

  const patches = [];
  require.cache[REAL_STORE_PATHS.supabase] = {
    id: REAL_STORE_PATHS.supabase,
    filename: REAL_STORE_PATHS.supabase,
    loaded: true,
    exports: {
      tableConfig: () => ({ builderPageTemplates: 'builder_page_templates' }),
      sbQuery: async ({ method = 'GET', body }) => {
        if (method === 'PATCH') {
          patches.push(body);
          return { ok: true, status: 200, data: [{ ...row, ...body }] };
        }
        return { ok: true, status: 200, data: [row] };
      },
    },
  };
  delete require.cache[REAL_STORE_PATHS.projectScope];
  delete require.cache[REAL_STORE_PATHS.store];

  const store = require('../../lib/builderPageTemplatesStore');

  const restore = () => {
    Object.entries(saved).forEach(([p, mod]) => {
      if (mod) require.cache[p] = mod;
      else delete require.cache[p];
    });
  };
  return { store, patches, restore };
}

test('a section push through the REAL template store leaves the rest of the template alone', async () => {
  // A legacy full COPY of the shared section, which is the case the push
  // normalizes down to a reference - so this write fires on the first push.
  const row = populatedTemplateRow([
    { id: 's1', savedSectionId: SAVED_SECTION_ID, canonical: true, modules: [textModule()] },
  ]);
  const { store, patches, restore } = realTemplateStoreWithStubbedDatabase(row);

  try {
    const tally = await propagateCanonicalSection(
      SAVED_SECTION_ID,
      { id: 'master', savedSectionId: SAVED_SECTION_ID, modules: [textModule({ text: 'new' })] },
      null,
      {
        deps: {
          listPages: async () => ({ ok: true, data: [] }),
          updatePage: async () => ({ ok: true, status: 200 }),
          listPageTemplates: store.listPageTemplates,
          updatePageTemplate: store.updatePageTemplate,
        },
      }
    );

    assert.equal(tally.templates.failed, 0, 'the template write should succeed');
    assert.equal(tally.templates.updated, 1, 'the template should have been written once');
    assert.equal(patches.length, 1, 'exactly one PATCH should have gone to the database');

    const written = patches[0];

    // The reviewer's specific ask: the name survives.
    assert.equal(
      written.name,
      'Delray — Main Site Template',
      'the template name must survive a section push'
    );

    // And so does everything else the blanking write took with it.
    assert.equal(written.subject, 'Welcome to Delray Beach Tennis Center');
    assert.equal(written.primary_color, '#1f6feb');
    assert.equal(written.background_color, '#ffffff');
    assert.equal(written.accent_color, '#f0b429');
    assert.equal(written.feature_title, 'Book a court');
    assert.equal(written.feature_copy, 'Courts are open seven days a week.');
    assert.equal(written.highlight_title, 'Junior programs');
    assert.equal(written.feature_image_id, 'img_feature');
    assert.equal(written.logo_wide_id, 'logo_wide');
    assert.equal(written.template_id, 'tpl_delray');
    assert.equal(written.email_function, 'magic_link');
    assert.deepEqual(written.content_overrides, { greeting: 'Hello' });

    // layout_sections carries pageBackground and theme in the same column, so
    // a partial write reset those too. Compare the documents rather than the
    // raw column: the serializer fills in its own defaults, so the value that
    // comes back is normalized, not identical.
    const before = readLayoutSectionsFromRow(row);
    const after = readLayoutSectionsFromRow(written);
    assert.deepEqual(after.pageBackground, before.pageBackground, 'pageBackground must not reset');
    assert.deepEqual(after.theme, before.theme, 'theme must not reset');
    assert.equal(after.pageBackground.color, '#101010');
    assert.equal(after.theme.typography.scale.baseSize, 18);
    assert.equal(after.theme.typography.scale.baseLineHeight, 1.6);

    // The push still did its actual job: the legacy copy is now a reference.
    // The serializer expands a bare reference back out to a full section and
    // gives it `modules: []`, so "carries no content" is an EMPTY module list
    // here rather than an absent one - it resolves against the live master.
    assert.equal(tally.templates.normalized, 1, 'the legacy copy should be normalized');
    const pushed = after.layoutSections[0];
    assert.equal(pushed.savedSectionId, SAVED_SECTION_ID);
    assert.equal(pushed.canonical, true);
    assert.equal(pushed.modules.length, 0, 'a normalized copy keeps no content of its own');

    // No column may be blank that was not blank before.
    const emptied = Object.entries(written)
      .filter(([key, value]) => value === '' && row[key])
      .map(([key]) => key);
    assert.deepEqual(emptied, [], `these columns were blanked by the write: ${emptied.join(', ')}`);
  } finally {
    restore();
  }
});

test('every column inputToRow writes is one rowToPageTemplate reads back', async () => {
  // The spread above is only safe while the store's two halves stay a matched
  // pair. Add a column to `inputToRow` and forget `rowToPageTemplate`, and the
  // spread silently blanks it again - with no revision row to notice from.
  const row = populatedTemplateRow([
    { id: 's1', savedSectionId: SAVED_SECTION_ID, canonical: true, modules: [textModule()] },
  ]);
  const { store, patches, restore } = realTemplateStoreWithStubbedDatabase(row);

  try {
    // Read the row out through the store, then hand it straight back in
    // unchanged. Nothing should move.
    const listed = await store.listPageTemplates(10, null);
    const template = listed.data[0];
    await store.updatePageTemplate(row.id, template, null);

    const written = patches[0];
    Object.keys(written).forEach((column) => {
      if (column === 'layout_sections') return; // compared field-by-field below
      assert.deepEqual(
        written[column],
        row[column],
        `${column} did not round-trip: inputToRow writes it, rowToPageTemplate does not read it back`
      );
    });
    // Same as above: compare the normalized documents, since the serializer
    // fills its own defaults in on the way through.
    const before = readLayoutSectionsFromRow(row);
    const after = readLayoutSectionsFromRow(written);
    assert.deepEqual(after.pageBackground, before.pageBackground);
    assert.deepEqual(after.theme, before.theme);
    assert.deepEqual(after.layoutSections, before.layoutSections);
  } finally {
    restore();
  }
});
