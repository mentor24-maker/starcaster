'use strict';

/**
 * The font library — font families whose files Starcaster keeps itself, so a
 * site can use fonts beyond Google Fonts (Font Library 1/7, task 86bchyd3n).
 *
 * Table: docs/SQL/fonts_library_setup.sql. Nothing reads it yet; the Fonts
 * screen is 2/7 and the theme picker is 3/7.
 *
 * Two kinds of row. A PLATFORM font belongs to Starcaster's shared library:
 * every project reads it, no project may change or delete it, and its tenant
 * columns are NULL. A PROJECT font belongs to the project that uploaded it and
 * nobody else sees it. Every read here is "the shared library plus my own",
 * and every write is "my own only".
 *
 * Every function returns the `{ ok, status, data }` envelope, never a bare row
 * (DOCTRINE 5.10). The list takes the limit FIRST (CLAUDE.md landmine 12b).
 *
 * TENANCY FAILS CLOSED, the same way lib/youtubeOutreachStore.js does it, and
 * the filters are written out here rather than borrowed from
 * lib/projectScope.js on purpose: that helper reads NULL-project rows as a
 * project's own legacy rows when strict scope is off, and here a NULL project
 * means "shared with everyone" — a different rule, so it gets its own words.
 */

const { sbQuery } = require('./supabase');
const { supportsProjectColumns } = require('./projectScope');
const { resolveLimit } = require('./storeLimit');
const { slugify } = require('./slugify');
const { checkFontLicence, checkFontFamilyName, checkFontCategory } = require('./fontLicence');
const { checkFontStyle } = require('./fontFiles');

const TABLE = 'fonts';

const PLATFORM_FONT_REFUSED =
  "This font is part of Starcaster's shared font library, which every project uses, "
  + 'so one project cannot change or delete it.';

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function safeText(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

async function requireScope(scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) return refuse('No project is selected, so there is no font library to read or change.');
  const supported = await supportsProjectColumns(TABLE);
  if (!supported) {
    return refuse(
      'The fonts table is not available with its project columns, so it cannot be read safely. '
      + 'Has docs/SQL/fonts_library_setup.sql been applied to this database?',
      503
    );
  }
  return { ok: true, projectId, userId: safeText(scope?.userId || scope?.user_id, 120) };
}

/** Shared library + this project's own uploads, and nothing else. */
function visibleTo(projectId) {
  return `or=(visibility.eq.platform,and(visibility.eq.project,project_id.eq.${encodeURIComponent(projectId)}))`;
}

function rowToFont(row) {
  if (!row) return null;
  return {
    id: row.id,
    family: row.family,
    slug: row.slug,
    category: row.category,
    styles: Array.isArray(row.styles) ? row.styles : [],
    licence: row.licence,
    licenceText: row.licence_text || '',
    sourceUrl: row.source_url || '',
    sourceName: row.source_name || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    previewText: row.preview_text || '',
    visibility: row.visibility,
    projectId: row.project_id || null,
    ownerUserId: row.owner_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return { ok: false, message: 'tags must be a list of words.' };
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const value = safeText(tag, 40).toLowerCase().replace(/\s+/g, ' ');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  if (out.length > 50) return { ok: false, message: 'A font can carry at most 50 tags.' };
  return { ok: true, tags: out };
}

function cleanStyles(styles) {
  if (!Array.isArray(styles) || !styles.length) {
    return { ok: false, message: 'A font needs at least one font file.' };
  }
  const seen = new Set();
  const out = [];
  for (const entry of styles) {
    const checked = checkFontStyle(entry || {});
    if (!checked.ok) return checked;
    const url = safeText(entry.url, 1000);
    if (!/^https:\/\//i.test(url)) return { ok: false, message: 'Every font file needs the https address it is stored at.' };
    const key = `${checked.weight}-${checked.style}`;
    if (seen.has(key)) {
      return { ok: false, message: `Two files are both weight ${checked.weight} ${checked.style}. Each weight and style needs its own file.` };
    }
    seen.add(key);
    out.push({
      weight: checked.weight,
      style: checked.style,
      url,
      format: safeText(entry.format, 10),
      pathname: safeText(entry.pathname, 500),
    });
  }
  out.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style));
  return { ok: true, styles: out };
}

/**
 * Everything a font row must satisfy, checked BEFORE any file is stored, so a
 * refused upload leaves nothing behind. `styles` is not checked here because
 * the files do not exist yet; createFont checks them.
 */
function checkFontInput(input = {}) {
  const licence = checkFontLicence(input.licence);
  if (!licence.ok) return refuse(licence.message);
  const family = checkFontFamilyName(input.family);
  if (!family.ok) return refuse(family.message);
  const category = checkFontCategory(input.category);
  if (!category.ok) return refuse(category.message);
  const tags = cleanTags(input.tags === undefined ? [] : input.tags);
  if (!tags.ok) return refuse(tags.message);
  const sourceUrl = safeText(input.sourceUrl, 1000);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return refuse('The source address must start with http:// or https://.');
  return {
    ok: true,
    status: 200,
    data: {
      family: family.family,
      slug: slugify(family.family),
      category: category.category,
      licence: licence.licence,
      licenceText: safeText(input.licenceText, 20000),
      sourceUrl,
      sourceName: safeText(input.sourceName, 120),
      tags: tags.tags,
      previewText: safeText(input.previewText, 300),
    },
  };
}

/**
 * The shared library plus this project's fonts, alphabetical. Limit FIRST.
 */
async function listFonts(limit, scope) {
  const lim = resolveLimit(limit, { fallback: 500, max: 2000 });
  if (!lim.ok) return refuse(lim.error, 500);
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const query = `select=*&${visibleTo(gate.projectId)}&order=family.asc&limit=${lim.limit}`;
  const res = await sbQuery({ method: 'GET', table: TABLE, query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToFont) };
}

async function getFont(id, scope) {
  const fontId = safeText(id, 80);
  if (!fontId) return refuse('Which font? No id was given.');
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const query = `select=*&id=eq.${encodeURIComponent(fontId)}&${visibleTo(gate.projectId)}&limit=1`;
  const res = await sbQuery({ method: 'GET', table: TABLE, query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return refuse('Font not found in this project or the shared library.', 404);
  return { ok: true, status: 200, data: rowToFont(found) };
}

/** Is a family with this slug already in the scope a new font would join? */
async function findFontBySlug(slug, scope, { visibility = 'project' } = {}) {
  let query = `select=id,family&slug=eq.${encodeURIComponent(slug)}&visibility=eq.${visibility}&limit=1`;
  if (visibility === 'project') {
    const gate = await requireScope(scope);
    if (!gate.ok) return gate;
    query += `&project_id=eq.${encodeURIComponent(gate.projectId)}`;
  }
  const res = await sbQuery({ method: 'GET', table: TABLE, query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: found || null };
}

/**
 * Save a font whose files are already stored.
 *
 * A project font (the default, and the only kind the API makes) is stamped
 * with the caller's project and user. A platform font is for scripts filling
 * the shared library (4/7) and carries no tenant.
 */
async function createFont(input, scope, { visibility = 'project' } = {}) {
  if (visibility !== 'project' && visibility !== 'platform') return refuse(`Unknown font visibility "${visibility}".`, 500);
  const checked = checkFontInput(input);
  if (!checked.ok) return checked;
  const styles = cleanStyles(input.styles);
  if (!styles.ok) return refuse(styles.message);
  const font = checked.data;

  let projectId = null;
  let ownerUserId = null;
  if (visibility === 'project') {
    const gate = await requireScope(scope);
    if (!gate.ok) return gate;
    projectId = gate.projectId;
    ownerUserId = gate.userId || null;
  }

  const now = new Date().toISOString();
  const row = {
    family: font.family,
    slug: font.slug,
    category: font.category,
    styles: styles.styles,
    licence: font.licence,
    licence_text: font.licenceText,
    source_url: font.sourceUrl,
    source_name: font.sourceName,
    tags: font.tags,
    preview_text: font.previewText,
    visibility,
    project_id: projectId,
    owner_user_id: ownerUserId,
    created_at: now,
    updated_at: now,
  };
  const res = await sbQuery({
    method: 'POST',
    table: TABLE,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) {
    if (res.status === 409) {
      return refuse(`A font called "${font.family}" is already in ${visibility === 'platform' ? 'the shared library' : 'this project'}.`, 409);
    }
    return res;
  }
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) return refuse('The font was not saved — the database returned no row.', 500);
  return { ok: true, status: 201, data: rowToFont(saved) };
}

/** Load a font this project may change: its own, never a platform one. */
async function ownFontOrRefuse(id, scope) {
  const found = await getFont(id, scope);
  if (!found.ok) return found;
  if (found.data.visibility !== 'project') return refuse(PLATFORM_FONT_REFUSED, 403);
  return found;
}

/**
 * Change a project font's tags and/or preview text. Platform fonts: 403.
 */
async function updateFontTags(id, { tags, previewText } = {}, scope) {
  const found = await ownFontOrRefuse(id, scope);
  if (!found.ok) return found;
  const body = { updated_at: new Date().toISOString() };
  if (tags !== undefined) {
    const cleaned = cleanTags(tags);
    if (!cleaned.ok) return refuse(cleaned.message);
    body.tags = cleaned.tags;
  }
  if (previewText !== undefined) body.preview_text = safeText(previewText, 300);
  if (Object.keys(body).length === 1) return refuse('Nothing to change — send tags or previewText.');

  const query = `id=eq.${encodeURIComponent(found.data.id)}&visibility=eq.project`
    + `&project_id=eq.${encodeURIComponent(found.data.projectId)}&select=*`;
  const res = await sbQuery({ method: 'PATCH', table: TABLE, query, headers: { Prefer: 'return=representation' }, body });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('The font was not changed — the database matched no row.', 404);
  return { ok: true, status: 200, data: rowToFont(updated) };
}

/**
 * Remove a project font's row. Platform fonts: 403. Returns the removed font
 * so the caller can delete its files from blob storage.
 */
async function deleteFont(id, scope) {
  const found = await ownFontOrRefuse(id, scope);
  if (!found.ok) return found;
  const query = `id=eq.${encodeURIComponent(found.data.id)}&visibility=eq.project`
    + `&project_id=eq.${encodeURIComponent(found.data.projectId)}`;
  const res = await sbQuery({ method: 'DELETE', table: TABLE, query, headers: { Prefer: 'return=representation' } });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return refuse('The font was not deleted — the database matched no row.', 404);
  return { ok: true, status: 200, data: rowToFont(removed) };
}

module.exports = {
  PLATFORM_FONT_REFUSED,
  checkFontInput,
  createFont,
  deleteFont,
  findFontBySlug,
  getFont,
  listFonts,
  updateFontTags,
};
