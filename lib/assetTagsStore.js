'use strict';

/**
 * The tags a project uses on its media.
 *
 * Per-asset tags are `assets.tags` (a text[]) and are written through
 * `updateAsset`. This store is the REGISTRY behind them — the list the Media
 * Manager offers an admin to choose from — and it exists because there was no
 * way to answer "which tags does this project use?" without scanning every
 * asset row.
 *
 * ── Which table this writes to, and why it changed ───────────────────────
 *
 * Until 2026-09-04 this wrote to `asset_tags`, a second tag table created with
 * the Media Manager (#510) and never written to — 0 rows in production, across
 * every project. Dane asked for one tag table, so it now reads and writes
 * `messaging_tags`, the registry that has been in use since March (149 rows,
 * two projects), with the origin recorded on the row: a tag created through a
 * client's own admin back-end carries `source = 'client-admin'`.
 *
 * There was no data to migrate, which is what made the switch small rather
 * than risky. `asset_tags` is dropped in its own SQL file once this is live and
 * its 0-row count has been re-confirmed at that moment.
 *
 * ── Why this store still exists next to lib/messagingTagsStore.js ────────
 *
 * One table, two vocabularies. `messagingTagsStore` coins a NEW tag through
 * `normalizeMessagingTag`, which title-cases and keeps at most THREE words —
 * right for a hashtag, wrong for a media tag, where "Center Court North
 * Entrance" is a reasonable thing to type and would be coined as "Center Court
 * North". Media tags keep the casing the admin typed and are only trimmed and
 * whitespace-collapsed, exactly as they were before.
 *
 * That vocabulary applies on CREATE and nowhere else. Round 1 of 86bbu4gdu ran
 * it on the read path too, so a media tag came back out of the messaging store
 * truncated and the Messaging > Tags edit form wrote the truncation back to the
 * shared row. See the note on `storedText` in lib/messagingTagsStore.js.
 *
 * One deliberate difference from lib/assetCategoriesStore.js, kept from the
 * original: creating a tag that already exists RETURNS THE EXISTING ROW rather
 * than returning 409. Two admins typing "Courts" on the same afternoon is
 * normal use, not a conflict, and a modal that errors on it teaches people to
 * avoid the feature.
 *
 * lib/messagingTagsStore.js answers the same question with a 409 and a readable
 * sentence, and that difference is intentional rather than an oversight. Here
 * the tag is picked while filing a photo, where "add" and "reuse" are one
 * action and the admin does not care which happened. There, the tag is the
 * thing being made — an explicit "Add tag" form and a "Clone Tag" button — so
 * silently handing back the existing row would look like the button did
 * nothing. Both paths refuse to dump a constraint name, which is the part that
 * is NOT a matter of taste.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('./projectScope');
const { normalizeMessagingTagSource } = require('./messagingTagSource');

/**
 * The consolidated tag table. Named `messagingTags` in tableConfig because
 * that is the table's name; the Media Manager is simply another writer to it.
 */
function t() { return tableConfig().messagingTags; }

/**
 * One spelling of a tag. Trim, collapse inner whitespace, keep the casing the
 * admin typed — comparison is case-insensitive, but "Courts" should still read
 * as "Courts" in the list rather than being flattened to lower case.
 */
function normalizeTag(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/** The key uniqueness is judged on, matching the unique index. */
function tagKey(value) {
  return normalizeTag(value).toLowerCase();
}

function rowToTag(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    tag: row.tag || '',
    // '' reads as "origin not recorded", which is the truth for every row
    // written before the column existed. See lib/messagingTagSource.js.
    source: normalizeMessagingTagSource(row.source),
    createdAt: row.created_at || '',
  };
}

/**
 * True when PostgREST refused the write because `source` is not a column yet —
 * i.e. docs/SQL/messaging_tags_source.sql has not been applied to this
 * database. Deliberately narrow: any other refusal is returned to the caller
 * untouched (CLAUDE.md landmine 15 — a fallback is for a thing being ABSENT,
 * never for the database saying no).
 */
function isMissingSourceColumn(res) {
  if (!res || res.ok) return false;
  const text = String(res.error || res.message || '').toLowerCase();
  return text.includes('source')
    && (text.includes('column') || text.includes('schema cache'));
}

/**
 * The cap matches lib/messagingTagsStore.js, deliberately. Both stores now read
 * the SAME table, and this one is what keeps create idempotent
 * (findAssetTagByName filters the list rather than querying lower(tag)); at a
 * lower cap, a project past the cap would stop finding its own existing tags
 * and the picker would silently show a truncated list.
 */
async function listAssetTags(scope = null) {
  const query = await scopedListQuery(
    t(),
    'select=*&order=tag.asc&limit=5000',
    scope
  );
  return sbQuery({ table: t(), query });
}

/** Case-insensitive lookup within this project, used to keep create idempotent. */
async function findAssetTagByName(tag, scope = null) {
  const key = tagKey(tag);
  if (!key) return { ok: true, status: 200, data: [] };
  const listed = await listAssetTags(scope);
  if (!listed.ok) return listed;
  const rows = Array.isArray(listed.data) ? listed.data : [];
  return {
    ok: true,
    status: 200,
    data: rows.filter((row) => tagKey(row.tag) === key),
  };
}

async function createAssetTag(input, scope = null) {
  const tag = normalizeTag(input && (input.tag ?? input.name));
  if (!tag) {
    return { ok: false, status: 400, error: 'tag is required' };
  }
  if (tag.length > 60) {
    return { ok: false, status: 400, error: 'A tag may be at most 60 characters' };
  }
  const source = normalizeMessagingTagSource(input && input.source);

  // Idempotent on (project_id, lower(tag)). Returning the existing row rather
  // than 409 is what lets the modal treat "add" and "reuse" as one action.
  const existing = await findAssetTagByName(tag, scope);
  if (!existing.ok) return existing;
  if (Array.isArray(existing.data) && existing.data.length) {
    return { ok: true, status: 200, data: existing.data, existed: true };
  }

  // The key is OMITTED rather than sent as '' when there is no source, so a
  // write from the Starcaster back-end behaves exactly as it did before and
  // does not depend on the new column existing at all.
  const insert = source ? { tag, source } : { tag };
  const row = await scopedInsertRow(t(), insert, scope);
  const res = await sbQuery({
    method: 'POST',
    table: t(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (res.ok || !source || !isMissingSourceColumn(res)) return res;

  // The migration has not been applied here. Write the tag — losing it would
  // be the worse outcome for a client trying to file a photo — but say so
  // loudly and tell the caller the flag did NOT land, so nothing downstream
  // reads the absence of a source as "created in the Starcaster back-end".
  console.warn(
    '[assetTagsStore] messaging_tags has no "source" column, so this tag was '
    + 'stored without its origin. Apply docs/SQL/messaging_tags_source.sql.'
  );
  const bare = await scopedInsertRow(t(), { tag }, scope);
  const retry = await sbQuery({
    method: 'POST',
    table: t(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [bare],
  });
  if (!retry.ok) return retry;
  return { ...retry, sourceRecorded: false };
}

async function deleteAssetTag(tagId, scope = null) {
  const id = Number(tagId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid tag id is required' };
  }
  // Scoped by id so one project cannot delete another's tag. Removing a tag
  // from the registry does NOT strip it from assets that carry it — those are
  // independent values on assets.tags, and silently rewriting rows across the
  // project is not what "delete this tag from the list" should mean.
  const query = await scopedIdQuery(t(), `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'DELETE',
    table: t(),
    query,
    headers: { Prefer: 'return=representation' },
  });
}

module.exports = {
  normalizeTag,
  tagKey,
  rowToTag,
  isMissingSourceColumn,
  listAssetTags,
  findAssetTagByName,
  createAssetTag,
  deleteAssetTag,
};
