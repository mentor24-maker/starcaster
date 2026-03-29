'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingPitches',
  field: 'pitch',
  label: 'Pitch',
  maxLength: 4000,
});

module.exports = {
  listMessagingPitches: store.list,
  createMessagingPitch: store.create,
  updateMessagingPitch: store.update,
  deleteMessagingPitch: store.remove,
  rowToPitch: store.rowToItem,
};
