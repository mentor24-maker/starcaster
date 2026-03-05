'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingCtas',
  field: 'cta',
  label: 'Call to Action',
  maxLength: 2000,
});

module.exports = {
  listMessagingCtas: store.list,
  createMessagingCta: store.create,
  updateMessagingCta: store.update,
  deleteMessagingCta: store.remove,
  rowToCta: store.rowToItem,
};
