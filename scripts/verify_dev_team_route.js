#!/usr/bin/env node
'use strict';

/**
 * Verifies POST /api/develop/devAgent/team is registered (not 404).
 * Run after restarting the local server: node scripts/verify_dev_team_route.js
 */

const { handleRequest } = require('../routes/index');

async function probe(method, pathname) {
  const captured = { statusCode: 0, body: '' };
  const res = {
    statusCode: 0,
    setHeader() {},
    end(chunk) {
      captured.body = String(chunk || '');
      captured.statusCode = this.statusCode;
    },
  };
  const req = {
    method,
    url: pathname,
    headers: {
      host: 'localhost:3000',
      'content-type': 'application/json',
      'x-project-id': 'verify-project',
    },
    body: method === 'POST' ? { contactId: 'verify_contact', role: 'Verify' } : undefined,
  };
  await handleRequest(req, res);
  let parsed = null;
  try { parsed = JSON.parse(captured.body || '{}'); } catch { parsed = { raw: captured.body }; }
  return { status: captured.statusCode, parsed };
}

(async () => {
  const post = await probe('POST', '/api/develop/devAgent/team');
  const get = await probe('GET', '/api/develop/devAgent/team');

  const postOk = post.status !== 404;
  const getOk = get.status !== 404;

  console.log('POST /api/develop/devAgent/team ->', post.status, post.parsed?.error?.message || post.parsed?.ok);
  console.log('GET  /api/develop/devAgent/team ->', get.status, get.parsed?.error?.message || post.parsed?.ok);

  if (!postOk || !getOk) {
    console.error('\nRoute NOT registered in this Node process. Restart the server:');
    console.error('  Ctrl+C the running server, then: npm run dev   (or: node server.js)');
    process.exit(1);
  }

  console.log('\nRoutes are registered (401/400/500 is OK here; 404 means stale server).');
})();
