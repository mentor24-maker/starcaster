'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingPosts',
  field: 'post',
  label: 'Post',
  maxLength: 10000,
  multiline: true,
  extraFields: [
    { key: 'url', maxLength: 1200 },
    { key: 'hashtags', maxLength: 1000 },
    { key: 'image_asset_id', type: 'number' },
    { key: 'tagged_contact_id', maxLength: 120 },
  ],
});

module.exports = {
  listMessagingPosts: store.list,
  createMessagingPost: store.create,
  updateMessagingPost: store.update,
  deleteMessagingPost: store.remove,
  rowToPost: store.rowToItem,
};
