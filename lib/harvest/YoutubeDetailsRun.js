
const { getProviderValues } = require('../apiSettings');

function normalizeWatchUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('video_url is required');
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  const url = new URL(withScheme);
  if (!/youtube\.com$|youtu\.be$/i.test(url.hostname)) {
    throw new Error('URL must be a YouTube link');
  }
  if (url.hostname.includes('youtu.be')) {
    const id = url.pathname.replace(/^\/+/, '');
    if (!id) throw new Error('Invalid youtu.be URL');
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }
  if (!url.searchParams.get('v')) {
    throw new Error('YouTube watch URL must include v=');
  }
  return `https://www.youtube.com/watch?v=${encodeURIComponent(url.searchParams.get('v'))}`;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function transcriptApiConfig() {
  const saved = getProviderValues('transcriptapi');
  const apiKey = String(process.env.TRANSCRIPTAPI_API_KEY || saved.api_key || '').trim();
  const baseUrl = String(process.env.TRANSCRIPTAPI_BASE_URL || saved.base_url || 'https://transcriptapi.com/api/v2')
    .trim()
    .replace(/\/+$/, '');
  const timeoutMs = Math.max(
    5000,
    Math.min(
      Number(process.env.TRANSCRIPTAPI_TIMEOUT_MS || saved.timeout_ms || 20000) || 20000,
      60000
    )
  );
  const enabled = parseBoolean(process.env.TRANSCRIPTAPI_ENABLED, true);
  return { apiKey, baseUrl, timeoutMs, enabled };
}

function videoIdFromWatchUrl(url) {
  try {
    return String(new URL(url).searchParams.get('v') || '').trim();
  } catch {
    return '';
  }
}

function stripHtml(input) {
  return String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonBlock(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractJsonAfterToken(html, token) {
  const i = html.indexOf(token);
  if (i < 0) return null;
  const start = html.indexOf('{', i + token.length);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let p = start; p < html.length; p += 1) {
    const ch = html[p];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === '\\') {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return parseJsonBlock(html.slice(start, p + 1));
      }
    }
  }
  return null;
}

function findAll(obj, predicate, out = []) {
  if (!obj) return out;
  if (predicate(obj)) out.push(obj);
  if (Array.isArray(obj)) {
    obj.forEach((item) => findAll(item, predicate, out));
    return out;
  }
  if (typeof obj === 'object') {
    Object.values(obj).forEach((value) => findAll(value, predicate, out));
  }
  return out;
}

function hashtagsFromText(text) {
  const matches = String(text || '').match(/#([A-Za-z0-9_]+)/g) || [];
  return Array.from(new Set(matches.map((v) => v.trim()))).slice(0, 50);
}

function extractEmails(text) {
  const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return Array.from(new Set(matches.map((m) => m.toLowerCase()))).slice(0, 50);
}

function cleanDescription(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const cleaned = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (lower.includes('@') && /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(line)) return false;
    if (line.includes('#')) return false;
    if (/https?:\/\//i.test(line)) return false;
    if (/(instagram|facebook|tiktok|twitter|x\.com|bluesky|bsky|substack|medium|linktr\.ee|beacons\.ai|solo\.to)/i.test(lower)) return false;
    return true;
  });

  return cleaned.join('\n').trim();
}

function classifySocial(url) {
  const value = String(url || '').toLowerCase();
  if (value.includes('instagram.com')) return 'instagram';
  if (value.includes('x.com') || value.includes('twitter.com')) return 'x';
  if (value.includes('facebook.com')) return 'facebook';
  if (value.includes('tiktok.com')) return 'tiktok';
  if (value.includes('linkedin.com')) return 'linkedin';
  if (value.includes('youtube.com')) return 'youtube';
  if (value.includes('threads.net')) return 'threads';
  if (value.includes('bsky.app') || value.includes('bluesky')) return 'bluesky';
  if (value.includes('substack.com')) return 'substack';
  if (value.includes('medium.com')) return 'medium';
  return '';
}

function isLinktree(url) {
  const value = String(url || '').toLowerCase();
  return value.includes('linktr.ee') || value.includes('beacons.ai') || value.includes('solo.to');
}

function extractTranscriptText(raw) {
  const textNodes = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/gi;
  let m;
  while ((m = regex.exec(raw))) {
    textNodes.push(m[1]);
  }
  const decoded = textNodes
    .map((t) => t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return decoded;
}

function extractTranscriptFromJson3(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const events = Array.isArray(parsed?.events) ? parsed.events : [];
    const lines = [];
    events.forEach((ev) => {
      const segs = Array.isArray(ev?.segs) ? ev.segs : [];
      const text = segs.map((s) => String(s?.utf8 || '')).join('').trim();
      if (text) lines.push(text);
    });
    return lines.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'APH-Youtube-Harvest/1.0',
      accept: 'text/html,application/xhtml+xml'
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchTranscriptFromPlayer(player) {
  const tracks =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
    [];
  if (!Array.isArray(tracks) || !tracks.length) {
    return { transcript: '', transcript_source: 'none' };
  }
  const preferred = tracks.find((t) => String(t.languageCode || '').startsWith('en')) || tracks[0];
  const baseUrl = String(preferred?.baseUrl || '');
  if (!baseUrl) return { transcript: '', transcript_source: 'none' };
  const source = String(preferred?.name?.simpleText || preferred?.languageCode || 'caption');

  const tryUrls = [
    `${baseUrl}&fmt=json3`,
    `${baseUrl}&fmt=srv3`,
    baseUrl
  ];

  for (const u of tryUrls) {
    try {
      const response = await fetch(u, { signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      if (!response.ok || !text) continue;
      const transcript = u.includes('json3')
        ? extractTranscriptFromJson3(text)
        : extractTranscriptText(text);
      if (transcript) {
        return { transcript, transcript_source: source };
      }
    } catch {
      // try next fallback
    }
  }

  return { transcript: '', transcript_source: `${source} (empty)` };
}

function transcriptTextFromTranscriptApiJson(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};

  const fromArray = (arr) =>
    arr
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        return String(item.text || item.snippet || item.content || '').trim();
      })
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  if (typeof root.transcript === 'string') return root.transcript.trim();
  if (Array.isArray(root.transcript)) return fromArray(root.transcript);
  if (typeof root.text === 'string') return root.text.trim();
  if (Array.isArray(root.text)) return fromArray(root.text);
  if (Array.isArray(root.captions)) return fromArray(root.captions);
  if (Array.isArray(root.data)) return fromArray(root.data);
  if (Array.isArray(root.results)) return fromArray(root.results);
  return '';
}

async function fetchTranscriptFromTranscriptApi(videoUrl) {
  const cfg = transcriptApiConfig();
  if (!cfg.enabled) {
    return { transcript: '', transcript_source: 'transcriptapi-disabled', transcript_provider: 'transcriptapi', error: '' };
  }
  if (!cfg.apiKey) {
    return { transcript: '', transcript_source: 'transcriptapi-unconfigured', transcript_provider: 'transcriptapi', error: '' };
  }

  const endpoint =
    `${cfg.baseUrl}/youtube/transcript` +
    `?video_url=${encodeURIComponent(videoUrl)}` +
    '&format=json&include_timestamp=true';

  let response;
  try {
    response = await fetch(endpoint, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        'x-api-key': cfg.apiKey,
        'user-agent': 'APH-Youtube-Harvest/1.0'
      },
      signal: AbortSignal.timeout(cfg.timeoutMs)
    });
  } catch (error) {
    return {
      transcript: '',
      transcript_source: 'transcriptapi-error',
      transcript_provider: 'transcriptapi',
      error: error?.message || 'network error'
    };
  }

  let payload = null;
  let text = '';
  try {
    text = await response.text();
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    return {
      transcript: '',
      transcript_source: 'transcriptapi-error',
      transcript_provider: 'transcriptapi',
      error:
        String(payload?.message || payload?.error || payload?.detail || text || `HTTP ${response.status}`).slice(0, 240)
    };
  }

  const transcript = transcriptTextFromTranscriptApiJson(payload);
  if (!transcript) {
    return {
      transcript: '',
      transcript_source: 'transcriptapi-empty',
      transcript_provider: 'transcriptapi',
      error: ''
    };
  }

  return {
    transcript,
    transcript_source: 'transcriptapi',
    transcript_provider: 'transcriptapi',
    error: ''
  };
}

function collectPlaylistLinks(initialData) {
  const candidates = findAll(
    initialData,
    (node) =>
      node &&
      typeof node === 'object' &&
      node.navigationEndpoint &&
      node.navigationEndpoint.commandMetadata &&
      node.navigationEndpoint.commandMetadata.webCommandMetadata &&
      typeof node.navigationEndpoint.commandMetadata.webCommandMetadata.url === 'string'
  );

  const seen = new Set();
  const out = [];
  candidates.forEach((node) => {
    const url = String(node.navigationEndpoint.commandMetadata.webCommandMetadata.url || '');
    if (!url.includes('list=')) return;
    const text =
      node.title?.simpleText ||
      (Array.isArray(node.title?.runs) ? node.title.runs.map((r) => r.text).join(' ') : '');
    const full = url.startsWith('http') ? url : `https://www.youtube.com${url}`;
    if (seen.has(full)) return;
    seen.add(full);
    out.push({ title: String(text || '').trim(), url: full });
  });
  return out.slice(0, 30);
}

function collectUrls(text) {
  const raw = String(text || '');
  const urls = raw.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return Array.from(new Set(urls)).slice(0, 200);
}

async function runYoutubeHarvest(input) {
  const watchUrl = normalizeWatchUrl(input.video_url);
  const html = await fetchHtml(watchUrl);

  const player =
    extractJsonAfterToken(html, 'var ytInitialPlayerResponse =') ||
    extractJsonAfterToken(html, 'ytInitialPlayerResponse =');
  const initialData =
    extractJsonAfterToken(html, 'var ytInitialData =') ||
    extractJsonAfterToken(html, 'ytInitialData =') ||
    {};

  if (!player) {
    throw new Error('Could not parse YouTube player data');
  }

  const videoDetails = player.videoDetails || {};
  const title = String(videoDetails.title || '').trim();
  const descriptionRaw = String(videoDetails.shortDescription || '').trim();
  const description = cleanDescription(descriptionRaw);
  const hashtags = hashtagsFromText(`${title}\n${descriptionRaw}`);

  const transcriptErrors = [];
  let transcriptPayload = {
    transcript: '',
    transcript_source: 'none'
  };

  try {
    transcriptPayload = await fetchTranscriptFromPlayer(player);
  } catch (error) {
    transcriptErrors.push(`caption-track: ${error?.message || 'unknown error'}`);
  }

  const videoId = videoIdFromWatchUrl(watchUrl) || String(videoDetails.videoId || '');

  if (!transcriptPayload.transcript && videoId) {
    const timedTextUrls = [
      `https://www.youtube.com/api/timedtext?fmt=json3&v=${encodeURIComponent(videoId)}&lang=en`,
      `https://www.youtube.com/api/timedtext?fmt=json3&v=${encodeURIComponent(videoId)}&kind=asr&lang=en`,
      `https://www.youtube.com/api/timedtext?fmt=srv3&v=${encodeURIComponent(videoId)}&lang=en`,
      `https://www.youtube.com/api/timedtext?fmt=srv3&v=${encodeURIComponent(videoId)}&kind=asr&lang=en`
    ];
    for (const u of timedTextUrls) {
      try {
        const response = await fetch(u, { signal: AbortSignal.timeout(15000) });
        const text = await response.text();
        if (!response.ok || !text) continue;
        const transcript = u.includes('json3')
          ? extractTranscriptFromJson3(text)
          : extractTranscriptText(text);
        if (transcript) {
          transcriptPayload.transcript = transcript;
          transcriptPayload.transcript_source = 'timedtext-fallback';
          break;
        }
      } catch (error) {
        transcriptErrors.push(`timedtext: ${error?.message || 'unknown error'}`);
      }
    }
  }

  const profileUrl =
    player?.microformat?.playerMicroformatRenderer?.ownerProfileUrl ||
    '';
  const profileUrlAbsolute = profileUrl
    ? (profileUrl.startsWith('http') ? profileUrl : `https://www.youtube.com${profileUrl}`)
    : '';
  const aboutUrl = profileUrlAbsolute ? `${profileUrlAbsolute.replace(/\/+$/, '')}/about` : '';

  let aboutHtml = '';
  if (aboutUrl) {
    aboutHtml = await fetchHtml(aboutUrl).catch(() => '');
  }
  const discoveredLinks = collectUrls(`${descriptionRaw}\n${aboutHtml}`);
  const socialProfiles = discoveredLinks.filter((url) => classifySocial(url)).slice(0, 50);
  const websites = discoveredLinks.filter(
    (url) =>
      !classifySocial(url) &&
      !isLinktree(url) &&
      !url.includes('youtube.com') &&
      !url.includes('youtu.be')
  );
  const linktree = discoveredLinks.find((url) => isLinktree(url)) || '';
  const descriptionEmails = extractEmails(descriptionRaw);
  const emails = extractEmails(`${descriptionRaw}\n${stripHtml(aboutHtml)}`);
  const playlists = collectPlaylistLinks(initialData);
  let transcriptProvider = 'youtube-native';
  let transcriptNextFallback = 'transcriptapi';

  if (!transcriptPayload.transcript) {
    const tp = await fetchTranscriptFromTranscriptApi(watchUrl);
    if (tp.transcript) {
      transcriptPayload.transcript = tp.transcript;
      transcriptPayload.transcript_source = tp.transcript_source;
      transcriptProvider = tp.transcript_provider;
      transcriptNextFallback = 'none';
    } else if (tp.error) {
      transcriptErrors.push(`transcriptapi: ${tp.error}`);
      transcriptProvider = tp.transcript_provider || 'youtube-native';
      transcriptNextFallback = 'whisper';
    } else {
      transcriptProvider = tp.transcript_provider || 'youtube-native';
      transcriptNextFallback =
        tp.transcript_source === 'transcriptapi-unconfigured' ? 'transcriptapi' : 'whisper';
    }
  } else {
    transcriptNextFallback = 'none';
  }

  const transcriptStatus = transcriptPayload.transcript
    ? 'found'
    : (transcriptErrors.length ? 'failed' : 'unavailable');
  const transcriptError = transcriptErrors.length ? transcriptErrors.slice(0, 3).join(' | ') : '';

  return {
    video: {
      url: watchUrl,
      id: String(videoDetails.videoId || ''),
      title,
      description,
      email: descriptionEmails.join('|'),
      hashtags,
      playlists,
      transcript: transcriptPayload.transcript,
      transcript_source: transcriptPayload.transcript_source,
      transcript_status: transcriptStatus,
      transcript_provider: transcriptProvider,
      transcript_error: transcriptError,
      transcript_next_fallback: transcriptNextFallback
    },
    channel_owner: {
      name: String(videoDetails.author || ''),
      channel_id: String(videoDetails.channelId || ''),
      profile_url: profileUrlAbsolute,
      about_url: aboutUrl,
      email: emails[0] || '',
      website: websites[0] || '',
      all_social_profiles: socialProfiles,
      linktree,
      discovered_links: discoveredLinks
    }
  };
}

module.exports = {
  runYoutubeHarvest
};
