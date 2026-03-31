'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

function table() {
  return tableConfig().developPageTemplates;
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
  const normalized = safeText(value, 40).toLowerCase();
  return normalized === 'modular' ? 'modular' : 'fixed';
}

function normalizeLayoutSections(value) {
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      return normalizeLayoutSections(JSON.parse(value));
    } catch (_) {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((section, index) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
      const id = safeText(section.id, 120) || `section_${index + 1}`;
      const layout = safeText(section.layout, 80) || 'single';
      const title = safeText(section.title, 255);
      const modules = Array.isArray(section.modules)
        ? section.modules
          .map((module, moduleIndex) => {
            if (!module || typeof module !== 'object' || Array.isArray(module)) return null;
            return {
              id: safeText(module.id, 120) || `module_${index + 1}_${moduleIndex + 1}`,
              type: safeText(module.type, 80) || 'text',
              column: safeText(module.column, 40) || 'main',
              contentId: safeText(module.contentId, 120),
              assetId: safeText(module.assetId, 120),
              text: safeText(module.text, 10000),
              settings: module.settings && typeof module.settings === 'object' && !Array.isArray(module.settings)
                ? module.settings
                : {},
            };
          })
          .filter(Boolean)
        : [];
      return { id, layout, title, modules };
    })
    .filter(Boolean);
}

function rowToPageTemplate(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    name: safeText(row.name, 255),
    templateKind: normalizeTemplateKind(row.template_kind || row.templateKind),
    templateId: safeText(row.template_id, 120),
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
    layoutSections: normalizeLayoutSections(row.layout_sections),
    contentOverrides: normalizeContentOverrides(row.content_overrides),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function inputToRow(input) {
  return {
    name: safeText(input?.name, 255),
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
    layout_sections: normalizeLayoutSections(input?.layoutSections || input?.layout_sections),
    content_overrides: normalizeContentOverrides(input?.contentOverrides),
  };
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

async function listPageTemplates(limit = 1000, scope = null) {
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

async function updatePageTemplate(id, input, scope = null) {
  const templateId = Number(id || 0) || 0;
  if (!templateId) return { ok: false, status: 400, error: 'id is required' };
  const row = await scopedPatchRow(table(), inputToRow(input), scope);
  const query = await scopedIdQuery(table(), `id=eq.${templateId}&select=*`, scope);
  let res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok && shouldRetryWithoutModularColumns(res)) {
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
  createPageTemplate,
  updatePageTemplate,
  deletePageTemplate,
  rowToPageTemplate,
};
