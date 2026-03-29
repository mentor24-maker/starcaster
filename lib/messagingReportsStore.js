'use strict';

const { createMessagingLongformStore } = require('./messagingLongformStore');

const store = createMessagingLongformStore({
  tableKey: 'messagingReports',
  label: 'Report',
  includePdf: true,
});

module.exports = {
  listMessagingReports: store.list,
  createMessagingReport: store.create,
  updateMessagingReport: store.update,
  deleteMessagingReport: store.remove,
  rowToReport: store.rowToItem,
};
