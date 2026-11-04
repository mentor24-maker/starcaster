#!/usr/bin/env node
'use strict';

/**
 * ONE-TIME conversion: page links saved as a copied address → page references.
 *
 * Task 86bcxmrw2. The Builder's page picker now stores the page itself
 * (`page:<id>|<fallback>`, lib/builder-client/page-link.js) so that renaming a
 * page cannot break the buttons and links pointing at it. Links saved BEFORE
 * that are still copied addresses ("/about"). They keep working exactly as
 * they did — this only upgrades them, so they follow the page from now on.
 *
 * Dane's decision (2026-11-03): hidden, not a tool he runs. The build session
 * runs it across every project — dry run, read the report, then --apply — and
 * the script is DELETED afterwards. It is not a maintenance tool.
 *
 * RULES
 * - Only the settings the page picker writes are touched (PICKER_FIELDS), plus
 *   the same settings on modules inside a table cell, plus a table cell image's
 *   Link, plus — since task 86bcxmt5x — the link on each item of a menu, card
 *   grid or carousel (LIST_FIELDS). Rich-text links are not touched.
 * - A saved address that matches exactly ONE page's CURRENT address in the
 *   SAME project becomes that page's reference, with the address kept as its
 *   fallback. Anything else is left exactly as it is: an external URL is left
 *   alone silently; an internal-looking address that matches no page (or two)
 *   is LISTED, never guessed at.
 * - --apply writes through the stores and READS EVERY ROW BACK, comparing the
 *   saved sections to what was meant to be written (CLAUDE.md landmine 13:
 *   the page is spread and `layoutSections` goes as the array).
 *
 * Covers pages (builder_landing_page) and saved sections, because a site's
 * header and footer are served from the saved section, not from each page's
 * copy of it.
 *
 *   node scripts/convert_page_links_to_references.js              # dry run, every project
 *   node scripts/convert_page_links_to_references.js --apply      # write + read back
 *   node scripts/convert_page_links_to_references.js --project <id>
 *   node scripts/convert_page_links_to_references.js --json       # machine-readable report
 */

const { makePageLink, isPageLink, collectPageLinkIds } = require('../lib/builder-client/page-link');

/** module type → the settings its page picker writes, and what shape. */
const PICKER_FIELDS = {
  button: { href: 'path' },
  'admin-login': { successRedirect: 'path' },
  'admin-nav-link': { linkHref: 'path' },
  'site-search': { targetPageUrl: 'path' },
  'blog-search': { targetPageUrl: 'path' },
  'blog-post-tags': { targetPageUrl: 'path' },
  'blog-category-filter': { targetPageUrl: 'path' },
  'blog-tag-cloud': { targetPageUrl: 'path' },
  'messaging-topic-list': { targetPageUrl: 'path' },
  'blog-search-results': { postPageUrl: 'path' },
  'blog-post-create': { viewPageUrl: 'path' },
  'blog-post-manager': { editPageUrl: 'path', viewPageUrl: 'path' },
  'event-calendar': { eventPageUrl: 'path' },
  'event-detail': { backLinkUrl: 'path' },
  'event-manager': { viewPageUrl: 'path' },
  'blog-post-list': { postSlug: 'slug' },
  'blog-latest-posts': { postSlug: 'slug' },
  // Task 86bcxmt5x — these had only a typed address box until then.
  image: { linkUrl: 'path' },
  galaxy: { linkUrl: 'path' },
  'blog-post-card': { url: 'path' },
  'blog-post-create': { viewPageUrl: 'path', redirectAfterCreate: 'path' },
};

/**
 * Settings that hold a LIST as JSON text, and the field on each item that is
 * a link (task 86bcxmt5x): a menu's items, a card grid's cards, a carousel's
 * slides. Each item's link is classified exactly like a picker setting.
 */
const LIST_FIELDS = {
  navigation: { navItems: { href: 'path' } },
  'feature-cards': { cards: { linkUrl: 'path' } },
  carousel: { items: { linkUrl: 'path' } },
};

/** Fields that exist only on modules inside a table cell (its own dropdown). */
const TABLE_CELL_FIELDS = { image: { linkUrl: 'path' } };

function normalizeSlug(value) {
  return String(value ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
}

/** slug → [page ids], for one project's pages. Home answers both "" and "home". */
function indexPagesBySlug(pages) {
  const bySlug = new Map();
  for (const page of pages || []) {
    const id = String(page?.id ?? '').trim();
    if (!id) continue;
    const slug = normalizeSlug(page.slug);
    const keys = slug === '' || slug === 'home' ? ['', 'home'] : [slug];
    for (const key of keys) {
      if (!bySlug.has(key)) bySlug.set(key, new Set());
      bySlug.get(key).add(id);
    }
  }
  return bySlug;
}

/**
 * What to do with one saved value.
 * → { action: 'skip' } | { action: 'upgrade', to } | { action: 'unmatched', reason }
 */
function classifyValue(raw, kind, bySlug) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || isPageLink(value)) return { action: 'skip' };
  if (kind === 'path') {
    // An external address, a mail link, an anchor, a merge token: not a page.
    if (!value.startsWith('/') || value.startsWith('//')) return { action: 'skip' };
    if (/[?#]/.test(value)) return { action: 'unmatched', reason: 'carries a query or #anchor, so it is not exactly a page address' };
  } else if (/[/?#:]/.test(value.replace(/^\/+/, ''))) {
    return { action: 'unmatched', reason: 'is not a plain page address' };
  }
  const ids = bySlug.get(normalizeSlug(value));
  if (!ids || ids.size === 0) return { action: 'unmatched', reason: 'matches no page in this project' };
  if (ids.size > 1) return { action: 'unmatched', reason: `matches ${ids.size} pages in this project` };
  const [id] = [...ids];
  return { action: 'upgrade', to: makePageLink(id, value) };
}

function moduleLabel(mod) {
  return String(mod?.name || mod?.type || 'module');
}

/**
 * Convert one module's picker settings (and, for a table, its cells' modules).
 * Returns the module — the SAME object when nothing changed.
 */
function convertModule(mod, bySlug, where, report, inTableCell = false) {
  if (!mod || typeof mod !== 'object') return mod;
  const type = String(mod.type || '');
  const fields = { ...(PICKER_FIELDS[type] || {}), ...(inTableCell ? TABLE_CELL_FIELDS[type] || {} : {}) };
  const settings = mod.settings && typeof mod.settings === 'object' ? mod.settings : {};
  let nextSettings = null;

  for (const [key, kind] of Object.entries(fields)) {
    const verdict = classifyValue(settings[key], kind, bySlug);
    const entry = { where, module: moduleLabel(mod), type, setting: key, value: settings[key] };
    if (verdict.action === 'upgrade') {
      if (!nextSettings) nextSettings = { ...settings };
      nextSettings[key] = verdict.to;
      report.upgraded.push({ ...entry, to: verdict.to });
    } else if (verdict.action === 'unmatched') {
      report.unmatched.push({ ...entry, reason: verdict.reason });
    }
  }

  for (const [key, itemFields] of Object.entries(LIST_FIELDS[type] || {})) {
    const source = nextSettings || settings;
    if (typeof source[key] !== 'string' || !source[key]) continue;
    let items = null;
    try { items = JSON.parse(source[key]); } catch (_) { items = null; }
    if (!Array.isArray(items)) continue;
    let listChanged = false;
    const nextItems = items.map((item, index) => {
      if (!item || typeof item !== 'object') return item;
      let nextItem = null;
      for (const [field, kind] of Object.entries(itemFields)) {
        const verdict = classifyValue(item[field], kind, bySlug);
        const label = item.label || item.title || `item ${index + 1}`;
        const entry = { where, module: moduleLabel(mod), type, setting: `${key} › ${label} › ${field}`, value: item[field] };
        if (verdict.action === 'upgrade') {
          if (!nextItem) nextItem = { ...item };
          nextItem[field] = verdict.to;
          report.upgraded.push({ ...entry, to: verdict.to });
        } else if (verdict.action === 'unmatched') {
          report.unmatched.push({ ...entry, reason: verdict.reason });
        }
      }
      if (!nextItem) return item;
      listChanged = true;
      return nextItem;
    });
    if (listChanged) {
      if (!nextSettings) nextSettings = { ...settings };
      nextSettings[key] = JSON.stringify(nextItems);
    }
  }

  if (type === 'table' && typeof settings.tableData === 'string' && settings.tableData) {
    let data = null;
    try { data = JSON.parse(settings.tableData); } catch (_) { data = null; }
    if (data && data.cells && typeof data.cells === 'object') {
      let cellsChanged = false;
      const cells = {};
      for (const [cellKey, mods] of Object.entries(data.cells)) {
        if (!Array.isArray(mods)) { cells[cellKey] = mods; continue; }
        const next = mods.map((child) => convertModule(child, bySlug, `${where} › table cell ${cellKey}`, report, true));
        if (next.some((child, i) => child !== mods[i])) cellsChanged = true;
        cells[cellKey] = next;
      }
      if (cellsChanged) {
        if (!nextSettings) nextSettings = { ...settings };
        nextSettings.tableData = JSON.stringify({ ...data, cells });
      }
    }
  }

  return nextSettings ? { ...mod, settings: nextSettings } : mod;
}

/** Convert an array of sections. Returns the SAME array when nothing changed. */
function convertSections(sections, bySlug, where, report) {
  if (!Array.isArray(sections)) return sections;
  let changed = false;
  const next = sections.map((section) => {
    if (!section || !Array.isArray(section.modules)) return section;
    const label = `${where} › ${section.title || section.id || 'section'}`;
    const modules = section.modules.map((mod) => convertModule(mod, bySlug, label, report));
    if (modules.every((mod, i) => mod === section.modules[i])) return section;
    changed = true;
    return { ...section, modules };
  });
  return changed ? next : sections;
}

function emptyReport() {
  return { upgraded: [], unmatched: [] };
}

/* ------------------------------------------------------------------ runner */

/**
 * Did the write land? The stores normalize on save (a saved section gains its
 * default settings), so a byte comparison reports a perfectly good write as a
 * failure. What must hold is narrower and exact: every reference meant to be
 * written is in the row now, and the row has as many sections and modules as
 * the one sent — so nothing was dropped on the way (landmine 13).
 */
function readBackProblem(gotSections, wantedSections) {
  const got = Array.isArray(gotSections) ? gotSections : [];
  const wanted = Array.isArray(wantedSections) ? wantedSections : [];
  if (got.length !== wanted.length) return `read back ${got.length} section(s), wrote ${wanted.length}`;
  for (let i = 0; i < wanted.length; i += 1) {
    const g = (got[i]?.modules || []).length;
    const w = (wanted[i]?.modules || []).length;
    if (g !== w) return `section ${i + 1} read back with ${g} module(s), wrote ${w}`;
  }
  const gotIds = collectPageLinkIds(got);
  for (const id of collectPageLinkIds(wanted)) {
    if (!gotIds.has(id)) return `the reference to page ${id} is not in the row read back`;
  }
  return '';
}

function must(res, what) {
  if (!res || res.ok !== true) {
    throw new Error(`${what} failed: ${res?.status || ''} ${res?.error || 'no answer'}`.trim());
  }
  return res.data;
}

async function listProjectIds(sbQuery, tableConfig) {
  const res = await sbQuery({ method: 'GET', table: tableConfig().builderPages, query: 'select=project_id&limit=10000' });
  const rows = must(res, 'listing projects');
  return [...new Set(rows.map((row) => String(row?.project_id || '').trim()).filter(Boolean))].sort();
}

async function convertProject(projectId, { apply, stores }) {
  const { pagesStore, sectionsStore } = stores;
  const scope = { projectId };
  const pages = must(await pagesStore.listPages(5000, scope), `listing pages for ${projectId}`);
  const bySlug = indexPagesBySlug(pages);
  const report = { projectId, pages: pages.length, ...emptyReport(), written: 0, verified: 0, failures: [] };

  for (const page of pages) {
    const next = convertSections(page.layoutSections, bySlug, `page "${page.name || page.slug}"`, report);
    if (next === page.layoutSections || !apply) continue;
    // Landmine 13: spread the page so pageBackground and theme survive, and
    // send layoutSections as the ARRAY. Then read it back before moving on.
    const res = await pagesStore.updatePage(page.id, { ...page, layoutSections: next }, scope, { expectedUpdatedAt: page.updatedAt });
    if (!res?.ok) { report.failures.push(`page ${page.id}: write refused — ${res?.status || ''} ${res?.error || ''}`); continue; }
    report.written += 1;
    const back = await pagesStore.getPage(page.id, scope);
    const problem = back?.ok ? readBackProblem(back.data.layoutSections, next) : 'could not be read back';
    if (!problem) report.verified += 1;
    else report.failures.push(`page ${page.id}: ${problem}`);
  }

  const sections = must(await sectionsStore.listSavedSections(5000, scope), `listing saved sections for ${projectId}`);
  report.savedSections = sections.length;
  for (const saved of sections) {
    if (!saved?.section) continue;
    const [nextSection] = convertSections([saved.section], bySlug, `saved section "${saved.name || saved.id}"`, report);
    if (nextSection === saved.section || !apply) continue;
    const res = await sectionsStore.updateSavedSection(saved.id, { ...saved, section: nextSection }, scope);
    if (!res?.ok) { report.failures.push(`saved section ${saved.id}: write refused — ${res?.status || ''} ${res?.error || ''}`); continue; }
    report.written += 1;
    const back = await sectionsStore.getSavedSection(saved.id, scope);
    const problem = back?.ok ? readBackProblem([back.data.section], [nextSection]) : 'could not be read back';
    if (!problem) report.verified += 1;
    else report.failures.push(`saved section ${saved.id}: ${problem}`);
  }
  return report;
}

function printReport(reports, apply) {
  const lines = [];
  lines.push(apply ? 'APPLIED — every write read back.' : 'DRY RUN — nothing written.');
  for (const r of reports) {
    lines.push('');
    lines.push(`Project ${r.projectId}: ${r.pages} page(s), ${r.savedSections} saved section(s)`);
    lines.push(`  links upgraded to page references: ${r.upgraded.length}${apply ? ` (rows written ${r.written}, read back OK ${r.verified})` : ''}`);
    for (const u of r.upgraded) lines.push(`    ✓ ${u.where} › ${u.module} — ${u.setting}: ${u.value}`);
    lines.push(`  links left as they are (no single matching page): ${r.unmatched.length}`);
    for (const u of r.unmatched) lines.push(`    • ${u.where} › ${u.module} — ${u.setting}: ${u.value} (${u.reason})`);
    for (const f of r.failures) lines.push(`  ✗ ${f}`);
  }
  return lines.join('\n');
}

async function main(argv) {
  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  const projectArg = argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : '';
  const { sbQuery, tableConfig } = require('../lib/supabase');
  const stores = {
    pagesStore: require('../lib/builderPagesStore'),
    sectionsStore: require('../lib/builderSavedSectionsStore'),
  };
  const projects = projectArg ? [projectArg] : await listProjectIds(sbQuery, tableConfig);
  const reports = [];
  for (const projectId of projects) reports.push(await convertProject(projectId, { apply, stores }));
  console.log(json ? JSON.stringify(reports, null, 2) : printReport(reports, apply));
  return reports.some((r) => r.failures.length) ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { console.error(`convert_page_links_to_references: ${err.message}`); process.exit(2); }
  );
}

module.exports = {
  PICKER_FIELDS,
  LIST_FIELDS,
  indexPagesBySlug,
  classifyValue,
  convertModule,
  convertSections,
  convertProject,
  emptyReport,
  printReport,
  readBackProblem,
};
