'use strict';

const fs = require('fs');
const path = require('path');
const { sbQuery, isConfigured: isSupabaseConfigured, tableConfig } = require('./supabase');
const {
  getYoutubeMinerPromptConfig,
  saveYoutubeMinerPromptConfig,
} = require('./profileStore');

const STORE_FILE = path.join(__dirname, '..', 'data', 'training.json');
const DEFAULT_USER_KEY = 'global';
const memoryStore = new Map();

function safeText(value) {
  return String(value || '').trim();
}

function userKey(userIdInput) {
  return safeText(userIdInput).toLowerCase() || DEFAULT_USER_KEY;
}

function normalizeKind(input) {
  const raw = safeText(input).toLowerCase();
  if (raw === 'category' || raw === 'categories') return 'category';
  if (raw === 'attribute' || raw === 'attributes') return 'attribute';
  if (raw === 'approach' || raw === 'approaches') return 'approach';
  return '';
}

function kindCollectionKey(kindInput) {
  const kind = normalizeKind(kindInput);
  if (kind === 'category') return 'categories';
  if (kind === 'attribute') return 'attributes';
  if (kind === 'approach') return 'approaches';
  return '';
}

function defaultTrainingStore() {
  return {
    categories: [],
    attributes: [],
    approaches: [],
    rulesGuides: [],
  };
}

function tableMissing(result) {
  const text = String(result?.error || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

function ensureFile() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ users: {} }, null, 2), { mode: 0o600 });
    fs.chmodSync(STORE_FILE, 0o600);
  }
}

function readFileStore() {
  try {
    ensureFile();
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { users: {} };
    if (!parsed.users || typeof parsed.users !== 'object') parsed.users = {};
    return parsed;
  } catch {
    return { users: {} };
  }
}

function writeFileStore(store) {
  try {
    ensureFile();
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, STORE_FILE);
    fs.chmodSync(STORE_FILE, 0o600);
    return true;
  } catch {
    return false;
  }
}

function makeFallbackId(kind, index) {
  return `${kind}_${Date.now().toString(36)}_${String(index || 0).padStart(2, '0')}`;
}

function normalizeTrainingItems(kindInput, itemsInput) {
  const kind = normalizeKind(kindInput);
  if (!kind) return [];
  const rows = Array.isArray(itemsInput) ? itemsInput : [];
  return rows.map((item, index) => {
    const rankNum = Number(item?.value_rank);
    const tags = Array.isArray(item?.match_hashtags)
      ? item.match_hashtags
      : String(item?.match_hashtags || '')
        .split(/\r?\n|,/g)
        .map((value) => safeText(value).toLowerCase())
        .filter(Boolean);
    return {
      id: safeText(item?.id || item?.item_id) || makeFallbackId(kind, index + 1),
      name: safeText(item?.name),
      rationale: safeText(item?.rationale),
      value_rank: Math.max(1, Math.min(Number.isFinite(rankNum) ? rankNum : 3, 5)),
      match_hashtags: Array.from(new Set(tags.map((value) => safeText(value).toLowerCase()).filter(Boolean))).slice(0, 20),
      sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index,
      updated_at: safeText(item?.updated_at),
    };
  }).filter((item) => Boolean(item.name));
}

function normalizeRuleGuideType(value) {
  const raw = safeText(value).toLowerCase();
  return raw === 'guide' ? 'guide' : 'rule';
}

function normalizeRulesGuides(itemsInput) {
  const rows = Array.isArray(itemsInput) ? itemsInput : [];
  return rows.map((item, index) => ({
    id: safeText(item?.id || item?.item_id) || makeFallbackId('ruleguide', index + 1),
    type: normalizeRuleGuideType(item?.type),
    text: safeText(item?.text || item?.name),
    enabled: item?.enabled !== false,
    sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index,
    updated_at: safeText(item?.updated_at),
  })).filter((item) => Boolean(item.text));
}

function getFallbackRows(kindInput, userIdInput) {
  const key = userKey(userIdInput);
  const collectionKey = kindCollectionKey(kindInput);
  if (!collectionKey) return [];
  const mem = memoryStore.get(key);
  if (mem && Array.isArray(mem[collectionKey])) return normalizeTrainingItems(kindInput, mem[collectionKey]);
  const store = readFileStore();
  const rows = store?.users?.[key]?.[collectionKey];
  const normalized = normalizeTrainingItems(kindInput, rows);
  const next = mem && typeof mem === 'object' ? { ...mem } : defaultTrainingStore();
  next[collectionKey] = normalized;
  memoryStore.set(key, next);
  return normalized;
}

function saveFallbackRows(kindInput, itemsInput, userIdInput) {
  const key = userKey(userIdInput);
  const collectionKey = kindCollectionKey(kindInput);
  const normalized = normalizeTrainingItems(kindInput, itemsInput);
  if (!collectionKey) return normalized;
  const store = readFileStore();
  store.users = store.users && typeof store.users === 'object' ? store.users : {};
  store.users[key] = store.users[key] && typeof store.users[key] === 'object'
    ? store.users[key]
    : defaultTrainingStore();
  store.users[key][collectionKey] = normalized;
  writeFileStore(store);
  memoryStore.set(key, {
    ...(memoryStore.get(key) || defaultTrainingStore()),
    [collectionKey]: normalized,
  });
  return normalized;
}

function getFallbackRulesGuides(userIdInput) {
  const key = userKey(userIdInput);
  const mem = memoryStore.get(key);
  if (mem && Array.isArray(mem.rulesGuides)) return normalizeRulesGuides(mem.rulesGuides);
  const store = readFileStore();
  const rows = store?.users?.[key]?.rulesGuides;
  const normalized = normalizeRulesGuides(rows);
  const next = mem && typeof mem === 'object' ? { ...mem } : defaultTrainingStore();
  next.rulesGuides = normalized;
  memoryStore.set(key, next);
  return normalized;
}

function saveFallbackRulesGuides(itemsInput, userIdInput) {
  const key = userKey(userIdInput);
  const normalized = normalizeRulesGuides(itemsInput);
  const store = readFileStore();
  store.users = store.users && typeof store.users === 'object' ? store.users : {};
  store.users[key] = store.users[key] && typeof store.users[key] === 'object'
    ? store.users[key]
    : defaultTrainingStore();
  store.users[key].rulesGuides = normalized;
  writeFileStore(store);
  memoryStore.set(key, {
    ...(memoryStore.get(key) || defaultTrainingStore()),
    rulesGuides: normalized,
  });
  return normalized;
}

function taxonomyTable() {
  return tableConfig().trainingTaxonomy;
}

function rulesGuidesTable() {
  return tableConfig().trainingRulesGuides;
}

function composeGuidelinesText(baseGuidelinesInput, rulesGuidesInput) {
  const base = safeText(baseGuidelinesInput);
  const rules = normalizeRulesGuides(rulesGuidesInput)
    .filter((item) => item.enabled)
    .map((item) => `${item.type === 'guide' ? 'Guide' : 'Rule'}: ${item.text}`);
  return [base, rules.join('\n')].filter(Boolean).join(base && rules.length ? '\n' : '');
}

async function getTrainingPromptConfig(userIdInput) {
  const base = await getYoutubeMinerPromptConfig(userIdInput);
  const rulesGuidesRes = await listTrainingRulesGuides(userIdInput);
  const rulesGuides = rulesGuidesRes.ok ? rulesGuidesRes.data : [];
  return {
    context: safeText(base?.context),
    guidelines: composeGuidelinesText(base?.guidelines, rulesGuides),
  };
}

async function saveTrainingPromptConfig(contextValue, guidelinesValue, userIdInput) {
  return saveYoutubeMinerPromptConfig(contextValue, guidelinesValue, userIdInput);
}

async function listTrainingItems(kindInput, userIdInput) {
  const kind = normalizeKind(kindInput);
  if (!kind) return { ok: false, status: 400, error: 'Invalid training kind.' };
  const key = userKey(userIdInput);
  if (isSupabaseConfigured()) {
    const result = await sbQuery({
      table: taxonomyTable(),
      query: `select=user_id,kind,item_id,name,rationale,value_rank,match_hashtags,sort_order,updated_at&user_id=eq.${encodeURIComponent(key)}&kind=eq.${encodeURIComponent(kind)}&order=sort_order.asc,name.asc`,
    });
    if (result.ok) {
      return {
        ok: true,
        status: 200,
        data: normalizeTrainingItems(kind, (Array.isArray(result.data) ? result.data : []).map((row) => ({
          id: row?.item_id,
          name: row?.name,
          rationale: row?.rationale,
          value_rank: row?.value_rank,
          match_hashtags: row?.match_hashtags,
          sort_order: row?.sort_order,
          updated_at: row?.updated_at,
        }))),
      };
    }
    if (!tableMissing(result)) {
      return { ok: false, status: result.status || 500, error: String(result.error || 'Could not load shared training items.') };
    }
  }
  return { ok: true, status: 200, data: getFallbackRows(kind, key) };
}

async function saveTrainingItems(kindInput, itemsInput, userIdInput) {
  const kind = normalizeKind(kindInput);
  if (!kind) return { ok: false, status: 400, error: 'Invalid training kind.' };
  const key = userKey(userIdInput);
  const normalized = normalizeTrainingItems(kind, itemsInput).map((item, index) => ({
    ...item,
    sort_order: index,
  }));

  if (isSupabaseConfigured()) {
    const deleteResult = await sbQuery({
      method: 'DELETE',
      table: taxonomyTable(),
      query: `user_id=eq.${encodeURIComponent(key)}&kind=eq.${encodeURIComponent(kind)}`,
      headers: { Prefer: 'return=minimal' },
    });
    if (!deleteResult.ok && !tableMissing(deleteResult)) {
      return { ok: false, status: deleteResult.status || 500, error: String(deleteResult.error || 'Could not reset shared training items.') };
    }
    if (tableMissing(deleteResult)) {
      return {
        ok: false,
        status: 409,
        error: `Supabase table "${taxonomyTable()}" is missing. Run docs/supabase_training_taxonomy.sql first.`,
      };
    }
    if (normalized.length) {
      const now = new Date().toISOString();
      const insertResult = await sbQuery({
        method: 'POST',
        table: taxonomyTable(),
        query: 'select=user_id,kind,item_id,name,rationale,value_rank,match_hashtags,sort_order,updated_at',
        headers: { Prefer: 'return=representation' },
        body: normalized.map((item, index) => ({
          user_id: key,
          kind,
          item_id: item.id,
          name: item.name,
          rationale: item.rationale,
          value_rank: item.value_rank,
          match_hashtags: item.match_hashtags,
          sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index,
          updated_at: now,
        })),
      });
      if (!insertResult.ok) {
        return { ok: false, status: insertResult.status || 500, error: String(insertResult.error || 'Could not save shared training items.') };
      }
      return {
        ok: true,
        status: 200,
        data: normalizeTrainingItems(kind, Array.isArray(insertResult.data) ? insertResult.data.map((row) => ({
          id: row?.item_id,
          name: row?.name,
          rationale: row?.rationale,
          value_rank: row?.value_rank,
          match_hashtags: row?.match_hashtags,
          sort_order: row?.sort_order,
          updated_at: row?.updated_at,
        })) : normalized),
      };
    }
    return { ok: true, status: 200, data: [] };
  }

  return { ok: true, status: 200, data: saveFallbackRows(kind, normalized, key) };
}

async function listTrainingRulesGuides(userIdInput) {
  const key = userKey(userIdInput);
  if (isSupabaseConfigured()) {
    const result = await sbQuery({
      table: rulesGuidesTable(),
      query: `select=user_id,item_id,type,text,enabled,sort_order,updated_at&user_id=eq.${encodeURIComponent(key)}&order=sort_order.asc,text.asc`,
    });
    if (result.ok) {
      return {
        ok: true,
        status: 200,
        data: normalizeRulesGuides((Array.isArray(result.data) ? result.data : []).map((row) => ({
          id: row?.item_id,
          type: row?.type,
          text: row?.text,
          enabled: row?.enabled,
          sort_order: row?.sort_order,
          updated_at: row?.updated_at,
        }))),
      };
    }
    if (!tableMissing(result)) {
      return { ok: false, status: result.status || 500, error: String(result.error || 'Could not load shared rules/guides.') };
    }
  }
  return { ok: true, status: 200, data: getFallbackRulesGuides(key) };
}

async function saveTrainingRulesGuides(itemsInput, userIdInput) {
  const key = userKey(userIdInput);
  const normalized = normalizeRulesGuides(itemsInput).map((item, index) => ({
    ...item,
    sort_order: index,
  }));

  if (isSupabaseConfigured()) {
    const deleteResult = await sbQuery({
      method: 'DELETE',
      table: rulesGuidesTable(),
      query: `user_id=eq.${encodeURIComponent(key)}`,
      headers: { Prefer: 'return=minimal' },
    });
    if (!deleteResult.ok && !tableMissing(deleteResult)) {
      return { ok: false, status: deleteResult.status || 500, error: String(deleteResult.error || 'Could not reset shared rules/guides.') };
    }
    if (tableMissing(deleteResult)) {
      return {
        ok: false,
        status: 409,
        error: `Supabase table "${rulesGuidesTable()}" is missing. Run docs/supabase_training_rules_guides.sql first.`,
      };
    }
    if (normalized.length) {
      const now = new Date().toISOString();
      const insertResult = await sbQuery({
        method: 'POST',
        table: rulesGuidesTable(),
        query: 'select=user_id,item_id,type,text,enabled,sort_order,updated_at',
        headers: { Prefer: 'return=representation' },
        body: normalized.map((item, index) => ({
          user_id: key,
          item_id: item.id,
          type: item.type,
          text: item.text,
          enabled: item.enabled,
          sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index,
          updated_at: now,
        })),
      });
      if (!insertResult.ok) {
        return { ok: false, status: insertResult.status || 500, error: String(insertResult.error || 'Could not save shared rules/guides.') };
      }
      return {
        ok: true,
        status: 200,
        data: normalizeRulesGuides((Array.isArray(insertResult.data) ? insertResult.data : []).map((row) => ({
          id: row?.item_id,
          type: row?.type,
          text: row?.text,
          enabled: row?.enabled,
          sort_order: row?.sort_order,
          updated_at: row?.updated_at,
        }))),
      };
    }
    return { ok: true, status: 200, data: [] };
  }

  return { ok: true, status: 200, data: saveFallbackRulesGuides(normalized, key) };
}

module.exports = {
  normalizeKind,
  getTrainingPromptConfig,
  saveTrainingPromptConfig,
  listTrainingItems,
  saveTrainingItems,
  listTrainingRulesGuides,
  saveTrainingRulesGuides,
};
