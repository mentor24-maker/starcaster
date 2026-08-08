'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * DELETE /sessions/:id is the wizard API's only destructive verb. One rule
 * matters enough to pin: a run whose theme is applied to the site is refused,
 * because its apply_snapshot_id is the one-click undo for a bulk rewrite of
 * every page (hazard 4.1). Deleting that to tidy a list would strand the site
 * on a theme with no way back.
 */

const httpPath = require.resolve('../../routes/http.js');
const scopePath = require.resolve('../../lib/requestProjectScope.js');
const limiterPath = require.resolve('../../lib/rateLimiter.js');
const storePath = require.resolve('../../lib/themeWizardStore.js');
const routePath = require.resolve('../../routes/themeWizard.js');

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

function loadRoute(overrides = {}) {
  const calls = [];
  const saved = new Map();
  for (const p of [httpPath, scopePath, limiterPath, storePath, routePath]) {
    saved.set(p, require.cache[p]);
  }

  const sent = {};
  stub(httpPath, {
    parseJsonBody: async () => ({}),
    sendOk: (res, status, data) => { sent.ok = { status, data }; },
    sendErr: (res, status, message, extra) => { sent.err = { status, message, code: extra?.code }; },
  });
  stub(scopePath, { requestProjectScope: () => ({ projectId: 'proj_1', userId: 'user_1', projectIds: ['proj_1'] }) });
  stub(limiterPath, { checkEndpointLimit: () => false, checkLimit: () => false, LIMITS: {} });

  stub(storePath, {
    getSession: async (id) => ({
      ok: true, status: 200,
      data: overrides.session || { id, status: 'active', roundCount: 2 },
    }),
    deleteSession: async (id) => {
      calls.push({ op: 'deleteSession', id });
      return { ok: true, status: 200, data: { id } };
    },
  });

  delete require.cache[routePath];
  const route = require(routePath);

  return {
    route,
    calls,
    sent,
    restore() {
      for (const [p, mod] of saved) {
        if (mod) require.cache[p] = mod; else delete require.cache[p];
      }
    },
  };
}

function fakeReq() { return { authUser: { id: 'user_1' }, headers: {} }; }

test('an active run deletes through the scoped store', async () => {
  const h = loadRoute();
  try {
    await h.route.handle(fakeReq(), {}, '/api/builder/theme-wizard/sessions/twiz_1', 'DELETE');

    assert.deepEqual(h.calls, [{ op: 'deleteSession', id: 'twiz_1' }]);
    assert.equal(h.sent.ok?.status, 200);
    assert.deepEqual(h.sent.ok?.data, { deleted: true, id: 'twiz_1' });
  } finally { h.restore(); }
});

test('an applied run is refused so its undo survives', async () => {
  const h = loadRoute({ session: { id: 'twiz_1', status: 'applied', applySnapshotId: 'snap_1' } });
  try {
    await h.route.handle(fakeReq(), {}, '/api/builder/theme-wizard/sessions/twiz_1', 'DELETE');

    assert.equal(h.calls.length, 0, 'nothing may be deleted');
    assert.equal(h.sent.err?.status, 409);
    assert.equal(h.sent.err?.code, 'SESSION_APPLIED');
    assert.match(h.sent.err?.message, /undo/i,
      'the refusal must say what the run is protecting, not just "no"');
  } finally { h.restore(); }
});
