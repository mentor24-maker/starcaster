'use strict';

/**
 * ONE engine that pushes a shared block's change out to the copies of it.
 *
 * Sync 7/7 of the Upstream/Downstream operating model (approved 2026-08-15).
 *
 * ------------------------------------------------------------------ the why
 *
 * There used to be two of these, and they disagreed in five ways:
 *
 *                        sections                     modules
 *   awaited              yes                          NO - fire and forget
 *   reaches templates    no                           yes
 *   per-copy opt-out     no                           yes (canonicalLocked)
 *   records an undo      yes (reason: 'propagate')    no
 *   polarity             canonical:true = follow      canonicalLocked:true = don't
 *
 * The fire-and-forget one is not a style difference. Serverless freezes the
 * function the moment the response goes out, so an un-awaited fan-out is cut
 * off partway down the page list - a different slice of pages every time,
 * with no error anywhere. That is exactly what left 20 of 50 pages stale in
 * July (PR #21). The section path was fixed then; the module path never was,
 * and every module push since has been rolling that dice.
 *
 * Everything below is shared. The only per-level code is the transform that
 * decides what a change to THIS kind of block does to one page's sections.
 *
 * --------------------------------------------------------- the one polarity
 *
 * "Does this copy follow its master?" is one question, and it now has one
 * answer everywhere: `canonical === true`.
 *
 * Getting there without rewriting saved data on live tenant pages is the
 * "read both, write one" branch of the ticket. `followsMaster` reads every
 * spelling that has ever been stored, INCLUDING each level's historic default
 * for an instance that never answered - so no copy on any live page changes
 * state the day this ships. Every write from here on emits `canonical`
 * explicitly, so the data converges as blocks get saved.
 *
 * The historic defaults, which is the whole reason the two levels differed:
 *
 *   a section carrying savedSectionId but no `canonical` was NOT following -
 *     inserting a saved section has always offered "linked" or "just a copy",
 *     and an unmarked one is the copy.
 *   a module carrying savedModuleId but no flag WAS following - the module
 *     side had no opt-in, only the `canonicalLocked` opt-out.
 *
 * Flip either of those and live pages silently change behaviour, which is the
 * failure this design refuses to risk: a page that quietly stops following its
 * master looks exactly like a page nobody has edited.
 *
 * ------------------------------------------------------------ and templates
 *
 * Templates are reached now, but a template is not a page and content is never
 * pushed into one.
 *
 * Since cb27a65 a template stores its frame sections as REFERENCES - id,
 * title, canonical, savedSectionId, no content - and resolves them against the
 * live master when it is applied. Writing content back into a reference would
 * recreate the second source of truth that commit deleted, and hand every
 * template a header that goes stale again. So the template-side operation is
 * the opposite one: a legacy stored COPY of the master being saved is
 * normalized down to a reference, and a reference is left exactly alone.
 *
 * TEMPLATE WRITES ARE NOT UNDOABLE. builder_page_templates has no revision
 * table, so nothing banks a restore point for them. Shipped that way on
 * purpose - the operator's call, 2026-08-23, "ship it without undo". A
 * mistaken template normalization has to be fixed by hand, and the tally says
 * so (`templates.undoable === false`) rather than leaving a caller to assume
 * the undo that covers pages covers these too.
 */

const crypto = require('node:crypto');

// Generated from lib/builder-client/builder-template-frame.ts by
// `npm run build:builder-template`, so this engine and the editor agree on
// what a frame reference is.
const { isFrameSection, isFrameReference, toTemplateFrameReference } = require('./builder/template-frame');

/**
 * How many pages a single push writes at a time.
 *
 * Not a throughput knob. Serverless gives the whole request one wall clock,
 * and this loop has to finish inside it or it truncates - which is the bug at
 * the top of this file. Wide enough to get through a 138-page project, narrow
 * enough not to hammer PostgREST.
 */
const PROPAGATION_CONCURRENCY = 8;

/**
 * The ceiling on how many pages/templates one push considers.
 *
 * The module push used to leave this at the store default of 1000 while the
 * section push asked for 5000, so on a big enough project the two engines
 * disagreed about how much of the site even existed. One number now, and it is
 * the higher one.
 */
const PROPAGATION_SCAN_LIMIT = 5000;

/** A shared SECTION: the block a saved section stamps onto a page. */
const SECTION_LEVEL = Object.freeze({
  name: 'section',
  linkKey: 'savedSectionId',
  legacyFollowsWhenUnmarked: false,
});

/** A shared MODULE: the block a saved module stamps into a section's column. */
const MODULE_LEVEL = Object.freeze({
  name: 'module',
  linkKey: 'savedModuleId',
  legacyFollowsWhenUnmarked: true,
});

/**
 * Does this instance carry a link to `masterId` at all?
 *
 * Separate from `followsMaster` on purpose: an instance that remembers where
 * it came from but has opted out is still an instance OF that master, and the
 * tallies count it rather than pretending it is not there.
 */
function linksTo(instance, level, masterId) {
  if (!instance || typeof instance !== 'object') return false;
  const id = String(masterId || '');
  if (!id) return false;
  return String(instance[level.linkKey] || '') === id;
}

/**
 * THE ONE POLARITY. True when this copy takes updates from its master.
 *
 * Reads every spelling; `markFollowing` writes only the first one.
 *
 *   canonical: true/false      the answer, and the only thing written now
 *   canonicalLocked: true      the module side's historic opt-out; still read,
 *                              and it OUTRANKS a stale canonical:true so that
 *                              locking a copy that a push already marked stays
 *                              locked
 *   neither                    this level's historic default - see the file
 *                              header for why the two differ and why that
 *                              difference must be preserved rather than fixed
 */
function followsMaster(instance, level, masterId) {
  if (!linksTo(instance, level, masterId)) return false;
  if (instance.canonicalLocked === true) return false;
  if (typeof instance.canonical === 'boolean') return instance.canonical;
  return level.legacyFollowsWhenUnmarked === true;
}

/**
 * Write the one spelling.
 *
 * `canonicalLocked` is dropped rather than left behind agreeing: two flags for
 * one fact is how they came to disagree in the first place, and the reader
 * above gives the leftover flag the last word.
 */
function markFollowing(instance, follows) {
  const next = { ...instance, canonical: follows === true };
  delete next.canonicalLocked;
  return next;
}

/** An empty result, so every early return has the same shape as a real run. */
function emptyTally() {
  return {
    ok: false,
    total: 0,
    updated: 0,
    failed: 0,
    skipped: [],
    overwritten: [],
    runId: '',
    instances: { updated: 0, locked: 0 },
    templates: { total: 0, updated: 0, failed: 0, normalized: 0, undoable: false },
  };
}

/**
 * Run one push, whatever kind of block it is.
 *
 * `applyToPage` and `applyToTemplate` are the only per-level code. Each takes a
 * section list and returns `{ sections, changed, drifted }` - `changed` false
 * means this page is not written at all, so no PATCH, no revision, and no
 * entry in the undo run for a page the push never touched.
 *
 * @param {object}   input
 * @param {object}   input.level          SECTION_LEVEL or MODULE_LEVEL
 * @param {string}   input.masterId       the saved section / saved module id
 * @param {object}   input.scope          tenant scope, passed through untouched
 * @param {function} input.applyToPage
 * @param {function} [input.applyToTemplate]  omitted means templates are read
 *                                            but never written
 * @param {object}   [input.options]
 * @param {object}   [input.options.actor]        credited on every revision
 * @param {string[]} [input.options.onlyPageIds]  narrow the run to these pages
 * @param {object}   [input.deps]         store overrides, for tests
 */
async function runPropagation({ level, masterId, scope, applyToPage, applyToTemplate, options = {}, deps = {} }) {
  const tally = emptyTally();
  if (!masterId || typeof applyToPage !== 'function') return tally;

  const {
    listPages,
    updatePage,
    listPageTemplates,
    updatePageTemplate,
  } = resolveStores(deps);

  const pagesResult = await listPages(PROPAGATION_SCAN_LIMIT, scope);
  if (!pagesResult || !pagesResult.ok) return tally;

  // One id for this whole push, stamped on every revision it mints. It is what
  // turns "46 pages were rewritten and there is no way back" (2026-07-21,
  // Marinoff) into one undoable action. Minted before the first write so every
  // page in the run carries the same value.
  const runId = crypto.randomUUID();

  const onlyPageIds = Array.isArray(options.onlyPageIds)
    ? new Set(options.onlyPageIds.map((id) => String(id)))
    : null;

  const pages = Array.isArray(pagesResult.data) ? pagesResult.data : [];
  const targets = pages.filter((page) => {
    if (onlyPageIds && !onlyPageIds.has(String(page.id))) return false;
    return Array.isArray(page.layoutSections)
      && page.layoutSections.some((section) => touchesMaster(section, level, masterId));
  });
  tally.total = targets.length;

  await inBatches(targets, async (page) => {
    const outcome = applyToPage(page.layoutSections || [], { runId });
    countInstances(tally, outcome);

    if (!outcome.changed) {
      // Every matching copy on this page was left alone - nothing to write, so
      // no revision and no undo-run entry for a page the push never touched.
      if (outcome.drifted) tally.skipped.push({ pageId: page.id, name: page.name });
      return;
    }

    try {
      // Spread the page: `layoutSections` alone is landmine 13, and `page` is
      // the pre-push state we already hold, so hand it to updatePage as
      // `previous` rather than making it re-read every one of these. That
      // previous state IS the restore point the undo run is built from.
      const res = await updatePage(
        page.id,
        { ...page, layoutSections: outcome.sections },
        scope,
        {
          previous: page,
          reason: 'propagate',
          actor: options.actor || null,
          propagationRunId: runId,
        }
      );
      if (res && res.ok === false) tally.failed += 1;
      else {
        tally.updated += 1;
        if (outcome.drifted) tally.overwritten.push({ pageId: page.id, name: page.name });
      }
    } catch {
      tally.failed += 1;
    }
  });

  if (typeof applyToTemplate === 'function') {
    await propagateToTemplates({
      level,
      masterId,
      scope,
      applyToTemplate,
      tally,
      listPageTemplates,
      updatePageTemplate,
    });
  }

  // runId is returned even on a partial failure: the pages that DID get
  // rewritten are exactly the ones an undo needs to reach. Empty when nothing
  // was written, because an undo of nothing is a button that lies.
  tally.ok = tally.failed === 0 && tally.templates.failed === 0;
  tally.runId = tally.updated ? runId : '';
  return tally;
}

/**
 * The template half. Separate function because its rules are the opposite of a
 * page's: no content is written, and nothing here is undoable.
 */
async function propagateToTemplates({
  level, masterId, scope, applyToTemplate, tally, listPageTemplates, updatePageTemplate,
}) {
  let templatesResult = null;
  try {
    templatesResult = await listPageTemplates(PROPAGATION_SCAN_LIMIT, scope);
  } catch {
    templatesResult = null;
  }
  if (!templatesResult || !templatesResult.ok) return;

  const templates = (Array.isArray(templatesResult.data) ? templatesResult.data : []).filter((template) => (
    Array.isArray(template.layoutSections)
    && template.layoutSections.some((section) => touchesMasterInTemplate(section, level, masterId))
  ));
  tally.templates.total = templates.length;

  await inBatches(templates, async (template) => {
    const outcome = applyToTemplate(template.layoutSections || []);
    tally.templates.normalized += Number(outcome.normalized || 0);
    countInstances(tally, outcome);
    if (!outcome.changed) return;

    try {
      // No `previous`, no reason, no run id: builder_page_templates has no
      // revision table to write them to. See the header - not undoable, by the
      // operator's decision, and the tally says so.
      const res = await updatePageTemplate(template.id, { layoutSections: outcome.sections }, scope);
      if (res && res.ok === false) tally.templates.failed += 1;
      else tally.templates.updated += 1;
    } catch {
      tally.templates.failed += 1;
    }
  });
}

/** Does this page section hold anything this push might touch? */
function touchesMaster(section, level, masterId) {
  if (level === SECTION_LEVEL) return linksTo(section, level, masterId);
  const modules = Array.isArray(section && section.modules) ? section.modules : [];
  return modules.some((module) => linksTo(module, level, masterId));
}

/**
 * Same question for a template, minus the sections a push may not touch.
 *
 * A pure frame reference carries no content, so a module push has nothing to
 * do inside one - and materializing modules into it would turn the reference
 * back into a copy, which is the cb27a65 regression this guards.
 */
function touchesMasterInTemplate(section, level, masterId) {
  if (level === SECTION_LEVEL) {
    // Only a legacy stored copy is work; a reference is already correct.
    return linksTo(section, level, masterId) && isFrameSection(section) && !isFrameReference(section);
  }
  if (isFrameSection(section)) return false;
  return touchesMaster(section, level, masterId);
}

function countInstances(tally, outcome) {
  tally.instances.updated += Number(outcome.instances || 0);
  tally.instances.locked += Number(outcome.locked || 0);
}

async function inBatches(items, handler) {
  for (let i = 0; i < items.length; i += PROPAGATION_CONCURRENCY) {
    const batch = items.slice(i, i + PROPAGATION_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop -- the batches are the point
    await Promise.all(batch.map(handler));
  }
}

/**
 * Stores are required lazily so builderPagesStore can require this file
 * without a cycle, and injected in tests so a fake supabase is not the only
 * way in.
 */
function resolveStores(deps) {
  const pages = deps.pagesStore || require('./builderPagesStore');
  const templates = deps.templatesStore || require('./builderPageTemplatesStore');
  return {
    listPages: deps.listPages || pages.listPages,
    updatePage: deps.updatePage || pages.updatePage,
    listPageTemplates: deps.listPageTemplates || templates.listPageTemplates,
    updatePageTemplate: deps.updatePageTemplate || templates.updatePageTemplate,
  };
}

/**
 * Turn a template's stored copy of a shared section back into a reference.
 *
 * This is the ONLY thing a push does to a template's frame. `toTemplateFrameReference`
 * is the same helper the editor uses when it saves a template, so a normalized
 * section is byte-identical to one the operator would have produced.
 */
function normalizeTemplateFrame(sections, masterId) {
  let normalized = 0;
  const next = (Array.isArray(sections) ? sections : []).map((section) => {
    if (!linksTo(section, SECTION_LEVEL, masterId)) return section;
    if (!isFrameSection(section) || isFrameReference(section)) return section;
    normalized += 1;
    return toTemplateFrameReference(section);
  });
  return { sections: next, changed: normalized > 0, normalized, instances: 0, locked: 0, drifted: false };
}

/* ------------------------------------------------------------ the two levels
 *
 * Both are thin: everything that makes a push safe - awaiting it, batching it,
 * banking a restore point, grouping the run, reaching templates without
 * writing content into them - is `runPropagation` above, and neither level has
 * its own copy of any of it.
 */

/**
 * A saved SECTION was saved: push it to every page that follows it.
 *
 * `options.previousSection` is the master's content BEFORE this save. An
 * instance whose content already differs from THAT (not from the new proposal)
 * was edited directly on its own page while still marked Following, and is
 * skipped rather than flattened - unless `options.overwriteDrifted` says
 * otherwise. Omitting it disables the check entirely, which is the safe
 * default for a caller that does not have the "before": nothing is skipped,
 * exactly as this behaved before drift detection existed.
 *
 * Returns the tally so a caller can surface a partial failure instead of
 * reporting a save that only half landed.
 */
async function propagateCanonicalSection(savedSectionId, updatedSection, scope, options = {}) {
  if (!savedSectionId || !updatedSection) return emptyTally();

  const { hasSectionDrifted } = require('./builder');
  const previousSection = options.previousSection || null;
  const overwriteDrifted = options.overwriteDrifted === true;

  function applyToPage(sections) {
    let changed = false;
    let drifted = false;
    let instances = 0;
    let locked = 0;

    const next = sections.map((section) => {
      if (!linksTo(section, SECTION_LEVEL, savedSectionId)) return section;
      if (!followsMaster(section, SECTION_LEVEL, savedSectionId)) {
        locked += 1;
        return section;
      }

      // Drift is measured whenever the "before" is known - even on a forced
      // push, so an overwritten copy can be NAMED as overwritten rather than
      // silently folded into the ordinary count.
      const hasDrift = previousSection ? hasSectionDrifted(section, previousSection) : false;
      if (hasDrift) drifted = true;
      if (hasDrift && !overwriteDrifted) {
        // Left exactly as it is on this page - a hand edit made here, not
        // through the master, is not this push's to overwrite by default.
        return section;
      }

      changed = true;
      instances += 1;
      // Replace content with the master's, keep only this instance's own id
      // and its provenance.
      return markFollowing({ ...updatedSection, id: section.id, savedSectionId }, true);
    });

    return { sections: next, changed, drifted, instances, locked };
  }

  return runPropagation({
    level: SECTION_LEVEL,
    masterId: savedSectionId,
    scope,
    options,
    applyToPage,
    applyToTemplate: (sections) => normalizeTemplateFrame(sections, savedSectionId),
    deps: options.deps || {},
  });
}

/**
 * A saved MODULE was saved: push it to every copy that follows it.
 *
 * Two shapes, because a saved module record can hold more than one module:
 *   one module  - the copy's content fields are replaced in place, so its id,
 *                 its column and its position are all preserved.
 *   many        - each consecutive run of copies in the same column is replaced
 *                 wholesale with fresh copies of the master's modules.
 *
 * A run stops at the first copy that does not follow, so a locked copy sitting
 * inside a multi-module run is left alone instead of being swallowed by the
 * replacement - which is what the previous version did, checking the lock only
 * on the module that started the run.
 */
async function propagateCanonicalModule(savedModuleId, canonicalModules, scope, options = {}) {
  const masters = Array.isArray(canonicalModules) ? canonicalModules : [];
  if (!savedModuleId || !masters.length) return emptyTally();

  const single = masters.length === 1;

  function applyToSections(sections, ctx, { skipFrameSections = false } = {}) {
    let changed = false;
    let instances = 0;
    let locked = 0;
    let minted = 0;

    const next = sections.map((section) => {
      // A template's FRAME is not the template's content -- it belongs to the
      // shared section it links to, and that master's own copy of this module
      // is being pushed to directly. Writing here is pointless at best: a
      // reference has no content to write into, and a legacy stored copy is
      // discarded the moment the frame resolves against its live master.
      // Materializing modules into a reference would also turn it back into a
      // copy, recreating the second source of truth cb27a65 deleted.
      if (skipFrameSections && isFrameSection(section)) return section;

      const modules = Array.isArray(section.modules) ? section.modules : [];
      if (!modules.some((module) => linksTo(module, MODULE_LEVEL, savedModuleId))) return section;

      let sectionChanged = false;

      if (single) {
        const master = masters[0];
        const nextModules = modules.map((module) => {
          if (!linksTo(module, MODULE_LEVEL, savedModuleId)) return module;
          if (!followsMaster(module, MODULE_LEVEL, savedModuleId)) {
            locked += 1;
            return module;
          }
          sectionChanged = true;
          instances += 1;
          return markFollowing({
            ...module,
            type: master.type,
            name: master.name,
            text: master.text,
            settings: { ...master.settings },
          }, true);
        });
        if (!sectionChanged) return section;
        changed = true;
        return { ...section, modules: nextModules };
      }

      const nextModules = [];
      for (let i = 0; i < modules.length; i += 1) {
        const module = modules[i];
        if (!linksTo(module, MODULE_LEVEL, savedModuleId)) {
          nextModules.push(module);
          continue;
        }
        if (!followsMaster(module, MODULE_LEVEL, savedModuleId)) {
          locked += 1;
          nextModules.push(module);
          continue;
        }

        // The run: consecutive copies of this master in the same column, and
        // it ends at the first one that has opted out.
        const column = module.column;
        let end = i;
        while (
          end + 1 < modules.length
          && linksTo(modules[end + 1], MODULE_LEVEL, savedModuleId)
          && modules[end + 1].column === column
          && followsMaster(modules[end + 1], MODULE_LEVEL, savedModuleId)
        ) {
          end += 1;
        }
        i = end;

        for (const master of masters) {
          minted += 1;
          instances += 1;
          nextModules.push(markFollowing({
            ...master,
            // Unique within the run AND across runs: the old id folded in
            // Date.now(), so two pushes inside the same millisecond minted the
            // same ids twice.
            id: `${master.type}-push-${ctx.runId.slice(0, 8)}-${minted}`,
            column,
            savedModuleId,
            settings: { ...master.settings },
          }, true));
        }
        sectionChanged = true;
      }

      if (!sectionChanged) return section;
      changed = true;
      return { ...section, modules: nextModules };
    });

    return { sections: next, changed, drifted: false, instances, locked };
  }

  return runPropagation({
    level: MODULE_LEVEL,
    masterId: savedModuleId,
    scope,
    options,
    applyToPage: (sections, ctx) => applyToSections(sections, ctx),
    // A template's own BODY sections take the push exactly like a page's do.
    // Its frame is stepped over -- see applyToSections.
    applyToTemplate: (sections) => applyToSections(
      sections,
      { runId: `tpl-${savedModuleId}` },
      { skipFrameSections: true }
    ),
    deps: options.deps || {},
  });
}

module.exports = {
  PROPAGATION_CONCURRENCY,
  PROPAGATION_SCAN_LIMIT,
  SECTION_LEVEL,
  MODULE_LEVEL,
  linksTo,
  followsMaster,
  markFollowing,
  normalizeTemplateFrame,
  runPropagation,
  propagateCanonicalSection,
  propagateCanonicalModule,
};
