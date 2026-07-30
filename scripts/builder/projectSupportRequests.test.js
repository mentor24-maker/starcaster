'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Tenant-admin support requests: store, route scoping, settings and the
 * builder module-type registration.
 *
 * The module-type test is the important one. If lib/builder/template.js does
 * not know "admin-support-form", the server coerces it to "text" on every page
 * load and the Support page silently destroys itself — the landmine documented
 * in CLAUDE.md. That test fails if anyone edits builder-template.ts without
 * running `npm run build:builder-template`.
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const storePath = require.resolve('../../lib/projectSupportRequestsStore.js');
const settingsStorePath = require.resolve('../../lib/projectSiteSettingsStore.js');

/** Swap lib/supabase for a recorder so the store's wire format is pinned. */
function loadWithRecorder(targetPath, { rows = [{}] } = {}) {
  const calls = [];
  const fakeSupabase = {
    isConfigured: () => true,
    sbQuery: async (options) => {
      calls.push(options);
      return { ok: true, status: 200, data: rows };
    },
  };

  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: fakeSupabase,
  };
  delete require.cache[targetPath];
  const mod = require(targetPath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[targetPath];
  }

  return { mod, calls, restore };
}

// ── Builder module registration (the landmine) ───────────────────────────────

test('the generated server template bundle knows admin-support-form', () => {
  const { normalizeModuleType } = require('../../lib/builder/template.js');
  assert.equal(
    normalizeModuleType('admin-support-form'),
    'admin-support-form',
    'run `npm run build:builder-template` — the server bundle is coercing this module to "text", '
    + 'which destroys it on every page load'
  );
});

test('createEmptyModule gives admin-support-form usable defaults', () => {
  const { createEmptyModule } = require('../../lib/builder/template.js');
  const mod = createEmptyModule('admin-support-form', 'main');
  assert.equal(mod.type, 'admin-support-form');
  assert.equal(mod.settings.defaultPriority, 'normal');
  assert.equal(mod.settings.showScreenshot, 'true');
  assert.equal(mod.settings.buttonText, 'Send Request');
});

// ── Store ────────────────────────────────────────────────────────────────────

test('an unknown priority falls back to normal rather than reaching the DB', async () => {
  const { mod, calls, restore } = loadWithRecorder(storePath);
  try {
    await mod.createSupportRequest(
      { title: 'Broken', priority: 'catastrophic' },
      { projectId: 'proj_1', adminUserId: 'admin_1', adminEmail: 'A@Example.com' }
    );
    const post = calls.find((c) => c.method === 'POST');
    assert.ok(post, 'a POST should have been issued');
    // The column has a CHECK constraint; an unvalidated value would 400 at
    // PostgREST and lose the admin's report.
    assert.equal(post.body.priority, 'normal');
  } finally {
    restore();
  }
});

test('a valid priority is preserved', async () => {
  const { mod, calls, restore } = loadWithRecorder(storePath);
  try {
    await mod.createSupportRequest({ title: 'Down', priority: 'URGENT' }, { projectId: 'proj_1' });
    assert.equal(calls.find((c) => c.method === 'POST').body.priority, 'urgent');
  } finally {
    restore();
  }
});

test('project_id comes from the caller scope, never from the request body', async () => {
  const { mod, calls, restore } = loadWithRecorder(storePath);
  try {
    await mod.createSupportRequest(
      { title: 'Broken', projectId: 'proj_SOMEONE_ELSE', project_id: 'proj_SOMEONE_ELSE' },
      { projectId: 'proj_mine', adminEmail: 'a@b.com' }
    );
    const post = calls.find((c) => c.method === 'POST');
    assert.equal(post.body.project_id, 'proj_mine');
  } finally {
    restore();
  }
});

test('a request with no title is rejected before any DB call', async () => {
  const { mod, calls, restore } = loadWithRecorder(storePath);
  try {
    const result = await mod.createSupportRequest({ title: '   ' }, { projectId: 'proj_1' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(calls.length, 0, 'nothing should have been written');
  } finally {
    restore();
  }
});

test('over-long titles and descriptions are clamped, not rejected', async () => {
  const { mod, calls, restore } = loadWithRecorder(storePath);
  try {
    await mod.createSupportRequest(
      { title: 'x'.repeat(500), description: 'y'.repeat(9000) },
      { projectId: 'proj_1' }
    );
    const post = calls.find((c) => c.method === 'POST');
    assert.equal(post.body.title.length, mod.MAX_TITLE_CHARS);
    assert.equal(post.body.description.length, mod.MAX_DESCRIPTION_CHARS);
  } finally {
    restore();
  }
});

test('the insert asks PostgREST to return the created row', async () => {
  const { mod, calls, restore } = loadWithRecorder(storePath);
  try {
    await mod.createSupportRequest({ title: 'Broken' }, { projectId: 'proj_1' });
    assert.equal(calls.find((c) => c.method === 'POST').headers?.Prefer, 'return=representation');
  } finally {
    restore();
  }
});

test('listing is scoped to one project, newest first, and capped', async () => {
  const { mod, calls, restore } = loadWithRecorder(storePath, { rows: [] });
  try {
    await mod.listSupportRequests('proj_1', { limit: 5000 });
    const get = calls.find((c) => c.method === 'GET');
    assert.match(get.query, /project_id=eq\.proj_1/);
    assert.match(get.query, /order=created_at\.desc/);
    assert.match(get.query, new RegExp(`limit=${mod.MAX_LIST_LIMIT}(&|$)`));
  } finally {
    restore();
  }
});

test('listing without a project id is refused', async () => {
  const { mod, calls, restore } = loadWithRecorder(storePath, { rows: [] });
  try {
    const result = await mod.listSupportRequests('');
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

// ── Support alert email setting ──────────────────────────────────────────────

test('supportAlertEmail is platform-only, NOT tenant-writable', () => {
  const { KNOWN_SETTINGS, PLATFORM_SETTINGS } = require('../../lib/projectSiteSettingsStore.js');
  // The whole point of moving this to Settings > Projects: a client must not be
  // able to redirect their own support requests away from Alphire.
  assert.equal(KNOWN_SETTINGS.supportAlertEmail, undefined,
    'supportAlertEmail in KNOWN_SETTINGS would let a tenant admin PATCH it via /api/admin/site-settings');
  const spec = PLATFORM_SETTINGS.supportAlertEmail;
  assert.ok(spec, 'supportAlertEmail must be in PLATFORM_SETTINGS or the platform PATCH drops it');
  assert.equal(spec.validate(spec.normalize('Help@Alphire.com')), null);
  assert.equal(spec.validate(spec.normalize('')), null, 'blank means "use the platform default"');
  assert.ok(spec.validate(spec.normalize('not-an-email')));
});

test('a tenant PATCH cannot set supportAlertEmail', async () => {
  const { mod, calls, restore } = loadWithRecorder(settingsStorePath, {
    rows: [{ id: 'proj_1', site_settings: { contactAlertEmail: 'owner@site.com', supportAlertEmail: 'help@alphire.com' } }],
  });
  try {
    const result = await mod.updateSiteSettings('proj_1', {
      contactAlertEmail: 'new@site.com',
      supportAlertEmail: 'attacker@evil.com',
    });
    assert.equal(result.ok, true);
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.equal(patch.body.site_settings.contactAlertEmail, 'new@site.com');
    // The tenant's write must neither change nor erase the platform key.
    assert.equal(patch.body.site_settings.supportAlertEmail, 'help@alphire.com');
  } finally {
    restore();
  }
});

test('the tenant-facing read exposes display details but never the intake inbox', async () => {
  const { mod, restore } = loadWithRecorder(settingsStorePath, {
    rows: [{
      id: 'proj_1',
      site_settings: {
        contactAlertEmail: 'owner@site.com',
        supportAlertEmail: 'intake@alphire.com',
        supportEmail: 'support@alphire.com',
        supportPhone: '(303) 555-0142',
      },
    }],
  });
  try {
    const result = await mod.getSiteSettings('proj_1');
    assert.equal(result.ok, true);
    assert.equal(result.data.contactAlertEmail, 'owner@site.com');
    // The Support page renders these, so the tenant must be able to read them.
    assert.equal(result.data.supportEmail, 'support@alphire.com');
    assert.equal(result.data.supportPhone, '(303) 555-0142');
    // But never the intake inbox: showing it invites clients to email it
    // directly, bypassing the form and the record it creates.
    assert.equal(result.data.supportAlertEmail, undefined,
      'GET /api/admin/site-settings is tenant-reachable; it must not leak the intake inbox');
  } finally {
    restore();
  }
});

test('a tenant cannot WRITE the display details they can read', async () => {
  const { mod, calls, restore } = loadWithRecorder(settingsStorePath, {
    rows: [{ id: 'proj_1', site_settings: { supportEmail: 'support@alphire.com', supportPhone: '(303) 555-0142' } }],
  });
  try {
    await mod.updateSiteSettings('proj_1', {
      contactAlertEmail: 'owner@site.com',
      supportEmail: 'attacker@evil.com',
      supportPhone: '000',
    });
    const patch = calls.find((c) => c.method === 'PATCH');
    // Readable is not writable — a client must not be able to change the
    // number they tell their own staff to call.
    assert.equal(patch.body.site_settings.supportEmail, 'support@alphire.com');
    assert.equal(patch.body.site_settings.supportPhone, '(303) 555-0142');
    assert.equal(patch.body.site_settings.contactAlertEmail, 'owner@site.com');
  } finally {
    restore();
  }
});

test('supportPhone accepts real-world formatting', () => {
  const { PLATFORM_SETTINGS } = require('../../lib/projectSiteSettingsStore.js');
  const spec = PLATFORM_SETTINGS.supportPhone;
  // Free text on purpose: extensions, country codes and punctuation defeat
  // any format check worth having.
  for (const value of ['(303) 555-0142', '+44 20 7946 0958', '303-555-0142 x2', '']) {
    assert.equal(spec.validate(spec.normalize(value)), null, `should accept ${JSON.stringify(value)}`);
  }
});

test('the platform write path handles every PLATFORM_SETTINGS key', () => {
  const { mergePlatformSiteSettings, PLATFORM_SETTINGS } = require('../../lib/projectSiteSettingsStore.js');
  const patch = {};
  for (const key of Object.keys(PLATFORM_SETTINGS)) {
    patch[key] = key === 'supportPhone' ? '(303) 555-0142' : 'x@alphire.com';
  }
  const merged = mergePlatformSiteSettings({ contactAlertEmail: 'owner@site.com' }, patch);
  assert.equal(merged.ok, true);
  assert.equal(merged.data.contactAlertEmail, 'owner@site.com');
  for (const key of Object.keys(PLATFORM_SETTINGS)) {
    assert.ok(merged.data[key], `${key} should have been written`);
  }
});

test('the platform merge keeps the tenant\'s own settings', () => {
  const { mergePlatformSiteSettings } = require('../../lib/projectSiteSettingsStore.js');
  // site_settings is one jsonb column; assigning instead of merging would wipe
  // the client's contact alert address.
  const merged = mergePlatformSiteSettings(
    { contactAlertEmail: 'owner@site.com' },
    { supportAlertEmail: 'Help@Alphire.com' }
  );
  assert.equal(merged.ok, true);
  assert.equal(merged.data.contactAlertEmail, 'owner@site.com');
  assert.equal(merged.data.supportAlertEmail, 'help@alphire.com');
});

test('the platform merge rejects a malformed address', () => {
  const { mergePlatformSiteSettings } = require('../../lib/projectSiteSettingsStore.js');
  const merged = mergePlatformSiteSettings({}, { supportAlertEmail: 'nope' });
  assert.equal(merged.ok, false);
  assert.equal(merged.status, 400);
});

test('the project model exposes supportAlertEmail to the platform Projects screen', () => {
  const { readPlatformSettingsFromRow } = require('../../lib/projectSiteSettingsStore.js');
  assert.equal(
    readPlatformSettingsFromRow({ site_settings: { supportAlertEmail: 'help@alphire.com' } }).supportAlertEmail,
    'help@alphire.com'
  );
  assert.equal(readPlatformSettingsFromRow({}).supportAlertEmail, '');
});

test('/api/projects is denied to tenant-admin sessions', () => {
  const { acceptsProjectAdminSession } = require('../../lib/projectAdminApiAuth.js');
  // This is what stops a client reaching the platform route that DOES write
  // supportAlertEmail.
  assert.equal(acceptsProjectAdminSession('/api/projects/proj_1', { method: 'PATCH' }), false);
});

test('resolveSupportAlertEmail prefers the project setting over the env default', async () => {
  const { mod, restore } = loadWithRecorder(settingsStorePath, {
    rows: [{ id: 'proj_1', site_settings: { supportAlertEmail: 'perproject@alphire.com' } }],
  });
  const previous = process.env.SUPPORT_ALERT_EMAIL;
  process.env.SUPPORT_ALERT_EMAIL = 'fallback@alphire.com';
  try {
    assert.equal(await mod.resolveSupportAlertEmail('proj_1'), 'perproject@alphire.com');
  } finally {
    if (previous === undefined) delete process.env.SUPPORT_ALERT_EMAIL;
    else process.env.SUPPORT_ALERT_EMAIL = previous;
    restore();
  }
});

test('resolveSupportAlertEmail falls back to the env default when unset', async () => {
  const { mod, restore } = loadWithRecorder(settingsStorePath, {
    rows: [{ id: 'proj_1', site_settings: {} }],
  });
  const previous = process.env.SUPPORT_ALERT_EMAIL;
  process.env.SUPPORT_ALERT_EMAIL = 'fallback@alphire.com';
  try {
    assert.equal(await mod.resolveSupportAlertEmail('proj_1'), 'fallback@alphire.com');
  } finally {
    if (previous === undefined) delete process.env.SUPPORT_ALERT_EMAIL;
    else process.env.SUPPORT_ALERT_EMAIL = previous;
    restore();
  }
});

// ── Route access ─────────────────────────────────────────────────────────────

test('a tenant-admin session is accepted on /api/support', () => {
  const { acceptsProjectAdminSession } = require('../../lib/projectAdminApiAuth.js');
  // If this ever returns false, a signed-in site admin gets a 401 on their own
  // Support page — the route is reachable only via app_admin_session.
  assert.equal(acceptsProjectAdminSession('/api/support/requests', { method: 'POST' }), true);
  assert.equal(acceptsProjectAdminSession('/api/support/requests', { method: 'GET' }), true);
});

test('/api/support is not exempt from the login requirement', () => {
  const { PROJECT_ADMIN_SESSION_DENY_PREFIXES } = require('../../lib/projectAdminApiAuth.js');
  // Sanity check on the inverse: nothing here should have opened a public hole.
  assert.ok(!PROJECT_ADMIN_SESSION_DENY_PREFIXES.includes('/api/support'));

  const routes = require('../../routes/projectSupport.js');
  assert.deepEqual(routes.manifest.prefixes, ['/api/support']);
});

test('the support route is registered in the dispatcher', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../../routes/index.js'), 'utf8');
  // A route module that is required but never listed in ROUTE_MODULES never
  // runs, and every request to it 404s with no error anywhere.
  assert.match(src, /require\('\.\/projectSupport'\)/);
  assert.match(src, /^\s*projectSupport,\s*$/m);
});

test('an unauthenticated request is refused', async () => {
  const routes = require('../../routes/projectSupport.js');
  let body = null;
  const res = {
    statusCode: 0,
    setHeader() {},
    end(chunk) { body = chunk; },
  };
  const handled = await routes.handle(
    { headers: {}, url: '/api/support/requests', authUser: null },
    res,
    '/api/support/requests',
    'GET'
  );
  assert.equal(handled, true, 'the route must claim the path, not fall through to a 404');
  assert.equal(res.statusCode, 401);
  assert.match(String(body), /AUTH_REQUIRED/);
});
