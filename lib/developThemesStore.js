'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().developThemes;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function rowValue(row, ...keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null) return row[key];
  }
  return '';
}

function rowToTheme(row) {
  if (!row) return null;
  return {
    id: Number(rowValue(row, 'id')) || 0,
    name: safeText(rowValue(row, 'name', 'theme_name'), 255),
    primaryColor: safeText(rowValue(row, 'primary_color', 'themes_primary_color', 'primaryColor'), 20),
    backgroundColor: safeText(rowValue(row, 'background_color', 'themes_background_color', 'backgroundColor'), 20),
    accentColor: safeText(rowValue(row, 'accent_color', 'themes_accent_color', 'accentColor'), 20),
    borderThickness: safeNumber(rowValue(row, 'border_thickness', 'borderThickness'), 1),
    borderRadius: safeNumber(rowValue(row, 'border_radius', 'borderRadius'), 12),
    containerBlur: safeNumber(rowValue(row, 'container_blur', 'containerBlur'), 0),
    contrastLevel: safeNumber(rowValue(row, 'contrast_level', 'contrastLevel'), 0),
    logoWideId: safeText(rowValue(row, 'logo_wide_id', 'logoWideId'), 120),
    logoSquareId: safeText(rowValue(row, 'logo_square_id', 'logoSquareId'), 120),
    featureImageId: safeText(rowValue(row, 'feature_image_id', 'featureImageId'), 120),
    backgroundImageId: safeText(rowValue(row, 'background_image_id', 'backgroundImageId'), 120),
    createdAt: rowValue(row, 'created_at', 'createdAt') || '',
    updatedAt: rowValue(row, 'updated_at', 'updatedAt') || '',
  };
}

function inputToRow(input) {
  return {
    name: safeText(input?.name, 255),
    primary_color: safeText(input?.primaryColor, 20),
    background_color: safeText(input?.backgroundColor, 20),
    accent_color: safeText(input?.accentColor, 20),
    border_thickness: safeNumber(input?.borderThickness, 1),
    border_radius: safeNumber(input?.borderRadius, 12),
    container_blur: safeNumber(input?.containerBlur, 0),
    contrast_level: safeNumber(input?.contrastLevel, 0),
    logo_wide_id: safeText(input?.logoWideId, 120),
    logo_square_id: safeText(input?.logoSquareId, 120),
    feature_image_id: safeText(input?.featureImageId, 120),
    background_image_id: safeText(input?.backgroundImageId, 120),
  };
}

async function listThemes(limit = 1000) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToTheme) : [],
  };
}

async function createTheme(input) {
  const row = inputToRow(input);
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToTheme(created) };
}

async function updateTheme(id, input) {
  const themeId = Number(id || 0) || 0;
  if (!themeId) return { ok: false, status: 400, error: 'id is required' };
  const row = inputToRow(input);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${themeId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Theme not found' };
  return { ok: true, status: 200, data: rowToTheme(updated) };
}

async function deleteTheme(id) {
  const themeId = Number(id || 0) || 0;
  if (!themeId) return { ok: false, status: 400, error: 'id is required' };
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${themeId}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Theme not found' };
  return { ok: true, status: 200, data: rowToTheme(removed) };
}

module.exports = {
  listThemes,
  createTheme,
  updateTheme,
  deleteTheme,
  rowToTheme,
};
