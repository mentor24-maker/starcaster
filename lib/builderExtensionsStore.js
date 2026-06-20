'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

function table() {
  return tableConfig().builderExtensions;
}

function safeText(value, max = 10000) {
  return String(value || '').trim().slice(0, max);
}

function rowToExtension(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    slug: safeText(row.slug, 160),
    name: safeText(row.name, 255),
    extensionType: safeText(row.extension_type, 120),
    parentId: Number(row.parent_id || 0) || null,
    status: safeText(row.status, 80) || 'active',
    tags: safeText(row.tags, 500),
    summary: safeText(row.summary, 1000),
    definition: safeText(row.definition, 10000),
    launchPageId: safeText(row.launch_page_id, 160),
    isFeatured: row.is_featured === true,
    usageCount: Number(row.usage_count || 0) || 0,
    lastUsedAt: row.last_used_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function extensionInputToRow(input) {
  return {
    slug: safeText(input?.slug, 160),
    name: safeText(input?.name, 255),
    extension_type: safeText(input?.extensionType || input?.extension_type, 120),
    parent_id: Number(input?.parentId || input?.parent_id || 0) || null,
    status: safeText(input?.status, 80) || 'active',
    tags: safeText(input?.tags, 500),
    summary: safeText(input?.summary, 1000),
    definition: safeText(input?.definition, 10000),
    launch_page_id: safeText(input?.launchPageId || input?.launch_page_id, 160),
    is_featured: input?.isFeatured === true || input?.is_featured === true,
    usage_count: Number(input?.usageCount || input?.usage_count || 0) || 0,
    last_used_at: input?.lastUsedAt || input?.last_used_at || null,
  };
}

async function ensureDefaultExtensions(rows, scope = null) {
  const items = Array.isArray(rows) ? rows.map(rowToExtension).filter(Boolean) : [];
  const defaults = [
    {
      slug: 'icon-builder',
      name: 'Icon Builder',
      extensionType: 'generator',
      status: 'active',
      tags: 'icons, graphics, branding',
      summary: 'Generate compact object icons for menu, list, and badge use inside the platform.',
      definition: 'Creates small reusable icons for messages, assets, campaigns, and related objects. This is the first live extension in the repository.',
      launchPageId: 'builderExtensionIconBuilderPage',
      isFeatured: true,
      usageCount: 1,
    },
    {
      slug: 'screenshot',
      name: 'Screenshot',
      extensionType: 'utility',
      status: 'active',
      tags: 'screenshots, capture, website',
      summary: 'Capture a screenshot, upload it to Drive, and store it as a 640x360 Image asset in category Screenshot.',
      definition: 'Generates a standardized website screenshot from a pasted URL, uploads the image into Google Drive, and saves it into the asset library as type Image with category Screenshot.',
      launchPageId: 'builderExtensionScreenshotPage',
      isFeatured: true,
      usageCount: 1,
    },
    {
      slug: 'thumbnail',
      name: 'Thumbnail',
      extensionType: 'utility',
      status: 'active',
      tags: 'thumbnail, pdf, assets',
      summary: 'Generate a first-page PDF thumbnail image and store it in Assets as category Thumbnail.',
      definition: 'Captures a visual thumbnail from the first page of a PDF file location, uploads it into Google Drive, and stores it as an Image asset under category Thumbnail with source linkage tags.',
      launchPageId: 'builderExtensionThumbnailPage',
      isFeatured: true,
      usageCount: 1,
    },
  ];

  for (const definition of defaults) {
    if (items.some((item) => item.slug === definition.slug)) continue;
    const created = await createExtension(definition, scope);
    if (created.ok && created.data) {
      items.unshift(created.data);
    }
  }
  return items;
}

async function listExtensions(limit = 500, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
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
  const data = await ensureDefaultExtensions(Array.isArray(res.data) ? res.data : [], scope);
  return {
    ok: true,
    status: 200,
    data,
  };
}

async function createExtension(input, scope = null) {
  const row = await scopedInsertRow(table(), extensionInputToRow(input), scope);
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
    data: rowToExtension(created),
  };
}

async function updateExtension(id, input, scope = null) {
  const extensionId = Number(id || 0) || 0;
  if (!extensionId) return { ok: false, status: 400, error: 'id is required' };
  const row = await scopedPatchRow(table(), extensionInputToRow(input), scope);
  const query = await scopedIdQuery(table(), `id=eq.${extensionId}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Extension not found' };
  return {
    ok: true,
    status: 200,
    data: rowToExtension(updated),
  };
}

async function deleteExtension(id, scope = null) {
  const extensionId = Number(id || 0) || 0;
  if (!extensionId) return { ok: false, status: 400, error: 'id is required' };
  const childQuery = await scopedListQuery(table(), `parent_id=eq.${extensionId}&select=*`, scope);
  const childRes = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: childQuery,
    headers: { Prefer: 'return=minimal' },
    body: await scopedPatchRow(table(), { parent_id: null }, scope),
  });
  if (!childRes.ok && childRes.status !== 404) return childRes;

  const query = await scopedIdQuery(table(), `id=eq.${extensionId}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Extension not found' };
  return {
    ok: true,
    status: 200,
    data: rowToExtension(removed),
  };
}

async function trackExtensionUse(id, scope = null) {
  const extensionId = Number(id || 0) || 0;
  if (!extensionId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `select=*&id=eq.${extensionId}&limit=1`, scope);
  const current = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!current.ok) return current;
  const row = Array.isArray(current.data) ? current.data[0] : current.data;
  if (!row) return { ok: false, status: 404, error: 'Extension not found' };
  const usageCount = (Number(row.usage_count || 0) || 0) + 1;
  return updateExtension(extensionId, {
    ...rowToExtension(row),
    usageCount,
    lastUsedAt: new Date().toISOString(),
  }, scope);
}

module.exports = {
  listExtensions,
  createExtension,
  updateExtension,
  deleteExtension,
  trackExtensionUse,
  rowToExtension,
};
