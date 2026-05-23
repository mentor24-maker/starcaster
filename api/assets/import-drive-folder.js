'use strict';

/**
 * Dedicated Vercel/serverless entry for Drive folder import.
 * Ensures POST /api/assets/import-drive-folder is routed even if catch-all behavior differs.
 */
const { handleRequest } = require('../../routes/index');

module.exports = async function handler(req, res) {
  return handleRequest(req, res);
};
