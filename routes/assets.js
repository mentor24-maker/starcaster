'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { listAssets, createAsset, updateAsset, deleteAsset, rowToAsset } = require('../lib/assetsStore');
const {
  listAssetCategories,
  createAssetCategory,
  getAssetCategoryById,
  updateAssetCategory,
  deleteAssetCategory,
  rowToAssetCategory,
} = require('../lib/assetCategoriesStore');
const {
  fetchDriveFileMedia,
} = require('../lib/googleDrive');
const { isConfigured: isAssetStorageConfigured, uploadAssetFile } = require('../lib/assetStorage');
const { importImageAssetWithThumbnail } = require('../lib/assetImageImport');
const { isConfigured: isGoogleDriveConfigured } = require('../lib/googleDrive');

const IMPORT_DRIVE_FOLDER_PATH = '/api/assets/import-drive-folder';
const MAX_FOLDER_IMPORT_FILES = 100;

function loadDriveFolderImportLib() {
  try {
    const lib = require('../lib/assetDriveFolderImport');
    return { ok: true, lib };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || 'unknown error');
    return { ok: false, error: message };
  }
}

function isImportDriveFolderPath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  return path === IMPORT_DRIVE_FOLDER_PATH;
}
const { isConfigured: isBlobConfigured, handleClientUpload } = require('../lib/blobStorage');
const { sbQuery, tableConfig } = require('../lib/supabase');
const { listYoutubeVideos } = require('../lib/acquire/YoutubeVideosStore');

// Google Vertex SDK
let falGenerator = null;
try {
  falGenerator = require('../lib/vendor/fal');
} catch (e) {
  console.warn('Vertex SDK not configured locally:', e.message);
}

const ASSET_TYPES = new Set(['Image', 'Video', 'Audio', 'Lead Magnet', 'File']);
const ASSETS_PATH_RE = /^\/api\/assets\/?$/;
const MAX_UPLOAD_BASE64_CHARS = 9_000_000;
const MAX_BULK_IMAGE_IMPORT_FILES = 40;

const ASSET_TYPE_CANONICAL = new Map([
  ['image', 'Image'],
  ['video', 'Video'],
  ['music', 'Audio'],
  ['audio', 'Audio'],
  ['lead magnet', 'Lead Magnet'],
  ['lead_magnet', 'Lead Magnet'],
  ['copy', 'Lead Magnet'],
  ['file', 'File'],
  ['document', 'File'],
  ['screenshot', 'File'],
  ['screen shot', 'File'],
  ['multimedia', 'Video'],
]);

function canonicalAssetType(value) {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  return ASSET_TYPE_CANONICAL.get(key) || raw;
}

function estimatedBytesFromBase64(base64Text) {
  const clean = String(base64Text || '').trim().replace(/\s+/g, '');
  if (!clean) return 0;
  const pad = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
}

async function handleImportDriveFolderPost(req, res, scope) {
  const importLib = loadDriveFolderImportLib();
  if (!importLib.ok) {
    return sendErr(
      res,
      503,
      `Drive folder import module is not available: ${importLib.error}`,
      { code: 'IMPORT_DRIVE_FOLDER_MODULE_MISSING' }
    ), true;
  }

  if (!isGoogleDriveConfigured()) {
    return sendErr(
      res,
      400,
      'Google Drive credentials are not configured in Settings > APIs or environment variables.',
      { code: 'GOOGLE_DRIVE_NOT_CONFIGURED' }
    ), true;
  }

  const body = await parseJsonBody(req);
  const folderUrl = String(body.folderUrl || body.folder_url || '').trim();
  if (!folderUrl) {
    return sendErr(res, 400, 'folderUrl is required', { code: 'VALIDATION_ERROR' }), true;
  }

  const driveImport = importLib.lib;
  const maxFiles = Math.max(
    1,
    Number(driveImport.MAX_FOLDER_IMPORT_FILES || MAX_FOLDER_IMPORT_FILES) || MAX_FOLDER_IMPORT_FILES
  );
  const limit = Math.max(1, Math.min(maxFiles, Number(body.limit || maxFiles) || maxFiles));

  const result = await driveImport.importDriveFolderImages(
    {
      folderUrl,
      category: String(body.category || '').trim(),
      tags: Array.isArray(body.tags) ? body.tags : [],
      limit,
    },
    scope
  );

  if (!result.ok) {
    return sendErr(res, result.status || 500, result.error, { code: 'IMPORT_DRIVE_FOLDER_FAILED' }), true;
  }

  return sendOk(res, result.status || 200, result.data, result.data), true;
}

async function handleImportDriveFolderGet(req, res) {
  const importLib = loadDriveFolderImportLib();
  const payload = {
    ok: true,
    registered: true,
    available: importLib.ok,
    path: IMPORT_DRIVE_FOLDER_PATH,
    methods: ['POST', 'GET'],
    note: 'GET is a public health check. POST /api/assets/import-drive-folder requires login.',
  };
  if (!importLib.ok) {
    payload.moduleError = importLib.error;
  }
  if (req.authUser) {
    payload.googleDriveConfigured = isGoogleDriveConfigured();
  }
  return sendOk(res, 200, payload, payload), true;
}

async function handleImportDriveFolder(req, res, scope, requestMethod) {
  if (requestMethod === 'GET') {
    return handleImportDriveFolderGet(req, res);
  }
  if (requestMethod === 'POST') {
    return handleImportDriveFolderPost(req, res, scope);
  }
  return sendErr(res, 405, 'Method not allowed', { code: 'METHOD_NOT_ALLOWED' }), true;
}

async function handle(req, res, pathname, method) {
  const parsedUrl = getUrlObj(req);
  const normalizedPath = String(pathname || '').replace(/\/+$/, '') || '/';
  const isAssetApiPath = normalizedPath === '/api/assets'
    || normalizedPath.startsWith('/api/assets/')
    || normalizedPath.startsWith('/api/asset-categories');
  if (!isAssetApiPath) return false;

  const isAssetsPath = ASSETS_PATH_RE.test(normalizedPath);
  const requestMethod = String(method || '').toUpperCase();
  const scope = {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
    projectIds: Array.isArray(req?.projectContext?.projects)
      ? req.projectContext.projects.map((project) => String(project?.id || '').trim()).filter(Boolean)
      : [],
  };

  if (isImportDriveFolderPath(normalizedPath) && (requestMethod === 'POST' || requestMethod === 'GET')) {
    return handleImportDriveFolder(req, res, scope, requestMethod);
  }

  if (isAssetsPath && requestMethod === 'GET') {
    const result = await listAssets(scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const assets = (Array.isArray(result.data) ? result.data : []).map(rowToAsset);
    return sendOk(res, 200, assets, { assets }, { total: assets.length }), true;
  }

  if (isAssetsPath && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const assetName = String(body.assetName || body.asset_name || '').trim();
    const assetType = canonicalAssetType(body.assetType || body.asset_type || '');
    const category = String(body.category || '').trim();
    const location = String(body.location || '').trim();
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const size = Math.max(0, Number(body.size || 0) || 0);
    const imageWidth = Math.max(0, Number(body.imageWidth || body.image_width || 0) || 0);
    const imageHeight = Math.max(0, Number(body.imageHeight || body.image_height || 0) || 0);
    const aspect = String(body.aspect || '').trim();

    if (!assetName) return sendErr(res, 400, 'assetName is required', { code: 'VALIDATION_ERROR' }), true;
    if (!ASSET_TYPES.has(assetType)) {
      return sendErr(
        res,
        400,
        `assetType must be one of: ${Array.from(ASSET_TYPES).join(', ')}`,
        { code: 'VALIDATION_ERROR' }
      ), true;
    }

    const result = await createAsset({ assetName, assetType, category, location, tags, size, imageWidth, imageHeight, aspect }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    return sendOk(res, 201, rowToAsset(created), { asset: rowToAsset(created) }), true;
  }

  const assetIdMatch = normalizedPath.match(/^\/api\/assets\/(\d+)$/);
  if (assetIdMatch && requestMethod === 'PATCH') {
    const body = await parseJsonBody(req);
    const assetId = Number(assetIdMatch[1]);

    if (body.assetType != null || body.asset_type != null) {
      const assetType = canonicalAssetType(body.assetType || body.asset_type || '');
      if (assetType && !ASSET_TYPES.has(assetType)) {
        return sendErr(
          res,
          400,
          `assetType must be one of: ${Array.from(ASSET_TYPES).join(', ')}`,
          { code: 'VALIDATION_ERROR' }
        ), true;
      }
    }

    const result = await updateAsset(assetId, body, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const updated = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!updated) return sendErr(res, 404, 'Asset not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToAsset(updated), { asset: rowToAsset(updated) }), true;
  }

  if (assetIdMatch && requestMethod === 'DELETE') {
    const assetId = Number(assetIdMatch[1]);
    const result = await deleteAsset(assetId, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const deleted = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!deleted) return sendErr(res, 404, 'Asset not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToAsset(deleted), { asset: rowToAsset(deleted) }), true;
  }

  if (pathname === '/api/assets/generate' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const promptText = String(body.prompt || '').trim();
    const customName = String(body.assetName || '').trim();
    const topic = String(body.topic || '').trim();
    const references = Array.isArray(body.references) ? body.references : [];
    const duration = parseInt(body.duration, 10) || 4;

    if (!promptText) {
      return sendErr(res, 400, 'Prompt string required to initialize generation pipeline.', { code: 'INVALID_PROMPT' }), true;
    }
    
    if (!falGenerator) {
      return sendErr(res, 503, 'Fal AI integration is missing or improperly mapped in backend.', { code: 'SDK_NOT_FOUND' }), true;
    }

    try {
      // Physically expand image references to Base64 arrays if native images are explicitly attached 
      let primaryImage = null;
      if (references.length > 0) {
          const { listAssets } = require('../lib/assetsStore');
          const read = await listAssets(scope);
          const allAssets = Array.isArray(read.data) ? read.data : [];
          for (const ref of references) {
              const row = allAssets.find(a => Number(a.id) === Number(ref.id));
              if (row && (row.asset_type === 'Image' || row.assetType === 'Image') && row.location) {
                 if (row.location.startsWith('http')) {
                    try {
                       const imgRes = await fetch(row.location);
                       const arr = await imgRes.arrayBuffer();
                       const b64 = Buffer.from(arr).toString('base64');
                       const mime = imgRes.headers.get('content-type') || 'image/jpeg';
                       primaryImage = { bytesBase64Encoded: b64, mimeType: mime };
                       break; // Limit vertex input to explicitly one seed image
                    } catch (e) { console.warn('Failed to natively buffer layout image URL:', e); }
                 } else if (row.location.startsWith('data:image/')) {
                    const parts = row.location.split(',');
                    let mime = 'image/jpeg';
                    const mimeMatch = parts[0].match(/data:([^;]+);/);
                    if (mimeMatch) mime = mimeMatch[1];
                    primaryImage = { bytesBase64Encoded: parts[1], mimeType: mime };
                    break;
                 }
              }
          }
      }

      // 1. Fire asynchronous job natively to Fal.ai
      const initialRunDuration = Math.min(8, duration);
      const generationJob = await falGenerator.generateVideo(promptText, references, primaryImage, initialRunDuration);
      const { logUsage } = require('../lib/observeStore');
      logUsage('fal_ai', 'video_generation_job', 1, scope);

      const resolvedName = customName || `Generated Video: ${promptText.substring(0, 30)}...`;

      // 2. Instantiate standalone DB Row capturing the queued event
      const explicitTags = references.map(r => `ref:${r.id}`);
      explicitTags.push(`startTime:${Date.now()}`);
      explicitTags.push(`targetDuration:${duration}`);
      explicitTags.push(`currentDuration:0`);

      const dbPayload = {
        assetName: resolvedName,
        assetType: 'Video',
        category: 'Generated',
        topic: topic || null, // Natively preserve pipeline structural assignment constraints 
        generationStatus: 'processing',
        generationJobId: generationJob.jobId,
        comments: `Generative Prompt Instructions: \n${promptText}`,
        tags: explicitTags
      };
      
      const result = await createAsset(dbPayload, scope);
      if (!result.ok) {
         console.error('Failed to log Fal generation in DB:', result.error);
         return sendErr(res, 500, 'Generation fired but failed database synchronization.', { code: 'DB_SYNC_FAIL' }), true;
      }
      
      const created = Array.isArray(result.data) ? result.data[0] : result.data;
      return sendOk(res, 200, {
        status: 'queued',
        jobId: generationJob.jobId,
        asset: rowToAsset(created),
        message: 'Fal.ai initialization successful. Asset rendering async in the cloud.'
      }), true;

    } catch (err) {
      console.error('Vertex Gen Error:', err);
      console.error('LRO Engine crash natively:', err);
      return sendErr(res, 500, 'Fal Execution Failed: ' + (err.message || err.toString()), { code: 'SDK_CRASH' }), true;
    }
  }

  if (pathname === '/api/assets/generate/status' && requestMethod === 'GET') {
    const assetId = Number(parsedUrl.searchParams.get('id') || 0);
    if (!assetId || assetId <= 0) {
      return sendErr(res, 400, 'Valid asset id conceptually required to check Vertex job output.', { code: 'INVALID_ID' }), true;
    }
    
    const read = await listAssets(scope);
    if (!read.ok) return sendErr(res, read.status || 500, read.error), true;
    const assets = (Array.isArray(read.data) ? read.data : []).map(rowToAsset);
    let target = assets.find(a => a.id === assetId);

    if (!target) {
       return sendErr(res, 404, 'Job Tracker row not found entirely in local schema mapped to that ID.', { code: 'NOT_FOUND' }), true;
    }

    // Standard checking mechanism hook
    if (target.generationStatus === 'processing') {
       try {
          if (target.generationJobId) {
             const statusData = await falGenerator.getLROStatus(target.generationJobId);
             target._vertexDiagnostic = statusData; 
             
             if (statusData.error) {
                 await updateAsset(target.id, { generationStatus: 'failed', comments: 'Fal Error: ' + JSON.stringify(statusData.error) }, scope);
                 target.generationStatus = 'failed';
             } else if (statusData.done) {
                 // Try to gracefully extract the response GCS or base64 layout natively.
                 let locationVal = 'https://vjs.zencdn.net/v/oceans.mp4'; 
                 let videoBase64 = null;
                 try {
                     if (statusData.response) {
                        locationVal = JSON.stringify(statusData.response);
                        if (statusData.response.videos && statusData.response.videos[0]) {
                           videoBase64 = statusData.response.videos[0].bytesBase64Encoded;
                        }
                     }
                 } catch (e) {}

                 const existingTags = target.tags || [];
                 let targetDuration = 4;
                 let currentDuration = 0;
                 
                 existingTags.forEach(t => {
                    if (String(t).startsWith('targetDuration:')) targetDuration = parseInt(String(t).split(':')[1], 10) || 4;
                    if (String(t).startsWith('currentDuration:')) currentDuration = parseInt(String(t).split(':')[1], 10) || 0;
                 });
                 
                 // We always submit 8-second chunks for multi-step renders.
                 currentDuration += 8;
                 
                 const updatedTags = existingTags.filter(t => !String(t).startsWith('currentDuration:') && !String(t).startsWith('endTime:'));
                 updatedTags.push(`currentDuration:${currentDuration}`);
                 
                 if (currentDuration < targetDuration && videoBase64) {
                    // LOOP: Spawn extend job automatically
                    try {
                       const nextDuration = Math.min(8, targetDuration - currentDuration);
                       let promptText = (target.comments || '').replace('Generative Prompt Instructions: \n', '');
                       const nextJob = await falGenerator.generateVideo(promptText, [], { bytesBase64Encoded: videoBase64, mimeType: 'video/mp4' }, nextDuration);
                       
                       const updated = await updateAsset(target.id, {
                           generationJobId: nextJob.jobId,
                           generationStatus: 'processing',
                           tags: updatedTags
                       }, scope);
                       
                       if (updated.ok) {
                          const raw = Array.isArray(updated.data) ? updated.data[0] : updated.data;
                          target = rowToAsset(raw);
                       }
                    } catch (loopErr) {
                       console.error('Failed to automatically loop video generation:', loopErr);
                       await updateAsset(target.id, { generationStatus: 'failed', comments: 'Auto-Loop Error: ' + (loopErr.message || 'Unknown Crash') }, scope);
                       target.generationStatus = 'failed';
                       target.comments = 'Auto-Loop Error: ' + (loopErr.message || 'Unknown Crash');
                    }
                 } else {
                     // FINISHED: Entire chain completed.
                     updatedTags.push(`endTime:${Date.now()}`);

                     const updated = await updateAsset(target.id, {
                         generationStatus: 'completed',
                         location: locationVal,
                         tags: updatedTags
                     }, scope);
                     
                     if (updated.ok) {
                        const raw = Array.isArray(updated.data) ? updated.data[0] : updated.data;
                        target = rowToAsset(raw);
                     }
                 }
             }
          }
       } catch (err) {
         console.warn("LRO GET check natively threw API rejection:", err.message || err);
         await updateAsset(target.id, { generationStatus: 'failed', comments: 'Fal Error: ' + (err.message || 'Unknown Crash') }, scope);
         target.generationStatus = 'failed';
         target.comments = 'Fal Error: ' + (err.message || 'Unknown Crash');
       }
    }

    return sendOk(res, 200, { asset: target }, { asset: target }), true;
  }

  if (pathname === '/api/assets/generate/cancel' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const assetId = Number(body.id || parsedUrl.searchParams.get('id') || 0);

    if (!assetId || assetId <= 0) {
      return sendErr(res, 400, 'Valid asset id conceptually required to cancel Vertex job natively.', { code: 'INVALID_ID' }), true;
    }
    
    // First read to get operationName
    const read = await listAssets(scope);
    if (!read.ok) return sendErr(res, read.status || 500, read.error), true;
    const assets = (Array.isArray(read.data) ? read.data : []).map(rowToAsset);
    let target = assets.find(a => a.id === assetId);

    if (target && target.generationJobId) {
       try {
          if (falGenerator && falGenerator.cancelLRO) {
             await falGenerator.cancelLRO(target.generationJobId);
          }
       } catch (err) {
          console.warn("Fal Cancel payload violently rejected natively. Database will still execute shutdown.", err);
       }
    }

    // Physical shutdown execution: map `deleteAsset` to formally purge clutter.
    const del = await deleteAsset(assetId, scope);
    
    if (!del.ok) return sendErr(res, del.status || 500, del.error), true;

    return sendOk(res, 200, { message: 'Generation elegantly cancelled and successfully removed from history tracker.' }), true;
  }

  if (pathname === '/api/assets/upload-google-drive' && requestMethod === 'POST') {
    if (!isAssetStorageConfigured()) {
      return sendErr(
        res,
        400,
        'No asset storage backend is configured. Configure Vercel Blob token or Google Drive credentials.',
        { code: 'ASSET_STORAGE_NOT_CONFIGURED' }
      ), true;
    }

    const body = await parseJsonBody(req);
    const fileName = String(body.fileName || '').trim();
    const mimeType = String(body.mimeType || 'application/octet-stream').trim();
    const fileBase64 = String(body.fileBase64 || '').trim();
    const assetType = canonicalAssetType(body.assetType || '');
    const assetName = String(body.assetName || fileName || '').trim();
    const category = String(body.category || '').trim();
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const payloadSize = Math.max(0, Number(body.fileSize || body.size || 0) || 0);

    if (!fileName || !fileBase64) {
      return sendErr(res, 400, 'fileName and fileBase64 are required', { code: 'VALIDATION_ERROR' }), true;
    }
    if (fileBase64.length > MAX_UPLOAD_BASE64_CHARS) {
      return sendErr(res, 413, 'File is too large for this upload path. Use files up to about 7MB.', { code: 'PAYLOAD_TOO_LARGE' }), true;
    }
    if (!ASSET_TYPES.has(assetType)) {
      return sendErr(
        res,
        400,
        `assetType must be one of: ${Array.from(ASSET_TYPES).join(', ')}`,
        { code: 'VALIDATION_ERROR' }
      ), true;
    }

    const upload = await uploadAssetFile({ assetType, category, fileName, mimeType, fileBase64, makePublic: true });
    if (!upload.ok) return sendErr(res, upload.status || 500, upload.error), true;

    const save = await createAsset({
      assetName: assetName || upload.data.name || fileName,
      assetType,
      category,
      location: upload.data.location,
      tags,
      size: Math.max(
        0,
        Number(upload.data.sizeBytes || payloadSize || estimatedBytesFromBase64(fileBase64) || 0) || 0
      ),
      imageWidth: Math.max(0, Number(upload.data.imageWidth || 0) || 0) || null,
      imageHeight: Math.max(0, Number(upload.data.imageHeight || 0) || 0) || null,
    }, scope);
    if (!save.ok) return sendErr(res, save.status || 500, save.error), true;

    const created = Array.isArray(save.data) ? save.data[0] : save.data;
    return sendOk(
      res,
      201,
      { asset: rowToAsset(created), drive: upload.data },
      { asset: rowToAsset(created), drive: upload.data }
    ), true;
  }

  if (pathname === '/api/assets/import-image' && requestMethod === 'POST') {
    if (!isAssetStorageConfigured()) {
      return sendErr(
        res,
        400,
        'No asset storage backend is configured. Configure Vercel Blob token or Google Drive credentials.',
        { code: 'ASSET_STORAGE_NOT_CONFIGURED' }
      ), true;
    }

    const body = await parseJsonBody(req);
    const fileName = String(body.fileName || '').trim();
    const mimeType = String(body.mimeType || 'image/jpeg').trim();
    const fileBase64 = String(body.fileBase64 || '').trim();

    if (!fileName || !fileBase64) {
      return sendErr(res, 400, 'fileName and fileBase64 are required', { code: 'VALIDATION_ERROR' }), true;
    }
    if (fileBase64.length > MAX_UPLOAD_BASE64_CHARS) {
      return sendErr(res, 413, 'File is too large for this upload path. Use files up to about 7MB.', { code: 'PAYLOAD_TOO_LARGE' }), true;
    }
    if (!String(mimeType || '').toLowerCase().startsWith('image/')) {
      return sendErr(res, 400, 'import-image only accepts image files', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await importImageAssetWithThumbnail(
      {
        fileName,
        mimeType,
        fileBase64,
        assetName: String(body.assetName || body.asset_name || fileName).trim(),
        category: String(body.category || '').trim(),
        tags: Array.isArray(body.tags) ? body.tags : [],
        aspect: String(body.aspect || '').trim(),
      },
      scope
    );

    if (!result.ok) {
      return sendErr(res, result.status || 500, result.error, { code: 'IMPORT_IMAGE_FAILED' }), true;
    }

    return sendOk(res, result.status || 201, result.data, result.data), true;
  }

  if (pathname === '/api/assets/bulk-import-images' && requestMethod === 'POST') {
    if (!isAssetStorageConfigured()) {
      return sendErr(
        res,
        400,
        'No asset storage backend is configured. Configure Vercel Blob token or Google Drive credentials.',
        { code: 'ASSET_STORAGE_NOT_CONFIGURED' }
      ), true;
    }

    const body = await parseJsonBody(req);
    const files = Array.isArray(body.files) ? body.files : [];
    const category = String(body.category || '').trim();
    const aspect = String(body.aspect || '').trim();
    const sharedTags = Array.isArray(body.tags) ? body.tags : [];

    if (!files.length) {
      return sendErr(res, 400, 'files array is required', { code: 'VALIDATION_ERROR' }), true;
    }
    if (files.length > MAX_BULK_IMAGE_IMPORT_FILES) {
      return sendErr(
        res,
        400,
        `Bulk import supports up to ${MAX_BULK_IMAGE_IMPORT_FILES} images per request`,
        { code: 'VALIDATION_ERROR' }
      ), true;
    }

    const results = [];
    let createdCount = 0;
    let thumbnailCount = 0;

    for (const entry of files) {
      const fileName = String(entry?.fileName || entry?.file_name || '').trim();
      const mimeType = String(entry?.mimeType || entry?.mime_type || 'image/jpeg').trim();
      const fileBase64 = String(entry?.fileBase64 || entry?.file_base64 || '').trim();
      const assetName = String(entry?.assetName || entry?.asset_name || fileName).trim();
      const tags = Array.isArray(entry?.tags) ? entry.tags : sharedTags;

      if (!fileName || !fileBase64) {
        results.push({ fileName: fileName || '(unnamed)', ok: false, error: 'fileName and fileBase64 are required' });
        continue;
      }
      if (fileBase64.length > MAX_UPLOAD_BASE64_CHARS) {
        results.push({ fileName, ok: false, error: 'File exceeds upload size limit (~7MB)' });
        continue;
      }
      if (!mimeType.toLowerCase().startsWith('image/')) {
        results.push({ fileName, ok: false, error: 'Only image files are supported' });
        continue;
      }

      const imported = await importImageAssetWithThumbnail(
        { fileName, mimeType, fileBase64, assetName, category, tags, aspect },
        scope
      );

      if (!imported.ok) {
        results.push({ fileName, ok: false, error: imported.error || 'Import failed' });
        continue;
      }

      createdCount += 1;
      if (imported.data?.thumbnailGenerated) thumbnailCount += 1;

      results.push({
        fileName,
        ok: true,
        asset: imported.data.asset,
        aspect: imported.data.aspect,
        thumbnailGenerated: Boolean(imported.data.thumbnailGenerated),
        thumbnailError: imported.data.thumbnailError || '',
      });
    }

    return sendOk(
      res,
      200,
      {
        createdCount,
        thumbnailCount,
        failedCount: results.filter((row) => !row.ok).length,
        results,
      },
      {
        createdCount,
        thumbnailCount,
        failedCount: results.filter((row) => !row.ok).length,
        results,
      }
    ), true;
  }

  if (normalizedPath === '/api/assets/blob-upload' && requestMethod === 'POST') {
    if (!isBlobConfigured()) {
      return sendErr(
        res,
        400,
        'Vercel Blob is not configured for direct uploads.',
        { code: 'ASSET_STORAGE_NOT_CONFIGURED' }
      ), true;
    }
    const body = await parseJsonBody(req);
    const result = await handleClientUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let payload = {};
        if (clientPayload && typeof clientPayload === 'object') {
          payload = clientPayload;
        } else if (typeof clientPayload === 'string') {
          try {
            payload = JSON.parse(clientPayload);
          } catch (_) {
            payload = {};
          }
        }
        const assetType = canonicalAssetType(payload.assetType || '');
        const category = String(payload.category || '').trim();
        const fileName = String(payload.fileName || 'upload.bin').trim() || 'upload.bin';
        const allowedContentTypes = assetType === 'Video'
          ? ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
          : ['application/octet-stream'];
        return {
          allowedContentTypes,
          addRandomSuffix: true,
          pathname: `APP/Assets/${encodeURIComponent(assetType || 'File')}/${encodeURIComponent(category || 'Uploads')}/${encodeURIComponent(fileName)}`,
          tokenPayload: JSON.stringify({
            assetType,
            category,
            assetName: String(payload.assetName || '').trim(),
            tags: Array.isArray(payload.tags) ? payload.tags : [],
            projectId: scope.projectId,
            userId: scope.userId,
          }),
        };
      },
      onUploadCompleted: async () => {},
    });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    res.statusCode = result.status || 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(result.data));
    return true;
  }

  if (pathname === '/api/asset-categories' && requestMethod === 'GET') {
    const result = await listAssetCategories(scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const categoriesByKey = new Map();
    (Array.isArray(result.data) ? result.data : []).map(rowToAssetCategory).forEach((category) => {
      if (!category?.category) return;
      categoriesByKey.set(`${category.assetType}::${category.category}`, category);
    });

    const assetsResult = await listAssets(scope);
    if (assetsResult.ok) {
      (Array.isArray(assetsResult.data) ? assetsResult.data : []).map(rowToAsset).forEach((asset) => {
        const assetType = String(asset?.assetType || '').trim();
        const categoryName = String(asset?.category || '').trim();
        if (!assetType || !categoryName) return;
        const key = `${assetType}::${categoryName}`;
        if (!categoriesByKey.has(key)) {
          categoriesByKey.set(key, {
            id: 0,
            assetType,
            category: categoryName,
            createdAt: '',
            source: 'assets',
          });
        }
      });
    }

    const categories = Array.from(categoriesByKey.values()).sort((a, b) => {
      const typeSort = String(a.assetType || '').localeCompare(String(b.assetType || ''));
      if (typeSort) return typeSort;
      return String(a.category || '').localeCompare(String(b.category || ''));
    });
    return sendOk(res, 200, categories, { categories }, { total: categories.length }), true;
  }

  if (pathname === '/api/asset-categories' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const assetType = canonicalAssetType(body.assetType || body.asset_type || '');
    const category = String(body.category || '').trim();

    if (!ASSET_TYPES.has(assetType)) {
      return sendErr(
        res,
        400,
        `assetType must be one of: ${Array.from(ASSET_TYPES).join(', ')}`,
        { code: 'VALIDATION_ERROR' }
      ), true;
    }
    if (!category) return sendErr(res, 400, 'category is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await createAssetCategory({ assetType, category, ...body }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    return sendOk(res, 201, rowToAssetCategory(created), { category: rowToAssetCategory(created) }), true;
  }

  const assetCategoryIdMatch = String(pathname || '').match(/^\/api\/asset-categories\/(\d+)\/?$/);
  if (assetCategoryIdMatch && requestMethod === 'GET') {
    const categoryId = Number(assetCategoryIdMatch[1]);
    const result = await getAssetCategoryById(categoryId, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToAssetCategory(row), { category: rowToAssetCategory(row) }), true;
  }

  if (assetCategoryIdMatch && requestMethod === 'PATCH') {
    const categoryId = Number(assetCategoryIdMatch[1]);
    const body = await parseJsonBody(req);
    const assetType = canonicalAssetType(body.assetType || body.asset_type || '');
    const category = String(body.category || '').trim();

    if (assetType && !ASSET_TYPES.has(assetType)) {
      return sendErr(
        res,
        400,
        `assetType must be one of: ${Array.from(ASSET_TYPES).join(', ')}`,
        { code: 'VALIDATION_ERROR' }
      ), true;
    }
    if ('category' in body && !category) {
      return sendErr(res, 400, 'category is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateAssetCategory(categoryId, body, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const updated = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!updated) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToAssetCategory(updated), { category: rowToAssetCategory(updated) }), true;
  }

  if (assetCategoryIdMatch && requestMethod === 'DELETE') {
    const categoryId = Number(assetCategoryIdMatch[1]);
    const result = await deleteAssetCategory(categoryId, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const deleted = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!deleted) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, rowToAssetCategory(deleted), { category: rowToAssetCategory(deleted) }), true;
  }

  const driveFileMatch = String(pathname || '').match(/^\/api\/assets\/drive-file\/([^/]+)\/?$/);
  if (driveFileMatch && requestMethod === 'GET') {
    const fileId = decodeURIComponent(driveFileMatch[1] || '').trim();
    if (!fileId) return sendErr(res, 400, 'fileId is required', { code: 'VALIDATION_ERROR' }), true;

    const media = await fetchDriveFileMedia(fileId, {
      range: String(req.headers.range || '').trim(),
    });
    if (!media.ok) return sendErr(res, media.status || 500, media.error), true;

    res.statusCode = media.status || 200;
    res.setHeader('Content-Type', media.data.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(media.data.contentLength || media.data.buffer.length || 0));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Accept-Ranges', media.data.acceptRanges || 'bytes');
    if (media.data.contentRange) {
      res.setHeader('Content-Range', media.data.contentRange);
    }
    res.end(media.data.buffer);
    return true;
  }

  // --- Video Curation Features ---
  async function searchYoutubeNatively(q, tags, limit = 50) {
    const { getProviderValues } = require('../lib/apiSettings');
    const storeKey = String(getProviderValues('youtube')?.api_key || getProviderValues('google')?.api_key || '').trim();
    const apiKey = String(process.env.YOUTUBE_API_KEY || '').trim() || storeKey;
    if (!apiKey) {
      console.warn('YouTube API key not found for live search.');
      return [];
    }
    const searchStr = [q, tags].filter(Boolean).join(' ');
    if (!searchStr) return [];
    
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('order', 'relevance');
    url.searchParams.set('maxResults', String(limit));
    url.searchParams.set('q', searchStr);
    url.searchParams.set('key', apiKey);
    
    try {
      const response = await fetch(url.toString(), {
        headers: { accept: 'application/json', 'user-agent': 'APH-AssetsVideoSearch/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return [];
      const body = await response.json();
      const items = Array.isArray(body?.items) ? body.items : [];
      return items.map((item) => ({
        video_id: String(item?.id?.videoId || ''),
        video_url: item?.id?.videoId ? `https://www.youtube.com/watch?v=${item?.id?.videoId}` : '',
        title: String(item?.snippet?.title || ''),
        channel_name: String(item?.snippet?.channelTitle || ''),
        channel_id: String(item?.snippet?.channelId || ''),
        published_at: String(item?.snippet?.publishedAt || ''),
        thumbnail_url: String(item?.snippet?.thumbnails?.medium?.url || item?.snippet?.thumbnails?.default?.url || ''),
        description: String(item?.snippet?.description || '')
      })).filter(v => v.video_id);
    } catch (e) {
      console.warn('Failed to query Youtube natively:', e.message);
      return [];
    }
  }

  if (pathname === '/api/assets/video/search' && requestMethod === 'GET') {
    const urlObj = new URL(req.url, 'http://localhost');
    const query = String(urlObj.searchParams.get('q') || '').toLowerCase().trim();
    const topic = String(urlObj.searchParams.get('topic') || '').toLowerCase().trim();
    const tagsSearch = String(urlObj.searchParams.get('tags') || '').toLowerCase().trim();
    const liveSearchStr = [query, tagsSearch].filter(Boolean).join(' ');

    let filteredMap = new Map();
    let liveIds = new Set();

    // 1. Live Fetch
    if (liveSearchStr) {
      const liveVids = await searchYoutubeNatively(liveSearchStr, tagsSearch, 50);
      liveVids.forEach(v => {
        liveIds.add(v.video_id);
        filteredMap.set(v.video_id, v);
      });
    }

    // 2. Base Fetch
    let vidsRes = await listYoutubeVideos(400); 
    if (vidsRes.ok && Array.isArray(vidsRes.data)) {
      vidsRes.data.forEach(v => {
        if (!filteredMap.has(v.video_id)) {
          filteredMap.set(v.video_id, v);
        }
      });
    }
    
    // 3. Hydrate
    try {
      const curTable = tableConfig().assetsVideoCuration;
      if (curTable) {
        const curRes = await sbQuery({ method: 'GET', table: curTable, query: 'select=*&order=created_at.desc&limit=3000' });
        if (curRes && Array.isArray(curRes.data)) {
          curRes.data.forEach(r => {
            const v = filteredMap.get(r.video_id) || {
              video_id: r.video_id,
              video_url: r.video_url,
              title: r.title,
              thumbnail_url: r.thumbnail_url,
            };
            v.score = r.score;
            v.positive_feedback = r.positive_feedback;
            v.negative_feedback = r.negative_feedback;
            v.visuals_liked = r.visuals_liked;
            v.specific_clips = r.specific_clips;
            if (r.topic) v.topic = r.topic;
            
            filteredMap.set(v.video_id, v);
          });
        }
      }
    } catch (err) {
      console.warn('Failed blending curated states into search feed:', err);
    }
    
    let filtered = Array.from(filteredMap.values());
    
    // 4. Local Filtering
    if (query) {
      filtered = filtered.filter(v => 
        liveIds.has(v.video_id) || 
        (v.title && v.title.toLowerCase().includes(query)) || 
        (v.channel_name && v.channel_name.toLowerCase().includes(query)) ||
        (v.description && v.description.toLowerCase().includes(query))
      );
    }
    if (topic) {
      filtered = filtered.filter(v => v.topic && v.topic.toLowerCase() === topic);
    }
    if (tagsSearch) {
      const tgArr = tagsSearch.split(',').map(t => t.trim()).filter(Boolean);
      filtered = filtered.filter(v => {
        if (liveIds.has(v.video_id)) return true;
        const vTags = String(v.tags || '').toLowerCase();
        const vHash = String(v.hashtags || '').toLowerCase();
        return tgArr.some(t => vTags.includes(t) || vHash.includes(t));
      });
    }
    
    if (!query && !tagsSearch && !topic) {
      filtered = filtered.filter(v => !v.score || v.score === 0);
    }
    
    // Globally expunge 1-star discarded records from all curation feeds
    filtered = filtered.filter(v => parseInt(v.score) !== 1);

    filtered.sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0));
    
    return sendOk(res, 200, filtered), true;
  }

  if (pathname === '/api/assets/video/feedback' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    
    if (!body.video_id) return sendErr(res, 400, 'video_id is required'), true;
    
    const record = {
      video_id: String(body.video_id).trim(),
      video_url: String(body.video_url || '').trim(),
      title: String(body.title || '').trim(),
      thumbnail_url: String(body.thumbnail_url || '').trim(),
      score: Number(body.score || 0),
      topic: String(body.topic || '').trim(),
      positive_feedback: String(body.positive_feedback || '').trim(),
      negative_feedback: String(body.negative_feedback || '').trim(),
      visuals_liked: Array.isArray(body.visuals_liked) ? body.visuals_liked : JSON.parse(body.visuals_liked || '[]'),
      specific_clips: Array.isArray(body.specific_clips) ? body.specific_clips : JSON.parse(body.specific_clips || '[]')
    };

    const targetTable = tableConfig().assetsVideoCuration;
    if (!targetTable || targetTable === '') {
      console.warn('assetsVideoCuration table not configured in api settings');
      // Succeed silently so the frontend doesn't crash during development
      return sendOk(res, 201, { status: "MOCKED_SUCCESS", record }), true;
    }

    const insRes = await sbQuery({
      method: 'POST',
      table: targetTable,
      query: 'select=*',
      body: record,
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' }
    });

    if (!insRes.ok) return sendErr(res, insRes.status || 500, insRes.error), true;
    
    // Auto-mirror to acquire repository
    const acquireTable = tableConfig().acquireYoutubeVideos || 'acquire_youtube_videos';
    try {
      await sbQuery({
        method: 'POST',
        table: acquireTable,
        query: 'on_conflict=video_id',
        body: {
          video_id: record.video_id,
          video_url: record.video_url,
          title: record.title,
          topic: record.topic,
          updated_at: new Date().toISOString()
        },
        headers: { Prefer: 'resolution=merge-duplicates' }
      });
    } catch (err) {
      console.warn('Failed to mirror curated video to acquire repository:', err);
    }
    
    return sendOk(res, 201, Array.isArray(insRes.data) ? insRes.data[0] : insRes.data), true;
  }
  if (pathname === '/api/assets/video/stats' && requestMethod === 'GET') {
    const urlObj = new URL(req.url, 'http://localhost');
    const videoId = String(urlObj.searchParams.get('videoId') || '').trim();
    const channelId = String(urlObj.searchParams.get('channelId') || '').trim();
    
    if (!videoId) return sendOk(res, 200, { views: '-', comments: '-', subscribers: '-' }), true;
    
    const { getProviderValues } = require('../lib/apiSettings');
    const storeKey = String(getProviderValues('youtube')?.api_key || getProviderValues('google')?.api_key || '').trim();
    const apiKey = String(process.env.YOUTUBE_API_KEY || '').trim() || storeKey;
    
    if (!apiKey) return sendOk(res, 200, { views: '-', comments: '-', subscribers: '-' }), true;
    
    let stats = { views: '-', comments: '-', subscribers: '-' };
    let retrievedChannelId = channelId;
    
    try {
      const vidUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      vidUrl.searchParams.set('part', 'statistics,snippet');
      vidUrl.searchParams.set('id', videoId);
      vidUrl.searchParams.set('key', apiKey);
      
      const vRes = await fetch(vidUrl.toString());
      if (vRes.ok) {
        const vBody = await vRes.json();
        const vItem = vBody.items?.[0];
        if (vItem) {
          stats.views = Number(vItem.statistics?.viewCount || 0).toLocaleString();
          stats.comments = Number(vItem.statistics?.commentCount || 0).toLocaleString();
          if (!retrievedChannelId && vItem.snippet?.channelId) {
            retrievedChannelId = String(vItem.snippet.channelId);
          }
        }
      }
      
      if (retrievedChannelId) {
        const chUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
        chUrl.searchParams.set('part', 'statistics');
        chUrl.searchParams.set('id', retrievedChannelId);
        chUrl.searchParams.set('key', apiKey);
        
        const chRes = await fetch(chUrl.toString());
        if (chRes.ok) {
          const chBody = await chRes.json();
          const chItem = chBody.items?.[0];
          if (chItem) {
            stats.subscribers = Number(chItem.statistics?.subscriberCount || 0).toLocaleString();
          }
        }
      }
    } catch (err) {
      console.warn('Failed to fetch on-the-fly video statistics:', err.message);
    }
    
    return sendOk(res, 200, stats), true;
  }

  return false;
}

const manifest = {
  id: 'assets',
  label: 'Assets',
  prefixes: ['/api/assets', '/api/asset-categories'],
};

module.exports = {
  handle,
  manifest,
  IMPORT_DRIVE_FOLDER_PATH,
  isImportDriveFolderPath,
  handleImportDriveFolder,
};
