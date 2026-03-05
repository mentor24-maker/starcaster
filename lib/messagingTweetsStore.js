'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingTweets',
  field: 'content',
  label: 'Tweet',
  maxLength: 10000,
});

module.exports = {
  listMessagingTweets: store.list,
  createMessagingTweet: store.create,
  updateMessagingTweet: store.update,
  deleteMessagingTweet: store.remove,
  rowToTweet: store.rowToItem,
};
