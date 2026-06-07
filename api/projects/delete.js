'use strict';

/**
 * Explicit Vercel route for POST /api/projects/delete
 * Body: { projectId, purgeAssociated? }
 */

const { handleRequest } = require('../../routes/index');

module.exports = async function handler(req, res) {
  return handleRequest(req, res);
};
