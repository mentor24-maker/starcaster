'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { acceptsProjectAdminSession } = require('../../lib/projectAdminApiAuth');
const { requireProjectContext } = require('../../lib/requireProjectContext');
const fs = require('node:fs');
const path = require('node:path');

const { scopedListQuery } = require('../../lib/projectScope');

/**
 * Ticket 86bbrqnqu. The Media Manager module (5/5) is the first thing to call
 * the asset API with a PROJECT-ADMIN session — a tenant admin on their own
 * site, not Dane in the platform app.
 *
 * Nothing had to be switched on for that to work, and that is the point:
 * lib/projectAdminApiAuth.js is a DENY-list, so every asset endpoint was
 * already reachable by a tenant admin and no test said so either way. These
 * tests turn that from an accident into a decision.
 *
 * The line is WHOSE RESOURCES GET SPENT, not whose data gets touched. A
 * tenant admin managing their own media is the feature; a tenant admin
 * spending Alphire's model budget, stock-video quota, Google Drive or server
 * CPU is not.
 */

const asTenantAdmin = (pathname, method = 'GET') =>
  acceptsProjectAdminSession(pathname, { method, req: { url: pathname } });

// ── What a tenant admin DOES get: their own media ────────────────────────

test('a tenant admin can reach the endpoints the Media Manager module runs on', () => {
  const allowed = [
    '/api/assets',
    '/api/assets/1234',
    '/api/assets/1234/source-media',
    '/api/assets/1234/replace-image',
    '/api/assets/import-image',
    '/api/assets/blob-upload',
    '/api/assets/bulk-import-images',
    '/api/assets/usage',
    '/api/asset-categories',
  ];
  for (const path of allowed) {
    assert.equal(asTenantAdmin(path), true, `${path} should be reachable by a tenant admin`);
  }
});

// ── What it does NOT get, and why ────────────────────────────────────────

test('AI generation is refused — it bills Alphire per call with no tenant cap', () => {
  assert.equal(asTenantAdmin('/api/assets/generate', 'POST'), false);
  assert.equal(asTenantAdmin('/api/assets/generate/status'), false);
  assert.equal(asTenantAdmin('/api/assets/generate/cancel', 'POST'), false);
});

test('stock video search is refused — one shared platform quota for every tenant', () => {
  assert.equal(asTenantAdmin('/api/assets/video/search'), false);
  assert.equal(asTenantAdmin('/api/assets/video/feedback', 'POST'), false);
  assert.equal(asTenantAdmin('/api/assets/video/stats'), false);
});

test("anything reaching Alphire's own Google Drive is refused", () => {
  // A tenant admin uploading here would be writing into the agency's Drive
  // with the agency's credentials.
  assert.equal(asTenantAdmin('/api/assets/upload-google-drive', 'POST'), false);
  assert.equal(asTenantAdmin('/api/assets/import-drive-folder', 'POST'), false);
  assert.equal(asTenantAdmin('/api/assets/drive-file/abc123'), false);
});

test('server-side bulk resize is refused — platform CPU, per asset, unbounded', () => {
  assert.equal(asTenantAdmin('/api/assets/bulk-resize', 'POST'), false);
});

test('platform marketing tooling is refused', () => {
  assert.equal(asTenantAdmin('/api/assets/import-from-fields', 'POST'), false);
});

test('the deny entries do not swallow the endpoints beside them', () => {
  // These are prefix matches. '/api/assets/generate' must not take
  // '/api/assets' with it, and '/api/assets/video/' must not take a numeric
  // asset id that happens to start with the same letters.
  assert.equal(asTenantAdmin('/api/assets'), true);
  assert.equal(asTenantAdmin('/api/assets/import-image', 'POST'), true);
  assert.equal(asTenantAdmin('/api/asset-categories'), true);
});

// ── Tenant isolation does not live in the deny-list ──────────────────────

test('an asset request with no project context is refused before it reaches the route', () => {
  // This is what makes the scoping below safe. scopedListQuery returns an
  // UNSCOPED query when the scope carries no projectId (see the next test),
  // which would be every project's assets — so the guarantee has to come from
  // the request never getting that far.
  const refused = requireProjectContext({ projectContext: null }, '/api/assets', 'GET');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'PROJECT_REQUIRED');

  const allowed = requireProjectContext(
    { projectContext: { project: { id: 'proj_tenant' } } }, '/api/assets', 'GET');
  assert.equal(allowed.ok, true);
});

test('a scope with no projectId produces an UNSCOPED query — pinned, not endorsed', async () => {
  // Documenting the hazard rather than pretending it is not there. If the
  // guard above is ever removed or an asset path is added to
  // isProjectContextOptional, this is what the tenant would get.
  const unscoped = await scopedListQuery('assets', 'select=*', { projectId: '', userId: '' });
  assert.equal(unscoped, 'select=*');
});

test('public.assets carries BOTH tenant columns, or scopedInsertRow stamps neither', () => {
  // Landmine 12: a table missing either column makes scopedInsertRow stop
  // stamping EITHER, the insert still succeeds, nothing errors, and the rows
  // land untenanted. That is the whole reason a tenant admin writing here is
  // safe at all.
  //
  // Asserted against the RECORDED PRODUCTION STRUCTURE rather than by calling
  // scopedInsertRow, which probes the live table: with no database — which is
  // how CI runs — that probe returns false and the call comes back unstamped,
  // so the test would fail for the environment rather than the schema. This
  // is the instrument tenantColumns.test.js already uses for the same reason.
  const schema = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'schema', 'production.sql'), 'utf8');
  const createTable = schema.match(/CREATE TABLE "public"\."assets" \(([\s\S]*?)\n\);/);
  assert.ok(createTable, 'production.sql must record public.assets');
  assert.match(createTable[1], /"project_id" "text"/, 'assets must carry project_id');
  assert.match(createTable[1], /"owner_user_id" "text"/, 'assets must carry owner_user_id');
});
