'use strict';

/**
 * Explicit Vercel route for POST /api/projects/:id/delete
 * (avoids catch-all gaps for project deletion on some deployments)
 */

const { handleRequest } = require('../../../routes/index');

module.exports = async function handler(req, res) {
  return handleRequest(req, res);
};
