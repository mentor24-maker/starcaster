'use strict';

/**
 * Vercel serverless entry for `/` after middleware or vercel.json rewrite.
 * Delegates to routes/publicSitePages.js via routes/index.js.
 * See docs/CUSTOM_DOMAIN_PUBLIC_SITES.md
 */

const { handleRequest } = require('../routes/index');

module.exports = async function handler(req, res) {
  return handleRequest(req, res);
};
