'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');
const { rowToBuilderSavedSection, normalizeBuilderSection } = require('./builder');

const STORE_FILE = path.join(__dirname, '..', 'data', 'develop_saved_sections.json');
const SUPPORT_CACHE = new Map();

function t() {
  return tableConfig().developSavedSections;
}

function ensureFile() {
  ensureJsonFile(STORE_FILE, { savedSections: [] }, { mode: 0o600 });
}

function readStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { savedSections: [] };
    if (!Array.isArray(parsed.savedSections)) parsed.savedSections = [];
    return parsed;
  } catch {
    return { savedSections: [] };
  }
}

function writeStore(store) {
  ensureFile();
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeScope(scope) {
  return {
    projectId: safeText(scope?.projectId || scope?.project_id),
    userId: safeText(scope?.userId || scope?.user_id),
  };
}

function matchesScope(item, scope) {
  const { projectId } = normalizeScope(scope);
  if (!projectId) return true;
  return safeText(item?.projectId || item?.project_id) === projectId;
}

function sanitizeRecord(row) {
  if (!row || typeof row !== 'object') return null;
  const mapped = rowToBuilderSavedSection(row);
  if (!mapped) return null;
  return {
    ...mapped,
    projectId: safeText(row.projectId || row.project_id),
    ownerUserId: safeText(row.ownerUserId || row.owner_user_id),
    createdAt: safeText(row.createdAt || row.created_at),
    updatedAt: safeText(row.updatedAt || row.updated_at),
  };
}

function inputToRow(input) {
  const section = normalizeBuilderSection(input?.section);
  if (!section) throw new Error('section is required');
  return {
    id: safeText(input?.id, 120) || nextId('saved_section'),
    name: safeText(input?.name, 255),
    section,
  };
}

function isMissingTableError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return (
    text.includes('does not exist') ||
    text.includes('relation') ||
    text.includes('schema cache')
  );
}

async function supportsSupabase() {
  if (!isSupabaseConfigured()) return false;
  const table = t();
  if (!table) return false;
  if (SUPPORT_CACHE.has(table)) return SUPPORT_CACHE.get(table);
  const probe = await sbQuery({ table, query: 'select=id&limit=1' });
  const supported = probe.ok || !isMissingTableError(probe.error);
  SUPPORT_CACHE.set(table, supported);
  return supported;
}

async function listSavedSections(limit = 1000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));

  if (await supportsSupabase()) {
    const query = await scopedListQuery(
      t(),
      `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
      scope
    );
    const res = await sbQuery({ method: 'GET', table: t(), query });
    if (res.ok) {
      return {
        ok: true,
        status: 200,
        data: (Array.isArray(res.data) ? res.data : []).map(sanitizeRecord).filter(Boolean),
      };
    }
    if (!isMissingTableError(res.error)) return { ok: false, status: 500, error: res.error };
  }

  const store = readStore();
  const items = store.savedSections
    .map(sanitizeRecord)
    .filter(Boolean)
    .filter((item) => matchesScope(item, scope))
    .sort((a, b) => {
      const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bt - at;
    })
    .slice(0, safeLimit);

  return { ok: true, status: 200, data: items };
}

async function createSavedSection(input, scope = null) {
  const now = new Date().toISOString();
  const normalizedScope = normalizeScope(scope);
  let row;
  try {
    row = inputToRow(input);
  } catch (err) {
    return { ok: false, status: 400, error: err.message || 'Invalid saved section' };
  }
  row.id = row.id || nextId('saved_section');

  if (await supportsSupabase()) {
    const scopedRow = await scopedInsertRow(t(), row, scope);
    const res = await sbQuery({
      method: 'POST',
      table: t(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [scopedRow],
    });
    if (res.ok) {
      const created = Array.isArray(res.data) ? res.data[0] : res.data;
      return { ok: true, status: 201, data: sanitizeRecord(created) };
    }
    if (!isMissingTableError(res.error)) return { ok: false, status: res.status || 500, error: res.error };
  }

  const record = sanitizeRecord({
    ...row,
    projectId: normalizedScope.projectId,
    ownerUserId: normalizedScope.userId,
    createdAt: now,
    updatedAt: now,
  });

  const store = readStore();
  store.savedSections.unshift(record);
  writeStore(store);
  return { ok: true, status: 201, data: record };
}

async function updateSavedSection(id, input, scope = null) {
  const sectionId = safeText(id, 120);
  if (!sectionId) return { ok: false, status: 400, error: 'id is required' };

  if (await supportsSupabase()) {
    let row;
    try {
      row = await scopedPatchRow(t(), inputToRow({ ...input, id: sectionId }), scope);
    } catch (err) {
      return { ok: false, status: 400, error: err.message || 'Invalid saved section' };
    }
    const query = await scopedIdQuery(t(), `id=eq.${encodeURIComponent(sectionId)}&select=*`, scope);
    const res = await sbQuery({
      method: 'PATCH',
      table: t(),
      query,
      headers: { Prefer: 'return=representation' },
      body: row,
    });
    if (res.ok) {
      const updated = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!updated) return { ok: false, status: 404, error: 'Saved section not found' };
      return { ok: true, status: 200, data: sanitizeRecord(updated) };
    }
    if (!isMissingTableError(res.error)) return { ok: false, status: res.status || 500, error: res.error };
  }

  const store = readStore();
  const idx = store.savedSections.findIndex((item) => {
    const s = sanitizeRecord(item);
    return safeText(s?.id) === sectionId && matchesScope(item, scope);
  });
  if (idx < 0) return { ok: false, status: 404, error: 'Saved section not found' };

  const existing = sanitizeRecord(store.savedSections[idx]);
  let newSection;
  try {
    newSection = normalizeBuilderSection(input?.section) ?? existing.section;
  } catch {
    newSection = existing.section;
  }

  const updated = {
    ...existing,
    name: input?.name !== undefined ? safeText(input.name, 255) : existing.name,
    section: newSection,
    updatedAt: new Date().toISOString(),
  };

  store.savedSections[idx] = updated;
  writeStore(store);
  return { ok: true, status: 200, data: updated };
}

async function deleteSavedSection(id, scope = null) {
  const sectionId = safeText(id, 120);
  if (!sectionId) return { ok: false, status: 400, error: 'id is required' };

  if (await supportsSupabase()) {
    const query = await scopedIdQuery(t(), `id=eq.${encodeURIComponent(sectionId)}&select=*`, scope);
    const res = await sbQuery({
      method: 'DELETE',
      table: t(),
      query,
      headers: { Prefer: 'return=representation' },
    });
    if (res.ok) {
      const removed = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!removed) return { ok: false, status: 404, error: 'Saved section not found' };
      return { ok: true, status: 200, data: sanitizeRecord(removed) };
    }
    if (!isMissingTableError(res.error)) return { ok: false, status: res.status || 500, error: res.error };
  }

  const store = readStore();
  const idx = store.savedSections.findIndex((item) => {
    const s = sanitizeRecord(item);
    return safeText(s?.id) === sectionId && matchesScope(item, scope);
  });
  if (idx < 0) return { ok: false, status: 404, error: 'Saved section not found' };

  const [removed] = store.savedSections.splice(idx, 1);
  writeStore(store);
  return { ok: true, status: 200, data: sanitizeRecord(removed) };
}

module.exports = {
  listSavedSections,
  createSavedSection,
  updateSavedSection,
  deleteSavedSection,
};
