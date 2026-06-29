'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
} = require('./projectScope');
const { getMessagingFormatByName } = require('./messagingFormatsStore');
const { findContentTypeByName, ensureContentTypeByName } = require('./contentTypesStore');

const WEB_PAGES_FORMAT = 'Web Pages';
const BUILDER_PAGE_SOURCE = 'builder_page';

function table() {
  return tableConfig().contentItems;
}

function safeText(value, max = 50000) {
  return String(value || '').trim().slice(0, max);
}

function rowToContentItem(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    format: safeText(row.format, 120),
    title: safeText(row.title, 300),
    content: safeText(row.content, 50000),
    topic: safeText(row.topic, 240),
    category: safeText(row.category, 240),
    url: safeText(row.url, 1200),
    sourceType: safeText(row.source_type, 80),
    sourceId: safeText(row.source_id, 80),
    sourceSlug: safeText(row.source_slug, 160),
    contentHash: safeText(row.content_hash, 128),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function inputToRow(input) {
  const row = {
    format: safeText(input?.format, 120),
    title: safeText(input?.title, 300),
    content: safeText(input?.content, 50000),
    topic: safeText(input?.topic, 240),
    category: safeText(input?.category, 240),
    url: safeText(input?.url, 1200),
    source_type: safeText(input?.sourceType || input?.source_type, 80),
    source_id: safeText(input?.sourceId || input?.source_id, 80),
    source_slug: safeText(input?.sourceSlug || input?.source_slug, 160),
    content_hash: safeText(input?.contentHash || input?.content_hash, 128),
  };
  const typeId = Number(input?.typeId || input?.type_id || 0) || 0;
  if (typeId) row.type_id = typeId;
  return row;
}

function errorText(res) {
  return String(res?.error || res?.message || '').toLowerCase();
}

function shouldRetryWithoutTypeIdColumn(res) {
  const text = errorText(res);
  return text.includes('type_id') && text.includes('column') && (text.includes('does not exist') || text.includes('schema cache'));
}

async function resolveTypeIdForFormat(formatName, scope, options = {}) {
  const name = safeText(formatName, 120);
  if (!name) return { ok: false, status: 400, error: 'format is required' };

  let typeRes = await findContentTypeByName(name, scope);
  if (!typeRes.ok && options.ensureType) {
    typeRes = await ensureContentTypeByName(name, scope);
  }
  if (typeRes.ok && typeRes.data?.id) {
    return { ok: true, status: 200, data: typeRes.data.id };
  }

  const formatRes = await getMessagingFormatByName(name, scope);
  if (formatRes.ok && formatRes.data?.id) {
    return { ok: true, status: 200, data: formatRes.data.id };
  }

  return {
    ok: false,
    status: 404,
    error: typeRes.error || formatRes.error || `No content type found for "${name}".`,
  };
}

function isTypeIdForeignKeyError(res) {
  const text = errorText(res);
  return text.includes('type_id') && (text.includes('foreign key') || text.includes('fkey'));
}

async function prepareContentItemRow(input, scope) {
  const row = inputToRow(input);
  if (row.type_id) return { ok: true, row };

  const formatName = row.format;
  if (!formatName) return { ok: false, status: 400, error: 'format is required' };

  const typeRes = await resolveTypeIdForFormat(formatName, scope, { ensureType: true });
  if (!typeRes.ok) return typeRes;
  row.type_id = typeRes.data;
  return { ok: true, row };
}

async function postContentItemRow(row, scope, method, query) {
  let res = await sbQuery({
    method,
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: method === 'POST' ? [row] : row,
  });
  if (!res.ok && isTypeIdForeignKeyError(res)) {
    return {
      ok: false,
      status: 400,
      error: 'content_items.type_id must reference a row in content_types. Add "Web Pages" to content_types or use Import from Web Pages (reads Builder directly).',
    };
  }
  if (!res.ok && shouldRetryWithoutTypeIdColumn(res)) {
    const legacyRow = { ...row };
    delete legacyRow.type_id;
    res = await sbQuery({
      method,
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: method === 'POST' ? [legacyRow] : legacyRow,
    });
  }
  return res;
}

async function listContentItems(limit = 5000, scope = null, options = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const format = safeText(options?.format, 120);
  let query = `select=*&order=updated_at.desc,title.asc&limit=${safeLimit}`;
  if (format) {
    query += `&format=eq.${encodeURIComponent(format)}`;
  }
  const scopedQuery = await scopedListQuery(table(), query, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: scopedQuery,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToContentItem).filter(Boolean) : [],
  };
}

async function listWebPageContentItems(limit = 5000, scope = null) {
  return listContentItems(limit, scope, { format: WEB_PAGES_FORMAT });
}

async function findContentItemBySource(sourceType, sourceId, scope = null) {
  const type = safeText(sourceType, 80);
  const id = safeText(sourceId, 80);
  if (!type || !id) return { ok: true, status: 200, data: null };
  const query = await scopedListQuery(
    table(),
    `select=*&source_type=eq.${encodeURIComponent(type)}&source_id=eq.${encodeURIComponent(id)}&limit=1`,
    scope
  );
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : null;
  return { ok: true, status: 200, data: rowToContentItem(row) };
}

async function createContentItem(input, scope = null) {
  const prepared = await prepareContentItemRow(input, scope);
  if (!prepared.ok) return prepared;
  const row = await scopedInsertRow(table(), prepared.row, scope);
  const res = await postContentItemRow(row, scope, 'POST', 'select=*');
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToContentItem(created) };
}

async function updateContentItem(id, input, scope = null) {
  const itemId = Number(id || 0) || 0;
  if (!itemId) return { ok: false, status: 400, error: 'id is required' };
  const prepared = await prepareContentItemRow(input, scope);
  if (!prepared.ok) return prepared;
  const row = await scopedPatchRow(table(), prepared.row, scope);
  const query = await scopedIdQuery(table(), `id=eq.${itemId}&select=*`, scope);
  const res = await postContentItemRow(row, scope, 'PATCH', query);
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Content item not found' };
  return { ok: true, status: 200, data: rowToContentItem(updated) };
}

async function upsertContentItem(input, scope = null) {
  const sourceType = safeText(input?.sourceType || input?.source_type, 80);
  const sourceId = safeText(input?.sourceId || input?.source_id, 80);
  if (!sourceType || !sourceId) {
    return { ok: false, status: 400, error: 'sourceType and sourceId are required' };
  }

  const existingRes = await findContentItemBySource(sourceType, sourceId, scope);
  if (!existingRes.ok) return existingRes;

  const payload = inputToRow(input);
  const existing = existingRes.data;
  if (existing && existing.contentHash && existing.contentHash === payload.content_hash) {
    return { ok: true, status: 200, data: existing, skipped: true };
  }

  if (existing?.id) {
    const updateRes = await updateContentItem(existing.id, input, scope);
    if (!updateRes.ok) return updateRes;
    return { ...updateRes, skipped: false, action: 'updated' };
  }

  const createRes = await createContentItem(input, scope);
  if (!createRes.ok) return createRes;
  return { ...createRes, skipped: false, action: 'created' };
}

async function deleteContentItemBySource(sourceType, sourceId, scope = null) {
  const existingRes = await findContentItemBySource(sourceType, sourceId, scope);
  if (!existingRes.ok) return existingRes;
  if (!existingRes.data?.id) {
    return { ok: true, status: 200, data: null, deleted: false };
  }

  const query = await scopedIdQuery(table(), `id=eq.${existingRes.data.id}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: rowToContentItem(deleted), deleted: true };
}

module.exports = {
  WEB_PAGES_FORMAT,
  BUILDER_PAGE_SOURCE,
  rowToContentItem,
  listContentItems,
  listWebPageContentItems,
  findContentItemBySource,
  createContentItem,
  updateContentItem,
  upsertContentItem,
  deleteContentItemBySource,
};
