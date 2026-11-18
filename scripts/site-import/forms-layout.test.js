'use strict';

/**
 * Imported forms keep their source's layout (task SC-860): labels above or
 * beside the boxes, and two half-width questions sharing a row. Bayside's
 * contact form (bayside-wpforms.html, verbatim from the production import's
 * IR) is one "Name" label over First and Last side by side; the import used
 * to rebuild it with labels beside and First and Last on separate rows.
 *
 * The forms store here is a fake with the real store's calling shape, but it
 * runs the REAL resolveStylesPatch and sanitizeForm on every write and read,
 * so a width or a style the real store would drop is dropped here too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mapSite } = require('../../lib/site-import/dist/map.js');
const { applyImportForms, formFingerprint, formInputFor, planFormsOnly } = require('../../lib/siteImportForms.js');
const { resolveStylesPatch, sanitizeForm } = require('../../lib/crmFormsStore.js');

const BAYSIDE_FORM = fs.readFileSync(path.join(__dirname, 'fixtures', 'forms', 'bayside-wpforms.html'), 'utf8');

const IR = (formHtml = BAYSIDE_FORM) => ({
  irVersion: '1.0', jobId: 'job-bayside', sourceUrl: 'https://bayside.test/',
  capturedAt: '2026-11-17T00:00:00.000Z', assets: [],
  taxonomy: { navs: [], pageOrder: ['/'] },
  rawTokens: { colors: [], fontSizes: [], fontFamilies: [], spacing: [] },
  pages: [{
    url: 'https://bayside.test/', path: '/', title: 'Bayside Partners',
    metaDescription: '', ogTags: {}, canonicalUrl: '', lang: 'en',
    screenshots: { desktop: '', tablet: '', mobile: '' },
    sections: [{ sourceId: 'sec', type: 'unknown', screenshot: '', elements: [{
      sourceId: 'p2a0c975e-8a8a4bc3', class: 'form', html: formHtml, textContent: '', textLength: 0,
      computedStyles: {}, documentPosition: 0, depth: 1, assetRefs: [], screenshot: 'https://blob.test/form.png',
    }] }],
  }],
});

const SCOPE = { projectId: 'proj_bayside', userId: 'user_dane' };

function fakeStores() {
  const state = { forms: [], seq: 0 };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const configStore = {
    async listConfigs() { return [{ id: 'crmc_1', name: 'CRM', standardFields: [], customFields: [] }]; },
    getLastConfigStoreError() { return ''; },
    async updateConfig(id, input) { return { id, name: 'CRM', ...input }; },
  };
  const formsStore = {
    async createForm(input, scope) {
      const row = sanitizeForm({ id: `crmf_${++state.seq}`, projectId: scope.projectId, ownerUserId: scope.userId, ...input });
      state.forms.push(row);
      return copy(row);
    },
    async updateForm(id, input) {
      const i = state.forms.findIndex((f) => f.id === id);
      if (i < 0) return null;
      const resolved = resolveStylesPatch(input, state.forms[i]);
      state.forms[i] = sanitizeForm({ ...state.forms[i], ...resolved, id });
      return copy(state.forms[i]);
    },
    async getForm(id) { const f = state.forms.find((x) => x.id === id); return f ? copy(f) : null; },
    getLastFormStoreError() { return ''; },
  };
  return { state, configStore, formsStore };
}

test('Bayside: the plan carries labels above and First / Last at half width', () => {
  const [plan] = mapSite(IR(), { existingSlugs: [] }).forms;
  assert.equal(plan.styles.labelPosition, 'above');
  assert.deepEqual(plan.fields.map((f) => f.width || 'full'), ['half', 'half', 'full', 'full', 'full', 'full']);
});

test('Ninja Forms: a default label-right consent checkbox leaves the import labels above, halves intact', async () => {
  // Ninja puts label-right on every single checkbox by default. Reading that
  // as the whole form's setting made the import write a labels-beside form,
  // which also stops its half widths rendering.
  const ninja = '<form><div class="nf-form-content">'
    + '<div class="nf-field-container textbox-container label-above one-half"><label for="f1">First</label><input id="f1" name="fname"></div>'
    + '<div class="nf-field-container textbox-container label-above one-half"><label for="f2">Last</label><input id="f2" name="lname"></div>'
    + '<div class="nf-field-container email-container label-above"><label for="f3">Email</label><input type="email" id="f3" name="email"></div>'
    + '<div class="nf-field-container checkbox-container label-right"><label for="f4">I agree</label><input type="checkbox" id="f4" name="agree"></div>'
    + '</div><button>Send</button></form>';
  const out = mapSite(IR(ninja), { existingSlugs: [] });
  const [plan] = out.forms;
  assert.equal(plan.styles.labelPosition, 'above');
  assert.deepEqual(plan.fields.map((f) => f.width || 'full'), ['half', 'half', 'full', 'full']);
  const stores = fakeStores();
  const made = await applyImportForms(out.forms, { ...stores, scope: SCOPE });
  const row = await stores.formsStore.getForm(made.formIds[plan.key]);
  assert.equal(row.styles.labelPosition, 'above');
});

test('Bayside: the form the import makes stores both, and a re-run is an update', async () => {
  const out = mapSite(IR(), { existingSlugs: [] });
  const stores = fakeStores();
  const first = await applyImportForms(out.forms, { ...stores, scope: SCOPE });
  const row = await stores.formsStore.getForm(first.formIds[out.forms[0].key]);
  assert.equal(row.styles.labelPosition, 'above');
  assert.equal(row.styles.requiredMarker, 'asterisk', 'the original marks required questions with an asterisk');
  assert.deepEqual(row.fields.map((f) => f.width || 'full'), ['half', 'half', 'full', 'full', 'full', 'full']);
  const again = await applyImportForms(out.forms, { ...stores, scope: SCOPE, prior: first.checkpoint });
  assert.equal(again.results[0].outcome, 'updated', 'an untouched form is still the import\'s to update');
});

test('a form imported BEFORE SC-860 updates on a re-run — it does not read as changed by hand', async () => {
  // As Bayside's form stood in production on 2026-11-18: labels beside, no
  // widths, fingerprinted by the import before either existed.
  const out = mapSite(IR(), { existingSlugs: [] });
  const plan = out.forms[0];
  const stores = fakeStores();
  const old = await stores.formsStore.createForm({
    ...formInputFor({ ...plan, fields: plan.fields.map(({ width, ...f }) => f) }, 'crmc_1'), styles: {},
  }, SCOPE);
  assert.equal(old.styles.labelPosition, 'beside');
  // The fingerprint the old code wrote ignored both new styles and every
  // width; formFingerprint must still match it for an untouched old form.
  const prior = { [plan.key]: { formId: old.id, fingerprint: formFingerprint(old) } };
  const res = await applyImportForms(out.forms, { ...stores, scope: SCOPE, prior });
  assert.equal(res.results[0].outcome, 'updated');
  const now = await stores.formsStore.getForm(old.id);
  assert.equal(now.styles.labelPosition, 'above');
  assert.deepEqual(now.fields.map((f) => f.width || 'full').slice(0, 2), ['half', 'half']);
});

test('a width set by hand counts as a hand edit, so a re-run leaves the form alone', async () => {
  const out = mapSite(IR(), { existingSlugs: [] });
  const stores = fakeStores();
  const first = await applyImportForms(out.forms, { ...stores, scope: SCOPE });
  const id = first.formIds[out.forms[0].key];
  await stores.formsStore.updateForm(id, { fieldLayoutPatch: { email: 'half', company: 'half' } });
  const again = await applyImportForms(out.forms, { ...stores, scope: SCOPE, prior: first.checkpoint });
  assert.match(again.results[0].outcome, /left alone/);
  assert.equal((await stores.formsStore.getForm(id)).fields.find((f) => f.key === 'email').width, 'half');
});

test('a form fingerprint ignores the new styles only while they hold their defaults', () => {
  const base = { name: 'F', fields: [{ key: 'a', label: 'A', type: 'text', required: false, options: [] }], styles: {} };
  const withDefaults = { ...base, styles: { labelPosition: 'beside', requiredMarker: 'asterisk' } };
  assert.equal(formFingerprint(withDefaults), formFingerprint(base));
  assert.notEqual(formFingerprint({ ...base, styles: { labelPosition: 'above' } }), formFingerprint(base));
  assert.notEqual(formFingerprint({ ...base, styles: { requiredMarker: 'none' } }), formFingerprint(base));
  // Golden value from the code on main before SC-860, for this exact form.
  const golden = {
    name: 'Contact form (example.test)', heading: '', submitLabel: 'Submit',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, options: [] },
      { key: 'email', label: 'Email', type: 'email', required: true, options: [] },
    ],
    styles: { buttonBackgroundColor: '#123456' }, accentColor: '#123456', successMessage: 'Thanks', errorMessage: 'Oops',
  };
  assert.equal(formFingerprint(golden), '9dff29110bdd3b84b5ac1f185dc794a34554c142e5a18b7c127140f5af0f3cdf');
});

test('--forms-only offers to update a form the import already placed, and --skip-form holds it back', () => {
  const out = mapSite(IR(), { existingSlugs: [] });
  const key = out.forms[0].key;
  const pages = [{ id: '1', slug: 'home', isPublished: true, layoutSections: [{ id: 's', modules: [
    { id: 'm', type: 'crm-form', settings: { crmFormId: 'crmf_9', importFormKey: key, importSourceId: 'p2a0c975e-8a8a4bc3' } },
  ] }] }];
  const priorForms = { [key]: { formId: 'crmf_9', fingerprint: 'x' } };
  const plan = planFormsOnly(pages, out, new Map(), { priorForms });
  assert.equal(plan.replacements.length, 0, 'no screenshot to swap');
  assert.deepEqual(plan.refresh.map((p) => p.key), [key]);
  assert.deepEqual(plan.refreshSkipped, []);
  assert.equal(planFormsOnly(pages, out, new Map(), { skip: new Set([key]), priorForms }).refresh.length, 0);
});

test('--forms-only never updates a placed form the import has no record of — it names it instead', () => {
  // SC-860 review: with no prior entry the writer's create path ran, and the
  // pass (which repoints no page) left a new form nobody's page shows.
  const out = mapSite(IR(), { existingSlugs: [] });
  const key = out.forms[0].key;
  const pages = [{ id: '1', slug: 'home', isPublished: true, layoutSections: [{ id: 's', modules: [
    { id: 'm', type: 'crm-form', settings: { crmFormId: 'crmf_9', importFormKey: key, importSourceId: 'p2a0c975e-8a8a4bc3' } },
  ] }] }];
  const plan = planFormsOnly(pages, out, new Map(), { priorForms: {} });
  assert.equal(plan.refresh.length, 0);
  assert.equal(plan.refreshSkipped.length, 1);
  assert.deepEqual(plan.refreshSkipped[0].slugs, ['/home']);
  assert.match(plan.refreshSkipped[0].reason, /recorded no form/);
});

test('--forms-only leaves alone a placed module that was pointed at a different form', () => {
  const out = mapSite(IR(), { existingSlugs: [] });
  const key = out.forms[0].key;
  const pages = [{ id: '1', slug: 'home', isPublished: true, layoutSections: [{ id: 's', modules: [
    { id: 'm', type: 'crm-form', settings: { crmFormId: 'crmf_other', importFormKey: key, importSourceId: 'p2a0c975e-8a8a4bc3' } },
  ] }] }];
  const plan = planFormsOnly(pages, out, new Map(), { priorForms: { [key]: { formId: 'crmf_9', fingerprint: 'x' } } });
  assert.equal(plan.refresh.length, 0, 'updating crmf_9 would change a form no page shows');
  assert.match(plan.refreshSkipped[0].reason, /crmf_other, not crmf_9/);
});

test('an update-only plan whose recorded form is gone is skipped, never created', async () => {
  const out = mapSite(IR(), { existingSlugs: [] });
  const key = out.forms[0].key;
  const stores = fakeStores();
  const prior = { [key]: { formId: 'crmf_deleted', fingerprint: 'x' } };
  const res = await applyImportForms(out.forms, { ...stores, scope: SCOPE, prior, updateOnly: new Set([key]) });
  assert.equal(stores.state.forms.length, 0, 'no orphan form was created');
  assert.equal(res.results[0].skipped, true);
  assert.match(res.results[0].outcome, /gone/);
  assert.deepEqual(res.checkpoint, {}, 'the checkpoint is not pointed at anything new');
  const none = await applyImportForms(out.forms, { ...stores, scope: SCOPE, prior: {}, updateOnly: new Set([key]) });
  assert.equal(stores.state.forms.length, 0);
  assert.equal(none.results[0].skipped, true);
  // Without updateOnly the full import still re-creates a gone form.
  const full = await applyImportForms(out.forms, { ...stores, scope: SCOPE, prior });
  assert.match(full.results[0].outcome, /created again/);
});
