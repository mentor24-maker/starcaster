'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
} = require('./projectScope');

function table() {
  return tableConfig().developModuleClasses;
}

function safeText(value, max = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function rowToDevelopModuleClass(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    name: safeText(row.name, 240),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

async function listDevelopModuleClasses(limit = 5000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const query = await scopedListQuery(table(), `select=*&order=name.asc&limit=${safeLimit}`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToDevelopModuleClass) : [],
  };
}

async function createDevelopModuleClass(input, scope = null) {
  const row = await scopedInsertRow(table(), { name: safeText(input?.name, 240) }, scope);
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToDevelopModuleClass(created) };
}

async function getDevelopModuleClass(id, scope = null) {
  const classId = Number(id || 0) || 0;
  if (!classId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `select=*&id=eq.${classId}&limit=1`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Class not found' };
  return { ok: true, status: 200, data: rowToDevelopModuleClass(row) };
}

async function updateDevelopModuleClass(id, input, scope = null) {
  const classId = Number(id || 0) || 0;
  if (!classId) return { ok: false, status: 400, error: 'id is required' };
  const row = await scopedPatchRow(table(), { name: safeText(input?.name, 240) }, scope);
  const query = await scopedIdQuery(table(), `id=eq.${classId}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Class not found' };
  return { ok: true, status: 200, data: rowToDevelopModuleClass(updated) };
}

async function deleteDevelopModuleClass(id, scope = null) {
  const classId = Number(id || 0) || 0;
  if (!classId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${classId}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!deleted) return { ok: false, status: 404, error: 'Class not found' };
  return { ok: true, status: 200, data: rowToDevelopModuleClass(deleted) };
}

module.exports = {
  listDevelopModuleClasses,
  createDevelopModuleClass,
  getDevelopModuleClass,
  updateDevelopModuleClass,
  deleteDevelopModuleClass,
};
