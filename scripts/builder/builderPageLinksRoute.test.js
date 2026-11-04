'use strict';

// POST /api/builder/page-links/inbound (task 86bcxn69z) — what the Pages
// screen asks before deleting. The stores are stubbed; what must hold is that
// the answer is scoped to the caller's project, names each link, and that a
// read which FAILED is an error — never an empty "nothing links here".

const test = require('node:test');
const assert = require('node:assert/strict');

function stub(rel, exports) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, children: [], paths: [], exports };
}

const calls = [];
let pagesAnswer;
stub('../../lib/builderPagesStore', {
  listPages: async (limit, scope) => { calls.push(['pages', limit, scope.projectId]); return pagesAnswer; },
});
stub('../../lib/builderSavedSectionsStore', {
  listSavedSections: async (limit, scope) => { calls.push(['sections', limit, scope.projectId]); return { ok: true, data: [] }; },
});
stub('../../lib/supabase', {
  sbQuery: async (args) => { calls.push(['forms', args.query]); return { ok: true, data: [] }; },
  tableConfig: () => ({ crmForms: 'crm_forms' }),
});

const route = require('../../routes/builderPageLinks');

function call(body, projectId = 'proj_a') {
  const { Readable } = require('node:stream');
  const req = Readable.from([JSON.stringify(body)]);
  req.headers = { 'content-type': 'application/json' };
  req.projectContext = { project: { id: projectId, domain: 'client.com' } };
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}); },
    end(chunk) { this.body += chunk || ''; this.done = true; },
  };
  return route.handle(req, res, '/api/builder/page-links/inbound', 'POST').then((handled) => ({ handled, res, json: JSON.parse(res.body || 'null') }));
}

test('names the links to the page and reads only the caller\'s project', async () => {
  calls.length = 0;
  pagesAnswer = {
    ok: true,
    data: [
      { id: '1', name: 'Home', slug: '', layoutSections: [{ title: 'Hero', modules: [{ type: 'button', settings: { href: 'page:2|/contact' } }] }] },
      { id: '2', name: 'Contact', slug: 'contact', layoutSections: [] },
    ],
  };
  const { handled, res, json } = await call({ pageIds: ['2'] });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(json.data.pages['2'].map((l) => l.text), ['Home page › Hero › Button']);
  assert.deepEqual(calls.find((c) => c[0] === 'pages'), ['pages', 5000, 'proj_a']);
  assert.match(calls.find((c) => c[0] === 'forms')[1], /project_id=eq\.proj_a/);
});

test('a page nothing links to is absent', async () => {
  const { json } = await call({ pageIds: ['1'] });
  assert.deepEqual(json.data.pages, {});
});

test('a read that failed is an ERROR, not an empty answer', async () => {
  pagesAnswer = { ok: false, status: 500, error: 'boom' };
  const { res, json } = await call({ pageIds: ['2'] });
  assert.equal(res.statusCode, 502);
  assert.equal(json.ok, false);
  assert.match(json.error.message, /Could not check what links to this page — reading the pages: 500 boom/);
});

test('no page ids is refused rather than read as "every page"', async () => {
  const { res } = await call({ pageIds: [] });
  assert.equal(res.statusCode, 400);
});
