'use strict';

const { getAssetById, rowToAsset } = require('./assetsStore');
const { fetchDriveFileMedia } = require('./googleDrive');
const { uploadVideoToBuffer } = require('./bufferClient');
const {
  extractDriveFileIdFromLocation,
  resolveAssetPublicMediaUrl,
  safeText,
} = require('./assetPublicMediaUrl');

function isYoutubeLocation(value) {
  const text = safeText(value).toLowerCase();
  return text.includes('youtube.com/') || text.includes('youtu.be/');
}

function guessVideoFileName(asset, mimeType) {
  const fromName = safeText(asset?.assetName);
  if (fromName) {
    if (/\.(mp4|mov|webm|m4v)$/i.test(fromName)) return fromName;
    return `${fromName.replace(/\.[^.]+$/, '')}.mp4`;
  }
  return 'starcaster-video.mp4';
}

function normalizeVideoMimeType(contentType, fileName) {
  const ct = safeText(contentType).split(';')[0].trim().toLowerCase();
  if (ct.startsWith('video/')) return ct;
  const name = safeText(fileName).toLowerCase();
  if (name.endsWith('.mov')) return 'video/quicktime';
  if (name.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

async function loadVideoBytesForAsset(asset) {
  const location = safeText(asset?.location);
  if (!location) {
    return { ok: false, status: 400, error: 'Video asset has no storage location.' };
  }
  if (isYoutubeLocation(location)) {
    return {
      ok: false,
      status: 400,
      error: 'Primary Video is a YouTube reference, not an uploadable MP4. Add the video file under Assets (Google Drive or file upload), then select it on the campaign.',
    };
  }

  const driveFileId = extractDriveFileIdFromLocation(location);
  if (driveFileId) {
    const media = await fetchDriveFileMedia(driveFileId);
    if (!media.ok) {
      return {
        ok: false,
        status: media.status || 500,
        error: media.error || 'Could not download video from Google Drive.',
      };
    }
    const fileName = guessVideoFileName(asset, media.data?.contentType);
    const mimeType = normalizeVideoMimeType(media.data?.contentType, fileName);
    return {
      ok: true,
      data: {
        buffer: media.data.buffer,
        fileName,
        mimeType,
        source: 'google_drive',
        driveFileId,
      },
    };
  }

  if (/^https?:\/\//i.test(location)) {
    try {
      const res = await fetch(location, { signal: AbortSignal.timeout(180000), redirect: 'follow' });
      if (!res.ok) {
        return {
          ok: false,
          status: res.status || 502,
          error: `Could not fetch video URL (${res.status}).`,
        };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const fileName = guessVideoFileName(asset, res.headers.get('content-type'));
      const mimeType = normalizeVideoMimeType(res.headers.get('content-type'), fileName);
      return {
        ok: true,
        data: {
          buffer: buf,
          fileName,
          mimeType,
          source: 'https_url',
        },
      };
    } catch (err) {
      return {
        ok: false,
        status: 502,
        error: `Could not fetch video URL: ${safeText(err?.message) || 'request failed'}`,
      };
    }
  }

  return {
    ok: false,
    status: 400,
    error: 'Video asset location is not a supported Drive file or public HTTPS URL.',
  };
}

async function stageCampaignVideoForBuffer(primaryVideoId, scope, req, creds) {
  const assetId = safeText(primaryVideoId);
  if (!assetId) {
    return { ok: false, status: 400, error: 'primaryVideoId is required' };
  }

  const assetRes = await getAssetById(assetId, scope);
  if (!assetRes.ok) {
    return { ok: false, status: assetRes.status || 404, error: assetRes.error || 'Video asset not found' };
  }
  const assetRow = Array.isArray(assetRes.data) ? assetRes.data[0] : assetRes.data;
  const asset = rowToAsset(assetRow);

  const publicUrl = await resolveAssetPublicMediaUrl(asset, { assetId, req });
  const loaded = await loadVideoBytesForAsset(asset);
  if (!loaded.ok) {
    return {
      ok: false,
      status: loaded.status || 400,
      error: loaded.error,
      data: {
        primaryVideoId: assetId,
        publicUrl: publicUrl.ok ? publicUrl.url : '',
        publicUrlDiagnostics: publicUrl.diagnostics || null,
      },
    };
  }

  const upload = await uploadVideoToBuffer(loaded.data.buffer, {
    fileName: loaded.data.fileName,
    mimeType: loaded.data.mimeType,
  }, creds);

  if (!upload.ok) {
    return {
      ok: false,
      status: upload.status || 502,
      error: upload.error,
      data: {
        primaryVideoId: assetId,
        bytesLoaded: loaded.data.buffer.length,
        source: loaded.data.source,
        publicUrl: publicUrl.ok ? publicUrl.url : '',
      },
    };
  }

  return {
    ok: true,
    status: upload.status,
    url: safeText(upload.data?.location),
    data: {
      primaryVideoId: assetId,
      stagedUrl: safeText(upload.data?.location),
      bytesLoaded: loaded.data.buffer.length,
      source: loaded.data.source,
      fileName: loaded.data.fileName,
      mimeType: loaded.data.mimeType,
      publicUrl: publicUrl.ok ? publicUrl.url : '',
      uploadEndpoint: upload.endpoint,
    },
  };
}

module.exports = {
  stageCampaignVideoForBuffer,
  loadVideoBytesForAsset,
};
