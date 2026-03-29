'use strict';

const { createMessagingLongformStore } = require('./messagingLongformStore');

const store = createMessagingLongformStore({
  tableKey: 'messagingWhitePapers',
  label: 'White paper',
  includePdf: true,
});

module.exports = {
  listMessagingWhitePapers: store.list,
  createMessagingWhitePaper: store.create,
  updateMessagingWhitePaper: store.update,
  deleteMessagingWhitePaper: store.remove,
  rowToWhitePaper: store.rowToItem,
};
