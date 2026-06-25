'use strict';

const { fetchFromSourceUrl } = require('./assetImageBytes');

const DEFAULT_FAVICON_PATH = '/images/favicon_alphire_512x512.png';

function safeText(value) {
  return String(value || '').trim();
}

function getProjectFaviconUrl(project) {
  return safeText(project?.faviconDataUrl || project?.favicon_data_url);
}

function isPublicHttpUrl(value) {
  const text = safeText(value);
  if (!text) return false;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function faviconVersionKey(project) {
  const id = safeText(project?.id);
  const url = getProjectFaviconUrl(project);
  if (!id || !url) return '';
  return `${id}_${url.length}_${url.slice(-32)}`;
}

function buildPublicFaviconHref(project) {
  const version = encodeURIComponent(faviconVersionKey(project));
  const projectId = encodeURIComponent(safeText(project?.id));
  if (!version || !projectId) return DEFAULT_FAVICON_PATH;
  return `/api/public/favicon?projectId=${projectId}&v=${version}`;
}

function buildAdminFaviconHref(project) {
  const projectId = safeText(project?.id);
  const version = encodeURIComponent(faviconVersionKey(project));
  if (!projectId || !version) return DEFAULT_FAVICON_PATH;
  return `/api/projects/active/favicon?project=${encodeURIComponent(projectId)}&v=${version}`;
}

function buildFaviconHeadTags(project) {
  const href = buildPublicFaviconHref(project);
  return [
    `<link rel="icon" href="${href}" />`,
    `<link rel="shortcut icon" href="${href}" />`,
    `<link rel="apple-touch-icon" href="${href}" />`,
  ].join('\n  ');
}

function redirectFavicon(res, location, cacheControl) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': cacheControl || 'public, max-age=300, stale-while-revalidate=3600',
  });
  res.end();
}

async function writeProjectFaviconResponse(res, project, options = {}) {
  const cacheControl = options.cacheControl || 'public, max-age=3600, stale-while-revalidate=86400';
  const faviconUrl = getProjectFaviconUrl(project);
  if (!faviconUrl) {
    redirectFavicon(res, DEFAULT_FAVICON_PATH, cacheControl);
    return { ok: true, served: 'default-redirect' };
  }

  if (isPublicHttpUrl(faviconUrl) && !/\/api\/assets\/drive-file\//i.test(faviconUrl)) {
    redirectFavicon(res, faviconUrl, cacheControl);
    return { ok: true, served: 'redirect' };
  }

  const image = await fetchFromSourceUrl(faviconUrl);
  if (!image.ok || !image.data?.buffer) {
    redirectFavicon(res, DEFAULT_FAVICON_PATH, cacheControl);
    return { ok: true, served: 'default-fallback' };
  }

  if (options.headOnly) {
    res.statusCode = 200;
    res.setHeader('Content-Type', image.data.contentType || 'image/png');
    res.setHeader('Cache-Control', cacheControl);
    res.end();
    return { ok: true, served: 'head' };
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', image.data.contentType || 'image/png');
  res.setHeader('Cache-Control', cacheControl);
  res.end(image.data.buffer);
  return { ok: true, served: 'bytes' };
}

module.exports = {
  DEFAULT_FAVICON_PATH,
  getProjectFaviconUrl,
  faviconVersionKey,
  buildPublicFaviconHref,
  buildAdminFaviconHref,
  buildFaviconHeadTags,
  writeProjectFaviconResponse,
};
