'use strict';

/**
 * The reads behind GET /api/fonts/:id/usage (Font Library 6/7, task 86bchyd4p).
 * The matching itself is lib/fontUsage.js, which is pure and tested on its own.
 *
 * ON DEMAND, ONE FONT AT A TIME. The Fonts screen asks this only when a row's
 * Used by Sites cell is opened, never on screen load: one call reads every
 * public page it is allowed to list, and doing that for each of hundreds of
 * fonts every time the screen opened would be the slow screen the ticket
 * names as the risk.
 *
 * WHAT A VISITOR IS SERVED IS WHAT IS SEARCHED. A page with a published build
 * is served the build (lib/publishedPageRead.js), so its build is searched; a
 * page never published is served its draft, resolved with the theme it
 * renders by (pickThemeForPage — the default theme for a page with none of
 * its own, exactly as routes/themeUsage.js counts it). Draft and private
 * pages are never listed: the store filters them before matching.
 *
 * Every read is checked. A read that fails fails the whole answer rather than
 * listing fewer sites — "used nowhere" from a read that did not happen is the
 * false all-clear docs/DOCTRINE.md §3.11 is about.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { getFont } = require('./fontsStore');
const { usageProjectIds, findFontUsage } = require('./fontUsage');

const PROJECTS_TABLE = String(process.env.SUPABASE_PROJECTS_TABLE || 'app_projects').trim();
const PAGE_BATCH = 200;
const BUILD_BATCH = 50;
/** More public pages than this and the answer says it stopped short. */
const MAX_PAGES = 5000;

function inFilter(column, ids) {
  return `${column}=in.(${ids.map((id) => encodeURIComponent(`"${String(id).replace(/"/g, '')}"`)).join(',')})`;
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function parseJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
}

async function readPublicPages(projectIds) {
  const { filterPublicSitePages } = require('./publicSitePageFilter');
  const tableName = tableConfig().builderPages;
  const scopeFilter = projectIds ? `&${inFilter('project_id', projectIds)}` : '';
  const rows = [];
  for (let offset = 0; offset < MAX_PAGES; offset += PAGE_BATCH) {
    const res = await sbQuery({
      method: 'GET',
      table: tableName,
      query:
        'select=id,project_id,name,slug,theme_id,layout_sections'
        + '&or=(is_published.eq.true,is_published.is.null)&is_private=eq.false'
        + `${scopeFilter}&order=id.asc&limit=${PAGE_BATCH}&offset=${offset}`,
    });
    if (!res.ok) return res;
    const batch = Array.isArray(res.data) ? res.data : [];
    rows.push(...batch);
    if (batch.length < PAGE_BATCH) {
      return { ok: true, status: 200, data: filterPublicSitePages(rows.map(rowToUsagePage)), truncated: false };
    }
  }
  return { ok: true, status: 200, data: filterPublicSitePages(rows.map(rowToUsagePage)), truncated: true };
}

function rowToUsagePage(row) {
  return {
    id: String(row?.id ?? ''),
    projectId: String(row?.project_id ?? ''),
    name: String(row?.name ?? ''),
    slug: String(row?.slug ?? ''),
    themeId: String(row?.theme_id ?? '').trim(),
    layoutSections: parseJson(row?.layout_sections),
  };
}

/** Each project's themes in listThemes' order (default first), for pickThemeForPage. */
async function readThemesByProject(projectIds) {
  const { rowToTheme, orderDefaultThemeFirst } = require('./builderThemesStore');
  const groups = new Map();
  for (const ids of chunks(projectIds, BUILD_BATCH)) {
    const res = await sbQuery({
      method: 'GET',
      table: tableConfig().builderThemes,
      query: `select=*&${inFilter('project_id', ids)}&order=updated_at.desc,created_at.desc&limit=5000`,
    });
    if (!res.ok) return res;
    for (const row of Array.isArray(res.data) ? res.data : []) {
      const key = String(row?.project_id ?? '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
  }
  const themes = new Map();
  for (const [projectId, rows] of groups) {
    themes.set(projectId, orderDefaultThemeFirst(rows, rows.map(rowToTheme)));
  }
  return { ok: true, status: 200, data: themes };
}

async function readBuilds(pageIds) {
  const builds = new Map();
  for (const ids of chunks(pageIds, BUILD_BATCH)) {
    const res = await sbQuery({
      method: 'GET',
      table: tableConfig().builderPublishedPages,
      query: `select=page_id,payload&${inFilter('page_id', ids)}&limit=${BUILD_BATCH}`,
    });
    if (!res.ok) return res;
    for (const row of Array.isArray(res.data) ? res.data : []) {
      const payload = parseJson(row?.payload);
      if (payload && typeof payload === 'object') builds.set(String(row.page_id), payload);
    }
  }
  return { ok: true, status: 200, data: builds };
}

async function readProjects(projectIds) {
  const projects = new Map();
  for (const ids of chunks(projectIds, BUILD_BATCH)) {
    const res = await sbQuery({
      method: 'GET',
      table: PROJECTS_TABLE,
      query: `select=id,name,domain&${inFilter('id', ids)}&limit=${BUILD_BATCH}`,
    });
    if (!res.ok) return res;
    for (const row of Array.isArray(res.data) ? res.data : []) {
      projects.set(String(row.id), { name: row.name, domain: row.domain });
    }
  }
  return { ok: true, status: 200, data: projects };
}

/** Projects whose own upload has this slug: there "lf:<slug>" means THEIR font. */
async function readShadowingProjects(font) {
  if (font.visibility !== 'platform' || !font.slug) return { ok: true, status: 200, data: new Set() };
  const res = await sbQuery({
    method: 'GET',
    table: 'fonts',
    query: `select=project_id&slug=eq.${encodeURIComponent(font.slug)}&visibility=eq.project&limit=1000`,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: new Set((Array.isArray(res.data) ? res.data : []).map((row) => String(row.project_id || ''))),
  };
}

/**
 * The published, public pages using one font, grouped by site.
 * Returns `{ ok, status, data: { font, sites, totalPages, truncated } }`.
 */
async function getFontUsage(fontId, scope) {
  const fontRes = await getFont(fontId, scope);
  if (!fontRes.ok) return fontRes;
  const font = fontRes.data;

  const pagesRes = await readPublicPages(usageProjectIds(font, scope?.projectId));
  if (!pagesRes.ok) return pagesRes;
  const pages = pagesRes.data;

  const projectIds = Array.from(new Set(pages.map((page) => page.projectId).filter(Boolean)));
  const [themesRes, buildsRes, projectsRes, shadowRes] = await Promise.all([
    readThemesByProject(projectIds),
    readBuilds(pages.map((page) => page.id)),
    readProjects(projectIds),
    readShadowingProjects(font),
  ]);
  for (const res of [themesRes, buildsRes, projectsRes, shadowRes]) if (!res.ok) return res;

  const { pickThemeForPage } = require('./builderPagesStore');
  const withThemes = pages.map((page) => ({
    ...page,
    themeTypography: pickThemeForPage(page, themesRes.data.get(page.projectId) || [])?.typography ?? null,
  }));

  const usage = findFontUsage({
    font,
    pages: withThemes,
    builds: buildsRes.data,
    projects: projectsRes.data,
    libraryShadowedIn: shadowRes.data,
  });
  return {
    ok: true,
    status: 200,
    data: {
      font: { id: font.id, family: font.family, slug: font.slug },
      ...usage,
      truncated: Boolean(pagesRes.truncated),
    },
  };
}

module.exports = { getFontUsage };
