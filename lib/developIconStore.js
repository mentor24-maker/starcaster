'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, isConfigured: isSupabaseConfigured, tableConfig } = require('./supabase');
const { scopedInsertRow } = require('./projectScope');
const { attachScopeFields, normalizeScope } = require('./projectScopeFile');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const SUPPORT_CACHE = { value: null };

const STORE_FILE = path.join(__dirname, '..', 'data', 'develop_icons.json');

const TYPE_COLORS = {
  message: ['#0b82d4', '#e6f4ff', '#083f73'],
  asset: ['#f28c28', '#fff1e2', '#8a4c06'],
  campaign: ['#0f9d58', '#e7f8ef', '#0b5d35'],
  channel: ['#7c5cff', '#f0ebff', '#3b2788'],
  contact_segment: ['#d9465f', '#ffe7ec', '#7d1630'],
  custom: ['#4b5563', '#eef2f7', '#1f2937'],
};

function ensureFile() {
  ensureJsonFile(STORE_FILE, { icons: [] }, { mode: 0o600 });
}

function readStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { icons: [] };
    if (!Array.isArray(parsed.icons)) parsed.icons = [];
    return parsed;
  } catch {
    return { icons: [] };
  }
}

function writeStore(store) {
  ensureFile();
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function iconsTable() {
  return tableConfig().developIcons;
}

function isMissingTableError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

async function supportsSupabaseIcons() {
  if (!isSupabaseConfigured()) return false;
  if (SUPPORT_CACHE.value !== null) return SUPPORT_CACHE.value;
  const table = iconsTable();
  const probe = await sbQuery({ table, query: 'select=id&limit=1' });
  SUPPORT_CACHE.value = probe.ok || !isMissingTableError(probe.error);
  return SUPPORT_CACHE.value;
}

function recordToRow(record, scope) {
  const clean = sanitizeRecord(record);
  if (!clean) return null;
  const { projectId, userId } = normalizeScope(scope);
  return {
    id: clean.id,
    project_id: projectId || clean.projectId || null,
    owner_user_id: userId || null,
    workspace_id: clean.workspaceId,
    object_type: clean.objectType,
    object_name: clean.objectName,
    category: clean.category,
    summary: clean.summary,
    visual_style: clean.visualStyle,
    palette: clean.palette,
    size_label: clean.size,
    svg: clean.svg,
    data_url: clean.dataUrl,
    created_at: clean.createdAt || new Date().toISOString(),
  };
}

function rowToRecord(row) {
  if (!row || typeof row !== 'object') return null;
  const palette = row.palette && typeof row.palette === 'object' ? row.palette : {};
  return sanitizeRecord({
    id: row.id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    objectType: row.object_type,
    objectName: row.object_name,
    category: row.category,
    summary: row.summary,
    visualStyle: row.visual_style,
    palette,
    size: row.size_label,
    svg: row.svg,
    dataUrl: row.data_url,
    createdAt: row.created_at,
  });
}

function safeText(value) {
  return String(value || '').trim();
}

function parseSize(raw) {
  const text = safeText(raw).toLowerCase();
  const match = text.match(/^(\d{2,4})x(\d{2,4})$/);
  const width = Math.max(32, Math.min(256, Number(match?.[1] || 64)));
  const height = Math.max(32, Math.min(256, Number(match?.[2] || 64)));
  return { width, height, label: `${width}x${height}` };
}

function normalizePalette(raw, objectType) {
  const defaults = TYPE_COLORS[safeText(objectType)] || TYPE_COLORS.custom;
  const parts = safeText(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    primary: parts[0] || defaults[0],
    background: parts[1] || defaults[1],
    accent: parts[2] || defaults[2],
  };
}

function iconLetters(objectName, objectType) {
  const words = safeText(objectName)
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return safeText(objectType).slice(0, 2).toUpperCase() || 'IC';
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSvg({ letters, objectType, visualStyle, colors, width, height }) {
  const radius = Math.round(Math.min(width, height) * 0.22);
  const border = Math.max(2, Math.round(Math.min(width, height) * 0.06));
  const fontSize = Math.max(16, Math.round(Math.min(width, height) * 0.34));
  const lineY = Math.round(height * 0.18);
  const badgeR = Math.round(Math.min(width, height) * 0.18);
  const badgeCx = Math.round(width * 0.76);
  const badgeCy = Math.round(height * 0.26);
  const mark = esc(safeText(objectType).slice(0, 1).toUpperCase() || 'I');
  const safeLetters = esc(letters);

  if (visualStyle === 'outlined-bold') {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${safeLetters}">`,
      `<rect x="${border / 2}" y="${border / 2}" width="${width - border}" height="${height - border}" rx="${radius}" fill="#ffffff" stroke="${colors.primary}" stroke-width="${border}"/>`,
      `<rect x="${Math.round(width * 0.12)}" y="${lineY}" width="${Math.round(width * 0.56)}" height="${border + 2}" rx="${border}" fill="${colors.accent}"/>`,
      `<circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="${colors.primary}"/>`,
      `<text x="${badgeCx}" y="${badgeCy + Math.round(fontSize * 0.12)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(fontSize * 0.42)}" font-weight="700" fill="#ffffff">${mark}</text>`,
      `<text x="50%" y="${Math.round(height * 0.68)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${colors.primary}">${safeLetters}</text>`,
      `</svg>`,
    ].join('');
  }

  if (visualStyle === 'badge-minimal') {
    const circleR = Math.round(Math.min(width, height) * 0.42);
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${safeLetters}">`,
      `<rect width="${width}" height="${height}" rx="${radius}" fill="${colors.background}"/>`,
      `<circle cx="${Math.round(width / 2)}" cy="${Math.round(height / 2)}" r="${circleR}" fill="${colors.primary}"/>`,
      `<circle cx="${badgeCx}" cy="${badgeCy}" r="${Math.round(badgeR * 0.7)}" fill="${colors.background}" opacity="0.9"/>`,
      `<text x="50%" y="${Math.round(height * 0.58)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${safeLetters}</text>`,
      `</svg>`,
    ].join('');
  }

  if (visualStyle === 'editorial-mark') {
    const wedge = Math.round(width * 0.28);
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${safeLetters}">`,
      `<rect width="${width}" height="${height}" rx="${radius}" fill="${colors.background}"/>`,
      `<path d="M0 0 H${wedge} L${Math.round(width * 0.44)} ${height} H0 Z" fill="${colors.primary}"/>`,
      `<rect x="${Math.round(width * 0.44)}" y="${Math.round(height * 0.18)}" width="${Math.round(width * 0.12)}" height="${Math.round(height * 0.64)}" rx="${Math.max(4, Math.round(border * 0.8))}" fill="${colors.accent}"/>`,
      `<text x="${Math.round(width * 0.72)}" y="${Math.round(height * 0.58)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(fontSize * 0.92)}" font-weight="700" fill="${colors.accent}">${safeLetters}</text>`,
      `</svg>`,
    ].join('');
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${safeLetters}">`,
    `<rect width="${width}" height="${height}" rx="${radius}" fill="${colors.background}"/>`,
    `<rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.08)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.84)}" rx="${Math.round(radius * 0.8)}" fill="${colors.primary}"/>`,
    `<rect x="${Math.round(width * 0.12)}" y="${lineY}" width="${Math.round(width * 0.48)}" height="${border + 2}" rx="${border}" fill="#ffffff" opacity="0.85"/>`,
    `<circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="${colors.accent}" opacity="0.92"/>`,
    `<text x="${badgeCx}" y="${badgeCy + Math.round(fontSize * 0.12)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(fontSize * 0.42)}" font-weight="700" fill="#ffffff">${mark}</text>`,
    `<text x="50%" y="${Math.round(height * 0.68)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${safeLetters}</text>`,
    `</svg>`,
  ].join('');
}

function sanitizeRecord(input) {
  if (!input || typeof input !== 'object') return null;
  return {
    id: safeText(input.id),
    workspaceId: safeText(input.workspaceId),
    objectType: safeText(input.objectType),
    objectName: safeText(input.objectName),
    category: safeText(input.category),
    summary: safeText(input.summary),
    visualStyle: safeText(input.visualStyle),
    palette: input?.palette && typeof input.palette === 'object'
      ? {
          primary: safeText(input.palette.primary),
          background: safeText(input.palette.background),
          accent: safeText(input.palette.accent),
        }
      : normalizePalette('', safeText(input.objectType)),
    size: safeText(input.size),
    svg: safeText(input.svg),
    dataUrl: safeText(input.dataUrl),
    createdAt: safeText(input.createdAt),
  };
}

async function createIcon(input, scope = null) {
  const objectType = safeText(input.objectType) || 'custom';
  const objectName = safeText(input.objectName);
  const category = safeText(input.category);
  const summary = safeText(input.summary);
  const visualStyle = safeText(input.visualStyle) || 'clean-flat';
  const workspaceId = safeText(input.workspaceId) || 'alphire-main';
  const size = parseSize(input.size);
  const palette = normalizePalette(input.palette, objectType);
  const letters = iconLetters(objectName, objectType);
  const svg = buildSvg({
    letters,
    objectType,
    visualStyle,
    colors: palette,
    width: size.width,
    height: size.height,
  });
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  const record = sanitizeRecord({
    id: nextId('dicon'),
    workspaceId,
    objectType,
    objectName,
    category,
    summary,
    visualStyle,
    palette,
    size: size.label,
    svg,
    dataUrl,
    createdAt: new Date().toISOString(),
  });

  const { projectId } = normalizeScope(scope);

  if (projectId && (await supportsSupabaseIcons())) {
    const table = iconsTable();
    const row = await scopedInsertRow(table, recordToRow(record, scope), scope);
    const insert = await sbQuery({
      method: 'POST',
      table,
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [row],
    });
    if (insert.ok) {
      const saved = Array.isArray(insert.data) ? insert.data[0] : null;
      return rowToRecord(saved) || attachScopeFields(record, scope);
    }
    if (!isMissingTableError(insert.error)) {
      return attachScopeFields(record, scope);
    }
  }

  const fileRecord = attachScopeFields(record, scope);
  const store = readStore();
  store.icons.unshift(fileRecord);
  writeStore(store);
  return fileRecord;
}

module.exports = {
  createIcon,
};
