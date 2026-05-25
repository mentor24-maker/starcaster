#!/usr/bin/env node
'use strict';

/**
 * Verify Import from Assets route is registered (no HTTP server required).
 *
 * Usage: node scripts/verify_import_from_fields_route.js
 */

const fs = require('fs');
const path = require('path');

const assets = require('../routes/assets');
const { normalizeApiPathname } = require('../routes/http');

const routePath = normalizeApiPathname('/api/assets/import-from-fields');
const vercelEntry = path.join(__dirname, '..', 'api', 'assets', 'import-from-fields.js');

if (typeof assets.handleImportFromFields !== 'function') {
  console.error('[verify] assets.handleImportFromFields is not exported');
  process.exitCode = 1;
}

if (!assets.isImportFromFieldsPath(routePath)) {
  console.error('[verify] isImportFromFieldsPath failed for', routePath);
  process.exitCode = 1;
}

if (!fs.existsSync(vercelEntry)) {
  console.error('[verify] Missing Vercel entry:', vercelEntry);
  process.exitCode = 1;
}

try {
  require('../lib/assetFieldImport');
  console.log('[verify] lib/assetFieldImport.js loads OK');
} catch (err) {
  console.error('[verify] lib/assetFieldImport.js missing:', err.message);
  process.exitCode = 1;
}

console.log('[verify] Route registered:', assets.IMPORT_FROM_FIELDS_PATH);
console.log('[verify] Vercel entry:', vercelEntry);
console.log('[verify] OK — restart npm run dev (check port in log), redeploy Vercel, then:');
console.log('         GET', routePath, '(logged in) or POST from Import from Assets');
