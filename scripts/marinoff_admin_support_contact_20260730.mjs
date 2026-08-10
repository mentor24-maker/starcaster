#!/usr/bin/env node
'use strict';
/**
 * Marinoff admin Support page — switch the contact details from hand-typed
 * text to the Support Email / Support Phone set in StarCaster under
 * Settings > Projects > Edit. 2026-07-30.
 *
 * WHY
 * The page shipped on 2026-07-30 with a text module holding placeholder
 * contact details (support@alphire.com, "add your support number here").
 * The admin-support-form module now renders the contact block itself from the
 * project's platform settings, so that text module is redundant — and worse,
 * it would sit there showing stale placeholder details forever.
 *
 * WHAT THIS DOES
 * 1. Removes the placeholder text module from the `admin-support` page.
 * 2. Sets showContact / contactHeading / contactIntro on the
 *    admin-support-form module so the generated block reads the way the text
 *    module used to.
 * 3. Drops the orphaned `supportAlertEmail` key from every project's
 *    site_settings. That setting was a third support address that duplicated
 *    contactAlertEmail; it has been removed from the code, and support
 *    requests are now delivered to supportEmail instead. Leaving the value in
 *    the blob would be a lie about where mail goes.
 *
 * The page is NOT a canonical saved section, so there is no master to keep in
 * step — this touches one page only.
 *
 * SAFETY
 * - Dry run by default; pass --apply to write.
 * - Backs the page up to docs/SQL/backups/ before any change.
 * - Idempotent: re-running after a successful apply reports no changes.
 * - Removes the module by ID, and only if it is a `text` module still carrying
 *   the placeholder marker — so it cannot delete real content Dane has since
 *   typed into that block.
 *
 * Usage:
 *   node scripts/marinoff_admin_support_contact_20260730.mjs           # dry run
 *   node scripts/marinoff_admin_support_contact_20260730.mjs --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = require('@supabase/supabase-js');

const PROJECT_ID = 'proj_1780601274760_97i84r';
const PAGES_TABLE = 'builder_landing_page';
const SLUG = 'admin-support';

const CONTACT_TEXT_MODULE_ID = 'module_20260729_supportcontact';
/** Only delete the text module if it still looks like the shipped placeholder. */
const PLACEHOLDER_MARKERS = ['add your support number here', 'support@alphire.com'];

const CONTACT_HEADING = 'Need a hand with your website?';
const CONTACT_INTRO = 'Use the form below and it comes straight to us, along with anything you attach. '
  + 'For anything urgent, reach out directly:';

const APPLY = process.argv.includes('--apply');
const ALLOW_LOCAL = process.argv.includes('--allow-local');
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

const MAIN_CHECKOUT = '/Users/mentor/WebApps/starcaster';
const ENV_CANDIDATES = [
  process.env.STARCASTER_ENV_FILE,
  path.join(ROOT, '.env.local.cloud-backup'),
  path.join(MAIN_CHECKOUT, '.env.local.cloud-backup'),
  path.join(ROOT, '.env.local'),
  path.join(MAIN_CHECKOUT, '.env.local'),
].filter(Boolean);

function loadEnv(file) {
  const env = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

let env = null;
let ENV_FILE = '';
for (const candidate of ENV_CANDIDATES) {
  try {
    const parsed = loadEnv(candidate);
    if (parsed.SUPABASE_URL && (parsed.SUPABASE_SERVICE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY)) {
      env = parsed;
      ENV_FILE = candidate;
      break;
    }
  } catch { /* try the next candidate */ }
}
if (!env) {
  console.error('Could not find SUPABASE_URL + SUPABASE_SERVICE_KEY in any of:');
  for (const c of ENV_CANDIDATES) console.error(`  ${c}`);
  process.exit(1);
}

const SUPABASE_URL = env.SUPABASE_URL;
const isLocalDb = /localhost|127\.0\.0\.1/.test(SUPABASE_URL);
const sb = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log(`Mode:     ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
console.log(`Env file: ${ENV_FILE}`);
console.log(`Database: ${SUPABASE_URL}${isLocalDb ? '  ← LOCAL DEV DATABASE' : '  (cloud)'}`);
console.log(`Project:  ${PROJECT_ID}\n`);

if (APPLY && isLocalDb && !ALLOW_LOCAL) {
  console.error('Refusing to --apply against a local database: the live Marinoff site reads the');
  console.error('cloud one. Pass --allow-local if you really mean to seed your local copy.');
  process.exit(1);
}

// ---------------------------------------------------------------------------

const { data: rows, error } = await sb
  .from(PAGES_TABLE)
  .select('*')
  .eq('project_id', PROJECT_ID)
  .eq('slug', SLUG);
if (error) { console.error('Failed to read the page:', error); process.exit(1); }

const page = (rows || [])[0] || null;
if (!page) { console.error(`Page "${SLUG}" not found — run the page script first.`); process.exit(1); }

mkdirSync(BACKUP_DIR, { recursive: true });
const backupPath = path.join(BACKUP_DIR, `marinoff_admin_support_contact_20260730_backup.json`);
writeFileSync(backupPath, JSON.stringify({ capturedFor: 'marinoff_admin_support_contact_20260730', page }, null, 2));
console.log(`Backup: ${path.relative(ROOT, backupPath)}\n`);

const doc = page.layout_sections || {};
const sections = Array.isArray(doc.sections) ? doc.sections : [];

let removedText = 0;
let skippedText = 0;
let updatedForm = 0;

const nextSections = sections.map((section) => {
  const modules = Array.isArray(section?.modules) ? section.modules : [];
  if (!modules.length) return section;

  const kept = [];
  for (const m of modules) {
    if (m?.id === CONTACT_TEXT_MODULE_ID && m?.type === 'text') {
      const html = String(m?.text || '').toLowerCase();
      const looksLikePlaceholder = PLACEHOLDER_MARKERS.some((marker) => html.includes(marker));
      if (looksLikePlaceholder) {
        removedText += 1;
        continue;   // drop it
      }
      // Someone has edited this block into real content — leave it alone and
      // say so, rather than silently deleting Dane's writing.
      skippedText += 1;
      console.log(`  ! Keeping ${CONTACT_TEXT_MODULE_ID}: it no longer looks like the placeholder.`);
      console.log('    Delete it by hand in the Builder if the generated block replaces it.');
    }
    kept.push(m);
  }

  const withForm = kept.map((m) => {
    if (m?.type !== 'admin-support-form') return m;
    const s = m.settings || {};
    if (s.showContact === 'true' && s.contactHeading === CONTACT_HEADING && s.contactIntro === CONTACT_INTRO) {
      return m;
    }
    updatedForm += 1;
    return {
      ...m,
      settings: {
        ...s,
        showContact: 'true',
        contactHeading: CONTACT_HEADING,
        contactIntro: CONTACT_INTRO,
      },
    };
  });

  return { ...section, modules: withForm };
});

// ---------------------------------------------------------------------------
// Orphaned supportAlertEmail values
// ---------------------------------------------------------------------------

const { data: projectRows, error: projectErr } = await sb
  .from('app_projects')
  .select('id,name,site_settings')
  .not('site_settings', 'is', null);
if (projectErr) { console.error('Failed to read projects:', projectErr); process.exit(1); }

const staleProjects = (projectRows || []).filter((r) => (
  r.site_settings && typeof r.site_settings === 'object'
  && Object.prototype.hasOwnProperty.call(r.site_settings, 'supportAlertEmail')
));

console.log('── Plan ─────────────────────────────────────────────────────────');
console.log(`  Remove placeholder text module: ${removedText ? 'yes' : (skippedText ? 'NO (edited)' : 'already gone')}`);
console.log(`  Set contact settings on the form module: ${updatedForm ? 'yes' : 'already correct'}`);
console.log(`    heading: "${CONTACT_HEADING}"`);
console.log(`    intro:   "${CONTACT_INTRO}"`);
console.log('  Email + phone are read live from Settings > Projects > Edit.');
console.log(`  Drop orphaned supportAlertEmail: ${staleProjects.length} project(s)`);
for (const r of staleProjects) {
  console.log(`    ${r.name}: "${r.site_settings.supportAlertEmail}" -> removed`);
}

if (!removedText && !updatedForm && !staleProjects.length) {
  console.log('\nNothing to do.');
  process.exit(0);
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to make these changes.');
  process.exit(0);
}

console.log('\nApplying…');
if (removedText || updatedForm) {
  const { error: writeErr } = await sb.from(PAGES_TABLE)
    .update({ layout_sections: { ...doc, sections: nextSections } })
    .eq('id', page.id);
  if (writeErr) { console.error('  FAILED:', writeErr); process.exit(1); }
  console.log(`  Updated ${SLUG} (id ${page.id})`);
}

for (const r of staleProjects) {
  const { supportAlertEmail, ...rest } = r.site_settings;
  const { error: sErr } = await sb.from('app_projects')
    .update({ site_settings: rest })
    .eq('id', r.id);
  if (sErr) { console.error(`  FAILED to clean ${r.name}:`, sErr); process.exit(1); }
  console.log(`  Cleaned supportAlertEmail from ${r.name}`);
}

// Verify — re-read, never trust the write.
console.log('\nVerifying by re-reading the row…');
const { data: after, error: afterErr } = await sb
  .from(PAGES_TABLE)
  .select('slug,layout_sections')
  .eq('id', page.id);
if (afterErr) { console.error('  Verification read failed:', afterErr); process.exit(1); }

const afterModules = (after?.[0]?.layout_sections?.sections || []).flatMap((s) => s.modules || []);
const stillHasText = afterModules.some((m) => m?.id === CONTACT_TEXT_MODULE_ID);
const form = afterModules.find((m) => m?.type === 'admin-support-form');

let problems = 0;
console.log(`  placeholder text module present: ${stillHasText ? (skippedText ? 'yes (kept on purpose)' : 'YES — NOT REMOVED') : 'no'}`);
if (stillHasText && !skippedText) problems += 1;

// A form module that came back as "text" means the deployed server bundle does
// not know the type — i.e. `npm run build:builder-template` was skipped.
console.log(`  admin-support-form module: ${form ? 'present' : 'MISSING'}`);
if (!form) {
  console.log('    ! If it came back as "text", the server template bundle does not know');
  console.log('      "admin-support-form" — run `npm run build:builder-template` and redeploy.');
  problems += 1;
} else {
  console.log(`    showContact=${form.settings?.showContact} heading="${form.settings?.contactHeading}"`);
  if (form.settings?.showContact !== 'true') problems += 1;
}

const { data: projectsAfter } = await sb
  .from('app_projects')
  .select('id,name,site_settings')
  .not('site_settings', 'is', null);
const stillStale = (projectsAfter || []).filter((r) => (
  r.site_settings && Object.prototype.hasOwnProperty.call(r.site_settings, 'supportAlertEmail')
));
console.log(`  projects still carrying supportAlertEmail: ${stillStale.length ? stillStale.map((r) => r.name).join(', ') : 'none'}`);
if (stillStale.length) problems += 1;

const marinoff = (projectsAfter || []).find((r) => r.id === PROJECT_ID);
if (marinoff) {
  console.log(`  Marinoff site_settings now: ${JSON.stringify(marinoff.site_settings)}`);
}

console.log(problems
  ? `\nDone with ${problems} problem(s) — see above. Backup: ${path.relative(ROOT, backupPath)}`
  : '\nDone. All checks passed.');
process.exit(problems ? 1 : 0);
