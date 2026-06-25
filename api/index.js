'use strict';

/**
 * api/index.js — Vercel entry for the site root (/).
 * vercel.json routes "/" here so custom domains can resolve to site.html.
 */

const { handleRequest } = require('../routes/index');

module.exports = async function handler(req, res) {
  return handleRequest(req, res);
};
