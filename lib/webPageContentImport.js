'use strict';

const { listWebPageContentItems } = require('./contentItemsStore');
const { syncAllWebPageContentItems } = require('./webPageContentSync');
const { listWebPagesAsMessagingSources } = require('./webPageContentRollup');

async function listWebPagesForMessagingImport(limit = 5000, scope = null, options = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const shouldSync = options.sync !== false;

  if (shouldSync) {
    const syncRes = await syncAllWebPageContentItems(scope, { limit: safeLimit });
    if (!syncRes.ok) return syncRes;
  }

  const itemsRes = await listWebPageContentItems(safeLimit, scope);
  if (itemsRes.ok && Array.isArray(itemsRes.data) && itemsRes.data.length) {
    return itemsRes;
  }

  return listWebPagesAsMessagingSources(safeLimit, scope);
}

module.exports = {
  listWebPagesForMessagingImport,
};
