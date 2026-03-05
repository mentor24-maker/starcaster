'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingPosts',
  field: 'post',
  label: 'Post',
  maxLength: 10000,
});

module.exports = {
  listMessagingPosts: store.list,
  createMessagingPost: store.create,
  updateMessagingPost: store.update,
  deleteMessagingPost: store.remove,
  rowToPost: store.rowToItem,
};
