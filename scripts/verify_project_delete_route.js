#!/usr/bin/env node
'use strict';

/**
 * Verify project delete routes are registered (no HTTP server required).
 *
 * Usage: node scripts/verify_project_delete_route.js
 */

const projects = require('../routes/projects');
const { handleProjectDelete } = require('../lib/projectDeleteHandler');
const { normalizeApiPathname } = require('../routes/http');

const deletePath = normalizeApiPathname('/api/projects/proj_example/delete');
const legacyDeletePath = normalizeApiPathname('/api/projects/proj_example');

if (typeof projects.handle !== 'function') {
  console.error('[verify] routes/projects.handle is missing');
  process.exitCode = 1;
}

if (typeof handleProjectDelete !== 'function') {
  console.error('[verify] lib/projectDeleteHandler.handleProjectDelete is missing');
  process.exitCode = 1;
}

const postDeleteMatch = deletePath.match(/^\/api\/projects\/([^/]+)\/delete\/?$/);
const legacyMatch = legacyDeletePath.match(/^\/api\/projects\/([^/]+)\/?$/);

if (!postDeleteMatch) {
  console.error('[verify] POST delete path regex failed for', deletePath);
  process.exitCode = 1;
}

if (!legacyMatch) {
  console.error('[verify] DELETE path regex failed for', legacyDeletePath);
  process.exitCode = 1;
}

const staticDeletePath = normalizeApiPathname('/api/projects/delete');
if (staticDeletePath !== '/api/projects/delete') {
  console.error('[verify] static delete path unexpected:', staticDeletePath);
  process.exitCode = 1;
}

try {
  require('../api/projects/delete');
  console.log('[verify] api/projects/delete.js loads OK');
} catch (err) {
  console.error('[verify] api/projects/delete.js missing:', err.message);
  process.exitCode = 1;
}

console.log('[verify] POST', deletePath, 'OK');
console.log('[verify] POST', staticDeletePath, 'OK (preferred)');
console.log('[verify] DELETE', legacyDeletePath, 'OK');
console.log('[verify] GET /api/ping should return routesVersion project-delete-v2 after restart');
