#!/usr/bin/env node
'use strict';
/**
 * Marinoff & Associates website punch-list migration generator.
 * ClickUp: Starcaster › Marinoff & Associates › Website Edits (17 tasks).
 *
 * READ-ONLY against the database. Reads the live builder_landing_page rows for
 * the Marinoff project, applies the punch-list edits in memory, validates that
 * every edit rule matched exactly as expected, and writes:
 *
 *   docs/SQL/marinoff_website_edits_20260717.sql         (phase 1 - run after backup)
 *   docs/SQL/marinoff_website_edits_20260717_report.md   (review report for Dane)
 *
 * Phase 2 (run AFTER phase 1 is applied and the five draft pages are approved):
 *   node scripts/marinoff_punchlist_20260717.mjs --phase 2
 *   -> docs/SQL/marinoff_website_edits_20260717_phase2.sql
 *      (publishes the new pages, rewires the Criminal Law menu, retires the
 *       old Theft / Embezzelment / Fraud tabs)
 *
 * Usage:  node scripts/marinoff_punchlist_20260717.mjs [--phase 1|2] [--apply]
 *         node scripts/marinoff_punchlist_20260717.mjs --restore <backup.json>
 *
 * --apply    Applies the phase's changes directly to the database (the generated
 *            SQL file is too large for the Supabase SQL editor). A full JSON
 *            backup of every page row is written locally BEFORE any write, and
 *            the same validations run first; any failure aborts with no writes.
 * --restore  Puts every page row back exactly as it was in the given backup.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'SQL');
const PROJECT_ID = 'proj_1780601274760_97i84r'; // Marinoff & Associates
const TABLE = 'builder_landing_page';
const BACKUP_TABLE = 'builder_landing_page_marinoff_bak_20260717';
const STAMP = '20260717';

const PHASE = process.argv.includes('--phase')
  ? Number(process.argv[process.argv.indexOf('--phase') + 1] || 1)
  : 1;
const APPLY = process.argv.includes('--apply');
const RESTORE_FILE = process.argv.includes('--restore')
  ? process.argv[process.argv.indexOf('--restore') + 1]
  : null;
const BACKUP_DIR = path.join(ROOT, 'docs', 'SQL', 'backups');

// ---------------------------------------------------------------- env / db --

function loadEnv() {
  const env = {};
  const raw = readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return env;
}

// ------------------------------------------------------------------ helpers --

const changes = []; // { page, rule, before, after }
const problems = [];

function logChange(page, rule, before, after) {
  const trim = (s) => {
    const t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > 220 ? `${t.slice(0, 220)}…` : t;
  };
  changes.push({ page, rule, before: trim(before), after: trim(after) });
}

/** Replace `find` (string or RegExp) in `text`; assert the number of hits. */
function replaceCounted(text, find, replace, { min = 1, max = Infinity } = {}) {
  let count = 0;
  const re = find instanceof RegExp
    ? new RegExp(find.source, find.flags.includes('g') ? find.flags : `${find.flags}g`)
    : null;
  let out;
  if (re) {
    out = text.replace(re, (m) => { count += 1; return typeof replace === 'function' ? replace(m) : replace; });
  } else {
    out = text.split(find).join(replace);
    count = text.split(find).length - 1;
  }
  return { out, count, ok: count >= min && count <= max };
}

/** Apply a text rule to every text-bearing string of a page document
 *  (module.text AND every string value inside module.settings — content can
 *  hide in settings.content, settings.alt, table cells, etc.). */
function applyTextRule(page, doc, rule) {
  let total = 0;
  const apply = (value, assign) => {
    if (typeof value !== 'string' || !value) return;
    const { out, count } = replaceCounted(value, rule.find, rule.replace, { min: 0 });
    if (count > 0) {
      logChange(page.slug || 'home', rule.id,
        value.match(rule.find instanceof RegExp ? rule.find : rule.find)?.[0] ?? rule.find,
        typeof rule.replace === 'string' ? rule.replace : '(pattern)');
      assign(out);
      total += count;
    }
  };
  for (const section of doc.sections || []) {
    for (const mod of section.modules || []) {
      apply(mod.text, (v) => { mod.text = v; });
      if (mod.settings) {
        for (const key of Object.keys(mod.settings)) {
          if (key === 'navItems') continue; // handled by transformNav
          apply(mod.settings[key], (v) => { mod.settings[key] = v; });
        }
      }
    }
  }
  return total;
}

/** Remove a heading + everything until the next heading of the same-or-higher level. */
function removeHeadingBlock(html, headingText) {
  const re = new RegExp(
    `<h([1-4])[^>]*>\\s*(?:<[^>]+>\\s*)*${headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*<[^>]+>)*\\s*</h\\1>`,
    'i'
  );
  const m = html.match(re);
  if (!m) return { out: html, ok: false };
  const start = m.index;
  const level = Number(m[1]);
  const rest = html.slice(start + m[0].length);
  const nextRe = new RegExp(`<h([1-${level}])[^>]*>`, 'i');
  const n = rest.match(nextRe);
  const end = n ? start + m[0].length + n.index : html.length;
  return { out: html.slice(0, start) + html.slice(end), ok: true, removed: html.slice(start, end) };
}

function applyHeadingBlockRemoval(page, doc, headingText, ruleId) {
  for (const section of doc.sections || []) {
    for (const mod of section.modules || []) {
      if (typeof mod.text !== 'string' || !mod.text.length) continue;
      const { out, ok, removed } = removeHeadingBlock(mod.text, headingText);
      if (ok) {
        logChange(page.slug, ruleId, removed, '(section removed)');
        mod.text = out;
        return true;
      }
    }
  }
  return false;
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonbLiteral(obj) {
  // Escape for a single-quoted SQL string literal.
  return `${sqlQuote(JSON.stringify(obj))}::jsonb`;
}

// -------------------------------------------------------- nav / table edits --

const NAV_RENAMES = new Map([
  ['Traffic Crimes', 'Traffic/DUI'],
  ['Drug Crimes', 'Drugs'],
  ['Homicide', 'Violent Crimes'],
]);
const FAMILY_PARENT_LABEL = 'Family Law';
const FAMILY_CHILD_LABELS = new Set(['Divorce', 'Separation', 'Custody', 'Adoption']);

function transformNav(page, doc) {
  let touched = false;
  for (const section of doc.sections || []) {
    for (const mod of section.modules || []) {
      if (mod.type !== 'navigation') continue;
      const raw = mod.settings?.navItems;
      if (!raw) continue;
      let items;
      try { items = JSON.parse(raw); } catch { continue; }
      if (!Array.isArray(items) || !items.length) continue;

      const familyIds = new Set(
        items.filter((i) => i.label === FAMILY_PARENT_LABEL && !i.parentId).map((i) => i.id)
      );
      const next = items
        .filter((i) => !familyIds.has(i.id))
        .filter((i) => !(i.parentId && familyIds.has(i.parentId) && FAMILY_CHILD_LABELS.has(i.label)));
      let renamed = 0;
      for (const item of next) {
        if (NAV_RENAMES.has(item.label)) {
          item.label = NAV_RENAMES.get(item.label);
          renamed += 1;
        }
      }
      if (next.length !== items.length || renamed > 0) {
        logChange(page.slug, 'nav-menu',
          `${items.length} items (${items.filter((i) => familyIds.has(i.id) || (i.parentId && familyIds.has(i.parentId))).map((i) => i.label).join(', ') || 'no family items'})`,
          `${next.length} items, ${renamed} renamed (Traffic/DUI, Drugs, Violent Crimes)`);
        mod.settings.navItems = JSON.stringify(next);
        touched = true;
      }
    }
  }
  return touched;
}

function transformNavPhase2(page, doc) {
  let touched = false;
  for (const section of doc.sections || []) {
    for (const mod of section.modules || []) {
      if (mod.type !== 'navigation') continue;
      const raw = mod.settings?.navItems;
      if (!raw) continue;
      let items;
      try { items = JSON.parse(raw); } catch { continue; }
      if (!Array.isArray(items) || !items.length) continue;
      const criminal = items.find((i) => i.label === 'Criminal Law' && !i.parentId);
      if (!criminal) continue;

      const drop = new Set(['Theft', 'Embezzelment', 'Embezzlement', 'Fraud']);
      const before = items.length;
      let next = items.filter((i) => !(i.parentId === criminal.id && drop.has(i.label)));
      const already = new Set(next.filter((i) => i.parentId === criminal.id).map((i) => i.label));
      const additions = [
        { label: 'Theft/Fraud', href: 'theft-fraud' },
        { label: 'Domestic Violence', href: 'domestic-violence' },
        { label: 'Assaults', href: 'assaults' },
        { label: 'Restraining Orders', href: 'restraining-orders' },
        { label: 'Federal Crimes', href: 'federal-crimes' },
      ].filter((a) => !already.has(a.label));
      // Insert new children right after the last existing Criminal Law child.
      let lastIdx = -1;
      next.forEach((i, idx) => { if (i.parentId === criminal.id) lastIdx = idx; });
      const newItems = additions.map((a, k) => ({
        id: `nav-${STAMP}-${a.href}`,
        label: a.label,
        href: a.href,
        parentId: criminal.id,
      }));
      next = [...next.slice(0, lastIdx + 1), ...newItems, ...next.slice(lastIdx + 1)];
      if (next.length !== before || additions.length) {
        logChange(page.slug, 'nav-menu-phase2',
          `${before} items`, `${next.length} items (+${additions.map((a) => a.label).join(', ')}; -Theft/Embezzelment/Fraud)`);
        mod.settings.navItems = JSON.stringify(next);
        touched = true;
      }
    }
  }
  return touched;
}

function espanolButton(isSpanishPage) {
  return {
    id: `module-lang-button-${STAMP}`,
    type: 'button',
    column: '',
    name: isSpanishPage ? 'English' : 'Español',
    text: isSpanishPage ? 'English' : 'Español',
    settings: {
      href: isSpanishPage ? '/' : '/espanol',
      variant: 'primary',
      buttonSize: 'small',
      fontSize: '16',
      paddingX: '14',
      paddingY: '6',
      alignment: 'left',
      textColor: '#ffffff',
      buttonColor: '#0f4f8f',
      buttonHoverColor: '#3787d7',
      textHoverColor: '#ffffff',
      borderColor: '#0f4f8f',
      borderStyle: 'solid',
      borderRadius: '6',
      marginTop: '0',
      marginBottom: '0',
      marginLeft: '0',
      marginRight: '0',
      verticalMargin: '0',
      mobileHidden: 'false',
      desktopHidden: 'false',
      buttonBackgroundMode: 'color',
      buttonBackgroundColor: '#0f4f8f',
      buttonBackgroundColor2: '',
      buttonBackgroundImageUrl: '',
      buttonBackgroundStyleKey: '',
    },
  };
}

function transformLanguageTable(page, doc) {
  let touched = false;
  for (const section of doc.sections || []) {
    for (const mod of section.modules || []) {
      if (mod.type !== 'table' || !/^Language/.test(mod.name || '')) continue;
      const raw = mod.settings?.tableData;
      if (!raw) continue;
      let table;
      try { table = JSON.parse(raw); } catch { continue; }
      const cell = table?.cells?.['0-1'];
      if (!Array.isArray(cell) || !cell.length) continue;
      const flag = cell[0];
      if (flag?.type === 'image' && /mx\.svg|Mexican/i.test(JSON.stringify(flag))) {
        const btn = espanolButton(page.slug === 'espanol');
        table.cells['0-1'] = [btn];
        mod.settings.tableData = JSON.stringify(table);
        logChange(page.slug, 'espanol-button', 'Mexican Flag image (links /espanol)', `${btn.text} button → ${btn.settings.href}`);
        touched = true;
      }
    }
  }
  return touched;
}

// -------------------------------------------------------------- text rules --

// Applied to every page (module text only).
const GLOBAL_TEXT_RULES = [
  { id: 'phone-greeley', find: '303-619-1978', replace: '720-216-4766', min: 0 },
  { id: 'phone-brighton', find: '720-621-7635', replace: '720-373-3508', min: 0 },
  {
    id: 'footer-family-law-link',
    find: /<p><a[^>]{0,160}href="\/family-law"[^>]*>.*?<\/a><\/p>/g,
    replace: '',
    min: 0,
  },
  {
    id: 'old-site-family-law-tagline',
    find: 'Criminal Defense Attorneys, Family Law and',
    replace: 'Criminal Defense Attorneys and',
    min: 0,
  },
  {
    id: 'footer-credit-family-law',
    find: 'Criminal Defense Attorneys, Family Law</span>',
    replace: 'Criminal Defense Attorneys</span>',
    min: 0,
  },
  // Image alt texts that mention the retired practice area.
  { id: 'alt-family-law-1', find: 'Family Law and Personal Attention by Lawyers', replace: 'Personal Attention by Lawyers', min: 0 },
  { id: 'alt-family-law-2', find: 'Colorado Immigration Lawyers - Family Law', replace: 'Colorado Immigration Lawyers', min: 0 },
  { id: 'alt-family-law-3', find: 'Colorado family law attorney', replace: 'Colorado attorney', min: 0 },
  { id: 'alt-family-law-4', find: 'Child custody and family lawyer Colorado', replace: 'Colorado attorney', min: 0 },
];

/** Strings that must NOT remain on any page that stays published after phase 1. */
const FORBIDDEN_AFTER_PHASE1 = [
  /303-619-1978/,
  /720-621-7635/,
  /Family Law/,
  /family law/,
  /Derecho Familiar/,
  /conflicto familiar/,
  /derecho familiar/i,
  /Mexican Flag/,
  /flags\/mx\.svg/,
  /Justin Johnson|Erica Hernandez|Olga Escarcega|Trimmell|Escarcega|Buchenic/,
];

// Phone numbers can also hide in non-text settings strings (e.g. table cells).
function replacePhonesInSettings(page, doc) {
  for (const section of doc.sections || []) {
    for (const mod of section.modules || []) {
      if (!mod.settings) continue;
      for (const [key, val] of Object.entries(mod.settings)) {
        if (typeof val !== 'string') continue;
        if (val.includes('303-619-1978') || val.includes('720-621-7635')) {
          mod.settings[key] = val
            .split('303-619-1978').join('720-216-4766')
            .split('720-621-7635').join('720-373-3508');
          logChange(page.slug, 'phone-in-settings', `${key} contained old office number`, 'updated');
        }
      }
    }
  }
}

// Page-specific rules: slug -> [{ id, find, replace, expect }]
const S = (s) => s; // marker for exact strings copied from live content
const PAGE_TEXT_RULES = {
  'about': [
    { id: 'fl-enum', find: S('Criminal Law, Family Law, and Immigration Law'), replace: 'Criminal Law and Immigration Law', expect: 1 },
  ],
  'our-team': [
    { id: 'fl-enum', find: S('facing criminal charges, navigating a family law matter, or dealing with complex immigration issues'), replace: 'facing criminal charges or dealing with complex immigration issues', expect: 1 },
    { id: 'fl-enum2', find: S('criminal defense matter, family law dispute, or immigration case'), replace: 'criminal defense matter or immigration case', expect: 1 },
  ],
  'contact': [
    { id: 'fl-enum', find: S('a criminal charge, a family law matter, or an immigration issue'), replace: 'a criminal charge or an immigration issue', expect: 1 },
  ],
  '': [ // home page (empty slug)
    { id: 'fl-enum', find: S('Criminal Law, Family Law, and Immigration Law matters'), replace: 'Criminal Law and Immigration Law matters', expect: 1 },
    { id: 'fl-enum2', find: S('facing criminal charges, navigating a difficult family law matter, or pursuing your immigration goals'), replace: 'facing criminal charges or pursuing your immigration goals', expect: 1 },
    { id: 'fl-enum3', find: S('in a criminal case, family law matter, or an immigration issue'), replace: 'in a criminal case or an immigration issue', expect: 2 }, // body text + settings.content copy
  ],
  'brandon-marinoff-bio': [
    { id: 'fl-enum', find: S('criminal defense, immigration law, and family law.'), replace: 'criminal defense and immigration law.', expect: 1 },
    { id: 'fl-sentence', find: /\s*In family law cases[^.]*\./, replace: '', expect: 1 },
    { id: 'fl-enum2', find: /guiding a family through an immigration matter, or helping someone through a difficult family law issue/, replace: 'or guiding a family through an immigration matter', expect: 1 },
  ],
  'testimonials': [
    { id: 'fl-enum', find: S('criminal defense, immigration law, and family law matters'), replace: 'criminal defense and immigration law matters', expect: 1 },
  ],
  'disclaimer': [
    { id: 'fl-enum', find: S('a criminal defense, family law, or immigration matter'), replace: 'a criminal defense or immigration matter', expect: 1 },
  ],
  'terms-and-conditions': [
    { id: 'fl-enum', find: S('criminal defense, family law, and immigration law'), replace: 'criminal defense and immigration law', expect: 1 },
  ],
  'greeley-co-lawyer': [
    { id: 'fl-enum', find: /criminal defense, immigration law, and\s*(<[^>]+>\s*)*family law/, replace: 'criminal defense and immigration law', expect: 1 },
    { id: 'fl-enum2', find: S('criminal, immigration, and family law matters'), replace: 'criminal and immigration matters', expect: 1 },
  ],
  'brighton-co-attorney': [
    { id: 'fl-enum', find: /aggressive criminal defense, experienced immigration representation, and compassionate\s*(<[^>]+>\s*)*family law services/, replace: 'aggressive criminal defense and experienced immigration representation', expect: 1 },
    { id: 'fl-enum2', find: S('facing criminal charges, navigating a complex immigration matter, or dealing with a sensitive family law issue'), replace: 'facing criminal charges or navigating a complex immigration matter', expect: 1 },
    { id: 'fl-enum3', find: S('arrested, need help with an immigration matter, or require experienced family law representation'), replace: 'arrested or need help with an immigration matter', expect: 1 },
  ],
  'espanol': [
    { id: 'fl-es-title', find: /Defensa Penal, Inmigración y Derecho Familiar/g, replace: 'Defensa Penal e Inmigración', expect: 3 }, // page title + two image alts
    { id: 'fl-es-enum', find: S('un proceso penal, un asunto de inmigración o un conflicto familiar'), replace: 'un proceso penal o un asunto de inmigración', expect: 1 },
    { id: 'fl-es-enum2', find: /defensa penal\s*(<[^>]+>\s*,?\s*)*\s*inmigración\s*(<[^>]+>\s*)*\s*o\s*(<[^>]+>\s*)*derecho familiar/i, replace: 'defensa penal o inmigración', expect: 1 },
  ],
  // --- crime pages: renames, softening, definitions, "and more" -------------
  'traffic-crimes': [
    { id: 'h1-rename', find: /(<h1[^>]*>)\s*Traffic Crimes\s*(<\/h1>)/, replace: '$1Traffic/DUI$2', expect: 1 },
    { id: 'soften-first-bullet', find: S('We represent you at all stages of the legal process, from pre-trial hearings to the courtroom. Our attorneys will advocate for you and ensure that your case is presented effectively.'), replace: 'We can represent you at all stages of the legal process, from pre-trial hearings to the courtroom. Our attorneys can advocate for you and work to ensure that your case is presented effectively.', expect: 1 },
    { id: 'and-more', find: S('loss of your license, or even jail time.</p>'), replace: 'loss of your license, or even jail time. These are only examples. We can help with these and any other traffic-related charge.</p>', expect: 1 },
  ],
  'drug-crimes': [
    { id: 'h1-rename', find: /(<h1[^>]*>)\s*Drug Crimes\s*(<\/h1>)/, replace: '$1Drugs$2', expect: 1 },
    { id: 'soften-first-bullet', find: S('We represent you through every stage of the legal process, from pre-trial motions to trial.'), replace: 'We can represent you through every stage of the legal process, from pre-trial motions to trial.', expect: 1 },
    { id: 'and-more', find: S('depending on the nature of the offense and the substance involved.</p>'), replace: 'depending on the nature of the offense and the substance involved. These are only examples. We can help with these and any other drug-related charge.</p>', expect: 1 },
  ],
  'sex-offenses': [
    { id: 'soften-first-bullet', find: S('We provide aggressive representation at every stage of the legal process'), replace: 'We can provide aggressive representation at every stage of the legal process', expect: 1 },
    { id: 'and-more', find: S('lifelong consequences for your personal and professional life.</p>'), replace: 'lifelong consequences for your personal and professional life. These are only examples. We can help with these and any other sex-offense charge.</p>', expect: 1 },
  ],
  'homicide': [
    { id: 'h1-rename', find: /(<h1[^>]*>)\s*Homicide Crimes\s*(<\/h1>)/, replace: '$1Violent Crimes$2', expect: 1 },
    { id: 'soften-first-bullet', find: S('Our team will represent you at all stages of the legal process, from pre-trial hearings to the courtroom. We fight to ensure that'), replace: 'Our team can represent you at all stages of the legal process, from pre-trial hearings to the courtroom. We work to ensure that', expect: 1 },
    { id: 'and-more', find: S('or even the death penalty in some jurisdictions.</p>'), replace: 'or even the death penalty in some jurisdictions. These are only examples. We can help with these and any other violent-crime charge.</p>', expect: 1 },
  ],
  'theft': [
    { id: 'remove-definition', find: S('Theft is the unlawful taking of someone else’s property with the intent to permanently deprive them of it. It can take many forms, including'), replace: 'Theft charges can take many forms, including', expect: 1 },
    { id: 'and-more', find: S('or even theft from an employer.'), replace: 'or even theft from an employer, and more. We can help with these and any other theft charge.', expect: 1 },
    { id: 'soften-first-bullet', find: S('We represent you in court, challenging the evidence and ensuring that your rights are upheld at every stage of the process.'), replace: 'We can represent you in court, challenging the evidence and working to ensure that your rights are upheld at every stage of the process.', expect: 1 },
  ],
  'embezzelment': [
    { id: 'soften-first-bullet', find: S('We represent you at all stages of the legal process, from investigation to trial, defending you against embezzlement charges.'), replace: 'We can represent you at all stages of the legal process, from investigation to trial, defending you against embezzlement charges.', expect: 1 },
    { id: 'and-more', find: S('including criminal charges, fines, and imprisonment.</p>'), replace: 'including criminal charges, fines, and imprisonment. These are only examples. We can help with these and any other embezzlement-related charge.</p>', expect: 1 },
  ],
  'fraud': [
    { id: 'remove-definition', find: S('Fraud is the intentional deception for personal gain or to cause harm to another individual or entity. It can take many forms, from'), replace: 'Fraud charges can take many forms, from', expect: 1 },
    { id: 'and-more', find: S('to tax evasion and credit card fraud.'), replace: 'to tax evasion, credit card fraud, and more. We can help with these and any other fraud charge.', expect: 1 },
    { id: 'soften-first-bullet', find: S('We carefully examine every detail of your case, including financial records'), replace: 'We can examine every detail of your case, including financial records', expect: 1 },
  ],
  'u-visas': [
    { id: 'harm-not-abuse', find: S('suffered substantial physical or emotional abuse'), replace: 'suffered physical or emotional harm', expect: 1 },
    { id: 'can-not-will-1', find: S('We will help you determine'), replace: 'We can help you determine', expect: 1 },
    { id: 'can-not-will-2', find: S('We will work with law enforcement agencies'), replace: 'We can work with law enforcement agencies', expect: 1 },
    { id: 'can-not-will-3', find: S('Our team will assist you in preparing and filing'), replace: 'Our team can assist you in preparing and filing', expect: 1 },
  ],
};

// Testimonial scrub: keep first names (and cities / years); drop last names.
const TESTIMONIAL_RULES = [
  ['— Jaime Sanchez, Greeley, CO', '— Jaime, Greeley, CO'],
  ['— Castillo Family, Denver, CO', '— A Client Family, Denver, CO'],
  ['— Justin Johnson', '— Justin'],
  ['— Ramos', '— A Former Client'],
  ['— Dr. David Mirich', '— Dr. David'],
  ['— R.L. Trimmell, Lakewood, CO', '— R.L., Lakewood, CO'],
  ['— Ruben Moreno, Longmont, CO', '— Ruben, Longmont, CO'],
  ['— Juan A. Conejo, Cheyenne, WY', '— Juan A., Cheyenne, WY'],
  ['— Raul Perez and Maria Elena Perez, Thornton, CO', '— Raul and Maria Elena, Thornton, CO'],
  ['— Erica Hernandez', '— Erica'],
  ['— Sarah Stone, Tennis Professional', '— Sarah, Tennis Professional'],
  ['— Dakota Richardson', '— Dakota'],
  ['— Quinlan Borders', '— Quinlan'],
  ['— Monica Flores', '— Monica'],
  ['— Chavela Sanchez', '— Chavela'],
  ['— Olga Escarcega', '— Olga'],
];

// Heading-block removals (whole "Family Law" cards/sections).
const HEADING_REMOVALS = {
  'about': ['Family Law'],
  '': ['Family Law'],
  'greeley-co-lawyer': ['Family Law Representation in Greeley'],
  'brighton-co-attorney': ['Family Law Representation'],
  'espanol': ['Derecho Familiar'],
};

const PAGE_RENAMES = {
  'traffic-crimes': 'Traffic/DUI',
  'drug-crimes': 'Drugs',
  'homicide': 'Violent Crimes',
};

const UNPUBLISH_SLUGS_PHASE1 = ['family-law', 'divorce', 'separation', 'custody', 'adoption'];
const UNPUBLISH_SLUGS_PHASE2 = ['theft', 'embezzelment', 'fraud'];

// ------------------------------------------------------------- new pages ----

function bodyHtml(title, intro1, intro2, whatHeading, whatBody, bullets, closing) {
  const items = bullets
    .map(([label, text]) => `<li><p><strong>${label}:</strong> ${text}</p></li>`)
    .join('');
  return (
    `<h1>${title}</h1>` +
    `<h2>How Marinoff &amp; Associates Can Help</h2>` +
    `<p>${intro1}</p><p>${intro2}</p>` +
    `<h2>${whatHeading}</h2>` +
    `<p>${whatBody} These are only examples. We can help with these and any other related charge.</p>` +
    `<h2>How We Can Help:</h2><ul>${items}</ul>` +
    `<p>${closing}</p>`
  );
}

const NEW_PAGES = [
  {
    slug: 'theft-fraud',
    name: 'Theft/Fraud',
    html: bodyHtml(
      'Theft/Fraud',
      'At Marinoff &amp; Associates, we understand that being accused of theft, fraud, or embezzlement can be a life-altering experience. These charges can affect your reputation, your employment, your professional licenses, and your immigration status, and even a first-time offense deserves a serious, careful defense.',
      'Theft and fraud cases often involve financial records, transactions, workplace relationships, and questions of intent or ownership. Our experienced legal team reviews every detail to identify weaknesses in the prosecution’s case and build the strongest available defense.',
      'What Are Theft &amp; Fraud Charges?',
      'Theft and fraud charges can take many forms, including shoplifting, larceny, auto theft, identity theft, embezzlement, wire fraud, insurance fraud, credit card fraud, and theft or financial misconduct in the workplace, and more.',
      [
        ['Comprehensive Case Review', 'We can examine every detail of your case, including financial records, digital evidence, witness statements, contracts, and police reports, to identify defenses such as lack of intent, mistaken identity, authorization, or insufficient evidence.'],
        ['Court Representation', 'We can represent you at all stages of the legal process, from investigation and pre-trial hearings through trial, working to protect your rights at every step.'],
        ['Negotiations &amp; Settlements', 'In some cases, we may work to negotiate reduced charges or a resolution that minimizes penalties and protects your record.'],
        ['Mitigating Consequences', 'If a conviction cannot be avoided, we explore every opportunity to reduce penalties, including alternatives to incarceration where available.'],
      ],
      'If you or a loved one is facing a theft, fraud, or embezzlement charge, contact Marinoff &amp; Associates today for a consultation.'
    ),
  },
  {
    slug: 'domestic-violence',
    name: 'Domestic Violence',
    html: bodyHtml(
      'Domestic Violence',
      'At Marinoff &amp; Associates, we understand that domestic violence allegations are deeply personal, emotionally charged, and can move through the courts very quickly. An accusation alone can affect where you live, your contact with your children, your right to possess firearms, and your immigration status.',
      'Our experienced legal team approaches these cases with urgency and discretion, examining the full context of the allegation, the evidence, and the procedures followed by law enforcement.',
      'What Are Domestic Violence Charges?',
      'Domestic violence allegations can arise alongside many underlying charges, including assault, harassment, criminal mischief, violation of a protection order, and other offenses involving a current or former intimate partner or household member, and more.',
      [
        ['Immediate Guidance', 'We can advise you from the earliest moments of a case, including arrest, mandatory protection orders, and first court appearances, so early decisions do not compromise your defense.'],
        ['Court Representation', 'We can represent you at every stage of the legal process, from advisement and pre-trial hearings through trial.'],
        ['Protection Order Defense', 'We can help you respond to mandatory and civil protection orders and seek modifications that let you maintain lawful contact with your family and home.'],
        ['Collateral Consequences', 'We can help you understand and work to minimize effects on firearms rights, employment, housing, and immigration status.'],
      ],
      'If you or a loved one is facing a domestic violence allegation, contact Marinoff &amp; Associates today for a consultation.'
    ),
  },
  {
    slug: 'assaults',
    name: 'Assaults',
    html: bodyHtml(
      'Assaults',
      'At Marinoff &amp; Associates, we know that an assault charge can arise from a single moment – an argument, a misunderstanding, or an act of self-defense – and still carry consequences that follow you for years.',
      'Our experienced legal team investigates the full story behind the charge, including witness accounts, injuries, self-defense claims, and police procedure, to build the strongest available defense.',
      'What Are Assault Charges?',
      'Assault charges can range from misdemeanor offenses involving minor injury or threats to serious felony charges involving significant injury or weapons, and more.',
      [
        ['Court Representation', 'We can represent you at all stages of the legal process, from advisement and pre-trial hearings through trial, working to protect your rights at every step.'],
        ['Self-Defense &amp; Justification', 'Where the facts support it, we can develop defenses based on self-defense, defense of others, or lack of intent.'],
        ['Challenging Evidence', 'We can scrutinize witness statements, medical records, video, and police reports for inconsistencies and constitutional violations.'],
        ['Negotiations &amp; Settlements', 'In some cases, we may work to negotiate reduced charges, deferred resolutions, or alternatives that protect your record and future.'],
      ],
      'If you or a loved one is facing an assault charge, contact Marinoff &amp; Associates today for a consultation.'
    ),
  },
  {
    slug: 'restraining-orders',
    name: 'Restraining Orders',
    html: bodyHtml(
      'Restraining Orders',
      'At Marinoff &amp; Associates, we understand that protection order proceedings move fast and the stakes are high on both sides. An order can affect your home, your children, your firearms rights, and your record, often before you have had a chance to tell your side.',
      'Whether you are responding to a protection order that has been filed against you or seeking protection for yourself or your family, our experienced legal team can guide you through the process.',
      'What Are Restraining Order Matters?',
      'Restraining order matters include temporary and permanent civil protection orders, mandatory criminal protection orders, alleged violations of existing orders, and requests to modify or lift orders, and more.',
      [
        ['Hearing Representation', 'We can represent you at protection order hearings, presenting evidence and cross-examining witnesses so the court hears the full story.'],
        ['Responding to an Order', 'If an order has been entered against you, we can help you respond, seek modifications, and work to avoid a permanent order where the facts do not support one.'],
        ['Seeking Protection', 'If you need protection, we can help you prepare and present a clear, well-documented request to the court.'],
        ['Violation Defense', 'If you are accused of violating an order, we can defend the criminal charge and work to minimize its consequences.'],
      ],
      'If you are involved in a protection order matter, contact Marinoff &amp; Associates today for a consultation.'
    ),
  },
  {
    slug: 'federal-crimes',
    name: 'Federal Crimes',
    html: bodyHtml(
      'Federal Crimes',
      'At Marinoff &amp; Associates, we understand that facing a federal investigation or indictment is different from facing state charges. Federal cases involve federal agencies, federal sentencing guidelines, and prosecutors with substantial resources, and they demand an early, strategic defense.',
      'Our experienced legal team can guide you from the first contact by investigators through every stage of a federal case, protecting your rights and your future.',
      'What Are Federal Crimes?',
      'Federal charges can include fraud involving federal programs or interstate commerce, drug conspiracies, firearms offenses, immigration-related offenses, and other crimes prosecuted in federal court, and more.',
      [
        ['Early Intervention', 'If you learn you are under federal investigation, we can engage early, advise you before you speak to investigators, and work to influence charging decisions.'],
        ['Federal Court Representation', 'We can represent you at all stages of a federal case, from initial appearance and detention hearings through trial.'],
        ['Sentencing Advocacy', 'Federal sentencing is driven by detailed guidelines. We can develop mitigation and advocate for the lowest available sentence when that stage cannot be avoided.'],
        ['Parallel Consequences', 'We can help you understand how a federal case may affect immigration status, professional licenses, and assets.'],
      ],
      'If you or a loved one is facing a federal investigation or charge, contact Marinoff &amp; Associates today for a consultation.'
    ),
  },
];

// ------------------------------------------------------------------- main ----

let sb = null;

async function main() {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env.local');
    process.exit(1);
  }
  sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  if (RESTORE_FILE) return restore(RESTORE_FILE);

  const { data: rows, error } = await sb
    .from(TABLE)
    .select('*')
    .eq('project_id', PROJECT_ID)
    .limit(200);
  if (error) { console.error('DB read failed:', error.message); process.exit(1); }
  console.log(`Loaded ${rows.length} pages for Marinoff project.`);

  const pages = rows.map((row) => {
    let doc = row.layout_sections;
    if (typeof doc === 'string') doc = JSON.parse(doc);
    return { row, slug: row.slug || '', doc, dirty: false, newName: null, publish: null };
  });

  if (APPLY) writeBackup(rows);

  if (PHASE === 2) return phase2(pages);
  return phase1(pages);
}

/** Full local backup of every page row, written before any write. */
function writeBackup(rows) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `marinoff_pages_backup_${stamp}.json`);
  writeFileSync(file, JSON.stringify(rows, null, 1));
  console.log(`Backup of ${rows.length} page rows written to ${file}`);
  console.log(`Undo everything with: node scripts/marinoff_punchlist_${STAMP}.mjs --restore ${file}`);
  return file;
}

/** Restore every page row from a backup file (undoes an --apply). */
async function restore(file) {
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`Restoring ${rows.length} page rows from ${file} ...`);
  for (const row of rows) {
    const { error } = await sb
      .from(TABLE)
      .update({
        layout_sections: row.layout_sections,
        name: row.name,
        is_published: row.is_published,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('project_id', PROJECT_ID);
    if (error) { console.error(`restore failed on id ${row.id}:`, error.message); process.exit(1); }
  }
  // Remove draft pages the apply step inserted (slugs not present in the backup).
  const backupSlugs = new Set(rows.map((r) => r.slug));
  for (const spec of NEW_PAGES) {
    if (backupSlugs.has(spec.slug)) continue;
    const { error } = await sb.from(TABLE).delete()
      .eq('project_id', PROJECT_ID).eq('slug', spec.slug).eq('is_published', false);
    if (error) console.error(`could not remove draft "${spec.slug}":`, error.message);
  }
  console.log('Restore complete.');
}

/** Write the phase's changes to the database via the API (same rows as the SQL). */
async function applyChanges(changedPages, inserts) {
  console.log(`\nApplying ${changedPages.length} page updates${inserts.length ? ` and ${inserts.length} draft inserts` : ''} to the live database ...`);
  for (const page of changedPages) {
    const patch = { layout_sections: page.doc, updated_at: new Date().toISOString() };
    if (page.newName) patch.name = page.newName;
    if (page.publish != null) patch.is_published = page.publish;
    const { error } = await sb.from(TABLE).update(patch)
      .eq('id', page.row.id).eq('project_id', PROJECT_ID);
    if (error) { console.error(`update failed on ${page.slug || 'home'} (id ${page.row.id}):`, error.message); process.exit(1); }
    console.log(`  updated ${page.slug || 'home'} (id ${page.row.id})`);
  }
  for (const { spec, doc, template } of inserts) {
    const { data: existing } = await sb.from(TABLE).select('id')
      .eq('project_id', PROJECT_ID).eq('slug', spec.slug).limit(1);
    if (existing && existing.length) { console.log(`  draft ${spec.slug} already exists, skipping`); continue; }
    const { error } = await sb.from(TABLE).insert({
      project_id: PROJECT_ID,
      name: spec.name,
      slug: spec.slug,
      template_kind: template.template_kind,
      theme_id: template.theme_id,
      owner_user_id: template.owner_user_id,
      is_published: false,
      is_private: false,
      layout_sections: doc,
    });
    if (error) { console.error(`insert failed for ${spec.slug}:`, error.message); process.exit(1); }
    console.log(`  inserted draft ${spec.slug} (unpublished)`);
  }
  console.log('Apply complete.');
}

function assertRule(page, rule, count) {
  const expect = rule.expect ?? null;
  if (expect != null && count !== expect) {
    problems.push(`page "${page.slug || 'home'}" rule "${rule.id}": expected ${expect} match(es), got ${count}`);
  }
}

async function phase1(pages) {
  const theftPage = pages.find((p) => p.slug === 'theft');
  if (!theftPage) { console.error('theft page not found'); process.exit(1); }

  for (const page of pages) {
    const before = JSON.stringify(page.doc);

    // 1. global text rules (phones, footer family-law link, old-site tagline)
    for (const rule of GLOBAL_TEXT_RULES) applyTextRule(page, page.doc, rule);
    replacePhonesInSettings(page, page.doc);

    // 2. nav: renames + family-law removal
    transformNav(page, page.doc);

    // 3. language table: MX flag -> Español button
    transformLanguageTable(page, page.doc);

    // 4. heading-block removals (Family Law cards)
    for (const heading of HEADING_REMOVALS[page.slug] ?? []) {
      const ok = applyHeadingBlockRemoval(page, page.doc, heading, `remove-card:${heading}`);
      if (!ok) problems.push(`page "${page.slug || 'home'}": heading card "${heading}" not found`);
    }

    // 5. page-specific rules
    for (const rule of PAGE_TEXT_RULES[page.slug] ?? []) {
      const count = applyTextRule(page, page.doc, rule);
      assertRule(page, rule, count);
    }

    // 6. testimonials scrub
    if (page.slug === 'testimonials') {
      for (const [find, replace] of TESTIMONIAL_RULES) {
        const rule = { id: `testimonial:${find.slice(2, 22)}`, find, replace };
        const count = applyTextRule(page, page.doc, rule);
        if (count === 0) problems.push(`testimonials: "${find}" not found`);
      }
    }

    // 7. renames + unpublish
    if (PAGE_RENAMES[page.slug]) page.newName = PAGE_RENAMES[page.slug];
    if (UNPUBLISH_SLUGS_PHASE1.includes(page.slug)) {
      page.publish = false;
      logChange(page.slug, 'unpublish', 'is_published = true', 'is_published = false (family law retired)');
    }

    page.dirty = JSON.stringify(page.doc) !== before || page.newName != null || page.publish != null;
  }

  // 8. build the five new draft pages from the transformed theft page
  const skeleton = theftPage.doc;
  const headerSection = skeleton.sections[0];
  const contactSection = skeleton.sections[4];
  const footerSection = skeleton.sections[5];
  const inserts = NEW_PAGES.map((spec) => {
    const doc = {
      theme: skeleton.theme,
      pageBackground: skeleton.pageBackground,
      sections: [
        JSON.parse(JSON.stringify(headerSection)),
        {
          id: `section-${spec.slug}-body-${STAMP}`,
          layout: 'single',
          locked: false,
          modules: [{
            id: `module-${spec.slug}-body-${STAMP}`,
            name: '',
            type: 'text',
            column: '',
            text: spec.html,
            settings: {},
          }],
        },
        JSON.parse(JSON.stringify(contactSection)),
        JSON.parse(JSON.stringify(footerSection)),
      ],
    };
    logChange(spec.slug, 'new-page-draft', '(none)', `${spec.name} - inserted UNPUBLISHED for review`);
    return { spec, doc, template: theftPage.row };
  });

  // Safety net: no forbidden string may survive on any page that stays published.
  for (const page of pages) {
    const staysPublished = page.row.is_published !== false && page.publish !== false;
    if (!staysPublished) continue;
    const serialized = JSON.stringify(page.doc);
    for (const re of FORBIDDEN_AFTER_PHASE1) {
      const m = serialized.match(re);
      if (m) {
        const i = serialized.indexOf(m[0]);
        problems.push(`sweep: page "${page.slug || 'home'}" still contains ${re}: …${serialized.slice(Math.max(0, i - 80), i + 80).replace(/\s+/g, ' ')}…`);
      }
    }
  }

  if (problems.length) {
    console.error('\nRULE VALIDATION FAILED:\n - ' + problems.join('\n - '));
    process.exit(1);
  }

  // ------------------------------------------------------------- SQL out ----
  const changed = pages.filter((p) => p.dirty);
  const lines = [];
  lines.push(`-- Marinoff & Associates website punch-list, phase 1 (generated ${new Date().toISOString()})`);
  lines.push(`-- Generator: scripts/marinoff_punchlist_20260717.mjs  (do not hand-edit; re-run the script)`);
  lines.push(`-- Review report: docs/SQL/marinoff_website_edits_${STAMP}_report.md`);
  lines.push('--');
  lines.push('-- STEP 1 - BACKUP (run first, once):');
  lines.push(`--   create table ${BACKUP_TABLE} as select * from ${TABLE} where project_id = ${sqlQuote(PROJECT_ID)};`);
  lines.push('--');
  lines.push('-- STEP 2 - run this whole file. It refuses to run if the backup is missing.');
  lines.push('');
  lines.push('do $$');
  lines.push('begin');
  lines.push(`  if to_regclass('${BACKUP_TABLE}') is null then`);
  lines.push(`    raise exception 'Backup table ${BACKUP_TABLE} not found - create it first (see header).';`);
  lines.push('  end if;');
  lines.push('end $$;');
  lines.push('');
  lines.push('begin;');
  for (const page of changed) {
    const sets = [`layout_sections = ${jsonbLiteral(page.doc)}`];
    if (page.newName) sets.push(`name = ${sqlQuote(page.newName)}`);
    if (page.publish != null) sets.push(`is_published = ${page.publish}`);
    sets.push(`updated_at = now()`);
    lines.push(`-- ${page.slug || 'home'} (id ${page.row.id})`);
    lines.push(`update ${TABLE} set ${sets.join(', ')} where id = ${page.row.id} and project_id = ${sqlQuote(PROJECT_ID)};`);
  }
  for (const { spec, doc } of inserts) {
    lines.push(`-- NEW DRAFT PAGE: ${spec.name} (unpublished until phase 2)`);
    lines.push(
      `insert into ${TABLE} (project_id, name, slug, template_kind, theme_id, owner_user_id, is_published, is_private, layout_sections, created_at, updated_at)\n` +
      `  select ${sqlQuote(PROJECT_ID)}, ${sqlQuote(spec.name)}, ${sqlQuote(spec.slug)}, template_kind, theme_id, owner_user_id, false, false, ${jsonbLiteral(doc)}, now(), now()\n` +
      `  from ${TABLE} where project_id = ${sqlQuote(PROJECT_ID)} and slug = 'theft'\n` +
      `  and not exists (select 1 from ${TABLE} where project_id = ${sqlQuote(PROJECT_ID)} and slug = ${sqlQuote(spec.slug)});`
    );
  }
  lines.push('commit;');
  lines.push('');
  const sqlPath = path.join(OUT_DIR, `marinoff_website_edits_${STAMP}.sql`);
  writeFileSync(sqlPath, lines.join('\n'));

  writeReport(changed.length, inserts.length);
  console.log(`\nPhase 1: ${changed.length} pages updated, ${inserts.length} draft pages inserted.`);
  console.log(`SQL:    ${sqlPath}`);

  if (APPLY) await applyChanges(changed, inserts);
}

async function phase2(pages) {
  // Validate phase 1 ran: family law must already be gone from the live nav.
  const home = pages.find((p) => p.slug === '');
  const homeNav = JSON.stringify(home?.doc ?? {});
  if (homeNav.includes('"Family Law"')) {
    console.error('Phase 2 refused: the live home page still has a Family Law menu - run phase 1 first.');
    process.exit(1);
  }
  for (const slug of NEW_PAGES.map((p) => p.slug)) {
    if (!pages.some((p) => p.slug === slug)) {
      console.error(`Phase 2 refused: draft page "${slug}" not found - run phase 1 first.`);
      process.exit(1);
    }
  }

  for (const page of pages) {
    const before = JSON.stringify(page.doc);
    transformNavPhase2(page, page.doc);
    if (UNPUBLISH_SLUGS_PHASE2.includes(page.slug)) {
      page.publish = false;
      logChange(page.slug, 'unpublish', 'is_published = true', 'is_published = false (merged into Theft/Fraud)');
    }
    if (NEW_PAGES.some((n) => n.slug === page.slug)) {
      page.publish = true;
      logChange(page.slug, 'publish', 'draft', 'is_published = true');
    }
    page.dirty = JSON.stringify(page.doc) !== before || page.publish != null;
  }

  const changed = pages.filter((p) => p.dirty);
  const lines = [];
  lines.push(`-- Marinoff & Associates website punch-list, PHASE 2 (generated ${new Date().toISOString()})`);
  lines.push('-- Publishes the five approved pages, adds them to the Criminal Law menu,');
  lines.push('-- and retires the old Theft / Embezzelment / Fraud tabs (pages unpublished, URLs go away).');
  lines.push('begin;');
  for (const page of changed) {
    const sets = [`layout_sections = ${jsonbLiteral(page.doc)}`];
    if (page.publish != null) sets.push(`is_published = ${page.publish}`);
    sets.push('updated_at = now()');
    lines.push(`-- ${page.slug || 'home'} (id ${page.row.id})`);
    lines.push(`update ${TABLE} set ${sets.join(', ')} where id = ${page.row.id} and project_id = ${sqlQuote(PROJECT_ID)};`);
  }
  lines.push('commit;');
  lines.push('');
  const sqlPath = path.join(OUT_DIR, `marinoff_website_edits_${STAMP}_phase2.sql`);
  writeFileSync(sqlPath, lines.join('\n'));
  writeReport(changed.length, 0, '_phase2');
  console.log(`\nPhase 2: ${changed.length} pages updated.`);
  console.log(`SQL:    ${sqlPath}`);

  if (APPLY) await applyChanges(changed, []);
}

function writeReport(updatedCount, insertedCount, suffix = '') {
  const byPage = new Map();
  for (const c of changes) {
    if (!byPage.has(c.page)) byPage.set(c.page, []);
    byPage.get(c.page).push(c);
  }
  const lines = [];
  lines.push(`# Marinoff website edits - review report${suffix ? ' (phase 2)' : ''}`);
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()} by \`scripts/marinoff_punchlist_${STAMP}.mjs\`.`);
  lines.push(`${updatedCount} pages updated${insertedCount ? `, ${insertedCount} new draft pages inserted (unpublished)` : ''}.`);
  lines.push('');
  lines.push('Every change below, in plain terms: **before → after**.');
  lines.push('');
  for (const [page, list] of [...byPage.entries()].sort()) {
    lines.push(`## ${page || 'home'}`);
    for (const c of list) {
      lines.push(`- **${c.rule}**`);
      lines.push(`  - before: ${c.before}`);
      lines.push(`  - after: ${c.after}`);
    }
    lines.push('');
  }
  const reportPath = path.join(OUT_DIR, `marinoff_website_edits_${STAMP}${suffix}_report.md`);
  writeFileSync(reportPath, lines.join('\n'));
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
