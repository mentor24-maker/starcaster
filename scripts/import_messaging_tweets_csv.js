#!/usr/bin/env node
'use strict';

/**
 * Import tweet rows from the Normie WYR CSV (or any compatible CSV).
 *
 *   node scripts/import_messaging_tweets_csv.js
 *   node scripts/import_messaging_tweets_csv.js --apply
 *   node scripts/import_messaging_tweets_csv.js --apply --project-id=YOUR_PROJECT_UUID
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { mapImportRows } = require('../lib/messagingFormatImport');
const { importMessagingFormatRows } = require('../lib/messagingImportService');

const defaultCsv = path.join(
  __dirname,
  '..',
  'supabase/migrations/normie_200_would_you_rather_scoring_system.xlsm - WYR Questions.csv'
);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const csvPath = args.find((a) => !a.startsWith('--')) || defaultCsv;
const projectArg = args.find((a) => a.startsWith('--project-id='));
const projectId = projectArg
  ? projectArg.split('=').slice(1).join('=').trim()
  : String(process.env.MESSAGING_IMPORT_PROJECT_ID || process.env.WYR_IMPORT_PROJECT_ID || '').trim();

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
      if (ch === '"' && next === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i += 1; continue; }
      cell += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i += 1; continue; }
    if (ch === '\r' && next === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 2; continue; }
    if (ch === '\n' || ch === '\r') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; continue; }
    cell += ch; i += 1;
  }
  row.push(cell);
  if (row.some((c) => c !== '') rows.push(row);
  return rows;
}

function matrixToObjects(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2) return [];
  const headers = matrix[0];
  return matrix.slice(1).map((cells) => {
    const row = {};
    headers.forEach((header, index) => {
      row[String(header || '').trim()] = String(cells[index] == null ? '' : cells[index]).trim();
    });
    return row;
  });
}

async function main() {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const mapped = mapImportRows('tweets', matrixToObjects(parseCsv(raw)));
  if (!mapped.length) {
    console.error('No valid rows found. Expected headers: Category, Topic, One-Line Question (or Tweet / Content).');
    process.exit(1);
  }

  console.log(`Parsed ${mapped.length} tweet row(s) from ${path.basename(csvPath)}`);
  if (!apply) {
    console.log('Dry run only. Re-run with --apply to import.');
    console.log('Sample:', mapped[0]);
    return;
  }

  const scope = projectId ? { projectId, userId: '' } : null;
  const result = await importMessagingFormatRows('tweets', mapped, scope);
  console.log(`Imported ${result.imported} tweet(s).`);
  if (result.errors?.length) {
    console.error(`Errors (${result.errors.length}):`, result.errors.slice(0, 5));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
