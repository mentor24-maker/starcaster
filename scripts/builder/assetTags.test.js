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

// ── Round 2: the seam between the two vocabularies ───────────────────────
//
// Everything above is about the consolidation being correct. These are about
// the two defects review found once it WAS correct — both of them at the point
// where the Media Manager and Messaging now read and write the same rows.

const {
  authoredText,
  storedText,
  rowToMessagingTag,
  buildTagPatch,
  isDuplicateTag,
  duplicateTagMessage,
} = require('../../lib/messagingTagsStore');

test('a media tag is not truncated on the way OUT of the messaging store', () => {
  // The defect: rowToMessagingTag ran every row through normalizeMessagingTag,
  // so a four-word media tag came back as three words. Display was the small
  // half of it; see the next test for the half that rewrote the database.
  const stored = 'Center Court North Entrance';
  assert.equal(
    rowToMessagingTag({ id: 1, tag: stored }).tag,
    stored,
    'the messaging vocabulary must not be applied when READING a shared row'
  );
});

test('opening a media tag in Messaging and saving it leaves the tag alone', () => {
  // This is the whole bug, end to end and in order: the row is read, the edit
  // form prefills `tag` from what it read (public/js/messaging.js
  // openMessagingTagEditForm), and saving PATCHes that value straight back. If
  // either end normalizes, an admin who opened the tag to change its TOPIC
  // silently rewrites the shared row to a truncation that no longer matches
  // the strings on assets.tags.
  const stored = 'Center Court North Entrance';
  const prefilled = rowToMessagingTag({ id: 1, tag: stored }).tag;
  const written = buildTagPatch({ tag: prefilled }).patch.tag;
  assert.equal(written, stored, 'a round trip through the edit form must be lossless');
});

test('the messaging vocabulary still applies when Messaging COINS a tag', () => {
  // The fix is a narrowing, not a removal. Three words and title case is right
  // for a hashtag, and lib/webPageTagImport.js + lib/assetFieldImport.js both
  // rely on it. If this ever stops shaping a NEW tag, those importers change
  // behaviour too.
  assert.equal(authoredText('center court north entrance'), 'Center Court North');
  assert.equal(storedText('center court north entrance'), 'center court north entrance');
});

test('storedText only trims and collapses — it never reshapes', () => {
  assert.equal(storedText('  Center   Court  '), 'Center Court');
  assert.equal(storedText('lower case stays lower'), 'lower case stays lower');
  assert.equal(storedText(undefined), '');
});

// ── A duplicate is a sentence, not a constraint dump ─────────────────────

test('createMessagingTag asks the uniqueness question BEFORE the index does', () => {
  // idx_messaging_tags_project_tag lands with docs/SQL/messaging_tags_source.sql.
  // Until round 2 there was no check here at all, so the moment Dane applied
  // the migration — the one step this ticket hands to him — Messaging > Tags
  // would have started putting the raw constraint name in a toast.
  const store = read('lib/messagingTagsStore.js');
  const start = store.indexOf('async function createMessagingTag');
  assert.ok(start > 0, 'createMessagingTag must exist');
  const body = store.slice(start, store.indexOf('async function getMessagingTag'));
  const check = body.indexOf('findMessagingTagByName');
  const insert = body.indexOf("method: 'POST'");
  assert.ok(check > 0, 'create must look for an existing tag');
  assert.ok(check < insert, 'the lookup must run BEFORE the insert, not after it fails');
  assert.match(body, /status: 409/, 'a duplicate must be refused as a conflict');
});

test('renaming onto an existing tag is refused the same way, excluding itself', () => {
  // The same index, one verb over. Excluding the row being edited matters:
  // without it, saving a tag whose name did not change reports the tag as a
  // duplicate of itself.
  const store = read('lib/messagingTagsStore.js');
  const start = store.indexOf('async function updateMessagingTag');
  const body = store.slice(start, store.indexOf('async function deleteMessagingTag'));
  assert.match(body, /findMessagingTagByName/, 'update must check for a clash too');
  assert.match(body, /Number\(r\.id\) !== tagId/, 'the row being edited must be excluded');
});

test('a duplicate refusal is recognised, and nothing else is', () => {
  // Landmine 15 again, in the other direction: widening this would swallow a
  // permission or RLS refusal and report it as "that tag already exists".
  assert.equal(isDuplicateTag({
    ok: false,
    error: 'duplicate key value violates unique constraint "idx_messaging_tags_project_tag"',
  }), true);

  assert.equal(isDuplicateTag({ ok: true }), false);
  assert.equal(isDuplicateTag(null), false);
  assert.equal(isDuplicateTag({ ok: false, error: 'permission denied for table messaging_tags' }), false);
  assert.equal(isDuplicateTag({ ok: false, error: 'new row violates row-level security policy' }), false);
  assert.equal(isDuplicateTag({
    ok: false,
    error: "Could not find the 'source' column of 'messaging_tags' in the schema cache",
  }), false, 'a missing column is a different problem with a different fix');
});

test('the refusal says WHY, including when the vocabulary caused the clash', () => {
  // Landmine 17. "Clone Tag" appends " Copy"; for a three-word tag the fourth
  // word is dropped again, so the clone collides with the tag it was cloned
  // from. Without the second half of this message that reads as the button
  // being broken.
  const shortened = duplicateTagMessage('Awareness Tag Name Copy', 'Awareness Tag Name');
  assert.match(shortened, /already has a tag called "Awareness Tag Name"/);
  assert.match(shortened, /becomes "Awareness Tag Name"/, 'it must name what the tag became');
  assert.match(shortened, /at most three words/, 'and why it became that');

  // When nothing was reshaped, the explanation would be a lie, so it is absent.
  const plain = duplicateTagMessage('awareness', 'Awareness');
  assert.match(plain, /already has a tag called "Awareness"/);
  assert.doesNotMatch(plain, /three words/, 'do not explain a shortening that did not happen');
  assert.match(plain, /without regard to capitals/, 'say why "awareness" clashed with "Awareness"');
});

// ── Both stores read the same table, so they read the same amount of it ──

test('the two stores share one row cap, because they share one table', () => {
  // listAssetTags capped at 1000 while listMessagingTags used 5000, so the
  // Media Manager's picker showed a shorter list than Messaging did for the
  // same table — the two lists coming back by another route.
  assert.match(read('lib/assetTagsStore.js'), /limit=5000/);
  assert.doesNotMatch(read('lib/assetTagsStore.js'), /limit=1000/);
  assert.match(read('lib/messagingTagsStore.js'), /Math\.min\(Number\(limit\) \|\| 5000, 5000\)/);
});

// ── Round 3: what the second review found ────────────────────────────────
//
// Four things, none of them the consolidation itself: a doc that still taught
// the bug round 1 caused, a guarantee nothing delivered, a raw constraint dump
// still reachable on the media side, and a button that could only ever fail.

const {
  uniqueClonedTag,
  tagLikePattern,
  tagKey: messagingTagKey,
} = require('../../lib/messagingTagsStore');
const { isDuplicateRefusal } = require('../../lib/importDuplicateSkip');

test('the Media Manager doc no longer teaches the round-1 bug', () => {
  // docs/MEDIA_MANAGER.md said "runs EVERY tag through normalizeMessagingTag",
  // which is the exact belief that put the coining rule on the read path and
  // truncated media tags. The next reader who followed it would put it back.
  const doc = read('docs/MEDIA_MANAGER.md');
  assert.doesNotMatch(
    doc,
    /runs every tag through `normalizeMessagingTag`/i,
    'the doc must not say the vocabulary applies to every tag'
  );
  assert.match(doc, /applies on CREATE in Messaging, and nowhere else/,
    'it must say WHERE the vocabulary applies');
  assert.match(doc, /not on\s+the way out of the table, and not on an update/i,
    'and where it deliberately does not');
});

test('the API says when the origin flag did NOT land', () => {
  // The store returned `sourceRecorded: false` and nothing read it, so the API
  // answered a plain success. Between this shipping and Dane applying
  // docs/SQL/messaging_tags_source.sql, every client-admin tag is stored
  // unflagged — permanently, behind a 201 the caller cannot tell apart.
  const route = read('routes/assets.js');
  const start = route.indexOf("pathname === '/api/asset-tags' && requestMethod === 'POST'");
  assert.ok(start > 0, 'the POST route must exist');
  const body = route.slice(start, start + 2000);
  assert.match(body, /result\.sourceRecorded === false/,
    'the route must read the flag the store sets');
  assert.match(body, /sourceRecorded: false/,
    'and put it on the response');

  // And the modal must render it, or surfacing it changed nothing anyone sees.
  const ui = read('components/builder-template-preview.tsx');
  assert.match(ui, /meta\?\.sourceRecorded === false/,
    'the tag modal must read the flag off the response');
  assert.match(ui, /\{tagNotice \? <div className="builder-media-manager-status">/,
    'and render it INSIDE the modal — the shared status line sits behind it');
});

test('the media store translates a duplicate refusal too, not just Messaging', () => {
  // createMessagingTag got isDuplicateTag in round 2 and createAssetTag did
  // not, so once idx_messaging_tags_project_tag exists a create that loses the
  // race against the pre-check dumps the constraint name into a tenant's modal
  // — and breaks this store's own documented contract that add and reuse are
  // one action.
  const store = read('lib/assetTagsStore.js');
  assert.match(store, /require\('\.\/messagingTagsStore'\)/,
    'it must use the SAME predicate, not a second copy that can drift');
  const start = store.indexOf('async function existingAfterDuplicate');
  assert.ok(start > 0, 'the media store must have a duplicate path at all');
  const body = store.slice(start, store.indexOf('async function createAssetTag'));
  assert.match(body, /isDuplicateTag\(res\)/, 'narrow: only the uniqueness refusal');
  assert.match(body, /findAssetTagByName/, 'it must look the winning row back up');
  assert.match(body, /existed: true/, 'and hand it back as a reuse, like the pre-check does');
  assert.match(body, /if \(!rows\.length\) return null/,
    'an empty lookup is NOT a duplicate — return the refusal untouched');

  // Both the flagged insert and the bare fallback insert have to go through it,
  // or one of the two paths still dumps a constraint name.
  const create = store.slice(store.indexOf('async function createAssetTag'),
    store.indexOf('async function deleteAssetTag'));
  assert.equal((create.match(/existingAfterDuplicate\(/g) || []).length, 2,
    'both inserts in createAssetTag must be covered');
});

// ── Round 4: Clone Tag coined a new name instead of copying one ──────────
//
// Consolidation is what put a >3-word tag in front of that button for the
// first time: before it, Messaging could only ever coin a three-word tag, so
// `authoredText` had nothing to truncate. Cloning the media tag
// "Center Court North Entrance" created "Center Court North" — a row that is
// not a copy of anything — and reported success.

test('cloning a long tag keeps the original name, it does not coin a new one', () => {
  // THE test that fails on the round-3 code: there the clone went through
  // authoredText and the result was three words with the original nowhere in
  // it. A clone's name must still contain the tag it was cloned from.
  const original = 'Center Court North Entrance';
  const asked = `${original} Copy`;

  const first = uniqueClonedTag(asked, new Set());
  assert.equal(first, 'Center Court North Entrance Copy');
  assert.ok(first.includes(original), 'a clone must still contain the tag it copied');
  assert.notEqual(messagingTagKey(first), messagingTagKey(original));

  // And numbered, not re-coined, once that name is taken too.
  const second = uniqueClonedTag(asked, new Set([messagingTagKey(asked)]));
  assert.equal(second, 'Center Court North Entrance Copy 2');
  assert.ok(second.includes(original), 'the numbered clone must contain it as well');
});

test('the counter climbs until it finds a gap, and gives up rather than looping', () => {
  const taken = new Set(['courts copy', 'courts copy 2', 'courts copy 3']);
  assert.equal(uniqueClonedTag('Courts Copy', taken), 'Courts Copy 4');

  // A name that is not taken is returned untouched — no gratuitous numbering.
  assert.equal(uniqueClonedTag('Courts Copy', new Set()), 'Courts Copy');

  // Everything taken: return '' so the caller refuses with the ordinary
  // sentence, rather than spinning or inserting a duplicate.
  const all = new Set(['a b c']);
  for (let n = 2; n <= 50; n += 1) all.add(`a b c ${n}`);
  assert.equal(uniqueClonedTag('A B C', all), '');
  assert.equal(uniqueClonedTag('', new Set()), '');
});

test('the doc no longer teaches "a create" as the test — round 3 came from that', () => {
  // Round 2 corrected the doc to say the vocabulary applies "on CREATE in
  // Messaging, and nowhere else", which is true and was still the belief that
  // produced round 3: Clone Tag IS a create, so it coined. The question the
  // doc has to leave a reader with is whether Messaging is AUTHORING the name.
  const doc = read('docs/MEDIA_MANAGER.md');
  assert.match(doc, /"a create" is not the test/i,
    'the doc must say that being a create is not what decides it');
  assert.match(doc, /A clone COPIES a name that is already in the table/,
    'and say what a clone does instead');
  assert.match(doc, /`clone: true`/, 'naming the flag that carries it');
  assert.doesNotMatch(doc, /uniquify/,
    'the retired flag must not be left in the doc as the way to do this');
  assert.doesNotMatch(doc, /"Center Court North2"/,
    'nor the round-2 name shape it no longer produces');
});

test('a clone is a COPY, so the coining rule is not applied to it', () => {
  // The whole defect in one assertion pair: create must branch on `clone`, and
  // the clone branch must reach storedText rather than authoredText.
  const store = read('lib/messagingTagsStore.js');
  const create = store.slice(store.indexOf('async function createMessagingTag'),
    store.indexOf('async function getMessagingTag'));
  assert.match(create, /const isClone = Boolean\(input\?\.clone\)/,
    'create must know whether it is copying or coining');
  assert.match(create, /isClone \? storedText\(input\?\.tag, 240\) : authoredText\(input\?\.tag, 240\)/,
    'a clone keeps the stored text; only the Add form is coined');
  assert.match(create, /freeClonedTagName\(tag, scope\)/, 'the free name comes from the tested helper');
  assert.match(create, /tag: finalTag/, 'and it is the name that gets INSERTED');

  // The Add form still gets a sentence: there a duplicate IS the mistake.
  assert.match(create, /if \(!isClone\)[\s\S]{0,200}status: 409/,
    'a duplicate that is not a clone is still refused with 409');
});

test('only the clone opts out of coining — the Add form still gets a sentence', () => {
  const ui = read('public/js/messaging.js');
  const clone = ui.slice(ui.indexOf("'clone', 'Clone Tag'"), ui.indexOf("'delete', 'Delete Tag'"));
  assert.match(clone, /clone: true/, 'Clone Tag must declare itself a copy');
  assert.doesNotMatch(clone, /uniquify/,
    'the old flag asked to be numbered but still let the name be coined');
  assert.match(clone, /cloned as "\$\{savedName\}"/,
    'and report the name it actually got — it is not always the one asked for');

  // The Add form must NOT opt in.
  const addForm = ui.slice(ui.indexOf('async function submitTagCreate'),
    ui.indexOf('async function submitTagCreate') + 1500);
  assert.doesNotMatch(addForm, /clone: true/, 'the Add form keeps the 409');
});

// ── One create must not read the whole table ─────────────────────────────

test('the uniqueness lookup asks for the row, not for all 5000 rows', () => {
  // createMessagingTag opened with a full listMessagingTags(5000) — and both
  // importers call it inside a per-tag loop, having already loaded that same
  // list. An import creating 600 tags made 600 full-table reads inside one
  // serverless invocation, which is the shape that froze canonical
  // propagation part-way through on 2026-08-16.
  const store = read('lib/messagingTagsStore.js');
  const find = store.slice(store.indexOf('async function findMessagingTagByName'),
    store.indexOf('async function freeClonedTagName'));
  assert.match(find, /queryMessagingTagRows\(tagLikePattern\(tag\), scope\)/,
    'the lookup must query the row');
  assert.doesNotMatch(find, /listMessagingTags/,
    'and must not list the table to find one row');

  // The clone's numbered family is one filtered read too, not another full list.
  const free = store.slice(store.indexOf('async function freeClonedTagName'),
    store.indexOf('async function createMessagingTag'));
  assert.match(free, /queryMessagingTagRows\(`\$\{tagLikePattern\(base\)\}\*`, scope\)/);
  assert.doesNotMatch(free, /listMessagingTags/);

  // The media side asks the same way, off the same shared pattern builder —
  // one table, one rule, no second copy to drift.
  const media = read('lib/assetTagsStore.js');
  const mediaFind = media.slice(media.indexOf('async function findAssetTagByName'),
    media.indexOf('async function existingAfterDuplicate'));
  assert.match(mediaFind, /tag=ilike\./, 'the media lookup must query the row too');
  assert.doesNotMatch(mediaFind, /listAssetTags/, 'not filter the whole registry');
  assert.match(media, /tagLikePattern/, 'and it must share the messaging pattern builder');
});

test('a tag carrying a LIKE wildcard still matches only itself', () => {
  // % and _ are wildcards and \ is the escape character, so an unescaped
  // pattern would make "50_off" match "500off" — a lookup that reports a
  // duplicate the project does not have.
  assert.equal(tagLikePattern('50_off'), '50\\_off');
  assert.equal(tagLikePattern('100% Courts'), '100\\% Courts');
  assert.equal(tagLikePattern('a\\b'), 'a\\\\b');
  // Ordinary tags are left completely alone.
  assert.equal(tagLikePattern('Center Court North Entrance'), 'Center Court North Entrance');
  // And it collapses like storedText does, so the pattern matches the stored row.
  assert.equal(tagLikePattern('  Center   Court  '), 'Center Court');
});

// ── A duplicate is a skip, not an error ──────────────────────────────────

test('a create refused as already-present is a skip; a real failure is not', () => {
  assert.equal(isDuplicateRefusal({ ok: false, status: 409 }), true);
  assert.equal(isDuplicateRefusal({ ok: false, status: 500 }), false,
    'a run that could not reach the database is NOT "already present"');
  assert.equal(isDuplicateRefusal({ ok: false, status: 400 }), false);
  assert.equal(isDuplicateRefusal({ ok: true, status: 409 }), false);
  assert.equal(isDuplicateRefusal(null), false);
});

test('a forced re-import where everything exists reports 200, not 500', () => {
  // `force` exists to bypass the importer's own dedupe set, so a forced re-run
  // asks for every existing tag again. Once messaging_tags has its unique
  // index every one of those comes back 409 — and both importers put those in
  // `errors`, so runWebPageToTagImport returned a hard 500 with a duplicate
  // message and runGenericTextToTextImport reported failure even on a run
  // that HAD created new rows.
  for (const file of ['lib/webPageTagImport.js', 'lib/assetFieldImport.js']) {
    const src = read(file);
    assert.match(src, /require\('\.\/importDuplicateSkip'\)/,
      `${file} must use the shared predicate, not a second copy that can drift`);
    assert.match(src, /isDuplicateRefusal\(result\)/, `${file} must recognise the refusal`);
    assert.match(src, /skipped \+= 1/, `${file} must count it as a skip`);
    assert.match(src, /created, skipped, errors/,
      `${file} must report the skip count it now keeps`);
  }

  // And the errors path is still reachable for a real failure — a run that
  // could not write must never read as a run where everything already existed.
  const generic = read('lib/assetFieldImport.js');
  const helper = generic.slice(generic.indexOf('const record = (result, dup, sourceId)'),
    generic.indexOf('for (const candidate of candidates)'));
  assert.match(helper, /errors\.push\(\{ sourceId, error: result\.error \|\| 'Create failed' \}\)/,
    'anything that is not a duplicate is still an error');
});

