'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const {
  normalizeStarCasterTemplateKind,
  readLayoutSectionsFromRow,
  writeLayoutSectionsToRow,
} = require('./builder');

function table() {
  return tableConfig().builderPages;
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

function normalizeTemplateKind(value) {
  return normalizeStarCasterTemplateKind(value);
}

function rowToPage(row) {
  if (!row) return null;
  const document = readLayoutSectionsFromRow(row);
  return {
    id: String(row.id ?? ''),
    name: safeText(row.name, 255),
    templateKind: normalizeTemplateKind(row.template_kind || row.templateKind),
    templateId: safeText(row.template_id, 120),
    slug: safeText(row.slug, 160),
    isPublished: row.is_published == null ? true : row.is_published === true,
    isPrivate: row.is_private === true,
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
    themeId: safeText(row.theme_id, 120),
    pageBackground: document.pageBackground,
    theme: document.theme,
    layoutSections: document.layoutSections,
    contentOverrides: normalizeContentOverrides(row.content_overrides),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function inputToRow(input) {
  const row = {
    template_kind: normalizeTemplateKind(input?.templateKind || input?.template_kind),
    template_id: safeText(input?.templateId, 120),
    primary_color: safeText(input?.primaryColor, 20),
    background_color: safeText(input?.backgroundColor, 20),
    accent_color: safeText(input?.accentColor, 20),
    form_id: safeText(input?.formId, 120),
    lead_magnet_id: safeText(input?.leadMagnetId, 120),
    headline_id: safeText(input?.headlineId, 120),
    pitch_id: safeText(input?.pitchId, 120),
    cta_id: safeText(input?.ctaId, 120),
    website_banner_image_id: safeText(input?.websiteBannerImageId, 120),
    background_image_id: safeText(input?.backgroundImageId, 120),
    feature_image_id: safeText(input?.featureImageId, 120),
    highlight_image_id: safeText(input?.highlightImageId, 120),
    feature_headline_id: safeText(input?.featureHeadlineId, 120),
    feature_subheading_id: safeText(input?.featureSubheadingId, 120),
    feature_title: safeText(input?.featureTitle, 500),
    feature_copy: safeText(input?.featureCopy, 5000),
    highlight_headline_id: safeText(input?.highlightHeadlineId, 120),
    highlight_pitch_id: safeText(input?.highlightPitchId, 120),
    highlight_title: safeText(input?.highlightTitle, 500),
    highlight_copy: safeText(input?.highlightCopy, 5000),
    body_headline_id: safeText(input?.bodyHeadlineId, 120),
    body_subheading_id: safeText(input?.bodySubheadingId, 120),
    body_pitch_id: safeText(input?.bodyPitchId, 120),
    logo_wide_id: safeText(input?.logoWideId, 120),
    logo_square_id: safeText(input?.logoSquareId, 120),
    theme_id: safeText(input?.themeId, 120) || null,
    layout_sections: writeLayoutSectionsToRow({
      pageBackground: input?.pageBackground || input?.page_background,
      theme: input?.theme,
      layoutSections: input?.layoutSections || input?.layout_sections,
    }),
    content_overrides: normalizeContentOverrides(input?.contentOverrides),
  };
  if (input?.name !== undefined) row.name = safeText(input.name, 255);
  // Publish fields are optional columns (docs/builder_landing_page_publish_migration.sql).
  if (input?.slug !== undefined) row.slug = safeText(input.slug, 160);
  if (input?.isPublished !== undefined || input?.is_published !== undefined) {
    row.is_published = (input?.isPublished ?? input?.is_published) === true;
  }
  // Privacy column is optional (docs/SQL/builder_is_private_migration.sql).
  if (input?.isPrivate !== undefined || input?.is_private !== undefined) {
    row.is_private = (input?.isPrivate ?? input?.is_private) === true;
  }
  return row;
}

function shouldRetryWithoutPublishColumns(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  return message.includes('slug') || message.includes('is_published');
}

function stripPublishColumns(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.slug;
  delete next.is_published;
  return next;
}

function shouldRetryWithoutPrivateColumn(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  return message.includes('is_private');
}

function stripPrivateColumn(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.is_private;
  return next;
}

function shouldRetryWithoutModularColumns(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  return message.includes('layout_sections') || message.includes('template_kind');
}

function stripModularColumns(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.template_kind;
  delete next.layout_sections;
  return next;
}

function shouldRetryWithoutThemeIdColumn(result) {
  const message = safeText(result?.error || result?.message || '', 1000).toLowerCase();
  return message.includes('theme_id');
}

function stripThemeIdColumn(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.theme_id;
  return next;
}

function requiresModularColumns(input) {
  const kind = normalizeTemplateKind(input?.templateKind || input?.template_kind);
  const hasSections = input?.layoutSections !== undefined
    || input?.layout_sections !== undefined
    || input?.pageBackground !== undefined;
  return kind === 'modular' || hasSections;
}

async function listPages(limit = 1000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const query = await scopedListQuery(
    table(),
    `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
    scope
  );
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToPage) : [],
  };
}

async function getPage(id, scope = null) {
  const pageId = Number(id || 0) || 0;
  if (!pageId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `select=*&id=eq.${pageId}&limit=1`, scope);

  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Page not found' };
  return {
    ok: true,
    status: 200,
    data: rowToPage(row),
  };
}

async function createPage(input, scope = null) {
  const row = await scopedInsertRow(table(), inputToRow(input), scope);
  let res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok && shouldRetryWithoutPublishColumns(res)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripPublishColumns(row)],
    });
  }
  if (!res.ok && shouldRetryWithoutModularColumns(res)) {
    if (requiresModularColumns(input)) {
      return {
        ok: false,
        status: 500,
        error: 'Modular pages require the template_kind and layout_sections columns. Run docs/builder_landing_page_modular_migration.sql in Supabase.',
      };
    }
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripModularColumns(stripPublishColumns(row))],
    });
  }
  if (!res.ok && shouldRetryWithoutThemeIdColumn(res)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripThemeIdColumn(row)],
    });
  }
  if (!res.ok && shouldRetryWithoutPrivateColumn(res)) {
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [stripPrivateColumn(row)],
    });
  }
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return {
    ok: true,
    status: 201,
    data: rowToPage(created),
  };
}

async function updatePage(id, input, scope = null) {
  const pageId = Number(id || 0) || 0;
  if (!pageId) return { ok: false, status: 400, error: 'id is required' };

  const row = await scopedPatchRow(table(), inputToRow(input), scope);
  const query = await scopedIdQuery(table(), `id=eq.${pageId}&select=*`, scope);
  let res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok && shouldRetryWithoutPublishColumns(res)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripPublishColumns(row),
    });
  }
  if (!res.ok && shouldRetryWithoutModularColumns(res)) {
    if (requiresModularColumns(input)) {
      return {
        ok: false,
        status: 500,
        error: 'Modular pages require the template_kind and layout_sections columns. Run docs/builder_landing_page_modular_migration.sql in Supabase.',
      };
    }
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripModularColumns(stripPublishColumns(row)),
    });
  }
  if (!res.ok && shouldRetryWithoutThemeIdColumn(res)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripThemeIdColumn(row),
    });
  }
  if (!res.ok && shouldRetryWithoutPrivateColumn(res)) {
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: stripPrivateColumn(row),
    });
  }
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Page not found' };
  return {
    ok: true,
    status: 200,
    data: rowToPage(updated),
  };
}

async function deletePage(id, scope = null) {
  const pageId = Number(id || 0) || 0;
  if (!pageId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${pageId}&select=*`, scope);

  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Page not found' };
  return {
    ok: true,
    status: 200,
    data: rowToPage(removed),
  };
}

/**
 * After a saved section is updated, push the new content to every page that
 * has a canonical instance of that saved section.  Fire-and-forget: call this
 * without await so the PATCH response isn't blocked.
 */
async function propagateCanonicalSection(savedSectionId, updatedSection, scope) {
  if (!savedSectionId || !updatedSection) return;
  const pagesResult = await listPages(5000, scope);
  if (!pagesResult.ok) return;

  for (const page of pagesResult.data) {
    const hasCanonical = page.layoutSections.some(
      (s) => s.canonical === true && s.savedSectionId === savedSectionId
    );
    if (!hasCanonical) continue;

    const updatedSections = page.layoutSections.map((s) => {
      if (s.canonical !== true || s.savedSectionId !== savedSectionId) return s;
      // Replace content with master, keep only the instance's own id and markers.
      return { ...updatedSection, id: s.id, savedSectionId, canonical: true };
    });

    await updatePage(page.id, { ...page, layoutSections: updatedSections }, scope);
  }
}

module.exports = {
  listPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
  rowToPage,
  propagateCanonicalSection,
};
