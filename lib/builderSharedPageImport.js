'use strict';

/**
 * Import a website page another project shares with this one (task 86bcw3m94).
 *
 * The twin of lib/builderSharedTemplateImport.js, with one deliberate
 * difference. A page is a FRAME of shared sections (its site's header, menu
 * and footer — `canonical` links to saved sections) around a BODY that is the
 * page's own work. A template import brings its frame along, because the
 * frame is what a template is. A page import does not: the frame is the OTHER
 * site's header and footer, and a page moved into this project belongs under
 * this project's own. So the copy is the body only, and the answer says how
 * many frame sections were left out, so the screen can say so.
 *
 *   1. Re-check the share — THIS page, from THIS source, to THIS project. The
 *      list the screen showed may be minutes old.
 *   2. Read the page from the source project only (id AND project_id).
 *   3. Insert a copy into the receiving project: unpublished, a free name and
 *      address, both tenant columns explicit, then read it back.
 *
 * Cleared on the copy, because they name records in the SOURCE project:
 * its page template, its theme, and the content-library ids (a form id carried
 * across would submit into another client's form). Media URLs inside the
 * sections are left as they are — the operator said shared assets need not be
 * recreated.
 *
 * The source project is read and nothing else.
 */

const { sbQuery, tableConfig } = require('./supabase');
const sharesStore = require('./builderProjectSharesStore');
const { readLayoutSectionsFromRow, writeLayoutSectionsToRow } = require('./builder');
const { uniqueImportName, stripLineage } = require('./builderSharedImport');
const { resolveUniqueSlug } = require('./slugify');

/** The source row's identity, and the source's own page template and theme. */
const NOT_COPIED = [
  'id', 'project_id', 'owner_user_id', 'created_at', 'updated_at',
  'page_template_id', 'theme_id', 'published_at',
];

/** Same list, same reason, as the template import. */
const SOURCE_RECORD_COLUMNS = [
  'form_id', 'lead_magnet_id', 'headline_id', 'pitch_id', 'cta_id',
  'website_banner_image_id', 'background_image_id', 'feature_image_id', 'highlight_image_id',
  'feature_headline_id', 'feature_subheading_id', 'highlight_headline_id', 'highlight_pitch_id',
  'body_headline_id', 'body_subheading_id', 'body_pitch_id', 'logo_wide_id', 'logo_square_id',
];

function safeText(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function pagesTable() {
  return tableConfig().builderPages;
}

async function read(query, what = 'pages') {
  const res = await sbQuery({ method: 'GET', table: pagesTable(), query });
  if (!res.ok) return { ok: false, status: res.status || 500, error: res.error || `Could not read ${what}` };
  return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
}

/** Same test as builder-template-frame.ts `isFrameSection`. */
function isFrameSection(section) {
  return Boolean(section && typeof section === 'object' && section.canonical === true && section.savedSectionId);
}

/**
 * Copy the shared page `pageId` into `targetProjectId`.
 *
 * Returns `{ ok, status, data | error }`; `data` is
 * `{ page: { id, name, slug }, frameLeftOut }`. A page that is not (or no
 * longer) shared with the target is a 404 with a plain sentence — the same
 * answer whether it was unshared, deleted, or never existed, so the receiving
 * project learns nothing it was not shown.
 */
async function copySharedPage({ targetProjectId, ownerUserId, pageId }) {
  const target = safeText(targetProjectId);
  const owner = safeText(ownerUserId);
  const id = safeText(pageId, 120);
  if (!target) return { ok: false, status: 400, error: 'An active project is required' };
  if (!owner) return { ok: false, status: 401, error: 'Not authenticated' };
  if (!id) return { ok: false, status: 400, error: 'A page id is required' };

  const notShared = {
    ok: false,
    status: 404,
    error: 'That page is no longer shared with this project, so it cannot be imported. Reload the list to see what is shared now.',
  };

  const shares = await sharesStore.listPageSharesWith(target);
  if (!shares.ok) return shares;
  const share = shares.data.find((s) => s.pageId === id);
  if (!share) return notShared;

  const found = await read(
    `select=*&id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(share.sourceProjectId)}&limit=1`
  );
  if (!found.ok) return found;
  const sourceRow = found.data.find((r) => safeText(r?.project_id) === share.sourceProjectId);
  if (!sourceRow) return notShared;

  const existing = await read(`select=name,slug&project_id=eq.${encodeURIComponent(target)}&limit=5000`);
  if (!existing.ok) return existing;

  const document = readLayoutSectionsFromRow(sourceRow);
  const sourceSections = Array.isArray(document.layoutSections) ? document.layoutSections : [];
  const body = sourceSections.filter((section) => !isFrameSection(section)).map(stripLineage);
  const frameLeftOut = sourceSections.length - body.length;

  const row = {};
  for (const [key, value] of Object.entries(sourceRow)) {
    if (!NOT_COPIED.includes(key)) row[key] = value;
  }
  for (const column of SOURCE_RECORD_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(row, column)) row[column] = null;
  }
  row.name = uniqueImportName(sourceRow.name || 'Imported page', existing.data.map((r) => r?.name));
  // The one slug rule (lib/slugify.js), checked against this project's own
  // addresses. A home page's address is empty, so its copy is named from the
  // page instead — an import never takes over this site's home page.
  const takenSlugs = new Set(existing.data.map((r) => safeText(r?.slug, 160).toLowerCase()));
  row.slug = await resolveUniqueSlug(sourceRow.slug, row.name, async (slug) => (takenSlugs.has(slug) ? { id: '' } : null))
    || `imported-page-${Date.now().toString(36)}`;
  // A copy is a draft until somebody in THIS project decides to put it live.
  row.is_published = false;
  // The ARRAY of sections, with the background and theme carried as they are
  // (CLAUDE.md landmine 13 — the wrong shape writes an empty page).
  row.layout_sections = writeLayoutSectionsToRow({
    pageBackground: document.pageBackground,
    theme: document.theme,
    layoutSections: body,
  });
  row.project_id = target;
  row.owner_user_id = owner;

  const inserted = await sbQuery({
    method: 'POST',
    table: pagesTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  const insertedRow = inserted.ok ? (Array.isArray(inserted.data) ? inserted.data[0] : inserted.data) : null;
  if (!inserted.ok || !insertedRow || insertedRow.id === undefined || insertedRow.id === null) {
    return {
      ok: false,
      status: inserted.status && inserted.status >= 400 ? inserted.status : 500,
      error: `The page could not be saved, so nothing was imported: ${inserted.error || 'the database returned no row'}`,
    };
  }

  // Read it back from the receiving project rather than trusting the insert.
  const readBack = await read(
    `select=id,name,slug,project_id,owner_user_id&id=eq.${encodeURIComponent(String(insertedRow.id))}`
      + `&project_id=eq.${encodeURIComponent(target)}&limit=1`
  );
  if (!readBack.ok) return readBack;
  const saved = readBack.data[0];
  if (!saved || safeText(saved.project_id) !== target || safeText(saved.owner_user_id) !== owner) {
    return {
      ok: false,
      status: 500,
      error: 'The page was sent to the database but could not be found in this project afterwards, so the import did not complete.',
    };
  }

  return {
    ok: true,
    status: 201,
    data: {
      page: { id: String(saved.id), name: safeText(saved.name), slug: safeText(saved.slug, 160) },
      frameLeftOut,
    },
  };
}

module.exports = {
  copySharedPage,
};
