#!/usr/bin/env node
'use strict';

/**
 * Verify Drive folder import route is registered (no HTTP server required).
 *
 * Usage: node scripts/verify_import_drive_folder_route.js
 */

const assets = require('../routes/assets');
const { normalizeApiPathname } = require('../routes/http');

const path = normalizeApiPathname('/api/assets/import-drive-folder');

if (typeof assets.handleImportDriveFolder !== 'function') {
  console.error('[verify] assets.handleImportDriveFolder is not exported');
  process.exitCode = 1;
}

if (!assets.isImportDriveFolderPath(path)) {
  console.error('[verify] isImportDriveFolderPath failed for', path);
  process.exitCode = 1;
}

try {
  require('../lib/assetDriveFolderImport');
  console.log('[verify] lib/assetDriveFolderImport.js loads OK');
} catch (err) {
  console.error('[verify] lib/assetDriveFolderImport.js missing:', err.message);
  process.exitCode = 1;
}

console.log('[verify] Route registered:', assets.IMPORT_DRIVE_FOLDER_PATH);
console.log('[verify] OK — restart server or redeploy, then GET', path, 'while logged in');
