'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_VERSION = 'v1';

function keyFromEnv() {
  const raw = String(process.env.CHANNELS_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    return { ok: false, error: 'CHANNELS_ENCRYPTION_KEY is not configured' };
  }
  let buf;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    return { ok: false, error: 'CHANNELS_ENCRYPTION_KEY is not valid base64' };
  }
  if (buf.length !== KEY_BYTES) {
    return { ok: false, error: 'CHANNELS_ENCRYPTION_KEY must decode to 32 bytes' };
  }
  return { ok: true, key: buf };
}

function encryptSecret(plaintext) {
  const input = String(plaintext || '');
  const keyRes = keyFromEnv();
  if (!keyRes.ok) return keyRes;

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, keyRes.key, iv);
  const ciphertext = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ok: true,
    data: {
      password_enc: ciphertext.toString('base64'),
      password_iv: iv.toString('base64'),
      password_tag: tag.toString('base64'),
      key_version: KEY_VERSION,
    },
  };
}

function decryptSecret(row) {
  const hasEncrypted =
    row &&
    row.password_enc &&
    row.password_iv &&
    row.password_tag;

  if (!hasEncrypted) {
    return { ok: true, data: { plaintext: String((row && row.password) || '') } };
  }

  const keyRes = keyFromEnv();
  if (!keyRes.ok) return keyRes;

  try {
    const iv = Buffer.from(String(row.password_iv), 'base64');
    const tag = Buffer.from(String(row.password_tag), 'base64');
    const enc = Buffer.from(String(row.password_enc), 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, keyRes.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    return { ok: true, data: { plaintext } };
  } catch (err) {
    return { ok: false, error: `Could not decrypt channel password: ${err.message}` };
  }
}

module.exports = {
  encryptSecret,
  decryptSecret,
  KEY_VERSION,
};
