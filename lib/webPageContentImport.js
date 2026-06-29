'use strict';

const { listWebPagesAsMessagingSources } = require('./webPageContentRollup');

async function listWebPagesForMessagingImport(limit = 5000, scope = null) {
  return listWebPagesAsMessagingSources(limit, scope);
}

module.exports = {
  listWebPagesForMessagingImport,
};
