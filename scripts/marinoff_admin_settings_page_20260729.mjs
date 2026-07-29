#!/usr/bin/env node
'use strict';
/**
 * Marinoff admin back-end — add a Settings page and menu item. 2026-07-29.
 *
 * WHAT THIS DOES
 * 1. Creates the page `admin-settings` ("Admin: Settings") holding one
 *    admin-site-settings module (the Contact Alert Email field). Its header,
 *    footer and copyright sections are canonical instances of the same saved
 *    sections the other admin pages use, so it inherits their look and any
 *    future header edits.
 * 2. Adds a "Settings" item to the admin Main Menu — on all four admin pages
 *    AND on the "Admin Header" saved-section master. The master matters: the
 *    header is a canonical/linked section, so the next time anyone saves that
 *    master it overwrites every page's copy. Updating only the pages would
 *    make the new menu item vanish on the next header edit.
 *
 * SLUG PRIVACY: `admin-settings` starts with "admin-", which
 * lib/builder-client/public-site-page-slugs.js treats as private — the page
 * requires project-admin login and stays out of GET /api/public/pages. No
 * code change needed for that; is_private is also set explicitly.
 *
 * SAFETY
 * - Dry run by default; pass --apply to write.
 * - Writes a full JSON backup of every touched page + the saved-section
 *   master to docs/SQL/backups/ before any change.
 * - Idempotent: re-running neither duplicates the page nor the menu item.
 * - Does NOT trigger canonical propagation. It edits the master's stored JSON
 *   and each linked instance directly, in one pass, to the same value — it
 *   never calls the push endpoint that rewrites all linked pages.
 *
 * Usage:
 *   node scripts/marinoff_admin_settings_page_20260729.mjs            # dry run
 *   node scripts/marinoff_admin_settings_page_20260729.mjs --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = require('@supabase/supabase-js');

const PROJECT_ID = 'proj_1780601274760_97i84r';   // Marinoff & Associates
const PAGES_TABLE = 'builder_landing_page';
const SAVED_SECTIONS_TABLE = 'builder_saved_sections';
const HEADER_MASTER_ID = 'saved_section_1782534344813_j7kkz2';   // "Admin Header"

const SOURCE_SLUG = 'admin-contact-manager';   // page whose chrome we mirror
const NEW_SLUG = 'admin-settings';
const NEW_NAME = 'Admin: Settings';

const NAV_ITEM = Object.freeze({
  id: 'nav-20260729-admin-settings',
  label: 'Settings',
  href: 'admin-settings',
});
/** Insert the new item directly after this existing one. */
const NAV_ITEM_AFTER_HREF = 'admin-contact-manager';

const APPLY = process.argv.includes('--apply');
const ALLOW_LOCAL = process.argv.includes('--allow-local');
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

// Env files are gitignored, so a git worktree does not have them — fall back to
// the main checkout. Prefer the cloud-backup file: plain .env.local currently
// carries BOTH a cloud and a local SUPABASE_URL, and the last one wins, so
// reading it would quietly point this at the local dev database.
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
  console.error('Set STARCASTER_ENV_FILE to point at the right file.');
  process.exit(1);
}

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const isLocalDb = /localhost|127\.0\.0\.1/.test(SUPABASE_URL);

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

console.log(`Mode:     ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
console.log(`Env file: ${ENV_FILE}`);
console.log(`Database: ${SUPABASE_URL}${isLocalDb ? '  ← LOCAL DEV DATABASE' : '  (cloud)'}`);
console.log(`Project:  ${PROJECT_ID}\n`);

// The live Marinoff site reads the cloud database. Applying to localhost would
// silently do nothing useful, so make that mistake impossible to make quietly.
if (APPLY && isLocalDb && !ALLOW_LOCAL) {
  console.error('Refusing to --apply against a local database: the live Marinoff site reads the');
  console.error('cloud one, so this would change nothing that anybody can see.');
  console.error('Pass --allow-local if you really mean to seed your local copy.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const { data: pageRows, error: pageErr } = await sb
  .from(PAGES_TABLE)
  .select('*')
  .eq('project_id', PROJECT_ID);
if (pageErr) { console.error('Failed to read pages:', pageErr); process.exit(1); }

const { data: masterRows, error: masterErr } = await sb
  .from(SAVED_SECTIONS_TABLE)
  .select('*')
  .eq('id', HEADER_MASTER_ID);
if (masterErr) { console.error('Failed to read saved section master:', masterErr); process.exit(1); }
const masterRow = (masterRows || [])[0] || null;
if (!masterRow) {
  console.error(`Header saved-section master ${HEADER_MASTER_ID} not found — aborting.`);
  process.exit(1);
}

const sourcePage = pageRows.find((p) => p.slug === SOURCE_SLUG);
if (!sourcePage) { console.error(`Source page "${SOURCE_SLUG}" not found — aborting.`); process.exit(1); }

const existingSettingsPage = pageRows.find((p) => p.slug === NEW_SLUG) || null;

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

const stamp = '20260729';
mkdirSync(BACKUP_DIR, { recursive: true });
const backupPath = path.join(BACKUP_DIR, `marinoff_admin_settings_${stamp}_backup.json`);
writeFileSync(backupPath, JSON.stringify({
  capturedFor: 'marinoff_admin_settings_page_20260729',
  projectId: PROJECT_ID,
  pages: pageRows,
  headerMaster: masterRow,
}, null, 2));
console.log(`Backup of ${pageRows.length} page(s) + header master: ${path.relative(ROOT, backupPath)}\n`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sectionsOf(doc) {
  if (!doc || typeof doc !== 'object') return [];
  return Array.isArray(doc.sections) ? doc.sections : [];
}

function parseNavItems(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;   // unparseable — caller must skip rather than clobber
  }
}

/**
 * Return an updated navItems JSON string with the Settings item present, or
 * null when nothing needs to change / the value could not be parsed.
 */
function withSettingsNavItem(rawNavItems) {
  const items = parseNavItems(rawNavItems);
  if (items === null) return { error: 'navItems is not valid JSON' };
  if (items.some((i) => String(i?.href || '') === NAV_ITEM.href || String(i?.id || '') === NAV_ITEM.id)) {
    return { unchanged: true };
  }
  const next = [...items];
  const anchor = next.findIndex((i) => String(i?.href || '') === NAV_ITEM_AFTER_HREF);
  // Top-level items only: a child (one with parentId) must not end up between
  // a parent and its own children, so fall back to appending.
  if (anchor >= 0) next.splice(anchor + 1, 0, { ...NAV_ITEM });
  else next.push({ ...NAV_ITEM });
  return { value: JSON.stringify(next) };
}

/** Patch every navigation module inside a sections array. Mutates a copy. */
function addNavItemToSections(sections, label) {
  let changed = 0;
  const out = sections.map((section) => {
    const modules = Array.isArray(section?.modules) ? section.modules : [];
    if (!modules.some((m) => m?.type === 'navigation')) return section;
    const nextModules = modules.map((m) => {
      if (m?.type !== 'navigation') return m;
      const result = withSettingsNavItem(m?.settings?.navItems);
      if (result.error) {
        console.log(`    ! ${label}: nav module ${m.id} skipped — ${result.error}`);
        return m;
      }
      if (result.unchanged) return m;
      changed += 1;
      return { ...m, settings: { ...m.settings, navItems: result.value } };
    });
    return { ...section, modules: nextModules };
  });
  return { sections: out, changed };
}

// ---------------------------------------------------------------------------
// Step 1 — build the new Settings page document
// ---------------------------------------------------------------------------

const sourceDoc = sourcePage.layout_sections || {};
const sourceSections = sectionsOf(sourceDoc);
if (!sourceSections.length) { console.error('Source page has no sections — aborting.'); process.exit(1); }

// Chrome = the canonical (saved-section-linked) sections. Keep savedSectionId
// and canonical:true so this page joins the linked set; only the instance id is
// new, matching the shape the existing admin pages already have.
const chromeSections = sourceSections.filter((s) => s?.savedSectionId && s?.canonical === true);
const headerSection = chromeSections.find((s) => s.savedSectionId === HEADER_MASTER_ID) || null;
const trailingChrome = chromeSections.filter((s) => s.savedSectionId !== HEADER_MASTER_ID);

if (!headerSection) { console.error('Could not find the admin header section on the source page — aborting.'); process.exit(1); }

const contentSection = {
  id: randomUUID(),
  title: 'Site Settings',
  layout: 'single',
  locked: false,
  isPrivate: false,
  alignment: 'left',
  marginTop: 0,
  marginBottom: 0,
  widthMode: 'contained',
  widthPercent: 100,
  mobileHidden: false,
  desktopHidden: false,
  modules: [
    {
      id: `module_${stamp}_adminsitesettings`,
      type: 'admin-site-settings',
      column: 'main',
      name: 'Site Settings',
      text: '',
      settings: {
        panelTitle: 'Site Settings',
        showTitle: 'true',
        verticalMargin: '0',
        mobileHidden: 'false',
        desktopHidden: 'false',
      },
    },
  ],
};

const newDoc = {
  ...sourceDoc,
  sections: [
    { ...headerSection, id: randomUUID() },
    contentSection,
    ...trailingChrome.map((s) => ({ ...s, id: randomUUID() })),
  ],
};

// Apply the nav item to the brand-new page too, so it ships correct.
const newDocWithNav = { ...newDoc, sections: addNavItemToSections(newDoc.sections, NEW_SLUG).sections };

const newPageRow = {
  project_id: PROJECT_ID,
  owner_user_id: sourcePage.owner_user_id,
  name: NEW_NAME,
  slug: NEW_SLUG,
  template_id: sourcePage.template_id,
  template_kind: sourcePage.template_kind || 'modular',
  theme_id: sourcePage.theme_id,
  layout_sections: newDocWithNav,
  content_overrides: {},
  is_published: true,
  is_private: true,
};

console.log('── Step 1: Settings page ────────────────────────────────────────');
if (existingSettingsPage) {
  console.log(`  Page "${NEW_SLUG}" already exists (id ${existingSettingsPage.id}) — leaving its content alone.`);
} else {
  console.log(`  CREATE page "${NEW_SLUG}" (${NEW_NAME})`);
  console.log(`    sections: ${newDocWithNav.sections.map((s) => s.title || '(untitled)').join(' | ')}`);
  console.log(`    content module: admin-site-settings`);
  console.log(`    is_published=true  is_private=true (login-gated by the admin- slug rule)`);
}

// ---------------------------------------------------------------------------
// Step 2 — nav item on the header master
// ---------------------------------------------------------------------------

console.log('\n── Step 2: "Settings" menu item ─────────────────────────────────');

const masterDataKey = ['section', 'data', 'payload', 'content'].find(
  (k) => masterRow[k] && typeof masterRow[k] === 'object'
);
let masterUpdate = null;
if (!masterDataKey) {
  console.log(`  ! Could not find the section JSON on the master row.`);
  console.log(`    Columns present: ${Object.keys(masterRow).join(', ')}`);
  console.log(`    NOT updating the master — the menu item would be lost on the next header save.`);
} else {
  const masterSection = masterRow[masterDataKey];
  const result = addNavItemToSections([masterSection], `master(${masterDataKey})`);
  if (result.changed) {
    masterUpdate = { [masterDataKey]: result.sections[0] };
    console.log(`  UPDATE "Admin Header" master (${HEADER_MASTER_ID}) — adds Settings to its Main Menu`);
  } else {
    console.log(`  Master already has the Settings item — no change.`);
  }
}

// ---------------------------------------------------------------------------
// Step 3 — nav item on every existing admin page
// ---------------------------------------------------------------------------

const pageUpdates = [];
for (const page of pageRows) {
  const slug = String(page.slug || '');
  const sections = sectionsOf(page.layout_sections);
  const hasAdminNav = sections.some((s) => (s.modules || []).some(
    (m) => m?.type === 'navigation'
      && String(m?.settings?.navItems || '').includes('admin-dashboard')
  ));
  if (!hasAdminNav) continue;

  const result = addNavItemToSections(sections, slug);
  if (!result.changed) {
    console.log(`  ${slug}: already has Settings — no change.`);
    continue;
  }
  pageUpdates.push({
    id: page.id,
    slug,
    layout_sections: { ...page.layout_sections, sections: result.sections },
    navModules: result.changed,
  });
  console.log(`  UPDATE ${slug} — ${result.changed} nav module(s) gain the Settings item`);
}

if (!pageUpdates.length) console.log('  (no existing page needed a nav change)');

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

console.log('\n── Summary ──────────────────────────────────────────────────────');
console.log(`  New page:        ${existingSettingsPage ? 'skip (exists)' : '1 insert'}`);
console.log(`  Header master:   ${masterUpdate ? '1 update' : 'no change'}`);
console.log(`  Admin pages:     ${pageUpdates.length} update(s)`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to make these changes.');
  process.exit(0);
}

console.log('\nApplying…');

if (!existingSettingsPage) {
  const { data: inserted, error } = await sb.from(PAGES_TABLE).insert(newPageRow).select('id,slug');
  if (error) { console.error('  FAILED to insert the Settings page:', error); process.exit(1); }
  console.log(`  Created page ${inserted?.[0]?.slug} (id ${inserted?.[0]?.id})`);
}

if (masterUpdate) {
  const { error } = await sb.from(SAVED_SECTIONS_TABLE).update(masterUpdate).eq('id', HEADER_MASTER_ID);
  if (error) { console.error('  FAILED to update the header master:', error); process.exit(1); }
  console.log(`  Updated header master ${HEADER_MASTER_ID}`);
}

for (const u of pageUpdates) {
  const { error } = await sb.from(PAGES_TABLE)
    .update({ layout_sections: u.layout_sections })
    .eq('id', u.id);
  if (error) { console.error(`  FAILED to update ${u.slug}:`, error); process.exit(1); }
  console.log(`  Updated ${u.slug}`);
}

// ---------------------------------------------------------------------------
// Verify — re-read, never trust the write
// ---------------------------------------------------------------------------

console.log('\nVerifying by re-reading the rows…');
const { data: after, error: afterErr } = await sb
  .from(PAGES_TABLE)
  .select('slug,is_published,is_private,layout_sections')
  .eq('project_id', PROJECT_ID);
if (afterErr) { console.error('  Verification read failed:', afterErr); process.exit(1); }

let problems = 0;
const settingsPage = after.find((p) => p.slug === NEW_SLUG);
if (!settingsPage) { console.log(`  MISSING: ${NEW_SLUG}`); problems += 1; }
else {
  const hasModule = sectionsOf(settingsPage.layout_sections)
    .some((s) => (s.modules || []).some((m) => m?.type === 'admin-site-settings'));
  console.log(`  ${NEW_SLUG}: published=${settingsPage.is_published} private=${settingsPage.is_private} `
    + `admin-site-settings module=${hasModule ? 'yes' : 'NO'}`);
  if (!hasModule) problems += 1;
}

for (const page of after) {
  const navs = sectionsOf(page.layout_sections)
    .flatMap((s) => (s.modules || []).filter((m) => m?.type === 'navigation'))
    .filter((m) => String(m?.settings?.navItems || '').includes('admin-dashboard'));
  if (!navs.length) continue;
  const missing = navs.filter((m) => !String(m?.settings?.navItems || '').includes(NAV_ITEM.href));
  console.log(`  ${page.slug}: ${navs.length} admin nav module(s), Settings item present in `
    + `${navs.length - missing.length}/${navs.length}`);
  if (missing.length) problems += 1;
}

const { data: masterAfter } = await sb.from(SAVED_SECTIONS_TABLE).select('*').eq('id', HEADER_MASTER_ID);
if (masterDataKey && masterAfter?.[0]) {
  const json = JSON.stringify(masterAfter[0][masterDataKey] || {});
  const ok = json.includes(NAV_ITEM.href);
  console.log(`  header master: Settings item present = ${ok ? 'yes' : 'NO'}`);
  if (!ok) problems += 1;
}

console.log(problems
  ? `\nDone with ${problems} problem(s) — see above. Backup: ${path.relative(ROOT, backupPath)}`
  : '\nDone. All checks passed.');
process.exit(problems ? 1 : 0);
