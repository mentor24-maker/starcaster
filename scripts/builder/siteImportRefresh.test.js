'use strict';

/**
 * Importing a site again REFRESHES the pages the first import built (task
 * 86bcynzn5; Dane, 2026-11-04: "real refresh"). Before this a confirmed
 * re-import had no map checkpoint of its own, so building from it put a
 * second set of pages beside the first ("-2" slugs) and twin menus.
 *
 * Two fixture jobs stand in for wavecenter's two captures. The page writes run
 * through the REAL write loop (writeMappedPages + mergeMappedSections, the
 * bundle scripts/site_import_map.mjs loads) against a fake page store, so what
 * is pinned is the outcome: the same pages updated, nothing created, an edited
 * section untouched, the earlier menu updated rather than twinned, and the
 * project's default theme left alone.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  resolveRefreshSource, planRefresh, refreshSummaryLine,
  findHumanModifiedSections, themeMakesDefault,
} = require('../../lib/siteImportRefresh.js');
const { writeMappedPages, mergeMappedSections, planMenuTarget } = require('../../lib/site-import/dist/map.js');
const { saveImportTheme } = require('../../lib/siteImportTheme.js');

const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const section = (id, text) => ({ id, title: id, modules: [{ id: `${id}_m`, type: 'text', text }] });
/** A mapped page as mapSite returns it (only the fields the writer reads). */
const mapped = (key, slug, sections) => ({
  key, irPath: key, name: slug || 'Home', slug,
  sections: sections.map((s) => ({ ...s, sourceElementIds: [], dispositions: { mapped: 1, placeholder: 0 } })),
});

const PROJECT = 'proj_wave';

/** The project as the FIRST import left it, then Dane edited one section. */
function firstImportWorld() {
  const home = [section('imps_pA1', 'Welcome'), section('imps_pA2', 'About us')];
  const signIn = [section('imps_pB1', 'Sign in')];
  const pages = [
    { id: 'page_home', slug: '', layoutSections: home.map((s) => ({ ...s })) },
    { id: 'page_signin', slug: 'sign-in', layoutSections: signIn.map((s) => ({ ...s })) },
  ];
  const sectionHashes = {};
  for (const s of [...home, ...signIn]) sectionHashes[s.id] = fingerprint(s);
  // Dane edits "About us" after the first import.
  pages[0].layoutSections[1] = section('imps_pA2', 'About us — edited by Dane');
  const firstJob = {
    id: 'simp_first',
    projectId: PROJECT,
    sourceUrl: 'https://www.wavecenter.com/',
    finishedAt: '2026-11-04T18:00:00Z',
    checkpoints: {
      normalize: { blobPath: 'https://blob.test/1.json' },
      map: {
        at: '2026-11-04T19:00:00Z',
        pageIds: { '/': 'page_home', '/sign-in': 'page_signin' },
        sectionHashes,
        menus: { top: 'saved_topmenu_1' },
      },
    },
  };
  const secondJob = {
    id: 'simp_second',
    projectId: PROJECT,
    sourceUrl: 'https://wavecenter.com/',
    checkpoints: { normalize: { blobPath: 'https://blob.test/2.json' }, reimportOf: 'simp_first' },
  };
  // What the second capture maps to: same pages, fresher copy of each section.
  const secondMap = [
    mapped('/', '', [section('imps_pA1', 'Welcome (new copy)'), section('imps_pA2', 'About us (new copy)')]),
    mapped('/sign-in', 'sign-in', [section('imps_pB1', 'Sign in (new copy)')]),
  ];
  return { pages, firstJob, secondJob, secondMap };
}

function fakePages(pages) {
  const created = [];
  const updated = [];
  return {
    created,
    updated,
    getPage: async (id) => {
      const p = pages.find((x) => x.id === id);
      return p ? { ...p, layoutSections: p.layoutSections.map((s) => ({ ...s })) } : null;
    },
    createPage: async (page, sections) => {
      const row = { id: `page_new_${created.length + 1}`, slug: `${page.slug}-2`, layoutSections: sections };
      pages.push(row);
      created.push(row);
      return row;
    },
    updatePage: async (page, current, merged) => {
      const row = pages.find((x) => x.id === current.id);
      row.layoutSections = merged;
      updated.push(row.id);
      return row;
    },
  };
}

/** The mapper's refresh path, end to end, minus the network. */
async function buildFrom(world, resolve = resolveRefreshSource) {
  const jobs = new Map([[world.firstJob.id, world.firstJob], [world.secondJob.id, world.secondJob]]);
  const { prior, refresh } = await resolve(world.secondJob, async (id) => jobs.get(id) || null);
  const priorPageIds = prior.pageIds || {};
  const existingPages = world.pages.map((p) => ({ ...p }));
  const modified = findHumanModifiedSections(world.secondMap, {
    priorPageIds, sectionHashes: prior.sectionHashes || {}, existingPages, fingerprint,
  });
  const protectedIds = new Set(modified.map((m) => m.section.id));
  const io = fakePages(world.pages);
  const { pageIds } = await writeMappedPages(world.secondMap, {
    priorPageIds,
    prepareSections: (page) => page.sections.map(({ sourceElementIds, dispositions, ...s }) => s),
    getPage: io.getPage,
    createPage: io.createPage,
    updatePage: io.updatePage,
    mergeSections: (existing, incoming) => mergeMappedSections(existing, incoming, protectedIds),
  });
  return { prior, refresh, modified, io, pageIds, existingPages };
}

test('a re-import updates the earlier import\'s pages and creates none', async () => {
  const world = firstImportWorld();
  const { refresh, io, pageIds } = await buildFrom(world);
  assert.equal(refresh.job.id, 'simp_first');
  assert.equal(io.created.length, 0, 'no second set of pages');
  assert.deepEqual(io.updated.sort(), ['page_home', 'page_signin']);
  assert.equal(world.pages.length, 2);
  assert.deepEqual(pageIds, { '/': 'page_home', '/sign-in': 'page_signin' });
  assert.equal(world.pages[1].layoutSections[0].modules[0].text, 'Sign in (new copy)', 'untouched sections are refreshed');
});

test('a section edited after the first import is kept and reported as edited', async () => {
  const world = firstImportWorld();
  const { modified } = await buildFrom(world);
  assert.deepEqual(modified.map((m) => m.section.id), ['imps_pA2']);
  const home = world.pages.find((p) => p.id === 'page_home');
  assert.equal(home.layoutSections[1].modules[0].text, 'About us — edited by Dane');
  assert.equal(home.layoutSections[0].modules[0].text, 'Welcome (new copy)');
  assert.equal(home.layoutSections.length, 2, 'no section added twice');
});

test('break-test shape: WITHOUT the earlier job\'s checkpoint a second set of pages appears', async () => {
  // This is what the mapper did before the refresh: only the job's own map.
  const ownOnly = async (job) => ({ prior: job.checkpoints.map || {}, refresh: null });
  const world = firstImportWorld();
  const { io } = await buildFrom(world, ownOnly);
  assert.equal(io.created.length, 2);
  assert.equal(world.pages.length, 4);
});

test('the earlier import\'s menu is updated, not twinned', async () => {
  const { prior } = await resolveRefreshSource(firstImportWorld().secondJob, async () => firstImportWorld().firstJob);
  const saved = [{ id: 'saved_topmenu_1', name: 'Top Menu' }];
  const target = planMenuTarget('top', saved, prior.menus.top, 'wavecenter.com');
  assert.deepEqual(target, { action: 'update', id: 'saved_topmenu_1', name: 'Top Menu' });
});

test('the chain is followed to the most recent job that built pages', async () => {
  const world = firstImportWorld();
  const middle = { id: 'simp_middle', projectId: PROJECT, sourceUrl: 'https://wavecenter.com/', checkpoints: { reimportOf: 'simp_first' } };
  const third = { id: 'simp_third', projectId: PROJECT, checkpoints: { reimportOf: 'simp_middle' } };
  const jobs = new Map([['simp_first', world.firstJob], ['simp_middle', middle]]);
  const { refresh } = await resolveRefreshSource(third, async (id) => jobs.get(id) || null);
  assert.equal(refresh.job.id, 'simp_first');
  assert.deepEqual(refresh.chain.map((j) => j.id), ['simp_middle', 'simp_first']);

  // A newer job in the chain that DID build pages wins over an older one.
  middle.checkpoints.map = { pageIds: { '/': 'page_home' }, sectionHashes: {} };
  const again = await resolveRefreshSource(third, async (id) => jobs.get(id) || null);
  assert.equal(again.refresh.job.id, 'simp_middle');
});

test('a job with its own map checkpoint is a re-run, not a refresh', async () => {
  const { firstJob } = firstImportWorld();
  const res = await resolveRefreshSource(firstJob, async () => { throw new Error('must not be asked'); });
  assert.equal(res.refresh, null);
  assert.equal(res.prior, firstJob.checkpoints.map);
});

test('a re-import of a copy that never had pages built is a first build, said out loud', async () => {
  const unbuilt = { id: 'simp_a', projectId: PROJECT, checkpoints: {} };
  const res = await resolveRefreshSource({ id: 'simp_b', projectId: PROJECT, checkpoints: { reimportOf: 'simp_a' } }, async () => unbuilt);
  assert.equal(res.refresh, null);
  assert.deepEqual(res.prior, {});
  assert.deepEqual(res.unbuiltChain.map((j) => j.id), ['simp_a']);
});

test('an unreadable, missing, foreign or looping earlier job refuses rather than building a second set', async () => {
  const job = { id: 'simp_b', projectId: PROJECT, checkpoints: { reimportOf: 'simp_a' } };
  await assert.rejects(resolveRefreshSource(job, async () => { throw new Error('HTTP 503'); }), /could not read the earlier import simp_a this job re-imports: HTTP 503/);
  await assert.rejects(resolveRefreshSource(job, async () => null), /no longer exists/);
  await assert.rejects(resolveRefreshSource(job, async () => ({ id: 'simp_a', projectId: 'other', checkpoints: {} })), /belongs to project other/);
  const loop = { id: 'simp_a', projectId: PROJECT, checkpoints: { reimportOf: 'simp_b' } };
  await assert.rejects(resolveRefreshSource(job, async () => loop), /loops back to simp_b/);
});

test('the dry run opens with the "Refreshing N pages…" line, naming deleted pages it will make again', async () => {
  const world = firstImportWorld();
  const { refresh } = await resolveRefreshSource(world.secondJob, async () => world.firstJob);
  const pages = [...world.secondMap, mapped('/contact', 'contact', [section('imps_pC1', 'Contact')])];
  const existing = world.pages.filter((p) => p.id !== 'page_signin'); // Dane deleted sign-in
  const plan = planRefresh(pages, refresh.job.checkpoints.map.pageIds, existing);
  assert.equal(
    refreshSummaryLine(refresh, plan, 1),
    'Refreshing 1 page built by the import of https://www.wavecenter.com/ on Nov 4, 2026; 1 section you edited will be kept; 1 new page. '
      + '1 page that import built was deleted since and will be made again: /sign-in.'
  );
  const full = planRefresh(world.secondMap, refresh.job.checkpoints.map.pageIds, world.pages);
  assert.match(refreshSummaryLine(refresh, full, 2), /^Refreshing 2 pages built by .*; 2 sections you edited will be kept; 0 new pages\.$/);
});

test('a refresh makes its theme but leaves the project default alone', async () => {
  const world = firstImportWorld();
  const { refresh } = await resolveRefreshSource(world.secondJob, async () => world.firstJob);
  assert.equal(themeMakesDefault(refresh), false);
  assert.equal(themeMakesDefault(null), true, 'a first import still makes its theme the default');

  const themes = [{ id: 'theme_dane', name: 'Dane picked this', isDefault: true }];
  const calls = [];
  const themesStore = {
    createTheme: async (input) => { const row = { ...input, id: 'theme_new', isDefault: false }; themes.push(row); return { ok: true, data: row }; },
    setDefaultTheme: async (id) => { calls.push(id); for (const t of themes) t.isDefault = t.id === id; return { ok: true, data: {} }; },
    listThemes: async () => ({ ok: true, data: themes.map((t) => ({ ...t })) }),
  };
  const plan = { name: 'wavecenter 2', theme: { typography: {} }, previousDefault: themes[0] };
  const saved = await saveImportTheme(plan, { projectId: PROJECT }, {
    makeDefault: themeMakesDefault(refresh),
    deps: { themesStore, normalizeTheme: (t) => t },
  });
  assert.equal(saved.madeDefault, false);
  assert.deepEqual(calls, [], 'setDefaultTheme never called');
  assert.equal(themes.find((t) => t.isDefault).id, 'theme_dane');
});
