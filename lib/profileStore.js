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

function sanitize(input) {
  if (!input || typeof input !== 'object') return defaultProfile();
  return {
    contactName: safeText(input.contactName ?? input.contact_name),
    email: safeText(input.email),
    phone: safeText(input.phone),
    website: safeText(input.website),
    logoDataUrl: safeText(input.logoDataUrl ?? input.logo_data_url),
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
    updatedAt: '',
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

module.exports = {
  getProfile,
  saveProfile,
};
