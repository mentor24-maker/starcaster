'use strict';

/**
 * The import theme on its own (task 86bctakkk): lib/siteImportTheme.js and
 * the GET/POST /api/site-import/jobs/:id/theme route. Before this, the only
 * way to give a project its import theme was to re-run the whole page
 * import (Alphire, 2026-10-27, all 17 pages re-touched).
 *
 * Runs on the REAL derivation (lib/site-import/dist/theme.js, the bundle
 * the server loads) with the theme store faked, so it pins: the name never
 * collides with a theme that exists, nothing but the theme store is
 * written, and a theme that did not land in this project fails loudly.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const themeLib = require('../../lib/site-import/dist/theme.js');
const { normalizeTheme } = require('../../lib/builder/template.js');
const { planImportTheme, saveImportTheme, undoLine } = require('../../lib/siteImportTheme.js');

const IR = {
  pages: [{
    sections: [{
      elements: [
        { sourceId: 't1', class: 'text', html: '<p>x</p>', computedStyles: { 'font-size': '16px', color: 'rgb(20, 20, 20)' } },
        { sourceId: 'h1', class: 'heading', html: '<h1>x</h1>', computedStyles: { 'font-size': '40px', 'font-weight': '300', color: 'rgb(20, 20, 20)' } },
      ],
    }],
  }],
  styleSummary: {
    pageBackgrounds: [{ value: 'rgb(255, 255, 255)', count: 5 }],
    buttons: [{ value: 'rgb(0, 200, 255)|rgb(0, 0, 0)|8', count: 3 }],
  },
};

const JOB = {
  id: 'simp_alphire',
  projectId: 'proj_1',
  sourceUrl: 'https://www.alphire.com/',
  checkpoints: { normalize: { blobPath: 'https://blob.test/ir.json' }, capture: { at: 'then' } },
};
const SCOPE = { projectId: 'proj_1', userId: 'u1' };

function fakeStore(initial = [], { dropTenant = false } = {}) {
  const themes = initial.map((t) => ({ ...t }));
  const calls = [];
  return {
    calls,
    themes,
    listThemes: async (limit, scope) => { calls.push(['listThemes', limit, scope]); return { ok: true, status: 200, data: themes.map((t) => ({ ...t })) }; },
    createTheme: async (input, scope) => {
      calls.push(['createTheme', input, scope]);
      const row = { ...input, id: `theme_${themes.length + 1}`, isDefault: false };
      if (!dropTenant) themes.push(row);
      return { ok: true, status: 201, data: row };
    },
    setDefaultTheme: async (id, scope) => {
      calls.push(['setDefaultTheme', id, scope]);
      for (const t of themes) t.isDefault = t.id === id;
      return { ok: true, status: 200, data: { id } };
    },
  };
}

function deps(themesStore) {
  return { themesStore, themeLib, normalizeTheme, fetchJson: async () => IR };
}

test('plan names the theme after the site, next to any it already has, and writes nothing', async () => {
  const store = fakeStore([{ id: 'a', name: 'alphire 1', isDefault: true }, { id: 'b', name: 'Default' }]);
  const plan = await planImportTheme(JOB, SCOPE, { deps: deps(store) });
  assert.equal(plan.name, 'alphire 2');
  assert.equal(plan.previousDefault.id, 'a');
  assert.ok(plan.notes.length > 0, 'the readability notes come with the plan');
  assert.deepEqual(store.calls.map(([n]) => n), ['listThemes']);
});

test('save creates a NEW theme, makes it default, and leaves the existing one exactly as it was', async () => {
  const store = fakeStore([{ id: 'a', name: 'alphire 1', isDefault: true, primaryColor: '#123456' }]);
  const plan = await planImportTheme(JOB, SCOPE, { deps: deps(store) });
  const cp = await saveImportTheme(plan, SCOPE, { deps: deps(store) });
  assert.equal(cp.name, 'alphire 2');
  assert.equal(cp.madeDefault, true);
  assert.equal(cp.previousDefaultId, 'a');
  assert.equal(store.themes.length, 2);
  assert.equal(store.themes[0].primaryColor, '#123456', 'the existing theme is never overwritten');
  const created = store.calls.find(([n]) => n === 'createTheme');
  assert.equal(created[1].name, 'alphire 2');
  assert.equal(created[1].notes, undefined, 'notes are a report, not a theme field');
  assert.deepEqual(created[2], SCOPE);
  assert.match(undoLine(cp), /make "alphire 1" \(a\) the default again/);
});

test('makeDefault:false creates the theme and changes no default', async () => {
  const store = fakeStore([{ id: 'a', name: 'Default', isDefault: true }]);
  const plan = await planImportTheme(JOB, SCOPE, { deps: deps(store) });
  const cp = await saveImportTheme(plan, SCOPE, { makeDefault: false, deps: deps(store) });
  assert.equal(cp.name, 'alphire 1');
  assert.equal(store.calls.some(([n]) => n === 'setDefaultTheme'), false);
  assert.equal(store.themes.find((t) => t.id === 'a').isDefault, true);
  assert.match(undoLine(cp), /not made the default/);
});

test('an insert that "succeeds" but is not in this project\'s list fails loudly (landmine 12)', async () => {
  const store = fakeStore([], { dropTenant: true });
  const plan = await planImportTheme(JOB, SCOPE, { deps: deps(store) });
  await assert.rejects(saveImportTheme(plan, SCOPE, { deps: deps(store) }), /not in this project's theme list/);
});

test('a job that has not captured the site yet says so in plain words', async () => {
  const store = fakeStore();
  const job = { ...JOB, checkpoints: {} };
  await assert.rejects(planImportTheme(job, SCOPE, { deps: deps(store) }), (err) => err.code === 'NOT_CAPTURED' && /not finished capturing/.test(err.message));
});

/* ---------- the route ---------- */

const storePath = require.resolve('../../lib/siteImportStore.js');
const themePath = require.resolve('../../lib/siteImportTheme.js');
const routePath = require.resolve('../../routes/siteImport.js');

function loadRoute(themeModule, jobStore = {}) {
  const calls = [];
  const fakeJobStore = {
    getJob: async (id, projectId) => { calls.push(['getJob', id, projectId]); return { ok: true, status: 200, data: { ...JOB, status: 'complete' } }; },
    updateJob: async (id, patch) => { calls.push(['updateJob', id, patch]); return { ok: true, status: 200, data: { ...JOB, ...patch } }; },
    ...jobStore,
  };
  const saved = { store: require.cache[storePath], theme: require.cache[themePath] };
  require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeJobStore };
  require.cache[themePath] = { id: themePath, filename: themePath, loaded: true, exports: themeModule };
  delete require.cache[routePath];
  const route = require(routePath);
  for (const [key, path] of [['store', storePath], ['theme', themePath]]) {
    if (saved[key]) require.cache[path] = saved[key];
    else delete require.cache[path];
  }
  delete require.cache[routePath];
  return { route, calls };
}

/** The real module with the fake theme store bound in. */
function boundTheme(store) {
  return {
    planImportTheme: (job, scope) => planImportTheme(job, scope, { deps: deps(store) }),
    saveImportTheme: (plan, scope, opts) => saveImportTheme(plan, scope, { ...opts, deps: deps(store) }),
    pagesRestyledByDefault: async () => 17,
    undoLine,
  };
}

function makeReq(body = {}) {
  return {
    method: 'GET', url: '/', headers: { host: 'test.local' }, socket: { remoteAddress: '127.0.0.9' },
    authUser: { id: 'user_1' },
    projectContext: { project: { id: 'proj_1' }, projects: [{ id: 'proj_1' }] },
    _parsedJsonBody: body,
  };
}
function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(c) { this.body = String(c || ''); } };
  res.json = () => JSON.parse(res.body || '{}');
  return res;
}

test('GET /jobs/:id/theme previews the theme and creates nothing', async () => {
  const store = fakeStore([{ id: 'a', name: 'alphire 1', isDefault: true }]);
  const { route, calls } = loadRoute(boundTheme(store));
  const res = makeRes();
  await route.handle(makeReq(), res, '/api/site-import/jobs/simp_alphire/theme', 'GET');
  assert.equal(res.statusCode, 200);
  const data = res.json().data;
  assert.equal(data.name, 'alphire 2');
  assert.ok(data.theme.palette, 'the palette is in the preview');
  assert.ok(data.notes.length > 0, 'the readability notes are in the preview');
  assert.equal(data.previousDefault.name, 'alphire 1');
  assert.equal(data.pagesRestyledByDefault, 17, 'the screen states how many live pages the default box restyles');
  assert.equal(store.calls.some(([n]) => n !== 'listThemes'), false);
  assert.equal(calls.some(([n]) => n === 'updateJob'), false);
  assert.deepEqual(calls.find(([n]) => n === 'getJob'), ['getJob', 'simp_alphire', 'proj_1']);
});

test('POST /jobs/:id/theme creates the theme, records it on the job, and keeps the other checkpoints', async () => {
  const store = fakeStore();
  const { route, calls } = loadRoute(boundTheme(store));
  const res = makeRes();
  await route.handle(makeReq({}), res, '/api/site-import/jobs/simp_alphire/theme', 'POST');
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().data.theme.name, 'alphire 1');
  assert.equal(store.themes.length, 1);
  assert.equal(store.themes[0].isDefault, false, 'never the default unless asked: that restyles the live site');
  const update = calls.find(([n]) => n === 'updateJob');
  assert.equal(update[2].checkpoints.theme.name, 'alphire 1');
  assert.deepEqual(update[2].checkpoints.capture, { at: 'then' });
  assert.ok(update[2].checkpoints.normalize.blobPath);
});

test('GET still previews when the pages cannot be counted, and says null rather than 0', async () => {
  const store = fakeStore();
  const { route } = loadRoute({ ...boundTheme(store), pagesRestyledByDefault: async () => { throw new Error('db down'); } });
  const res = makeRes();
  await route.handle(makeReq(), res, '/api/site-import/jobs/simp_alphire/theme', 'GET');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().data.pagesRestyledByDefault, null);
});

test('POST with makeDefault:true makes it the default', async () => {
  const store = fakeStore([{ id: 'a', name: 'Default', isDefault: true }]);
  const { route } = loadRoute(boundTheme(store));
  const res = makeRes();
  await route.handle(makeReq({ makeDefault: true }), res, '/api/site-import/jobs/simp_alphire/theme', 'POST');
  assert.equal(res.statusCode, 201);
  assert.equal(store.themes.find((t) => t.id === 'a').isDefault, false);
  assert.equal(store.themes.find((t) => t.id !== 'a').isDefault, true);
});

test('POST with makeDefault:false leaves the default alone', async () => {
  const store = fakeStore([{ id: 'a', name: 'Default', isDefault: true }]);
  const { route } = loadRoute(boundTheme(store));
  const res = makeRes();
  await route.handle(makeReq({ makeDefault: false }), res, '/api/site-import/jobs/simp_alphire/theme', 'POST');
  assert.equal(res.statusCode, 201);
  assert.equal(store.themes.find((t) => t.id === 'a').isDefault, true);
});

test('POST on an uncaptured job is a 409 with the reason, and creates nothing', async () => {
  const store = fakeStore();
  const { route } = loadRoute(boundTheme(store), {
    getJob: async () => ({ ok: true, status: 200, data: { ...JOB, checkpoints: {} } }),
  });
  const res = makeRes();
  await route.handle(makeReq({}), res, '/api/site-import/jobs/simp_alphire/theme', 'POST');
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'NOT_CAPTURED');
  assert.equal(store.themes.length, 0);
});

test('a theme that was created but could not be recorded on the job still answers 201, with a warning', async () => {
  const store = fakeStore();
  const { route } = loadRoute(boundTheme(store), {
    updateJob: async () => ({ ok: false, status: 500, error: 'boom' }),
  });
  const res = makeRes();
  await route.handle(makeReq({}), res, '/api/site-import/jobs/simp_alphire/theme', 'POST');
  assert.equal(res.statusCode, 201);
  assert.match(res.json().data.warning, /theme was created.*boom/);
});
