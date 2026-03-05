#!/usr/bin/env node
'use strict';

/**
 * Import contacts from a CSV file into unified Supabase contacts.
 *
 * Default mode is dry-run.
 *
 * Usage:
 *   node scripts/import_contacts_csv_to_supabase.js
 *   node scripts/import_contacts_csv_to_supabase.js --apply
 *   node scripts/import_contacts_csv_to_supabase.js --file=files/contacts.csv --apply
 */

const fs = require('fs');
const path = require('path');
const { sbQuery, tableConfig, isConfigured } = require('../lib/supabase');

function parseArgs(argv) {
  const args = {
    apply: false,
    file: 'files/contacts.csv',
    limit: null,
  };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--dry-run') args.apply = false;
    else if (raw.startsWith('--file=')) args.file = String(raw.split('=')[1] || '').trim();
    else if (raw.startsWith('--limit=')) {
      const n = Number(raw.split('=')[1]);
      args.limit = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const t = String(text || '');

  while (i < t.length) {
    const ch = t[i];
    const next = t[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r' && next === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  row.push(cell);
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(header) {
  return String(header || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cleanText(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  if (lower === 'na' || lower === 'n/a' || lower === 'none' || lower === 'null') return '';
  return v;
}

function normalizeEmail(value) {
  const email = cleanText(value).toLowerCase();
  return email.includes('@') ? email : null;
}

function parseSubscribers(raw) {
  const cleaned = cleanText(raw).replace(/,/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toContactId(index, reader, email) {
  const base = (email || reader || `row_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `csv_${Date.now()}_${index + 1}_${base || 'contact'}`;
}

function mapRow(row, index) {
  const reader = cleanText(row.reader);
  const firstName = cleanText(row['first name']);
  const youtube = cleanText(row['youtube channel']);
  const email = normalizeEmail(row.email);
  const instagram = cleanText(row.instagram);
  const tiktok = cleanText(row.tiktok);
  const x = cleanText(row.x);
  const facebook = cleanText(row.facebook);
  const notes = cleanText(row.notes);
  const subscribers = parseSubscribers(row.subscribers);

  const custom = {};
  if (subscribers != null) custom.subscribers = subscribers;
  if (reader) custom.reader = reader;

  return {
    id: toContactId(index, reader, email),
    contact_type: 'lead',
    email,
    first_name: firstName,
    last_name: '',
    company: reader,
    phone: '',
    city: '',
    country: '',
    tags: [],
    website: '',
    youtube,
    instagram,
    tiktok,
    facebook,
    x,
    bluesky: '',
    patreon: '',
    linkedin: '',
    source: 'contacts_csv_import',
    status: '',
    notes,
    custom_fields: custom,
  };
}

async function insertByEmail(table, rows) {
  if (!rows.length) return { ok: true, inserted: 0 };
  const res = await sbQuery({
    method: 'POST',
    table,
    query: 'on_conflict=email&select=id,email',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: rows,
  });
  if (!res.ok) {
    const code = String(res.raw?.code || '');
    const msg = String(res.error || '').toLowerCase();
    const noConflictConstraint = code === '42P10' || msg.includes('no unique or exclusion constraint');
    if (!noConflictConstraint) return { ok: false, error: res.error, raw: res.raw };

    // Fallback for schemas without UNIQUE(email): dedupe in script, then plain insert.
    const existingRes = await sbQuery({
      table,
      query: 'select=email&not.email.is.null&limit=50000',
    });
    if (!existingRes.ok) {
      return { ok: false, error: `Fallback failed while reading existing emails: ${existingRes.error}`, raw: existingRes.raw };
    }
    const existing = new Set(
      (Array.isArray(existingRes.data) ? existingRes.data : [])
        .map(r => String(r.email || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const uniqueInput = [];
    const seenInInput = new Set();
    for (const row of rows) {
      const email = String(row.email || '').trim().toLowerCase();
      if (!email) continue;
      if (existing.has(email) || seenInInput.has(email)) continue;
      seenInInput.add(email);
      uniqueInput.push(row);
    }

    if (!uniqueInput.length) return { ok: true, inserted: 0 };
    const plainInsert = await sbQuery({
      method: 'POST',
      table,
      query: 'select=id,email',
      headers: { Prefer: 'return=representation' },
      body: uniqueInput,
    });
    if (!plainInsert.ok) return { ok: false, error: plainInsert.error, raw: plainInsert.raw };
    return { ok: true, inserted: Array.isArray(plainInsert.data) ? plainInsert.data.length : 0 };
  }
  return { ok: true, inserted: Array.isArray(res.data) ? res.data.length : 0 };
}

async function upsertById(table, rows) {
  if (!rows.length) return { ok: true, upserted: 0 };
  const res = await sbQuery({
    method: 'POST',
    table,
    query: 'on_conflict=id&select=id',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: rows,
  });
  if (!res.ok) return { ok: false, error: res.error, raw: res.raw };
  return { ok: true, upserted: Array.isArray(res.data) ? res.data.length : 0 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), args.file);
  const table = tableConfig().contacts || 'contacts';

  if (!isConfigured()) {
    console.error('Supabase credentials are missing. Configure env vars or Settings > APIs > Supabase.');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`CSV not found: ${filePath}`);
    process.exit(1);
  }

  const csv = fs.readFileSync(filePath, 'utf8');
  const matrix = parseCsv(csv);
  if (matrix.length < 2) {
    console.error('CSV must include a header row and at least one data row.');
    process.exit(1);
  }

  const headers = matrix[0].map(normalizeHeader);
  const dataRows = matrix.slice(1);
  const limitedRows = args.limit ? dataRows.slice(0, args.limit) : dataRows;
  const rows = limitedRows.map((cells) => {
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] == null ? '' : String(cells[i]); });
    return row;
  });

  const mapped = rows.map(mapRow);
  const withEmail = mapped.filter(r => r.email);
  const withoutEmail = mapped.filter(r => !r.email);

  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`CSV file: ${filePath}`);
  console.log(`Target table: ${table}`);
  console.log(`Rows parsed: ${mapped.length}`);
  console.log(`Rows with email: ${withEmail.length}`);
  console.log(`Rows without email: ${withoutEmail.length}`);

  if (!args.apply) {
    console.log('');
    console.log('Dry-run sample (first 3 transformed rows):');
    console.log(JSON.stringify(mapped.slice(0, 3), null, 2));
    return;
  }

  const a = await insertByEmail(table, withEmail);
  if (!a.ok) {
    console.error(`Failed inserting email rows: ${a.error}`);
    if (a.raw) console.error(JSON.stringify(a.raw, null, 2));
    process.exit(1);
  }

  const b = await upsertById(table, withoutEmail);
  if (!b.ok) {
    console.error(`Failed upserting no-email rows: ${b.error}`);
    if (b.raw) console.error(JSON.stringify(b.raw, null, 2));
    process.exit(1);
  }

  console.log('');
  console.log('Import summary:');
  console.log(`- Inserted/ignored by email path: ${withEmail.length} processed, ${a.inserted} inserted`);
  console.log(`- Upserted no-email rows by id: ${b.upserted}`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
