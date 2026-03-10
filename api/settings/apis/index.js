'use strict';
const { handleRequest } = require('../../../routes/index');
module.exports = async function handler(req, res) {
  return handleRequest(req, res);
};
