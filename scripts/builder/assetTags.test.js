'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const {
  normalizeTag,
  tagKey,
  rowToTag,
  isMissingSourceColumn,
} = require('../../lib/assetTagsStore');
const {
  MESSAGING_TAG_SOURCE_CLIENT_ADMIN,
  normalizeMessagingTagSource,
  isKnownMessagingTagSource,
} = require('../../lib/messagingTagSource');

/**
 * Ticket 86bbrthb5 — the project's asset tag registry.
 * Ticket 86bbu4gdu — folded into messaging_tags, with the origin on the row.
 *
 * Per-asset tags already existed (assets.tags, a text[]). What did not exist
 * was a list of "the tags this project uses", so the Media Manager had nothing
 * to offer an admin as a choice. It got its own table, asset_tags, which was
 * never written to — 0 rows in production. Dane asked for one tag table, so
 * this store now reads and writes messaging_tags.
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
  assert.deepEqual(rowToTag({}), { id: 0, tag: '', source: '', createdAt: '' });
});

// ── A media tag is NOT put through the messaging vocabulary ──────────────

test('a media tag keeps more than three words, unlike a messaging tag', () => {
  // This is the whole reason lib/assetTagsStore.js still exists next to
  // lib/messagingTagsStore.js now that they share a table.
  // normalizeMessagingTag title-cases and keeps at most THREE words, which is
  // right for a hashtag and wrong for "Center Court North Entrance".
  const { normalizeMessagingTag } = require('../../lib/messagingTagNormalize');
  const typed = 'Center Court North Entrance';
  assert.equal(normalizeTag(typed), typed, 'the media registry stores what was typed');
  assert.notEqual(
    normalizeMessagingTag(typed),
    typed,
    'if this ever stops truncating, re-check whether the two stores can merge'
  );
});

// ── Where a tag came from ────────────────────────────────────────────────

test("the client admin's tags are flagged, and nothing else is", () => {
  assert.equal(normalizeMessagingTagSource('client-admin'), MESSAGING_TAG_SOURCE_CLIENT_ADMIN);
  assert.equal(isKnownMessagingTagSource('client-admin'), true);
});

test('an unrecognised origin stores as "" rather than as itself', () => {
  // The column exists to be filtered on; one typo'd variant makes a filter
  // quietly incomplete. Same rule, same reason, as lib/assetSource.js.
  for (const value of ['clientadmin', 'Client Admin', 'admin-media-manager', 'x', undefined, null, 42]) {
    assert.equal(normalizeMessagingTagSource(value), '',
      `${JSON.stringify(value)} must not be stored as an origin`);
  }
});

test('an origin is matched case- and space-insensitively', () => {
  assert.equal(normalizeMessagingTagSource('  Client-Admin  '), 'client-admin');
  assert.equal(normalizeMessagingTagSource('CLIENT-ADMIN'), 'client-admin');
});

test('rowToTag reports an unrecognised stored origin as "" too', () => {
  assert.equal(rowToTag({ id: 1, tag: 'Courts', source: 'client-admin' }).source, 'client-admin');
  assert.equal(rowToTag({ id: 1, tag: 'Courts', source: 'made-up' }).source, '');
  assert.equal(rowToTag({ id: 1, tag: 'Courts' }).source, '');
});

test('the client admin module declares its origin on every tag it creates', () => {
  // The flag is client-declared (the endpoint is shared with the Starcaster
  // admin app), so a module that forgets to send it writes an unflagged tag
  // and the whole feature reads as not working.
  const preview = read('components/builder-template-preview.tsx');
  assert.match(preview, /const CLIENT_ADMIN_TAG_SOURCE = "client-admin";/);
  const start = preview.indexOf('async function addNewTag');
  assert.ok(start > 0, 'addNewTag must exist');
  const body = preview.slice(start, start + 900);
  assert.match(body, /"\/api\/asset-tags"/);
  assert.match(body, /source: CLIENT_ADMIN_TAG_SOURCE/,
    'the create call must declare where the tag came from');
});

test('the route passes the declared origin through to the store', () => {
  const routes = read('routes/assets.js');
  assert.match(routes, /createAssetTag\(\s*\{ tag: body\.tag \?\? body\.name, source: body\.source \}/,
    'dropping body.source here silently unflags every client-admin tag');
});

// ── The store writes to the consolidated table ───────────────────────────

test('the store reads and writes messaging_tags, not asset_tags', () => {
  const store = read('lib/assetTagsStore.js');
  assert.match(store, /tableConfig\(\)\.messagingTags/,
    'the point of 86bbu4gdu is that there is one tag table');
  assert.doesNotMatch(store, /tableConfig\(\)\.assetTags|t\(\)\.assetTags/,
    'no path may still reach the old table');
});

test('a create with no origin omits the column instead of sending ""', () => {
  // A write from the Starcaster back-end must behave exactly as it did before
  // and must not depend on the new column existing at all.
  const store = read('lib/assetTagsStore.js');
  assert.match(store, /const insert = source \? \{ tag, source \} : \{ tag \};/);
});

// ── The missing-column path is narrow, and says so ───────────────────────

test('a missing source column is recognised, and nothing else is', () => {
  // CLAUDE.md landmine 15: a fallback is for a thing being ABSENT, never for
  // the database saying no. If this ever widens, an unrelated refusal starts
  // being retried and reported as a success.
  assert.equal(isMissingSourceColumn(
    { ok: false, error: "Could not find the 'source' column of 'messaging_tags' in the schema cache" }
  ), true);
  assert.equal(isMissingSourceColumn(
    { ok: false, error: 'column "source" of relation "messaging_tags" does not exist' }
  ), true);

  assert.equal(isMissingSourceColumn({ ok: true }), false);
  assert.equal(isMissingSourceColumn(null), false);
  assert.equal(isMissingSourceColumn(
    { ok: false, error: 'duplicate key value violates unique constraint "idx_messaging_tags_project_tag"' }
  ), false, 'a uniqueness refusal must reach the caller');
  assert.equal(isMissingSourceColumn(
    { ok: false, error: 'permission denied for table messaging_tags' }
  ), false, 'a permission refusal must reach the caller');
  assert.equal(isMissingSourceColumn(
    { ok: false, error: 'new row violates row-level security policy' }
  ), false);
});

test('the fallback tells the caller the origin did NOT land', () => {
  const store = read('lib/assetTagsStore.js');
  assert.match(store, /sourceRecorded: false/,
    'nothing downstream may read a missing origin as "created in the back-end"');
  assert.match(store, /messaging_tags_source\.sql/,
    'the warning must name the migration that fixes it');
});

// ── The migration ────────────────────────────────────────────────────────

test('the source column is additive, defaulted, and not backfilled', () => {
  const sql = read('docs/SQL/messaging_tags_source.sql');
  assert.match(sql, /add column if not exists source text not null default ''/);
  assert.doesNotMatch(sql, /^\s*update\s+public\.messaging_tags/im,
    "guessing an origin for rows that predate the column puts a false claim in it");
});

test('uniqueness is carried over from asset_tags: per project, case-insensitive', () => {
  const sql = read('docs/SQL/messaging_tags_source.sql');
  assert.match(sql, /create unique index if not exists idx_messaging_tags_project_tag\s+on public\.messaging_tags \(project_id, lower\(tag\)\)/,
    'two tenants may both have "Courts"; one tenant may not have "Courts" and "courts"');
});

test('the index is preceded by a duplicate check that names what clashes', () => {
  // 149 rows already live in this table. A raw constraint-violation dump does
  // not tell the operator WHICH tags to merge, and he cannot read the database.
  const sql = read('docs/SQL/messaging_tags_source.sql');
  const guard = sql.indexOf('raise exception');
  const index = sql.indexOf('create unique index if not exists idx_messaging_tags_project_tag');
  assert.ok(guard > 0, 'a duplicate check must exist');
  assert.ok(guard < index, 'the check must run BEFORE the index build');
  assert.match(sql, /group by project_id, lower\(tag\)/,
    'the check must group on the same expression the index uses, or it disagrees with it');
});

test('the migration is idempotent and additive only', () => {
  const sql = read('docs/SQL/messaging_tags_source.sql');
  assert.match(sql, /if not exists/);
  assert.doesNotMatch(sql, /^\s*(drop|delete|truncate)\b/im, 'additive only');
});

test('asset_tags is NOT dropped in this file', () => {
  // The drop is a separate step, run only once this is live and the 0-row
  // count has been re-confirmed at that moment.
  assert.doesNotMatch(read('docs/SQL/messaging_tags_source.sql'), /drop table/i);
});

test('messaging_tags carries BOTH tenant columns, or scopedInsertRow stamps neither', () => {
  // Landmine 12. A table with only project_id fails projectScope's probe and
  // the insert then lands with NO tenant at all, silently. Measured 2026-09-04
  // against a same-day mirror of production: 149 rows, 0 with a null tenant.
  const sql = read('docs/schema/production.sql');
  const start = sql.indexOf('CREATE TABLE "public"."messaging_tags"');
  assert.ok(start > 0, 'messaging_tags must be in the schema record');
  const body = sql.slice(start, sql.indexOf(');', start));
  assert.match(body, /"project_id"\s+"text"/, 'messaging_tags must declare project_id');
  assert.match(body, /"owner_user_id"\s+"text"/, 'messaging_tags must declare owner_user_id');
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
