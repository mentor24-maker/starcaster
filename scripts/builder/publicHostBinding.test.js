'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Public, unauthenticated POSTs must resolve their project, not believe it.
 *
 * Loop Queue 86bbjj6qb. On a SYSTEM host (starcaster.pro, localhost, every
 * Vercel preview) the host names no tenant, so `assertProjectIdAllowedOnHost`
 * answers `{ ok: true }` with no projectId and every call site fell through to
 * `bind.projectId || projectId` — the caller's unverified claim. Any string
 * became a tenant. `resolvePublicProjectForRequest` verifies the claim against
 * real projects; these tests pin that for each converted endpoint, and pin that
 * tenant-domain behaviour did not move.
 */

const KNOWN_PROJECT_ID = 'proj_1';
const KNOWN_PROJECT_DOMAIN = 'tenant.example.com';

const supabasePath = require.resolve('../../lib/supabase.js');
const projectsStorePath = require.resolve('../../lib/projectsStore.js');
const hostBindingPath = require.resolve('../../lib/publicSiteHostBinding.js');

/**
 * A fake database that knows exactly one project — by id and by domain — and
 * answers [] for anything else. Every other table answers [] too, so a write
 * that should not have happened shows up as a recorded POST, not as noise.
 */
function fakeSupabase(calls) {
  return {
    isConfigured: () => true,
    tableConfig: () => ({}),
    sbQuery: async (options) => {
      calls.push(options);
      const query = options.query || '';
      const idMatch = /(?:^|&)id=eq\.([^&]*)/.exec(query);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return { ok: true, status: 200, data: id === KNOWN_PROJECT_ID ? [{ id }] : [] };
      }
      const domainMatch = /(?:^|&)domain=eq\.([^&]*)/.exec(query);
      if (domainMatch) {
        const domain = decodeURIComponent(domainMatch[1]);
        return {
          ok: true,
          status: 200,
          data: domain === KNOWN_PROJECT_DOMAIN ? [{ id: KNOWN_PROJECT_ID, domain }] : [],
        };
      }
      return { ok: true, status: 200, data: [] };
    },
  };
}

/**
 * Load `modulePath` with lib/supabase and any extra modules swapped out.
 * Everything downstream of the swap is dropped from the require cache first,
 * or a module that destructured the real sbQuery at load time keeps it.
 */
function withMocks(modulePath, overrides = {}) {
  const calls = [];
  const saved = new Map();
  const swap = (file, exports) => {
    saved.set(file, require.cache[file]);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  const drop = (file) => {
    saved.set(file, require.cache[file]);
    delete require.cache[file];
  };

  swap(supabasePath, fakeSupabase(calls));
  for (const [relative, exports] of Object.entries(overrides)) {
    swap(require.resolve(`../../${relative}`), exports);
  }
  drop(projectsStorePath);
  drop(hostBindingPath);
  const target = require.resolve(`../../${modulePath}`);
  drop(target);

  const loaded = require(target);

  function restore() {
    for (const [file, previous] of saved.entries()) {
      if (previous) require.cache[file] = previous;
      else delete require.cache[file];
    }
    delete require.cache[target];
    delete require.cache[projectsStorePath];
    delete require.cache[hostBindingPath];
  }

  return { loaded, calls, restore };
}

function fakeRes() {
  const res = { statusCode: 0, body: '', headers: {} };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.end = (chunk) => { res.body = chunk || ''; };
  return res;
}

// The rate limiter is real and in-memory, shared across this whole file, so a
// reused address spends another test's budget and starts 429ing.
let nextTestIp = 1;

function fakeReq({ url, body = {}, host = 'localhost', headers = {} } = {}) {
  return {
    method: 'POST',
    url,
    headers: { host, 'user-agent': 'test-agent', ...headers },
    socket: { remoteAddress: `203.0.113.${nextTestIp++}` },
    body,
  };
}

async function post(route, pathname, opts) {
  const res = fakeRes();
  const req = fakeReq({ url: pathname, ...opts });
  const handled = await route.handle(req, res, pathname, 'POST');
  let payload = null;
  try { payload = JSON.parse(res.body); } catch (_) { payload = null; }
  return { handled, status: res.statusCode, payload };
}

// ── The resolver itself ──────────────────────────────────────────────────────

test('system host + a projectId nobody owns is refused 404, before any write', async () => {
  const { loaded, restore } = withMocks('lib/publicSiteHostBinding.js');
  try {
    const bind = await loaded.resolvePublicProjectForRequest(
      fakeReq({ url: '/x', host: 'starcaster.pro' }),
      'proj_i_made_this_up'
    );
    assert.equal(bind.ok, false);
    assert.equal(bind.status, 404);
    assert.equal(bind.code, 'PROJECT_NOT_FOUND');
  } finally {
    restore();
  }
});

test('system host + a REAL projectId is accepted — the stated policy', async () => {
  // Deliberate: refusing would buy nothing (these endpoints are already open on
  // the tenant's own domain) and would break localhost dev and Builder preview.
  const { loaded, restore } = withMocks('lib/publicSiteHostBinding.js');
  try {
    const bind = await loaded.resolvePublicProjectForRequest(
      fakeReq({ url: '/x', host: 'localhost' }),
      KNOWN_PROJECT_ID
    );
    assert.equal(bind.ok, true);
    assert.equal(bind.systemHost, true);
    assert.equal(bind.projectId, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

test('system host + no projectId at all is a 400, not an untenanted write', async () => {
  const { loaded, restore } = withMocks('lib/publicSiteHostBinding.js');
  try {
    const bind = await loaded.resolvePublicProjectForRequest(
      fakeReq({ url: '/x', host: 'localhost' }),
      ''
    );
    assert.equal(bind.ok, false);
    assert.equal(bind.status, 400);
    assert.equal(bind.code, 'PROJECT_ID_REQUIRED');
  } finally {
    restore();
  }
});

test('tenant host: its own projectId resolves to the host project (unchanged)', async () => {
  const { loaded, restore } = withMocks('lib/publicSiteHostBinding.js');
  try {
    const bind = await loaded.resolvePublicProjectForRequest(
      fakeReq({ url: '/x', host: KNOWN_PROJECT_DOMAIN }),
      KNOWN_PROJECT_ID
    );
    assert.equal(bind.ok, true);
    assert.equal(bind.systemHost, false);
    assert.equal(bind.projectId, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

test('tenant host: an empty projectId still binds to the host project (unchanged)', async () => {
  const { loaded, restore } = withMocks('lib/publicSiteHostBinding.js');
  try {
    const bind = await loaded.resolvePublicProjectForRequest(
      fakeReq({ url: '/x', host: KNOWN_PROJECT_DOMAIN }),
      ''
    );
    assert.equal(bind.ok, true);
    assert.equal(bind.projectId, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

test('tenant host: naming ANOTHER project is still 403 PROJECT_HOST_MISMATCH', async () => {
  const { loaded, restore } = withMocks('lib/publicSiteHostBinding.js');
  try {
    const bind = await loaded.resolvePublicProjectForRequest(
      fakeReq({ url: '/x', host: KNOWN_PROJECT_DOMAIN }),
      'proj_someone_else'
    );
    assert.equal(bind.ok, false);
    assert.equal(bind.status, 403);
    assert.equal(bind.code, 'PROJECT_HOST_MISMATCH');
  } finally {
    restore();
  }
});

test('an unmapped custom domain is still refused before the projectId matters', async () => {
  const { loaded, restore } = withMocks('lib/publicSiteHostBinding.js');
  try {
    const bind = await loaded.resolvePublicProjectForRequest(
      fakeReq({ url: '/x', host: 'nobody.example.net' }),
      KNOWN_PROJECT_ID
    );
    assert.equal(bind.ok, false);
    assert.equal(bind.code, 'DOMAIN_NOT_MAPPED');
  } finally {
    restore();
  }
});

// ── POST /api/crm/contact-submit ─────────────────────────────────────────────

function crmMocks(written) {
  return {
    'lib/crmContactsStore.js': { createContact: async (row, scope) => { written.push({ row, scope }); return { id: 'c1' }; } },
    // Spread the real module: projectsStore destructures readPlatformSettingsFromRow
    // from it at load time, so a bare stub blows up every project lookup.
    'lib/projectSiteSettingsStore.js': {
      ...require('../../lib/projectSiteSettingsStore.js'),
      getContactAlertEmails: async () => [],
    },
    'lib/mailer.js': { sendEmail: async () => ({ ok: true }) },
    'lib/activityLog.js': { logActivity: () => {} },
  };
}

test('contact-submit: system host + a made-up project writes no contact', async () => {
  const written = [];
  const { loaded, restore } = withMocks('routes/crm.js', crmMocks(written));
  try {
    const { status, payload } = await post(loaded, '/api/crm/contact-submit', {
      body: { crmConfigId: 'cfg_1', projectId: 'proj_i_made_this_up', email: 'a@b.co' },
    });
    assert.equal(status, 404);
    assert.equal(payload.error.code, 'PROJECT_NOT_FOUND');
    assert.equal(written.length, 0, 'nothing may be written for a project that does not exist');
  } finally {
    restore();
  }
});

test('contact-submit: tenant host + its own project still stores, stamped from the host', async () => {
  const written = [];
  const { loaded, restore } = withMocks('routes/crm.js', crmMocks(written));
  try {
    const { status } = await post(loaded, '/api/crm/contact-submit', {
      host: KNOWN_PROJECT_DOMAIN,
      body: { crmConfigId: 'cfg_1', projectId: KNOWN_PROJECT_ID, email: 'a@b.co' },
    });
    assert.equal(status, 200);
    assert.equal(written.length, 1);
    assert.equal(written[0].scope.projectId, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

test('contact-submit: system host + a REAL project is accepted (localhost/preview dev)', async () => {
  const written = [];
  const { loaded, restore } = withMocks('routes/crm.js', crmMocks(written));
  try {
    const { status } = await post(loaded, '/api/crm/contact-submit', {
      body: { crmConfigId: 'cfg_1', projectId: KNOWN_PROJECT_ID, email: 'a@b.co' },
    });
    assert.equal(status, 200);
    assert.equal(written[0].scope.projectId, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

test('contact-submit: the honeypot still short-circuits, and costs no lookup', async () => {
  const written = [];
  const { loaded, calls, restore } = withMocks('routes/crm.js', crmMocks(written));
  try {
    const { status } = await post(loaded, '/api/crm/contact-submit', {
      body: { crmConfigId: 'cfg_1', projectId: KNOWN_PROJECT_ID, _trap: 'bot' },
    });
    assert.equal(status, 200);
    assert.equal(written.length, 0);
    assert.equal(calls.length, 0, 'a bot must not cost a database round-trip');
  } finally {
    restore();
  }
});

// ── POST /api/contact ────────────────────────────────────────────────────────

function contactMocks(written) {
  return {
    'lib/ContactsStore.js': {
      createContact: async (row, scope) => { written.push({ row, scope }); return { ok: true, status: 200, data: row }; },
      listContacts: async () => ({ ok: true, data: [] }),
      getContact: async () => ({ ok: true, data: null }),
      updateContact: async () => ({ ok: true }),
      deleteContact: async () => ({ ok: true }),
      importContacts: async () => ({ ok: true }),
      listContactTypes: async () => ({ ok: true, data: [] }),
      rowToContact: (r) => r,
      searchContactsInProject: async () => ({ ok: true, data: [] }),
      searchContactsAcrossProjects: async () => ({ ok: true, data: [] }),
      ALL_PROJECTS_SCOPE_ID: '__all__',
      assignContactFromProject: async () => ({ ok: true }),
      assignContactToProjects: async () => ({ ok: true }),
      listContactMembershipProjectIds: async () => ({ ok: true, data: [] }),
    },
    'lib/activityLog.js': { logActivity: () => {} },
  };
}

test('/api/contact: system host + a made-up project writes no lead', async () => {
  const written = [];
  const { loaded, restore } = withMocks('routes/contacts.js', contactMocks(written));
  try {
    const { status, payload } = await post(loaded, '/api/contact', {
      body: { email: 'lead@example.com', projectId: 'proj_i_made_this_up' },
    });
    assert.equal(status, 404);
    assert.equal(payload.error.code, 'PROJECT_NOT_FOUND');
    assert.equal(written.length, 0);
  } finally {
    restore();
  }
});

test('/api/contact: system host + NO projectId is refused rather than stored untenanted', async () => {
  // This is the row that used to land with project_id = '' — invisible to every
  // tenant-scoped screen and impossible to attribute after the fact.
  const written = [];
  const { loaded, restore } = withMocks('routes/contacts.js', contactMocks(written));
  try {
    const { status, payload } = await post(loaded, '/api/contact', {
      body: { email: 'lead@example.com' },
    });
    assert.equal(status, 400);
    assert.equal(payload.error.code, 'PROJECT_ID_REQUIRED');
    assert.equal(written.length, 0);
  } finally {
    restore();
  }
});

test('/api/contact: tenant host + its own project still stores (unchanged)', async () => {
  const written = [];
  const { loaded, restore } = withMocks('routes/contacts.js', contactMocks(written));
  try {
    const { status } = await post(loaded, '/api/contact', {
      host: KNOWN_PROJECT_DOMAIN,
      body: { email: 'lead@example.com', projectId: KNOWN_PROJECT_ID },
    });
    assert.equal(status, 200);
    assert.equal(written.length, 1);
    assert.equal(written[0].scope.projectId, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

// ── POST /api/admin/auth/forgot-password + reset-password ────────────────────

function adminMocks(issued, consumed) {
  return {
    'lib/projectAdminPasswordReset.js': {
      createPasswordResetCode: async (args) => { issued.push(args); return { ok: true, data: null }; },
      consumePasswordResetCode: async (args) => { consumed.push(args); return { ok: true, data: {} }; },
    },
    'lib/mailer.js': { sendEmail: async () => ({ ok: true }) },
    'lib/projectAdminStore.js': {
      createAdminUser: async () => ({ ok: true }),
      authenticateAdminUser: async () => null,
      createAdminSession: async () => ({ ok: true }),
      deleteAdminSession: async () => ({ ok: true }),
      getAdminSession: async () => null,
      listAdminUsers: async () => ({ ok: true, data: [] }),
      updateAdminUser: async () => ({ ok: true }),
      deleteAdminUser: async () => ({ ok: true }),
    },
    'lib/projectSiteSettingsStore.js': {
      ...require('../../lib/projectSiteSettingsStore.js'),
      getSiteSettings: async () => ({ ok: true, data: {} }),
      updateSiteSettings: async () => ({ ok: true }),
    },
  };
}

test('forgot-password: system host + a made-up project issues no reset code', async () => {
  const issued = [];
  const { loaded, restore } = withMocks('routes/projectAdmin.js', adminMocks(issued, []));
  try {
    const { status, payload } = await post(loaded, '/api/admin/auth/forgot-password', {
      body: { projectId: 'proj_i_made_this_up', email: 'admin@example.com' },
    });
    assert.equal(status, 404);
    assert.equal(payload.error.code, 'PROJECT_NOT_FOUND');
    assert.equal(issued.length, 0, 'no code may be minted and no mail sent');
  } finally {
    restore();
  }
});

test('forgot-password: tenant host + its own project still issues (unchanged)', async () => {
  const issued = [];
  const { loaded, restore } = withMocks('routes/projectAdmin.js', adminMocks(issued, []));
  try {
    const { status } = await post(loaded, '/api/admin/auth/forgot-password', {
      host: KNOWN_PROJECT_DOMAIN,
      body: { projectId: KNOWN_PROJECT_ID, email: 'admin@example.com' },
    });
    assert.equal(status, 200);
    assert.equal(issued.length, 1);
    assert.equal(issued[0].projectId, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

test('reset-password: system host + a made-up project changes no password', async () => {
  const consumed = [];
  const { loaded, restore } = withMocks('routes/projectAdmin.js', adminMocks([], consumed));
  try {
    const { status, payload } = await post(loaded, '/api/admin/auth/reset-password', {
      body: {
        projectId: 'proj_i_made_this_up',
        email: 'admin@example.com',
        code: '123456',
        password: 'a-long-enough-password',
      },
    });
    assert.equal(status, 404);
    assert.equal(payload.error.code, 'PROJECT_NOT_FOUND');
    assert.equal(consumed.length, 0);
  } finally {
    restore();
  }
});

test('reset-password: tenant host + its own project still resets (unchanged)', async () => {
  const consumed = [];
  const { loaded, restore } = withMocks('routes/projectAdmin.js', adminMocks([], consumed));
  try {
    const { status } = await post(loaded, '/api/admin/auth/reset-password', {
      host: KNOWN_PROJECT_DOMAIN,
      body: {
        projectId: KNOWN_PROJECT_ID,
        email: 'admin@example.com',
        code: '123456',
        password: 'a-long-enough-password',
      },
    });
    assert.equal(status, 200);
    assert.equal(consumed.length, 1);
    assert.equal(consumed[0].projectId, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

// ── Public tenant read context ───────────────────────────────────────────────

test('a fabricated X-Project-ID mints no project context on a system host', async () => {
  const { loaded, restore } = withMocks('lib/projectAdminApiAuth.js');
  try {
    const ctx = await loaded.resolvePublicTenantProjectContext(
      fakeReq({ url: '/api/blog/posts?status=published', headers: { 'x-project-id': 'proj_nope' } })
    );
    assert.equal(ctx, null, 'no context means the dispatcher answers 401, not an empty 200');
  } finally {
    restore();
  }
});

test('a real X-Project-ID still mints context (Builder preview, localhost dev)', async () => {
  const { loaded, restore } = withMocks('lib/projectAdminApiAuth.js');
  try {
    const ctx = await loaded.resolvePublicTenantProjectContext(
      fakeReq({ url: '/api/blog/posts?status=published', headers: { 'x-project-id': KNOWN_PROJECT_ID } })
    );
    assert.equal(ctx?.project?.id, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

// ── POST /api/public/bug-report + /api/public/bug-report/screenshot ──────────

/**
 * The two bug-report writes. These are the endpoints the shared resolver came
 * FROM (Bug Report 1/5 had a local copy of it), and the screenshot one landed
 * on main after this branch opened — so it is here to prove the seventh public
 * write goes through the same door as the other six.
 */
function bugReportMocks(reports, uploads) {
  return {
    'lib/projectBugReportsStore.js': {
      ...require('../../lib/projectBugReportsStore.js'),
      createBugReport: async (row, scope) => {
        reports.push({ row, scope });
        return { ok: true, status: 201, data: { id: 'bug_1', ...row } };
      },
    },
    'lib/projectBugReportScreenshots.js': {
      ...require('../../lib/projectBugReportScreenshots.js'),
      storeBugReportScreenshot: async (file, scope) => {
        uploads.push({ file, scope });
        return { ok: true, status: 201, data: { assetId: 1, token: 'tok' } };
      },
      verifyBugReportScreenshots: async () => ({ ok: true, data: { assetIds: [], assets: [] } }),
      markScreenshotsAttached: async () => ({ ok: true }),
    },
    'lib/bugReportForward.js': {
      ...require('../../lib/bugReportForward.js'),
      forwardBugReport: async () => ({ ok: true }),
    },
  };
}

test('bug-report submit: system host + a made-up project files no report', async () => {
  const reports = [];
  const { loaded, restore } = withMocks('routes/publicSite.js', bugReportMocks(reports, []));
  try {
    const { status, payload } = await post(loaded, '/api/public/bug-report', {
      body: { projectId: 'proj_i_made_this_up', description: 'the button does nothing' },
    });
    assert.equal(status, 404);
    assert.equal(payload.error.code, 'PROJECT_NOT_FOUND');
    assert.equal(reports.length, 0);
  } finally {
    restore();
  }
});

test('bug-report submit: tenant host + its own project still files (unchanged)', async () => {
  const reports = [];
  const { loaded, restore } = withMocks('routes/publicSite.js', bugReportMocks(reports, []));
  try {
    const { status } = await post(loaded, '/api/public/bug-report', {
      host: KNOWN_PROJECT_DOMAIN,
      body: { projectId: KNOWN_PROJECT_ID, description: 'the button does nothing' },
    });
    assert.equal(status, 201);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].scope.projectId, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

test('bug-report screenshot: system host + a made-up project stores no file', async () => {
  // The seventh public write, added to main after this branch opened. It used a
  // local copy of the resolver; it now shares the one door.
  const uploads = [];
  const { loaded, restore } = withMocks('routes/publicSite.js', bugReportMocks([], uploads));
  try {
    const { status, payload } = await post(loaded, '/api/public/bug-report/screenshot', {
      body: { projectId: 'proj_i_made_this_up', fileName: 'shot.png', fileBase64: 'AAAA' },
    });
    assert.equal(status, 404);
    assert.equal(payload.error.code, 'PROJECT_NOT_FOUND');
    assert.equal(uploads.length, 0, 'a made-up tenant may not park a file in blob storage');
  } finally {
    restore();
  }
});

test('bug-report screenshot: system host + NO projectId is refused, not stored untenanted', async () => {
  const uploads = [];
  const { loaded, restore } = withMocks('routes/publicSite.js', bugReportMocks([], uploads));
  try {
    const { status, payload } = await post(loaded, '/api/public/bug-report/screenshot', {
      body: { fileName: 'shot.png', fileBase64: 'AAAA' },
    });
    assert.equal(status, 400);
    assert.equal(payload.error.code, 'PROJECT_ID_REQUIRED');
    assert.equal(uploads.length, 0);
  } finally {
    restore();
  }
});

test('bug-report screenshot: tenant host + its own project still uploads (unchanged)', async () => {
  const uploads = [];
  const { loaded, restore } = withMocks('routes/publicSite.js', bugReportMocks([], uploads));
  try {
    const { status } = await post(loaded, '/api/public/bug-report/screenshot', {
      host: KNOWN_PROJECT_DOMAIN,
      body: { projectId: KNOWN_PROJECT_ID, fileName: 'shot.png', fileBase64: 'AAAA' },
    });
    assert.equal(status, 201);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].scope.projectId, KNOWN_PROJECT_ID);
  } finally {
    restore();
  }
});

test('bug-report screenshot: tenant host, a body naming ANOTHER project is still refused', async () => {
  const uploads = [];
  const { loaded, restore } = withMocks('routes/publicSite.js', bugReportMocks([], uploads));
  try {
    const { status, payload } = await post(loaded, '/api/public/bug-report/screenshot', {
      host: KNOWN_PROJECT_DOMAIN,
      body: { projectId: 'proj_someone_else', fileName: 'shot.png', fileBase64: 'AAAA' },
    });
    assert.equal(status, 403);
    assert.equal(payload.error.code, 'PROJECT_HOST_MISMATCH');
    assert.equal(uploads.length, 0);
  } finally {
    restore();
  }
});

// ── The guard ────────────────────────────────────────────────────────────────

test('only the audited READ endpoints still call the unverifying host check', () => {
  // The audit of 86bbjj6qb: the reads of published/public data may keep the
  // weaker check. Anything NEW that calls it — especially a POST — has to be
  // classified before this list grows.
  //
  // routes/publicSite.js is NOT here. It was, and that made it the one blind
  // spot in this guard: it is where public endpoints live, so allowing the
  // whole FILE meant the next public write added to it was waved through
  // unexamined. POST /api/public/bug-report/screenshot then landed on main
  // exactly that way. It is checked endpoint by endpoint in the next test.
  const ALLOWED = new Set(['lib/publicSiteHostBinding.js']);
  const PER_ENDPOINT = new Set(['routes/publicSite.js']);

  const repoRoot = path.resolve(__dirname, '../..');
  const offenders = [];
  for (const dir of ['lib', 'routes']) {
    const walk = (rel) => {
      for (const entry of fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
        const next = `${rel}/${entry.name}`;
        if (entry.isDirectory()) { walk(next); continue; }
        if (!entry.name.endsWith('.js')) continue;
        if (ALLOWED.has(next) || PER_ENDPOINT.has(next)) continue;
        const source = fs.readFileSync(path.join(repoRoot, next), 'utf8');
        if (source.includes('assertProjectIdAllowedOnHost')) offenders.push(next);
      }
    };
    walk(dir);
  }

  assert.deepEqual(
    offenders,
    [],
    'assertProjectIdAllowedOnHost does not verify the projectId on system hosts. '
    + 'If this file WRITES or has a side effect, use resolvePublicProjectForRequest. '
    + 'If it only READS public data, add it to ALLOWED here with a note saying why.'
  );
});

/**
 * Split routes/publicSite.js into its endpoint blocks.
 *
 * Every endpoint there is `if (pathname === '<path>' && <method test>) {`, so
 * the header lines are the boundaries: each block runs to the next header, and
 * the last one to the end of `handle`. Crude on purpose — it needs no parser
 * and it fails loudly (zero blocks found) if the file's shape ever changes.
 */
function publicSiteEndpointBlocks() {
  const repoRoot = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(repoRoot, 'routes/publicSite.js'), 'utf8');
  const header = /^\s*if \(pathname === '([^']+)' && (.+)\) \{$/;
  const lines = source.split('\n');

  const starts = [];
  lines.forEach((line, i) => {
    const match = header.exec(line);
    if (match) starts.push({ line: i, pathname: match[1], methodTest: match[2] });
  });

  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].line : lines.length;
    const body = lines.slice(start.line, end).join('\n');
    // A read is a block whose method test mentions only GET and/or HEAD.
    const methods = start.methodTest.match(/'([A-Z]+)'/g) || [];
    const reads = methods.length > 0 && methods.every((m) => m === "'GET'" || m === "'HEAD'");
    return { pathname: start.pathname, methodTest: start.methodTest, body, reads };
  });
}

test('every WRITE endpoint in routes/publicSite.js resolves its project, none believe it', () => {
  const blocks = publicSiteEndpointBlocks();
  assert.ok(blocks.length >= 7, `expected the endpoint blocks to be found, got ${blocks.length}`);

  const writes = blocks.filter((b) => !b.reads);
  assert.ok(writes.length >= 2, `expected at least the two bug-report writes, got ${writes.length}`);

  const believed = writes
    .filter((b) => b.body.includes('assertProjectIdAllowedOnHost'))
    .map((b) => b.pathname);
  assert.deepEqual(
    believed,
    [],
    'these public WRITE endpoints call assertProjectIdAllowedOnHost, which on a '
    + 'system host waves an unverified projectId through. Use '
    + 'resolvePublicProjectForRequest.'
  );

  const unresolved = writes
    .filter((b) => !b.body.includes('resolvePublicProjectForRequest'))
    .map((b) => b.pathname);
  assert.deepEqual(
    unresolved,
    [],
    'these public WRITE endpoints resolve their project some other way. There is '
    + 'one door — resolvePublicProjectForRequest — so two call sites cannot '
    + 'disagree about who owns a row (a local copy is how the screenshot '
    + 'endpoint and the submit endpoint drifted apart in the first place).'
  );
});
