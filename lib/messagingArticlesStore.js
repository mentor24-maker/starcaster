'use strict';

const { createMessagingLongformStore } = require('./messagingLongformStore');

const store = createMessagingLongformStore({
  tableKey: 'messagingArticles',
  label: 'Article',
});

module.exports = {
  listMessagingArticles: store.list,
  createMessagingArticle: store.create,
  updateMessagingArticle: store.update,
  deleteMessagingArticle: store.remove,
  rowToArticle: store.rowToItem,
};
