'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingSubheadings',
  field: 'subheading',
  label: 'Sub-heading',
  maxLength: 2000,
});

module.exports = {
  listMessagingSubheadings: store.list,
  createMessagingSubheading: store.create,
  updateMessagingSubheading: store.update,
  deleteMessagingSubheading: store.remove,
  rowToSubheading: store.rowToItem,
};
