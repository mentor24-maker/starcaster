'use strict';

const { buildWebPageContentItemPayload } = require('./builderPageContentExtract');
const {
  WEB_PAGES_FORMAT,
  BUILDER_PAGE_SOURCE,
  upsertContentItem,
  deleteContentItemBySource,
} = require('./contentItemsStore');
const { listPages } = require('./builderPagesStore');

async function syncWebPageContentItem(page, scope = null) {
  const pageId = String(page?.id || '').trim();
  if (!pageId) {
    return { ok: false, status: 400, error: 'page id is required' };
  }

  const extracted = buildWebPageContentItemPayload(page);
  if (!extracted.content) {
    return deleteContentItemBySource(BUILDER_PAGE_SOURCE, pageId, scope);
  }

  return upsertContentItem({
    format: WEB_PAGES_FORMAT,
    title: extracted.title,
    content: extracted.content,
    url: extracted.url,
    sourceType: BUILDER_PAGE_SOURCE,
    sourceId: pageId,
    sourceSlug: extracted.sourceSlug,
    contentHash: extracted.contentHash,
  }, scope);
}

async function syncAllWebPageContentItems(scope = null, options = {}) {
  const limit = Math.max(1, Math.min(Number(options?.limit) || 5000, 5000));
  const pagesRes = await listPages(limit, scope);
  if (!pagesRes.ok) return pagesRes;

  const pages = Array.isArray(pagesRes.data) ? pagesRes.data : [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let removed = 0;
  const errors = [];

  for (const page of pages) {
    try {
      const result = await syncWebPageContentItem(page, scope);
      if (!result.ok) {
        errors.push({
          pageId: String(page?.id || ''),
          pageName: String(page?.name || ''),
          error: result.error || 'Sync failed',
        });
        continue;
      }
      if (result.deleted) {
        removed += 1;
      } else if (result.skipped) {
        skipped += 1;
      } else if (result.action === 'updated') {
        updated += 1;
      } else if (result.action === 'created' || result.status === 201) {
        created += 1;
      }
    } catch (err) {
      errors.push({
        pageId: String(page?.id || ''),
        pageName: String(page?.name || ''),
        error: err.message || 'Sync failed',
      });
    }
  }

  return {
    ok: errors.length === 0,
    status: errors.length ? 500 : 200,
    data: {
      total: pages.length,
      created,
      updated,
      skipped,
      removed,
      errors,
    },
    error: errors.length ? errors[0].error : '',
  };
}

module.exports = {
  syncWebPageContentItem,
  syncAllWebPageContentItems,
};
