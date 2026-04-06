'use strict';

const { sbQuery, tableConfig } = require('../supabase');

function videosTable() { return tableConfig().harvestYoutubeVideos; }
function detailsTable() { return tableConfig().harvestYoutubeDetails; }
function commentsTable() { return tableConfig().harvestYoutubeComments; }

function safeText(value) {
  return String(value || '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeVideoUrl(value) {
  const raw = safeText(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const videoId = extractYoutubeVideoId(raw);
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    return url.toString();
  } catch (_) {
    return raw;
  }
}

function extractYoutubeVideoId(value) {
  const raw = safeText(value);
  if (!raw) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = safeText(url.hostname).toLowerCase();
    if (host.includes('youtu.be')) {
      const shortId = safeText(url.pathname.split('/').filter(Boolean)[0]);
      return /^[A-Za-z0-9_-]{11}$/.test(shortId) ? shortId : '';
    }
    const queryId = safeText(url.searchParams.get('v'));
    if (/^[A-Za-z0-9_-]{11}$/.test(queryId)) return queryId;
    const parts = url.pathname.split('/').filter(Boolean);
    const embedIndex = parts.indexOf('embed');
    if (embedIndex >= 0) {
      const embedId = safeText(parts[embedIndex + 1]);
      return /^[A-Za-z0-9_-]{11}$/.test(embedId) ? embedId : '';
    }
  } catch (_) {
    return '';
  }
  return '';
}

function makeVideoRecordId(videoId, videoUrl) {
  const stableId = safeText(videoId) || extractYoutubeVideoId(videoUrl);
  if (stableId) return `ytvideo_${stableId}`;
  const url = normalizeVideoUrl(videoUrl);
  if (!url) return '';
  return `ytvideo_url_${Buffer.from(url).toString('base64url').slice(0, 48)}`;
}

function getVideoMergeKey(record) {
  const videoUrl = normalizeVideoUrl(record?.video_url);
  if (videoUrl) return `url:${videoUrl.toLowerCase()}`;
  const videoId = firstNonEmpty(record?.video_id, extractYoutubeVideoId(record?.video_url));
  if (videoId) return `id:${videoId}`;
  return `record:${safeText(record?.video_record_id)}`;
}

function isMissingTableError(result) {
  if (!result || result.ok) return false;
  const text = `${safeText(result.error)} ${JSON.stringify(result.raw || {})}`;
  return /relation .* does not exist/i.test(text) || /could not find the table/i.test(text);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return '';
}

function toIso(value) {
  const raw = safeText(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function isoSortDesc(left, right) {
  return safeText(right).localeCompare(safeText(left));
}

function inferChannelUrl(row) {
  const result = row?.result_json || {};
  const owner = result?.channel_owner || {};
  const profileUrl = safeText(owner.profile_url);
  const channelId = safeText(owner.channel_id);
  const name = firstNonEmpty(owner.name, row?.channel_name);
  if (profileUrl) return profileUrl;
  if (channelId) return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
  if (name) return `https://www.youtube.com/results?search_query=${encodeURIComponent(name)}`;
  return '';
}

function inferThumbnailUrl(result) {
  const video = result?.video || {};
  if (safeText(video.thumbnail_url)) return safeText(video.thumbnail_url);
  const thumbs = video.thumbnails || {};
  return firstNonEmpty(
    thumbs.maxres?.url,
    thumbs.standard?.url,
    thumbs.high?.url,
    thumbs.medium?.url,
    thumbs.default?.url
  );
}

function inferHashtags(result) {
  const video = result?.video || {};
  const hashtags = toArray(video.hashtags)
    .map((item) => safeText(item))
    .filter(Boolean)
    .map((item) => (item.startsWith('#') ? item : `#${item}`));
  return hashtags.join(' ');
}

function makeBaseRecord(patch) {
  const videoUrl = normalizeVideoUrl(patch.video_url);
  const videoId = firstNonEmpty(patch.video_id, extractYoutubeVideoId(videoUrl));
  const createdAt = toIso(patch.created_at) || new Date().toISOString();
  const updatedAt = toIso(patch.updated_at) || createdAt;
  return {
    video_record_id: makeVideoRecordId(videoId, videoUrl),
    video_url: videoUrl,
    video_id: videoId,
    title: safeText(patch.title),
    channel_name: safeText(patch.channel_name),
    channel_url: safeText(patch.channel_url),
    description: safeText(patch.description),
    hashtags: safeText(patch.hashtags),
    category: safeText(patch.category),
    tags: safeText(patch.tags),
    thumbnail_url: safeText(patch.thumbnail_url),
    transcript_status: safeText(patch.transcript_status) || 'unavailable',
    transcript_source: safeText(patch.transcript_source) || 'none',
    transcript_provider: safeText(patch.transcript_provider) || 'youtube-native',
    detail_run_id: safeText(patch.detail_run_id),
    comment_run_id: safeText(patch.comment_run_id),
    miner_run_id: safeText(patch.miner_run_id),
    research_run_id: safeText(patch.research_run_id),
    comment_count: Number(patch.comment_count || 0) || 0,
    created_at: createdAt,
    updated_at: updatedAt,
    repository_run_id: safeText(patch.repository_run_id) || makeVideoRecordId(videoId, videoUrl),
    has_details: Boolean(patch.has_details || patch.detail_run_id),
  };
}

function mergeRecord(existing, patch) {
  if (!existing) return makeBaseRecord(patch);
  const createdAt = toIso(patch.created_at);
  const updatedAt = toIso(patch.updated_at);
  const patchHasData = {
    title: safeText(patch.title),
    channel_name: safeText(patch.channel_name),
    channel_url: safeText(patch.channel_url),
    description: safeText(patch.description),
    hashtags: safeText(patch.hashtags),
    category: safeText(patch.category),
    tags: safeText(patch.tags),
    thumbnail_url: safeText(patch.thumbnail_url),
    transcript_status: safeText(patch.transcript_status),
    transcript_source: safeText(patch.transcript_source),
    transcript_provider: safeText(patch.transcript_provider),
  };
  return {
    ...existing,
    video_record_id: existing.video_record_id || makeVideoRecordId(patch.video_id, patch.video_url),
    repository_run_id: existing.repository_run_id || safeText(patch.repository_run_id) || existing.video_record_id,
    video_url: firstNonEmpty(existing.video_url, patch.video_url),
    video_id: firstNonEmpty(existing.video_id, patch.video_id, extractYoutubeVideoId(existing.video_url || patch.video_url)),
    title: firstNonEmpty(existing.title, patchHasData.title),
    channel_name: firstNonEmpty(existing.channel_name, patchHasData.channel_name),
    channel_url: firstNonEmpty(existing.channel_url, patchHasData.channel_url),
    description: firstNonEmpty(existing.description, patchHasData.description),
    hashtags: firstNonEmpty(existing.hashtags, patchHasData.hashtags),
    category: firstNonEmpty(existing.category, patchHasData.category),
    tags: firstNonEmpty(existing.tags, patchHasData.tags),
    thumbnail_url: firstNonEmpty(existing.thumbnail_url, patchHasData.thumbnail_url),
    transcript_status: firstNonEmpty(existing.transcript_status, patchHasData.transcript_status) || 'unavailable',
    transcript_source: firstNonEmpty(existing.transcript_source, patchHasData.transcript_source) || 'none',
    transcript_provider: firstNonEmpty(existing.transcript_provider, patchHasData.transcript_provider) || 'youtube-native',
    detail_run_id: firstNonEmpty(existing.detail_run_id, patch.detail_run_id),
    comment_run_id: firstNonEmpty(existing.comment_run_id, patch.comment_run_id),
    miner_run_id: firstNonEmpty(existing.miner_run_id, patch.miner_run_id),
    research_run_id: firstNonEmpty(existing.research_run_id, patch.research_run_id),
    comment_count: Math.max(Number(existing.comment_count || 0) || 0, Number(patch.comment_count || 0) || 0),
    created_at: firstNonEmpty(existing.created_at, createdAt, patch.created_at),
    updated_at: firstNonEmpty(updatedAt, existing.updated_at, patch.updated_at, existing.created_at),
    has_details: Boolean(existing.has_details || patch.has_details || existing.detail_run_id || patch.detail_run_id),
  };
}

function patchFromDetailRun(row) {
  const result = row?.result_json || {};
  const video = result?.video || {};
  return makeBaseRecord({
    repository_run_id: row?.run_id,
    detail_run_id: row?.run_id,
    has_details: true,
    video_url: firstNonEmpty(row?.video_url, video.url),
    video_id: firstNonEmpty(row?.video_id, video.id),
    title: firstNonEmpty(row?.title, video.title),
    channel_name: firstNonEmpty(row?.channel_name, result?.channel_owner?.name),
    channel_url: inferChannelUrl(row),
    description: firstNonEmpty(video.description, result?.description),
    hashtags: firstNonEmpty(row?.tags, inferHashtags(result)),
    category: row?.category,
    tags: row?.tags,
    thumbnail_url: inferThumbnailUrl(result),
    transcript_status: firstNonEmpty(row?.transcript_status, video.transcript_status),
    transcript_source: firstNonEmpty(row?.transcript_source, video.transcript_source),
    transcript_provider: firstNonEmpty(row?.transcript_provider, video.transcript_provider),
    created_at: row?.created_at,
    updated_at: row?.updated_at,
  });
}

function patchFromCommentRun(row) {
  const result = row?.result_json || {};
  return makeBaseRecord({
    repository_run_id: row?.run_id,
    comment_run_id: row?.run_id,
    video_url: firstNonEmpty(row?.video_url, result?.video_url),
    video_id: firstNonEmpty(row?.video_id, result?.video_id),
    title: firstNonEmpty(row?.title, result?.title),
    channel_name: firstNonEmpty(row?.channel_name, result?.channel_name),
    comment_count: Number(row?.comment_count || result?.stats?.total_comments || 0) || 0,
    created_at: row?.created_at,
    updated_at: row?.updated_at,
  });
}

function patchesFromMinerRun(row) {
  const result = row?.result_json || {};
  const comments = toArray(result?.comments);
  const grouped = new Map();
  comments.forEach((item) => {
    const videoUrl = normalizeVideoUrl(item?.video_url);
    const videoId = firstNonEmpty(item?.video_id, extractYoutubeVideoId(videoUrl));
    const key = makeVideoRecordId(videoId, videoUrl);
    if (!key) return;
    if (!grouped.has(key)) {
      grouped.set(key, {
        repository_run_id: `${safeText(row?.run_id)}:${videoUrl}`,
        miner_run_id: safeText(row?.run_id),
        research_run_id: safeText(row?.run_id).startsWith('ytresearch_') ? safeText(row?.run_id) : '',
        video_url: videoUrl,
        video_id: videoId,
        title: firstNonEmpty(item?.video_title, item?.title),
        channel_name: firstNonEmpty(item?.channel_name, item?.author_channel),
        comment_count: 0,
        created_at: row?.created_at,
        updated_at: row?.updated_at,
      });
    }
    grouped.get(key).comment_count += 1;
  });
  return Array.from(grouped.values()).map((item) => makeBaseRecord(item));
}

async function readStoredYoutubeVideos(limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const res = await sbQuery({
    method: 'GET',
    table: videosTable(),
    query: `select=*&order=updated_at.desc&limit=${safeLimit}`,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: toArray(res.data).map((row) => makeBaseRecord(row)),
  };
}

async function readYoutubeDetailsRows(limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 400, 2000));
  return sbQuery({
    method: 'GET',
    table: detailsTable(),
    query: `select=run_id,video_url,video_id,category,tags,title,channel_name,transcript_status,transcript_source,transcript_provider,result_json,created_at,updated_at&order=created_at.desc&limit=${safeLimit}`,
  });
}

async function readYoutubeCommentRows(limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 400, 2000));
  return sbQuery({
    method: 'GET',
    table: commentsTable(),
    query: `select=run_id,video_url,video_id,title,channel_name,comment_count,result_json,created_at,updated_at&order=created_at.desc&limit=${safeLimit}`,
  });
}

async function readYoutubeMinerRows(limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 120, 600));
  return sbQuery({
    method: 'GET',
    table: commentsTable(),
    query: `or=(run_id.like.ytminer_*,run_id.like.ytresearch_*)&select=run_id,result_json,created_at,updated_at&order=created_at.desc&limit=${safeLimit}`,
  });
}

async function synthesizeYoutubeVideos(limit = 200) {
  const sourceLimit = Math.max(Number(limit) * 4, 200);
  const [detailsRes, commentsRes, minerRes] = await Promise.all([
    readYoutubeDetailsRows(sourceLimit),
    readYoutubeCommentRows(sourceLimit),
    readYoutubeMinerRows(Math.max(Number(limit) * 2, 60)),
  ]);
  if (!detailsRes.ok && !commentsRes.ok && !minerRes.ok) {
    return detailsRes;
  }

  const rows = new Map();
  const patches = [];
  toArray(detailsRes.data).forEach((row) => patches.push(patchFromDetailRun(row)));
  toArray(commentsRes.data)
    .filter((row) => {
      const runId = safeText(row?.run_id).toLowerCase();
      return !runId.startsWith('ytminer_') && !runId.startsWith('ytresearch_');
    })
    .forEach((row) => patches.push(patchFromCommentRun(row)));
  toArray(minerRes.data).forEach((row) => {
    patches.push(...patchesFromMinerRun(row));
  });

  patches
    .filter((row) => safeText(row.video_record_id) && safeText(row.video_url))
    .sort((left, right) => isoSortDesc(left.updated_at || left.created_at, right.updated_at || right.created_at))
    .forEach((patch) => {
      const key = getVideoMergeKey(patch);
      rows.set(key, mergeRecord(rows.get(key), patch));
    });

  return {
    ok: true,
    status: 200,
    data: Array.from(rows.values())
      .sort((left, right) => isoSortDesc(left.updated_at || left.created_at, right.updated_at || right.created_at))
      .slice(0, Math.max(1, Math.min(Number(limit) || 200, 1000))),
  };
}

function toStoredRow(record) {
  return {
    video_record_id: safeText(record.video_record_id),
    video_url: safeText(record.video_url),
    video_id: safeText(record.video_id),
    title: safeText(record.title),
    channel_name: safeText(record.channel_name),
    channel_url: safeText(record.channel_url),
    description: safeText(record.description),
    hashtags: safeText(record.hashtags),
    category: safeText(record.category),
    tags: safeText(record.tags),
    thumbnail_url: safeText(record.thumbnail_url),
    transcript_status: safeText(record.transcript_status) || 'unavailable',
    transcript_source: safeText(record.transcript_source) || 'none',
    transcript_provider: safeText(record.transcript_provider) || 'youtube-native',
    detail_run_id: safeText(record.detail_run_id),
    comment_run_id: safeText(record.comment_run_id),
    miner_run_id: safeText(record.miner_run_id),
    research_run_id: safeText(record.research_run_id),
    comment_count: Number(record.comment_count || 0) || 0,
    created_at: toIso(record.created_at) || new Date().toISOString(),
    updated_at: toIso(record.updated_at) || new Date().toISOString(),
  };
}

async function upsertStoredYoutubeVideo(record) {
  const row = toStoredRow(record);
  if (!row.video_record_id || !row.video_url) {
    return { ok: false, status: 400, error: 'video record is incomplete' };
  }
  return sbQuery({
    method: 'POST',
    table: videosTable(),
    query: 'on_conflict=video_record_id&select=*',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: [row],
  });
}

async function trySyncRecords(records) {
  const rows = toArray(records).filter((record) => safeText(record?.video_record_id) && safeText(record?.video_url));
  if (!rows.length) return { ok: true, status: 200, data: [] };
  const res = await sbQuery({
    method: 'POST',
    table: videosTable(),
    query: 'on_conflict=video_record_id&select=*',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: rows.map(toStoredRow),
  });
  if (isMissingTableError(res)) {
    return { ok: true, status: 200, data: [] };
  }
  return res;
}

async function listYoutubeVideos(limit = 200) {
  const storedRes = await readStoredYoutubeVideos(limit);
  if (!storedRes.ok && !isMissingTableError(storedRes)) return storedRes;
  const synthesizedRes = await synthesizeYoutubeVideos(limit);
  if (!synthesizedRes.ok) {
    if (storedRes.ok) return storedRes;
    return synthesizedRes;
  }

  const map = new Map();
  synthesizedRes.data.forEach((row) => {
    map.set(getVideoMergeKey(row), row);
  });
  if (storedRes.ok) {
    storedRes.data.forEach((row) => {
      const key = getVideoMergeKey(row);
      map.set(key, mergeRecord(map.get(key), row));
    });
  } else {
    await trySyncRecords(synthesizedRes.data);
  }

  return {
    ok: true,
    status: 200,
    data: Array.from(map.values())
      .sort((left, right) => isoSortDesc(left.updated_at || left.created_at, right.updated_at || right.created_at))
      .slice(0, Math.max(1, Math.min(Number(limit) || 200, 1000))),
  };
}

async function getYoutubeVideo(videoRecordId) {
  const id = safeText(videoRecordId);
  if (!id) return { ok: false, status: 400, error: 'video_record_id is required' };
  const listRes = await listYoutubeVideos(1000);
  if (!listRes.ok) return listRes;
  const row = toArray(listRes.data).find((item) => safeText(item.video_record_id) === id) || null;
  if (!row) return { ok: false, status: 404, error: 'Video not found' };
  return { ok: true, status: 200, data: row };
}

async function updateYoutubeVideo(videoRecordId, patch) {
  const id = safeText(videoRecordId);
  if (!id) return { ok: false, status: 400, error: 'video_record_id is required' };
  const existingRes = await getYoutubeVideo(id);
  if (!existingRes.ok) return existingRes;
  const merged = mergeRecord(existingRes.data, {
    ...patch,
    video_record_id: id,
    updated_at: new Date().toISOString(),
  });

  const storedRes = await upsertStoredYoutubeVideo(merged);
  if (isMissingTableError(storedRes)) {
    return { ok: true, status: 200, data: merged };
  }
  if (!storedRes.ok) return storedRes;
  const saved = toArray(storedRes.data)[0] || merged;
  return { ok: true, status: 200, data: makeBaseRecord(saved) };
}

async function deleteYoutubeVideo(videoRecordId) {
  const id = safeText(videoRecordId);
  if (!id) return { ok: false, status: 400, error: 'video_record_id is required' };
  const res = await sbQuery({
    method: 'DELETE',
    table: videosTable(),
    query: `video_record_id=eq.${encodeURIComponent(id)}`,
    headers: { Prefer: 'return=representation' },
  });
  if (isMissingTableError(res)) {
    return { ok: true, status: 200, data: { deleted: false, video_record_id: id, storage_missing: true } };
  }
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) && res.data.length > 0;
  if (!deleted) return { ok: false, status: 404, error: 'Video not found' };
  return { ok: true, status: 200, data: { deleted: true, video_record_id: id } };
}

async function upsertYoutubeVideoFromDetailRun(row) {
  return trySyncRecords([patchFromDetailRun(row)]);
}

async function upsertYoutubeVideoFromCommentRun(row) {
  return trySyncRecords([patchFromCommentRun(row)]);
}

async function upsertYoutubeVideosFromMinerRun(row) {
  return trySyncRecords(patchesFromMinerRun(row));
}

module.exports = {
  listYoutubeVideos,
  getYoutubeVideo,
  updateYoutubeVideo,
  deleteYoutubeVideo,
  upsertYoutubeVideoFromDetailRun,
  upsertYoutubeVideoFromCommentRun,
  upsertYoutubeVideosFromMinerRun,
  makeVideoRecordId,
};
