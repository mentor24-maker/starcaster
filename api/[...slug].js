'use strict';

/**
 * api/[...slug].js — Vercel serverless entry point.
 *
 * This file is the Vercel catch-all function handler.
 * It does nothing except delegate to routes/index.js.
 *
 * All API business logic lives in routes/. Do not add route handlers here.
 */

const { handleRequest } = require('../routes/index');

module.exports = async function handler(req, res) {
  return handleRequest(req, res);
};
