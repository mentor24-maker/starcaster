'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const { normalizeTag, tagKey, rowToTag } = require('../../lib/assetTagsStore');

/**
 * Ticket 86bbrthb5 — the project's asset tag registry.
 *
 * Per-asset tags already existed (assets.tags, a text[]). What did not exist
 * was a list of "the tags this project uses", so the Media Manager had nothing
 * to offer an admin as a choice.
 *
 * The thing most likely to make this useless is not a crash: it is the list
 * quietly filling with "Courts", "courts" and "Courts " as three entries.
 * Most of these tests are about that.
 */

// ── One spelling of a tag ────────────────────────────────────────────────

test('a tag keeps the casing it was typed in', () => {
  // Comparison is case-insensitive; storage is not. Flattening to lower case
  // would make every tag in the list read as shouting or mumbling.
  assert.equal(normalizeTag('Courts'), 'Courts');
  assert.equal(normalizeTag('  Center Court  '), 'Center Court');
});

test('inner whitespace is collapsed, so one tag cannot be two', () => {
  assert.equal(normalizeTag('Center   Court'), 'Center Court');
  assert.equal(normalizeTag('Center\tCourt'), 'Center Court');
});

test('case and surrounding space do not create a second tag', () => {
  const same = ['Courts', 'courts', 'COURTS', '  Courts  ', 'courts '];
  const keys = new Set(same.map(tagKey));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(', ')}`);
});

test('missing and malformed input normalize to empty rather than crashing', () => {
  for (const value of [undefined, null, '', '   ', 0, false, {}, []]) {
    assert.equal(typeof normalizeTag(value), 'string');
  }
  assert.equal(normalizeTag(undefined), '');
  assert.equal(tagKey(null), '');
});

test('rowToTag survives a row with nothing in it', () => {
  assert.equal(rowToTag(null), null);
  assert.deepEqual(rowToTag({}), { id: 0, tag: '', createdAt: '' });
});

// ── The table ────────────────────────────────────────────────────────────

test('asset_tags carries BOTH tenant columns, or scopedInsertRow stamps neither', () => {
  // Landmine 12. A table with only project_id fails projectScope's probe and
  // the insert then lands with NO tenant at all, silently.
  const sql = read('docs/SQL/asset_tags_setup.sql');
  assert.match(sql, /project_id\s+text/, 'asset_tags must declare project_id');
  assert.match(sql, /owner_user_id\s+text/, 'asset_tags must declare owner_user_id');
});

test('uniqueness is per project and case-insensitive', () => {
  const sql = read('docs/SQL/asset_tags_setup.sql');
  assert.match(sql, /unique index[\s\S]*asset_tags \(project_id, lower\(tag\)\)/,
    'two tenants may both have "Courts"; one tenant may not have "Courts" and "courts"');
});

test('RLS is enabled, matching the 2026-08-17 lockdown', () => {
  assert.match(read('docs/SQL/asset_tags_setup.sql'),
    /alter table public\.asset_tags enable row level security/);
});

test('the SQL is idempotent', () => {
  const sql = read('docs/SQL/asset_tags_setup.sql');
  assert.match(sql, /create table if not exists/);
  assert.doesNotMatch(sql, /^\s*(drop|delete|truncate)\b/im, 'additive only');
});

// ── Reachability: a guard in front of the feature ────────────────────────

test('the asset route accepts /api/asset-tags at all', () => {
  // The handler returns false for any path outside its own prefixes, and the
  // dispatcher has a second list. Miss either and every endpoint below is
  // written, tested in isolation, and unreachable over HTTP.
  const routes = read('routes/assets.js');
  assert.match(routes, /normalizedPath\.startsWith\('\/api\/asset-tags'\)/,
    'the handler must admit the path');
  assert.match(routes, /prefixes: \['\/api\/assets', '\/api\/asset-categories', '\/api\/asset-tags'\]/,
    'the dispatcher must route the path here');
});

test('the tag endpoints exist for the verbs the module uses', () => {
  const routes = read('routes/assets.js');
  assert.match(routes, /pathname === '\/api\/asset-tags' && requestMethod === 'GET'/);
  assert.match(routes, /pathname === '\/api\/asset-tags' && requestMethod === 'POST'/);
});

test('the module writes asset tags with PATCH, the verb the route handles', () => {
  // The same trap that broke rename in 86bbrth9z: /api/assets/:id takes PATCH
  // and DELETE only, and a PUT falls through unmatched and silently does
  // nothing.
  const preview = read('components/builder-template-preview.tsx');
  const start = preview.indexOf('async function saveTags');
  assert.ok(start > 0, 'saveTags must exist');
  const body = preview.slice(start, start + 900);
  assert.match(body, /method: "PATCH"/);
  assert.doesNotMatch(body, /method: "PUT"/);
});

test('a tenant admin may manage their own tags', () => {
  // 86bbrqnqu draws the line at whose resources get spent. These are the
  // tenant's own tags on the tenant's own media, so they must NOT be denied.
  const { acceptsProjectAdminSession } = require('../../lib/projectAdminApiAuth');
  const reach = (p, method = 'GET') => acceptsProjectAdminSession(p, { method, req: { url: p } });
  assert.equal(reach('/api/asset-tags'), true);
  assert.equal(reach('/api/asset-tags', 'POST'), true);
  assert.equal(reach('/api/asset-tags/12', 'DELETE'), true);
});
