'use strict';

const { getAccessToken } = require('../googleDrive');

function videoIdFromUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('video_url is required');

  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  const url = new URL(withScheme);

  if (url.hostname.includes('youtu.be')) {
    const id = url.pathname.replace(/^\/+/, '');
    if (!id) throw new Error('Invalid youtu.be URL');
    return id;
  }

  const id = url.searchParams.get('v');
  if (!id) throw new Error('YouTube watch URL must include v=VIDEO_ID');
  return id;
}

function normalizeCommentText(input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('comment_text is required');
  if (text.length > 10000) throw new Error('comment_text exceeds YouTube limit (10,000 chars)');
  return text;
}

async function postYoutubeComment(input) {
  const videoUrl = String(input?.video_url || '').trim();
  const videoId = videoIdFromUrl(videoUrl);
  const textOriginal = normalizeCommentText(input?.comment_text);

  const tokenRes = await getAccessToken();
  if (!tokenRes.ok) {
    return {
      ok: false,
      status: tokenRes.status || 500,
      error:
        tokenRes.error ||
        'Google OAuth is not configured. Add Google Drive OAuth credentials in Settings > APIs.'
    };
  }

  const endpoint = 'https://www.googleapis.com/youtube/v3/commentThreads?part=snippet';
  const payload = {
    snippet: {
      videoId,
      topLevelComment: {
        snippet: { textOriginal }
      }
    }
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenRes.data.accessToken}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
        'user-agent': 'APH-YoutubeCommentPost/1.0'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Could not reach YouTube API: ${err.message}` };
  }

  const bodyText = await res.text().catch(() => '');
  let body = {};
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = {}; }

  if (!res.ok) {
    const apiMessage =
      body?.error?.message ||
      body?.error?.errors?.[0]?.message ||
      `YouTube API error (${res.status})`;
    const reason = String(body?.error?.errors?.[0]?.reason || '').trim();
    const extra = /insufficientpermissions|forbidden/i.test(reason)
      ? ' Ensure your Google OAuth refresh token includes YouTube scope (youtube.force-ssl).'
      : '';
    return { ok: false, status: res.status || 500, error: `${apiMessage}${extra}` };
  }

  const top = body?.snippet?.topLevelComment || {};
  const snippet = top?.snippet || {};
  return {
    ok: true,
    status: 201,
    data: {
      thread_id: String(body?.id || '').trim(),
      comment_id: String(top?.id || '').trim(),
      video_id: videoId,
      video_url: videoUrl,
      text: String(snippet?.textOriginal || textOriginal),
      author: String(snippet?.authorDisplayName || 'You'),
      published_at: String(snippet?.publishedAt || '')
    }
  };
}

module.exports = {
  postYoutubeComment
};

