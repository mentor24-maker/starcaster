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

  return { store: require(storePath), rows };
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
