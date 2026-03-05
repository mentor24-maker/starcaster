'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingDescriptions',
  field: 'description',
  label: 'Description',
  maxLength: 10000,
});

module.exports = {
  listMessagingDescriptions: store.list,
  createMessagingDescription: store.create,
  updateMessagingDescription: store.update,
  deleteMessagingDescription: store.remove,
  rowToDescription: store.rowToItem,
};
