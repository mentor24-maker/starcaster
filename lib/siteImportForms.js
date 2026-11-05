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
 *   - Unread is not absent. A null form or an empty CRM list can mean the
 *     database did not answer; the store's last-error reporter says which,
 *     and only a clean "nothing there" may lead to creating one. Anything
 *     else stops the run with the checkpoint untouched.
 */

const crypto = require('node:crypto');
const { stylesSignature } = require('./crmFormStyles');
const { normalizeFormHandling } = require('./crmFormHandling');

/** Keys the CRM treats as built-in fields (public/js/crm.js STANDARD_FIELDS). */
const STANDARD_KEYS = new Set([
  'first_name', 'last_name', 'phone', 'company', 'job_title', 'city',
  'state', 'zip', 'country', 'website', 'notes', 'source',
]);
const META_KEY = '__crm_meta__';

/**
 * A read that came back empty: did the store ANSWER "nothing", or fail to
 * answer? Returns the failure reason, or '' for a clean empty answer. A store
 * that cannot say is treated as failed — creating a second CRM or a twin form
 * on a guess is the defect this exists against (landmine 15).
 */
function readFailure(store, reporter, what) {
  if (!store || typeof store[reporter] !== 'function') {
    return `the store cannot say whether ${what} failed or found nothing`;
  }
  return String(store[reporter]() || '').trim();
}

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
 * A fingerprint of everything a person could change on a form in Contacts › Forms
 * — questions, wording, messages, after-submit handling and every style.
 * Taken from the row as READ BACK, so the store's own cleaning is included
 * and a form nobody touched always matches its last import.
 */
function formFingerprint(form) {
  const shape = {
    name: String(form?.name || ''),
    heading: String(form?.heading || ''),
    submitLabel: String(form?.submitLabel || ''),
    fields: (Array.isArray(form?.fields) ? form.fields : []).map(formField),
    // Everything else Contacts › Forms lets a person change. Styles go
    // through the store's own normalizer, so the stored copy and a read-back
    // agree on an untouched form — and a styles-only edit (button colour,
    // text size, layout) counts as an edit. Round 1 of review: without these
    // a hand-changed button colour was set back by the next import.
    styles: stylesSignature(form?.styles, String(form?.accentColor || '')),
    successMessage: String(form?.successMessage || ''),
    errorMessage: String(form?.errorMessage || ''),
    handling: JSON.stringify(normalizeFormHandling(form?.handling)),
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
  if (!Array.isArray(configs)) {
    throw new Error('reading the project\'s CRM failed (the store returned no list) — nothing was created');
  }
  if (!configs.length) {
    const failed = readFailure(configStore, 'getLastConfigStoreError', "reading the project's CRM");
    if (failed) {
      throw new Error(`reading the project's CRM failed: ${failed} — stopping rather than creating a second CRM`);
    }
  }
  let config = configs.length ? configs[0] : null;
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
      if (!current) {
        const failed = readFailure(formsStore, 'getLastFormStoreError', `reading form ${before.formId}`);
        if (failed) {
          // Not "gone" — unread. A twin would re-point every page at it and
          // drop any hand edits on the original off the site.
          throw new Error(`reading form ${before.formId} (made by the last import) failed: ${failed} — stopping rather than creating a duplicate`);
        }
      }
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

/* ------------------------------------------------------------------------
 * FORMS ONLY — sites imported before forms were rebuilt (task 86bcynk0e).
 *
 * Strands Movie was imported on 2026-10-11, when every source form became a
 * `code` placeholder showing a screenshot. `--forms-only` swaps those
 * placeholders for Form modules without re-running the import. The plans
 * come from the SAME mapper the full import uses (mapSite → out.forms), and
 * the forms are written by applyImportForms above — no second copy of either.
 *
 * The guard is per MODULE, not per section: a person who added a heading
 * beside the placeholder has not touched the placeholder, and their heading
 * is kept because the page is edited in place (only the one module swaps).
 * The placeholder itself must still be exactly what the import wrote — its
 * screenshot snippet, and the source markup it was made from — or it is left
 * alone and named.
 * ---------------------------------------------------------------------- */

/** The snippet an import placeholder carries: its screenshot (or the no-screenshot
 *  note), optionally followed by the old in-page caption (before 86bcgdm83). */
const PLACEHOLDER_SNIPPET_RE = /^\s*(?:<img src="[^"<>]*" alt="Screenshot of imported [a-z]+" style="max-width:100%" \/>|<p><em>\(No screenshot was captured for this element\.\)<\/em><\/p>)(?:<p><em>[^<]*<\/em><\/p>)?\s*$/;

/** Layout settings a placeholder may carry that the Form module keeps, so it sits where the picture sat. */
const KEPT_LAYOUT_SETTINGS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'];

/** Is this module an import placeholder for a source form? */
function isFormPlaceholder(module) {
  if (!module || module.type !== 'code') return false;
  const s = module.settings || {};
  if (!s.importSourceId) return false;
  if (/<form[\s>]/i.test(String(s.importSourceHtml || ''))) return true;
  return Boolean(s.importSourceHtmlUrl) && s.importClass === 'form';
}

/**
 * Why a form placeholder no longer looks like the one the import wrote, or ''
 * when it is untouched. `sourceHtml` is the form's markup in the import's IR.
 */
function placeholderEdit(module, sourceHtml) {
  const s = module.settings || {};
  if (!PLACEHOLDER_SNIPPET_RE.test(String(module.text || ''))) return 'its snippet was changed in the Builder';
  if (s.snippetMode && s.snippetMode !== 'html') return 'its snippet mode was changed in the Builder';
  if (s.importSourceHtml && typeof sourceHtml === 'string' && s.importSourceHtml !== sourceHtml) {
    return 'its saved source markup no longer matches the import';
  }
  return '';
}

/**
 * What a forms-only pass would do to these pages. Pure.
 *
 * @param {Array<{id, slug, name, isPublished, layoutSections}>} pages  pages THIS import created, as read now
 * @param {{forms: object[], report: {forms: {pictures: object[]}}}} mapOut  mapSite's output for the import's IR
 * @param {Map<string,string>} sourceHtml  IR element html by sourceId
 * @param {{skip?: Set<string>}} [options]  form keys vetoed for this run (--skip-form)
 * @returns {{
 *   vetoed: {pageId, slug, moduleId, sourceId, planKey}[],
 *   replacements: {pageId, slug, sectionId, moduleId, sourceId, planKey}[],
 *   leftAlone: {pageId, slug, moduleId, sourceId, reason}[],
 *   pictures: {pageId, slug, moduleId, sourceId, reason}[],
 *   alreadyForms: {pageId, slug, moduleId, sourceId, crmFormId}[],
 *   missing: {pageKey, pagePath, sourceId, planKey}[],
 *   plans: object[],
 * }}
 */
function planFormsOnly(pages, mapOut, sourceHtml = new Map(), { skip = new Set() } = {}) {
  const planBySource = new Map();
  for (const plan of mapOut?.forms || []) {
    for (const use of plan.uses || []) planBySource.set(String(use.sourceId), plan);
  }
  const pictureReason = new Map();
  for (const p of mapOut?.report?.forms?.pictures || []) pictureReason.set(String(p.sourceId), p.reason);

  const replacements = [];
  const vetoed = [];
  const leftAlone = [];
  const pictures = [];
  const alreadyForms = [];
  const seenSources = new Set();
  for (const page of pages || []) {
    const pageId = String(page.id);
    const slug = String(page.slug || '');
    for (const section of page.layoutSections || []) {
      for (const module of section.modules || []) {
        const sourceId = String(module?.settings?.importSourceId || '');
        if (module?.type === 'crm-form' && sourceId) {
          seenSources.add(sourceId);
          alreadyForms.push({ pageId, slug, moduleId: module.id, sourceId, crmFormId: String(module.settings.crmFormId || '') });
          continue;
        }
        if (!isFormPlaceholder(module)) continue;
        seenSources.add(sourceId);
        const plan = planBySource.get(sourceId);
        if (!plan) {
          pictures.push({
            pageId, slug, moduleId: module.id, sourceId,
            reason: pictureReason.get(sourceId) || 'the import did not read it as a form',
          });
          continue;
        }
        const edit = placeholderEdit(module, sourceHtml.get(sourceId));
        if (edit) {
          leftAlone.push({ pageId, slug, moduleId: module.id, sourceId, reason: edit });
          continue;
        }
        const entry = { pageId, slug, sectionId: section.id, moduleId: module.id, sourceId, planKey: plan.key };
        (skip.has(plan.key) ? vetoed : replacements).push(entry);
      }
    }
  }
  // A form the import placed that is on none of these pages any more: a
  // person removed or replaced the picture. Named, never put back.
  const missing = [];
  for (const plan of mapOut?.forms || []) {
    for (const use of plan.uses || []) {
      if (!seenSources.has(String(use.sourceId))) missing.push({ pageKey: use.pageKey, pagePath: use.pagePath, sourceId: String(use.sourceId), planKey: plan.key });
    }
  }
  const needed = new Set(replacements.map((r) => r.planKey));
  const plans = (mapOut?.forms || []).filter((p) => needed.has(p.key));
  return { replacements, vetoed, leftAlone, pictures, alreadyForms, missing, plans };
}

/**
 * The page's sections with each named placeholder swapped for a Form module
 * holding its form's id. Everything else — other modules, other sections,
 * the placeholder's column and margins — is kept. Does not mutate its input.
 * Throws when a replacement's form has no id: a Form module with no form
 * would render nothing on a live page.
 */
function replaceFormPlaceholders(sections, replacements, formIds) {
  const byModule = new Map((replacements || []).map((r) => [String(r.moduleId), r]));
  return (sections || []).map((section) => {
    if (!(section.modules || []).some((m) => byModule.has(String(m.id)))) return section;
    return {
      ...section,
      modules: section.modules.map((module) => {
        const r = byModule.get(String(module.id));
        if (!r) return module;
        const crmFormId = formIds[r.planKey];
        if (!crmFormId) throw new Error(`no form id for ${r.planKey} — refusing to place an empty Form module on /${r.slug}`);
        const layout = {};
        for (const key of KEPT_LAYOUT_SETTINGS) {
          if (module.settings && module.settings[key] !== undefined) layout[key] = module.settings[key];
        }
        return {
          id: module.id,
          type: 'crm-form',
          column: module.column || 'main',
          name: 'Imported form',
          text: '',
          settings: { ...layout, crmFormId, importFormKey: r.planKey, importSourceId: r.sourceId },
        };
      }),
    };
  });
}

/** The plans, with `uses` rewritten to the modules a forms-only pass placed — the shape checkFormLinks reads. */
function formsOnlyLinkPlans(plans, replacements) {
  return (plans || []).map((plan) => ({
    ...plan,
    uses: (replacements || []).filter((r) => r.planKey === plan.key)
      .map((r) => ({ pageKey: r.pageId, pagePath: `/${r.slug}`, moduleId: r.moduleId, sourceId: r.sourceId })),
  }));
}

module.exports = {
  STANDARD_KEYS,
  planCrmFields,
  formInputFor,
  formFingerprint,
  applyImportForms,
  fillFormIds,
  checkFormLinks,
  isFormPlaceholder,
  placeholderEdit,
  planFormsOnly,
  replaceFormPlaceholders,
  formsOnlyLinkPlans,
};
