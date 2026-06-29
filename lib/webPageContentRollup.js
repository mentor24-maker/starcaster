'use strict';

const { buildWebPageContentItemPayload } = require('./builderPageContentExtract');
const { listPages } = require('./builderPagesStore');

function pageToMessagingSource(page) {
  const extracted = buildWebPageContentItemPayload(page);
  if (!extracted.content) return null;
  const pageId = Number(page?.id || 0) || 0;
  if (!pageId) return null;
  return {
    id: pageId,
    title: extracted.title,
    content: extracted.content,
    url: extracted.url,
    topic: '',
    category: String(page?.name || '').trim(),
    sourceSlug: extracted.sourceSlug,
    pageName: String(page?.name || '').trim(),
  };
}

async function listWebPagesAsMessagingSources(limit = 5000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const pagesRes = await listPages(safeLimit, scope);
  if (!pagesRes.ok) return pagesRes;

  const pages = (Array.isArray(pagesRes.data) ? pagesRes.data : [])
    .map(pageToMessagingSource)
    .filter(Boolean);

  return { ok: true, status: 200, data: pages };
}

async function rollupWebPageContent(scope = null, options = {}) {
  const listRes = await listWebPagesAsMessagingSources(options?.limit, scope);
  if (!listRes.ok) return listRes;

  const pages = Array.isArray(listRes.data) ? listRes.data : [];
  const combinedText = pages
    .map((page) => [`# ${page.title}`, page.url ? `URL: ${page.url}` : '', page.content].filter(Boolean).join('\n\n'))
    .join('\n\n---\n\n');

  return {
    ok: true,
    status: 200,
    data: {
      pageCount: pages.length,
      pages: pages.map((page) => ({
        id: page.id,
        title: page.title,
        slug: page.sourceSlug,
        url: page.url,
        contentLength: page.content.length,
      })),
      combinedText,
    },
  };
}

module.exports = {
  pageToMessagingSource,
  listWebPagesAsMessagingSources,
  rollupWebPageContent,
};
