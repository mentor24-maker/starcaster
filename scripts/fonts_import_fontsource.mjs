#!/usr/bin/env node
/**
 * Fill the font library's shared (platform) shelf from Fontsource
 * (Font Library 4/7, task 86bchyd4a).
 *
 *   npm run fonts:import -- docs/fonts/starter-pack.txt            dry run: says what it would do, writes nothing
 *   npm run fonts:import -- docs/fonts/starter-pack.txt --apply    downloads, stores, saves, reads back
 *
 * Which database it writes to is whatever SUPABASE_URL says, and it prints
 * which one first. Local:      doppler run --project starcaster --config dev -- npm run fonts:import -- …
 *                 Production: doppler run --project starcaster --config prd -- npm run fonts:import -- …
 *
 * For each family in the list: Fontsource's licence goes through the
 * library's own licence check (OFL, Apache, public domain — anything else is
 * skipped and named), the latin woff2 files are downloaded and checked to be
 * fonts, stored at a FIXED blob path (Fonts/platform/<slug>/<weight>-<style>.woff2),
 * and saved as a `visibility: platform` row through lib/fontsStore.js.
 *
 * Safe to run twice: a family already on the shelf (same slug) is reported as
 * present and not touched, so the second --apply writes nothing. A failure
 * part-way leaves no row and removes the files it had just stored.
 *
 * Exit: 0 done (skips are not failures — they are the licence gate working),
 *       1 something failed or the read-back disagreed — run it again, it resumes,
 *       2 could not start (no table, no blob token, unreadable list).
 *
 * Decisions live in lib/fontsourceImport.js (tested); this file moves bytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { sbQuery, isConfigured: supabaseConfigured } = require('../lib/supabase');
const blobStorage = require('../lib/blobStorage');
const fontsStore = require('../lib/fontsStore');
const { detectFontFormat } = require('../lib/fontFiles');
const { classify } = require('../lib/environmentBanner');
const {
  FONTSOURCE_API,
  countByCategory,
  parsePackFile,
  planFamily,
  platformFilePath,
  readBackMismatches,
} = require('../lib/fontsourceImport');

const CONCURRENCY = 6;
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const listArg = args.find((a) => !a.startsWith('--'));

function out(line = '') { process.stdout.write(`${line}\n`); }
function stop(code, line) { process.stderr.write(`${line}\n`); process.exit(code); }

async function fetchJson(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 404) return { ok: true, data: null };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, data: await res.json() };
    } catch (err) {
      if (attempt >= 3) return { ok: false, error: `${url}: ${err.message}` };
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function fetchBytes(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url);
      // Fontsource's catalogue sometimes lists a file its CDN does not have
      // (cardo 700-italic, 2026-10-14). That will never succeed, so it is
      // answered at once rather than retried.
      if (res.status === 404) return { ok: false, gone: true, error: `${url}: HTTP 404` };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, data: Buffer.from(await res.arrayBuffer()) };
    } catch (err) {
      if (attempt >= 3) return { ok: false, error: `${url}: ${err.message}` };
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function inBatches(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane));
  return results;
}

async function readPlatformRows() {
  const res = await sbQuery({
    method: 'GET',
    table: 'fonts',
    query: 'select=slug,family,category,styles&visibility=eq.platform&order=slug.asc&limit=5000',
  });
  if (!res.ok) {
    return {
      ok: false,
      error: `Could not read the fonts table (${res.status}: ${res.error || 'no detail'}). `
        + 'Has docs/SQL/fonts_library_setup.sql been applied to this database?',
    };
  }
  return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
}

/**
 * Download, store, save. Returns null on success or the reason it failed.
 * A file the CDN does not have is dropped and named in plan.dropped; the
 * family still comes in with the rest, unless that leaves no upright file.
 */
async function importFamily(plan) {
  const stored = [];
  const undo = async () => {
    for (const s of stored) {
      try { await blobStorage.deleteBlob(s.url); } catch { /* the failure is already being reported */ }
    }
  };
  for (const file of plan.files) {
    const got = await fetchBytes(file.url);
    if (!got.ok && got.gone) { plan.dropped.push(`${file.weight} ${file.style}`); continue; }
    if (!got.ok) { await undo(); return `download failed — ${got.error}`; }
    const name = `${plan.font.slug}-${file.weight}-${file.style}.woff2`;
    const format = detectFontFormat(name, got.data);
    if (!format.ok) { await undo(); return format.message; }
    const pathname = platformFilePath(plan.font.slug, file);
    const put = await blobStorage.uploadBufferToBlobAtPath({ pathname, mimeType: format.mime, fileBuffer: got.data });
    if (!put.ok) { await undo(); return `storing ${pathname} failed — ${put.error || put.status}`; }
    stored.push({ weight: file.weight, style: file.style, format: 'woff2', url: put.data.location, pathname: put.data.pathname || pathname });
  }
  if (!stored.some((s) => s.style === 'normal')) {
    await undo();
    return `no upright file is on Fontsource's CDN (listed but missing: ${plan.dropped.join(', ')})`;
  }
  const created = await fontsStore.createFont({ ...plan.font, tags: [], styles: stored }, null, { visibility: 'platform' });
  if (!created.ok) {
    // A 409 means another run saved it in the meantime: its row points at
    // these same fixed paths, so the files must stay.
    if (created.status === 409) return 'PRESENT';
    await undo();
    return `saving the row failed — ${created.error || created.status}`;
  }
  return null;
}

async function main() {
  if (!listArg) stop(2, 'Usage: npm run fonts:import -- <list-file> [--apply]   (e.g. docs/fonts/starter-pack.txt)');
  const listPath = path.resolve(ROOT, listArg);
  let text;
  try { text = fs.readFileSync(listPath, 'utf8'); } catch (err) { stop(2, `Cannot read ${listArg}: ${err.message}`); }
  const pack = parsePackFile(text);
  if (pack.problems.length) {
    stop(2, `${listArg} has ${pack.problems.length} line(s) it cannot use — fix them first:\n`
      + pack.problems.map((p) => `  line ${p.line}: ${p.message}`).join('\n'));
  }

  const where = classify(process.env.SUPABASE_URL);
  out(`Font import from Fontsource — ${apply ? 'APPLY (writes)' : 'DRY RUN (writes nothing)'}`);
  out(`  list:     ${listArg} (${pack.entries.length} families)`);
  out(`  database: ${where.toUpperCase()}`);
  if (!supabaseConfigured()) stop(2, 'No database is configured (SUPABASE_URL / SUPABASE_SERVICE_KEY). Run it under doppler run.');
  if (apply && !blobStorage.isConfigured()) stop(2, 'BLOB_READ_WRITE_TOKEN is not set, so there is nowhere to store font files.');

  const before = await readPlatformRows();
  if (!before.ok) stop(2, before.error);
  const presentSlugs = new Set(before.data.map((r) => r.slug));
  out(`  already in the shared library: ${presentSlugs.size}`);
  out('');

  const details = await inBatches(pack.entries, (entry) => fetchJson(`${FONTSOURCE_API}/${entry.id}`));
  const plans = pack.entries.map((entry, i) => {
    if (!details[i].ok) return { action: 'fail', id: entry.id, reason: `Fontsource could not be read — ${details[i].error}` };
    return planFamily(entry, details[i].data, presentSlugs);
  });

  const importing = plans.filter((p) => p.action === 'import');
  for (const plan of importing) plan.dropped = [];
  const results = apply ? await inBatches(importing, importFamily) : [];

  const imported = [];
  const failed = plans.filter((p) => p.action === 'fail');
  const present = plans.filter((p) => p.action === 'present');
  importing.forEach((plan, i) => {
    const verdict = apply ? results[i] : null;
    const label = `${plan.font.family.padEnd(32)} ${plan.font.category.padEnd(11)} ${plan.font.licence.padEnd(13)} ${plan.files.length} file(s)`;
    if (verdict === 'PRESENT') {
      // Another run saved it while this one worked; listed with the rest below.
      present.push({ id: plan.id, family: plan.font.family });
    } else if (verdict) {
      failed.push({ id: plan.id, family: plan.font.family, reason: verdict });
      out(`  FAILED   ${label} — ${verdict}`);
    } else {
      const fileCount = plan.files.length - plan.dropped.length;
      if (apply) imported.push({ family: plan.font.family, slug: plan.font.slug, fileCount });
      const shown = apply ? label.replace(/\d+ file\(s\)$/, `${fileCount} file(s)`) : label;
      const notes = [
        plan.missing.length ? `not on Fontsource: ${plan.missing.join(', ')}` : '',
        plan.dropped.length ? `listed but missing from Fontsource's CDN, left out: ${plan.dropped.join(', ')}` : '',
      ].filter(Boolean);
      out(`  ${apply ? 'imported' : 'would add'} ${shown}${notes.length ? `  (${notes.join('; ')})` : ''}`);
    }
  });
  const skipped = plans.filter((p) => p.action === 'skip');
  for (const p of present) out(`  present  ${p.family} — already in the shared library, left alone`);
  for (const p of skipped) out(`  skipped  ${p.family || p.id} (${p.id}) — ${p.reason}`);
  for (const p of plans.filter((x) => x.action === 'fail')) out(`  FAILED   ${p.id} — ${p.reason}`);

  out('');
  out(`${apply ? 'Imported' : 'Would import'}: ${apply ? imported.length : importing.length}   `
    + `already present: ${present.length}   skipped: ${skipped.length}   failed: ${failed.length}`);

  if (!apply) {
    out('Dry run — nothing was written. Add --apply to import.');
    process.exit(failed.length ? 1 : 0);
  }

  // Read back what the database actually holds, not what the writes said.
  const after = await readPlatformRows();
  if (!after.ok) stop(1, `Read-back failed: ${after.error}`);
  const mismatches = readBackMismatches(imported, after.data);
  out('');
  out(`Shared library now holds ${after.data.length} font(s), by category (read back from the database):`);
  for (const [category, n] of Object.entries(countByCategory(after.data)).sort()) out(`  ${category.padEnd(12)} ${n}`);
  const expected = presentSlugs.size + imported.length;
  if (after.data.length !== expected) {
    mismatches.push(`expected ${expected} platform fonts (${presentSlugs.size} before + ${imported.length} imported), found ${after.data.length}`);
  }
  if (mismatches.length) {
    stop(1, `\nREAD-BACK DISAGREES with what was uploaded:\n${mismatches.map((m) => `  ${m}`).join('\n')}`);
  }
  if (failed.length) stop(1, `\n${failed.length} family(ies) failed. Run the same command again — it skips what is already in.`);
  out('Read-back matches.');
}

main().catch((err) => stop(1, `Font import stopped: ${err && err.stack ? err.stack : err}`));
