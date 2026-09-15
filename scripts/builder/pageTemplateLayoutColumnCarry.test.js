'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * SAVING A MODULE ON A PAGE TEMPLATE USED TO WIPE 32 OF ITS COLUMNS
 * (2026-09-14, task 86bc0kq2u).
 *
 * Two separate defects in one write path, and fixing either alone leaves the
 * other:
 *
 * 1. `inputToRow` was NOT partial. It rebuilt every column from the patch, so
 *    every column the caller did not name was written as its default. The
 *    Builder's module save names three fields, so it blanked the other 31 --
 *    summary on 31 of the 44 stored templates, template_id on all 44, and
 *    template_kind flipped from `starcaster_landing` to `modular` on 31, which
 *    changes what the template IS.
 *
 * 2. `layout_sections` is ONE column holding the sections, the page background
 *    AND the theme, so partial columns cannot save the theme: the patch
 *    legitimately names `layoutSections`, the column is rebuilt, and
 *    `theme: undefined` becomes the serializer's default. Four templates carry
 *    a theme of their own, and pages built from a template inherit it, so the
 *    loss spread past the template. Landmine 13's shape, in the sibling store.
 *
 * The exact payload below is what `saveCreatedModule` and `deleteCreatedModule`
 * (components/admin-builder-editor.tsx) PATCH to
 * /api/admin/page-templates/<id>: `{name, pageBackground, layoutSections}`,
 * and no theme.
 *
 * THESE TESTS DRIVE THE REAL `updatePageTemplate`, not the helper. That is the
 * point (it is an acceptance criterion on the ticket): deleting the carry's
 * CALL SITE while leaving the helper perfectly correct has to fail something.
 * A helper-only test passes a store that never calls it.
 */

const LIB = path.join(__dirname, '..', '..', 'lib');

// The stubs must be installed BEFORE the store is required: it destructures
// sbQuery and the scope helpers at module load, so a later assignment would
// never be seen.
function loadStoreWithStubs(storedRow) {
  for (const mod of ['supabase.js', 'projectScope.js', 'builderPageTemplatesStore.js']) {
    delete require.cache[require.resolve(path.join(LIB, mod))];
  }
  const supa = require(path.join(LIB, 'supabase.js'));
  const scope = require(path.join(LIB, 'projectScope.js'));

  const calls = { patchBody: null, reads: 0 };
  supa.sbQuery = async (opts) => {
    if (opts.method === 'PATCH') {
      calls.patchBody = opts.body;
      return { ok: true, status: 200, data: [{ ...storedRow }] };
    }
    if (opts.method === 'POST') {
      calls.insertBody = Array.isArray(opts.body) ? opts.body[0] : opts.body;
      return { ok: true, status: 201, data: [{ ...storedRow }] };
    }
    calls.reads += 1;
    return { ok: true, status: 200, data: [{ ...storedRow }] };
  };
  supa.tableConfig = () => ({ builderPageTemplates: 'builder_page_templates' });
  scope.scopedPatchRow = async (_table, row) => row;
  scope.scopedIdQuery = async (_table, query) => query;
  scope.scopedListQuery = async (_table, query) => query;
  scope.scopedInsertRow = async (_table, row) => row;

  const store = require(path.join(LIB, 'builderPageTemplatesStore.js'));
  return { store, calls };
}

const STORED_THEME = {
  typography: { scale: { h1: 40, h2: 30, h3: 24, h1Lh: 1.4, h1Fw: 900 } },
};

function storedRow(overrides = {}) {
  return {
    id: 33,
    name: 'Admin Dashboard',
    template_kind: 'starcaster_landing',
    template_id: 'tpl-admin',
    summary: 'The admin dashboard template',
    subject: 'Welcome',
    primary_color: '#112233',
    form_id: 'form-9',
    headline_id: 'hl-1',
    feature_title: 'Feature',
    content_overrides: { a: 1 },
    layout_sections: JSON.stringify({
      sections: [{ id: 's1', modules: [] }],
      pageBackground: { color: '#eeeeee' },
      theme: STORED_THEME,
    }),
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

// The editor's real payload for saving or deleting one created module.
const EDITOR_SAVE = {
  name: 'Admin Dashboard',
  pageBackground: { color: '#eeeeee' },
  layoutSections: [{ id: 's1', modules: [{ id: 'm1', type: 'text' }] }],
};

function writtenLayout(calls) {
  const raw = calls.patchBody.layout_sections;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

test('the editor saving a module leaves the template theme exactly as it was', async () => {
  const { store, calls } = loadStoreWithStubs(storedRow());
  await store.updatePageTemplate(33, EDITOR_SAVE);

  const scale = writtenLayout(calls).theme.typography.scale;
  for (const [key, value] of Object.entries(STORED_THEME.typography.scale)) {
    assert.equal(
      scale[key],
      value,
      `theme.typography.scale.${key} must survive a module save — the Builder's `
        + 'PATCH names no theme, so without the carry the serializer writes its default'
    );
  }
});

test('the editor saving a module leaves the other 31 columns alone', async () => {
  const row = storedRow();
  const { store, calls } = loadStoreWithStubs(row);
  await store.updatePageTemplate(33, EDITOR_SAVE);

  // Only the three fields the patch actually names may appear in the write.
  const written = Object.keys(calls.patchBody).sort();
  assert.deepEqual(
    written,
    ['layout_sections', 'name'],
    'a partial patch must write only the columns it names (plus the layout '
      + 'column it touches) — writing the rest blanks template_kind, template_id '
      + 'and summary on real templates'
  );
  assert.equal(
    calls.patchBody.template_kind,
    undefined,
    'template_kind must not be rewritten by a module save — it flipped '
      + 'starcaster_landing to modular on 31 of 44 production templates'
  );
});

test('a patch that DOES name a theme still wins', async () => {
  const { store, calls } = loadStoreWithStubs(storedRow());
  await store.updatePageTemplate(33, {
    ...EDITOR_SAVE,
    theme: { typography: { scale: { h1: 99 } } },
  });
  assert.equal(
    writtenLayout(calls).theme.typography.scale.h1,
    99,
    'an explicit theme must override the stored one, or the theme editor cannot save'
  );
});

test('an EMPTY theme is a deliberate reset, not a missing field', async () => {
  const { store, calls } = loadStoreWithStubs(storedRow());
  await store.updatePageTemplate(33, { ...EDITOR_SAVE, theme: {} });

  const scale = writtenLayout(calls).theme.typography.scale;
  assert.equal(
    scale.h1,
    undefined,
    'naming theme as {} is how a template is reset to the defaults — the carry '
      + 'asks whether the KEY is present, never whether the value is truthy'
  );
});

test('theme: null is a deliberate reset, not an absent field', async () => {
  // `{}` cannot tell these two apart -- it is truthy, so a carry written as
  // `if (!input.theme)` behaves identically and the test above passes on a
  // broken store (found by break-testing, 2026-09-14). `null` is the case that
  // separates them: key PRESENT means the caller said something, whatever the
  // value, and the carry must stand aside. This is the same rule #699 gives
  // pages, and the two stores have to agree or a template and a page reset
  // differently.
  const { store, calls } = loadStoreWithStubs(storedRow());
  await store.updatePageTemplate(33, { ...EDITOR_SAVE, theme: null });

  assert.equal(
    writtenLayout(calls).theme.typography.scale.h1,
    undefined,
    'naming theme as null must reset it, not silently restore the stored theme — '
      + 'the carry asks whether the KEY is present, never whether the value is truthy'
  );
});

test('pageBackground is carried the same way, and an explicit one still wins', async () => {
  const carried = loadStoreWithStubs(storedRow());
  await carried.store.updatePageTemplate(33, {
    name: 'Admin Dashboard',
    layoutSections: EDITOR_SAVE.layoutSections,
  });
  assert.equal(
    writtenLayout(carried.calls).pageBackground.color,
    '#eeeeee',
    'a layout patch naming no pageBackground must keep the stored one'
  );

  const explicit = loadStoreWithStubs(storedRow());
  await explicit.store.updatePageTemplate(33, {
    ...EDITOR_SAVE,
    pageBackground: { color: '#000000' },
  });
  assert.equal(
    writtenLayout(explicit.calls).pageBackground.color,
    '#000000',
    'an explicit pageBackground must override the stored one'
  );
});

test('a metadata-only save pays for no read and does not touch the layout column', async () => {
  const { store, calls } = loadStoreWithStubs(storedRow());
  await store.updatePageTemplate(33, { summary: 'Renamed summary' });

  assert.equal(calls.reads, 0, 'only a layout save should pay for the previous-row read');
  assert.equal(
    calls.patchBody.layout_sections,
    undefined,
    'a patch naming no part of the layout column must leave that column alone'
  );
  assert.equal(calls.patchBody.summary, 'Renamed summary');
});

test('creating a template still builds the full row', async () => {
  const { store, calls } = loadStoreWithStubs(storedRow());
  await store.createPageTemplate({ name: 'Fresh' });

  // A new row genuinely wants a default in every column the caller left out;
  // `partial` is an UPDATE concern only. Without this, a later tidy-up that
  // makes create partial too would insert rows with columns simply absent.
  const inserted = calls.insertBody;
  assert.ok(inserted, 'createPageTemplate must POST a row');
  for (const column of [
    'name', 'template_kind', 'template_id', 'summary', 'subject',
    'primary_color', 'background_color', 'accent_color', 'form_id',
    'content_overrides', 'layout_sections',
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(inserted, column),
      `create must write ${column} even though the caller did not name it — `
        + 'partial is an update concern only'
    );
  }
  assert.equal(inserted.name, 'Fresh');
});

test('the carry fires on exactly the patches that rebuild the layout column', () => {
  const { store } = loadStoreWithStubs(storedRow());
  const { touchesLayoutColumn, mergeLayoutColumnFromPrevious } = store;

  // One predicate drives both the rebuild and the carry. If they ever disagree,
  // a patch can rebuild the column with the carry asleep — the original bug,
  // through a different door.
  for (const key of ['layoutSections', 'layout_sections', 'pageBackground', 'page_background', 'theme']) {
    assert.equal(touchesLayoutColumn({ [key]: {} }), true, `${key} must count as touching the layout column`);
  }
  assert.equal(touchesLayoutColumn({ summary: 'x' }), false);

  // Without a previous row there is nothing to carry, and the old behaviour
  // stands rather than the save failing.
  const input = { layoutSections: [] };
  assert.equal(mergeLayoutColumnFromPrevious(input, null), input);
});

/**
 * THE ROUTE HALF (task 86bc0kq2u).
 *
 * The store's carry asks whether a field was NAMED, and a JavaScript object
 * literal names every key it lists whether the caller sent a value or not:
 * `{ theme: body.theme }` has an own `theme` property even when `body` has
 * none. So the route used to defeat the carry from above -- the key arrived
 * present with value `undefined`, the carry correctly stood aside, and the
 * serializer wrote its default anyway.
 *
 * This was NOT caught by the store tests above, which all passed while the
 * real editor save still lost its theme. Found by tracing the editor's PATCH
 * through `builderAdminFetch` to routes/builder.js rather than stopping at the
 * store, and it is why the fix is in two places.
 */

const { buildPageTemplatePatch } = require('../../routes/builder');

// What saveCreatedModule / deleteCreatedModule actually send.
const EDITOR_BODY = { name: 'Admin Dashboard', pageBackground: { color: '#eee' }, layoutSections: [] };

test('the route passes through only the fields the request named', () => {
  const patch = buildPageTemplatePatch(EDITOR_BODY, 'Admin Dashboard');
  assert.deepEqual(
    Object.keys(patch).sort(),
    ['layoutSections', 'name', 'pageBackground'],
    'the route must not name fields the caller did not send — naming them all '
      + 'is what blanked summary, template_id and template_kind, and what '
      + 'defeated the store carry for theme'
  );
});

test('the route does not name theme when the request did not', () => {
  const patch = buildPageTemplatePatch(EDITOR_BODY, 'Admin Dashboard');
  assert.equal(
    Object.prototype.hasOwnProperty.call(patch, 'theme'),
    false,
    'an absent theme must stay ABSENT through the route — a key present with '
      + 'value undefined reads to the store as "the caller said reset it"'
  );
});

test('the route still passes an explicit theme through, including a reset', () => {
  const explicit = buildPageTemplatePatch(
    { ...EDITOR_BODY, theme: { typography: { scale: { h1: 99 } } } },
    'Admin Dashboard'
  );
  assert.equal(explicit.theme.typography.scale.h1, 99, 'the template settings dialog must still be able to save a theme');

  const reset = buildPageTemplatePatch({ ...EDITOR_BODY, theme: {} }, 'Admin Dashboard');
  assert.ok(
    Object.prototype.hasOwnProperty.call(reset, 'theme'),
    'naming theme as {} is a deliberate reset and must reach the store as a named field'
  );
  assert.deepEqual(reset.theme, {});
});

test('the route does not re-derive template_id on a save that is not setting identity', () => {
  const moduleSave = buildPageTemplatePatch(EDITOR_BODY, 'Admin Dashboard');
  assert.equal(
    Object.prototype.hasOwnProperty.call(moduleSave, 'templateId'),
    false,
    'template_id was re-derived from the name on every patch — already the '
      + 'slugified name on 38 of 44 production templates, a silent change of a '
      + 'reference key on the other 6'
  );

  const identitySave = buildPageTemplatePatch({ ...EDITOR_BODY, slug: 'admin-dash' }, 'Admin Dashboard');
  assert.equal(identitySave.templateId, 'admin-dash', 'naming a slug still sets the template id');
});

test('the route keeps the editor payload lossless end to end', () => {
  // The whole chain in one assertion: editor body -> route patch -> store ->
  // PATCH body. This is the test that would have failed while every store test
  // above passed.
  const { store, calls } = loadStoreWithStubs(storedRow());
  const patch = buildPageTemplatePatch(
    { name: 'Admin Dashboard', pageBackground: { color: '#eeeeee' }, layoutSections: [{ id: 's1', modules: [] }] },
    'Admin Dashboard'
  );
  return store.updatePageTemplate(33, patch).then(() => {
    const scale = writtenLayout(calls).theme.typography.scale;
    for (const [key, value] of Object.entries(STORED_THEME.typography.scale)) {
      assert.equal(scale[key], value, `theme.typography.scale.${key} must survive the ROUTE as well as the store`);
    }
    assert.equal(calls.patchBody.template_kind, undefined, 'a module save must not rewrite template_kind');
    assert.equal(calls.patchBody.summary, undefined, 'a module save must not rewrite summary');
  });
});
