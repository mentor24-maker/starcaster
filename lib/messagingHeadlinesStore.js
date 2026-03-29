'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingHeadlines',
  field: 'headline',
  label: 'Headline',
  maxLength: 2000,
});

module.exports = {
  listMessagingHeadlines: store.list,
  createMessagingHeadline: store.create,
  updateMessagingHeadline: store.update,
  deleteMessagingHeadline: store.remove,
  rowToHeadline: store.rowToItem,
};
