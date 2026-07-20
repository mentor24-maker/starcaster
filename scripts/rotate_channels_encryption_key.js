#!/usr/bin/env node
'use strict';

try { require('dotenv').config({ path: '.env.local' }); } catch (_) {}
try { require('dotenv').config(); } catch (_) {}

/**
 * Re-encrypt every stored channel password from an OLD CHANNELS_ENCRYPTION_KEY
 * to a NEW one. Needed after docs/runbook-credential-rotation.md Phase 3 — do
 * NOT just swap CHANNELS_ENCRYPTION_KEY in .env/Vercel, or every already-saved
 * channel password becomes permanently unreadable.
 *
 * This is a human-run script on purpose (see runbook: "agents never handle
 * live secrets"). Set the two keys in your OWN shell right before running —
 * never paste them into a chat, file, or commit.
 *
 * Usage:
 *   export OLD_CHANNELS_ENCRYPTION_KEY="<the key that was in place before 7/13>"
 *   export NEW_CHANNELS_ENCRYPTION_KEY="<output of: openssl rand -base64 32>"
 *   node scripts/rotate_channels_encryption_key.js              # dry run — verifies decryption only, writes nothing
 *   node scripts/rotate_channels_encryption_key.js --apply      # backs up, then re-encrypts and writes
 *
 * If some rows fail to decrypt with OLD_CHANNELS_ENCRYPTION_KEY (a prior,
 * unrecoverable key was used before this one), the script aborts by default
 * so nothing is silently skipped. Once you've confirmed those specific rows
 * really are unrecoverable, name them explicitly to proceed without them:
 *   node scripts/rotate_channels_encryption_key.js --apply --skip-ids=1,2,3
 * Skipped rows are left completely untouched (not deleted, not cleared) —
 * still encrypted under whatever key they already had, same as today.
 *
 * After --apply succeeds:
 *   1. Put NEW_CHANNELS_ENCRYPTION_KEY into .env.local as CHANNELS_ENCRYPTION_KEY.
 *   2. Update the CHANNELS_ENCRYPTION_KEY env var in Vercel (Production, and
 *      Preview/Dev if used) to the same value.
 *   3. Redeploy.
 *   4. Confirm a channel loads/edits correctly in the UI.
 *   5. Only then delete the backup file this script wrote and unset both env vars.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { sbQuery, tableConfig, isConfigured } = require('../lib/supabase');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_VERSION = 'v1';

function loadKey(envName) {
  const raw = String(process.env[envName] || '').trim();
  if (!raw) {
    console.error(`${envName} is not set. Export it in this shell first — see the usage comment at the top of this script.`);
    process.exit(1);
  }
  let buf;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    console.error(`${envName} is not valid base64.`);
    process.exit(1);
  }
  if (buf.length !== KEY_BYTES) {
    console.error(`${envName} must decode to 32 bytes (got ${buf.length}).`);
    process.exit(1);
  }
  return buf;
}

function decryptWithKey(row, key) {
  const iv = Buffer.from(String(row.password_iv), 'base64');
  const tag = Buffer.from(String(row.password_tag), 'base64');
  const enc = Buffer.from(String(row.password_enc), 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function encryptWithKey(plaintext, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    password_enc: ciphertext.toString('base64'),
    password_iv: iv.toString('base64'),
    password_tag: tag.toString('base64'),
    key_version: KEY_VERSION,
  };
}

function parseArgs(argv) {
  const skipArg = argv.find((a) => a.startsWith('--skip-ids='));
  const skipIds = new Set(
    skipArg
      ? skipArg
          .slice('--skip-ids='.length)
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
      : []
  );
  return { apply: argv.includes('--apply'), skipIds };
}

async function fetchEncryptedChannels() {
  const table = tableConfig().channels || 'channels';
  const pageSize = 1000;
  let offset = 0;
  const rows = [];
  while (true) {
    const query =
      `select=id,channel,user_name,password_enc,password_iv,password_tag,key_version,created_at` +
      `&order=id.asc&limit=${pageSize}&offset=${offset}`;
    const res = await sbQuery({ table, query });
    if (!res.ok) return res;
    const chunk = Array.isArray(res.data) ? res.data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return { ok: true, data: rows.filter((r) => r.password_enc && r.password_iv && r.password_tag) };
}

async function patchChannel(id, encData) {
  const table = tableConfig().channels || 'channels';
  return sbQuery({
    method: 'PATCH',
    table,
    query: `id=eq.${Number(id)}&select=id`,
    headers: { Prefer: 'return=representation' },
    body: encData,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!isConfigured()) {
    console.error('Supabase is not configured. Set env vars or Settings > APIs > Supabase.');
    process.exit(1);
  }

  const oldKey = loadKey('OLD_CHANNELS_ENCRYPTION_KEY');
  const newKey = loadKey('NEW_CHANNELS_ENCRYPTION_KEY');

  if (oldKey.equals(newKey)) {
    console.error('OLD_CHANNELS_ENCRYPTION_KEY and NEW_CHANNELS_ENCRYPTION_KEY are identical — nothing to rotate.');
    process.exit(1);
  }

  const rowsRes = await fetchEncryptedChannels();
  if (!rowsRes.ok) {
    console.error(`Failed reading channels: ${rowsRes.error || 'unknown error'}`);
    process.exit(1);
  }
  const rows = rowsRes.data;
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Encrypted channel rows found: ${rows.length}`);
  if (args.skipIds.size) {
    console.log(`Explicitly skipping (left untouched): ${[...args.skipIds].join(', ')}`);
  }

  // Step 1: decrypt everything with the OLD key first, except rows explicitly
  // named with --skip-ids. If any non-skipped row fails, stop — we never want
  // to silently or partially rotate.
  const decrypted = [];
  const skipped = [];
  let decryptFailed = 0;
  for (const row of rows) {
    if (args.skipIds.has(Number(row.id))) {
      skipped.push(row);
      console.log(`[skip] id=${row.id} channel="${row.channel}" user="${row.user_name}" — left untouched by --skip-ids`);
      continue;
    }
    try {
      const plaintext = decryptWithKey(row, oldKey);
      decrypted.push({ row, plaintext });
      console.log(`[ok]   id=${row.id} channel="${row.channel}" user="${row.user_name}" decrypts with OLD key`);
    } catch (err) {
      decryptFailed += 1;
      console.log(`[FAIL] id=${row.id} channel="${row.channel}" user="${row.user_name}" — ${err.message}`);
    }
  }

  if (decryptFailed > 0) {
    console.error(`\n${decryptFailed} row(s) did not decrypt with OLD_CHANNELS_ENCRYPTION_KEY. Stopping — check the key value, or add them to --skip-ids if they're confirmed unrecoverable. Nothing was written.`);
    process.exit(1);
  }

  console.log(`\nAll ${decrypted.length} rows decrypt cleanly with the old key.${skipped.length ? ` (${skipped.length} skipped, left as-is.)` : ''}`);

  if (!args.apply) {
    console.log('Dry run only — nothing written. Re-run with --apply to back up and re-encrypt.');
    return;
  }

  // Step 2: back up the current encrypted rows (outside the repo) before touching anything.
  const backupPath = path.join(os.homedir(), `starcaster-channels-key-rotation-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2), { mode: 0o600 });
  console.log(`Backed up ${rows.length} pre-rotation rows to ${backupPath}`);

  // Step 3: re-encrypt with the NEW key, self-verify, then write.
  let updated = 0;
  let failed = 0;
  for (const { row, plaintext } of decrypted) {
    const encData = encryptWithKey(plaintext, newKey);
    // Self-verify before writing: decrypt what we just produced.
    const check = decryptWithKey({ ...encData }, newKey);
    if (check !== plaintext) {
      failed += 1;
      console.log(`[FAIL] id=${row.id} self-verification mismatch — not written`);
      continue;
    }
    const saveRes = await patchChannel(row.id, encData);
    if (!saveRes.ok) {
      failed += 1;
      console.log(`[FAIL] id=${row.id} write error: ${saveRes.error || 'unknown'}`);
      continue;
    }
    updated += 1;
    console.log(`[updated] id=${row.id}`);
  }

  console.log('\nSummary');
  console.log(`Updated: ${updated}`);
  console.log(`Failed:  ${failed}`);
  console.log(`Backup:  ${backupPath}`);
  if (failed === 0) {
    console.log('\nAll rows rotated. Next: put NEW_CHANNELS_ENCRYPTION_KEY into .env.local and Vercel as CHANNELS_ENCRYPTION_KEY, redeploy, verify a channel in the UI, then delete the backup file and unset both *_CHANNELS_ENCRYPTION_KEY env vars.');
  } else {
    console.log('\nSome rows failed to rotate — the backup file above still has their original encrypted values under the OLD key. Do not delete it.');
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
