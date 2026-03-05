'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingHashtags',
  field: 'hashtag',
  label: 'Hashtag',
  maxLength: 240,
  normalize: function normalizeHashtag(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.startsWith('#') ? text : `#${text}`;
  },
});

module.exports = {
  listMessagingHashtags: store.list,
  createMessagingHashtag: store.create,
  updateMessagingHashtag: store.update,
  deleteMessagingHashtag: store.remove,
  createMessagingHashtags: store.create,
  rowToHashtag: store.rowToItem,
};
