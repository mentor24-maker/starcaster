#!/usr/bin/env node
'use strict';
/**
 * Marinoff admin back-end — add a Support page and repair the orphaned
 * "Support" menu item. 2026-07-29.
 *
 * WHAT THIS DOES
 * 1. Creates the page `admin-support` ("Admin: Support") holding two content
 *    modules: a rich-text block of contact details (editable in the Builder,
 *    no code needed) and one admin-support-form module. Its header, footer and
 *    copyright sections are canonical instances of the same saved sections the
 *    other admin pages use, so it inherits their look and any future edits.
 * 2. REPAIRS the existing "Support" item in the admin Main Menu rather than
 *    adding a second one. That item (nav-1781451703204-26) is currently:
 *        label="Support"  href="support"  parentId="nav-1781437856820-6"
 *    and nav-1781437856820-6 does not exist in the admin menu — it is left
 *    over from the public site's nav. The renderer builds its top level with
 *    `navItems.filter(item => !item.parentId)` and renders children only under
 *    a parent that exists, so this item currently renders NOWHERE. Its href
 *    also pointed at a `support` page that does not exist in this project.
 *    The repair drops parentId and repoints href at `admin-support`.
 * 3. Applies that repair to the "Admin Header" saved-section MASTER as well as
 *    to every linked page. The master matters: the header is a canonical
 *    section, so the next time anyone saves that master it overwrites every
 *    page's copy. Fixing only the pages would make the repair vanish the next
 *    time the header is edited.
 *
 * SLUG PRIVACY: `admin-support` starts with "admin-", which
 * lib/builder-client/public-site-page-slugs.js treats as private — the page
 * requires project-admin login and stays out of GET /api/public/pages. No code
 * change is needed for that; is_private is also set explicitly.
 *
 * PREREQUISITE: docs/SQL/project_support_requests.sql must be applied to
 * Supabase first, or the form will save nothing. This script checks and
 * refuses to --apply if the table is missing.
 *
 * SAFETY
 * - Dry run by default; pass --apply to write.
 * - Writes a full JSON backup of every page + the saved-section master to
 *   docs/SQL/backups/ before any change.
 * - Idempotent: re-running neither duplicates the page nor the menu item, and
 *   never creates a second "Support" entry.
 * - Does NOT trigger canonical propagation. It edits the master's stored JSON
 *   and each linked instance directly, in one pass, to the same value — it
 *   never calls the push endpoint that rewrites all linked pages.
 *
 * Usage:
 *   node scripts/marinoff_admin_support_page_20260729.mjs            # dry run
 *   node scripts/marinoff_admin_support_page_20260729.mjs --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainCheckoutDir } from '../lib/main_checkout.mjs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = require('@supabase/supabase-js');

const PROJECT_ID = 'proj_1780601274760_97i84r';   // Marinoff & Associates
const PAGES_TABLE = 'builder_landing_page';
const SAVED_SECTIONS_TABLE = 'builder_saved_sections';
const SUPPORT_TABLE = 'app_project_support_requests';
const HEADER_MASTER_ID = 'saved_section_1782534344813_j7kkz2';   // "Admin Header"

const SOURCE_SLUG = 'admin-settings';   // page whose chrome we mirror
const NEW_SLUG = 'admin-support';
const NEW_NAME = 'Admin: Support';

/** The existing orphaned item. We repair this id — we never add another. */
const SUPPORT_NAV_ITEM_ID = 'nav-1781451703204-26';
const SUPPORT_NAV_LABEL = 'Support';
const SUPPORT_NAV_HREF = 'admin-support';

const APPLY = process.argv.includes('--apply');
const ALLOW_LOCAL = process.argv.includes('--allow-local');
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');
const stamp = '20260729';

/**
 * Placeholder contact details. Deliberately a plain rich-text module rather
 * than anything code-driven, so Dane can edit it in the Builder like any other
 * text — no deploy required.
 */
const CONTACT_HTML = [
  '<h3><span style="font-size: 20px;"><strong>Need a hand with your website?</strong></span></h3>',
  '<p><span style="font-size: 16px;">Use the form below and it comes straight to us, ',
  'along with anything you attach. For anything urgent, reach out directly:</span></p>',
  '<p><span style="font-size: 16px;"><strong>Email:</strong> ',
  '<a href="mailto:support@alphire.com">support@alphire.com</a></span></p>',
  '<p><span style="font-size: 16px;"><strong>Phone:</strong> (add your support number here)</span></p>',
  '<p><span style="font-size: 16px;"><strong>Hours:</strong> Monday to Friday, 9am to 5pm MT</span></p>',
].join('');

// Env files are gitignored, so a git worktree does not have them — fall back to
// the main checkout. Prefer the cloud-backup file: plain .env.local currently
// carries BOTH a cloud and a local SUPABASE_URL, and the last one wins, so
// reading it would quietly point this at the local dev database.
const MAIN_CHECKOUT = mainCheckoutDir(ROOT);
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
// Preflight — the form is useless without its table
// ---------------------------------------------------------------------------

const { error: tableErr } = await sb.from(SUPPORT_TABLE).select('id').limit(1);
const supportTableReady = !tableErr;
if (!supportTableReady) {
  console.log(`⚠  Table ${SUPPORT_TABLE} is not reachable: ${tableErr.message}`);
  console.log('   Apply docs/SQL/project_support_requests.sql on Supabase first, or the');
  console.log('   Support form will accept a request and save nothing.\n');
  if (APPLY) {
    console.error('Refusing to --apply until the table exists.');
    process.exit(1);
  }
} else {
  console.log(`Preflight: ${SUPPORT_TABLE} exists.\n`);
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

const existingSupportPage = pageRows.find((p) => p.slug === NEW_SLUG) || null;

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

mkdirSync(BACKUP_DIR, { recursive: true });
const backupPath = path.join(BACKUP_DIR, `marinoff_admin_support_${stamp}_backup.json`);
writeFileSync(backupPath, JSON.stringify({
  capturedFor: 'marinoff_admin_support_page_20260729',
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
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;   // unparseable — caller must skip rather than clobber
  }
}

/**
 * Repair the Support item in one navItems JSON string.
 *
 * Matches on id first, then on a menu-less href, so this still finds the item
 * if somebody renamed its label. Never appends a second Support entry when one
 * is already present and correct.
 */
function withRepairedSupportItem(rawNavItems) {
  const items = parseNavItems(rawNavItems);
  if (items === null) return { error: 'navItems is not valid JSON' };

  const idx = items.findIndex((i) => String(i?.id || '') === SUPPORT_NAV_ITEM_ID);
  if (idx < 0) {
    // No orphan to repair. Only add one if there is no Support link at all.
    if (items.some((i) => String(i?.href || '') === SUPPORT_NAV_HREF)) return { unchanged: true };
    const next = [...items, { id: SUPPORT_NAV_ITEM_ID, label: SUPPORT_NAV_LABEL, href: SUPPORT_NAV_HREF }];
    return { value: JSON.stringify(next), action: 'added' };
  }

  const current = items[idx];
  const alreadyFixed = String(current.href || '') === SUPPORT_NAV_HREF && !current.parentId;
  if (alreadyFixed) return { unchanged: true };

  // Drop parentId entirely rather than nulling it. The renderer's top level is
  // `navItems.filter(item => !item.parentId)`, so any falsy value works, but an
  // absent key matches how every other top-level item in this menu is stored.
  const { parentId, ...rest } = current;
  const repaired = { ...rest, label: String(current.label || SUPPORT_NAV_LABEL), href: SUPPORT_NAV_HREF };
  const next = [...items];
  next[idx] = repaired;
  return {
    value: JSON.stringify(next),
    action: 'repaired',
    detail: `href "${current.href}" -> "${SUPPORT_NAV_HREF}"`
      + (parentId ? `, dropped orphan parentId "${parentId}"` : ''),
  };
}

/** Patch every navigation module inside a sections array. Returns a copy. */
function repairNavInSections(sections, label) {
  let changed = 0;
  const notes = [];
  const out = sections.map((section) => {
    const modules = Array.isArray(section?.modules) ? section.modules : [];
    if (!modules.some((m) => m?.type === 'navigation')) return section;
    const nextModules = modules.map((m) => {
      if (m?.type !== 'navigation') return m;
      // Only touch the admin menu, never the public site's nav.
      if (!String(m?.settings?.navItems || '').includes('admin-dashboard')) return m;
      const result = withRepairedSupportItem(m?.settings?.navItems);
      if (result.error) {
        console.log(`    ! ${label}: nav module ${m.id} skipped — ${result.error}`);
        return m;
      }
      if (result.unchanged) return m;
      changed += 1;
      notes.push(`${result.action}${result.detail ? ` (${result.detail})` : ''}`);
      return { ...m, settings: { ...m.settings, navItems: result.value } };
    });
    return { ...section, modules: nextModules };
  });
  return { sections: out, changed, notes };
}

// ---------------------------------------------------------------------------
// Step 1 — build the new Support page document
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
  title: 'Support',
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
      id: `module_${stamp}_supportcontact`,
      type: 'text',
      column: 'main',
      name: 'Support Contact Details',
      text: CONTACT_HTML,
      settings: {
        align: 'left',
        headingLevel: 'H3',
        headlineId: '',
        mobileHidden: 'false',
        desktopHidden: 'false',
        verticalMargin: '0',
      },
    },
    {
      id: `module_${stamp}_adminsupportform`,
      type: 'admin-support-form',
      column: 'main',
      name: 'Support Request Form',
      text: '',
      settings: {
        formTitle: 'Request Support',
        showTitle: 'true',
        defaultPriority: 'normal',
        showScreenshot: 'true',
        buttonText: 'Send Request',
        showHistory: 'true',
        historyTitle: 'Your Recent Requests',
        mobileHidden: 'false',
        desktopHidden: 'false',
        verticalMargin: '0',
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

// Repair the nav on the brand-new page too, so it ships correct.
const newDocRepaired = { ...newDoc, sections: repairNavInSections(newDoc.sections, NEW_SLUG).sections };

const newPageRow = {
  project_id: PROJECT_ID,
  owner_user_id: sourcePage.owner_user_id,
  name: NEW_NAME,
  slug: NEW_SLUG,
  template_id: sourcePage.template_id,
  template_kind: sourcePage.template_kind || 'modular',
  theme_id: sourcePage.theme_id,
  layout_sections: newDocRepaired,
  content_overrides: {},
  is_published: true,
  is_private: true,
};

console.log('── Step 1: Support page ─────────────────────────────────────────');
if (existingSupportPage) {
  console.log(`  Page "${NEW_SLUG}" already exists (id ${existingSupportPage.id}) — leaving its content alone.`);
} else {
  console.log(`  CREATE page "${NEW_SLUG}" (${NEW_NAME})`);
  console.log(`    sections: ${newDocRepaired.sections.map((s) => s.title || '(untitled)').join(' | ')}`);
  console.log(`    content modules: text (contact details), admin-support-form`);
  console.log(`    is_published=true  is_private=true (login-gated by the admin- slug rule)`);
}

// ---------------------------------------------------------------------------
// Step 2 — repair the nav item on the header master
// ---------------------------------------------------------------------------

console.log('\n── Step 2: repair the "Support" menu item on the master ─────────');

const masterDataKey = ['section', 'data', 'payload', 'content'].find(
  (k) => masterRow[k] && typeof masterRow[k] === 'object'
);
let masterUpdate = null;
if (!masterDataKey) {
  console.log(`  ! Could not find the section JSON on the master row.`);
  console.log(`    Columns present: ${Object.keys(masterRow).join(', ')}`);
  console.log(`    NOT updating the master — the repair would be undone on the next header save.`);
} else {
  const masterSection = masterRow[masterDataKey];
  const result = repairNavInSections([masterSection], `master(${masterDataKey})`);
  if (result.changed) {
    masterUpdate = { [masterDataKey]: result.sections[0] };
    console.log(`  UPDATE "Admin Header" master (${HEADER_MASTER_ID})`);
    for (const note of result.notes) console.log(`    ${note}`);
  } else {
    console.log(`  Master already correct — no change.`);
  }
}

// ---------------------------------------------------------------------------
// Step 3 — repair the nav item on every existing admin page
// ---------------------------------------------------------------------------

console.log('\n── Step 3: repair the menu item on each linked page ─────────────');

const pageUpdates = [];
for (const page of pageRows) {
  const slug = String(page.slug || '');
  const sections = sectionsOf(page.layout_sections);
  const hasAdminNav = sections.some((s) => (s.modules || []).some(
    (m) => m?.type === 'navigation'
      && String(m?.settings?.navItems || '').includes('admin-dashboard')
  ));
  if (!hasAdminNav) continue;

  const result = repairNavInSections(sections, slug);
  if (!result.changed) {
    console.log(`  ${slug}: already correct — no change.`);
    continue;
  }
  pageUpdates.push({
    id: page.id,
    slug,
    layout_sections: { ...page.layout_sections, sections: result.sections },
  });
  console.log(`  UPDATE ${slug} — ${result.notes.join('; ')}`);
}

if (!pageUpdates.length) console.log('  (no existing page needed a nav change)');

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

console.log('\n── Summary ──────────────────────────────────────────────────────');
console.log(`  New page:        ${existingSupportPage ? 'skip (exists)' : '1 insert'}`);
console.log(`  Header master:   ${masterUpdate ? '1 update' : 'no change'}`);
console.log(`  Admin pages:     ${pageUpdates.length} update(s)`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to make these changes.');
  process.exit(0);
}

console.log('\nApplying…');

if (!existingSupportPage) {
  const { data: inserted, error } = await sb.from(PAGES_TABLE).insert(newPageRow).select('id,slug');
  if (error) { console.error('  FAILED to insert the Support page:', error); process.exit(1); }
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

const supportPage = after.find((p) => p.slug === NEW_SLUG);
if (!supportPage) {
  console.log(`  MISSING: ${NEW_SLUG}`);
  problems += 1;
} else {
  const modules = sectionsOf(supportPage.layout_sections).flatMap((s) => s.modules || []);
  const hasForm = modules.some((m) => m?.type === 'admin-support-form');
  console.log(`  ${NEW_SLUG}: published=${supportPage.is_published} private=${supportPage.is_private} `
    + `admin-support-form module=${hasForm ? 'yes' : 'NO'}`);
  // A "text" module where the form should be means the server bundle does not
  // know the type and coerced it — i.e. `npm run build:builder-template` was
  // skipped. Catch that here rather than letting the page quietly rot.
  if (!hasForm) {
    console.log('    ! The form module is missing. If it came back as "text", the server');
    console.log('      template bundle does not know "admin-support-form" — run');
    console.log('      `npm run build:builder-template` and redeploy.');
    problems += 1;
  }
}

for (const page of after) {
  const navs = sectionsOf(page.layout_sections)
    .flatMap((s) => (s.modules || []).filter((m) => m?.type === 'navigation'))
    .filter((m) => String(m?.settings?.navItems || '').includes('admin-dashboard'));
  if (!navs.length) continue;

  let good = 0;
  let duplicates = 0;
  for (const m of navs) {
    const items = parseNavItems(m?.settings?.navItems) || [];
    const supportItems = items.filter((i) => String(i?.href || '') === SUPPORT_NAV_HREF);
    if (supportItems.length > 1) duplicates += 1;
    if (supportItems.length === 1 && !supportItems[0].parentId) good += 1;
  }
  console.log(`  ${page.slug}: ${navs.length} admin nav module(s), Support renders in ${good}/${navs.length}`
    + (duplicates ? `  ⚠ ${duplicates} with DUPLICATE Support items` : ''));
  if (good !== navs.length || duplicates) problems += 1;
}

const { data: masterAfter } = await sb.from(SAVED_SECTIONS_TABLE).select('*').eq('id', HEADER_MASTER_ID);
if (masterDataKey && masterAfter?.[0]) {
  const nav = (masterAfter[0][masterDataKey]?.modules || []).find((m) => m?.type === 'navigation');
  const items = parseNavItems(nav?.settings?.navItems) || [];
  const support = items.filter((i) => String(i?.href || '') === SUPPORT_NAV_HREF);
  const ok = support.length === 1 && !support[0].parentId;
  console.log(`  header master: Support item correct = ${ok ? 'yes' : 'NO'}`);
  if (!ok) problems += 1;
}

console.log(problems
  ? `\nDone with ${problems} problem(s) — see above. Backup: ${path.relative(ROOT, backupPath)}`
  : '\nDone. All checks passed.');
process.exit(problems ? 1 : 0);
