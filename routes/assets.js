'use strict';

const { sendOk, sendErr, parseJsonBody } = require('./http');
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
const { isConfigured: isBlobConfigured, handleClientUpload } = require('../lib/blobStorage');
const { sbQuery, tableConfig } = require('../lib/supabase');
const { listYoutubeVideos } = require('../lib/acquire/YoutubeVideosStore');

const ASSET_TYPES = new Set(['Image', 'Video', 'Audio', 'Lead Magnet', 'File']);
const ASSETS_PATH_RE = /^\/api\/assets\/?$/;
const MAX_UPLOAD_BASE64_CHARS = 9_000_000;

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

async function handle(req, res, pathname, method) {
  const isAssetsPath = ASSETS_PATH_RE.test(String(pathname || ''));
  const requestMethod = String(method || '').toUpperCase();
  const scope = {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
    projectIds: Array.isArray(req?.projectContext?.projects)
      ? req.projectContext.projects.map((project) => String(project?.id || '').trim()).filter(Boolean)
      : [],
  };

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

    if (!assetName) return sendErr(res, 400, 'assetName is required', { code: 'VALIDATION_ERROR' }), true;
    if (!ASSET_TYPES.has(assetType)) {
      return sendErr(
        res,
        400,
        `assetType must be one of: ${Array.from(ASSET_TYPES).join(', ')}`,
        { code: 'VALIDATION_ERROR' }
      ), true;
    }

    const result = await createAsset({ assetName, assetType, category, location, tags, size, imageWidth, imageHeight }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    return sendOk(res, 201, rowToAsset(created), { asset: rowToAsset(created) }), true;
  }

  const assetIdMatch = String(pathname || '').match(/^\/api\/assets\/(\d+)\/?$/);
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

  if (pathname === '/api/assets/blob-upload' && requestMethod === 'POST') {
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
    const categories = (Array.isArray(result.data) ? result.data : []).map(rowToAssetCategory);
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

    const result = await createAssetCategory({ assetType, category }, scope);
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
  if (pathname === '/api/assets/video/search' && requestMethod === 'GET') {
    const urlObj = new URL(req.url, 'http://localhost');
    const query = String(urlObj.searchParams.get('q') || '').toLowerCase().trim();
    const topic = String(urlObj.searchParams.get('topic') || '').toLowerCase().trim();
    const tagsSearch = String(urlObj.searchParams.get('tags') || '').toLowerCase().trim();
    
    // Using listYoutubeVideos which synthesizes all aggregated mined data!
    let vidsRes = await listYoutubeVideos(400); 
    if (!vidsRes.ok) return sendErr(res, vidsRes.status || 500, vidsRes.error), true;
    
    let filtered = Array.isArray(vidsRes.data) ? vidsRes.data : [];

    try {
      const curTable = tableConfig().assetsVideoCuration;
      if (curTable) {
        const curRes = await sbQuery({ method: 'GET', table: curTable, limit: 2000, query: 'select=*,order=created_at.asc' });
        if (curRes && Array.isArray(curRes.data)) {
          const map = new Map();
          curRes.data.forEach(r => map.set(r.video_id, r));
          filtered.forEach(v => {
            const match = map.get(v.video_id);
            if (match) {
              v.score = match.score;
              v.positive_feedback = match.positive_feedback;
              v.negative_feedback = match.negative_feedback;
              v.visuals_liked = match.visuals_liked;
              v.specific_clips = match.specific_clips;
              // If it already had a curated topic, overwrite it so they see it
              if (match.topic) v.topic = match.topic;
            }
          });
        }
      }
    } catch (err) {
      console.warn('Failed blending curated states into search feed:', err);
    }
    
    if (query) {
      filtered = filtered.filter(v => 
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
        const vTags = String(v.tags || '').toLowerCase();
        const vHash = String(v.hashtags || '').toLowerCase();
        return tgArr.some(t => vTags.includes(t) || vHash.includes(t));
      });
    }
    
    if (!query && !tagsSearch) {
      filtered = filtered.filter(v => !v.score || v.score === 0);
    }

    // Heuristic Sorting: In the future, this intersects with assets_video_curation scores.
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
      headers: { Prefer: 'return=representation' }
    });

    if (!insRes.ok) return sendErr(res, insRes.status || 500, insRes.error), true;
    
    return sendOk(res, 201, Array.isArray(insRes.data) ? insRes.data[0] : insRes.data), true;
  }

  return false;
}

const manifest = {
  id: 'assets',
  label: 'Assets',
  prefixes: ['/api/assets', '/api/asset-categories'],
};

module.exports = { handle, manifest };
