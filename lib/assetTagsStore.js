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
 * Shaped after lib/assetCategoriesStore.js, with one deliberate difference:
 * creating a tag that already exists RETURNS THE EXISTING ROW rather than
 * returning 409. Two admins typing "Courts" on the same afternoon is normal
 * use, not a conflict, and a modal that errors on it teaches people to avoid
 * the feature.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('./projectScope');

function t() { return tableConfig(); }

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
    createdAt: row.created_at || '',
  };
}

async function listAssetTags(scope = null) {
  const query = await scopedListQuery(
    t().assetTags,
    'select=*&order=tag.asc&limit=1000',
    scope
  );
  return sbQuery({ table: t().assetTags, query });
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

  // Idempotent on (project_id, lower(tag)). Returning the existing row rather
  // than 409 is what lets the modal treat "add" and "reuse" as one action.
  const existing = await findAssetTagByName(tag, scope);
  if (!existing.ok) return existing;
  if (Array.isArray(existing.data) && existing.data.length) {
    return { ok: true, status: 200, data: existing.data, existed: true };
  }

  const row = await scopedInsertRow(t().assetTags, { tag }, scope);
  return sbQuery({
    method: 'POST',
    table: t().assetTags,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
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
  const query = await scopedIdQuery(t().assetTags, `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'DELETE',
    table: t().assetTags,
    query,
    headers: { Prefer: 'return=representation' },
  });
}

module.exports = {
  normalizeTag,
  tagKey,
  rowToTag,
  listAssetTags,
  findAssetTagByName,
  createAssetTag,
  deleteAssetTag,
};
