'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * The bulk template change, end to end through a fake database.
 *
 * The predicate tests beside this one cover which templates may be targeted.
 * These cover what actually happens to a page when one is, and every property
 * here is an incident this repo has already paid for:
 *
 *  - the sections are replaced with the template's (the feature)
 *  - the page's OWN pageBackground and theme survive (landmine 13 — naming any
 *    of the three makes the serializer write all three, so a write that sends
 *    layoutSections alone silently blanks the other two)
 *  - each page is read back after writing and the answer says whether it
 *    matched (2026-08-16: fourteen pages emptied, every write reporting
 *    success)
 *  - a page that fails does not stop the others, and is named
 */

const supabasePath = require.resolve('../../lib/supabase');
const storePath = require.resolve('../../lib/builderPagesStore');
const templatesPath = require.resolve('../../lib/builderPageTemplatesStore');
const revisionsPath = require.resolve('../../lib/builderPageRevisionsStore');
const scopePath = require.resolve('../../lib/projectScope');

function makeStore({ pages, templates, failPageIds = [], silentlyDropPageIds = [], blindReadBackPageIds = [] }) {
  for (const p of [supabasePath, storePath, templatesPath, revisionsPath, scopePath]) {
    delete require.cache[p];
  }
  const supabase = require(supabasePath);
  const rows = pages.map((r) => ({ ...r }));
  const written = new Set();
  // Every call the store makes, in order. What a write path COSTS is part of
  // its behaviour here: this runs on a serverless function that has already
  // truncated a 50-page canonical propagation at 30, so an avoidable read per
  // page is a page that does not get changed at the top of the range.
  const calls = [];

  supabase.isConfigured = () => true;
  supabase.tableConfig = () => ({
    builderPages: 'builder_landing_page',
    builderPageTemplates: 'builder_page_templates',
    builderPageRevisions: 'builder_page_revisions',
  });
  supabase.sbQuery = async ({ method = 'GET', table = '', query = '', body }) => {
    // The tenant-column probe (lib/projectScope). Say no: these tests run with
    // no scope, so scoping is not what they are about.
    if (method === 'GET' && /select=project_id/.test(query)) {
      return { ok: false, status: 400, error: 'column does not exist' };
    }
    calls.push({ method, table, query, body });
    if (table === 'builder_page_revisions') return { ok: true, data: [] };
    if (table === 'builder_page_templates') {
      return { ok: true, data: templates.map((t) => ({ ...t })) };
    }
    if (table === 'builder_landing_page') {
      const id = (query.match(/id=eq\.(\d+)/) || [])[1];
      if (method === 'GET') {
        // Only the read-back is blinded, not the read the write itself needs —
        // otherwise the test would be about a page that cannot be loaded.
        if (blindReadBackPageIds.map(String).includes(String(id)) && written.has(String(id))) {
          return { ok: false, status: 500, error: 'read failed' };
        }
        const row = rows.find((r) => String(r.id) === String(id));
        return { ok: true, data: row ? [{ ...row }] : [] };
      }
      if (method === 'PATCH') {
        if (failPageIds.map(String).includes(String(id))) {
          return { ok: false, status: 500, error: 'permission denied for this page' };
        }
        const row = rows.find((r) => String(r.id) === String(id));
        if (!row) return { ok: false, status: 404, error: 'not found' };
        // The 2026-08-16 shape: the database answers 200 and the row does not
        // change. Fourteen pages were emptied this way with every write
        // reporting success, which is why the read-back exists at all.
        if (silentlyDropPageIds.map(String).includes(String(id))) {
          return { ok: true, data: [{ ...row }] };
        }
        Object.assign(row, body && typeof body === 'object' ? body : {});
        written.add(String(id));
        return { ok: true, data: [{ ...row }] };
      }
    }
    return { ok: false, status: 500, error: `unexpected ${method} on ${table}` };
  };

  return { store: require(storePath), rows, calls };
}

// layout_sections is a jsonb column: it is read back as an object, and the
// serializer writes an object. The seed rows below use a JSON string because
// that is the other shape the reader has to cope with, so this helper reads
// whichever one is actually there rather than assuming.
function docOf(row) {
  const raw = row.layout_sections;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// A page carrying its own background and theme, which the move must not touch.
function pageRow(id, name) {
  return {
    id,
    name,
    page_template_id: '27',
    layout_sections: JSON.stringify({
      sections: [{ id: 'old-a', type: 'text' }],
      pageBackground: { mode: 'color', color: '#123456' },
      theme: { typography: { colors: { text: '#ff0000' }, scale: { baseSize: 18 } } },
    }),
  };
}

const NEW_TEMPLATE = {
  id: '47',
  name: 'Blog Home Template',
  template_kind: 'modular',
  layout_sections: JSON.stringify({
    sections: [{ id: 'new-1', type: 'text' }, { id: 'new-2', type: 'image' }],
    pageBackground: { mode: 'color', color: '#ffffff' },
    theme: { typography: { colors: { text: '#00ff00' }, scale: { baseSize: 99 } } },
  }),
};

test('every named page ends up on the new template, with the template\'s sections', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
  });

  const res = await store.bulkSetPageTemplate([1, 2], '47');
  assert.equal(res.ok, true);
  assert.equal(res.templateName, 'Blog Home Template');
  assert.equal(res.data.length, 2);
  assert.ok(res.data.every((row) => row.ok));

  for (const row of rows) {
    assert.equal(row.page_template_id, '47');
    const doc = docOf(row);
    assert.deepEqual(doc.sections.map((s) => s.id), ['new-1', 'new-2']);
  }
});

test('the page keeps its OWN background and theme — landmine 13', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
  });

  await store.bulkSetPageTemplate([1], '47');

  const doc = docOf(rows[0]);
  // The template's own background is #ffffff and its text colour is #00ff00.
  // If either of those appears here, the write stopped spreading the page and
  // is resetting styling it was never asked to touch. (Both values are read
  // off the NORMALISED document, which is what the column actually holds.)
  assert.equal(doc.pageBackground.mode, 'color');
  assert.equal(doc.pageBackground.color, '#123456');
  assert.equal(doc.theme.typography.colors.text, '#ff0000');
  assert.equal(doc.theme.typography.scale.baseSize, 18);
});

test('each page is read back, and the report counts what came back correct', async () => {
  const { store } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About'), pageRow(3, 'Contact')],
    templates: [NEW_TEMPLATE],
  });

  const res = await store.bulkSetPageTemplate([1, 2, 3], '47');
  assert.equal(res.verifiedCount, 3);
  assert.ok(res.data.every((row) => row.verified === true));
  // The count is per page and named, so a partial result can be reported
  // honestly rather than as one number.
  assert.deepEqual(res.data.map((row) => row.name), ['Home', 'About', 'Contact']);
});

test('one page failing does not stop the others, and it is named', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About'), pageRow(3, 'Contact')],
    templates: [NEW_TEMPLATE],
    failPageIds: [2],
  });

  const res = await store.bulkSetPageTemplate([1, 2, 3], '47');
  assert.equal(res.ok, true);
  assert.equal(res.verifiedCount, 2);
  const failed = res.data.filter((row) => !row.ok);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].name, 'About');
  assert.match(failed[0].error, /permission denied/);
  // The page that failed still holds its original sections — a failed write is
  // not a half-written one.
  const untouched = docOf(rows.find((r) => r.id === 2));
  assert.deepEqual(untouched.sections.map((s) => s.id), ['old-a']);
});

test('when EVERY page fails, the whole call fails rather than reporting success', async () => {
  const { store } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
    failPageIds: [1, 2],
  });

  const res = await store.bulkSetPageTemplate([1, 2], '47');
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
});

test('an empty-layout template is refused before a single page is written', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [{ id: '50', name: 'Empty One', template_kind: 'modular', layout_sections: JSON.stringify({ sections: [] }) }],
  });

  const res = await store.bulkSetPageTemplate([1], '50');
  assert.equal(res.ok, false);
  assert.match(res.error, /empty every selected page/);
  // Nothing was touched.
  assert.equal(rows[0].page_template_id, '27');
  assert.deepEqual(docOf(rows[0]).sections.map((s) => s.id), ['old-a']);
});

test('an empty pageIds list and a missing template id are both refused', async () => {
  const { store } = makeStore({ pages: [pageRow(1, 'Home')], templates: [NEW_TEMPLATE] });

  assert.equal((await store.bulkSetPageTemplate([], '47')).ok, false);
  assert.equal((await store.bulkSetPageTemplate([1], '')).ok, false);
});

test('a write that reports success but does not stick is caught by the read-back', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
    silentlyDropPageIds: [2],
  });

  const res = await store.bulkSetPageTemplate([1, 2], '47');
  // The call succeeded and the database never complained, so ok is true for
  // both. Only reading the row back can tell them apart.
  assert.equal(res.ok, true);
  assert.ok(res.data.every((row) => row.ok));
  assert.equal(res.verifiedCount, 1);

  const dropped = res.data.find((row) => row.name === 'About');
  assert.equal(dropped.verified, false);
  // The message says what it found instead, not just that something is wrong.
  assert.match(dropped.error, /read back with template "27"/);
  assert.match(dropped.error, /1 section\(s\)/);
  assert.equal(rows.find((r) => r.id === 2).page_template_id, '27');
});

test('a page that cannot be read back at all is unverified — never verified by default', async () => {
  const { store } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
    blindReadBackPageIds: [1],
  });

  const res = await store.bulkSetPageTemplate([1], '47');
  // The write went through, so this is not a failure — but nothing confirmed
  // it, and "could not tell" must not render as "fine".
  assert.equal(res.ok, true);
  assert.equal(res.data[0].ok, true);
  assert.equal(res.data[0].verified, false);
  assert.equal(res.verifiedCount, 0);
  assert.match(res.data[0].error, /could not be read back/);
});

/**
 * A run where pages fail AND pages silently do not stick, at the same time.
 *
 * Every fixture above this one sets `failPageIds` OR `silentlyDropPageIds`.
 * That is why the mixed run reached production: the report layer branched over
 * the two — `if (failed) … else if (unverified) …` — so the run with both
 * dropped the read-back warning entirely and counted the unconfirmed pages as
 * moved. The store was always right; nothing asked it this question.
 *
 * The sentence built from these numbers is asserted in
 * bulkTemplateOutcome.test.js. This test's job is to prove the store really
 * does hand back three distinguishable verdicts in one response.
 */
test('failures and silent drops in ONE run stay three separate verdicts', async () => {
  const { store, rows } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About'), pageRow(3, 'Contact'), pageRow(4, 'Blog')],
    templates: [NEW_TEMPLATE],
    failPageIds: [2],
    silentlyDropPageIds: [3],
  });

  const res = await store.bulkSetPageTemplate([1, 2, 3, 4], '47');
  assert.equal(res.ok, true);

  const confirmed = res.data.filter((row) => row.ok && row.verified);
  const failed = res.data.filter((row) => !row.ok);
  const unconfirmed = res.data.filter((row) => row.ok && !row.verified);

  assert.equal(confirmed.length, 2, 'Home and Blog');
  assert.equal(failed.length, 1, 'About');
  assert.equal(unconfirmed.length, 1, 'Contact');
  // The three add up to the whole selection: no page is in two buckets and
  // none is missing.
  assert.equal(confirmed.length + failed.length + unconfirmed.length, 4);
  // verifiedCount counts ONLY the confirmed ones — not "everything that did
  // not error", which is the number the old report showed.
  assert.equal(res.verifiedCount, 2);
  assert.notEqual(res.verifiedCount, res.data.length - failed.length);

  assert.equal(failed[0].name, 'About');
  assert.equal(unconfirmed[0].name, 'Contact');
  // The silently-dropped page really did keep its old template — this is the
  // 2026-08-16 shape, and the read-back is the only thing that sees it.
  assert.equal(rows.find((r) => r.id === 3).page_template_id, '27');
  assert.equal(rows.find((r) => r.id === 1).page_template_id, '47');
});

// ── Round 3, item 2: the check that runs BEFORE the archive ─────────────────

/**
 * The archive is a complete copy of every page in the project, and it used to
 * be taken before the server had validated anything — so a refused change left
 * a full archive behind that undid nothing, on the very list the operator is
 * told to restore from. Snapshot 37 in the review run was one: 138 pages
 * archived for a change that touched zero.
 *
 * checkBulkSetPageTemplate answers the same question with no write behind it,
 * and the write path calls the same resolver, so the two cannot drift into
 * "the check said yes and the write said no".
 */
const EMAIL_TEMPLATE = {
  id: '61',
  name: 'Monthly Newsletter',
  template_kind: 'email',
  layout_sections: JSON.stringify({ sections: [{ id: 'e-1', type: 'text' }] }),
};

const EMPTY_TEMPLATE = {
  id: '62',
  name: 'Blank Starter',
  template_kind: 'modular',
  layout_sections: JSON.stringify({ sections: [] }),
};

test('the check says yes without touching a single page', async () => {
  const { store, rows, calls } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
  });

  const res = await store.checkBulkSetPageTemplate([1, 2], '47');
  assert.equal(res.ok, true);
  assert.equal(res.data.pageCount, 2);
  assert.equal(res.data.templateName, 'Blog Home Template');
  assert.equal(res.data.sectionCount, 2);

  // Nothing was written, and the pages still hold what they held.
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
  assert.ok(rows.every((r) => r.page_template_id === '27'));
});

test('every refusal the write path can raise, the check raises first', async () => {
  const cases = [
    { ids: [1], templateId: '999', match: /No saved page template with id/ },
    { ids: [1], templateId: '61', match: /is an email template/ },
    { ids: [1], templateId: '62', match: /has no sections/ },
    { ids: [], templateId: '47', match: /pageIds is required/ },
    { ids: [1], templateId: '', match: /pageTemplateId is required/ },
  ];
  for (const c of cases) {
    // eslint-disable-next-line no-await-in-loop
    const { store, rows, calls } = makeStore({
      pages: [pageRow(1, 'Home')],
      templates: [NEW_TEMPLATE, EMAIL_TEMPLATE, EMPTY_TEMPLATE],
    });
    // eslint-disable-next-line no-await-in-loop
    const checked = await store.checkBulkSetPageTemplate(c.ids, c.templateId);
    assert.equal(checked.ok, false, `${c.templateId} should be refused`);
    assert.match(checked.error, c.match);
    // The browser archives only after this answers yes, so a refusal here is a
    // refusal with no archive behind it.
    assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0);
    assert.equal(rows[0].page_template_id, '27');

    // And the write path refuses the same thing with the same sentence — one
    // resolver, so they cannot disagree.
    // eslint-disable-next-line no-await-in-loop
    const written = await store.bulkSetPageTemplate(c.ids, c.templateId);
    assert.equal(written.ok, false);
    assert.equal(written.error, checked.error);
    assert.equal(written.status, checked.status);
  }
});

// ── Round 3, item 6: what one page costs ────────────────────────────────────

test('one page costs one read, one write and one read-back — not three reads', async () => {
  const { store, calls } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
  });

  const res = await store.bulkSetPageTemplate([1], '47');
  assert.equal(res.ok, true);
  assert.equal(res.data[0].verified, true);

  const pageReads = calls.filter((c) => c.table === 'builder_landing_page' && c.method === 'GET');
  const pageWrites = calls.filter((c) => c.table === 'builder_landing_page' && c.method === 'PATCH');
  // Two reads: the one the write needs, and the read-back that catches the
  // 2026-08-16 shape. The third was updatePage re-reading the same row to bank
  // a revision, because the page it had already been handed was not passed
  // through — 43 avoidable round trips on a select-all.
  assert.equal(pageReads.length, 2, `expected 2 reads, got ${pageReads.length}`);
  assert.equal(pageWrites.length, 1);
});

test('the revision is still banked, and off the page as it was BEFORE the change', async () => {
  // Passing `previous` skips a read, not the revision — losing the revision
  // would remove Page History's copy of the layout this change replaces.
  const { store, calls } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
  });

  await store.bulkSetPageTemplate([1], '47');

  const revisionWrites = calls.filter((c) => c.table === 'builder_page_revisions' && c.method === 'POST');
  assert.equal(revisionWrites.length, 1);
});

// ── Round 4, item 3: whose change was it, and what kind ─────────────────────

test('every revision names the operator and says it was a template change', async () => {
  // The revision is this operation's per-page undo, and Page History is where
  // the operator goes looking after a bulk re-pour has surprised him. Recorded
  // with saved_by null and reason 'save' -- which is what it did until round 4
  // -- a 43-page bulk change is indistinguishable from him hand-editing each
  // page one at a time, and a later stale-edit collision blames "somebody
  // else" rather than naming him.
  const { store, calls } = makeStore({
    pages: [pageRow(1, 'Home'), pageRow(2, 'About')],
    templates: [NEW_TEMPLATE],
  });

  const res = await store.bulkSetPageTemplate([1, 2], '47', null, {
    actor: { id: 'user-7', name: 'Dane Christensen', email: 'dane@example.com' },
  });
  assert.equal(res.ok, true);

  const revisions = calls
    .filter((c) => c.table === 'builder_page_revisions' && c.method === 'POST')
    .flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]));
  assert.equal(revisions.length, 2, 'one revision per page');
  for (const row of revisions) {
    assert.equal(row.reason, 'template', 'the reason must say what this was');
    assert.equal(row.saved_by, 'user-7');
    assert.equal(row.saved_by_name, 'Dane Christensen');
  }
});

test('no signed-in user is recorded as no author — never as a wrong one', async () => {
  // A script or a cron reaches the store with no actor. The revision still has
  // to be banked, and Page History says "Template changed" with no name rather
  // than inventing one.
  const { store, calls } = makeStore({
    pages: [pageRow(1, 'Home')],
    templates: [NEW_TEMPLATE],
  });

  await store.bulkSetPageTemplate([1], '47');

  const revisions = calls
    .filter((c) => c.table === 'builder_page_revisions' && c.method === 'POST')
    .flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]));
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].reason, 'template');
  assert.equal(revisions[0].saved_by, null);
});
