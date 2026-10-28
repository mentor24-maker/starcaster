'use strict';

/**
 * The import theme on its own — derive it from a completed Site Import job,
 * show it, and save it, WITHOUT re-running the page import (task 86bctakkk).
 *
 * Until 2026-10-27 theme creation only existed as a step inside
 * `scripts/site_import_map.mjs --apply`, so a project whose pages were built
 * without a theme (Alphire) could only get one by re-touching all 17 pages.
 * This module is now the one place an import theme is made: the mapper's
 * --apply, its --theme-only mode and the Site Import screen's "Create theme
 * from this import" action all call it, so the three cannot drift apart.
 *
 * It never overwrites a theme: the name is the next free "<site> N" against
 * the project's current themes ("alphire 1", then "alphire 2"), so a theme
 * somebody already adjusted is left exactly as it is.
 *
 * Every dependency is injectable for the tests; the defaults are the real
 * stores. The derivation lives in lib/site-import/dist/theme.js, generated
 * from lib/site-import/theme.ts by `npm run build:site-import` (part of the
 * full build), so it is loaded lazily — a missing bundle fails this call
 * with a message naming the fix, not the whole server at startup.
 */

function defaultDeps() {
  return {
    themesStore: require('./builderThemesStore.js'),
    themeLib: require('./site-import/dist/theme.js'),
    normalizeTheme: require('./builder/template.js').normalizeTheme,
    fetchJson: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching the import's captured site`);
      return res.json();
    },
  };
}

function resolveDeps(deps) {
  if (deps && deps.themesStore && deps.themeLib && deps.normalizeTheme && deps.fetchJson) return deps;
  let base;
  try {
    base = defaultDeps();
  } catch (err) {
    throw new Error(`The import theme code is not built on this server (${err.message}). Run npm run build.`);
  }
  return { ...base, ...(deps || {}) };
}

function must(res, what) {
  if (!res || res.ok === false) throw new Error(`${what}: ${res?.error || `status ${res?.status}`}`);
  return res.data;
}

/** The captured site a job's theme is derived from, or a plain reason why
 *  there is none yet. */
function irUrlFor(job) {
  return job?.checkpoints?.normalize?.blobPath || '';
}

/**
 * Derive the theme a job WOULD create, writing nothing. Pass `ir` when the
 * caller already loaded it (the mapper), else it is fetched from the job.
 * Returns { name, theme, notes, existingThemes, previousDefault }.
 */
async function planImportTheme(job, scope, { ir, deps } = {}) {
  const d = resolveDeps(deps);
  let captured = ir;
  if (!captured) {
    const url = irUrlFor(job);
    if (!url) throw Object.assign(new Error('This import has not finished capturing the site yet, so there is nothing to make a theme from.'), { code: 'NOT_CAPTURED' });
    captured = await d.fetchJson(url);
  }
  const existingThemes = must(await d.themesStore.listThemes(1000, scope), 'list themes');
  const name = d.themeLib.nextThemeName(d.themeLib.siteNameFromUrl(job.sourceUrl), existingThemes.map((t) => t.name));
  const theme = d.themeLib.deriveImportTheme(captured, name);
  return {
    name,
    theme,
    notes: theme.notes || [],
    existingThemes,
    previousDefault: existingThemes.find((t) => t.isDefault) || null,
  };
}

/**
 * Save a planned theme as a NEW theme, optionally make it the project
 * default, and READ IT BACK — an insert that "succeeds" can still land with
 * no tenant (landmine 12), so success is the row being in this project's
 * list, not the insert's answer. Returns the checkpoint the job records.
 */
async function saveImportTheme(plan, scope, { makeDefault = true, deps } = {}) {
  const d = resolveDeps(deps);
  const { notes, typography, ...top } = plan.theme;
  const created = must(await d.themesStore.createTheme({
    ...top,
    name: plan.name,
    typography: d.normalizeTheme({ typography }).typography,
  }, scope), `create theme "${plan.name}"`);
  if (makeDefault) must(await d.themesStore.setDefaultTheme(created.id, scope), `make "${plan.name}" the default`);
  const after = must(await d.themesStore.listThemes(1000, scope), 're-read themes');
  const mine = after.find((t) => t.id === created.id);
  if (!mine) throw new Error(`theme "${plan.name}" (${created.id}) was created but is not in this project's theme list — check its project_id.`);
  if (makeDefault && !mine.isDefault) throw new Error(`theme "${plan.name}" was created but is not the project default.`);
  return {
    id: created.id,
    name: plan.name,
    madeDefault: Boolean(makeDefault),
    previousDefaultId: plan.previousDefault?.id || '',
    previousDefaultName: plan.previousDefault?.name || '',
  };
}

/** The plain-English undo line for a saved theme. */
function undoLine(checkpoint) {
  if (!checkpoint.madeDefault) return `"${checkpoint.name}" was not made the default, so nothing on the site changed. Delete it in Builder > Themes if it is not wanted.`;
  return checkpoint.previousDefaultId
    ? `To undo: make "${checkpoint.previousDefaultName}" (${checkpoint.previousDefaultId}) the default again in Builder > Themes.`
    : 'There was no default theme before this one.';
}

module.exports = { planImportTheme, saveImportTheme, undoLine, irUrlFor };
