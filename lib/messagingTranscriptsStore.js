'use strict';

const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingTranscripts',
  field: 'transcript',
  label: 'Transcript',
  maxLength: 20000,
});

module.exports = {
  listMessagingTranscripts: store.list,
  createMessagingTranscript: store.create,
  updateMessagingTranscript: store.update,
  deleteMessagingTranscript: store.remove,
  rowToTranscript: store.rowToItem,
};
