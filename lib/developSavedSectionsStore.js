'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { rowToBuilderSavedSection, normalizeBuilderSection } = require('./builder');
const { nextId } = require('../routes/http');

function table() {
  return tableConfig().developSavedSections;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function rowToSavedSection(row) {
  const mapped = rowToBuilderSavedSection(row);
  if (!mapped) return null;
  return mapped;
}

function inputToRow(input) {
  const section = normalizeBuilderSection(input?.section);
  if (!section) {
    throw new Error('section is required');
  }
  return {
    id: safeText(input?.id, 120) || nextId('saved_section'),
    name: safeText(input?.name, 255),
    section,
  };
}

async function listSavedSections(limit = 1000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const query = await scopedListQuery(
    table(),
    `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToSavedSection).filter(Boolean) : [],
  };
}

async function createSavedSection(input, scope = null) {
  let row;
  try {
    row = await scopedInsertRow(table(), inputToRow(input), scope);
  } catch (error) {
    return { ok: false, status: 400, error: error.message || 'Invalid saved section' };
  }
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToSavedSection(created) };
}

async function updateSavedSection(id, input, scope = null) {
  const sectionId = safeText(id, 120);
  if (!sectionId) return { ok: false, status: 400, error: 'id is required' };
  let row;
  try {
    row = await scopedPatchRow(table(), inputToRow({ ...input, id: sectionId }), scope);
  } catch (error) {
    return { ok: false, status: 400, error: error.message || 'Invalid saved section' };
  }
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(sectionId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Saved section not found' };
  return { ok: true, status: 200, data: rowToSavedSection(updated) };
}

async function deleteSavedSection(id, scope = null) {
  const sectionId = safeText(id, 120);
  if (!sectionId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(sectionId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Saved section not found' };
  return { ok: true, status: 200, data: rowToSavedSection(removed) };
}

module.exports = {
  listSavedSections,
  createSavedSection,
  updateSavedSection,
  deleteSavedSection,
  rowToSavedSection,
};
