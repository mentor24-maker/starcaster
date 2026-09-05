'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * The bulk template change through the ROUTE, over a fake database.
 *
 * The two files beside this one test halves: what the store does when it is
 * handed an actor, and what the snapshots store asks the database for. Neither
 * can see the wiring between them, and round 3's send-back was twice about
 * exactly that gap — "the route reads the code the store attaches" is two
 * claims, and testing one proves nothing about the other. So this file drives
 * `handle()` and looks at what actually reached the database.
 *
 * Two properties, both from round 4's send-back:
 *
 *  3. The revisions this route banks name the signed-in user and say the
 *     change was a template change. Recorded as an anonymous 'save' — which is
 *     what they were — Page History showed a 43-page bulk re-pour as
 *     forty-three ordinary hand edits, and the revision is this operation's
 *     only per-page undo.
 *
 *  4. The archive guard asks whether the row EXISTS. It used to call
 *     getPageSnapshot, which is `select=*`, so confirming an archive was there
 *     dragged that archive's whole `pages` blob — every page layout in the
 *     project, 138 on the production copy — across the wire and deserialized
 *     it, immediately before the write loop, in a serverless invocation that
 *     has already truncated a 50-page propagation at 30.
 */

const supabasePath = require.resolve('../../lib/supabase');
const scopePath = require.resolve('../../lib/projectScope');
const pagesStorePath = require.resolve('../../lib/builderPagesStore');
const templatesStorePath = require.resolve('../../lib/builderPageTemplatesStore');
const snapshotsStorePath = require.resolve('../../lib/builderPageSnapshotsStore');
const revisionsStorePath = require.resolve('../../lib/builderPageRevisionsStore');
const routePath = require.resolve('../../routes/builder');

const TEMPLATE = {
  id: '47',
  name: 'Website Main Template',
  template_kind: 'modular',
  layout_sections: JSON.stringify({ sections: [{ id: 'new-1', type: 'text' }] }),
};

function page(id, name) {
  return {
    id,
    name,
    page_template_id: '27',
    layout_sections: JSON.stringify({ sections: [{ id: 'old-a', type: 'text' }] }),
  };
}

/**
 * Stand the real route up over a fake database, and keep every query it makes.
 *
 * `snapshots` is what the archive table holds; an empty list is the "no such
 * archive" case the route must refuse before writing anything.
 */
function withRoute({ pages = [page(1, 'Home'), page(2, 'About')], snapshots = [{ id: 37 }] } = {}) {
  for (const p of [
    supabasePath, scopePath, pagesStorePath, templatesStorePath,
    snapshotsStorePath, revisionsStorePath, routePath,
  ]) {
    delete require.cache[p];
  }
  const supabase = require(supabasePath);
  const rows = pages.map((r) => ({ ...r }));
  const calls = [];

  supabase.isConfigured = () => true;
  supabase.tableConfig = () => ({
    builderPages: 'builder_landing_page',
    builderPageTemplates: 'builder_page_templates',
    builderPageRevisions: 'builder_page_revisions',
    builderPageSnapshots: 'builder_page_snapshots',
  });
  supabase.sbQuery = async ({ method = 'GET', table = '', query = '', body }) => {
    // The tenant-column probe (lib/projectScope) — answered no, because
    // scoping is not what this file is about.
    if (method === 'GET' && /select=project_id/.test(query)) {
      return { ok: false, status: 400, error: 'column does not exist' };
    }
    calls.push({ method, table, query, body });

    if (table === 'builder_page_snapshots') {
      const id = (query.match(/id=eq\.(\d+)/) || [])[1];
      return { ok: true, data: snapshots.filter((s) => String(s.id) === String(id)) };
    }
    if (table === 'builder_page_revisions') return { ok: true, data: [] };
    if (table === 'builder_page_templates') return { ok: true, data: [{ ...TEMPLATE }] };
    if (table === 'builder_landing_page') {
      const id = (query.match(/id=eq\.(\d+)/) || [])[1];
      const row = rows.find((r) => String(r.id) === String(id));
      if (method === 'GET') return { ok: true, data: row ? [{ ...row }] : [] };
      if (method === 'PATCH') {
        if (!row) return { ok: false, status: 404, error: 'not found' };
        Object.assign(row, body && typeof body === 'object' ? body : {});
        return { ok: true, data: [{ ...row }] };
      }
    }
    return { ok: false, status: 500, error: `unexpected ${method} on ${table}` };
  };

  return { route: require(routePath), rows, calls };
}

/** A request and a response the dispatcher would recognise. */
async function post(route, urlPath, body, { authUser = { id: 'user-7', name: 'Dane Christensen' } } = {}) {
  const req = { method: 'POST', url: urlPath, headers: { host: 'localhost:3001' }, body, authUser };
  const written = { status: 0, payload: null };
  const res = {
    set statusCode(value) { written.status = value; },
    get statusCode() { return written.status; },
    setHeader() {},
    end(text) { written.payload = text ? JSON.parse(text) : null; },
  };
  const handled = await route.handle(req, res, urlPath, 'POST');
  return { handled, ...written };
}

const BODY = { pageIds: [1, 2], pageTemplateId: '47', snapshotId: '37' };

test('the route moves the named pages and says so', async () => {
  const { route, rows } = withRoute();
  const out = await post(route, '/api/builder/landing-pages/bulk-set-template', BODY);

  assert.equal(out.handled, true);
  assert.equal(out.status, 200);
  assert.equal(out.payload.ok, true);
  assert.equal(out.payload.verifiedCount, 2);
  assert.deepEqual(rows.map((r) => r.page_template_id), ['47', '47']);
});

test('every revision the route banks names the signed-in user and the reason', async () => {
  const { route, calls } = withRoute();
  await post(route, '/api/builder/landing-pages/bulk-set-template', BODY);

  const revisions = calls
    .filter((c) => c.table === 'builder_page_revisions' && c.method === 'POST')
    .flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]));
  assert.equal(revisions.length, 2);
  for (const row of revisions) {
    assert.equal(row.saved_by, 'user-7', 'the route did not pass the signed-in user through');
    assert.equal(row.saved_by_name, 'Dane Christensen');
    assert.equal(row.reason, 'template', "recorded as an ordinary 'save', a bulk re-pour is invisible in Page History");
  }
});

test('a request with no signed-in user still banks its revisions, with no author', async () => {
  const { route, calls } = withRoute();
  await post(route, '/api/builder/landing-pages/bulk-set-template', BODY, { authUser: null });

  const revisions = calls
    .filter((c) => c.table === 'builder_page_revisions' && c.method === 'POST')
    .flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]));
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0].saved_by, null, 'an unknown author is recorded as none, never guessed');
  assert.equal(revisions[0].reason, 'template');
});

test('the archive guard asks whether the row exists — it does not fetch the pages', async () => {
  const { route, calls } = withRoute();
  await post(route, '/api/builder/landing-pages/bulk-set-template', BODY);

  const archiveReads = calls.filter((c) => c.table === 'builder_page_snapshots');
  assert.equal(archiveReads.length, 1, 'the guard should cost exactly one read');
  assert.match(archiveReads[0].query, /select=id\b/);
  assert.doesNotMatch(
    archiveReads[0].query,
    /select=\*/,
    'the guard is fetching the snapshot\'s whole pages blob — every page layout in the project — to answer a yes/no',
  );
});

test('a missing archive is refused before a single page is written', async () => {
  const { route, calls, rows } = withRoute({ snapshots: [] });
  const out = await post(route, '/api/builder/landing-pages/bulk-set-template', BODY);

  assert.equal(out.status, 400);
  assert.match(out.payload.error.message, /No archive with id "37"/);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
  assert.deepEqual(rows.map((r) => r.page_template_id), ['27', '27'], 'nothing may move');
});

test('the check path writes nothing at all — no revision, no page, no archive', async () => {
  const { route, calls, rows } = withRoute();
  const out = await post(route, '/api/builder/landing-pages/bulk-set-template/check', {
    pageIds: [1, 2], pageTemplateId: '47',
  });

  assert.equal(out.status, 200);
  assert.equal(out.payload.pageCount, 2);
  assert.equal(out.payload.templateName, 'Website Main Template');
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0, 'the check must not write');
  assert.deepEqual(rows.map((r) => r.page_template_id), ['27', '27']);
});
