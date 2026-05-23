'use strict';

const { extractDriveFileIdFromUrl, getDriveFileMetadataById } = require('./googleDrive');

function safeText(value) {
  return String(value || '').trim();
}

function isPublicHttpsUrl(value) {
  const text = safeText(value);
  if (!text) return false;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:') return false;
    const host = String(parsed.hostname || '').toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function isDriveViewerPageUrl(value) {
  const text = safeText(value);
  if (!text) return false;
  return /drive\.google\.com\/file\/d\//i.test(text)
    || (/drive\.google\.com\/open\?/i.test(text) && !/export=/i.test(text));
}

function isProbablyDirectMediaUrl(value) {
  const text = safeText(value);
  if (!isPublicHttpsUrl(text)) return false;
  if (isDriveViewerPageUrl(text)) return false;
  return true;
}

function extractDriveFileIdFromLocation(value) {
  const text = safeText(value);
  if (!text) return '';
  const proxy = text.match(/\/api\/assets\/drive-file\/([a-zA-Z0-9_-]+)/);
  if (proxy) return proxy[1];
  const fromUrl = extractDriveFileIdFromUrl(text);
  return fromUrl ? String(fromUrl) : '';
}

function buildPublicDriveDownloadUrl(fileId) {
  const id = safeText(fileId);
  if (!id) return '';
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}

function configuredPublicOrigin(req) {
  const configured = safeText(process.env.PUBLIC_APP_ORIGIN || process.env.APP_PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL);
  if (configured) return configured.replace(/\/+$/, '');
  const vercel = safeText(process.env.VERCEL_URL);
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  const origin = safeText(req?.headers?.origin || req?.headers?.['x-forwarded-host']);
  if (origin && !/^localhost/i.test(origin) && !/^127\./.test(origin)) {
    const proto = safeText(req?.headers?.['x-forwarded-proto']) || 'https';
    if (origin.includes('://')) return origin.replace(/\/+$/, '');
    return `${proto}://${origin.replace(/\/+$/, '')}`;
  }
  return '';
}

function originIsBufferReachable(origin) {
  const text = safeText(origin);
  if (!text) return false;
  try {
    const parsed = new URL(text);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1') return false;
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resolve a URL Buffer (or Meta) can fetch for an asset row.
 * Prefers direct HTTPS media (blob, webContentLink, Drive download) over viewer pages.
 */
async function resolveAssetPublicMediaUrl(asset, options = {}) {
  const assetId = safeText(options.assetId || asset?.id);
  const location = safeText(asset?.location);
  const diagnostics = {
    assetId,
    locationKind: '',
    driveFileId: '',
    used: '',
    warnings: [],
  };

  if (isProbablyDirectMediaUrl(location)) {
    diagnostics.locationKind = 'direct_https';
    diagnostics.used = 'asset.location';
    return { ok: true, url: location, diagnostics };
  }

  if (isDriveViewerPageUrl(location)) {
    diagnostics.locationKind = 'drive_viewer';
    diagnostics.warnings.push('Asset location is a Google Drive viewer page, not a direct media URL.');
  } else if (location && !isPublicHttpsUrl(location)) {
    diagnostics.locationKind = 'non_public';
    if (location.startsWith('/api/assets/')) {
      diagnostics.locationKind = 'app_proxy_path';
    }
  }

  const driveFileId = extractDriveFileIdFromLocation(location);
  diagnostics.driveFileId = driveFileId;

  if (driveFileId) {
    try {
      const meta = await getDriveFileMetadataById(driveFileId);
      if (meta.ok) {
        const contentLink = safeText(meta.data?.webContentLink);
        if (isProbablyDirectMediaUrl(contentLink)) {
          diagnostics.used = 'drive.webContentLink';
          return { ok: true, url: contentLink, diagnostics };
        }
      }
    } catch {
      diagnostics.warnings.push('Could not read Google Drive metadata for direct download link.');
    }

    const downloadUrl = buildPublicDriveDownloadUrl(driveFileId);
    diagnostics.used = 'drive.uc_download';
    diagnostics.warnings.push(
      'Using Google Drive direct download URL. The file must be shared as “Anyone with the link” for Buffer to fetch it.'
    );
    return { ok: true, url: downloadUrl, diagnostics };
  }

  if (location && isDriveViewerPageUrl(location)) {
    diagnostics.warnings.push(
      'Video is stored as a Google Drive viewer link. Ensure the file is shared as “Anyone with the link” (re-upload with public sharing if needed).'
    );
  } else if (!location) {
    diagnostics.warnings.push('Asset has no location URL.');
  } else if (location) {
    diagnostics.warnings.push(`Asset location is not a public direct media URL: ${location.slice(0, 120)}`);
  }

  return { ok: false, url: '', diagnostics };
}

module.exports = {
  safeText,
  isPublicHttpsUrl,
  isProbablyDirectMediaUrl,
  isDriveViewerPageUrl,
  extractDriveFileIdFromLocation,
  buildPublicDriveDownloadUrl,
  configuredPublicOrigin,
  originIsBufferReachable,
  resolveAssetPublicMediaUrl,
};
