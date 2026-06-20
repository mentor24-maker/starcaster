'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

const GAME_LEVEL_NAMES = ['Level', 'Grade', 'Class', 'Stage', 'Phase', 'Degree', 'Plane', 'Echelon', 'Tier'];

function table() {
  return tableConfig().gameLevelEvents;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeLevelName(value) {
  const levelName = safeText(value, 80);
  const aliases = {
    Rank: 'Level',
    Levels: 'Level',
    Grades: 'Grade',
    Classes: 'Class',
    Degrees: 'Degree',
    Echelons: 'Echelon',
    Tiers: 'Tier',
  };
  const normalized = aliases[levelName] || levelName;
  return GAME_LEVEL_NAMES.includes(normalized) ? normalized : 'Level';
}

function normalizeAudience(value) {
  const candidate = safeText(value, 40).toLowerCase();
  if (candidate === 'public' || candidate === 'portal' || candidate === 'both') return candidate;
  return 'both';
}

function safeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function rowToLevelEvent(row) {
  if (!row) return null;
  const module = row.builder_modules || row.builderModules || null;
  return {
    id: safeText(row.id, 120),
    eventName: safeText(row.event_name || row.eventName, 255),
    levelName: normalizeLevelName(row.level_name || row.levelName),
    sublevelName: safeText(row.sublevel_name || row.sublevelName, 160),
    moduleId: safeText(row.module_id || row.moduleId, 120),
    trigger: safeText(row.trigger, 40) || 'game',
    audience: normalizeAudience(row.audience),
    isActive: row.is_active !== false && row.isActive !== false,
    metadata: safeMetadata(row.metadata),
    moduleName: safeText(module?.name, 255),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function inputToRow(input) {
  return {
    event_name: safeText(input?.eventName || input?.event_name, 255),
    level_name: normalizeLevelName(input?.levelName || input?.level_name),
    sublevel_name: safeText(input?.sublevelName || input?.sublevel_name, 160),
    module_id: safeText(input?.moduleId || input?.module_id, 120) || null,
    trigger: 'game',
    audience: normalizeAudience(input?.audience),
    is_active: input?.isActive !== false && input?.is_active !== false,
    metadata: safeMetadata(input?.metadata),
  };
}

async function listLevelEvents(limit = 1000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const query = await scopedListQuery(
    table(),
    `select=*,builder_modules(name)&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToLevelEvent) : [],
  };
}

async function createLevelEvent(input, scope = null) {
  const eventName = safeText(input?.eventName || input?.event_name, 255);
  if (!eventName) return { ok: false, status: 400, error: 'eventName is required' };
  const row = await scopedInsertRow(table(), inputToRow(input), scope);
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*,builder_modules(name)',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToLevelEvent(created) };
}

async function updateLevelEvent(id, input, scope = null) {
  const eventId = safeText(id, 120);
  if (!eventId) return { ok: false, status: 400, error: 'id is required' };
  const row = await scopedPatchRow(table(), inputToRow(input), scope);
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(eventId)}&select=*,builder_modules(name)`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Level event not found' };
  return { ok: true, status: 200, data: rowToLevelEvent(updated) };
}

async function deleteLevelEvent(id, scope = null) {
  const eventId = safeText(id, 120);
  if (!eventId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(eventId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Level event not found' };
  return { ok: true, status: 200, data: rowToLevelEvent(removed) };
}

module.exports = {
  GAME_LEVEL_NAMES,
  listLevelEvents,
  createLevelEvent,
  updateLevelEvent,
  deleteLevelEvent,
  rowToLevelEvent,
};
