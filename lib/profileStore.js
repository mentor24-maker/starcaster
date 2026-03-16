'use strict';

const fs = require('fs');
const path = require('path');
const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');

const STORE_FILE = path.join(__dirname, '..', 'data', 'profile.json');
const PROFILE_TABLE = String(process.env.SUPABASE_PROFILES_TABLE || 'app_profiles').trim();
const DEFAULT_PROFILE_KEY = 'global';
const memoryProfiles = new Map();

function safeText(value) {
  return String(value || '').trim();
}

function profileKey(userIdInput) {
  return safeText(userIdInput).toLowerCase() || DEFAULT_PROFILE_KEY;
}

function parseYoutubePromptConfig(rawInput) {
  const raw = safeText(rawInput);
  if (!raw) return { context: '', guidelines: '' };
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      return {
        context: safeText(parsed?.context || parsed?.youtube_response_context),
        guidelines: safeText(parsed?.guidelines || parsed?.youtube_response_guidelines),
      };
    } catch {
      // Fall through to legacy plain-text handling.
    }
  }
  return { context: raw, guidelines: '' };
}

function serializeYoutubePromptConfig(contextInput, guidelinesInput) {
  const context = safeText(contextInput);
  const guidelines = safeText(guidelinesInput);
  return JSON.stringify({ context, guidelines });
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return defaultProfile();
  const promptCfg = parseYoutubePromptConfig(input.youtubeResponseContext ?? input.youtube_response_context);
  return {
    contactName: safeText(input.contactName ?? input.contact_name),
    email: safeText(input.email),
    phone: safeText(input.phone),
    website: safeText(input.website),
    logoDataUrl: safeText(input.logoDataUrl ?? input.logo_data_url),
    youtubeResponseContext: safeText(promptCfg.context || input.youtubeResponseContext || input.youtube_response_context),
    youtubeResponseGuidelines: safeText(promptCfg.guidelines),
    updatedAt: safeText(input.updatedAt ?? input.updated_at),
  };
}

function defaultProfile() {
  return {
    contactName: '',
    email: '',
    phone: '',
    website: '',
    logoDataUrl: '',
    youtubeResponseContext: '',
    youtubeResponseGuidelines: '',
    updatedAt: '',
  };
}

function tableMissing(result) {
  const text = String(result?.error || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

function columnMissing(result) {
  const text = String(result?.error || '').toLowerCase();
  return text.includes('column') && text.includes('does not exist');
}

function ensureFile() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ profiles: {} }, null, 2), { mode: 0o600 });
    fs.chmodSync(STORE_FILE, 0o600);
  }
}

function readFileStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { profiles: {} };
    if (!parsed.profiles || typeof parsed.profiles !== 'object') {
      const legacyProfile = sanitize(parsed.profile || {});
      parsed.profiles = { [DEFAULT_PROFILE_KEY]: legacyProfile };
    }
    return parsed;
  } catch {
    return { profiles: {} };
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

function getProfileFromFallbackStore(userIdInput) {
  const key = profileKey(userIdInput);
  const mem = memoryProfiles.get(key);
  if (mem) return sanitize(mem);
  const store = readFileStore();
  const profile = sanitize(store?.profiles?.[key] || store?.profiles?.[DEFAULT_PROFILE_KEY] || {});
  memoryProfiles.set(key, profile);
  return profile;
}

function saveProfileToFallbackStore(input, userIdInput) {
  const key = profileKey(userIdInput);
  const profile = sanitize({
    ...input,
    updatedAt: new Date().toISOString(),
  });
  memoryProfiles.set(key, profile);
  const store = readFileStore();
  store.profiles = store.profiles && typeof store.profiles === 'object' ? store.profiles : {};
  store.profiles[key] = profile;
  writeFileStore(store);
  return profile;
}

async function getProfile(userIdInput) {
  const key = profileKey(userIdInput);
  if (isSupabaseConfigured()) {
    const result = await sbQuery({
      table: PROFILE_TABLE,
      query: `select=user_id,contact_name,email,phone,website,logo_data_url,updated_at&user_id=eq.${encodeURIComponent(key)}&limit=1`,
    });
    if (result.ok) {
      const row = Array.isArray(result.data) ? result.data[0] : null;
      const profile = sanitize(row || {});
      memoryProfiles.set(key, profile);
      return profile;
    }
    if (!tableMissing(result)) return getProfileFromFallbackStore(key);
  }
  return getProfileFromFallbackStore(key);
}

async function saveProfile(input, userIdInput) {
  const key = profileKey(userIdInput);
  const profile = sanitize({
    ...input,
    updatedAt: new Date().toISOString(),
  });

  if (isSupabaseConfigured()) {
    const row = {
      user_id: key,
      contact_name: profile.contactName,
      email: profile.email,
      phone: profile.phone,
      website: profile.website,
      logo_data_url: profile.logoDataUrl,
      updated_at: profile.updatedAt,
    };
    const result = await sbQuery({
      method: 'POST',
      table: PROFILE_TABLE,
      query: 'on_conflict=user_id&select=*',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [row],
    });
    if (result.ok) {
      const saved = sanitize(Array.isArray(result.data) ? result.data[0] : row);
      memoryProfiles.set(key, saved);
      return saved;
    }
    if (!tableMissing(result)) {
      // If Supabase fails for non-schema reasons, still avoid hard failure in serverless.
      return saveProfileToFallbackStore(profile, key);
    }
  }

  return saveProfileToFallbackStore(profile, key);
}

async function getYoutubeMinerResponseContext(userIdInput) {
  const key = profileKey(userIdInput);
  if (isSupabaseConfigured()) {
    const result = await sbQuery({
      table: PROFILE_TABLE,
      query: `select=user_id,youtube_response_context&user_id=eq.${encodeURIComponent(key)}&limit=1`,
    });
    if (result.ok) {
      const row = Array.isArray(result.data) ? result.data[0] : null;
      const parsed = parseYoutubePromptConfig(row?.youtube_response_context || '');
      return safeText(parsed.context || '');
    }
    if (!tableMissing(result) && !columnMissing(result)) return '';
  }
  return safeText(getProfileFromFallbackStore(key)?.youtubeResponseContext || '');
}

async function getYoutubeMinerPromptConfig(userIdInput) {
  const key = profileKey(userIdInput);
  if (isSupabaseConfigured()) {
    const result = await sbQuery({
      table: PROFILE_TABLE,
      query: `select=user_id,youtube_response_context&user_id=eq.${encodeURIComponent(key)}&limit=1`,
    });
    if (result.ok) {
      const row = Array.isArray(result.data) ? result.data[0] : null;
      const parsed = parseYoutubePromptConfig(row?.youtube_response_context || '');
      return {
        context: safeText(parsed.context),
        guidelines: safeText(parsed.guidelines),
      };
    }
    if (!tableMissing(result) && !columnMissing(result)) return { context: '', guidelines: '' };
  }
  const profile = getProfileFromFallbackStore(key);
  return {
    context: safeText(profile?.youtubeResponseContext || ''),
    guidelines: safeText(profile?.youtubeResponseGuidelines || ''),
  };
}

async function saveYoutubeMinerResponseContext(value, userIdInput) {
  return saveYoutubeMinerPromptConfig(value, '', userIdInput);
}

async function saveYoutubeMinerPromptConfig(contextValue, guidelinesValue, userIdInput) {
  const key = profileKey(userIdInput);
  const context = safeText(contextValue).slice(0, 20000);
  const guidelines = safeText(guidelinesValue).slice(0, 20000);
  const payload = serializeYoutubePromptConfig(context, guidelines);
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const result = await sbQuery({
      method: 'POST',
      table: PROFILE_TABLE,
      query: 'on_conflict=user_id&select=user_id,youtube_response_context,updated_at',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [{ user_id: key, youtube_response_context: payload, updated_at: now }],
    });
    if (result.ok) {
      const row = Array.isArray(result.data) ? result.data[0] : null;
      return {
        ok: true,
        status: 200,
        data: {
          youtubeResponseContext: context,
          youtubeResponseGuidelines: guidelines,
          updatedAt: safeText(row?.updated_at || now),
        },
      };
    }
    if (columnMissing(result)) {
      return {
        ok: false,
        status: 409,
        error: 'Database column app_profiles.youtube_response_context is missing. Run docs/app_profiles_youtube_context_migration.sql, then retry.',
      };
    }
    if (!tableMissing(result)) {
      return { ok: false, status: result.status || 500, error: String(result.error || 'Could not save YouTube response context') };
    }
  }

  const existing = getProfileFromFallbackStore(key);
  const saved = saveProfileToFallbackStore({
    ...existing,
    youtubeResponseContext: context,
    youtubeResponseGuidelines: guidelines,
  }, key);
  return {
    ok: true,
    status: 200,
    data: {
      youtubeResponseContext: safeText(saved?.youtubeResponseContext || context),
      youtubeResponseGuidelines: safeText(saved?.youtubeResponseGuidelines || guidelines),
      updatedAt: safeText(saved?.updatedAt || now),
    },
  };
}

module.exports = {
  getProfile,
  saveProfile,
  getYoutubeMinerResponseContext,
  saveYoutubeMinerResponseContext,
  getYoutubeMinerPromptConfig,
  saveYoutubeMinerPromptConfig,
};
