'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().developLandingPages;
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

function rowToLandingPage(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    name: safeText(row.name, 255),
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
    contentOverrides: normalizeContentOverrides(row.content_overrides),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function inputToRow(input) {
  return {
    name: safeText(input?.name, 255),
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
    content_overrides: normalizeContentOverrides(input?.contentOverrides),
  };
}

async function listLandingPages(limit = 1000) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToLandingPage) : [],
  };
}

async function getLandingPage(id) {
  const landingPageId = Number(id || 0) || 0;
  if (!landingPageId) return { ok: false, status: 400, error: 'id is required' };

  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&id=eq.${landingPageId}&limit=1`,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Landing page not found' };
  return {
    ok: true,
    status: 200,
    data: rowToLandingPage(row),
  };
}

async function createLandingPage(input) {
  const row = inputToRow(input);
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return {
    ok: true,
    status: 201,
    data: rowToLandingPage(created),
  };
}

async function updateLandingPage(id, input) {
  const landingPageId = Number(id || 0) || 0;
  if (!landingPageId) return { ok: false, status: 400, error: 'id is required' };

  const row = inputToRow(input);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${landingPageId}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Landing page not found' };
  return {
    ok: true,
    status: 200,
    data: rowToLandingPage(updated),
  };
}

async function deleteLandingPage(id) {
  const landingPageId = Number(id || 0) || 0;
  if (!landingPageId) return { ok: false, status: 400, error: 'id is required' };

  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query: `id=eq.${landingPageId}&select=*`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Landing page not found' };
  return {
    ok: true,
    status: 200,
    data: rowToLandingPage(removed),
  };
}

module.exports = {
  listLandingPages,
  getLandingPage,
  createLandingPage,
  updateLandingPage,
  deleteLandingPage,
  rowToLandingPage,
};
