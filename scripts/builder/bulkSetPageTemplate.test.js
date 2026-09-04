'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { describeBulkTemplateTarget } = require('../../lib/builderPagesStore');

/**
 * Which page templates a bulk template change is allowed to target.
 *
 * Why it exists: the bulk Change Template action RE-POURS every selected page
 * — it replaces each page's sections with the chosen template's. The operator
 * was shown the 2026-08-14 incident, in which exactly that operation emptied
 * 35 sections off the live Delray home page, and chose it anyway (2026-09-01).
 * So the archive is the undo, and this predicate is the thing that stops the
 * operation being pointed somewhere that makes the archive necessary.
 *
 * The ticket asked for the picker to offer "the same templates the Template
 * filter lists". Measured on the code before building, that list carries three
 * things a WRITE surface cannot accept, and one of them is the incident:
 *
 *  - the built-in stub, which routes/builder.js declares with an EMPTY layout.
 *    Five production pages carry its id. Applying it does not change a
 *    template; it deletes the content of every selected page.
 *  - email templates. builder_page_templates holds both kinds in one table —
 *    20 of the 32 rows in the production copy are email — so "Newsletter
 *    Basic" sits in the filter list beside real page templates.
 *  - starter templates, whose layouts are assembled in the browser and cannot
 *    be resolved server-side at all.
 *
 * Each property below is one of those, plus the ordinary happy path. Break any
 * one and the operation silently empties pages instead of re-templating them.
 */

const modularTemplate = {
  id: '27',
  name: 'Standard Page',
  templateKind: 'modular',
  layoutSections: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
};

test('a real modular template with sections is accepted, and carries its sections through', () => {
  const target = describeBulkTemplateTarget(modularTemplate, '27');
  assert.equal(target.ok, true);
  assert.equal(target.id, '27');
  assert.equal(target.name, 'Standard Page');
  assert.equal(target.sections.length, 3);
});

test('a template that resolves to nothing is refused, not guessed at', () => {
  const target = describeBulkTemplateTarget(null, 'no-such-template-xyz');
  assert.equal(target.ok, false);
  assert.equal(target.status, 404);
  // The message names the id it could not find, so the operator is not left
  // reading "something went wrong".
  assert.match(target.error, /no-such-template-xyz/);
});

test('an EMPTY layout is refused — this is the 2026-08-14 incident', () => {
  const target = describeBulkTemplateTarget(
    { id: 'standard-right-form', name: 'Standard Right-Form', templateKind: 'modular', layoutSections: [] },
    'standard-right-form',
  );
  assert.equal(target.ok, false);
  assert.equal(target.status, 400);
  assert.match(target.error, /Standard Right-Form/);
  // The refusal has to say what applying it would DO, or it reads as a bug in
  // the feature rather than as the feature protecting the pages.
  assert.match(target.error, /empty every selected page/);
});

test('a missing layoutSections array is treated as empty, not as unknown', () => {
  const target = describeBulkTemplateTarget(
    { id: '99', name: 'Half-Saved Template', templateKind: 'modular' },
    '99',
  );
  assert.equal(target.ok, false);
  assert.match(target.error, /no sections/);
});

test('an email template is refused by kind, before its layout is even considered', () => {
  // Email templates DO have a section, so a sections-only check would let this
  // through and pour an email body onto a web page.
  const target = describeBulkTemplateTarget(
    { id: '11', name: 'Newsletter Basic', templateKind: 'email', layoutSections: [{ id: 'block' }] },
    '11',
  );
  assert.equal(target.ok, false);
  assert.equal(target.status, 400);
  assert.match(target.error, /Newsletter Basic/);
  assert.match(target.error, /email template/);
});

test('a template with no name is still named in the refusal', () => {
  // "" would render as `"" is an email template`, which tells the operator
  // nothing about which row to go and look at.
  const target = describeBulkTemplateTarget(
    { id: '42', name: '', templateKind: 'email', layoutSections: [{ id: 'block' }] },
    '42',
  );
  assert.equal(target.ok, false);
  assert.match(target.error, /Template 42/);
});

/**
 * The archive-first rule, at the route's own door.
 *
 * The dialog takes an archive and only then calls the endpoint. That ordering
 * is the entire undo for an operation that replaces the content of every
 * selected page, and it must not live only in the browser — a stale bundle, a
 * retried request or a direct API call all arrive with no archive behind them.
 */
const { readBulkSetTemplateRequest } = require('../../routes/builder');

test('a request with pages, a template and an archive is accepted', () => {
  const request = readBulkSetTemplateRequest({ pageIds: ['1', '2'], pageTemplateId: '47', snapshotId: '9' });
  assert.equal(request.ok, true);
  assert.deepEqual(request.pageIds, ['1', '2']);
  assert.equal(request.pageTemplateId, '47');
  assert.equal(request.snapshotId, '9');
});

test('no archive means no change — the request is refused outright', () => {
  const request = readBulkSetTemplateRequest({ pageIds: ['1'], pageTemplateId: '47' });
  assert.equal(request.ok, false);
  assert.equal(request.status, 400);
  assert.match(request.error, /take an archive before changing templates in bulk/);
});

test('an empty or whitespace archive id counts as no archive', () => {
  for (const snapshotId of ['', '   ', null, undefined]) {
    const request = readBulkSetTemplateRequest({ pageIds: ['1'], pageTemplateId: '47', snapshotId });
    assert.equal(request.ok, false, `snapshotId ${JSON.stringify(snapshotId)} should be refused`);
  }
});

test('no pages and no template are each refused before the archive is considered', () => {
  assert.match(readBulkSetTemplateRequest({ pageTemplateId: '47', snapshotId: '9' }).error, /pageIds/);
  assert.match(readBulkSetTemplateRequest({ pageIds: ['1'], snapshotId: '9' }).error, /pageTemplateId/);
  // An empty array is not "all pages" — landmine 16's shape, one lane over.
  assert.equal(readBulkSetTemplateRequest({ pageIds: [], pageTemplateId: '47', snapshotId: '9' }).ok, false);
});

test('a missing or non-object body is refused rather than throwing', () => {
  for (const body of [null, undefined, 'nonsense', 7]) {
    assert.equal(readBulkSetTemplateRequest(body).ok, false);
  }
});
