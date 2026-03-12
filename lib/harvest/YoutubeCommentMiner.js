'use strict';

const { runYoutubeCommentHarvest } = require('./YoutubeCommentsRun');
const { resolveYoutubeApiKey } = require('./youtubeApiKey');

function safeText(value) {
  return String(value || '').trim();
}

function youtubeApiConfig() {
  const apiKey = resolveYoutubeApiKey();
  return { apiKey };
}

function toArrayTargets(rawTargets) {
  if (Array.isArray(rawTargets)) {
    return rawTargets.map((value) => safeText(value)).filter(Boolean);
  }
  const text = safeText(rawTargets);
  if (!text) return [];
  return text
    .split(/\r?\n|,/g)
    .map((value) => safeText(value))
    .filter(Boolean);
}

function parseYoutubeTarget(rawTarget) {
  const target = safeText(rawTarget);
  if (!target) return { type: 'unknown', raw: '' };

  if (/^[a-zA-Z0-9_-]{11}$/.test(target)) {
    return { type: 'video', videoId: target, canonical: `https://www.youtube.com/watch?v=${target}`, raw: target };
  }
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(target)) {
    return { type: 'channel', channelId: target, raw: target };
  }
  if (/^@[\w.\-]+$/i.test(target)) {
    return { type: 'channel_handle', handle: target.replace(/^@/, ''), raw: target };
  }

  let url = null;
  try {
    const withScheme = /^https?:\/\//i.test(target) ? target : `https://${target}`;
    url = new URL(withScheme);
  } catch {
    return { type: 'unknown', raw: target };
  }

  const host = String(url.hostname || '').toLowerCase();
  const pathParts = String(url.pathname || '')
    .split('/')
    .map((part) => safeText(part))
    .filter(Boolean);

  if (host.includes('youtu.be')) {
    const id = safeText(pathParts[0]);
    if (id) return { type: 'video', videoId: id, canonical: `https://www.youtube.com/watch?v=${id}`, raw: target };
  }

  if (host.includes('youtube.com')) {
    const v = safeText(url.searchParams.get('v'));
    if (v) return { type: 'video', videoId: v, canonical: `https://www.youtube.com/watch?v=${v}`, raw: target };

    const shortsIdx = pathParts.findIndex((part) => part.toLowerCase() === 'shorts');
    if (shortsIdx >= 0 && safeText(pathParts[shortsIdx + 1])) {
      const id = safeText(pathParts[shortsIdx + 1]);
      return { type: 'video', videoId: id, canonical: `https://www.youtube.com/watch?v=${id}`, raw: target };
    }

    const channelIdx = pathParts.findIndex((part) => part.toLowerCase() === 'channel');
    if (channelIdx >= 0 && safeText(pathParts[channelIdx + 1])) {
      return { type: 'channel', channelId: safeText(pathParts[channelIdx + 1]), raw: target };
    }

    if (pathParts[0] && pathParts[0].startsWith('@')) {
      return { type: 'channel_handle', handle: pathParts[0].slice(1), raw: target };
    }
  }

  return { type: 'unknown', raw: target };
}

async function ytFetch(endpoint, params, apiKey, timeoutMs = 15000) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
      'user-agent': 'APH-YoutubeCommentMiner/1.0',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  if (!response.ok) {
    const message = safeText(body?.error?.message || body?.error?.errors?.[0]?.message) || `YouTube API error (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return body;
}

async function resolveChannelIdFromHandle(handle, apiKey) {
  const cleanHandle = safeText(handle).replace(/^@/, '');
  if (!cleanHandle) return '';
  const data = await ytFetch('search', {
    part: 'snippet',
    q: `@${cleanHandle}`,
    type: 'channel',
    maxResults: 1,
  }, apiKey);
  const first = Array.isArray(data?.items) ? data.items[0] : null;
  return safeText(first?.id?.channelId);
}

async function listRecentChannelVideos(channelId, limit, apiKey) {
  const maxResults = Math.max(1, Math.min(Number(limit || 5) || 5, 20));
  const out = [];
  let pageToken = '';

  while (out.length < maxResults) {
    const batchSize = Math.min(50, maxResults - out.length);
    const data = await ytFetch('search', {
      part: 'snippet',
      channelId: safeText(channelId),
      order: 'date',
      type: 'video',
      maxResults: batchSize,
      pageToken: pageToken || undefined,
    }, apiKey);

    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const videoId = safeText(item?.id?.videoId);
      if (!videoId) continue;
      out.push({
        video_id: videoId,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
        title: safeText(item?.snippet?.title),
        channel_name: safeText(item?.snippet?.channelTitle),
      });
      if (out.length >= maxResults) break;
    }

    pageToken = safeText(data?.nextPageToken);
    if (!pageToken) break;
  }

  return out;
}

function parsePhraseList(value) {
  return String(value || '')
    .split(/\r?\n|,/g)
    .map((item) => safeText(item).toLowerCase())
    .filter(Boolean)
    .slice(0, 50);
}

function classifyComment(comment, tuning = {}) {
  const text = safeText(comment?.text).toLowerCase();
  const likeCount = Number(comment?.like_count || 0) || 0;
  const replyCount = Number(comment?.reply_count || 0) || 0;

  const has = (re) => re.test(text);
  const tags = [];
  const why = [];
  let score = 0;
  const includePhrases = Array.isArray(tuning.include_phrases) ? tuning.include_phrases : [];
  const excludePhrases = Array.isArray(tuning.exclude_phrases) ? tuning.exclude_phrases : [];

  if (has(/\?/) || has(/\b(how|what|why|where|when|does|can|should)\b/)) {
    tags.push('question');
    score += 3;
    why.push('question language');
  }
  if (has(/\b(help|stuck|issue|problem|error|failing|broken|cant|can't|struggle)\b/)) {
    tags.push('pain_point');
    score += 4;
    why.push('pain-point signal');
  }
  if (has(/\b(looking for|recommend|anyone know|suggest|best way|how do i)\b/)) {
    tags.push('solution_seeking');
    score += 4;
    why.push('solution-seeking language');
  }
  // Signals for identity shift / openness to change.
  if (has(/\b(want(ing)? more|outgrow(ing)?|ready for (a )?change|new chapter|next level|more to life|stuck in (my )?(life|environment)|bored (with|of)|reinvent(ing)? myself|becom(e|ing) a better version)\b/)) {
    tags.push('growth_openness');
    score += 4;
    why.push('growth-openness language');
  }
  if (has(/\b(buy|price|pricing|cost|worth it|subscribe|trial|plan)\b/)) {
    tags.push('purchase_intent');
    score += 5;
    why.push('purchase-intent language');
  }
  if (has(/\b(love|great|awesome|thanks|helpful|amazing)\b/)) {
    tags.push('positive_signal');
    score += 2;
    why.push('positive sentiment');
  }
  if (has(/\b(spam|scam|fake|bot)\b/)) {
    tags.push('trust_risk');
    score += 2;
    why.push('trust-risk language');
  }
  if (has(/https?:\/\/|www\./)) {
    tags.push('link_out');
    score += 1;
    why.push('external link');
  }
  if (has(/@\w+/)) {
    tags.push('social_handle');
    score += 1;
    why.push('social handle mention');
  }

  includePhrases.forEach((phrase) => {
    if (!phrase) return;
    if (text.includes(phrase)) {
      tags.push('trainer_include');
      score += 3;
      why.push(`trainer include: "${phrase}"`);
    }
  });
  excludePhrases.forEach((phrase) => {
    if (!phrase) return;
    if (text.includes(phrase)) {
      tags.push('trainer_exclude');
      score -= 6;
      why.push(`trainer exclude: "${phrase}"`);
    }
  });

  if (likeCount >= 5) {
    score += 2;
    why.push('social proof: likes >= 5');
  }
  if (replyCount >= 2) {
    score += 1;
    why.push('discussion depth: replies >= 2');
  }
  if (text.length < 15) {
    score -= 2;
    why.push('short comment penalty');
  }
  if (has(/\b(first|lol|lmao|nice|cool|bro)\b/) && text.length < 35) {
    score -= 2;
    why.push('low-signal slang penalty');
  }

  const isNoise = has(/\b(first|lol|lmao|nice|cool|bro|sub4sub|follow me)\b/) && text.length < 45;
  if (isNoise) tags.push('noise');

  let category = 'general';
  if (tags.includes('purchase_intent')) category = 'intent';
  else if (tags.includes('growth_openness')) category = 'growth';
  else if (tags.includes('pain_point') || tags.includes('solution_seeking')) category = 'pain_point';
  else if (tags.includes('question')) category = 'question';
  else if (tags.includes('positive_signal')) category = 'positive';
  else if (tags.includes('trust_risk')) category = 'risk';

  return {
    score,
    tags: Array.from(new Set(tags)),
    why: Array.from(new Set(why)),
    category,
    is_noise: isNoise,
  };
}

function buildReplyDraft(classified, comment) {
  const author = safeText(comment?.author) || 'there';
  const base = `Thanks ${author} for sharing this.`;
  if (classified.category === 'intent') {
    return `${base} If you want, I can share a quick comparison and the fastest way to get started.`;
  }
  if (classified.category === 'growth') {
    return `${base} That shift you described is real. If you want, I can share a simple path to move from feeling stuck to clear next steps.`;
  }
  if (classified.category === 'pain_point') {
    return `${base} That sounds frustrating. If you describe your exact setup, I can suggest a concrete fix path.`;
  }
  if (classified.category === 'question') {
    return `${base} Great question. The short answer is: start with a simple baseline, then iterate based on what your audience responds to.`;
  }
  if (classified.category === 'positive') {
    return `${base} Glad this helped. Curious what part was most useful for you?`;
  }
  if (classified.category === 'risk') {
    return `${base} Good call to be cautious. Verifying sources and outcomes before acting is the safest move.`;
  }
  return `${base} Appreciate the perspective.`;
}

async function runYoutubeCommentMiner(rawInput = {}) {
  const cfg = youtubeApiConfig();
  if (!cfg.apiKey) {
    return {
      ok: false,
      status: 400,
      error: 'YouTube API key is not configured. Go to Settings > APIs > YouTube and add your key.',
    };
  }

  const targets = toArrayTargets(rawInput.targets || rawInput.targets_text);
  if (!targets.length) {
    return { ok: false, status: 400, error: 'Provide at least one video or channel target.' };
  }

  const videosPerChannel = Math.max(1, Math.min(Number(rawInput.videos_per_channel || 5) || 5, 20));
  const maxCommentsPerVideo = Math.max(1, Math.min(Number(rawInput.max_comments_per_video || 100) || 100, 500));
  const includeReplies = rawInput.include_replies === true;
  const sortBy = safeText(rawInput.sort_by) === 'time' ? 'time' : 'relevance';
  const minScore = Math.max(0, Math.min(Number(rawInput.min_score || 3) || 3, 20));
  const excludeNoise = rawInput.exclude_noise !== false;
  const includePhrases = parsePhraseList(rawInput.include_phrases_text || rawInput.include_phrases);
  const excludePhrases = parsePhraseList(rawInput.exclude_phrases_text || rawInput.exclude_phrases);

  const resolvedVideos = [];
  const warnings = [];
  const seen = new Set();

  for (const rawTarget of targets) {
    const parsed = parseYoutubeTarget(rawTarget);
    try {
      if (parsed.type === 'video') {
        const key = safeText(parsed.video_id || parsed.videoId);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        resolvedVideos.push({
          source_target: rawTarget,
          source_type: 'video',
          video_url: parsed.canonical || `https://www.youtube.com/watch?v=${key}`,
          video_id: key,
        });
        continue;
      }

      let channelId = '';
      if (parsed.type === 'channel') channelId = safeText(parsed.channelId);
      if (parsed.type === 'channel_handle') channelId = await resolveChannelIdFromHandle(parsed.handle, cfg.apiKey);

      if (channelId) {
        const videos = await listRecentChannelVideos(channelId, videosPerChannel, cfg.apiKey);
        if (!videos.length) {
          warnings.push(`No recent videos found for channel target: ${rawTarget}`);
        }
        videos.forEach((video) => {
          const key = safeText(video.video_id);
          if (!key || seen.has(key)) return;
          seen.add(key);
          resolvedVideos.push({
            source_target: rawTarget,
            source_type: 'channel',
            channel_id: channelId,
            video_url: safeText(video.video_url),
            video_id: key,
            title_hint: safeText(video.title),
            channel_name_hint: safeText(video.channel_name),
          });
        });
      } else {
        warnings.push(`Could not parse target as YouTube video/channel: ${rawTarget}`);
      }
    } catch (err) {
      warnings.push(`${rawTarget}: ${safeText(err?.message) || 'failed to resolve target'}`);
    }
  }

  if (!resolvedVideos.length) {
    return {
      ok: false,
      status: 400,
      error: 'No valid videos resolved from targets.',
      data: { warnings },
    };
  }

  const perVideo = [];
  const allClassified = [];
  const errors = [];

  for (const video of resolvedVideos) {
    try {
      const result = await runYoutubeCommentHarvest({
        video_url: video.video_url,
        max_comments: maxCommentsPerVideo,
        include_replies: includeReplies,
        sort_by: sortBy,
      });

      const comments = Array.isArray(result?.comments) ? result.comments : [];
      const classifiedComments = comments.map((comment) => {
        const classified = classifyComment(comment, {
          include_phrases: includePhrases,
          exclude_phrases: excludePhrases,
        });
        return {
          ...comment,
          ...classified,
          video_id: safeText(result?.video_id || video.video_id),
          video_url: safeText(result?.video_url || video.video_url),
          video_title: safeText(result?.title || video.title_hint || ''),
          channel_name: safeText(result?.channel_name || video.channel_name_hint || ''),
          source_target: video.source_target,
          reply_draft: buildReplyDraft(classified, comment),
        };
      });

      perVideo.push({
        source_target: video.source_target,
        video_id: safeText(result?.video_id || video.video_id),
        video_url: safeText(result?.video_url || video.video_url),
        video_title: safeText(result?.title || video.title_hint || ''),
        channel_name: safeText(result?.channel_name || video.channel_name_hint || ''),
        stats: result?.stats || {},
      });
      allClassified.push(...classifiedComments);
    } catch (err) {
      errors.push({
        source_target: video.source_target,
        video_url: video.video_url,
        error: safeText(err?.message) || 'comment harvest failed',
      });
    }
  }

  const filtered = allClassified
    .filter((row) => Number(row.score || 0) >= minScore)
    .filter((row) => (excludeNoise ? !row.is_noise : true))
    .sort((a, b) => {
      const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return Number(b.like_count || 0) - Number(a.like_count || 0);
    });

  const categoryCounts = filtered.reduce((acc, row) => {
    const key = safeText(row.category) || 'general';
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const tagCounts = filtered.reduce((acc, row) => {
    const tags = Array.isArray(row.tags) ? row.tags : [];
    tags.forEach((tag) => {
      const key = safeText(tag);
      if (!key) return;
      acc[key] = Number(acc[key] || 0) + 1;
    });
    return acc;
  }, {});

  return {
    ok: true,
    status: 200,
    data: {
      input: {
        target_count: targets.length,
        videos_per_channel: videosPerChannel,
        max_comments_per_video: maxCommentsPerVideo,
        include_replies: includeReplies,
        sort_by: sortBy,
        min_score: minScore,
        exclude_noise: excludeNoise,
        include_phrases: includePhrases,
        exclude_phrases: excludePhrases,
      },
      stats: {
        resolved_videos: resolvedVideos.length,
        harvested_videos: perVideo.length,
        total_comments_raw: allClassified.length,
        total_comments_filtered: filtered.length,
      },
      per_video: perVideo,
      category_counts: categoryCounts,
      tag_counts: tagCounts,
      comments: filtered.slice(0, 500),
      warnings,
      errors,
    },
  };
}

module.exports = {
  runYoutubeCommentMiner,
};
