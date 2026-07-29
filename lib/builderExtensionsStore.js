'use strict';

const { sbQuery, tableConfig } = require('./supabase');
// Only createExtension scopes anything: a custom extension records which
// project authored it. Everything else addresses shared rows by id.
const { scopedInsertRow } = require('./projectScope');

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

/**
 * Seeds any built-in extension that is not in the table yet. Defaults belong to
 * the platform rather than to whichever project happened to trigger the seed,
 * so they are written with no project scope.
 */
async function ensureDefaultExtensions(rows) {
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
    {
      slug: 'populate-module-titles',
      name: 'Populate Module Titles',
      extensionType: 'utility',
      status: 'active',
      tags: 'titles, sections, modules, cleanup',
      summary: 'Fill blank section and module titles across saved pages from their own content, using a configurable source priority.',
      definition: 'Walks every section and module on the pages you choose and fills the optional title fields from the content inside — largest heading, image alt text, button label, and more — in an order you control. Fills blanks only by default; never touches titles you set by hand.',
      launchPageId: 'builderExtensionPopulateTitlesPage',
      isFeatured: true,
      usageCount: 0,
    },
    {
      slug: 'seo-alt-text',
      name: 'SEO Alt Text',
      extensionType: 'utility',
      status: 'active',
      tags: 'seo, geo, alt text, images, accessibility',
      summary: 'Auto-write keyword-grounded alt text for every image on the pages you choose, using the section content, the page URL, and live web-search results.',
      definition: 'For each image missing alt text, gathers the words in its section plus the page name/slug, runs a web search (Brave, with Google as fallback) to see what actually ranks for those terms, then asks AI to write a short, natural, GEO-friendly alt description and saves it. Fills blanks only by default; runs one page at a time with a live progress bar. Preview before applying.',
      launchPageId: 'builderExtensionSeoAltTextPage',
      isFeatured: true,
      usageCount: 0,
    },
    {
      slug: 'nav-probe',
      name: 'Nav Probe',
      extensionType: 'experiment',
      status: 'active',
      tags: 'navigation, experimental, skunkworks',
      summary: 'Proximity-aware navigational aid: concentric hover rings that darken as the cursor approaches the center.',
      definition: 'Skunkworks experiment exploring depth-based cursor proximity as a navigation primitive. Ten concentric rings (20–110px) activate with decreasing opacity as the cursor moves outward from a solid center dot.',
      launchPageId: 'builderExtensionNavProbePage',
      isFeatured: false,
      usageCount: 0,
    },
  ];

  for (const definition of defaults) {
    if (items.some((item) => item.slug === definition.slug)) continue;
    const created = await createExtension(definition, null);
    if (created.ok && created.data) {
      items.unshift(created.data);
    }
  }
  return items;
}

/**
 * Extensions are shared by every project — one row per slug serves all of them.
 *
 * They were never really per-project: builder_extensions.slug carries a GLOBAL
 * unique constraint (docs/SQL/develop_extensions_setup.sql), while a later
 * migration bolted a project_id column on and the list started filtering by it.
 * The two do not fit together. Seeding a new default into a second project hit
 * the duplicate-key error, createExtension returned not-ok, and
 * ensureDefaultExtensions skipped it in silence — so whichever project happened
 * to open this list first got the new extension and nobody else ever did.
 *
 * Reading unscoped makes the behaviour match the constraint that was already
 * there. A private/public split is coming; when it lands, this query grows a
 * "public OR mine" clause rather than going back to a plain project filter.
 */
async function listExtensions(limit = 500, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
  });
  if (!res.ok) return res;
  const data = await ensureDefaultExtensions(Array.isArray(res.data) ? res.data : []);
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

// Shared rows, so every operation below addresses an extension by id alone.
// Scoping the write side while the read side is shared would let a project see
// an extension it cannot open: trackExtensionUse runs on launch, and a scoped
// lookup 404s on a row another project happens to own.
async function updateExtension(id, input, scope = null) {
  const extensionId = Number(id || 0) || 0;
  if (!extensionId) return { ok: false, status: 400, error: 'id is required' };
  const row = extensionInputToRow(input);
  const query = `id=eq.${extensionId}&select=*`;
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
  const childRes = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `parent_id=eq.${extensionId}&select=*`,
    headers: { Prefer: 'return=minimal' },
    body: { parent_id: null },
  });
  if (!childRes.ok && childRes.status !== 404) return childRes;

  const query = `id=eq.${extensionId}&select=*`;
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
  const current = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&id=eq.${extensionId}&limit=1`,
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
