'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingComments',
  field: 'comment',
  label: 'Comment',
  maxLength: 10000,
});

module.exports = {
  listMessagingComments: store.list,
  createMessagingComment: store.create,
  updateMessagingComment: store.update,
  deleteMessagingComment: store.remove,
  rowToComment: store.rowToItem,
};
