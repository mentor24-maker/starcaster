#!/usr/bin/env node
'use strict';
/**
 * Turn an imported slideshow module back into the plain image modules it
 * replaced — the undo for a wrong intent-guess.
 *
 * WHY THIS CAN EXIST: slideshow detection consolidates a run of images,
 * but "these images are a slideshow" is an inference. Some pages really
 * do want a series of pictures (a gallery, a logo wall, a staff grid).
 * Nothing is destroyed when the guess is wrong — the slideshow module
 * carries its slides in order — so the images can always be restored.
 * (Prevention lives on the mapper: --no-slideshow [pagePath].)
 *
 * WHAT IT RESTORES: one image module per slide, in slide order, in the
 * slideshow's position in its section. Duplicate copies the importer
 * deduped away are NOT restored — they were byte-identical repeats of
 * slides (a lazy-load artifact), and bringing them back would recreate
 * the "slideshow followed by 15 identical photos" problem this whole
 * feature exists to avoid.
 *
 * SAFETY (house one-off conventions)
 * - Dry run by default; --apply writes.
 * - Full JSON page backup to docs/SQL/backups/ before any write.
 * - Idempotent: a page with no slideshow reports nothing to do.
 * - Never publishes; touches only the target page.
 * - Refuses a localhost database unless --allow-local.
 *
 * USAGE
 *   doppler run --config prd -- node scripts/site_import_revert_slideshow.mjs \
 *     --project <projectId> --slug home            # dry run
 *   ... --module <moduleId>    when a page holds more than one slideshow
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
  console.error('  doppler run --config prd -- node scripts/site_import_revert_slideshow.mjs --project <id> --slug home');
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
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

function must(res, what) {
  if (!res || res.ok === false) throw new Error(`${what}: ${res?.error || `status ${res?.status}`}`);
  return res.data;
}

async function main() {
  if (!PROJECT_ID) {
    console.error('Usage: ... --project <projectId> [--slug home] [--module <moduleId>] [--apply]');
    process.exit(1);
  }
  const scope = { projectId: PROJECT_ID, userId: '' };
  console.log(`Mode:    ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  console.log(`Project: ${PROJECT_ID}   Page slug: ${SLUG}`);

  const pages = must(await pagesStore.listPages(5000, scope), 'list pages');
  const page = pages.find((p) => String(p.slug || '') === SLUG);
  if (!page) throw new Error(`No page with slug "${SLUG}" in this project.`);
  const sections = Array.isArray(page.layoutSections) ? page.layoutSections : [];

  const targets = [];
  for (const section of sections) {
    for (const module of section.modules || []) {
      if (module.type !== 'slideshow') continue;
      if (MODULE_ID && module.id !== MODULE_ID) continue;
      targets.push({ section, module });
    }
  }
  if (!targets.length) {
    console.log(`\nNothing to do — no slideshow module on "${SLUG}"${MODULE_ID ? ` matching ${MODULE_ID}` : ''}.`);
    return;
  }
  if (targets.length > 1 && !MODULE_ID) {
    console.log('Multiple slideshows found — pass --module <id> to choose:');
    for (const t of targets) {
      console.log(`  ${t.module.id}  in section "${t.section.title || t.section.id}"`);
    }
    process.exit(1);
  }

  const { section, module } = targets[0];
  let slides = [];
  try {
    slides = JSON.parse(module.settings?.slides || '[]');
  } catch {
    throw new Error(`Slideshow ${module.id} has unreadable slides JSON — cannot safely revert.`);
  }
  slides = slides.filter((s) => s && String(s.url || '').trim());
  if (!slides.length) throw new Error(`Slideshow ${module.id} has no slides to restore.`);

  console.log(`Target:  slideshow ${module.id} in section "${section.title || section.id}"`);
  console.log(`Restoring ${slides.length} image module(s) in slide order:`);
  for (const [i, s] of slides.entries()) {
    console.log(`  ${String(i + 1).padStart(2)}. ${String(s.url).split('/').pop()}`);
  }
  console.log('(Deduped duplicate copies are not restored — they were repeats of these same photos.)');

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write.');
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `revert_slideshow_${PROJECT_ID}_${SLUG}_${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ projectId: PROJECT_ID, page }, null, 2));
  console.log(`Backup: ${path.relative(ROOT, backupPath)}`);

  const restored = slides.map((slide, i) => ({
    id: `${module.id}-img-${i + 1}`,
    type: 'image',
    column: module.column || 'main',
    name: 'Imported image',
    text: '',
    settings: {
      url: String(slide.url),
      alt: String(slide.alt || ''),
      // Provenance is preserved so a later re-map can still recognise
      // these as import-owned content.
      ...(module.settings?.importSourceIds ? { importSourceIds: module.settings.importSourceIds } : {}),
      ...(module.settings?.importSectionSourceId
        ? { importSectionSourceId: module.settings.importSectionSourceId }
        : {}),
    },
  }));

  const nextSections = sections.map((s) => {
    if (s.id !== section.id) return s;
    const nextModules = [];
    for (const m of s.modules || []) {
      if (m.id === module.id) nextModules.push(...restored);
      else nextModules.push(m);
    }
    return { ...s, modules: nextModules };
  });

  must(await pagesStore.updatePage(page.id, { ...page, layoutSections: nextSections }, scope), 'update page');
  console.log(`\nDone: slideshow ${module.id} replaced by ${restored.length} image module(s).`);
  console.log(`Rollback: ${path.relative(ROOT, backupPath)}`);
  console.log(`Keep it this way on re-import: --no-slideshow <pagePath> on the mapper.`);
}

main().catch((err) => {
  console.error('\nREVERT FAILED:', err.message || err);
  process.exit(1);
});
