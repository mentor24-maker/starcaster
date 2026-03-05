'use strict';

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', 'data', 'profile.json');

function ensureFile() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ profile: {} }, null, 2), { mode: 0o600 });
    fs.chmodSync(STORE_FILE, 0o600);
  }
}

function safeText(value) {
  return String(value || '').trim();
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return defaultProfile();
  return {
    projectName: safeText(input.projectName),
    contactName: safeText(input.contactName),
    email: safeText(input.email),
    phone: safeText(input.phone),
    website: safeText(input.website),
    logoDataUrl: safeText(input.logoDataUrl),
    updatedAt: safeText(input.updatedAt),
  };
}

function defaultProfile() {
  return {
    projectName: '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    logoDataUrl: '',
    updatedAt: '',
  };
}

function readStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      profile: sanitize(parsed?.profile),
    };
  } catch {
    return { profile: defaultProfile() };
  }
}

function writeStore(store) {
  ensureFile();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
  fs.chmodSync(STORE_FILE, 0o600);
}

function getProfile() {
  return readStore().profile;
}

function saveProfile(input) {
  const profile = sanitize({
    projectName: input.projectName,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    website: input.website,
    logoDataUrl: input.logoDataUrl,
    updatedAt: new Date().toISOString(),
  });
  writeStore({ profile });
  return profile;
}

module.exports = {
  getProfile,
  saveProfile,
};
