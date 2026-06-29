'use strict';

const { sbQuery } = require('./supabase');
const { scopedListQuery, scopedInsertRow } = require('./projectScope');

const CONTENT_TYPES_TABLE = 'content_types';

function safeText(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function keyFromName(name) {
  return safeText(name, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pluralFromName(name) {
  const label = safeText(name, 240);
  if (!label) return '';
  if (/s$/i.test(label)) return label;
  return `${label}s`;
}

const FAMILY_SLUG_BY_LABEL = {
  'short form': 'short-form',
  'long form': 'long-form',
  social: 'social',
  email: 'email',
  'support copy': 'support',
};

function familySlugForContentType(value) {
  const raw = safeText(value, 120);
  if (!raw) return 'long-form';
  const normalized = raw.toLowerCase();
  if (FAMILY_SLUG_BY_LABEL[normalized]) return FAMILY_SLUG_BY_LABEL[normalized];
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) return normalized;
  return normalized.replace(/\s+/g, '-');
}

function rowToContentType(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    name: safeText(row.name || row.type_name || row.format || row.label, 240),
    key: safeText(row.key, 120),
  };
}

function nameMatches(row, wanted) {
  const target = safeText(wanted, 240).toLowerCase();
  if (!target) return false;
  const fields = [row?.name, row?.type_name, row?.format, row?.label, row?.key];
  return fields.some((value) => safeText(value, 240).toLowerCase() === target);
}

async function listContentTypes(limit = 5000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const query = await scopedListQuery(
    CONTENT_TYPES_TABLE,
    `select=*&order=id.asc&limit=${safeLimit}`,
    scope
  );
  const res = await sbQuery({
    method: 'GET',
    table: CONTENT_TYPES_TABLE,
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToContentType).filter(Boolean) : [],
  };
}

async function findContentTypeByName(name, scope = null) {
  const wanted = safeText(name, 240);
  if (!wanted) return { ok: false, status: 400, error: 'content type name is required' };

  for (const field of ['name', 'key', 'type_name', 'format', 'label']) {
    const value = field === 'key' ? keyFromName(wanted) : wanted;
    const query = await scopedListQuery(
      CONTENT_TYPES_TABLE,
      `select=*&${field}=eq.${encodeURIComponent(value)}&limit=1`,
      scope
    );
    const res = await sbQuery({
      method: 'GET',
      table: CONTENT_TYPES_TABLE,
      query,
    });
    if (!res.ok) continue;
    const row = Array.isArray(res.data) ? res.data[0] : null;
    if (row) {
      return { ok: true, status: 200, data: rowToContentType(row) };
    }
  }

  const listRes = await listContentTypes(5000, scope);
  if (!listRes.ok) return listRes;
  const match = (listRes.data || []).find((entry) => {
    if (nameMatches(entry, wanted)) return true;
    return safeText(entry.key, 120).toLowerCase() === keyFromName(wanted);
  });
  if (match?.id) {
    return { ok: true, status: 200, data: match };
  }

  return {
    ok: false,
    status: 404,
    error: `No content type found for "${wanted}" in content_types.`,
  };
}

async function ensureContentTypeByName(name, scope = null, options = {}) {
  const existing = await findContentTypeByName(name, scope);
  if (existing.ok && existing.data?.id) return existing;

  const label = safeText(name, 240);
  const row = await scopedInsertRow(CONTENT_TYPES_TABLE, {
    name: label,
    key: keyFromName(label),
    plural_name: pluralFromName(label),
    family: familySlugForContentType(options?.family || 'long-form'),
  }, scope);
  const res = await sbQuery({
    method: 'POST',
    table: CONTENT_TYPES_TABLE,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToContentType(created) };
}

module.exports = {
  CONTENT_TYPES_TABLE,
  rowToContentType,
  listContentTypes,
  findContentTypeByName,
  ensureContentTypeByName,
};
