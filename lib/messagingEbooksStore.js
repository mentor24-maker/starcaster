'use strict';

const { createMessagingLongformStore } = require('./messagingLongformStore');

const store = createMessagingLongformStore({
  tableKey: 'messagingEbooks',
  label: 'eBook',
  includePdf: true,
});

module.exports = {
  listMessagingEbooks: store.list,
  createMessagingEbook: store.create,
  updateMessagingEbook: store.update,
  deleteMessagingEbook: store.remove,
  rowToEbook: store.rowToItem,
};
