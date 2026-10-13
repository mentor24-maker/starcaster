'use strict';

/**
 * The logic behind `npm run canon:sync` (scripts/sync_canon.mjs), kept here so
 * the node suite can drive it with a fake vault and a fake store
 * (scripts/builder/syncCanon.test.js). Reddit comments 1/4, task 86bch3jmr.
 *
 * It copies a FIXED list of vault files into canon_documents. The list is
 * Dane's choice (2026-10-12) and is not discovered: a file that is missing is
 * named and fails the whole run before anything is written, because a canon
 * that is quietly missing VOICE.md writes in the wrong voice and says nothing.
 *
 * It never writes to the vault — it only reads it.
 */

const fs = require('fs');
const path = require('path');
const { hashCanon } = require('./canonStore');

const CANON_FILES = [
  'doctrine/DANE-OF-EARTH.md',
  'doctrine/VOICE.md',
  'wiki/aiism-blocklist.md',
  'doctrine/DEO.md',
  'doctrine/DEO-CHARACTERISTICS.md',
  'doctrine/DEO-DATA-THESIS.md',
  'doctrine/ECOSYSTEM.md',
];

/** doctrine/DEO-DATA-THESIS.md -> DEO-DATA-THESIS; wiki/aiism-blocklist.md -> AIISM-BLOCKLIST */
function docKeyFor(sourcePath) {
  return path.basename(sourcePath, path.extname(sourcePath))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The first markdown `# ` heading, or the key when there is none. */
function titleFor(body, docKey) {
  const m = String(body).match(/^#\s+(.+?)\s*#*\s*$/m);
  return m ? m[1].trim() : docKey;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Read every listed file. Returns { docs, missing } — missing names each absent file. */
function readCanonFiles(vaultDir, files = CANON_FILES) {
  const docs = [];
  const missing = [];
  for (const sourcePath of files) {
    const full = path.join(vaultDir, sourcePath);
    let body;
    try {
      body = fs.readFileSync(full, 'utf8');
    } catch (err) {
      missing.push({ sourcePath, full, reason: err.code === 'ENOENT' ? 'not found' : err.message });
      continue;
    }
    if (!body.trim()) {
      missing.push({ sourcePath, full, reason: 'the file is empty' });
      continue;
    }
    const docKey = docKeyFor(sourcePath);
    docs.push({ docKey, title: titleFor(body, docKey), body, sourcePath, contentHash: hashCanon(body), bytes: Buffer.byteLength(body, 'utf8') });
  }
  return { docs, missing };
}

/**
 * Run one sync. `store` is { listCanon, upsertCanonDocument } (lib/canonStore.js
 * in real use). `log` receives each output line. Returns { exitCode, results }.
 *
 *   exit 0  every document is in the database and the read-back agrees
 *   exit 1  a file is missing, a write was refused, or the read-back disagrees
 */
async function runSync({ vaultDir, apply = false, scope, files = CANON_FILES }, { store, log = console.log }) {
  const mode = apply ? 'APPLY' : 'DRY RUN — nothing will be written';
  log(`canon:sync  ${mode}`);
  log(`  vault:   ${vaultDir}`);
  log(`  project: ${scope.projectId}  (owner ${scope.userId})`);
  log('');

  const { docs, missing } = readCanonFiles(vaultDir, files);
  if (missing.length) {
    for (const m of missing) log(`MISSING  ${m.sourcePath}  — ${m.reason} (${m.full})`);
    log('');
    log(`FAILED: ${missing.length} of ${files.length} canon file(s) could not be read. Nothing was written.`);
    return { exitCode: 1, results: [] };
  }

  const existing = await store.listCanon(500, scope);
  if (!existing.ok) {
    log(`FAILED: could not read what the database already holds — ${existing.error}. Nothing was written.`);
    return { exitCode: 1, results: [] };
  }
  const byKey = new Map(existing.data.map((row) => [row.docKey, row]));

  const results = [];
  let failed = 0;
  for (const doc of docs) {
    const prior = byKey.get(doc.docKey);
    const size = formatSize(doc.bytes);
    if (prior && prior.contentHash === doc.contentHash) {
      results.push({ docKey: doc.docKey, outcome: 'unchanged' });
      log(`unchanged     ${doc.docKey.padEnd(20)} ${doc.sourcePath.padEnd(34)} ${size}`);
      continue;
    }
    const isNew = prior ? '' : '  (new)';
    if (!apply) {
      results.push({ docKey: doc.docKey, outcome: 'would update' });
      log(`would update  ${doc.docKey.padEnd(20)} ${doc.sourcePath.padEnd(34)} ${size}${isNew}`);
      continue;
    }
    const saved = await store.upsertCanonDocument(doc, scope);
    if (!saved.ok) {
      failed += 1;
      results.push({ docKey: doc.docKey, outcome: 'failed', error: saved.error });
      log(`FAILED        ${doc.docKey.padEnd(20)} ${doc.sourcePath.padEnd(34)} ${saved.error}`);
      continue;
    }
    results.push({ docKey: doc.docKey, outcome: 'updated' });
    log(`updated       ${doc.docKey.padEnd(20)} ${doc.sourcePath.padEnd(34)} ${size}${isNew}`);
  }

  log('');
  if (failed) {
    log(`FAILED: ${failed} document(s) were refused by the database.`);
    return { exitCode: 1, results };
  }
  if (!apply) {
    const pending = results.filter((r) => r.outcome !== 'unchanged').length;
    log(`Dry run: ${docs.length} document(s) read, ${pending} would be written. Run with --apply to write them.`);
    return { exitCode: 0, results };
  }

  // Read the rows back rather than trusting the writes (landmine 12: an insert
  // can succeed and land without its tenant).
  const back = await store.listCanon(500, scope);
  if (!back.ok) {
    log(`FAILED: the writes reported success but the read-back failed — ${back.error}. CANNOT TELL whether they landed.`);
    return { exitCode: 1, results };
  }
  const backByKey = new Map(back.data.map((row) => [row.docKey, row]));
  log('Read back from the database:');
  let bad = 0;
  for (const doc of docs) {
    const row = backByKey.get(doc.docKey);
    const problems = [];
    if (!row) problems.push('no row');
    else {
      if (row.contentHash !== doc.contentHash) problems.push('hash differs from the vault file');
      if (row.projectId !== scope.projectId) problems.push(`project_id is "${row.projectId}"`);
      if (row.ownerUserId !== scope.userId) problems.push(`owner_user_id is "${row.ownerUserId}"`);
    }
    if (problems.length) bad += 1;
    const verdict = problems.length ? `BAD — ${problems.join('; ')}` : 'ok';
    log(`  ${doc.docKey.padEnd(20)} ${row ? row.contentHash.slice(0, 12) : '-'.repeat(12)}  project ${row?.projectId || '-'}  owner ${row?.ownerUserId || '-'}  synced ${row?.syncedAt || '-'}  ${verdict}`);
  }
  log('');
  if (bad) {
    log(`FAILED: ${bad} of ${docs.length} document(s) did not read back correctly.`);
    return { exitCode: 1, results };
  }
  log(`OK: ${docs.length} of ${docs.length} document(s) read back with matching hashes and both tenant columns.`);
  return { exitCode: 0, results };
}

module.exports = { CANON_FILES, docKeyFor, titleFor, readCanonFiles, runSync };
