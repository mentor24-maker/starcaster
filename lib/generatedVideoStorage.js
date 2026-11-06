'use strict';

/**
 * Where a finished AI-generated video goes: to file storage (Vercel Blob),
 * and only its ADDRESS goes into the assets table.
 *
 * Until 2026-11-06 the finished video was written into `assets.location` as
 * base64 JSON — about 30 MB per 10-second clip — and twelve of them made up
 * 93 MB of the 97 MB table. One read that touched them restarted the
 * production database. This module is the one place a generated video is
 * stored, so the route never handles the bytes-versus-address choice itself.
 */

const blobStorage = require('./blobStorage');

const GENERATED_VIDEO_FOLDER = 'APP/Assets/Video/Generated';

function safeName(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

/**
 * @param {object} args
 * @param {string} args.videoBase64  the finished clip, base64 (what the generator hands back)
 * @param {number} args.assetId      the asset row this clip completes
 * @param {string} [args.assetName]  used only to make the file name readable
 * @param {Function} [args.upload]   injected for tests; defaults to blobStorage.uploadBufferToBlobAtPath
 * @returns {Promise<{ok: true, location: string, size: number} | {ok: false, error: string}>}
 */
async function storeGeneratedVideo({ videoBase64, assetId, assetName, upload } = {}) {
  const base64 = String(videoBase64 || '').trim();
  if (!base64) {
    return { ok: false, error: 'the generator reported the video finished but returned no video file' };
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    return { ok: false, error: 'the generator returned an empty video file' };
  }

  const uploader = upload || blobStorage.uploadBufferToBlobAtPath;
  // The same folder the twelve hand-moved videos went to on 2026-11-06, so
  // every generated clip lives in one place. The timestamp keeps a re-run of
  // one asset from replacing an earlier file.
  const pathname = `${GENERATED_VIDEO_FOLDER}/${Date.now()}_${Number(assetId) || 0}_${safeName(assetName) || 'generated'}.mp4`;
  let res;
  try {
    res = await uploader({ pathname, mimeType: 'video/mp4', fileBuffer: buffer });
  } catch (err) {
    return { ok: false, error: `saving the video to file storage failed: ${err.message || err}` };
  }
  if (!res || !res.ok) {
    return { ok: false, error: `saving the video to file storage failed: ${(res && res.error) || 'no response'}` };
  }
  const location = String((res.data && res.data.location) || '').trim();
  if (!/^https?:\/\//i.test(location)) {
    return { ok: false, error: 'file storage accepted the video but returned no address for it' };
  }
  return { ok: true, location, size: buffer.length };
}

module.exports = { storeGeneratedVideo, GENERATED_VIDEO_FOLDER };
