#!/usr/bin/env node
'use strict';

try { require('dotenv').config(); } catch (_) {}

/**
 * Backfill plaintext channel passwords into encrypted columns.
 *
 * Default mode is dry-run.
 *
 * Usage:
 *   node scripts/backfill_channels_password_encryption.js
 *   node scripts/backfill_channels_password_encryption.js --apply
 */

const { sbQuery, tableConfig, isConfigured } = require('../lib/supabase');
const { encryptSecret } = require('../lib/channelsCipher');

function parseArgs(argv) {
  const args = { apply: false, limit: null };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--dry-run') args.apply = false;
    else if (raw.startsWith('--limit=')) {
      const n = Number(raw.split('=')[1]);
      args.limit = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return args;
}

async function fetchChannels(limit) {
  const table = tableConfig().channels || 'channels';
  const pageSize = 1000;
  let offset = 0;
  const rows = [];
  while (true) {
    const query =
      `select=id,channel,user_name,password,password_enc,password_iv,password_tag,key_version` +
      `&order=id.asc&limit=${pageSize}&offset=${offset}`;
    const res = await sbQuery({ table, query });
    if (!res.ok) return res;
    const chunk = Array.isArray(res.data) ? res.data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    if (limit && rows.length >= limit) break;
    offset += pageSize;
  }
  return { ok: true, data: limit ? rows.slice(0, limit) : rows };
}

async function patchChannel(row) {
  const encrypted = encryptSecret(row.password || '');
  if (!encrypted.ok) return { ok: false, status: 500, error: encrypted.error };

  return sbQuery({
    method: 'PATCH',
    table: tableConfig().channels || 'channels',
    query: `id=eq.${Number(row.id)}&select=id`,
    headers: { Prefer: 'return=representation' },
    body: {
      password: '',
      ...encrypted.data,
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!isConfigured()) {
    console.error('Supabase is not configured. Set env vars or Settings > APIs > Supabase.');
    process.exit(1);
  }

  const rowsRes = await fetchChannels(args.limit);
  if (!rowsRes.ok) {
    console.error(`Failed reading channels: ${rowsRes.error || 'unknown error'}`);
    process.exit(1);
  }

  const rows = Array.isArray(rowsRes.data) ? rowsRes.data : [];
  const candidates = rows.filter((row) => {
    const hasEncrypted = Boolean(row.password_enc && row.password_iv && row.password_tag);
    const plain = String(row.password || '');
    return !hasEncrypted && plain.length > 0;
  });

  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Channels scanned: ${rows.length}`);
  console.log(`Channels needing encryption: ${candidates.length}`);

  let updated = 0;
  let failed = 0;

  for (const row of candidates) {
    if (!args.apply) {
      updated += 1;
      console.log(`[dry-run] id=${row.id} channel="${row.channel || ''}" user="${row.user_name || ''}"`);
      continue;
    }

    const saveRes = await patchChannel(row);
    if (!saveRes.ok) {
      failed += 1;
      console.log(`[fail] id=${row.id} error=${saveRes.error || 'unknown update error'}`);
      continue;
    }
    updated += 1;
    console.log(`[updated] id=${row.id}`);
  }

  console.log('\nSummary');
  console.log(`Updated: ${updated}`);
  console.log(`Failed:  ${failed}`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
