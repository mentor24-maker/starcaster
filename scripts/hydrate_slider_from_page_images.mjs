#!/usr/bin/env node
'use strict';
/**
 * Fill a slider / slideshow / carousel module with the images already on
 * its own page — the "I dropped the module in, now give it the pictures"
 * step. Built 2026-08-06 to hydrate the Card Slider Dane added to the
 * scratch project's /home so it can be compared with the new slideshow
 * module (ClickUp 86bba1dzz).
 *
 * WHY IMAGES FROM THE PAGE: the imported hero photos already live on the
 * page as image modules carrying durable SiteImportApplied/<project>/
 * URLs. Reading them from the live page needs no IR fetch, no asset
 * lookup, and can't reference a transient job namespace.
 *
 * WHAT IT DOES
 *   Finds the target page, collects image-module URLs in document order
 *   (deduplicated, preserving first appearance), and writes them into the
 *   chosen module's items setting:
 *     carousel → items [{id,title,body,imageUrl,imageAlt,linkUrl,...}]
 *   Both formats share one collection since the 2026-08-16 merge, so the
 *   module's `format` no longer changes what gets written. Other module
 *   types are refused rather than guessed at.
 *
 * SAFETY (house one-off conventions)
 * - Dry run by default; --apply writes.
 * - JSON backup of the whole page to docs/SQL/backups/ before any write.
 * - Idempotent: re-running with the same images reports "no change".
 * - Never publishes, never touches other sections or modules.
 * - Refuses a localhost database unless --allow-local.
 *
 * USAGE
 *   doppler run --config prd -- node scripts/hydrate_slider_from_page_images.mjs \
 *     --project <projectId> --slug home                    # dry run, auto-picks the module
 *   ... --module <moduleId>     target one module explicitly (when the page has several)
 *   ... --limit 13              cap how many images become slides
 *   ... --apply
 */

import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

const MAIN_CHECKOUT = '/Users/mentor/WebApps/starcaster';
const ENV_CANDIDATES = [
  process.env.STARCASTER_ENV_FILE,
  path.join(ROOT, '.env.local.cloud-backup'),
  path.join(MAIN_CHECKOUT, '.env.local.cloud-backup'),
  path.join(ROOT, '.env.local'),
  path.join(MAIN_CHECKOUT, '.env.local'),
].filter(Boolean);

if (!process.env.SUPABASE_URL) {
  for (const candidate of ENV_CANDIDATES) {
    try {
      const parsed = {};
      for (const line of readFileSync(candidate, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) parsed[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      if (parsed.SUPABASE_URL) {
        for (const [k, v] of Object.entries(parsed)) if (!process.env[k]) process.env[k] = v;
        break;
      }
    } catch { /* next */ }
  }
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) { console.error(`${name} requires a value.`); process.exit(1); }
  return v;
};

if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('No Supabase credentials. Run through Doppler:');
  console.error('  doppler run --config prd -- node scripts/hydrate_slider_from_page_images.mjs --project <id> --slug home');
  process.exit(1);
}
if (/localhost|127\.0\.0\.1/.test(process.env.SUPABASE_URL) && !flag('--allow-local')) {
  console.error('Refusing a localhost database (--allow-local overrides).');
  process.exit(1);
}

const pagesStore = require('./lib/builderPagesStore.js');

const APPLY = flag('--apply');
const PROJECT_ID = flagValue('--project');
const SLUG = flagValue('--slug') || 'home';
const MODULE_ID = flagValue('--module');
const LIMIT = Math.max(1, Number(flagValue('--limit')) || 50);
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

/** Module types this script knows how to fill, and how. */
const FILLABLE = {
  carousel: {
    settingsKey: 'items',
    build: (urls) => urls.map((url, i) => ({
      id: `item-${i + 1}`, title: '', body: '', imageUrl: url, imageAlt: '',
      linkUrl: '', linkLabel: '', icon: '', iconImageUrl: '',
    })),
  },
};

function must(res, what) {
  if (!res || res.ok === false) throw new Error(`${what}: ${res?.error || `status ${res?.status}`}`);
  return res.data;
}

async function main() {
  if (!PROJECT_ID) {
    console.error('Usage: ... --project <projectId> [--slug home] [--module <moduleId>] [--limit N] [--apply]');
    process.exit(1);
  }
  const scope = { projectId: PROJECT_ID, userId: '' };
  console.log(`Mode:    ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  console.log(`Project: ${PROJECT_ID}   Page slug: ${SLUG}`);

  const pages = must(await pagesStore.listPages(5000, scope), 'list pages');
  const page = pages.find((p) => String(p.slug || '') === SLUG);
  if (!page) throw new Error(`No page with slug "${SLUG}" in this project.`);
  const sections = Array.isArray(page.layoutSections) ? page.layoutSections : [];

  // Collect image URLs in document order, first appearance wins.
  const urls = [];
  const seen = new Set();
  for (const section of sections) {
    for (const module of section.modules || []) {
      if (module.type !== 'image') continue;
      const url = String(module.settings?.url || '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
  console.log(`Found ${urls.length} unique image module URL(s) on the page.`);
  if (!urls.length) throw new Error('No image modules on this page to hydrate from.');

  // Pick the target module.
  const candidates = [];
  for (const section of sections) {
    for (const module of section.modules || []) {
      if (!FILLABLE[module.type]) continue;
      if (MODULE_ID && module.id !== MODULE_ID) continue;
      candidates.push({ section, module });
    }
  }
  if (!candidates.length) {
    throw new Error(MODULE_ID
      ? `Module ${MODULE_ID} not found on this page, or its type is not fillable (${Object.keys(FILLABLE).join(', ')}).`
      : `No slider/slideshow module found on "${SLUG}". Add one in Builder first, or pass --module <id>.`);
  }
  if (candidates.length > 1 && !MODULE_ID) {
    console.log('Multiple fillable modules found — pass --module <id> to choose:');
    for (const c of candidates) {
      console.log(`  ${c.module.id}  (${c.module.type})  in section "${c.section.title || c.section.id}"`);
    }
    process.exit(1);
  }
  const { section, module } = candidates[0];
  const plan = FILLABLE[module.type];
  const slides = plan.build(urls.slice(0, LIMIT));
  const nextValue = JSON.stringify(slides);
  console.log(`Target:  ${module.type} module ${module.id} in section "${section.title || section.id}"`);
  console.log(`Writing ${slides.length} slide(s) into settings.${plan.settingsKey}.`);
  for (const [i, url] of urls.slice(0, LIMIT).entries()) {
    console.log(`  ${String(i + 1).padStart(2)}. ${url.split('/').pop()}`);
  }

  if (String(module.settings?.[plan.settingsKey] || '') === nextValue) {
    console.log('\nNo change — the module already holds exactly these slides.');
    return;
  }
  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write.');
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `hydrate_slider_${PROJECT_ID}_${SLUG}_${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ projectId: PROJECT_ID, page }, null, 2));
  console.log(`Backup: ${path.relative(ROOT, backupPath)}`);

  const nextSections = sections.map((s) => (s.id !== section.id ? s : {
    ...s,
    modules: (s.modules || []).map((m) => (m.id !== module.id ? m : {
      ...m,
      settings: { ...m.settings, [plan.settingsKey]: nextValue },
    })),
  }));
  must(await pagesStore.updatePage(page.id, { ...page, layoutSections: nextSections }, scope), 'update page');
  console.log(`\nDone: ${module.type} module ${module.id} hydrated with ${slides.length} slide(s).`);
  console.log(`Rollback: ${path.relative(ROOT, backupPath)}`);
}

main().catch((err) => {
  console.error('\nHYDRATE FAILED:', err.message || err);
  process.exit(1);
});
