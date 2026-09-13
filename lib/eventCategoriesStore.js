'use strict';

/**
 * Event categories — the venues and program types a calendar colours its
 * events by (Delray: "Delray Beach Tennis Center" navy, "Delray Swim & Tennis
 * Club" green, "Pickleball" orange). Scoped to a project.
 *
 * Same shape as lib/eventsStore.js: Supabase when the table exists, a local
 * JSON file otherwise — and the file is for the table being ABSENT, never for
 * the database refusing a write (landmine 15).
 *
 * An event names its category by id in `events.category_id`, deliberately not
 * a foreign key: deleting a category must leave its events standing, and every
 * reader treats an id it cannot find as "no category".
 */

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'event_categories.json');
const SUPPORT_CACHE = new Map();
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_NAME = 80;

function t() { return tableConfig().eventCategories; }

function ensureFile() { ensureJsonFile(STORE_FILE, { categories: [] }, { mode: 0o600 }); }

function readStore() {
  try {
    ensureFile();
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
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

/** A `#rrggbb` colour, or '' — anything else would reach a style attribute. */
function safeColor(v) {
  const text = safeText(v);
  return HEX_COLOR.test(text) ? text.toLowerCase() : '';
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  const order = Number(input.sortOrder ?? input.sort_order ?? 0);
  return {
    id:          String(input.id || ''),
    projectId:   safeText(input.projectId || input.project_id),
    ownerUserId: safeText(input.ownerUserId || input.owner_user_id),
    name:        String(input.name || '').trim().slice(0, MAX_NAME),
    color:       safeColor(input.color),
    sortOrder:   Number.isFinite(order) ? Math.trunc(order) : 0,
    createdAt:   String(input.createdAt || input.created_at || ''),
    updatedAt:   String(input.updatedAt || input.updated_at || ''),
  };
}

/** What a visitor's calendar needs, and nothing about who made it. */
function toPublic(c) {
  return c ? { id: c.id, name: c.name, color: c.color, sortOrder: c.sortOrder } : null;
}

function toRow(c) {
  return {
    id: c.id,
    project_id: c.projectId,
    owner_user_id: c.ownerUserId || null,
    name: c.name,
    color: c.color,
    sort_order: c.sortOrder,
  };
}

function isMissingTable(err) {
  const text = String(err || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
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

function byOrder(a, b) { return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name); }

function scoped(list, projectId) {
  return list.map(sanitize).filter(Boolean).filter((c) => !projectId || c.projectId === projectId);
}

async function listEventCategories(scope = null) {
  const projectId = safeText(scope?.projectId);
  if (await supportsSupabase()) {
    let query = 'select=*&order=sort_order.asc,name.asc&limit=200';
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) return (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
    if (!isMissingTable(result.error)) return [];
  }
  return scoped(readStore().categories, projectId).sort(byOrder);
}

async function createEventCategory(input, scope = null) {
  const now = new Date().toISOString();
  const category = sanitize({
    id: nextId('ecat'),
    projectId: safeText(scope?.projectId),
    ownerUserId: safeText(scope?.userId),
    name: input.name,
    color: input.color,
    sortOrder: input.sortOrder,
    createdAt: now,
    updatedAt: now,
  });

  if (await supportsSupabase()) {
    const result = await sbQuery({
      method: 'POST', table: t(), query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [{ ...toRow(category), created_at: now, updated_at: now }],
    });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : result.data);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  store.categories.push(category);
  writeStore(store);
  return category;
}

async function updateEventCategory(id, input, scope = null) {
  const categoryId = safeText(id);
  if (!categoryId) return null;
  const projectId = safeText(scope?.projectId);
  const patch = {};
  for (const key of ['name', 'color', 'sortOrder']) if (input[key] !== undefined) patch[key] = input[key];

  if (await supportsSupabase()) {
    let where = `id=eq.${encodeURIComponent(categoryId)}`;
    if (projectId) where += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const existing = await sbQuery({ table: t(), query: `select=*&${where}&limit=1` });
    if (existing.ok) {
      const current = sanitize(Array.isArray(existing.data) ? existing.data[0] : null);
      if (!current) return null;
      const merged = sanitize({ ...current, ...patch, id: categoryId, projectId: current.projectId });
      const updated = await sbQuery({
        method: 'PATCH', table: t(), query: `${where}&select=*`,
        headers: { Prefer: 'return=representation' },
        body: { name: merged.name, color: merged.color, sort_order: merged.sortOrder },
      });
      if (updated.ok) return sanitize(Array.isArray(updated.data) ? updated.data[0] : updated.data);
      if (!isMissingTable(updated.error)) return null;
    } else if (!isMissingTable(existing.error)) {
      return null;
    }
  }

  const store = readStore();
  const idx = store.categories.findIndex((c) => {
    const row = sanitize(c);
    return row && row.id === categoryId && (!projectId || row.projectId === projectId);
  });
  if (idx < 0) return null;
  const current = sanitize(store.categories[idx]);
  const next = sanitize({ ...current, ...patch, id: categoryId, projectId: current.projectId, updatedAt: new Date().toISOString() });
  store.categories[idx] = next;
  writeStore(store);
  return next;
}

async function deleteEventCategory(id, scope = null) {
  const categoryId = safeText(id);
  if (!categoryId) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let where = `id=eq.${encodeURIComponent(categoryId)}`;
    if (projectId) where += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({
      method: 'DELETE', table: t(), query: `${where}&select=*`,
      headers: { Prefer: 'return=representation' },
    });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : result.data);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  const idx = store.categories.findIndex((c) => {
    const row = sanitize(c);
    return row && row.id === categoryId && (!projectId || row.projectId === projectId);
  });
  if (idx < 0) return null;
  const [removed] = store.categories.splice(idx, 1);
  writeStore(store);
  return sanitize(removed);
}

module.exports = {
  listEventCategories,
  createEventCategory,
  updateEventCategory,
  deleteEventCategory,
  toPublic,
  safeColor,
};
