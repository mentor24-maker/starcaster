'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'blog_categories.json');
const SUPPORT_CACHE = new Map();

function t() { return tableConfig().blogCategories; }

function ensureFile() {
  ensureJsonFile(STORE_FILE, { categories: [] }, { mode: 0o600 });
}

function readStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { categories: [] };
    if (!Array.isArray(parsed.categories)) parsed.categories = [];
    return parsed;
  } catch {
    return { categories: [] };
  }
}

function writeStore(store) {
  ensureFile();
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function safeText(v) { return String(v || '').trim(); }

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  return {
    id:           String(input.id || ''),
    projectId:    safeText(input.projectId || input.project_id),
    ownerUserId:  safeText(input.ownerUserId || input.owner_user_id),
    name:         String(input.name || ''),
    slug:         String(input.slug || ''),
    description:  String(input.description || ''),
    color:        String(input.color || ''),
    sortOrder:    typeof input.sortOrder !== 'undefined' ? Number(input.sortOrder) : Number(input.sort_order ?? 0),
    createdAt:    String(input.createdAt || input.created_at || ''),
    updatedAt:    String(input.updatedAt || input.updated_at || ''),
  };
}

function toRow(c) {
  return {
    id:            c.id,
    project_id:    c.projectId,
    owner_user_id: c.ownerUserId || null,
    name:          c.name,
    slug:          c.slug,
    description:   c.description,
    color:         c.color,
    sort_order:    c.sortOrder,
  };
}

function isMissingTable(err) {
  const t = String(err || '').toLowerCase();
  return t.includes('does not exist') || t.includes('relation') || t.includes('schema cache');
}

async function supportsSupabase() {
  if (!isSupabaseConfigured()) return false;
  const table = t();
  if (!table) return false;
  if (SUPPORT_CACHE.has(table)) return SUPPORT_CACHE.get(table);
  const probe = await sbQuery({ table, query: 'select=id&limit=1' });
  const ok = probe.ok || !isMissingTable(probe.error);
  SUPPORT_CACHE.set(table, ok);
  return ok;
}

async function listCategories(scope = null) {
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = 'select=*&order=sort_order.asc,name.asc&limit=500';
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) return (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
    if (!isMissingTable(result.error)) return [];
  }

  const store = readStore();
  return store.categories
    .map(sanitize)
    .filter(Boolean)
    .filter((c) => !projectId || c.projectId === projectId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

async function getCategory(id, scope = null) {
  const catId = safeText(id);
  if (!catId) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = `select=*&id=eq.${encodeURIComponent(catId)}&limit=1`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : null);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  return sanitize(store.categories.find((c) => sanitize(c)?.id === catId)) || null;
}

async function getCategoryBySlug(slug, scope = null) {
  const catSlug = safeText(slug);
  if (!catSlug) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = `select=*&slug=eq.${encodeURIComponent(catSlug)}&limit=1`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : null);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  const projectCategories = store.categories.map(sanitize).filter(Boolean)
    .filter((c) => !projectId || c.projectId === projectId);
  return projectCategories.find((c) => c.slug === catSlug) || null;
}

async function createCategory(input, scope = null) {
  const now = new Date().toISOString();
  const projectId = safeText(scope?.projectId);
  const userId = safeText(scope?.userId);

  const cat = sanitize({
    id:          nextId('bcat'),
    projectId,
    ownerUserId: userId,
    name:        safeText(input.name),
    slug:        safeText(input.slug),
    description: safeText(input.description),
    color:       safeText(input.color),
    sortOrder:   Number(input.sortOrder ?? 0),
    createdAt:   now,
    updatedAt:   now,
  });

  if (await supportsSupabase()) {
    const row = { ...toRow(cat), created_at: now, updated_at: now };
    const result = await sbQuery({
      method: 'POST', table: t(), query: 'select=*',
      headers: { Prefer: 'return=representation' }, body: [row],
    });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : result.data);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  store.categories.unshift(cat);
  writeStore(store);
  return cat;
}

async function updateCategory(id, input, scope = null) {
  const catId = safeText(id);
  if (!catId) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let existQuery = `select=*&id=eq.${encodeURIComponent(catId)}&limit=1`;
    if (projectId) existQuery += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const existResult = await sbQuery({ table: t(), query: existQuery });
    if (existResult.ok) {
      const existing = sanitize(Array.isArray(existResult.data) ? existResult.data[0] : null);
      if (!existing) return null;
      const merged = sanitize({ ...existing, ...input, id: catId, projectId: existing.projectId, updatedAt: new Date().toISOString() });
      let patchQuery = `id=eq.${encodeURIComponent(catId)}&select=*`;
      if (projectId) patchQuery += `&project_id=eq.${encodeURIComponent(projectId)}`;
      const updated = await sbQuery({
        method: 'PATCH', table: t(), query: patchQuery,
        headers: { Prefer: 'return=representation' }, body: toRow(merged),
      });
      if (updated.ok) return sanitize(Array.isArray(updated.data) ? updated.data[0] : updated.data);
      if (!isMissingTable(updated.error)) return null;
    } else if (!isMissingTable(existResult.error)) {
      return null;
    }
  }

  const store = readStore();
  const idx = store.categories.findIndex((c) => sanitize(c)?.id === catId);
  if (idx < 0) return null;
  const existing = sanitize(store.categories[idx]);
  const next = sanitize({ ...existing, ...input, id: catId, projectId: existing.projectId, updatedAt: new Date().toISOString() });
  store.categories[idx] = next;
  writeStore(store);
  return next;
}

async function deleteCategory(id, scope = null) {
  const catId = safeText(id);
  if (!catId) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = `id=eq.${encodeURIComponent(catId)}&select=*`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({
      method: 'DELETE', table: t(), query,
      headers: { Prefer: 'return=representation' },
    });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : result.data);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  const idx = store.categories.findIndex((c) => sanitize(c)?.id === catId);
  if (idx < 0) return null;
  const [removed] = store.categories.splice(idx, 1);
  writeStore(store);
  return sanitize(removed);
}

module.exports = { listCategories, getCategory, getCategoryBySlug, createCategory, updateCategory, deleteCategory };
