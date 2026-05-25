'use strict';

/**
 * Dedicated Vercel/serverless entry for Import from Fields.
 * Ensures /api/assets/import-from-fields is routed when api/assets/ exists
 * (same pattern as api/assets/import-drive-folder.js).
 */
const { handleRequest } = require('../../routes/index');

module.exports = async function handler(req, res) {
  return handleRequest(req, res);
};
