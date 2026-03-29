'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingTaglines',
  field: 'tagline',
  label: 'Tagline',
  maxLength: 2000,
});

module.exports = {
  listMessagingTaglines: store.list,
  createMessagingTagline: store.create,
  updateMessagingTagline: store.update,
  deleteMessagingTagline: store.remove,
  rowToTagline: store.rowToItem,
};
