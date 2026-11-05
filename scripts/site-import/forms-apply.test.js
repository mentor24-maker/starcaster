'use strict';

/**
 * Imported forms become real Starcaster forms (task 86bcynjx2).
 *
 * The mapper turns each source form that collects something into a Form
 * (`crm-form`) module plus one plan per DISTINCT form; lib/siteImportForms.js
 * writes the plans — add-only on the CRM, one form per source form, a re-run
 * updating its own forms rather than making twins. The stores are in-memory
 * fakes with the real stores' calling shape (row or null, never an envelope),
 * and they clean styles and messages the way lib/crmFormsStore.js does — so a
 * fingerprint test cannot pass because the fake stored something the real
 * store would have rewritten.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mapSite, reportReconciles } = require('../../lib/site-import/dist/map.js');
const { serializeBuilderDocument } = require('../../lib/builder/document.js');
const {
  applyImportForms, planCrmFields, fillFormIds, checkFormLinks,
} = require('../../lib/siteImportForms.js');
const { normalizeCrmFormStyles, mergeCrmFormStylesPatch } = require('../../lib/crmFormStyles.js');

const STRANDS_FORM = fs.readFileSync(path.join(__dirname, 'fixtures', 'forms', 'strands-mailpoet.html'), 'utf8');
const SEARCH_FORM = fs.readFileSync(path.join(__dirname, 'fixtures', 'forms', 'search.html'), 'utf8');

function el(sourceId, cls, html, textContent = '') {
  return {
    sourceId, class: cls, html, textContent, textLength: textContent.length,
    computedStyles: {}, documentPosition: 0, depth: 1, assetRefs: [],
    ...(cls === 'form' ? { screenshot: `https://blob.test/shots/${sourceId}.png` } : {}),
  };
}

function page(pathName, title, elements) {
  return {
    url: `https://strandsmovie.com${pathName}`, path: pathName, title,
    metaDescription: '', ogTags: {}, canonicalUrl: '', lang: 'en',
    screenshots: { desktop: '', tablet: '', mobile: '' },
    sections: [{ sourceId: `${title}-sec`, type: 'unknown', screenshot: '', elements }],
  };
}

/** Strands' sign-up form on two pages, and a search box on one. */
function fixtureIr() {
  return {
    irVersion: '1.0', jobId: 'job-forms', sourceUrl: 'https://www.strandsmovie.com/',
    capturedAt: '2026-11-05T00:00:00.000Z', assets: [],
    taxonomy: { navs: [], pageOrder: ['/', '/about/'] },
    rawTokens: { colors: [], fontSizes: [], fontFamilies: [], spacing: [] },
    pages: [
      page('/', 'Strands Movie', [
        el('h-1', 'heading', '<h1>Join us</h1>', 'Join us'),
        el('h-form', 'form', STRANDS_FORM),
      ]),
      page('/about/', 'About', [
        el('a-1', 'text', '<p>About the film.</p>', 'About the film.'),
        // The same sign-up again — a footer copy, its markup ids renumbered.
        el('a-form', 'form', STRANDS_FORM.replace(/mailpoet_form_1/g, 'mailpoet_form_7')),
        el('a-search', 'form', SEARCH_FORM),
      ]),
    ],
  };
}

const SCOPE = { projectId: 'proj_strands', userId: 'user_dane' };

/** In-memory CRM + forms stores with the real stores' shape: row or null. */
function fakeStores({ configs = [], untenanted = false } = {}) {
  const state = { configs: configs.map((c) => JSON.parse(JSON.stringify(c))), forms: [], seq: 0, calls: { createForm: 0, updateForm: 0, createConfig: 0 } };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const configStore = {
    async listConfigs() { return copy(state.configs); },
    async createConfig(input, scope) {
      state.calls.createConfig += 1;
      const c = { id: `crmc_${++state.seq}`, projectId: scope.projectId, ownerUserId: scope.userId, name: input.name, standardFields: input.standardFields, customFields: input.customFields };
      state.configs.unshift(c);
      return copy(c);
    },
    async updateConfig(id, input) {
      const c = state.configs.find((x) => x.id === id);
      if (!c) return null;
      Object.assign(c, input);
      return copy(c);
    },
  };
  // What the real store's sanitize() does to a row on every read and write.
  const clean = (f) => Object.assign(f, {
    styles: normalizeCrmFormStyles(f.styles),
    successMessage: String(f.successMessage || 'Thank you! Your information has been saved.'),
    errorMessage: String(f.errorMessage || 'Something went wrong. Please try again.'),
  });
  const formsStore = {
    async createForm(input, scope) {
      state.calls.createForm += 1;
      const f = clean({
        id: `crmf_${++state.seq}`,
        projectId: untenanted ? '' : scope.projectId,
        ownerUserId: untenanted ? '' : scope.userId,
        ...input,
      });
      state.forms.push(f);
      return copy(f);
    },
    async updateForm(id, input) {
      state.calls.updateForm += 1;
      const f = state.forms.find((x) => x.id === id);
      if (!f) return null;
      const { stylesPatch, ...rest } = input;
      // As the real store: a patch merges onto the form's styles as they are NOW.
      const styles = rest.styles !== undefined ? rest.styles : mergeCrmFormStylesPatch(f.styles, stylesPatch || {});
      clean(Object.assign(f, rest, { styles }));
      return copy(f);
    },
    async getForm(id) {
      const f = state.forms.find((x) => x.id === id);
      return f ? copy(f) : null;
    },
    getLastFormStoreError() { return ''; },
  };
  return { state, configStore, formsStore };
}

test('dry run: the Strands form is one form, rebuilt with 4 questions, its spam trap and plumbing listed', () => {
  const out = mapSite(fixtureIr(), { existingSlugs: [] });
  assert.ok(reportReconciles(out.report), JSON.stringify(out.report.elements));
  assert.equal(out.report.elements.form, 2, 'both copies of the sign-up are Form modules');
  assert.equal(out.forms.length, 1, 'one source form on two pages is ONE form');
  assert.equal(out.forms[0].uses.length, 2);

  const [entry] = out.report.forms.rebuilt;
  assert.equal(entry.questions, 4);
  assert.equal(entry.name, 'Strands Movie form (strandsmovie.com)');
  assert.deepEqual(entry.pages, ['/', '/about/']);
  assert.ok(entry.dropped.some((d) => /data\[email\]/.test(d) && /spam trap/.test(d)), entry.dropped.join('\n'));
  for (const name of ['token', 'api_version', 'endpoint', 'mailpoet_method', 'data[form_id]']) {
    assert.ok(entry.dropped.some((d) => d.includes(`"${name}"`)), `dropped list names ${name}`);
  }
  assert.equal(out.forms[0].submitLabel, 'Join the Crew!');
  assert.equal(out.forms[0].styles.buttonTextSize, '20px', "the button's own inline font size");

  const modules = out.pages.flatMap((p) => p.sections.flatMap((s) => s.modules));
  const formModules = modules.filter((m) => m.type === 'crm-form');
  assert.equal(formModules.length, 2);
  for (const m of formModules) {
    assert.equal(m.settings.importFormKey, out.forms[0].key);
    assert.equal(m.settings.crmFormId, '');
  }
  assert.ok(!out.copyPlan.crops.some((c) => c.sourceId === 'h-form'), 'a rebuilt form needs no screenshot');
});

test('a search box still lands as a placeholder, captioned with its reason', () => {
  const out = mapSite(fixtureIr(), { existingSlugs: [] });
  const modules = out.pages.flatMap((p) => p.sections.flatMap((s) => s.modules));
  const search = modules.find((m) => m.settings.importSourceId === 'a-search');
  assert.equal(search.type, 'code');
  assert.match(search.settings.importPlaceholder, /search box/);
  assert.match(search.settings.importPlaceholder, /Site Search module/);
  assert.doesNotMatch(search.text, /Site Search/, 'the caption is a Builder-only setting, not page text');
  assert.equal(out.report.forms.pictures.length, 1);
  assert.match(out.report.forms.pictures[0].reason, /search/);
  assert.equal(out.report.elements.placeholder, 1);
});

test('the Form module survives the page document serializer', () => {
  const out = mapSite(fixtureIr(), { existingSlugs: [] });
  const sections = out.pages[0].sections.map(({ sourceElementIds, dispositions, ...s }) => s);
  fillFormIds(sections, { [out.forms[0].key]: 'crmf_42' });
  const doc = serializeBuilderDocument({ layoutSections: sections });
  const mod = doc.sections.flatMap((s) => s.modules).find((m) => m.type === 'crm-form');
  assert.ok(mod, 'crm-form was not coerced to another type');
  assert.equal(mod.settings.crmFormId, 'crmf_42');
  assert.equal(mod.settings.importFormKey, out.forms[0].key);
});

test('forms-apply: one form per source form, re-run creates none', async () => {
  const out = mapSite(fixtureIr(), { existingSlugs: [] });
  const stores = fakeStores();
  const first = await applyImportForms(out.forms, { ...stores, scope: SCOPE });
  assert.equal(stores.state.calls.createConfig, 1, 'no CRM, so one is created');
  assert.equal(stores.state.calls.createForm, 1, 'exactly one form');
  assert.equal(first.results[0].outcome, 'created');
  assert.equal(first.results[0].questions, 4);
  const formId = first.formIds[out.forms[0].key];
  const row = await stores.formsStore.getForm(formId);
  assert.equal(row.projectId, SCOPE.projectId);
  assert.equal(row.ownerUserId, SCOPE.userId);
  assert.equal(row.submitLabel, 'Join the Crew!');
  assert.deepEqual(row.fields.map((f) => f.key).slice(0, 3), ['email', 'first_name', 'last_name']);

  // Re-run from the checkpoint: nothing new, the same form updated.
  const again = mapSite(fixtureIr(), { existingSlugs: [] });
  const second = await applyImportForms(again.forms, { ...stores, scope: SCOPE, prior: first.checkpoint });
  assert.equal(stores.state.calls.createForm, 1, 're-run created no form');
  assert.equal(stores.state.calls.createConfig, 1, 're-run created no CRM');
  assert.equal(second.results[0].outcome, 'updated');
  assert.equal(second.formIds[again.forms[0].key], formId);
});

test('an existing custom field with the same key is left untouched', async () => {
  const out = mapSite(fixtureIr(), { existingSlugs: [] });
  const radioKey = out.forms[0].fields[3].key;
  const theirs = { key: radioKey, label: 'Their own label', type: 'text', required: true, options: [] };
  const stores = fakeStores({
    configs: [{ id: 'crmc_x', name: 'Strands CRM', standardFields: ['first_name'], customFields: [
      { key: 'shoe_size', label: 'Shoe size', type: 'number', required: false, options: [] },
      theirs,
      { key: '__crm_meta__', label: '', type: 'text', required: false, options: [] },
    ] }],
  });
  const res = await applyImportForms(out.forms, { ...stores, scope: SCOPE });
  const config = stores.state.configs[0];
  assert.equal(stores.state.calls.createConfig, 0, "uses the project's CRM");
  assert.deepEqual(config.customFields.find((f) => f.key === radioKey), theirs, 'not renamed, retyped or required-changed');
  assert.deepEqual(config.customFields.map((f) => f.key), ['shoe_size', radioKey, '__crm_meta__'], 'nothing reordered, nothing duplicated');
  assert.deepEqual(config.standardFields, ['first_name', 'last_name'], 'last name switched on, first name not added twice');
  assert.deepEqual(res.crm.alreadyThere, [radioKey]);

  // Without the guard the import's own copy would replace theirs.
  const fresh = planCrmFields({ standardFields: [], customFields: [] }, out.forms);
  assert.equal(fresh.added.length, 1);
  assert.equal(fresh.customFields[0].type, 'radio');
  assert.equal(fresh.customFields[0].options.length, 11);
});

test('a form changed by hand since the import is left alone on a re-run', async () => {
  const out = mapSite(fixtureIr(), { existingSlugs: [] });
  const stores = fakeStores();
  const first = await applyImportForms(out.forms, { ...stores, scope: SCOPE });
  const formId = first.formIds[out.forms[0].key];
  stores.state.forms.find((f) => f.id === formId).submitLabel = 'Sign me up';
  const second = await applyImportForms(out.forms, { ...stores, scope: SCOPE, prior: first.checkpoint });
  assert.match(second.results[0].outcome, /left alone/);
  assert.equal(stores.state.calls.updateForm, 0);
  assert.equal((await stores.formsStore.getForm(formId)).submitLabel, 'Sign me up');
  assert.equal(second.checkpoint[out.forms[0].key].fingerprint, first.checkpoint[out.forms[0].key].fingerprint, 'stays protected next time too');
});

test('a form whose button colour was changed by hand is left alone on a re-run', async () => {
  const out = mapSite(fixtureIr(), { existingSlugs: [] });
  // A source button with a colour of its own, so the import writes one.
  const plans = out.forms.map((p) => ({ ...p, styles: { ...p.styles, buttonBackgroundColor: '#cc0000' } }));
  const stores = fakeStores();
  const first = await applyImportForms(plans, { ...stores, scope: SCOPE });
  const formId = first.formIds[plans[0].key];
  assert.equal((await stores.formsStore.getForm(formId)).styles.buttonBackgroundColor, '#cc0000');

  // Untouched, a re-run still updates: the store's cleaning alone is not an edit.
  const untouched = await applyImportForms(plans, { ...stores, scope: SCOPE, prior: first.checkpoint });
  assert.equal(untouched.results[0].outcome, 'updated', 'a form nobody touched must still match its fingerprint');

  // Changed to green the way Contacts › Forms saves it: a stylesPatch.
  await stores.formsStore.updateForm(formId, { stylesPatch: { buttonBackgroundColor: '#00aa00' } });
  const updatesBefore = stores.state.calls.updateForm;
  const again = await applyImportForms(plans, { ...stores, scope: SCOPE, prior: untouched.checkpoint });
  assert.match(again.results[0].outcome, /left alone/);
  assert.equal(stores.state.calls.updateForm, updatesBefore, 'the import wrote nothing to it');
  assert.equal((await stores.formsStore.getForm(formId)).styles.buttonBackgroundColor, '#00aa00', 'their green stays');
});

test('a form whose thank-you message was changed by hand is left alone on a re-run', async () => {
  const out = mapSite(fixtureIr(), { existingSlugs: [] });
  const stores = fakeStores();
  const first = await applyImportForms(out.forms, { ...stores, scope: SCOPE });
  const formId = first.formIds[out.forms[0].key];
  await stores.formsStore.updateForm(formId, { successMessage: 'Welcome to the crew!' });
  const again = await applyImportForms(out.forms, { ...stores, scope: SCOPE, prior: first.checkpoint });
  assert.match(again.results[0].outcome, /left alone/);
});

test('a form that reads back without its tenant stops the run', async () => {
  const out = mapSite(fixtureIr(), { existingSlugs: [] });
  const stores = fakeStores({ untenanted: true });
  await assert.rejects(applyImportForms(out.forms, { ...stores, scope: SCOPE }), /without its tenant/);
});

test('read back after writing: every placed Form module must hold its form id', () => {
  const out = mapSite(fixtureIr(), { existingSlugs: [] });
  const ids = { [out.forms[0].key]: 'crmf_9' };
  const pagesByKey = new Map(out.pages.map((p) => [p.key, {
    layoutSections: fillFormIds(p.sections.map((s) => JSON.parse(JSON.stringify(s))), ids),
  }]));
  const ok = checkFormLinks(out.forms, ids, pagesByKey);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.checked, 2);

  const emptied = new Map(out.pages.map((p) => [p.key, { layoutSections: p.sections }]));
  const bad = checkFormLinks(out.forms, ids, emptied);
  assert.equal(bad.problems.length, 2, 'a module still holding "" is named');
});
