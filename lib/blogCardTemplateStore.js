'use strict';

const fs = require('fs');
const path = require('path');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'blog_card_template.json');
const SUPPORT_CACHE = new Map();

function t() { return tableConfig().blogCardTemplate; }

function ensureFile() {
  ensureJsonFile(STORE_FILE, { templates: {} }, { mode: 0o600 });
}

function readStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { templates: {} };
    if (!parsed.templates || typeof parsed.templates !== 'object') parsed.templates = {};
    return parsed;
  } catch {
    return { templates: {} };
  }
}

function writeStore(store) {
  ensureFile();
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function isMissingTable(err) {
  const s = String(err || '').toLowerCase();
  return s.includes('does not exist') || s.includes('relation') || s.includes('schema cache');
}

async function supportsSupabase() {
  if (!isSupabaseConfigured()) return false;
  const table = t();
  if (!table) return false;
  if (SUPPORT_CACHE.has(table)) return SUPPORT_CACHE.get(table);
  const probe = await sbQuery({ table, query: 'select=project_id&limit=1' });
  const ok = probe.ok || !isMissingTable(probe.error);
  SUPPORT_CACHE.set(table, ok);
  return ok;
}

const DEFAULT_TEMPLATE = {
  cardLayout: 'single',
  imageAspectRatio: '16:9',
  cardStyle: 'default',
  cardBorderRadius: 12,
  readMoreLabel: 'Read More',
  accentColor: '#0f4f8f',
  elements: [
    { id: 'categories',     enabled: true },
    { id: 'headline',       enabled: true },
    { id: 'featured_image', enabled: true },
    { id: 'excerpt',        enabled: true },
    { id: 'author',         enabled: true },
    { id: 'date',           enabled: true },
    { id: 'tags',           enabled: false },
    { id: 'read_more',      enabled: true },
  ],
};

function mergeTemplate(saved) {
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_TEMPLATE };
  const elements = Array.isArray(saved.elements) && saved.elements.length
    ? saved.elements
    : DEFAULT_TEMPLATE.elements;
  return {
    cardLayout:        String(saved.cardLayout        || DEFAULT_TEMPLATE.cardLayout),
    imageAspectRatio:  String(saved.imageAspectRatio  || DEFAULT_TEMPLATE.imageAspectRatio),
    cardStyle:         String(saved.cardStyle          || DEFAULT_TEMPLATE.cardStyle),
    cardBorderRadius:  Number(saved.cardBorderRadius   ?? DEFAULT_TEMPLATE.cardBorderRadius),
    readMoreLabel:     String(saved.readMoreLabel      || DEFAULT_TEMPLATE.readMoreLabel),
    accentColor:       String(saved.accentColor        || DEFAULT_TEMPLATE.accentColor),
    elements,
  };
}

async function getCardTemplate(scope = null) {
  const projectId = String(scope?.projectId || '').trim();

  if (await supportsSupabase()) {
    let query = 'select=template&limit=1';
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      const row = Array.isArray(result.data) ? result.data[0] : null;
      return mergeTemplate(row?.template);
    }
    if (!isMissingTable(result.error)) return mergeTemplate(null);
  }

  const store = readStore();
  return mergeTemplate(store.templates[projectId || '_default']);
}

async function saveCardTemplate(template, scope = null) {
  const projectId = String(scope?.projectId || '').trim();
  const safe = mergeTemplate(template);

  if (await supportsSupabase()) {
    const row = {
      project_id: projectId || '_default',
      template: safe,
      updated_at: new Date().toISOString(),
    };
    const result = await sbQuery({
      method: 'POST',
      table: t(),
      query: 'on_conflict=project_id',
      body: row,
    });
    if (result.ok || result.status === 200 || result.status === 201) return safe;
  }

  const store = readStore();
  store.templates[projectId || '_default'] = safe;
  writeStore(store);
  return safe;
}

module.exports = { getCardTemplate, saveCardTemplate, DEFAULT_TEMPLATE };
