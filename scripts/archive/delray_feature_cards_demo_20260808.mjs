#!/usr/bin/env node
'use strict';
/**
 * Delray staging — fill the home-page Feature Cards test grid with real
 * demo content. 2026-08-08.
 *
 * WHAT THIS DOES
 * The four "TEST CARD n" cards on delraytennis.starcaster.pro were created
 * with every optional field empty — no icon, no image, no link — so the
 * module rendered bare white boxes and looked broken (it wasn't). This
 * replaces those four cards with a demo set that exercises the full design:
 * photos from the project's own imported assets, icon badges, and links to
 * real published pages on the staged site. Module color settings are left
 * empty so the cards keep following the site theme.
 *
 * SAFETY
 * - Dry run by default; pass --apply to write.
 * - Only touches the page with slug "home" in the Delray staging project,
 *   and only the one feature-cards module on it.
 * - Writes a full JSON backup of the page row to docs/SQL/backups/ first.
 * - Idempotent: replaces the module's cards outright, so re-running
 *   produces the same result.
 * - Refuses to touch a grid whose card titles are not the known
 *   "Test Card n" set — real operator content is never overwritten.
 *
 * Usage:
 *   node scripts/delray_feature_cards_demo_20260808.mjs            # dry run
 *   node scripts/delray_feature_cards_demo_20260808.mjs --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainCheckoutDir } from '../lib/main_checkout.mjs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');
const ALLOW_LOCAL = process.argv.includes('--allow-local');

const PROJECT_ID = 'proj_1786047238296_opepjk';   // Delray Tennis Center (staging)
const PAGES_TABLE = 'builder_landing_page';
const PAGE_SLUG = 'home';

const BLOB = 'https://astujhe2hvjqd0kf.public.blob.vercel-storage.com/SiteImportApplied/proj_1786047238296_opepjk/assets';
const WP = 'https://www.delraytennis.com/wp-content/uploads/sites/2829';

const DEMO_CARDS = [
  {
    id: 'card-demo-20260808-1',
    title: 'Tennis Clinics',
    body: 'Adult clinics, drills and workout sessions for every level, all week long.',
    imageUrl: `${WP}/2026/05/image0.jpeg?w=1024`,
    imageAlt: 'Clinic group on the hard courts at Delray Beach Tennis Center',
    linkUrl: '/delray-beach-tennis-center-saturday-clinic-full-house',
    linkLabel: '',
    icon: '●',
  },
  {
    id: 'card-demo-20260808-2',
    title: 'Round Robin Mixers',
    body: 'Social round robin mixers — meet players at your level and get in the game.',
    imageUrl: `${BLOB}/simpa_1786048421592_kz4iqiv3.jpg`,
    imageAlt: 'Round robin mixer group photo on the courts',
    linkUrl: '/delray-beach-tennis-round-robin-mixers',
    linkLabel: '',
    icon: '★',
  },
  {
    id: 'card-demo-20260808-3',
    title: 'Junior Programs',
    body: 'Programs, camps and lessons designed for juniors of all ages and abilities.',
    imageUrl: `${WP}/2026/05/image1.jpeg?w=1019`,
    imageAlt: 'Junior tennis program players gathered courtside',
    linkUrl: '/spring-and-summer-junior-tennis-programs',
    linkLabel: '',
    icon: '◆',
  },
  {
    id: 'card-demo-20260808-4',
    title: 'Courts & Facility',
    body: 'Clay courts and lights for night play in the heart of downtown Delray Beach.',
    imageUrl: `${BLOB}/simpa_1786048421592_z8jcprbm.jpg`,
    imageAlt: 'Aerial view of the clay courts at the tennis center',
    linkUrl: '/delray-tennis-new-pro-staff-new-tennis-courts-and-lights-and-new-programs-and-events',
    linkLabel: '',
    icon: '■',
  },
];

// ---------------------------------------------------------------------------
// Environment — same candidate order as the marinoff scripts: the plain
// .env.local can carry BOTH a cloud and a local SUPABASE_URL (last one wins),
// so the cloud-backup copies are tried first.
// ---------------------------------------------------------------------------
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

if (APPLY && isLocalDb && !ALLOW_LOCAL) {
  console.error('Refusing to --apply against a local database: the staging site reads the');
  console.error('cloud one. Pass --allow-local if you really mean to seed your local copy.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load, locate, verify
// ---------------------------------------------------------------------------
const { data: rows, error: readErr } = await sb
  .from(PAGES_TABLE)
  .select('*')
  .eq('project_id', PROJECT_ID)
  .eq('slug', PAGE_SLUG);
if (readErr) { console.error('Failed to read page:', readErr); process.exit(1); }
const page = (rows || [])[0];
if (!page) { console.error(`Page "${PAGE_SLUG}" not found — aborting.`); process.exit(1); }

const doc = typeof page.layout_sections === 'string'
  ? JSON.parse(page.layout_sections)
  : page.layout_sections;
const sections = Array.isArray(doc) ? doc : doc?.sections;
if (!Array.isArray(sections)) { console.error('Unexpected layout_sections shape — aborting.'); process.exit(1); }

let target = null;
for (const section of sections) {
  for (const mod of section?.modules || []) {
    if (mod?.type === 'feature-cards') {
      if (target) { console.error('More than one feature-cards module on home — aborting.'); process.exit(1); }
      target = mod;
    }
  }
}
if (!target) { console.error('No feature-cards module on home — aborting.'); process.exit(1); }

const currentCards = JSON.parse(target.settings?.cards || '[]');
const titles = currentCards.map((c) => String(c.title || ''));
console.log(`Found feature-cards module ${target.id} with cards: ${titles.join(' | ')}`);

const looksLikeTestGrid = titles.length > 0 && titles.every((t) => /^test card \d+$/i.test(t.trim()));
const alreadyApplied = currentCards.every((c) => String(c.id || '').startsWith('card-demo-20260808-'));
if (!looksLikeTestGrid && !alreadyApplied) {
  console.error('Cards are not the known "Test Card n" set — refusing to overwrite real content.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
target.settings.cards = JSON.stringify(DEMO_CARDS);

console.log('\nNew cards:');
for (const c of DEMO_CARDS) console.log(`  ${c.icon}  ${c.title}  →  ${c.linkUrl}`);

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to write.');
  process.exit(0);
}

const backupDir = path.join(MAIN_CHECKOUT, 'docs', 'SQL', 'backups');
mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `delray_home_before_feature_cards_demo_20260808.json`);
writeFileSync(backupFile, JSON.stringify(rows[0], null, 2));
console.log(`\nBackup written: ${backupFile}`);

const { error: writeErr } = await sb
  .from(PAGES_TABLE)
  .update({ layout_sections: page.layout_sections && typeof page.layout_sections === 'string' ? JSON.stringify(doc) : doc })
  .eq('id', page.id)
  .eq('project_id', PROJECT_ID);
if (writeErr) { console.error('Write failed:', writeErr); process.exit(1); }

console.log('Applied. Reload https://delraytennis.starcaster.pro to see the demo cards.');
