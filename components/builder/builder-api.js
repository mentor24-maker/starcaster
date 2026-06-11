/**
 * Builder API client — uses App.api() for project-scoped /api/develop/* calls.
 */

function getApi() {
  const api = window.App?.api;
  if (typeof api !== 'function') {
    throw new Error('App.api is not available');
  }
  return api;
}

function unwrapEnvelope(result, keys) {
  if (!result || typeof result !== 'object') return result;
  if (result.data !== undefined) return result.data;
  for (const key of keys) {
    if (result[key] !== undefined) return result[key];
  }
  return result;
}

export async function builderApi(path, options = {}) {
  return getApi()(path, options);
}

export async function normalizeLayoutDocument(input) {
  const result = await builderApi('/api/develop/layout/normalize', {
    method: 'POST',
    body: JSON.stringify({
      pageBackground: input?.pageBackground,
      layoutSections: input?.layoutSections ?? input?.sections,
    }),
  });
  const document = unwrapEnvelope(result, ['document']);
  return {
    pageBackground: document?.pageBackground || {
      mode: 'none',
      color: '#ffffff',
      color2: '#eaf4ff',
      imageUrl: '',
      styleKey: '',
    },
    layoutSections: Array.isArray(document?.sections)
      ? document.sections
      : (Array.isArray(document?.layoutSections) ? document.layoutSections : []),
  };
}

export async function listPageTemplates() {
  const result = await builderApi('/api/develop/page-templates');
  const rows = unwrapEnvelope(result, ['pageTemplates', 'data']);
  return Array.isArray(rows) ? rows : [];
}

export async function listLandingPages() {
  const result = await builderApi('/api/develop/landing-pages');
  const rows = unwrapEnvelope(result, ['landingPages', 'data', 'pages']);
  return Array.isArray(rows) ? rows : [];
}

export async function listCellModules() {
  const result = await builderApi('/api/develop/modules');
  const rows = unwrapEnvelope(result, ['modules', 'data']);
  return Array.isArray(rows) ? rows : [];
}

export async function listSavedSections() {
  const result = await builderApi('/api/develop/saved-sections');
  const rows = unwrapEnvelope(result, ['savedSections', 'data']);
  return Array.isArray(rows) ? rows : [];
}

export async function savePageTemplate(record) {
  const id = String(record?.id || '').trim();
  const templateKind = String(record?.templateKind || 'modular').trim().toLowerCase();
  const payload = {
    name: record.name,
    templateKind,
    templateId: record.templateId || record.emailSlug || record.slug,
    emailSlug: record.emailSlug || record.slug,
    emailFunction: record.emailFunction,
    summary: record.summary,
    subject: record.subject,
    pageBackground: record.pageBackground,
    layoutSections: record.layoutSections,
    contentOverrides: record.contentOverrides || {},
  };
  const path = id
    ? `/api/develop/page-templates/${encodeURIComponent(id)}`
    : '/api/develop/page-templates';
  const result = await builderApi(path, {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(payload),
  });
  return unwrapEnvelope(result, ['pageTemplate', 'data']);
}

export async function saveLandingPage(record) {
  const id = String(record?.id || '').trim();
  const payload = {
    name: record.name,
    templateKind: 'modular',
    templateId: record.templateId,
    pageBackground: record.pageBackground,
    layoutSections: record.layoutSections,
    contentOverrides: record.contentOverrides || {},
  };
  const path = id
    ? `/api/develop/landing-pages/${encodeURIComponent(id)}`
    : '/api/develop/landing-pages';
  const result = await builderApi(path, {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(payload),
  });
  return unwrapEnvelope(result, ['landingPage', 'page', 'data']);
}

export async function prepareEditorRecord(record) {
  const base = record && typeof record === 'object' ? { ...record } : {};
  const templateKind = String(base.templateKind || 'modular').trim().toLowerCase();
  const normalized = await normalizeLayoutDocument({
    pageBackground: base.pageBackground,
    layoutSections: base.layoutSections,
  });
  return {
    ...base,
    templateKind,
    emailSlug: base.emailSlug || base.slug || '',
    pageBackground: normalized.pageBackground,
    layoutSections: normalized.layoutSections,
  };
}

export async function listEmailTemplates() {
  const result = await builderApi('/api/develop/email-templates');
  const rows = unwrapEnvelope(result, ['emailTemplates', 'data']);
  return Array.isArray(rows) ? rows : [];
}

export async function saveEmailTemplate(record) {
  const id = String(record?.id || '').trim();
  const payload = {
    name: record.name,
    templateKind: 'email',
    slug: record.emailSlug || record.slug,
    emailFunction: record.emailFunction,
    summary: record.summary,
    subject: record.subject,
    pageBackground: record.pageBackground,
    layoutSections: record.layoutSections,
    blocks: record.blocks,
  };
  const path = id
    ? `/api/develop/email-templates/${encodeURIComponent(id)}`
    : '/api/develop/email-templates';
  const result = await builderApi(path, {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(payload),
  });
  return unwrapEnvelope(result, ['emailTemplate', 'pageTemplate', 'data']);
}
