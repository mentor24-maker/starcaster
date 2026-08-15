'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildLandingPagePatch } = require('../../routes/builder');
const { inputToRow, rowToPage } = require('../../lib/builderPagesStore');

/**
 * Splitting page_template_id off the overloaded template_id.
 *
 * Tested along the whole path the value has to survive:
 *
 *   editor payload -> buildLandingPagePatch -> inputToRow -> row -> rowToPage
 *
 * Every one of those is a place a new field disappears without an error.
 * `buildLandingPagePatch` is a WHITELIST: a field it does not name is dropped,
 * the PATCH still returns 200, and the control looks like it saved. That is
 * the failure this file exists to prevent -- and it is the same shape as the
 * bug that started all of this, where a field that could not display its own
 * value invited the operator to overwrite a page.
 */

test('the two ids are separate fields all the way through', () => {
  const row = inputToRow({ templateId: 'standard-right-form', pageTemplateId: '47' });
  assert.equal(row.template_id, 'standard-right-form');
  assert.equal(row.page_template_id, '47');

  const page = rowToPage({ id: 1, template_id: 'standard-right-form', page_template_id: '47' });
  assert.equal(page.templateId, 'standard-right-form');
  assert.equal(page.pageTemplateId, '47');
});

test('pageTemplateId survives the route whitelist', () => {
  const built = buildLandingPagePatch({ pageTemplateId: '47' });
  assert.ok(!built.error);
  const patch = built.patch ?? built;
  assert.equal(patch.pageTemplateId, '47', 'must not be dropped by the whitelist');
});

test('snake_case from an API caller is accepted too', () => {
  const built = buildLandingPagePatch({ page_template_id: '12' });
  assert.equal((built.patch ?? built).pageTemplateId, '12');
});

test('setting it does NOT touch the legacy templateId', () => {
  const built = buildLandingPagePatch({ pageTemplateId: '47' });
  const patch = built.patch ?? built;
  assert.ok(
    !Object.prototype.hasOwnProperty.call(patch, 'templateId'),
    'changing the page template must not rewrite the legacy layout name'
  );
});

test('saving with a pageTemplateId does not derive a legacy templateId from the title', () => {
  // Caught locally: once the editor stopped sending templateId, the "derive a
  // slug from the name" fallback fired on EVERY save and rewrote template_id
  // from the page title — an empty column became "button-panel-check" just
  // because the page was saved.
  const built = buildLandingPagePatch({ name: 'Button Panel Check', pageTemplateId: '51' });
  const patch = built.patch ?? built;
  assert.equal(patch.name, 'Button Panel Check');
  assert.equal(patch.pageTemplateId, '51');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(patch, 'templateId'),
    'template_id must not be derived from the title when the caller manages the template'
  );
});

test('a caller that says nothing about templates still gets the derived legacy id', () => {
  // Bulk-create and older API callers rely on this; the narrowing above must
  // not take it away from them.
  const built = buildLandingPagePatch({ name: 'Brand New Page' });
  const patch = built.patch ?? built;
  assert.ok(patch.templateId, 'derivation still applies when nothing is specified');
});

test('a page with no page template reads as empty, not as its legacy layout', () => {
  // 93 of 156 production pages are in exactly this state, and the old code
  // showed them the layout name, which matched no dropdown option and rendered
  // blank -- the trap that cost the Delray home page its layout.
  const page = rowToPage({ id: 1, template_id: 'standard-right-form' });
  assert.equal(page.pageTemplateId, '', 'no page template means empty');
  assert.equal(page.templateId, 'standard-right-form', 'the legacy name is still readable');
});

test('an absent column reads as empty rather than throwing', () => {
  // Deployments that have not run the SQL yet.
  const page = rowToPage({ id: 1, name: 'x' });
  assert.equal(page.pageTemplateId, '');
});

test('clearing it writes NULL, so a template can be unset on purpose', () => {
  const row = inputToRow({ pageTemplateId: '' }, { partial: true });
  assert.ok('page_template_id' in row, 'an explicit empty must still be written');
  assert.equal(row.page_template_id, null);
});

test('a partial save that never mentions it leaves the column alone', () => {
  const row = inputToRow({ name: 'Renamed' }, { partial: true });
  assert.ok(!('page_template_id' in row), 'untouched fields must not be written');
});

const MIGRATION = path.join(
  __dirname, '..', '..', 'docs', 'SQL', 'builder_landing_page_page_template_id.sql'
);

test('the migration only claims all-digit values, and only within one project', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS page_template_id/i);
  assert.match(sql, /\^\[0-9\]\+\$/, 'backfill must require an all-digits template_id');
  assert.match(sql, /t\.project_id\s*=\s*p\.project_id/i, 'backfill must not cross tenants');
  // Additive only: leaving template_id alone is what makes this reversible.
  assert.doesNotMatch(sql, /SET\s+template_id/i, 'must not rewrite the legacy column');
  assert.doesNotMatch(sql, /DROP\s+COLUMN/i, 'must not drop anything');
});

test('every BUILT-IN template id is migrated too, or pages silently lose theirs', () => {
  // routes/builder.js injects stub templates that have no database row but ARE
  // valid ids in the Template dropdown. A backfill that only understands
  // numeric row ids would move those pages from "Standard Right-Form" to
  // "No template" — the same class of lie this whole change exists to end.
  //
  // This test is the tie between the two files: add a built-in without adding
  // it to the migration and it fails here, naming the id.
  const routes = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'builder.js'), 'utf8');
  const block = /BUILT_IN_PAGE_TEMPLATES\s*=\s*\[([\s\S]*?)\];/.exec(routes);
  assert.ok(block, 'BUILT_IN_PAGE_TEMPLATES must still be findable in routes/builder.js');

  const builtInIds = [...block[1].matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(builtInIds.length > 0, 'expected at least one built-in template');

  const sql = fs.readFileSync(MIGRATION, 'utf8');
  for (const id of builtInIds) {
    assert.ok(
      sql.includes(`'${id}'`),
      `built-in template "${id}" is offered by the dropdown but the migration does not claim it — ` +
      `add it to the IN (...) list in ${path.basename(MIGRATION)}`
    );
  }
});

test('the generated server bundle knows pageTemplateId (landmine 1)', () => {
  // lib/builder/template.js is generated from builder-template.ts. If the
  // regen is skipped the server silently loses the field on every page load.
  const bundle = fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', 'builder', 'template.js'),
    'utf8'
  );
  assert.match(bundle, /page_template_id/, 'run `npm run build:builder-template`');
});
