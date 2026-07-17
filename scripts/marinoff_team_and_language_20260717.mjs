#!/usr/bin/env node
'use strict';
/**
 * Marinoff follow-up touch-ups (after phase-1 punch list applied 2026-07-17):
 *
 * 1. Our Team page: the old team section was ONE composite JPEG with all seven
 *    people (including departed John Buchenic) baked into the pixels. Replace
 *    it with two three-column rows of individual headshot + name/title cards
 *    (six people, Buchenic removed). Headshots were cropped from the composite
 *    by scripts/split_grid_image.mjs and uploaded to Blob storage.
 *
 * 2. Language switcher (Dane's request): the US-flag image becomes an
 *    "English" button so the header shows matching [English] [Español]
 *    buttons on every page, including the Spanish page.
 *
 * Usage: node scripts/marinoff_team_and_language_20260717.mjs [--apply]
 *   Without --apply: prints what would change. With --apply: writes a full
 *   JSON backup to docs/SQL/backups/ first, then updates the live rows.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'proj_1780601274760_97i84r';
const TABLE = 'builder_landing_page';
const APPLY = process.argv.includes('--apply');
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');
const STAMP = '20260717';

const TEAM = [
  ['Brandon Marinoff', 'Attorney', 'https://astujhe2hvjqd0kf.public.blob.vercel-storage.com/APP_Assets/Image/Team/1784321774486_Brandon_Marinoff.jpg'],
  ['Maria Gutierrez', 'Paralegal', 'https://astujhe2hvjqd0kf.public.blob.vercel-storage.com/APP_Assets/Image/Team/1784321775144_Maria_Gutierrez.jpg'],
  ['Carin Ortega', 'Senior Paralegal', 'https://astujhe2hvjqd0kf.public.blob.vercel-storage.com/APP_Assets/Image/Team/1784321775692_Carin_Ortega.jpg'],
  ['Andrea Rodriguez', 'Senior Paralegal', 'https://astujhe2hvjqd0kf.public.blob.vercel-storage.com/APP_Assets/Image/Team/1784321776048_Andrea_Rodriguez.jpg'],
  ['Ivon Adame', 'Legal Assistant', 'https://astujhe2hvjqd0kf.public.blob.vercel-storage.com/APP_Assets/Image/Team/1784321776420_Ivon_Adame.jpg'],
  ['Nancy Ruiz', 'Legal Assistant', 'https://astujhe2hvjqd0kf.public.blob.vercel-storage.com/APP_Assets/Image/Team/1784321776844_Nancy_Ruiz.jpg'],
];
const OLD_TEAM_SECTION_ID = 'd7302fe9-ff68-431e-a686-d900e683c284';

function loadEnv() {
  const env = {};
  for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function teamCardModules(members, column) {
  // One image module + one text module per member, all in the given column.
  const [name, title, url] = members;
  return [
    {
      id: `module-team-photo-${slugify(name)}-${STAMP}`,
      name: name,
      text: '',
      type: 'image',
      column,
      settings: {
        alt: `${name} - ${title}`,
        url,
        size: '100',
        effect: 'none',
        newTab: 'false',
        linkUrl: '',
        variant: 'image',
        alignment: 'center',
        borderColor: '#0f4f8f',
        borderRadius: '18',
        mobileHidden: 'false',
        desktopHidden: 'false',
        verticalMargin: '0',
        verticalOffset: '0',
        borderThickness: '0',
        horizontalOffset: '0',
      },
    },
    {
      id: `module-team-name-${slugify(name)}-${STAMP}`,
      name: '',
      text: `<h3>${name}</h3><p>${title}</p>`,
      type: 'text',
      column,
      settings: { variant: 'paragraph', alignment: 'center', mobileHidden: 'false', desktopHidden: 'false', verticalMargin: '0' },
    },
  ];
}

function teamRowSection(rowIndex, members) {
  const columns = ['left', 'center', 'right'];
  const modules = members.flatMap((m, i) => teamCardModules(m, columns[i]));
  const per = (v) => ({ left: v, center: v, right: v });
  return {
    id: `section-team-row-${rowIndex}-${STAMP}`,
    title: `Team Row ${rowIndex}`,
    layout: 'three-column',
    locked: false,
    modules,
    alignment: 'left',
    isPrivate: false,
    marginTop: '0',
    marginBottom: '0',
    mobileHidden: 'false',
    desktopHidden: 'false',
    mobileLayout: 'stack',
    background: { mode: 'none', color: '#ffffff', color2: '#eaf4ff', opacity: 100, imageUrl: '', styleKey: '', imageAssetId: '' },
    overlayScreen: { opacity: 100, background: { mode: 'none', color: '#ffffff', color2: '#eaf4ff', opacity: 100, imageUrl: '', styleKey: '', imageAssetId: '' } },
    rowBorderColor: '#ffffff',
    rowBorderStyle: 'solid',
    rowBorderWidth: '0',
    rowBorderRadius: '0',
    cellHAlign: per('center'),
    cellVAlign: per('top'),
    cellShadow: per('none'),
    cellOpacity: per('1'),
    cellPadding: per('18'),
    cellIsPrivate: per('false'),
    cellMobileHidden: per('false'),
    cellDesktopHidden: per('false'),
    cellVerticalMargin: per('0'),
    cellBorderColor: per('transparent'),
    cellBorderStyle: per('solid'),
    cellBorderWidth: per('0'),
    cellBorderRadius: per('24'),
    cellBackgrounds: per({ mode: 'none', color: '#ffffff', color2: '#eaf4ff', opacity: 100, imageUrl: '', styleKey: '', imageAssetId: '' }),
  };
}

function englishButton() {
  return {
    id: `module-lang-english-${STAMP}`,
    type: 'button',
    column: '',
    name: 'English',
    text: 'English',
    settings: {
      href: '/', variant: 'primary', buttonSize: 'small', fontSize: '16',
      paddingX: '14', paddingY: '6', alignment: 'right',
      textColor: '#ffffff', buttonColor: '#0f4f8f', buttonHoverColor: '#3787d7', textHoverColor: '#ffffff',
      borderColor: '#0f4f8f', borderStyle: 'solid', borderRadius: '6',
      marginTop: '0', marginBottom: '0', marginLeft: '0', marginRight: '0', verticalMargin: '0',
      mobileHidden: 'false', desktopHidden: 'false',
      buttonBackgroundMode: 'color', buttonBackgroundColor: '#0f4f8f', buttonBackgroundColor2: '',
      buttonBackgroundImageUrl: '', buttonBackgroundStyleKey: '',
    },
  };
}

function espanolButton() {
  const b = englishButton();
  b.id = `module-lang-button-${STAMP}`;
  b.name = 'Español';
  b.text = 'Español';
  b.settings = { ...b.settings, href: '/espanol', alignment: 'left' };
  return b;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { data: rows, error } = await sb.from(TABLE).select('*').eq('project_id', PROJECT_ID).limit(200);
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`Loaded ${rows.length} pages.`);

  const changed = [];
  for (const row of rows) {
    let doc = row.layout_sections;
    if (typeof doc === 'string') doc = JSON.parse(doc);
    const before = JSON.stringify(doc);

    // 1. Language table: cell 0-0 US flag -> English button; cell 0-1 always Español.
    for (const section of doc.sections || []) {
      for (const mod of section.modules || []) {
        if (mod.type !== 'table' || !/^Language/.test(mod.name || '')) continue;
        let table;
        try { table = JSON.parse(mod.settings.tableData); } catch { continue; }
        if (!table?.cells) continue;
        const c00 = table.cells['0-0']?.[0];
        if (c00 && (c00.type === 'image' || c00.name === 'US Flag')) {
          table.cells['0-0'] = [englishButton()];
          console.log(`  ${row.slug || 'home'}: US flag -> English button`);
        }
        const c01 = table.cells['0-1']?.[0];
        if (c01 && c01.text !== 'Español') {
          table.cells['0-1'] = [espanolButton()];
          console.log(`  ${row.slug || 'home'}: cell 0-1 -> Español button`);
        }
        mod.settings.tableData = JSON.stringify(table);
      }
    }

    // 2. Our Team: replace the composite-image section with two card rows.
    if (row.slug === 'our-team') {
      const idx = (doc.sections || []).findIndex((s) => s.id === OLD_TEAM_SECTION_ID);
      if (idx >= 0) {
        doc.sections.splice(idx, 1, teamRowSection(1, TEAM.slice(0, 3)), teamRowSection(2, TEAM.slice(3, 6)));
        console.log('  our-team: composite team image replaced with 6 individual cards (Buchenic removed)');
      } else {
        console.log('  our-team: WARNING - old team section not found, no team change made');
      }
    }

    if (JSON.stringify(doc) !== before) changed.push({ row, doc });
  }

  console.log(`\n${changed.length} pages would change.`);
  if (!APPLY) { console.log('Dry run only - rerun with --apply to write.'); return; }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `marinoff_pages_backup_${stamp}.json`);
  writeFileSync(backupFile, JSON.stringify(rows, null, 1));
  console.log(`Backup written: ${backupFile}`);
  console.log(`Undo with: node scripts/marinoff_punchlist_${STAMP}.mjs --restore ${backupFile}`);

  for (const { row, doc } of changed) {
    const { error: upErr } = await sb.from(TABLE)
      .update({ layout_sections: doc, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('project_id', PROJECT_ID);
    if (upErr) { console.error(`update failed on ${row.slug}:`, upErr.message); process.exit(1); }
    console.log(`  updated ${row.slug || 'home'} (id ${row.id})`);
  }
  console.log('Apply complete.');
}

main().catch((err) => { console.error(err); process.exit(1); });
