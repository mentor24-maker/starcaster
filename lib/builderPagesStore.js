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
    isPrivate: row.is_private == null ? null : row.is_private === true,
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

function hasInputField(input, ...keys) {
  if (!input || typeof input !== 'object') return false;
  return keys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

function inputToRow(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object') return {};
  const row = {};

  const set = (condition, key, value) => {
    if (!partial || condition) row[key] = value;
  };

  const hasTemplateKind = hasInputField(input, 'templateKind', 'template_kind');
  const hasTemplateId = hasInputField(input, 'templateId', 'template_id');
  const hasThemeId = hasInputField(input, 'themeId', 'theme_id');
  const hasLayout = hasInputField(
    input,
    'layoutSections',
    'layout_sections',
    'pageBackground',
    'page_background',
    'theme',
  );
  const hasContentOverrides = hasInputField(input, 'contentOverrides', 'content_overrides');

  set(hasTemplateKind, 'template_kind', normalizeTemplateKind(input?.templateKind || input?.template_kind));
  set(hasTemplateId, 'template_id', safeText(input?.templateId, 120));
  set(hasInputField(input, 'primaryColor', 'primary_color'), 'primary_color', safeText(input?.primaryColor, 20));
  set(hasInputField(input, 'backgroundColor', 'background_color'), 'background_color', safeText(input?.backgroundColor, 20));
  set(hasInputField(input, 'accentColor', 'accent_color'), 'accent_color', safeText(input?.accentColor, 20));
  set(hasInputField(input, 'formId', 'form_id'), 'form_id', safeText(input?.formId, 120));
  set(hasInputField(input, 'leadMagnetId', 'lead_magnet_id'), 'lead_magnet_id', safeText(input?.leadMagnetId, 120));
  set(hasInputField(input, 'headlineId', 'headline_id'), 'headline_id', safeText(input?.headlineId, 120));
  set(hasInputField(input, 'pitchId', 'pitch_id'), 'pitch_id', safeText(input?.pitchId, 120));
  set(hasInputField(input, 'ctaId', 'cta_id'), 'cta_id', safeText(input?.ctaId, 120));
  set(
    hasInputField(input, 'websiteBannerImageId', 'website_banner_image_id'),
    'website_banner_image_id',
    safeText(input?.websiteBannerImageId, 120),
  );
  set(
    hasInputField(input, 'backgroundImageId', 'background_image_id'),
    'background_image_id',
    safeText(input?.backgroundImageId, 120),
  );
  set(
    hasInputField(input, 'featureImageId', 'feature_image_id'),
    'feature_image_id',
    safeText(input?.featureImageId, 120),
  );
  set(
    hasInputField(input, 'highlightImageId', 'highlight_image_id'),
    'highlight_image_id',
    safeText(input?.highlightImageId, 120),
  );
  set(
    hasInputField(input, 'featureHeadlineId', 'feature_headline_id'),
    'feature_headline_id',
    safeText(input?.featureHeadlineId, 120),
  );
  set(
    hasInputField(input, 'featureSubheadingId', 'feature_subheading_id'),
    'feature_subheading_id',
    safeText(input?.featureSubheadingId, 120),
  );
  set(hasInputField(input, 'featureTitle', 'feature_title'), 'feature_title', safeText(input?.featureTitle, 500));
  set(hasInputField(input, 'featureCopy', 'feature_copy'), 'feature_copy', safeText(input?.featureCopy, 5000));
  set(
    hasInputField(input, 'highlightHeadlineId', 'highlight_headline_id'),
    'highlight_headline_id',
    safeText(input?.highlightHeadlineId, 120),
  );
  set(
    hasInputField(input, 'highlightPitchId', 'highlight_pitch_id'),
    'highlight_pitch_id',
    safeText(input?.highlightPitchId, 120),
  );
  set(hasInputField(input, 'highlightTitle', 'highlight_title'), 'highlight_title', safeText(input?.highlightTitle, 500));
  set(hasInputField(input, 'highlightCopy', 'highlight_copy'), 'highlight_copy', safeText(input?.highlightCopy, 5000));
  set(
    hasInputField(input, 'bodyHeadlineId', 'body_headline_id'),
    'body_headline_id',
    safeText(input?.bodyHeadlineId, 120),
  );
  set(
    hasInputField(input, 'bodySubheadingId', 'body_subheading_id'),
    'body_subheading_id',
    safeText(input?.bodySubheadingId, 120),
  );
  set(hasInputField(input, 'bodyPitchId', 'body_pitch_id'), 'body_pitch_id', safeText(input?.bodyPitchId, 120));
  set(hasInputField(input, 'logoWideId', 'logo_wide_id'), 'logo_wide_id', safeText(input?.logoWideId, 120));
  set(hasInputField(input, 'logoSquareId', 'logo_square_id'), 'logo_square_id', safeText(input?.logoSquareId, 120));
  set(hasThemeId, 'theme_id', safeText(input?.themeId, 120) || null);

  if (!partial || hasLayout) {
    row.layout_sections = writeLayoutSectionsToRow({
      pageBackground: input?.pageBackground || input?.page_background,
      theme: input?.theme,
      layoutSections: input?.layoutSections || input?.layout_sections,
    });
  }

  if (!partial || hasContentOverrides) {
    row.content_overrides = normalizeContentOverrides(input?.contentOverrides);
  }

  if (input?.name !== undefined) row.name = safeText(input.name, 255);
  if (input?.slug !== undefined) row.slug = safeText(input.slug, 160);
  if (input?.isPublished !== undefined || input?.is_published !== undefined) {
    row.is_published = (input?.isPublished ?? input?.is_published) === true;
  }
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
  const page = rowToPage(created);
  await syncContentItemForPage(page, scope);
  return {
    ok: true,
    status: 201,
    data: page,
  };
}

async function updatePage(id, input, scope = null) {
  const pageId = Number(id || 0) || 0;
  if (!pageId) return { ok: false, status: 400, error: 'id is required' };

  const row = await scopedPatchRow(table(), inputToRow(input, { partial: true }), scope);
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
  const page = rowToPage(updated);
  await syncContentItemForPage(page, scope);
  return {
    ok: true,
    status: 200,
    data: page,
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
  await removeContentItemForPage(String(pageId), scope);
  return {
    ok: true,
    status: 200,
    data: rowToPage(removed),
  };
}

async function syncContentItemForPage(page, scope) {
  try {
    const { syncWebPageContentItem } = require('./webPageContentSync');
    await syncWebPageContentItem(page, scope);
  } catch (_) {
    // content_items sync is best-effort
  }
}

async function removeContentItemForPage(pageId, scope) {
  try {
    const { BUILDER_PAGE_SOURCE, deleteContentItemBySource } = require('./contentItemsStore');
    await deleteContentItemBySource(BUILDER_PAGE_SOURCE, String(pageId || ''), scope);
  } catch (_) {
    // content_items sync is best-effort
  }
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

async function listPublishedPagesForProject(projectIdInput) {
  const projectId = String(projectIdInput || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&project_id=eq.${encodeURIComponent(projectId)}&or=(is_published.eq.true,is_published.is.null)&is_private=eq.false&order=updated_at.desc,created_at.desc&limit=200`,
  });
  if (!res.ok) return res;
  const rows = Array.isArray(res.data) ? res.data.map(rowToPage) : [];
  rows.sort((a, b) => {
    const rank = (slug) => {
      const s = String(slug ?? '').trim();
      if (s === '') return 0;
      if (s === 'home') return 1;
      return 2;
    };
    const diff = rank(a.slug) - rank(b.slug);
    if (diff !== 0) return diff;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
  const { filterPublicSitePages } = require('./publicSitePageFilter');
  return {
    ok: true,
    status: 200,
    data: filterPublicSitePages(rows),
  };
}

async function listRestrictedAdminSitePagesForProject(projectIdInput) {
  const projectId = String(projectIdInput || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  // Include private pages — admin slugs (dashboard, etc.) are often marked Private
  // so they stay out of GET /api/public/pages while still reachable after login.
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&project_id=eq.${encodeURIComponent(projectId)}&or=(is_published.eq.true,is_published.is.null)&order=updated_at.desc,created_at.desc&limit=200`,
  });
  if (!res.ok) return res;
  const rows = Array.isArray(res.data) ? res.data.map(rowToPage) : [];
  rows.sort((a, b) => {
    const rank = (slug) => {
      const s = String(slug ?? '').trim();
      if (s === '') return 0;
      if (s === 'home') return 1;
      return 2;
    };
    const diff = rank(a.slug) - rank(b.slug);
    if (diff !== 0) return diff;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
  const { filterRestrictedAdminSitePages } = require('./publicSitePageFilter');
  return {
    ok: true,
    status: 200,
    data: filterRestrictedAdminSitePages(rows),
  };
}

async function bulkSetPublished(pageIds, isPublished, scope = null) {
  const ids = (Array.isArray(pageIds) ? pageIds : [])
    .map((id) => Number(id || 0) || 0)
    .filter((id) => id > 0);
  if (!ids.length) return { ok: false, status: 400, error: 'pageIds is required' };

  const published = isPublished === true;
  const results = await Promise.all(
    ids.map(async (pageId) => {
      const res = await updatePage(pageId, { isPublished: published }, scope);
      return {
        id: String(pageId),
        ok: res.ok,
        error: res.ok ? '' : safeText(res.error || 'Update failed', 500),
      };
    })
  );
  const failed = results.filter((row) => !row.ok);
  if (failed.length === results.length) {
    return { ok: false, status: 500, error: failed[0]?.error || 'Could not update pages' };
  }
  return {
    ok: true,
    status: 200,
    data: results,
  };
}

module.exports = {
  listPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
  rowToPage,
  propagateCanonicalSection,
  listPublishedPagesForProject,
  listRestrictedAdminSitePagesForProject,
  bulkSetPublished,
};
