'use strict';

const fs = require('fs');
const path = require('path');
const { sendOk, sendErr } = require('./http');

const COMMUNITY_ASSETS_PATH = '/api/community-assets';
const COMMUNITY_ASSETS_DIR = path.join(__dirname, '..', 'public', 'images', 'community_assets');
const PUBLIC_PREFIX = '/images/community_assets';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.ogg']);

function titleFromFileName(fileName) {
  const stem = String(fileName || '').replace(/\.[^.]+$/, '');
  return stem
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function walkCommunityAssets(dir, relativeDir = '') {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;

    if (entry.isDirectory()) {
      items.push(...walkCommunityAssets(fullPath, relativePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    const isImage = IMAGE_EXTENSIONS.has(extension);
    const isVideo = VIDEO_EXTENSIONS.has(extension);

    if (!isImage && !isVideo) {
      continue;
    }

    const category = relativeDir.split('/').filter(Boolean).join(' / ') || 'community_assets';
    const stat = fs.statSync(fullPath);

    items.push({
      assetName: titleFromFileName(entry.name),
      assetType: isImage ? 'Image' : 'Video',
      category,
      location: `${PUBLIC_PREFIX}/${relativePath}`,
      createdAt: stat.mtime.toISOString()
    });
  }

  return items;
}

async function handle(req, res, pathname, method) {
  const normalizedPath = String(pathname || '').replace(/\/+$/, '') || '/';
  if (normalizedPath !== COMMUNITY_ASSETS_PATH) {
    return false;
  }

  if (String(method || '').toUpperCase() !== 'GET') {
    return sendErr(res, 405, 'Method not allowed', { code: 'METHOD_NOT_ALLOWED' }), true;
  }

  const assets = walkCommunityAssets(COMMUNITY_ASSETS_DIR).sort((a, b) =>
    String(a.category || '').localeCompare(String(b.category || '')) || String(a.assetName || '').localeCompare(String(b.assetName || ''))
  );

  return sendOk(res, 200, { assets, total: assets.length }, { assets, total: assets.length }), true;
}

module.exports = {
  handle,
  manifest: {
    id: 'communityAssets',
    label: 'Community Assets',
    prefixes: [COMMUNITY_ASSETS_PATH],
  },
};
