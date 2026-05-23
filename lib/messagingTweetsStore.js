'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingTweets',
  field: 'content',
  label: 'Tweet',
  maxLength: 10000,
  extraFields: [
    { key: 'url', maxLength: 1200 },
    { key: 'hashtags', maxLength: 1000 },
    { key: 'image_asset_id', type: 'number' },
  ],
});

module.exports = {
  listMessagingTweets: store.list,
  createMessagingTweet: store.create,
  updateMessagingTweet: store.update,
  deleteMessagingTweet: store.remove,
  rowToTweet: store.rowToItem,
};
