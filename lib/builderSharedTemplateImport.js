'use strict';

/**
 * Import a page template another project shares with this one (task 86bcu6ubh).
 *
 * A template is a FRAME of shared sections plus a body
 * (lib/builder-client/builder-template-frame.ts). Each frame section carries
 * `canonical: true` and a `savedSectionId` naming a saved section in the
 * project the template was built in — that is how the header, the menu and the
 * footer are held. Copying only the template row would leave those ids
 * pointing at the SOURCE project's sections, which the receiving project can
 * neither see nor edit: on a page made from it the header and footer would
 * vanish (`resolveFrameSection` drops a reference whose master it cannot find).
 *
 * So the import brings what the template needs:
 *
 *   1. Re-check the share. The list the screen showed may be minutes old.
 *   2. Read every saved section the frame points at, from the SOURCE project
 *      only. They need not be shared on their own: sharing the template is
 *      sharing what it is built from.
 *   3. Copy each one into the receiving project (lib/builderSharedImport.js —
 *      one implementation of "copy a section in"), suffixing a clashing name.
 *   4. Rewrite the frame to the new ids, and strip lineage from the body.
 *   5. Only then insert the template, both tenant columns explicit, and read
 *      it back. Sections first: a failure part-way never leaves a template
 *      pointing at sections that do not exist. If the template itself cannot
 *      be saved, the sections this import made are deleted again.
 *
 * Two cases the frame can carry and what happens to each:
 *
 *   - The master is gone from the source, but the template still holds its
 *     own full copy (templates saved before stage 4 did): that copy becomes
 *     the new saved section, so the import keeps what the source renders.
 *   - The master is gone and the template holds only a reference: the source
 *     renders nothing there either, so the reference is dropped and counted
 *     in the answer rather than written as a link to nowhere.
 *
 * Content ids on the row (`form_id`, `headline_id`, image ids …) name records
 * in the SOURCE project's libraries. A form id carried across would submit
 * into another client's form, so they are cleared. Media URLs inside the
 * sections are left exactly as they are — the operator said shared assets need
 * not be recreated.
 *
 * The source project is read and nothing else.
 */

const { sbQuery, tableConfig } = require('./supabase');
const sharesStore = require('./builderProjectSharesStore');
const { rowToPageTemplate } = require('./builderPageTemplatesStore');
const { readLayoutSectionsFromRow, writeLayoutSectionsToRow } = require('./builder');
const {
  uniqueImportName,
  stripLineage,
  listSectionNames,
  insertSavedSectionCopy,
} = require('./builderSharedImport');

/** Columns that belong to the SOURCE row's identity and are never copied. */
const NOT_COPIED = ['id', 'project_id', 'owner_user_id', 'created_at', 'updated_at'];

/**
 * Columns naming records in the source project's own libraries (forms, copy,
 * images). Cleared on the copy: they mean nothing in the receiving project,
 * and a form id would route submissions to another client.
 */
const SOURCE_RECORD_COLUMNS = [
  'form_id', 'lead_magnet_id', 'headline_id', 'pitch_id', 'cta_id',
  'website_banner_image_id', 'background_image_id', 'feature_image_id', 'highlight_image_id',
  'feature_headline_id', 'feature_subheading_id', 'highlight_headline_id', 'highlight_pitch_id',
  'body_headline_id', 'body_subheading_id', 'body_pitch_id', 'logo_wide_id', 'logo_square_id',
];

function safeText(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function templatesTable() {
  return tableConfig().builderPageTemplates;
}

function savedSectionsTable() {
  return tableConfig().builderSavedSections;
}

async function read(table, query, what) {
  const res = await sbQuery({ method: 'GET', table, query });
  if (!res.ok) return { ok: false, status: res.status || 500, error: res.error || `Could not read ${what}` };
  return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
}

/** Same test as builder-template-frame.ts `isFrameSection`. */
function isFrameSection(section) {
  return Boolean(section && typeof section === 'object' && section.canonical === true && section.savedSectionId);
}

/** Same test as builder-template-frame.ts `isFrameReference`. */
function isFrameReference(section) {
  return isFrameSection(section) && (!Array.isArray(section.modules) || section.modules.length === 0);
}

/** The distinct saved-section ids a template's frame points at, in order. */
function frameSectionIds(sections) {
  const ids = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    if (!isFrameSection(section)) continue;
    const id = safeText(section.savedSectionId, 120);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The template's sections with every frame reference pointed at its copy in
 * the receiving project (`idMap`: source id → new id). A frame section whose
 * id has no copy is dropped. Body sections lose any lineage marker, which would
 * otherwise point at a master in the source project.
 */
function rewriteFrameReferences(sections, idMap) {
  const out = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    if (!isFrameSection(section)) {
      out.push(stripLineage(section));
      continue;
    }
    const newId = idMap[safeText(section.savedSectionId, 120)];
    if (!newId) continue;
    const { canonicalLocked } = section;
    const copy = stripLineage(section);
    copy.canonical = true;
    copy.savedSectionId = newId;
    if (canonicalLocked !== undefined) copy.canonicalLocked = canonicalLocked;
    out.push(copy);
  }
  return out;
}

async function deleteSections(projectId, ids) {
  for (const id of ids) {
    await sbQuery({
      method: 'DELETE',
      table: savedSectionsTable(),
      query: `id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(projectId)}`,
    }).catch(() => null);
  }
}

/**
 * Copy the shared page template `templateId` into `targetProjectId`, with the
 * saved sections its frame points at.
 *
 * Returns `{ ok, status, data | error }`; `data` is
 * `{ template, savedSections, droppedReferences }`. A template that is not
 * (or no longer) shared with the target is a 404 with a plain sentence — the
 * same answer whether it was unshared, deleted, is an email template, or never
 * existed, so the receiving project learns nothing it was not shown.
 */
async function copySharedPageTemplate({ targetProjectId, ownerUserId, templateId }) {
  const target = safeText(targetProjectId);
  const owner = safeText(ownerUserId);
  const id = safeText(templateId, 120);
  if (!target) return { ok: false, status: 400, error: 'An active project is required' };
  if (!owner) return { ok: false, status: 401, error: 'Not authenticated' };
  if (!id) return { ok: false, status: 400, error: 'A template id is required' };

  const notShared = {
    ok: false,
    status: 404,
    error: 'That template is no longer shared with this project, so it cannot be imported. Reload the list to see what is shared now.',
  };

  const sources = await sharesStore.listSourcesSharingWith(target, 'page_templates');
  if (!sources.ok) return sources;
  if (!sources.data.length) return notShared;

  const found = await read(templatesTable(), `select=*&id=eq.${encodeURIComponent(id)}&limit=1`, 'page templates');
  if (!found.ok) return found;
  const sourceRow = found.data[0];
  const sourceProjectId = safeText(sourceRow?.project_id);
  if (!sourceRow || !sourceProjectId || sourceProjectId === target) return notShared;
  if (!sources.data.includes(sourceProjectId)) return notShared;
  if (safeText(sourceRow.template_kind) === 'email') return notShared;

  const document = readLayoutSectionsFromRow(sourceRow);
  const sourceSections = Array.isArray(document.layoutSections) ? document.layoutSections : [];

  // Every master the frame points at, read from the SOURCE project only.
  const masters = {};
  for (const sectionId of frameSectionIds(sourceSections)) {
    const res = await read(
      savedSectionsTable(),
      `select=*&id=eq.${encodeURIComponent(sectionId)}&project_id=eq.${encodeURIComponent(sourceProjectId)}&limit=1`,
      'saved sections'
    );
    if (!res.ok) return res;
    if (res.data[0]) masters[sectionId] = res.data[0];
  }

  const names = await listSectionNames(target);
  if (!names.ok) return names;
  const takenNames = names.data.slice();

  // Sections first. Nothing points at them until the template is written.
  const idMap = {};
  const copied = [];
  let droppedReferences = 0;
  for (const section of sourceSections) {
    if (!isFrameSection(section)) continue;
    const sourceId = safeText(section.savedSectionId, 120);
    if (idMap[sourceId]) continue;
    const master = masters[sourceId];
    let content;
    let baseName;
    if (master) {
      content = master.section && typeof master.section === 'object' ? master.section : {};
      baseName = master.name;
    } else if (!isFrameReference(section)) {
      content = section;
      baseName = section.title;
    } else {
      droppedReferences += 1;
      continue;
    }
    const name = uniqueImportName(baseName, takenNames);
    takenNames.push(name);
    const stripped = stripLineage(content);
    delete stripped.id;
    const result = await insertSavedSectionCopy({ targetProjectId: target, ownerUserId: owner, name, section: stripped });
    if (!result.ok) {
      await deleteSections(target, copied.map((s) => s.id));
      return {
        ok: false,
        status: result.status || 500,
        error: `The template was not imported: its section "${name}" could not be copied (${result.error || 'unknown error'}).`,
      };
    }
    idMap[sourceId] = result.data.id;
    copied.push(result.data);
  }

  const existingTemplates = await read(
    templatesTable(),
    `select=name&project_id=eq.${encodeURIComponent(target)}&limit=5000`,
    'page templates'
  );
  if (!existingTemplates.ok) {
    await deleteSections(target, copied.map((s) => s.id));
    return existingTemplates;
  }
  const templateName = uniqueImportName(sourceRow.name || 'Imported template', existingTemplates.data.map((r) => r?.name));

  const row = {};
  for (const [key, value] of Object.entries(sourceRow)) {
    if (!NOT_COPIED.includes(key)) row[key] = value;
  }
  for (const column of SOURCE_RECORD_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(row, column)) row[column] = null;
  }
  row.name = templateName;
  // The ARRAY of sections, with the background and theme carried as they are
  // (CLAUDE.md landmine 13 — the wrong shape writes an empty template).
  row.layout_sections = writeLayoutSectionsToRow({
    pageBackground: document.pageBackground,
    theme: document.theme,
    layoutSections: rewriteFrameReferences(sourceSections, idMap),
  });
  row.project_id = target;
  row.owner_user_id = owner;

  const inserted = await sbQuery({
    method: 'POST',
    table: templatesTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  const insertedRow = inserted.ok ? (Array.isArray(inserted.data) ? inserted.data[0] : inserted.data) : null;
  if (!inserted.ok || !insertedRow || insertedRow.id === undefined || insertedRow.id === null) {
    await deleteSections(target, copied.map((s) => s.id));
    return {
      ok: false,
      status: inserted.status && inserted.status >= 400 ? inserted.status : 500,
      error: `The template could not be saved, so nothing was imported: ${inserted.error || 'the database returned no row'}`,
    };
  }

  // Read it back from the receiving project rather than trusting the insert.
  const readBack = await read(
    templatesTable(),
    `select=*&id=eq.${encodeURIComponent(String(insertedRow.id))}&project_id=eq.${encodeURIComponent(target)}&limit=1`,
    'page templates'
  );
  if (!readBack.ok) return readBack;
  const saved = readBack.data[0];
  if (!saved || safeText(saved.project_id) !== target || safeText(saved.owner_user_id) !== owner) {
    return {
      ok: false,
      status: 500,
      error: 'The template was sent to the database but could not be found in this project afterwards, so the import did not complete.',
    };
  }

  return {
    ok: true,
    status: 201,
    data: { template: rowToPageTemplate(saved), savedSections: copied, droppedReferences },
  };
}

module.exports = {
  frameSectionIds,
  rewriteFrameReferences,
  copySharedPageTemplate,
};
