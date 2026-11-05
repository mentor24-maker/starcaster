'use strict';

/**
 * Forms on sites imported BEFORE forms were rebuilt (task 86bcynk0e).
 *
 * Strands Movie was imported on 2026-10-11, when every source form became a
 * `code` placeholder carrying a screenshot. `site_import_map.mjs --forms-only`
 * swaps those placeholders for Form modules. These tests pin the pure half in
 * lib/siteImportForms.js — which placeholders it may touch, what it leaves
 * alone and why, and that the swap moves nothing else on the page — using the
 * REAL mapper (lib/site-import/dist/map.js) over the real Strands form markup,
 * so the plans are exactly the ones a full import makes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mapSite } = require('../../lib/site-import/dist/map.js');
const {
  planFormsOnly, replaceFormPlaceholders, formsOnlyLinkPlans, checkFormLinks, isFormPlaceholder,
} = require('../../lib/siteImportForms.js');

const STRANDS_FORM = fs.readFileSync(path.join(__dirname, 'fixtures', 'forms', 'strands-mailpoet.html'), 'utf8');
const SEARCH_FORM = fs.readFileSync(path.join(__dirname, 'fixtures', 'forms', 'search.html'), 'utf8');

function el(sourceId, cls, html, textContent = '') {
  return {
    sourceId, class: cls, html, textContent, textLength: textContent.length,
    computedStyles: {}, documentPosition: 0, depth: 1, assetRefs: [],
    ...(cls === 'form' ? { screenshot: `https://blob.test/shots/${sourceId}.png` } : {}),
  };
}

function irPage(pathName, title, elements) {
  return {
    url: `https://strandsmovie.com${pathName}`, path: pathName, title,
    metaDescription: '', ogTags: {}, canonicalUrl: '', lang: 'en',
    screenshots: { desktop: '', tablet: '', mobile: '' },
    sections: [{ sourceId: `${title}-sec`, type: 'unknown', screenshot: '', elements }],
  };
}

const IR = {
  irVersion: '1.0', jobId: 'job-forms', sourceUrl: 'https://www.strandsmovie.com/',
  capturedAt: '2026-11-05T00:00:00.000Z', assets: [],
  taxonomy: { navs: [], pageOrder: ['/', '/join-the-crew/'] },
  rawTokens: { colors: [], fontSizes: [], fontFamilies: [], spacing: [] },
  pages: [
    irPage('/', 'Strands Movie', [
      el('0-abeb3fed', 'form', STRANDS_FORM),
      el('0-search', 'form', SEARCH_FORM),
    ]),
    irPage('/join-the-crew/', 'Join the Crew', [
      el('20-2f8a133e', 'form', STRANDS_FORM.replace(/mailpoet_form_1/g, 'mailpoet_form_7')),
    ]),
  ],
};

const SOURCE_HTML = new Map();
for (const p of IR.pages) for (const s of p.sections) for (const e of s.elements) SOURCE_HTML.set(e.sourceId, e.html);

/** A placeholder exactly as the October import wrote it: screenshot + in-page caption, margins, right column. */
function oldPlaceholder(id, sourceId) {
  return {
    id, type: 'code', column: 'right', name: 'Imported form',
    text: `<img src="https://blob.test/SiteImportApplied/proj/crops/${sourceId}.png" alt="Screenshot of imported form" style="max-width:100%" /><p><em>Imported form — rebuild with a real module.</em></p>`,
    settings: {
      label: 'Imported form', snippetMode: 'html', importClass: 'form', importSourceId: sourceId,
      importSourceHtml: SOURCE_HTML.get(sourceId), marginTop: '0', marginRight: '0', marginBottom: '0', marginLeft: '0',
    },
  };
}

/** Strands' home page as it is in production: a person added sections around the import's. */
function livePages() {
  return [
    {
      id: '1497', slug: 'home', isPublished: true,
      layoutSections: [
        { id: 'section-dane-added', modules: [{ id: 'm-h', type: 'heading', text: 'Welcome', settings: {} }] },
        {
          id: 'imps_004c07a43b1',
          modules: [
            { id: 'm-t', type: 'text', text: '<p>Join us</p>', settings: {} },
            oldPlaceholder('impm_0abeb3fed_5', '0-abeb3fed'),
            oldPlaceholder('impm_0search_6', '0-search'),
          ],
        },
      ],
    },
    {
      id: '1517', slug: 'join-the-crew', isPublished: false,
      layoutSections: [{ id: 'imps_2004c07a43', modules: [oldPlaceholder('impm_202f8a133e_316', '20-2f8a133e')] }],
    },
  ];
}

const mapOut = () => mapSite(JSON.parse(JSON.stringify(IR)), { existingSlugs: [], menus: false });

test('finds the old form screenshots and plans ONE form for the sign-up on two pages', () => {
  const plan = planFormsOnly(livePages(), mapOut(), SOURCE_HTML);
  assert.deepEqual(plan.replacements.map((r) => `${r.slug}:${r.moduleId}`), ['home:impm_0abeb3fed_5', 'join-the-crew:impm_202f8a133e_316']);
  assert.equal(plan.plans.length, 1, 'one distinct form');
  assert.equal(new Set(plan.replacements.map((r) => r.planKey)).size, 1);
  const form = plan.plans[0];
  assert.equal(form.submitLabel, 'Join the Crew!');
  assert.deepEqual(form.fields.map((f) => f.key).sort(), ['first_name', 'last_name', 'email', form.fields.find((f) => f.type === 'radio').key].sort());
  assert.equal(form.fields.find((f) => f.type === 'radio').options.length, 11);
  assert.equal(plan.leftAlone.length, 0);
  assert.equal(plan.missing.length, 0);
});

test('a search box stays a picture, with the reason', () => {
  const plan = planFormsOnly(livePages(), mapOut(), SOURCE_HTML);
  assert.equal(plan.pictures.length, 1);
  assert.equal(plan.pictures[0].moduleId, 'impm_0search_6');
  assert.match(plan.pictures[0].reason, /search/);
});

test('a placeholder a person changed is left alone and named', () => {
  const pages = livePages();
  pages[0].layoutSections[1].modules[1].text = '<p>My own sign-up embed</p>';
  pages[1].layoutSections[0].modules[0].settings.importSourceHtml = '<form><input name="x"></form>';
  const plan = planFormsOnly(pages, mapOut(), SOURCE_HTML);
  assert.equal(plan.replacements.length, 0);
  assert.deepEqual(plan.leftAlone.map((l) => l.slug), ['home', 'join-the-crew']);
  assert.match(plan.leftAlone[0].reason, /snippet was changed/);
  assert.match(plan.leftAlone[1].reason, /source markup/);
  assert.equal(plan.plans.length, 0, 'no form is made for placeholders nobody may swap');
});

test('a placeholder a person removed is named and never put back', () => {
  const pages = livePages();
  pages[1].layoutSections[0].modules = [{ id: 'mine', type: 'text', text: '<p>Email us</p>', settings: {} }];
  const plan = planFormsOnly(pages, mapOut(), SOURCE_HTML);
  assert.deepEqual(plan.replacements.map((r) => r.slug), ['home']);
  assert.deepEqual(plan.missing.map((m) => m.pagePath), ['/join-the-crew/']);
});

test('the swap changes only the placeholder — the person\'s sections, the text beside it and the search picture stay', () => {
  const pages = livePages();
  const before = JSON.parse(JSON.stringify(pages[0].layoutSections));
  const plan = planFormsOnly(pages, mapOut(), SOURCE_HTML);
  const formIds = { [plan.plans[0].key]: 'crmf_strands' };
  const next = replaceFormPlaceholders(pages[0].layoutSections, plan.replacements.filter((r) => r.pageId === '1497'), formIds);

  assert.deepEqual(pages[0].layoutSections, before, 'input not mutated');
  assert.equal(next.length, before.length);
  assert.deepEqual(next[0], before[0], 'the section Dane added is untouched');
  assert.deepEqual(next[1].modules[0], before[1].modules[0], 'the text beside it is untouched');
  assert.deepEqual(next[1].modules[2], before[1].modules[2], 'the search picture is untouched');
  const form = next[1].modules[1];
  assert.equal(form.id, 'impm_0abeb3fed_5', 'keeps its id, so it sits where the picture sat');
  assert.equal(form.type, 'crm-form');
  assert.equal(form.column, 'right');
  assert.equal(form.text, '');
  assert.equal(form.settings.crmFormId, 'crmf_strands');
  assert.equal(form.settings.importFormKey, plan.plans[0].key);
  assert.equal(form.settings.marginTop, '0');
  assert.equal(form.settings.importSourceHtml, undefined, 'no screenshot markup rides along');

  const links = checkFormLinks(formsOnlyLinkPlans(plan.plans, plan.replacements.filter((r) => r.pageId === '1497')), formIds, new Map([['1497', { layoutSections: next }]]));
  assert.deepEqual(links.problems, []);
  assert.equal(links.checked, 1);
});

test('a second pass finds nothing to swap and says the forms are already there', () => {
  const pages = livePages();
  const out = mapOut();
  const plan = planFormsOnly(pages, out, SOURCE_HTML);
  const formIds = { [plan.plans[0].key]: 'crmf_strands' };
  for (const page of pages) {
    page.layoutSections = replaceFormPlaceholders(page.layoutSections, plan.replacements.filter((r) => r.pageId === page.id), formIds);
  }
  const again = planFormsOnly(pages, out, SOURCE_HTML);
  assert.equal(again.replacements.length, 0);
  assert.equal(again.plans.length, 0);
  assert.equal(again.alreadyForms.length, 2);
  assert.equal(again.missing.length, 0, 'a swapped form is not reported as removed');
});

test('refuses to place a Form module with no form behind it', () => {
  const pages = livePages();
  const plan = planFormsOnly(pages, mapOut(), SOURCE_HTML);
  assert.throws(() => replaceFormPlaceholders(pages[0].layoutSections, plan.replacements, {}), /no form id/);
});

test('only form placeholders count — another kind of picture, or a code module somebody wrote, does not', () => {
  assert.equal(isFormPlaceholder({ type: 'code', settings: { importSourceId: 't', importClass: 'table', importSourceHtml: '<table></table>' } }), false);
  assert.equal(isFormPlaceholder({ type: 'code', settings: { importSourceHtml: '<form></form>' } }), false, 'no import source id: not the import\'s');
  assert.equal(isFormPlaceholder({ type: 'code', settings: { importSourceId: 'f', importClass: 'form', importSourceHtmlUrl: 'https://blob.test/f.html' } }), true, 'source too big to keep inline');
  assert.equal(isFormPlaceholder({ type: 'text', settings: { importSourceId: 'f', importSourceHtml: '<form>' } }), false);
});

test('--skip-form keeps a form a picture: not swapped, no form made for it, and named', () => {
  const out = mapOut();
  const key = planFormsOnly(livePages(), out, SOURCE_HTML).plans[0].key;
  const plan = planFormsOnly(livePages(), out, SOURCE_HTML, { skip: new Set([key]) });
  assert.equal(plan.replacements.length, 0);
  assert.equal(plan.plans.length, 0);
  assert.deepEqual(plan.vetoed.map((v) => v.slug), ['home', 'join-the-crew']);
  assert.equal(plan.missing.length, 0, 'a vetoed form is still on its page, not "removed"');
});
