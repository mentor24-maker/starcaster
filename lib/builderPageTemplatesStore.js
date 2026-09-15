'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const {
  normalizeStarCasterTemplateKind,
  readLayoutSectionsFromRow,
  writeLayoutSectionsToRow,
  normalizeEmailFunction,
} = require('./builder');

function table() {
  return tableConfig().builderPageTemplates;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeContentOverrides(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return normalizeContentOverrides(JSON.parse(value));
    } catch (_) {
      return {};
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  const next = {};
  Object.entries(value).forEach(([key, raw]) => {
    const cleanKey = safeText(key, 120);
    if (!cleanKey) return;
    next[cleanKey] = safeText(raw, 10000);
  });
  return next;
}

function rowToPageTemplate(row) {
  if (!row) return null;
  const document = readLayoutSectionsFromRow(row);
  return {
    id: String(row.id ?? ''),
    name: safeText(row.name, 255),
    templateKind: normalizeStarCasterTemplateKind(row.template_kind || row.templateKind),
    templateId: safeText(row.template_id, 120),
    emailFunction: normalizeEmailFunction(row.email_function || row.emailFunction),
    summary: safeText(row.summary, 1000),
    subject: safeText(row.subject, 500),
    emailSlug: safeText(row.email_slug || row.emailSlug, 120),
    primaryColor: safeText(row.primary_color, 20),
    backgroundColor: safeText(row.background_color, 20),
    accentColor: safeText(row.accent_color, 20),
    formId: safeText(row.form_id, 120),
    leadMagnetId: safeText(row.lead_magnet_id, 120),
    headlineId: safeText(row.headline_id, 120),
    pitchId: safeText(row.pitch_id, 120),
    ctaId: safeText(row.cta_id, 120),
    websiteBannerImageId: safeText(row.website_banner_image_id, 120),
    backgroundImageId: safeText(row.background_image_id, 120),
    featureImageId: safeText(row.feature_image_id, 120),
    highlightImageId: safeText(row.highlight_image_id, 120),
    featureHeadlineId: safeText(row.feature_headline_id, 120),
    featureSubheadingId: safeText(row.feature_subheading_id, 120),
    featureTitle: safeText(row.feature_title, 500),
    featureCopy: safeText(row.feature_copy, 5000),
    highlightHeadlineId: safeText(row.highlight_headline_id, 120),
    highlightPitchId: safeText(row.highlight_pitch_id, 120),
    highlightTitle: safeText(row.highlight_title, 500),
    highlightCopy: safeText(row.highlight_copy, 5000),
    bodyHeadlineId: safeText(row.body_headline_id, 120),
    bodySubheadingId: safeText(row.body_subheading_id, 120),
    bodyPitchId: safeText(row.body_pitch_id, 120),
    logoWideId: safeText(row.logo_wide_id, 120),
    logoSquareId: safeText(row.logo_square_id, 120),
    pageBackground: document.pageBackground,
    theme: document.theme,
    layoutSections: document.layoutSections,
    contentOverrides: normalizeContentOverrides(row.content_overrides),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function hasInputField(input, ...keys) {
  if (!input || typeof input !== 'object') return false;
  return keys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

/**
 * Does this patch touch the shared layout column?
 *
 * ONE predicate, used by both the rebuild below and the carry in
 * updatePageTemplate. They have to agree: a patch that rebuilds the column
 * without the carry firing is exactly the bug this file is being fixed for,
 * only through a different door. (The page store keeps two separate
 * conditions for these -- noted on task 86bc0kq2u; unreachable there today,
 * and it is #699's file, so it gets its own ticket rather than a conflict.)
 */
function touchesLayoutColumn(input) {
  return hasInputField(
    input,
    'layoutSections',
    'layout_sections',
    'pageBackground',
    'page_background',
    'theme',
  );
}

/**
 * `layout_sections` is ONE column holding THREE things: the sections, the
 * page background, and the template theme. The rebuild below reconstructs the
 * whole column whenever a patch names any one of them -- so a patch naming
 * only `layoutSections` writes `theme: undefined`, the serializer supplies its
 * default, and the template's typography is gone. The save reports success.
 *
 * That is what the Builder does. Measured 2026-09-14 (task 86bc0kq2u):
 * `saveCreatedModule` and `deleteCreatedModule`
 * (components/admin-builder-editor.tsx) both PATCH
 * /api/admin/page-templates/<id> with `{name, pageBackground, layoutSections}`
 * and no `theme`, so saving or deleting one module on a page template reset
 * its heading sizes, line heights and heading weights to the defaults. Four
 * stored templates carry a theme of their own, and pages built from a
 * template inherit whatever it holds, so the loss spreads past the template.
 *
 * So: a patch touching the layout column carries forward whatever it did not
 * name. A patch that DOES name theme or pageBackground -- including one naming
 * it as `{}`, which is how a template is deliberately reset to the defaults --
 * is left alone, because hasInputField asks whether the key is PRESENT, never
 * whether the value is truthy.
 *
 * Without `previous` there is nothing to carry and the old behaviour stands:
 * a caller whose read could not be taken is no worse off than before.
 */
function mergeLayoutColumnFromPrevious(input, previous) {
  if (!touchesLayoutColumn(input) || !previous) return input;
  const merged = { ...input };
  if (!hasInputField(input, 'theme')) merged.theme = previous.theme;
  if (!hasInputField(input, 'pageBackground', 'page_background')) {
    merged.pageBackground = previous.pageBackground;
  }
  return merged;
}

/**
 * `partial` is what an UPDATE wants and what a CREATE must not have.
 *
 * Without it every column is rebuilt from the patch, so each one the caller
 * did not name is written as its default. The Builder's module save names
 * three fields, so it was blanking the other 31 -- summary on 31 of the 44
 * stored templates, template_id on all 44, and template_kind flipped from
 * `starcaster_landing` to `modular` on 31, which changes what the template IS
 * rather than how it looks (measured 2026-09-14, task 86bc0kq2u).
 *
 * createPageTemplate still builds the full row, which is correct there: a new
 * row genuinely does want a default in every column the caller left out.
 */
function inputToRow(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object') return {};
  const row = {};

  const set = (condition, key, value) => {
    if (!partial || condition) row[key] = value;
  };

  const text = (field, column, max, alt) => {
    set(hasInputField(input, field, alt || column), column, safeText(input?.[field], max));
  };

  set(
    hasInputField(input, 'templateKind', 'template_kind'),
    'template_kind',
    normalizeStarCasterTemplateKind(input?.templateKind || input?.template_kind),
  );
  text('templateId', 'template_id', 120);
  set(
    hasInputField(input, 'emailFunction', 'email_function'),
    'email_function',
    normalizeEmailFunction(input?.emailFunction || input?.email_function) || null,
  );
  set(
    hasInputField(input, 'emailSlug', 'email_slug', 'slug'),
    'email_slug',
    safeText(input?.emailSlug || input?.email_slug || input?.slug, 120) || null,
  );
  text('name', 'name', 255);
  text('summary', 'summary', 1000);
  text('subject', 'subject', 500);
  text('primaryColor', 'primary_color', 20);
  text('backgroundColor', 'background_color', 20);
  text('accentColor', 'accent_color', 20);
  text('formId', 'form_id', 120);
  text('leadMagnetId', 'lead_magnet_id', 120);
  text('headlineId', 'headline_id', 120);
  text('pitchId', 'pitch_id', 120);
  text('ctaId', 'cta_id', 120);
  text('websiteBannerImageId', 'website_banner_image_id', 120);
  text('backgroundImageId', 'background_image_id', 120);
  text('featureImageId', 'feature_image_id', 120);
  text('highlightImageId', 'highlight_image_id', 120);
  text('featureHeadlineId', 'feature_headline_id', 120);
  text('featureSubheadingId', 'feature_subheading_id', 120);
  text('featureTitle', 'feature_title', 500);
  text('featureCopy', 'feature_copy', 5000);
  text('highlightHeadlineId', 'highlight_headline_id', 120);
  text('highlightPitchId', 'highlight_pitch_id', 120);
  text('highlightTitle', 'highlight_title', 500);
  text('highlightCopy', 'highlight_copy', 5000);
  text('bodyHeadlineId', 'body_headline_id', 120);
  text('bodySubheadingId', 'body_subheading_id', 120);
  text('bodyPitchId', 'body_pitch_id', 120);
  text('logoWideId', 'logo_wide_id', 120);
  text('logoSquareId', 'logo_square_id', 120);
  set(
    hasInputField(input, 'contentOverrides', 'content_overrides'),
    'content_overrides',
    normalizeContentOverrides(input?.contentOverrides),
  );

  if (touchesLayoutColumn(input) || !partial) {
    row.layout_sections = writeLayoutSectionsToRow({
      pageBackground: input?.pageBackground || input?.page_background,
      theme: input?.theme,
      layoutSections: input?.layoutSections || input?.layout_sections,
    });
  }
  return row;
}

function shouldRetryWithoutModularColumns(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  return message.includes('layout_sections')
    || message.includes('template_kind')
    || message.includes('email_function')
    || message.includes('email_slug');
}

function stripModularColumns(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.template_kind;
  delete next.layout_sections;
  delete next.email_function;
  delete next.email_slug;
  delete next.summary;
  delete next.subject;
  return next;
}

function requiresModularColumns(input) {
  const kind = normalizeStarCasterTemplateKind(input?.templateKind || input?.template_kind);
  const hasSections = input?.layoutSections !== undefined
    || input?.layout_sections !== undefined
    || input?.pageBackground !== undefined;
  return kind === 'modular' || kind === 'email' || hasSections;
}

async function listPageTemplates(limit = 1000, scope = null, options = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  let query = `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`;
  if (options.templateKind) {
    query += `&template_kind=eq.${encodeURIComponent(options.templateKind)}`;
  }
  query = await scopedListQuery(table(), query, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToPageTemplate) : [],
  };
}

async function createPageTemplate(input, scope = null) {
  const row = await scopedInsertRow(table(), inputToRow(input), scope);
  let res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok && shouldRetryWithoutModularColumns(res)) {
    if (requiresModularColumns(input)) {
      return {
        ok: false,
        status: 500,
        error: 'Page templates require builder schema columns. Run docs/SQL/builder_page_templates_modular_migration.sql and builder_page_templates_email_migration.sql in Supabase.',
      };
    }
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripModularColumns(row)],
    });
  }
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return {
    ok: true,
    status: 201,
    data: rowToPageTemplate(created),
  };
}

/**
 * The template as it stands right now, or null if it cannot be read.
 *
 * Scoped like every other read here, so it can never reach another tenant's
 * template. A failure returns null rather than throwing: the carry above
 * degrades to the old behaviour when there is nothing to carry, and a save
 * must not start failing because a read did.
 */
async function readPageTemplate(templateId, scope) {
  const query = await scopedIdQuery(table(), `id=eq.${templateId}&select=*`, scope);
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return null;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  return row ? rowToPageTemplate(row) : null;
}

async function updatePageTemplate(id, input, scope = null) {
  const templateId = Number(id || 0) || 0;
  if (!templateId) return { ok: false, status: 400, error: 'id is required' };
  // A layout save has to read the row first: layout_sections is one column
  // holding the sections, the page background and the theme, and the patch
  // that names one of them rebuilds all three (task 86bc0kq2u). Only a save
  // that touches that column pays for the read.
  const previous = touchesLayoutColumn(input) ? await readPageTemplate(templateId, scope) : null;
  const row = await scopedPatchRow(
    table(),
    inputToRow(mergeLayoutColumnFromPrevious(input, previous), { partial: true }),
    scope
  );
  const query = await scopedIdQuery(table(), `id=eq.${templateId}&select=*`, scope);
  let res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok && shouldRetryWithoutModularColumns(res)) {
    if (requiresModularColumns(input)) {
      return {
        ok: false,
        status: 500,
        error: 'Page templates require builder schema columns. Run docs/SQL/builder_page_templates_modular_migration.sql and builder_page_templates_email_migration.sql in Supabase.',
      };
    }
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripModularColumns(row),
    });
  }
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Page template not found' };
  return {
    ok: true,
    status: 200,
    data: rowToPageTemplate(updated),
  };
}

async function deletePageTemplate(id, scope = null) {
  const templateId = Number(id || 0) || 0;
  if (!templateId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${templateId}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Page template not found' };
  return {
    ok: true,
    status: 200,
    data: rowToPageTemplate(removed),
  };
}

module.exports = {
  listPageTemplates,
  // Exported for scripts/builder/pageTemplateLayoutColumnCarry.test.js. These
  // two are the whole of the fix for task 86bc0kq2u: the carry is what keeps a
  // module save from wiping the template's theme, and the predicate is what
  // keeps the carry firing on exactly the patches that rebuild the column.
  mergeLayoutColumnFromPrevious,
  touchesLayoutColumn,
  createPageTemplate,
  updatePageTemplate,
  deletePageTemplate,
  rowToPageTemplate,
};
