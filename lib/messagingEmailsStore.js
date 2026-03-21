'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingEmails',
  field: 'email',
  label: 'Email',
  maxLength: 40000,
});

module.exports = {
  listMessagingEmails: store.list,
  createMessagingEmail: store.create,
  updateMessagingEmail: store.update,
  deleteMessagingEmail: store.remove,
  rowToEmail: store.rowToItem,
};
