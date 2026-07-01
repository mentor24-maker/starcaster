'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

function table() {
  return tableConfig().builderThemes;
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

function nextThemeId() {
  return `dtheme_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseTypography(raw) {
  if (!raw) return null;
  try {
    const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!t || typeof t !== 'object') return null;
    return t;
  } catch (_) {
    return null;
  }
}

function parsePageBackground(raw) {
  if (!raw) return null;
  try {
    const background = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!background || typeof background !== 'object' || Array.isArray(background)) return null;
    const { finalizeBackgroundSettings } = require('./builder/template.js');
    return finalizeBackgroundSettings(background);
  } catch (_) {
    return null;
  }
}

function rowToTheme(row) {
  if (!row) return null;
  return {
    id: safeText(rowValue(row, 'id'), 120),
    name: safeText(rowValue(row, 'name', 'theme_name'), 255),
    primaryColor: safeText(rowValue(row, 'primary_color', 'themes_primary_color', 'primaryColor'), 20),
    secondaryColor: safeText(rowValue(row, 'secondary_color', 'secondaryColor'), 20),
    backgroundColor: safeText(rowValue(row, 'background_color', 'themes_background_color', 'backgroundColor'), 20),
    accentColor: safeText(rowValue(row, 'accent_color', 'themes_accent_color', 'accentColor'), 20),
    borderThickness: safeNumber(rowValue(row, 'border_thickness', 'borderThickness'), 1),
    borderRadius: safeNumber(rowValue(row, 'border_radius', 'borderRadius'), 12),
    containerBlur: safeNumber(rowValue(row, 'container_blur', 'containerBlur'), 0),
    contrastLevel: safeNumber(rowValue(row, 'contrast_level', 'contrastLevel'), 0),
    topMargin: safeNumber(rowValue(row, 'top_margin', 'topMargin'), 0),
    bottomMargin: safeNumber(rowValue(row, 'bottom_margin', 'bottomMargin'), 0),
    sideMargins: safeNumber(rowValue(row, 'side_margins', 'sideMargins'), 0),
    logoWideId: safeText(rowValue(row, 'logo_wide_id', 'logoWideId'), 120),
    logoSquareId: safeText(rowValue(row, 'logo_square_id', 'logoSquareId'), 120),
    featureImageId: safeText(rowValue(row, 'feature_image_id', 'featureImageId'), 120),
    backgroundImageId: safeText(rowValue(row, 'background_image_id', 'backgroundImageId'), 120),
    pageBackground: parsePageBackground(rowValue(row, 'page_background', 'pageBackground')),
    typography: parseTypography(rowValue(row, 'typography')),
    createdAt: rowValue(row, 'created_at', 'createdAt') || '',
    updatedAt: rowValue(row, 'updated_at', 'updatedAt') || '',
  };
}

function inputToRow(input) {
  const row = {
    id: safeText(input?.id, 120) || nextThemeId(),
    name: safeText(input?.name, 255),
    primary_color: safeText(input?.primaryColor, 20),
    secondary_color: safeText(input?.secondaryColor, 20),
    background_color: safeText(input?.backgroundColor, 20),
    accent_color: safeText(input?.accentColor, 20),
    border_thickness: safeNumber(input?.borderThickness, 1),
    border_radius: safeNumber(input?.borderRadius, 12),
    container_blur: safeNumber(input?.containerBlur, 0),
    contrast_level: safeNumber(input?.contrastLevel, 0),
    top_margin: safeNumber(input?.topMargin, 0),
    bottom_margin: safeNumber(input?.bottomMargin, 0),
    side_margins: safeNumber(input?.sideMargins, 0),
    logo_wide_id: safeText(input?.logoWideId, 120),
    logo_square_id: safeText(input?.logoSquareId, 120),
    feature_image_id: safeText(input?.featureImageId, 120),
    background_image_id: safeText(input?.backgroundImageId, 120),
  };
  if (input?.typography && typeof input.typography === 'object') {
    row.typography = input.typography;
  }
  if (input?.pageBackground && typeof input.pageBackground === 'object') {
    const { finalizeBackgroundSettings } = require('./builder/template.js');
    row.page_background = finalizeBackgroundSettings(input.pageBackground);
  }
  return row;
}

function isMissingSecondaryColorError(errorInput) {
  return String(errorInput || '').toLowerCase().includes('secondary_color');
}

function stripSecondaryColorColumn(rowInput) {
  const row = rowInput && typeof rowInput === 'object' ? { ...rowInput } : {};
  delete row.secondary_color;
  return row;
}

function isMissingThemeImageColumnError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return (
    text.includes('background_image_id')
    || text.includes('feature_image_id')
    || text.includes('logo_wide_id')
    || text.includes('logo_square_id')
  );
}

function stripThemeImageColumns(rowInput) {
  const row = rowInput && typeof rowInput === 'object' ? { ...rowInput } : {};
  delete row.logo_wide_id;
  delete row.logo_square_id;
  delete row.feature_image_id;
  delete row.background_image_id;
  return row;
}

function isMissingPageBackgroundColumnError(errorInput) {
  return String(errorInput || '').toLowerCase().includes('page_background');
}

function stripPageBackgroundColumn(rowInput) {
  const row = rowInput && typeof rowInput === 'object' ? { ...rowInput } : {};
  delete row.page_background;
  return row;
}

function isMissingTypographyColumnError(errorInput) {
  return String(errorInput || '').toLowerCase().includes('typography');
}

function stripTypographyColumn(rowInput) {
  const row = rowInput && typeof rowInput === 'object' ? { ...rowInput } : {};
  delete row.typography;
  return row;
}

function isMissingThemeMarginColumnError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return (
    text.includes('top_margin')
    || text.includes('bottom_margin')
    || text.includes('side_margins')
  );
}

function stripThemeMarginColumns(rowInput) {
  const row = rowInput && typeof rowInput === 'object' ? { ...rowInput } : {};
  delete row.top_margin;
  delete row.bottom_margin;
  delete row.side_margins;
  return row;
}

async function listThemes(limit = 1000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const query = await scopedListQuery(
    table(),
    `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
    scope
  );
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToTheme) : [],
  };
}

async function createTheme(input, scope = null) {
  const row = await scopedInsertRow(table(), inputToRow(input), scope);
  let res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok && isMissingSecondaryColorError(res.error)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripSecondaryColorColumn(row)],
    });
  }
  if (!res.ok && isMissingThemeImageColumnError(res.error)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripThemeImageColumns(stripSecondaryColorColumn(row))],
    });
  }
  if (!res.ok && isMissingTypographyColumnError(res.error)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripTypographyColumn(stripThemeImageColumns(stripSecondaryColorColumn(row)))],
    });
  }
  if (!res.ok && isMissingPageBackgroundColumnError(res.error)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripPageBackgroundColumn(stripTypographyColumn(stripThemeImageColumns(stripSecondaryColorColumn(row))))],
    });
  }
  if (!res.ok && isMissingThemeMarginColumnError(res.error)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripThemeMarginColumns(stripPageBackgroundColumn(stripTypographyColumn(stripThemeImageColumns(stripSecondaryColorColumn(row)))))],
    });
  }
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToTheme(created) };
}

async function updateTheme(id, input, scope = null) {
  const themeId = safeText(id, 120);
  if (!themeId) return { ok: false, status: 400, error: 'id is required' };
  const row = await scopedPatchRow(table(), inputToRow(input), scope);
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(themeId)}&select=*`, scope);
  let res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok && isMissingSecondaryColorError(res.error)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripSecondaryColorColumn(row),
    });
  }
  if (!res.ok && isMissingThemeImageColumnError(res.error)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripThemeImageColumns(stripSecondaryColorColumn(row)),
    });
  }
  if (!res.ok && isMissingTypographyColumnError(res.error)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripTypographyColumn(stripThemeImageColumns(stripSecondaryColorColumn(row))),
    });
  }
  if (!res.ok && isMissingPageBackgroundColumnError(res.error)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripPageBackgroundColumn(stripTypographyColumn(stripThemeImageColumns(stripSecondaryColorColumn(row)))),
    });
  }
  if (!res.ok && isMissingThemeMarginColumnError(res.error)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripThemeMarginColumns(stripPageBackgroundColumn(stripTypographyColumn(stripThemeImageColumns(stripSecondaryColorColumn(row))))),
    });
  }
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Theme not found' };
  return { ok: true, status: 200, data: rowToTheme(updated) };
}

async function deleteTheme(id, scope = null) {
  const themeId = safeText(id, 120);
  if (!themeId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(themeId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
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
