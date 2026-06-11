#!/usr/bin/env node
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sbQuery, tableConfig, isConfigured } = require('../lib/supabase.js');
const {
  migrateLegacyLayoutSections,
  isLegacySectionArray,
} = require('../lib/builder/migrate-from-legacy.js');
const {
  normalizeBuilderDocument,
  serializeBuilderDocument,
} = require('../lib/builder/document.js');

const APPLY = process.argv.includes('--apply');

function needsMigration(raw) {
  if (!raw) return false;
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value) && isLegacySectionArray(value)) return true;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sections = value.sections ?? value.layoutSections;
    return isLegacySectionArray(sections);
  }
  return false;
}

function transformLayoutSections(raw) {
  const migrated = migrateLegacyLayoutSections(raw);
  const document = normalizeBuilderDocument(migrated);
  return serializeBuilderDocument(document);
}

async function migrateTable(tableName) {
  const res = await sbQuery({
    method: 'GET',
    table: tableName,
    query: 'select=id,layout_sections&limit=5000',
  });
  if (!res.ok) {
    console.error(`[${tableName}] load failed:`, res.error || res.message);
    return { scanned: 0, candidates: 0, updated: 0 };
  }

  const rows = Array.isArray(res.data) ? res.data : [];
  let candidates = 0;
  let updated = 0;

  for (const row of rows) {
    if (!needsMigration(row.layout_sections)) continue;
    candidates += 1;
    const next = transformLayoutSections(row.layout_sections);
    console.log(`[${tableName}] id=${row.id} -> canonical document (${next.sections.length} sections)`);
    if (!APPLY) continue;
    const patch = await sbQuery({
      method: 'PATCH',
      table: tableName,
      query: `id=eq.${row.id}`,
      headers: { Prefer: 'return=minimal' },
      body: { layout_sections: next },
    });
    if (!patch.ok) {
      console.error(`[${tableName}] id=${row.id} patch failed:`, patch.error || patch.message);
      continue;
    }
    updated += 1;
  }

  return { scanned: rows.length, candidates, updated };
}

async function main() {
  if (!isConfigured()) {
    console.error('Supabase is not configured. Set env vars and retry.');
    process.exit(1);
  }

  const tables = tableConfig();
  const targets = [
    tables.developPageTemplates,
    tables.developLandingPages,
  ].filter(Boolean);

  console.log(APPLY ? 'Applying builder document migration...' : 'Dry run (pass --apply to write)...');

  let totalCandidates = 0;
  for (const tableName of targets) {
    const result = await migrateTable(tableName);
    console.log(`[${tableName}] scanned=${result.scanned} candidates=${result.candidates} updated=${result.updated}`);
    totalCandidates += result.candidates;
  }

  if (!APPLY && totalCandidates > 0) {
    console.log(`\n${totalCandidates} row(s) would be migrated. Re-run with --apply.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
