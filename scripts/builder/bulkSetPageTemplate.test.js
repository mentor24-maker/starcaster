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

/**
 * "There is no archive" against "I could not find out whether there is one".
 *
 * The route used to render every archive-lookup failure as one string — a 500
 * from the snapshots table, a timeout and an RLS refusal all told the operator
 * `No archive with id "X" — take an archive first`, sending them off to create
 * an archive that already exists and hiding the real cause. A "could not tell"
 * rendered as a definite answer is the one thing this repo's diagnostics are
 * not allowed to do. Nothing is written in any of these cases; only the
 * sentence differs, and the sentence is the whole point.
 */
const { describeArchiveCheckFailure } = require('../../routes/builder');

test('a 404 is the ONLY answer that says the archive is absent', () => {
  const refusal = describeArchiveCheckFailure('9', { ok: false, status: 404, error: 'Snapshot not found' });
  assert.equal(refusal.status, 400);
  assert.match(refusal.error, /No archive with id "9"/);
  assert.match(refusal.error, /Take an archive first/);
  assert.match(refusal.error, /nothing was changed/);
});

test('a 400 THE STORE ITSELF RAISED says the id is not an archive id — a definite answer', () => {
  // getPageSnapshot answers 400 for anything that is not a number, and tags it
  // INVALID_SNAPSHOT_ID. The code is what makes this definite, not the status.
  const refusal = describeArchiveCheckFailure('not-a-number', {
    ok: false, status: 400, code: 'INVALID_SNAPSHOT_ID', error: 'id is required',
  });
  assert.equal(refusal.status, 400);
  assert.match(refusal.error, /"not-a-number" is not an archive id/);
});

test('a 400 from POSTGREST is a could-not-check, not "that is not an archive id"', () => {
  // getPageSnapshot returns sbQuery's envelope RAW on failure, and PostgREST
  // answers 400 for reasons that have nothing to do with the id — a malformed
  // scope filter, a column that moved. Reading the bare status reported every
  // one of those as a definite, wrong, actionable answer: go and take an
  // archive, when the archive is sitting right there.
  const refusal = describeArchiveCheckFailure('37', {
    ok: false,
    status: 400,
    error: 'column builder_page_snapshots.project_id does not exist',
  });
  assert.match(refusal.error, /Could not check whether archive "37" exists/);
  assert.match(refusal.error, /column builder_page_snapshots\.project_id does not exist/);
  assert.match(refusal.error, /not the same as having no archive/);
  assert.doesNotMatch(refusal.error, /is not an archive id/);
  assert.doesNotMatch(refusal.error, /Take an archive first/);
});

test('a 500 says the archive could not be CHECKED, and names what came back', () => {
  const refusal = describeArchiveCheckFailure('9', { ok: false, status: 500, error: 'permission denied for relation builder_page_snapshots' });
  // The real status is passed through rather than flattened to 400 — a
  // server-side fault is not the operator's input being wrong.
  assert.equal(refusal.status, 500);
  assert.match(refusal.error, /Could not check whether archive "9" exists/);
  assert.match(refusal.error, /permission denied for relation builder_page_snapshots/);
  // And it says the two are not the same thing, because that is the mistake
  // the old single string caused.
  assert.match(refusal.error, /not the same as having no archive/);
  assert.doesNotMatch(refusal.error, /Take an archive first/);
});

test('an RLS refusal and a timeout are told apart from an absent archive', () => {
  for (const status of [401, 403, 408, 502, 503]) {
    const refusal = describeArchiveCheckFailure('9', { ok: false, status, error: 'nope' });
    assert.equal(refusal.status, status, `status ${status} should pass through`);
    assert.match(refusal.error, /Could not check/);
    assert.doesNotMatch(refusal.error, /No archive with id/);
  }
});

test('a failure with no status at all is a could-not-check, never an absent archive', () => {
  // A thrown fetch or a store returning a bare object: the least information
  // there is, and the most tempting to guess about.
  for (const lookup of [{ ok: false }, {}, null, undefined, { ok: false, status: 0 }]) {
    const refusal = describeArchiveCheckFailure('9', lookup);
    assert.equal(refusal.status, 500);
    assert.match(refusal.error, /Could not check whether archive "9" exists/);
    assert.doesNotMatch(refusal.error, /undefined|NaN/);
  }
});

/**
 * The two halves of item 4 have to be tested together.
 *
 * The route decides "not an archive id" on a CODE the store attaches. Testing
 * the route against a hand-written envelope proves the route reads the code;
 * it cannot prove the store still writes it. Delete that one property and the
 * definite branch goes dead — every bad id becomes a could-not-check, which is
 * the safe direction, but nothing would say so.
 */
const { getPageSnapshot } = require('../../lib/builderPageSnapshotsStore');

test('getPageSnapshot tags ITS OWN 400, which is what the route reads', async () => {
  // Returns before it ever reaches Supabase, so this needs no database.
  const res = await getPageSnapshot('not-a-number');
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(res.code, 'INVALID_SNAPSHOT_ID');

  // And end to end: the route turns that, and only that, into the definite
  // sentence.
  const refusal = describeArchiveCheckFailure('not-a-number', res);
  assert.match(refusal.error, /is not an archive id/);
});

// ── Round 4, item 4: the guard that loaded every page in the project ────────

/**
 * The archive guard runs immediately before the write loop, in the invocation
 * least able to afford a wasted read.
 *
 * It used to call getPageSnapshot, which is `select=*` — so confirming a row
 * exists pulled that snapshot's whole `pages` blob (138 page layouts on the
 * production project) across the wire and JSON.parsed it, to answer yes or no.
 * pageSnapshotExists asks for one column and returns the SAME shapes, because
 * describeArchiveCheckFailure branches on them: its own 400 carries
 * INVALID_SNAPSHOT_ID, a missing row is a 404, and anything else is the
 * database envelope raw — a failure to look, not a finding.
 */
const supabaseModulePath = require.resolve('../../lib/supabase');
const snapshotsStorePath = require.resolve('../../lib/builderPageSnapshotsStore');
const projectScopePath = require.resolve('../../lib/projectScope');

function makeSnapshotsStore(answer) {
  for (const p of [supabaseModulePath, snapshotsStorePath, projectScopePath]) delete require.cache[p];
  const supabase = require(supabaseModulePath);
  const queries = [];
  supabase.isConfigured = () => true;
  supabase.tableConfig = () => ({ builderPageSnapshots: 'builder_page_snapshots' });
  supabase.sbQuery = async ({ method = 'GET', query = '' }) => {
    if (method === 'GET' && /select=project_id/.test(query)) {
      return { ok: false, status: 400, error: 'column does not exist' };
    }
    queries.push(query);
    return answer;
  };
  return { store: require(snapshotsStorePath), queries };
}

test('the existence check asks for one column, never the pages blob', async () => {
  const { store, queries } = makeSnapshotsStore({ ok: true, data: [{ id: 37 }] });
  const res = await store.pageSnapshotExists(37);
  assert.equal(res.ok, true);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /select=id\b/);
  assert.doesNotMatch(queries[0], /select=\*/, 'this is a yes/no, not a fetch of every page in the project');
});

test('a missing row is a 404, so the route can still say the archive is absent', async () => {
  const { store } = makeSnapshotsStore({ ok: true, data: [] });
  const res = await store.pageSnapshotExists(999999);
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
  assert.match(describeArchiveCheckFailure('999999', res).error, /No archive with id "999999"/);
});

test('an id that is not a number is tagged INVALID_SNAPSHOT_ID, exactly as before', async () => {
  const { store, queries } = makeSnapshotsStore({ ok: true, data: [] });
  const res = await store.pageSnapshotExists('not-a-number');
  assert.equal(res.status, 400);
  assert.equal(res.code, 'INVALID_SNAPSHOT_ID');
  assert.equal(queries.length, 0, 'it should not reach the database at all');
  assert.match(describeArchiveCheckFailure('not-a-number', res).error, /is not an archive id/);
});

test('a database refusal comes back RAW, so it stays a could-not-check', async () => {
  // The whole point of round 3 item 4: a 400 from PostgREST for some other
  // reason must not read as "that is not an archive id".
  const { store } = makeSnapshotsStore({ ok: false, status: 400, error: 'malformed filter' });
  const res = await store.pageSnapshotExists(37);
  assert.equal(res.ok, false);
  assert.equal(res.code, undefined, 'the store must not claim a refusal it did not raise');
  assert.match(describeArchiveCheckFailure('37', res).error, /Could not check whether archive "37" exists/);
});
