'use strict';

/**
 * Site Import — rebuild each source form as a real Starcaster form
 * (task 86bcynjx2; Dane, 2026-11-04: "Replace it automatically").
 *
 * The mapper (lib/site-import/map.ts) reads every form on the source site
 * and hands the runner one ImportFormPlan per DISTINCT form — a footer
 * sign-up on nine pages is one plan used nine times. This file turns those
 * plans into rows: the project's CRM gains the questions it lacks, and each
 * plan becomes one form under Contacts › Forms. The runner then writes each
 * form's id into the page's Form module (link by id, CLAUDE.md landmine 19).
 *
 * Three promises, each tested in scripts/site-import/forms-apply.test.js:
 *   - ADD-ONLY on the CRM. A question whose key the CRM already has is left
 *     exactly as it is — never renamed, retyped or reordered. Standard
 *     fields (first/last name, phone…) are switched on, never duplicated.
 *   - ONE form per source form, ever. Form ids live in the job's map
 *     checkpoint, so a re-run updates the forms it made instead of minting
 *     twins.
 *   - Somebody's edit wins. A form changed in Contacts › Forms since the
 *     import last wrote it is left alone, the way the section clobber guard
 *     leaves an edited page section alone.
 *
 * The two stores return the row itself, or null on failure — NOT the
 * { ok, data } envelope the page stores use — so every call goes through
 * need(), which turns a null into a thrown error with the store's reason.
 */

const crypto = require('node:crypto');

/** Keys the CRM treats as built-in fields (public/js/crm.js STANDARD_FIELDS). */
const STANDARD_KEYS = new Set([
  'first_name', 'last_name', 'phone', 'company', 'job_title', 'city',
  'state', 'zip', 'country', 'website', 'notes', 'source',
]);
const META_KEY = '__crm_meta__';

function need(value, what, store) {
  if (value) return value;
  const reason = store && typeof store.getLastFormStoreError === 'function' ? store.getLastFormStoreError() : '';
  throw new Error(`${what} failed${reason ? `: ${reason}` : ' (the store returned nothing)'}`);
}

function formField(f) {
  return {
    key: String(f.key),
    label: String(f.label || f.key),
    type: String(f.type || 'text'),
    required: Boolean(f.required),
    options: Array.isArray(f.options) ? f.options.map(String) : [],
  };
}

/**
 * What the CRM config must gain so every plan's questions have somewhere to
 * land. Pure. Existing entries are returned untouched and in their order;
 * new custom fields are appended after them.
 */
function planCrmFields(config, plans) {
  const standardFields = Array.isArray(config?.standardFields) ? [...config.standardFields] : [];
  const existingCustom = Array.isArray(config?.customFields) ? config.customFields : [];
  const customKeys = new Set(existingCustom.map((f) => String(f?.key || '')).filter(Boolean));
  const added = [];
  const switchedOn = [];
  const alreadyThere = [];
  const seen = new Set();
  for (const plan of plans || []) {
    for (const f of plan.fields || []) {
      const key = String(f.key || '');
      if (!key || key === 'email' || seen.has(key)) continue;
      seen.add(key);
      if (STANDARD_KEYS.has(key)) {
        if (!standardFields.includes(key)) {
          standardFields.push(key);
          switchedOn.push(key);
        }
        continue;
      }
      if (customKeys.has(key)) {
        alreadyThere.push(key);
        continue;
      }
      // `required` stays on the FORM's copy of the question: on the CRM it
      // would bind every other form that asks it too.
      added.push({ ...formField(f), required: false });
      customKeys.add(key);
    }
  }
  // The field-order entry stays last, where the CRM screen keeps it.
  const meta = existingCustom.filter((f) => String(f?.key || '') === META_KEY);
  const rest = existingCustom.filter((f) => String(f?.key || '') !== META_KEY);
  return {
    standardFields,
    customFields: [...rest, ...added, ...meta],
    added: added.map((f) => f.key),
    switchedOn,
    alreadyThere,
    changed: added.length > 0 || switchedOn.length > 0,
  };
}

/** The form row as the import writes it, minus ids and styles. */
function formInputFor(plan, crmConfigId) {
  return {
    crmConfigId,
    name: plan.name,
    heading: plan.heading || '',
    submitLabel: plan.submitLabel || 'Submit',
    fields: (plan.fields || []).map(formField),
  };
}

/**
 * A fingerprint of what a person could change on a form in Contacts › Forms.
 * Taken from the row as READ BACK, so the store's own cleaning is included
 * and a form nobody touched always matches its last import.
 */
function formFingerprint(form) {
  const shape = {
    name: String(form?.name || ''),
    heading: String(form?.heading || ''),
    submitLabel: String(form?.submitLabel || ''),
    fields: (Array.isArray(form?.fields) ? form.fields : []).map(formField),
  };
  return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

/**
 * Write the plans. Returns { formIds: {key: id}, checkpoint, results, crm }.
 * `prior` is the previous run's checkpoint (`map.forms`): {key: {formId, fingerprint}}.
 */
async function applyImportForms(plans, { configStore, formsStore, scope, prior = {}, log = () => {} }) {
  const list = Array.isArray(plans) ? plans : [];
  const results = [];
  const formIds = {};
  const checkpoint = {};
  if (!list.length) return { formIds, checkpoint, results, crm: null };

  // 1. The project's CRM — the most recently used one; a new one only if none.
  const configs = await configStore.listConfigs(scope);
  let config = Array.isArray(configs) && configs.length ? configs[0] : null;
  let crmNote;
  if (config) {
    crmNote = `using the project's CRM "${config.name}" (${config.id})${configs.length > 1 ? `, the most recently changed of ${configs.length}` : ''}`;
  } else {
    config = need(await configStore.createConfig({ name: 'CRM', standardFields: [], customFields: [] }, scope), 'create the project CRM');
    crmNote = `the project had no CRM, so one was created (${config.id})`;
  }

  // 2. Add-only: the questions the CRM lacks.
  const fieldPlan = planCrmFields(config, list);
  if (fieldPlan.changed) {
    config = need(await configStore.updateConfig(config.id, {
      standardFields: fieldPlan.standardFields,
      customFields: fieldPlan.customFields,
    }, scope), `add questions to CRM ${config.id}`);
  }
  log(`  CRM: ${crmNote}`);
  if (fieldPlan.added.length) log(`  CRM: added ${fieldPlan.added.length} question(s): ${fieldPlan.added.join(', ')}`);
  if (fieldPlan.switchedOn.length) log(`  CRM: switched on built-in field(s): ${fieldPlan.switchedOn.join(', ')}`);
  if (fieldPlan.alreadyThere.length) log(`  CRM: already had ${fieldPlan.alreadyThere.join(', ')} — left exactly as they were`);

  // 3. One form per plan: create, or update the one this import made.
  for (const plan of list) {
    const input = formInputFor(plan, config.id);
    const before = prior[plan.key];
    let outcome;
    let form = null;
    if (before?.formId) {
      const current = await formsStore.getForm(before.formId, scope);
      if (current && before.fingerprint && formFingerprint(current) !== before.fingerprint) {
        // Changed by hand since the import wrote it: theirs now.
        form = current;
        outcome = 'left alone — it was changed in Contacts › Forms after the last import';
      } else if (current) {
        need(await formsStore.updateForm(current.id, { ...input, stylesPatch: plan.styles || {} }, scope), `update form ${current.id}`, formsStore);
        outcome = 'updated';
        form = current;
      } else {
        outcome = 'created again — the form this import made before is gone';
      }
    } else {
      outcome = 'created';
    }
    if (!form || outcome.startsWith('created')) {
      form = need(await formsStore.createForm({ ...input, styles: plan.styles || {} }, scope), `create form "${plan.name}"`, formsStore);
    }

    // Read back (landmine 12): an insert that "succeeds" can land untenanted.
    const back = need(await formsStore.getForm(form.id, scope), `read back form ${form.id}`, formsStore);
    if (!back.projectId || !back.ownerUserId) {
      throw new Error(`form ${back.id} read back without its tenant (project_id "${back.projectId}", owner_user_id "${back.ownerUserId}") — stopping before any page links to it`);
    }
    formIds[plan.key] = back.id;
    checkpoint[plan.key] = {
      formId: back.id,
      // A form left alone keeps the fingerprint of the import's last write,
      // so it stays protected on every later run too.
      fingerprint: outcome.startsWith('left alone') ? before.fingerprint : formFingerprint(back),
    };
    results.push({ key: plan.key, name: back.name, formId: back.id, outcome, questions: back.fields.length });
  }
  return { formIds, checkpoint, results, crm: { id: config.id, note: crmNote, ...fieldPlan } };
}

/** Fill each imported Form module's crmFormId from its import key. Mutates and returns the sections. */
function fillFormIds(sections, formIds) {
  for (const section of sections || []) {
    for (const module of section.modules || []) {
      const key = module?.settings?.importFormKey;
      if (module.type === 'crm-form' && key && formIds[key]) module.settings.crmFormId = formIds[key];
    }
  }
  return sections;
}

/**
 * After the pages are written: every Form module the import placed must hold
 * its form's id. Returns plain-words problems (empty = all good). Sections the
 * clobber guard protected were not rewritten, so they are skipped and named.
 */
function checkFormLinks(plans, formIds, pagesById, protectedSectionIds = new Set()) {
  const problems = [];
  const skipped = [];
  let checked = 0;
  for (const plan of plans || []) {
    for (const use of plan.uses || []) {
      const page = pagesById.get(use.pageKey);
      if (!page) { problems.push(`${use.pagePath}: the page could not be read back`); continue; }
      let found = null;
      let inSection = null;
      for (const section of page.layoutSections || []) {
        const m = (section.modules || []).find((mod) => mod.id === use.moduleId);
        if (m) { found = m; inSection = section; break; }
      }
      if (inSection && protectedSectionIds.has(inSection.id)) { skipped.push(`${use.pagePath} (${inSection.id})`); continue; }
      if (!found) { problems.push(`${use.pagePath}: the Form module ${use.moduleId} is not on the page`); continue; }
      checked += 1;
      if (String(found.settings?.crmFormId || '') !== String(formIds[plan.key] || '')) {
        problems.push(`${use.pagePath}: the Form module holds "${found.settings?.crmFormId || ''}", expected ${formIds[plan.key]}`);
      }
    }
  }
  return { checked, problems, skipped };
}

module.exports = {
  STANDARD_KEYS,
  planCrmFields,
  formInputFor,
  formFingerprint,
  applyImportForms,
  fillFormIds,
  checkFormLinks,
};
