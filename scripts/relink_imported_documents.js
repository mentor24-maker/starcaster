#!/usr/bin/env node
'use strict';

/**
 * Point a site's document links (PDFs, Word files, spreadsheets) at the copies
 * StarCaster already holds, instead of at the old website they came from.
 *
 * WHY THIS EXISTS
 * Site Import downloaded every PDF the Delray pages linked to and saved a copy
 * in our own file storage (`app_site_import_assets`), but it never rewrote the
 * links themselves. That was invisible while delraytennis.com still ran on
 * WordPress. Once the domain moved to StarCaster (2026-10-02), every
 * `/wp-content/uploads/....pdf` link — the employment application, the job
 * posting, the afterschool waiver — answered "not found" (task 86bce5d2u).
 * `import_external_page_images.js` fixed the same problem for pictures, but it
 * only ever matched image extensions.
 *
 * WHAT IT DOES
 *   1. Finds every document link on the old host in the project's draft pages,
 *      their published copies (what visitors are actually served) and blog
 *      posts.
 *   2. Matches each one to the copy Site Import saved, and checks that copy
 *      really answers as a file before trusting it.
 *   3. Swaps the link in place, in all three places.
 *
 * It does NOT publish. The published copy is edited directly, with the same
 * swap the draft gets, so the fix reaches visitors without putting any
 * unrelated half-finished draft live (CLAUDE.md landmine 16). For the same
 * reason it leaves `updated_at` alone: bumping it would make every touched page
 * read as "has unpublished changes" when its published copy already carries
 * the identical fix.
 *
 * A link with no saved copy is reported by name and left alone — that list is
 * a per-document decision for a person, not something to guess at.
 *
 * SAFETY
 *  - Dry run by default; --apply writes.
 *  - A JSON backup of every row it is about to change is written first.
 *  - Every written row is read back and checked for leftover old links.
 *  - Re-runnable: once no row points at the old host there is nothing to do.
 *
 * Exit codes: 0 done (or nothing to do), 1 a write failed or did not read back
 * clean, 2 could not take a reading, or some links have no saved copy.
 *
 * Usage:
 *   node scripts/relink_imported_documents.js --project=proj_… --host=delraytennis.com
 *   node scripts/relink_imported_documents.js --project=proj_… --host=delraytennis.com --apply
 */

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', 'docs', 'SQL', 'backups');
const SITE_IMPORT_ASSETS = 'app_site_import_assets';

const DOC_EXTENSIONS = 'pdf|docx?|xlsx?|pptx?|csv|txt|rtf';
const DOC_URL_RE = new RegExp(
  `(?:https?:)?//[^"'\\\\\\s)<>]+\\.(?:${DOC_EXTENSIONS})(?:[?#][^"'\\\\\\s)<>]*)?`,
  'gi'
);
// A WordPress upload written without its host ("/wp-content/uploads/x.pdf")
// broke the same way the moment the domain moved, so it counts too.
const RELATIVE_UPLOAD_RE = new RegExp(
  `(?<=["'(=\\s])/wp-content/uploads/[^"'\\\\\\s)<>]+\\.(?:${DOC_EXTENSIONS})(?:[?#][^"'\\\\\\s)<>]*)?`,
  'gi'
);

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hostMatcher(host) {
  const bare = String(host || '').trim().toLowerCase().replace(/^www\./, '');
  return new RegExp(`(^|\\.)${escapeRe(bare)}$`, 'i');
}

/**
 * The identity of a document: path only, ignoring scheme, `www.`, query and
 * fragment, so `http://delraytennis.com/x.pdf` and
 * `https://www.delraytennis.com/x.pdf?ver=2` are the same file.
 */
function documentKey(url, host) {
  try {
    const parsed = new URL(url, `https://${String(host).replace(/^www\./, '')}`);
    return decodeURI(parsed.pathname).toLowerCase();
  } catch {
    return '';
  }
}

/** Every old-host document link in one value, as written. */
function findDocumentLinks(value, host) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const onHost = hostMatcher(host);
  const found = [];
  for (const raw of text.match(DOC_URL_RE) || []) {
    try {
      const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
      if (onHost.test(parsed.hostname)) found.push(raw);
    } catch {
      // not a URL after all
    }
  }
  for (const raw of text.match(RELATIVE_UPLOAD_RE) || []) found.push(raw);
  return found;
}

/**
 * Old document path → the copy Site Import saved. Only copies that finished
 * downloading count; the newest wins when a file was captured more than once.
 */
function buildCopyIndex(importRows, host) {
  const rows = [...(importRows || [])].sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  const index = new Map();
  for (const row of rows) {
    if (String(row.status || '') !== 'downloaded') continue;
    const storage = String(row.storage_url || '').trim();
    if (!/^https:\/\//i.test(storage)) continue;
    const key = documentKey(row.original_url, host);
    if (key && !index.has(key)) index.set(key, storage);
  }
  return index;
}

/** Swap every listed old URL for its new one, anywhere in a value. */
function rewriteValue(node, swaps, stats, depth = 0) {
  if (node == null || depth > 40) return node;
  if (typeof node === 'string') {
    let next = node;
    for (const [oldUrl, newUrl] of swaps) {
      if (next.includes(oldUrl)) {
        stats.swapped += next.split(oldUrl).length - 1;
        next = next.split(oldUrl).join(newUrl);
      }
    }
    return next;
  }
  if (Array.isArray(node)) return node.map((v) => rewriteValue(v, swaps, stats, depth + 1));
  if (typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = rewriteValue(v, swaps, stats, depth + 1);
    return out;
  }
  return node;
}

/**
 * Decide everything without touching anything.
 *
 * `targets` is a list of `{ kind, id, label, column, value }` — one entry per
 * column that may carry links. Returns the swaps, the per-row writes, and the
 * links that have no saved copy.
 */
function planRelink(targets, copyIndex, host) {
  const links = new Map(); // raw link -> { key, copy, rows:Set }
  for (const t of targets) {
    for (const raw of findDocumentLinks(t.value, host)) {
      const key = documentKey(raw, host);
      const entry = links.get(raw) || { raw, key, copy: copyIndex.get(key) || '', rows: new Set() };
      entry.rows.add(`${t.kind} ${t.label}`);
      links.set(raw, entry);
    }
  }

  // Longest first: a bare link is a prefix of its own `?ver=` variant, and
  // swapping the short one first would leave a dangling query on the new one.
  const swaps = [...links.values()]
    .filter((l) => l.copy)
    .map((l) => [l.raw, l.copy])
    .sort((a, b) => b[0].length - a[0].length);

  const writes = [];
  for (const t of targets) {
    const stats = { swapped: 0 };
    const next = rewriteValue(t.value, swaps, stats);
    if (stats.swapped) writes.push({ ...t, next, swapped: stats.swapped });
  }

  const missing = [...links.values()].filter((l) => !l.copy);
  const covered = [...links.values()].filter((l) => l.copy);
  return { links: [...links.values()], covered, missing, swaps, writes };
}

/** Does a saved copy really answer as a file? A page or a 404 does not count. */
async function probeCopy(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    if (type.startsWith('text/html')) return { ok: false, why: 'answered with a web page, not a file' };
    return { ok: true };
  } catch (err) {
    return { ok: false, why: err.message || 'request failed' };
  }
}

function arg(name, fallback = '') {
  const found = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function describeTarget() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  if (!url) return 'no SUPABASE_URL set';
  return `${url} ${/localhost|127\.0\.0\.1/.test(url) ? '(LOCAL database)' : '(CLOUD — the live site)'}`;
}

async function main() {
  try {
    const dotenv = require('dotenv');
    dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
    dotenv.config({ path: path.join(__dirname, '..', '.env') });
  } catch (_) {}
  const { sbQuery, tableConfig } = require('../lib/supabase');

  const projectId = arg('--project');
  const host = arg('--host');
  const apply = process.argv.includes('--apply');
  if (!projectId || !host) {
    console.error('Usage: node scripts/relink_imported_documents.js --project=<projectId> --host=<domain> [--apply]');
    process.exit(1);
  }
  const scope = `project_id=eq.${encodeURIComponent(projectId)}`;
  const tables = tableConfig();

  console.log(`[relink] database: ${describeTarget()}`);
  console.log(`[relink] project ${projectId}, document links on ${host} — ${apply ? 'APPLY' : 'DRY RUN'}`);

  const reads = {
    drafts: { table: tables.builderPages, query: `select=id,slug,layout_sections&${scope}&limit=2000` },
    published: { table: tables.builderPublishedPages, query: `select=id,page_id,slug,payload&${scope}&limit=2000` },
    posts: { table: tables.blogPosts, query: `select=id,slug,status,body,excerpt&${scope}&limit=2000` },
    copies: {
      table: SITE_IMPORT_ASSETS,
      query: `select=original_url,storage_url,status,created_at&${scope}&limit=20000`,
    },
  };
  const data = {};
  for (const [name, spec] of Object.entries(reads)) {
    const res = await sbQuery(spec);
    if (!res.ok) {
      // A table we could not read is a place we could not look — never a clean bill.
      console.error(`[relink] COULD NOT READ ${spec.table}: ${String(res.error).slice(0, 200)}`);
      process.exit(2);
    }
    data[name] = Array.isArray(res.data) ? res.data : [];
  }

  const targets = [
    ...data.drafts.map((r) => ({
      kind: 'draft', table: tables.builderPages, id: r.id, label: r.slug, column: 'layout_sections', value: r.layout_sections,
    })),
    ...data.published.map((r) => ({
      kind: 'published', table: tables.builderPublishedPages, id: r.id, label: r.slug, column: 'payload', value: r.payload,
    })),
    ...data.posts.flatMap((r) => ['body', 'excerpt'].map((column) => ({
      kind: `blog (${r.status || '?'})`, table: tables.blogPosts, id: r.id, label: `${r.slug} ${column}`, column, value: r[column],
    }))),
  ];

  const copyIndex = buildCopyIndex(data.copies, host);
  const plan = planRelink(targets, copyIndex, host);

  console.log(
    `[relink] read ${data.drafts.length} draft(s), ${data.published.length} published copy(ies), ` +
      `${data.posts.length} blog post(s), ${copyIndex.size} saved document copy(ies)`
  );
  console.log(`[relink] ${plan.links.length} distinct old link(s): ${plan.covered.length} have a saved copy, ${plan.missing.length} do not`);

  let unreachable = 0;
  for (const link of plan.covered) {
    const probe = await probeCopy(link.copy);
    if (!probe.ok) {
      unreachable += 1;
      console.log(`[relink] COPY BROKEN ${link.raw}\n           copy ${link.copy} — ${probe.why}`);
    }
  }
  if (unreachable) {
    console.error(`[relink] ${unreachable} saved copy(ies) do not answer as a file; nothing was changed.`);
    process.exit(2);
  }

  for (const w of plan.writes) console.log(`[relink] ${w.kind.padEnd(16)} ${w.label} — ${w.swapped} link(s)`);
  for (const l of plan.missing) {
    console.log(`[relink] NO SAVED COPY ${l.raw} (on: ${[...l.rows].join(', ')})`);
  }

  if (!apply) {
    console.log('[relink] DRY RUN — nothing was changed. Add --apply to rewrite these links.');
    process.exit(plan.missing.length ? 2 : 0);
  }
  if (!plan.writes.length) {
    console.log('[relink] Nothing to rewrite.');
    process.exit(plan.missing.length ? 2 : 0);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(
    BACKUP_DIR,
    `relink_imported_documents_${host.replace(/[^a-z0-9]+/gi, '_')}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(
    backupFile,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        projectId,
        host,
        swaps: plan.swaps,
        rows: plan.writes.map((w) => ({ table: w.table, id: w.id, label: w.label, column: w.column, before: w.value })),
      },
      null,
      2
    )
  );
  console.log(`[relink] backup written: ${path.relative(path.join(__dirname, '..'), backupFile)}`);

  let failed = 0;
  let dirty = 0;
  for (const w of plan.writes) {
    const res = await sbQuery({
      method: 'PATCH',
      table: w.table,
      query: `id=eq.${encodeURIComponent(w.id)}&${scope}`,
      headers: { Prefer: 'return=minimal' },
      body: { [w.column]: w.next },
    });
    if (!res.ok) {
      failed += 1;
      console.error(`[relink] FAILED ${w.kind} ${w.label}: ${String(res.error).slice(0, 200)}`);
      continue;
    }
    // Read back rather than trusting the write.
    const back = await sbQuery({
      table: w.table,
      query: `select=${w.column}&id=eq.${encodeURIComponent(w.id)}&${scope}`,
    });
    const stored = back.ok && Array.isArray(back.data) && back.data[0] ? back.data[0][w.column] : undefined;
    const left = stored === undefined ? null : findDocumentLinks(stored, host).filter((raw) => copyIndex.has(documentKey(raw, host)));
    if (left === null || left.length) {
      dirty += 1;
      console.error(`[relink] DID NOT READ BACK CLEAN ${w.kind} ${w.label}: ${left === null ? 'read-back failed' : `${left.length} old link(s) remain`}`);
    } else {
      console.log(`[relink] ok ${w.kind} ${w.label}`);
    }
  }

  console.log(`[relink] rows written: ${plan.writes.length - failed}, write failures: ${failed}, not clean on read-back: ${dirty}`);
  if (failed || dirty) process.exit(1);
  process.exit(plan.missing.length ? 2 : 0);
}

module.exports = { findDocumentLinks, documentKey, buildCopyIndex, planRelink, rewriteValue };

if (require.main === module) {
  main().catch((err) => {
    console.error('[relink] crashed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
