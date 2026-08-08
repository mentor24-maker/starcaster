'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Applying a theme rewrites every landing page and template in the project.
 * That is the same shape as the canonical-section save that silently wiped the
 * Marinoff menu on 2026-07-21, and the fire-and-forget propagation loop that a
 * serverless freeze killed after 30 of 50 pages on 2026-07-22.
 *
 * These tests pin the two rules that keep the Theme Wizard out of that hole:
 *
 *   1. The snapshot is taken BEFORE any page is written, and a failed snapshot
 *      aborts the apply with nothing changed.
 *   2. Every page write is awaited, and a partial failure is reported as one —
 *      never rounded up to success, and never left in a state that invites a
 *      second apply on top of a half-reverted site.
 */

const httpPath = require.resolve('../../routes/http.js');
const scopePath = require.resolve('../../lib/requestProjectScope.js');
const limiterPath = require.resolve('../../lib/rateLimiter.js');
const pagesPath = require.resolve('../../lib/builderPagesStore.js');
const themesPath = require.resolve('../../lib/builderThemesStore.js');
const storePath = require.resolve('../../lib/themeWizardStore.js');
const routePath = require.resolve('../../routes/themeWizard.js');

const PAGES = [
  { id: 'page_1', name: 'Home', theme: { typography: { fonts: { body: 'old' } } }, pageBackground: '#FFF', layoutSections: [] },
  { id: 'page_2', name: 'About', theme: {}, pageBackground: '#EEE', layoutSections: [] },
];

const CANDIDATE = {
  id: 'twcd_1',
  sessionId: 'twiz_1',
  direction: 'High-contrast editorial',
  themePatch: { primaryColor: '#111', typography: { fonts: { body: 'new' } } },
};

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

/**
 * Loads routes/themeWizard.js against fake collaborators and records the order
 * of the side effects that matter. `overrides` lets a test break one thing.
 */
function loadRoute(overrides = {}) {
  const calls = [];
  const saved = new Map();
  for (const p of [httpPath, scopePath, limiterPath, pagesPath, themesPath, storePath, routePath]) {
    saved.set(p, require.cache[p]);
  }

  const sent = {};
  stub(httpPath, {
    parseJsonBody: async () => overrides.body || {},
    sendOk: (res, status, data) => { sent.ok = { status, data }; },
    sendErr: (res, status, message, extra) => { sent.err = { status, message, code: extra?.code }; },
  });
  stub(scopePath, { requestProjectScope: () => ({ projectId: 'proj_1', userId: 'user_1', projectIds: ['proj_1'] }) });
  stub(limiterPath, { checkEndpointLimit: () => false, checkLimit: () => false, LIMITS: {} });

  stub(pagesPath, {
    listPages: async () => ({ ok: true, status: 200, data: overrides.pages || PAGES }),
    updatePage: async (id, input) => {
      calls.push({ op: 'updatePage', id, pageBackground: input.pageBackground, theme: input.theme });
      const fail = (overrides.failPageIds || []).includes(id);
      return fail ? { ok: false, status: 500, error: 'write failed' } : { ok: true, status: 200, data: { id } };
    },
  });
  stub(themesPath, {
    createTheme: async (input) => {
      calls.push({ op: 'createTheme', name: input.name });
      return { ok: true, status: 201, data: { id: 'thm_1', name: input.name } };
    },
  });

  stub(storePath, {
    getCandidate: async () => ({ ok: true, status: 200, data: CANDIDATE }),
    getSession: async () => ({ ok: true, status: 200, data: overrides.session
      || { id: 'twiz_1', status: 'applied', applySnapshotId: 'snap_1', roundCount: 1, lockedValues: {} } }),
    createApplySnapshot: async () => {
      calls.push({ op: 'createApplySnapshot' });
      return overrides.snapshotFails
        ? { ok: false, status: 500, error: 'supabase unreachable' }
        : { ok: true, status: 201, data: { id: 'snap_1' } };
    },
    getApplySnapshot: async () => ({ ok: true, status: 200, data: { id: 'snap_1', pages: overrides.snapshotPages || PAGES } }),
    updateSession: async (id, input) => {
      calls.push({ op: 'updateSession', status: input.status, applySnapshotId: input.applySnapshotId });
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

test('a failed snapshot aborts the apply before any page is written', async () => {
  const h = loadRoute({ snapshotFails: true });
  try {
    await h.route.handle(fakeReq(), {}, '/api/builder/theme-wizard/candidates/twcd_1/apply', 'POST');

    assert.deepEqual(h.calls.map((c) => c.op), ['createApplySnapshot'],
      'nothing beyond the snapshot attempt should have run');
    assert.equal(h.calls.filter((c) => c.op === 'updatePage').length, 0);
    assert.equal(h.sent.err?.code, 'SNAPSHOT_FAILED');
    assert.match(h.sent.err?.message, /Nothing was changed/,
      'the operator must be told the site is untouched, not just that something failed');
  } finally { h.restore(); }
});

test('the snapshot is taken before the first page write', async () => {
  const h = loadRoute();
  try {
    await h.route.handle(fakeReq(), {}, '/api/builder/theme-wizard/candidates/twcd_1/apply', 'POST');

    const snapshotAt = h.calls.findIndex((c) => c.op === 'createApplySnapshot');
    const firstWriteAt = h.calls.findIndex((c) => c.op === 'updatePage');
    assert.ok(snapshotAt >= 0, 'a snapshot must be taken');
    assert.ok(firstWriteAt > snapshotAt, 'no page may be written before the snapshot exists');
  } finally { h.restore(); }
});

test('apply carries pageBackground through the theme merge', async () => {
  // Hazard 4.6: pageBackground has a history of being dropped by routes that
  // merge a theme. A page that comes back with an undefined background has
  // silently lost it.
  const h = loadRoute();
  try {
    await h.route.handle(fakeReq(), {}, '/api/builder/theme-wizard/candidates/twcd_1/apply', 'POST');

    const writes = h.calls.filter((c) => c.op === 'updatePage');
    assert.equal(writes.length, PAGES.length);
    assert.equal(writes[0].pageBackground, '#FFF');
    assert.equal(writes[1].pageBackground, '#EEE');
    assert.equal(writes[0].theme.typography.fonts.body, 'new', 'typography should be replaced');
  } finally { h.restore(); }
});

test('apply reports failed pages by name rather than rounding up to success', async () => {
  const h = loadRoute({ failPageIds: ['page_2'] });
  try {
    await h.route.handle(fakeReq(), {}, '/api/builder/theme-wizard/candidates/twcd_1/apply', 'POST');

    assert.equal(h.sent.ok?.data.applied, 1);
    assert.equal(h.sent.ok?.data.failed, 1);
    assert.deepEqual(h.sent.ok?.data.failures.map((f) => f.name), ['About']);
    assert.equal(h.sent.ok?.data.snapshotId, 'snap_1',
      'the snapshot id must come back so a partial apply can still be undone');
  } finally { h.restore(); }
});

test('revert leaves the session applied when any page fails to restore', async () => {
  const h = loadRoute({ failPageIds: ['page_2'] });
  try {
    await h.route.handle(fakeReq(), {}, '/api/builder/theme-wizard/sessions/twiz_1/revert', 'POST');

    assert.equal(h.sent.ok?.data.restored, 1);
    assert.equal(h.sent.ok?.data.failed, 1);
    assert.equal(h.sent.ok?.data.sessionStatus, 'applied');
    const cleared = h.calls.find((c) => c.op === 'updateSession' && c.status === 'active');
    assert.equal(cleared, undefined,
      'a half-restored site must not read as reverted — that invites a second apply on top of it');
  } finally { h.restore(); }
});

test('revert clears the session only when every page comes back', async () => {
  const h = loadRoute();
  try {
    await h.route.handle(fakeReq(), {}, '/api/builder/theme-wizard/sessions/twiz_1/revert', 'POST');

    assert.equal(h.sent.ok?.data.failed, 0);
    assert.equal(h.sent.ok?.data.sessionStatus, 'active');
    const cleared = h.calls.find((c) => c.op === 'updateSession' && c.status === 'active');
    assert.ok(cleared, 'a clean revert should stand the session back up');
    assert.equal(cleared.applySnapshotId, '', 'the spent snapshot pointer should be cleared');
  } finally { h.restore(); }
});
