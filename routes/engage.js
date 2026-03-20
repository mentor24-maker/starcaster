'use strict';

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { logActivity } = require('../lib/activityLog');
const { getProviderValues } = require('../lib/apiSettings');
const { listCampaigns, rowToCampaign } = require('../lib/store');
const { getAssetById, rowToAsset } = require('../lib/assetsStore');
const socialStore = require('../lib/engageSocialStore');
const xClient = require('../lib/xClient');
const telegramClient = require('../lib/telegramClient');
const blueskyClient = require('../lib/blueskyClient');
const metaClients = require('../lib/metaClients');
const redditClient = require('../lib/redditClient');
const { relayOpenClaw } = require('../lib/openclawGateway');
const {
  listAgents: listYoutubeCommentAgents,
  createAgent: createYoutubeCommentAgent,
  updateAgent: updateYoutubeCommentAgent,
  getAgent: getYoutubeCommentAgent,
} = require('../lib/youtubeCommentAgentStore');
const { runYoutubeHarvest } = require('../lib/harvest/YoutubeDetailsRun');
const {
  buildYoutubeCommentSuggestionInput,
  generateYoutubeCommentSuggestions
} = require('../lib/harvest/YoutubeCommentSuggestions');
const { postYoutubeComment } = require('../lib/harvest/YoutubeCommentPost');
const { getAccessToken } = require('../lib/googleDrive');
const PUBLISH_NOW_CHANNELS = ['x', 'telegram', 'bluesky', 'facebook', 'threads', 'instagram'];

function safeText(value) {
  return String(value || '').trim();
}

function maskSecret(value) {
  const text = safeText(value);
  if (!text) return '';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function providerRuntimeDebug(provider, envVar) {
  const fromEnv = safeText(process.env[envVar]);
  const fromStore = safeText(getProviderValues(provider)?.api_key);
  const selected = fromEnv || fromStore;
  return {
    provider,
    configured: Boolean(selected),
    source: fromEnv ? 'env' : (fromStore ? 'settings' : 'none'),
    keyHint: maskSecret(selected),
  };
}

function parseJsonObject(raw) {
  try {
    const obj = JSON.parse(String(raw || '{}'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function requestOrigin(req) {
  const proto = safeText(req?.headers?.['x-forwarded-proto']) || 'http';
  const host = safeText(req?.headers?.host);
  if (!host) return '';
  return `${proto}://${host}`;
}

function configuredPublicOrigin(req) {
  const configured = safeText(process.env.PUBLIC_APP_ORIGIN || process.env.APP_PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL);
  if (configured) return configured.replace(/\/+$/, '');
  const vercel = safeText(process.env.VERCEL_URL);
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return requestOrigin(req);
}

function clampInteger(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizeYoutubeCommentAgentPayload(body) {
  const timeframe = safeText(body?.timeframe).toLowerCase() || 'month';
  const allowedTimeframes = new Set(['minute', 'hour', 'day', 'week', 'month', 'year']);
  return {
    videoUrl: safeText(body?.videoUrl || body?.video_url),
    fromDate: safeText(body?.fromDate || body?.from_date),
    toDate: safeText(body?.toDate || body?.to_date),
    frequency: clampInteger(body?.frequency, 1, 60, 1),
    timeframe: allowedTimeframes.has(timeframe) ? timeframe : 'month',
    maxPosts: clampInteger(body?.maxPosts || body?.max_posts, 1, 20, 1),
    videoCommentRatio: safeText(body?.videoCommentRatio || body?.video_comment_ratio) || '100/0',
    jitterHours: 10,
    scheduleEnabled: false,
    scheduleStatus: 'disabled',
    scheduleNote: 'Scheduling is configured but disabled. Use Post On Demand for testing.',
  };
}

function hasYoutubePostingScope(scopes) {
  return (Array.isArray(scopes) ? scopes : []).some((scope) => {
    const text = safeText(scope);
    return text === 'https://www.googleapis.com/auth/youtube.force-ssl'
      || text === 'https://www.googleapis.com/auth/youtube'
      || text === 'https://www.googleapis.com/auth/youtube.upload';
  });
}

async function fetchGoogleTokenInfo(accessToken) {
  const token = safeText(accessToken);
  if (!token) return { ok: false, status: 400, error: 'access token is required' };
  let res;
  try {
    res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Could not reach Google token info: ${err.message}` };
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status || 500,
      error: safeText(payload?.error_description || payload?.error || 'Google token info lookup failed'),
    };
  }
  const scopes = safeText(payload?.scope).split(/\s+/).map(safeText).filter(Boolean);
  return {
    ok: true,
    status: 200,
    data: {
      scope: scopes,
      expiresIn: Number(payload?.expires_in || 0) || 0,
      audience: safeText(payload?.aud),
    },
  };
}

async function fetchYoutubePostingIdentity(accessToken) {
  const token = safeText(accessToken);
  if (!token) return { ok: false, status: 400, error: 'access token is required' };
  let res;
  try {
    res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=1', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/json',
        'user-agent': 'APH-YoutubeCommentPreflight/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Could not reach YouTube API: ${err.message}` };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status || 500,
      error: safeText(body?.error?.message || body?.error?.errors?.[0]?.message || 'YouTube identity lookup failed'),
    };
  }
  const item = Array.isArray(body?.items) ? body.items[0] : null;
  return {
    ok: true,
    status: 200,
    data: {
      channelId: safeText(item?.id),
      channelTitle: safeText(item?.snippet?.title),
    },
  };
}

async function buildYoutubeCommentAgentPreflight(payload) {
  const videoUrl = safeText(payload?.videoUrl);
  const issues = [];
  const result = {
    ready: false,
    providers: {
      openai: providerRuntimeDebug('openai', 'OPENAI_API_KEY'),
      anthropic: providerRuntimeDebug('anthropic', 'ANTHROPIC_API_KEY'),
    },
    checks: {
      videoSelection: {
        ok: Boolean(videoUrl),
        videoUrl,
      },
      harvest: { ok: false },
      commentGeneration: { ok: false },
      googleOAuth: { ok: false },
      youtubePosting: { ok: false },
    },
    harvest: null,
    suggestionInput: null,
    suggestions: [],
  };

  if (!videoUrl) {
    issues.push('Select a repository video before posting.');
    result.issues = issues;
    return result;
  }

  const harvest = await runYoutubeHarvest({ video_url: videoUrl });
  result.harvest = harvest;
  result.checks.harvest = {
    ok: Boolean(harvest?.video?.id || harvest?.video?.title || harvest?.video?.description),
    videoId: safeText(harvest?.video?.id),
    title: safeText(harvest?.video?.title),
    channelName: safeText(harvest?.channel_owner?.name),
    transcriptStatus: safeText(harvest?.video?.transcript_status),
  };
  if (!result.checks.harvest.ok) {
    issues.push('Could not harvest enough video context to generate a comment.');
  }

  const suggestionInput = buildYoutubeCommentSuggestionInput({
    video_url: videoUrl,
    title: safeText(harvest?.video?.title),
    channel_name: safeText(harvest?.channel_owner?.name),
    description: safeText(harvest?.video?.description),
    transcript: safeText(harvest?.video?.transcript),
  });
  result.suggestionInput = suggestionInput;

  const suggestionRes = await generateYoutubeCommentSuggestions(suggestionInput);
  result.suggestions = Array.isArray(suggestionRes?.data) ? suggestionRes.data : [];
  result.checks.commentGeneration = {
    ok: Boolean(suggestionRes?.ok),
    provider: safeText(suggestionRes?.provider),
    count: result.suggestions.length,
    error: safeText(suggestionRes?.error),
  };
  if (!suggestionRes?.ok) {
    issues.push(safeText(suggestionRes?.error) || 'Could not generate a YouTube comment suggestion.');
  }

  const tokenRes = await getAccessToken();
  if (!tokenRes.ok) {
    result.checks.googleOAuth = {
      ok: false,
      error: safeText(tokenRes.error),
    };
    issues.push(safeText(tokenRes.error) || 'Google OAuth is not configured.');
    result.issues = issues;
    return result;
  }

  const accessToken = safeText(tokenRes?.data?.accessToken);
  const tokenInfoRes = await fetchGoogleTokenInfo(accessToken);
  const scopes = Array.isArray(tokenInfoRes?.data?.scope) ? tokenInfoRes.data.scope : [];
  const scopeReady = hasYoutubePostingScope(scopes);
  result.checks.googleOAuth = {
    ok: Boolean(tokenRes.ok && tokenInfoRes.ok),
    scopeLookupOk: Boolean(tokenInfoRes.ok),
    scopes,
    hasYoutubePostingScope: scopeReady,
    expiresIn: Number(tokenInfoRes?.data?.expiresIn || 0) || 0,
    audience: safeText(tokenInfoRes?.data?.audience),
    error: safeText(tokenInfoRes?.error),
  };
  if (!scopeReady) {
    issues.push('Google OAuth token is missing YouTube posting scope (youtube.force-ssl recommended).');
  }

  const youtubeIdentityRes = await fetchYoutubePostingIdentity(accessToken);
  result.checks.youtubePosting = {
    ok: Boolean(youtubeIdentityRes.ok && scopeReady),
    channelId: safeText(youtubeIdentityRes?.data?.channelId),
    channelTitle: safeText(youtubeIdentityRes?.data?.channelTitle),
    error: safeText(youtubeIdentityRes?.error),
  };
  if (!youtubeIdentityRes.ok) {
    issues.push(safeText(youtubeIdentityRes.error) || 'Could not verify YouTube posting account.');
  }

  result.ready = issues.length === 0;
  result.issues = issues;
  return result;
}

function isPublicMediaUrl(value, requireHttps = false) {
  const text = safeText(value);
  if (!text) return false;
  try {
    const parsed = new URL(text);
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (requireHttps && protocol !== 'https:') return false;
    if (protocol !== 'https:' && protocol !== 'http:') return false;
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

async function resolveCampaignImageMeta(campaignIdInput, req) {
  const campaignId = safeText(campaignIdInput);
  if (!campaignId) return { imageUrl: '', imageAlt: '' };
  const res = await listCampaigns();
  if (!res.ok) return { imageUrl: '', imageAlt: '' };
  const campaigns = (Array.isArray(res.data) ? res.data : []).map(rowToCampaign);
  const campaign = campaigns.find((item) => safeText(item?.id) === campaignId);
  if (!campaign) return { imageUrl: '', imageAlt: '' };
  const content = parseJsonObject(campaign.content);
  const primaryImageId = safeText(content?.primaryImageId);
  if (!primaryImageId) return { imageUrl: '', imageAlt: '' };
  let imageUrl = '';
  const assetRes = await getAssetById(primaryImageId);
  if (assetRes.ok) {
    const assetRow = Array.isArray(assetRes.data) ? assetRes.data[0] : assetRes.data;
    const asset = rowToAsset(assetRow);
    const location = safeText(asset?.location);
    if (isPublicMediaUrl(location, true)) imageUrl = location;
  }
  if (!imageUrl) {
    const origin = configuredPublicOrigin(req);
    if (!origin) return { imageUrl: '', imageAlt: '' };
    imageUrl = `${origin}/api/assets/file/${encodeURIComponent(primaryImageId)}`;
  }
  return {
    imageUrl,
    imageAlt: `${safeText(campaign?.name) || 'Campaign'} image`,
  };
}

async function resolvePostImageMeta(post, req, requireHttps = false) {
  const currentUrl = safeText(post?.imageUrl);
  if (isPublicMediaUrl(currentUrl, requireHttps)) {
    return { imageUrl: currentUrl, imageAlt: safeText(post?.imageAlt) };
  }
  const campaignId = safeText(post?.campaignId);
  if (!campaignId) return { imageUrl: '', imageAlt: safeText(post?.imageAlt) };
  const fallback = await resolveCampaignImageMeta(campaignId, req);
  return {
    imageUrl: safeText(fallback.imageUrl),
    imageAlt: safeText(post?.imageAlt || fallback.imageAlt),
  };
}

async function publishStoredPost(post, req) {
  if (!post) return { ok: false, status: 404, error: 'Post not found' };
  const channel = String(post.channel || 'x').trim().toLowerCase();

  if (!PUBLISH_NOW_CHANNELS.includes(channel)) {
    const skipped = socialStore.updatePost(post.id, {
      status: 'failed',
      error: `Publishing for ${channel.toUpperCase()} is not configured yet`,
      diagnostics: {
        checkedAt: new Date().toISOString(),
        channel,
        attempts: [{
          endpoint: '',
          ok: false,
          status: 400,
          message: `Publishing for ${channel.toUpperCase()} is not configured yet`,
        }],
      },
    });
    return { ok: false, status: 400, error: `Publishing for ${channel.toUpperCase()} is not configured yet`, post: skipped };
  }

  socialStore.updatePost(post.id, { status: 'publishing', error: '' });
  const imageOpts = {
    imageUrl: String(post.imageUrl || '').trim(),
    imageAlt: String(post.imageAlt || '').trim(),
  };
  if (channel === 'facebook' || channel === 'instagram' || channel === 'threads') {
    const resolved = await resolvePostImageMeta(post, req, true);
    imageOpts.imageUrl = safeText(resolved.imageUrl);
    imageOpts.imageAlt = safeText(resolved.imageAlt);
  } else if (channel === 'bluesky') {
    const resolved = await resolvePostImageMeta(post, req, false);
    if (safeText(resolved.imageUrl)) {
      imageOpts.imageUrl = safeText(resolved.imageUrl);
      imageOpts.imageAlt = safeText(resolved.imageAlt);
    }
  }
  let result;
  if (channel === 'telegram') {
    result = await telegramClient.sendMessage(post.text);
  } else if (channel === 'bluesky') {
    result = await blueskyClient.createPost(post.text, imageOpts);
  } else if (channel === 'facebook') {
    result = await metaClients.createFacebookPost(post.text, imageOpts);
  } else if (channel === 'threads') {
    result = await metaClients.createThreadsPost(post.text, imageOpts);
  } else if (channel === 'instagram') {
    result = await metaClients.createInstagramPost(post.text, imageOpts);
  } else {
    result = await xClient.createPost(post.text);
  }
  if (!result.ok) {
    const failed = socialStore.updatePost(post.id, {
      status: 'failed',
      error: String(result.error || 'Unknown publish error'),
      diagnostics: {
        checkedAt: new Date().toISOString(),
        channel,
        endpoint: String(result.endpoint || ''),
        status: Number(result.status || 0) || 0,
        attempts: Array.isArray(result.attempts) ? result.attempts : [],
        payload: result.data || null,
      },
    });
    return { ...result, post: failed };
  }

  const published = socialStore.updatePost(post.id, {
    status: 'published',
    publishedAt: new Date().toISOString(),
    remoteId: String(result.data?.id || result.data?.messageId || ''),
    error: '',
    diagnostics: {
      checkedAt: new Date().toISOString(),
      channel,
      endpoint: String(result.data?.endpoint || ''),
      status: Number(result.status || 0) || 0,
      imageUrl: safeText(imageOpts.imageUrl || post?.imageUrl || ''),
      attempts: Array.isArray(result.data?.attempts) ? result.data.attempts : [],
    },
  });

  logActivity({
    action: channel === 'telegram'
      ? 'engage.social.telegram_posted'
      : (channel === 'bluesky'
        ? 'engage.social.bluesky_posted'
        : (channel === 'facebook'
          ? 'engage.social.facebook_posted'
          : (channel === 'threads'
            ? 'engage.social.threads_posted'
            : (channel === 'instagram' ? 'engage.social.instagram_posted' : 'engage.social.x_posted')))),
    entityType: 'engage_social_post',
    entityId: published?.id || null,
    summary: `Published ${channel.toUpperCase()} post ${published?.id || ''}`,
    meta: { remoteId: published?.remoteId || '' },
  });

  return { ok: true, status: 200, data: { post: published, remote: result.data } };
}

async function handle(req, res, pathname, method) {
  const requestMethod = String(method || '').toUpperCase();

  if (pathname === '/api/engage/reddit/status' && requestMethod === 'GET') {
    const creds = redditClient.getRedditCredentials();
    const status = {
      configured: redditClient.isConfigured(creds),
      hasClientId: Boolean(creds.clientId),
      hasClientSecret: Boolean(creds.clientSecret),
      hasRefreshToken: Boolean(creds.refreshToken),
      username: creds.username || '',
      userAgent: creds.userAgent || '',
    };
    if (!status.configured) {
      return sendOk(res, 200, { ...status, authOk: false, auth: null }, { status: { ...status, authOk: false, auth: null } }), true;
    }
    const auth = await redditClient.checkAuth(creds);
    return sendOk(
      res,
      200,
      {
        ...status,
        authOk: Boolean(auth.ok),
        auth: auth.ok ? { name: String(auth.data?.name || '') } : { error: String(auth.error || 'Auth failed') },
      },
      {
        status: {
          ...status,
          authOk: Boolean(auth.ok),
          auth: auth.ok ? { name: String(auth.data?.name || '') } : { error: String(auth.error || 'Auth failed') },
        },
      }
    ), true;
  }

  if (pathname === '/api/engage/reddit/comment' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const target = String(body?.target || '').trim();
    const targetKind = String(body?.targetKind || 'post').trim().toLowerCase() === 'comment' ? 'comment' : 'post';
    const text = String(body?.text || '').trim();
    if (!target) return sendErr(res, 400, 'target is required (Reddit URL or thing id)', { code: 'VALIDATION_ERROR' }), true;
    if (!text) return sendErr(res, 400, 'text is required', { code: 'VALIDATION_ERROR' }), true;
    if (text.length > 10000) return sendErr(res, 400, 'Reddit comments must be 10000 characters or fewer', { code: 'VALIDATION_ERROR' }), true;

    const thingId = redditClient.parseThingId(target, targetKind);
    if (!thingId) {
      return sendErr(res, 400, 'Could not resolve Reddit thing id. Use a discussion URL or thing id (t3_xxx/t1_xxx).', { code: 'VALIDATION_ERROR' }), true;
    }

    const publish = await redditClient.createComment({ thingId, text });
    if (!publish.ok) {
      return sendErr(res, publish.status || 502, `Reddit API error: ${String(publish.error || 'unknown error')}`, {
        code: 'REDDIT_COMMENT_FAILED',
      }), true;
    }

    const result = {
      thingId,
      targetKind,
      comment: publish.data?.comment || null,
      response: publish.data?.response || null,
      postedAt: new Date().toISOString(),
    };
    logActivity({
      action: 'engage.reddit.comment_posted',
      entityType: 'engage_reddit_comment',
      entityId: String(result.comment?.data?.id || ''),
      summary: `Posted Reddit comment on ${thingId}`,
      meta: { thingId, targetKind },
    });
    return sendOk(res, 200, result, { result }), true;
  }

  if (pathname === '/api/engage/reddit/comment-openclaw' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const target = String(body?.target || '').trim();
    const targetKind = String(body?.targetKind || 'post').trim().toLowerCase() === 'comment' ? 'comment' : 'post';
    const text = String(body?.text || '').trim();
    if (!target) return sendErr(res, 400, 'target is required (Reddit URL or thing id)', { code: 'VALIDATION_ERROR' }), true;
    if (!text) return sendErr(res, 400, 'text is required', { code: 'VALIDATION_ERROR' }), true;
    if (text.length > 10000) return sendErr(res, 400, 'Reddit comments must be 10000 characters or fewer', { code: 'VALIDATION_ERROR' }), true;

    const relay = await relayOpenClaw('create_job', {
      manual_confirmed: true,
      role: 'operator',
      type: 'engage.reddit.comment',
      payload: {
        target,
        target_kind: targetKind,
        text,
        instructions: 'Open Reddit, authenticate as the configured user profile, and submit this comment safely to the specified target.',
      },
    });
    if (!relay.ok) {
      return sendErr(res, relay.status || 502, `OpenClaw error: ${String(relay.error || 'failed to queue Reddit comment job')}`, {
        code: 'OPENCLAW_COMMENT_JOB_FAILED',
        details: relay.data ? [JSON.stringify(relay.data)] : [],
      }), true;
    }

    const result = {
      mode: 'openclaw',
      queuedAt: new Date().toISOString(),
      job: relay.data || {},
      target,
      targetKind,
    };
    logActivity({
      action: 'engage.reddit.comment_openclaw_queued',
      entityType: 'engage_reddit_comment',
      entityId: String(relay.data?.id || relay.data?.job_id || ''),
      summary: `Queued OpenClaw Reddit comment job for ${targetKind}`,
      meta: { target, targetKind },
    });
    return sendOk(res, 202, result, { result }), true;
  }

  if (pathname === '/api/engage/social/x/status' && requestMethod === 'GET') {
    const creds = xClient.getXCredentials();
    const payload = {
      configured: xClient.isConfigured(),
      accountName: creds.accountName || '',
      hasApiKey: Boolean(creds.apiKey),
      hasApiSecret: Boolean(creds.apiSecret),
      hasAccessToken: Boolean(creds.accessToken),
      hasAccessTokenSecret: Boolean(creds.accessTokenSecret),
    };
    return sendOk(res, 200, payload, payload), true;
  }

  if (pathname === '/api/engage/social/x/auth-test' && requestMethod === 'GET') {
    const creds = xClient.getXCredentials();
    const configured = xClient.isConfigured();
    if (!configured) {
      return sendOk(res, 200, {
        configured: false,
        authOk: false,
        error: 'Missing X credentials',
      }, {
        configured: false,
        authOk: false,
      }), true;
    }
    const auth = await xClient.checkAuth();
    if (!auth.ok) {
      return sendOk(res, 200, {
        configured: true,
        authOk: false,
        status: Number(auth.status || 0) || 0,
        error: String(auth.error || 'X auth test failed'),
        attempts: Array.isArray(auth.attempts) ? auth.attempts : [],
        accountName: creds.accountName || '',
      }, {
        configured: true,
        authOk: false,
      }), true;
    }
    return sendOk(res, 200, {
      configured: true,
      authOk: true,
      status: Number(auth.status || 200) || 200,
      accountName: creds.accountName || '',
      user: auth.data?.user || null,
      attempts: Array.isArray(auth.data?.attempts) ? auth.data.attempts : [],
    }, {
      configured: true,
      authOk: true,
    }), true;
  }

  if (pathname === '/api/engage/social/telegram/status' && requestMethod === 'GET') {
    const creds = telegramClient.getTelegramCredentials();
    const payload = {
      configured: telegramClient.isConfigured(creds),
      hasBotToken: Boolean(creds.botToken),
      hasChatId: Boolean(creds.chatId),
      baseUrl: creds.baseUrl || '',
    };
    return sendOk(res, 200, payload, payload), true;
  }

  if (pathname === '/api/engage/social/bluesky/status' && requestMethod === 'GET') {
    const creds = blueskyClient.getBlueskyCredentials();
    const payload = {
      configured: blueskyClient.isConfigured(creds),
      hasIdentifier: Boolean(creds.identifier),
      hasAppPassword: Boolean(creds.appPassword),
      serviceUrl: creds.serviceUrl || '',
    };
    return sendOk(res, 200, payload, payload), true;
  }

  if (pathname === '/api/engage/social/bluesky/auth-test' && requestMethod === 'GET') {
    const creds = blueskyClient.getBlueskyCredentials();
    const configured = blueskyClient.isConfigured(creds);
    if (!configured) {
      return sendOk(res, 200, {
        configured: false,
        authOk: false,
        error: 'Missing Bluesky identifier/app password',
      }, {
        configured: false,
        authOk: false,
      }), true;
    }
    const auth = await blueskyClient.createSession(creds);
    if (!auth.ok) {
      return sendOk(res, 200, {
        configured: true,
        authOk: false,
        status: Number(auth.status || 0) || 0,
        endpoint: String(auth.endpoint || ''),
        error: String(auth.error || 'Auth failed'),
      }, {
        configured: true,
        authOk: false,
      }), true;
    }
    return sendOk(res, 200, {
      configured: true,
      authOk: true,
      did: String(auth.did || ''),
      endpoint: String(auth.endpoint || ''),
      status: Number(auth.status || 200) || 200,
    }, {
      configured: true,
      authOk: true,
    }), true;
  }

  if (pathname === '/api/engage/social/facebook/status' && requestMethod === 'GET') {
    const creds = metaClients.getFacebookCredentials();
    const payload = {
      configured: metaClients.isFacebookConfigured(creds),
      hasAccessToken: Boolean(creds.accessToken),
      hasPageId: Boolean(creds.pageId),
      baseUrl: creds.baseUrl || '',
    };
    return sendOk(res, 200, payload, payload), true;
  }

  if (pathname === '/api/engage/social/facebook/auth-test' && requestMethod === 'GET') {
    const creds = metaClients.getFacebookCredentials();
    if (!metaClients.isFacebookConfigured(creds)) {
      return sendOk(res, 200, { configured: false, authOk: false, error: 'Missing Facebook access_token/page_id' }, { configured: false, authOk: false }), true;
    }
    const auth = await metaClients.checkFacebookAuth(creds);
    if (!auth.ok) {
      return sendOk(res, 200, {
        configured: true,
        authOk: false,
        status: Number(auth.status || 0) || 0,
        endpoint: String(auth.endpoint || ''),
        error: String(auth.error || 'Auth failed'),
      }, { configured: true, authOk: false }), true;
    }
    return sendOk(res, 200, {
      configured: true,
      authOk: true,
      status: Number(auth.status || 200) || 200,
      endpoint: String(auth.endpoint || ''),
      page: auth.data || null,
    }, { configured: true, authOk: true }), true;
  }

  if (pathname === '/api/engage/social/threads/status' && requestMethod === 'GET') {
    const creds = metaClients.getThreadsCredentials();
    const payload = {
      configured: metaClients.isThreadsConfigured(creds),
      hasAccessToken: Boolean(creds.accessToken),
      hasUserId: Boolean(creds.userId),
      baseUrl: creds.baseUrl || '',
    };
    return sendOk(res, 200, payload, payload), true;
  }

  if (pathname === '/api/engage/social/threads/auth-test' && requestMethod === 'GET') {
    const creds = metaClients.getThreadsCredentials();
    if (!metaClients.isThreadsConfigured(creds)) {
      return sendOk(res, 200, { configured: false, authOk: false, error: 'Missing Threads access_token/user_id' }, { configured: false, authOk: false }), true;
    }
    const auth = await metaClients.checkThreadsAuth(creds);
    if (!auth.ok) {
      return sendOk(res, 200, {
        configured: true,
        authOk: false,
        status: Number(auth.status || 0) || 0,
        endpoint: String(auth.endpoint || ''),
        error: String(auth.error || 'Auth failed'),
      }, { configured: true, authOk: false }), true;
    }
    return sendOk(res, 200, {
      configured: true,
      authOk: true,
      status: Number(auth.status || 200) || 200,
      endpoint: String(auth.endpoint || ''),
      user: auth.data || null,
    }, { configured: true, authOk: true }), true;
  }

  if (pathname === '/api/engage/social/instagram/status' && requestMethod === 'GET') {
    const creds = metaClients.getInstagramCredentials();
    const payload = {
      configured: metaClients.isInstagramConfigured(creds),
      hasAccessToken: Boolean(creds.accessToken),
      hasBusinessAccountId: Boolean(creds.igUserId),
      baseUrl: creds.baseUrl || '',
    };
    return sendOk(res, 200, payload, payload), true;
  }

  if (pathname === '/api/engage/social/instagram/auth-test' && requestMethod === 'GET') {
    const creds = metaClients.getInstagramCredentials();
    if (!metaClients.isInstagramConfigured(creds)) {
      return sendOk(res, 200, { configured: false, authOk: false, error: 'Missing Instagram access_token/business_account_id' }, { configured: false, authOk: false }), true;
    }
    const auth = await metaClients.checkInstagramAuth(creds);
    if (!auth.ok) {
      return sendOk(res, 200, {
        configured: true,
        authOk: false,
        status: Number(auth.status || 0) || 0,
        endpoint: String(auth.endpoint || ''),
        error: String(auth.error || 'Auth failed'),
      }, { configured: true, authOk: false }), true;
    }
    return sendOk(res, 200, {
      configured: true,
      authOk: true,
      status: Number(auth.status || 200) || 200,
      endpoint: String(auth.endpoint || ''),
      user: auth.data || null,
    }, { configured: true, authOk: true }), true;
  }

  if (pathname === '/api/engage/social/capabilities' && requestMethod === 'GET') {
    return sendOk(
      res,
      200,
      {
        publishNowChannels: PUBLISH_NOW_CHANNELS,
      },
      {
        publishNowChannels: PUBLISH_NOW_CHANNELS,
      }
    ), true;
  }

  if (pathname === '/api/engage/youtube-comment-agents' && requestMethod === 'GET') {
    const agents = listYoutubeCommentAgents();
    return sendOk(res, 200, agents, { agents }, { total: agents.length }), true;
  }

  if (pathname === '/api/engage/youtube-comment-agents' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const payload = normalizeYoutubeCommentAgentPayload(body);
    if (!payload.videoUrl) return sendErr(res, 400, 'videoUrl is required', { code: 'VALIDATION_ERROR' }), true;
    if (!payload.fromDate) return sendErr(res, 400, 'fromDate is required', { code: 'VALIDATION_ERROR' }), true;
    if (!payload.toDate) return sendErr(res, 400, 'toDate is required', { code: 'VALIDATION_ERROR' }), true;

    const agent = createYoutubeCommentAgent(payload);
    logActivity({
      action: 'engage.youtube_comment_agent_saved',
      entityType: 'engage_youtube_comment_agent',
      entityId: agent.id,
      summary: 'Saved disabled YouTube comment promotion agent',
      meta: {
        video_url: agent.videoUrl,
        frequency: agent.frequency,
        timeframe: agent.timeframe,
        max_posts: agent.maxPosts,
        video_comment_ratio: agent.videoCommentRatio,
      },
    });
    return sendOk(res, 201, { agent }, { agent }), true;
  }

  if (pathname === '/api/engage/youtube-comment-agents/preflight' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const payload = normalizeYoutubeCommentAgentPayload(body);
    const preflight = await buildYoutubeCommentAgentPreflight(payload);
    return sendOk(res, 200, preflight, preflight), true;
  }

  if (pathname === '/api/engage/youtube-comment-agents/test-post' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const payload = normalizeYoutubeCommentAgentPayload(body);
    if (!payload.videoUrl) return sendErr(res, 400, 'videoUrl is required', { code: 'VALIDATION_ERROR' }), true;

    const preflight = await buildYoutubeCommentAgentPreflight(payload);
    if (!preflight.ready) {
      return sendErr(
        res,
        412,
        preflight.issues[0] || 'YouTube comment posting preflight failed',
        { code: 'YOUTUBE_POST_PREFLIGHT_FAILED', details: preflight.issues }
      ), true;
    }
    const suggestions = Array.isArray(preflight.suggestions) ? preflight.suggestions : [];
    const selectedComment = safeText(suggestions[0]);
    if (!selectedComment) {
      return sendErr(res, 500, 'No usable YouTube comment suggestion was generated'), true;
    }

    const postRes = await postYoutubeComment({
      video_url: payload.videoUrl,
      comment_text: selectedComment,
    });
    if (!postRes.ok) return sendErr(res, postRes.status || 500, postRes.error || 'Could not post YouTube comment'), true;

    let agent = null;
    const agentId = safeText(body?.agentId || body?.agent_id);
    if (agentId) {
      agent = updateYoutubeCommentAgent(agentId, {
        lastTestPostedAt: new Date().toISOString(),
        lastTestCommentId: safeText(postRes.data?.comment_id),
        lastTestThreadId: safeText(postRes.data?.thread_id),
        lastTestCommentText: selectedComment,
      }) || getYoutubeCommentAgent(agentId);
    }

    const result = {
      agent,
      scheduling: payload,
      preflight,
      harvest: preflight.harvest,
      suggestionInput: preflight.suggestionInput,
      suggestions,
      selectedComment,
      postedComment: postRes.data,
      schedulingEnabled: false,
      schedulingNote: 'Recurring scheduling remains disabled. This was an on-demand test post.',
    };

    logActivity({
      action: 'engage.youtube_comment_test_posted',
      entityType: 'engage_youtube_comment_agent',
      entityId: agent?.id || null,
      summary: `Posted on-demand YouTube comment to ${payload.videoUrl}`,
      meta: {
        video_url: payload.videoUrl,
        comment_id: safeText(postRes.data?.comment_id),
        thread_id: safeText(postRes.data?.thread_id),
      },
    });

    return sendOk(res, 201, result, result), true;
  }

  if (pathname === '/api/engage/social/posts' && requestMethod === 'GET') {
    const posts = socialStore.listPosts();
    return sendOk(res, 200, posts, { posts }, { total: posts.length }), true;
  }

  if (pathname === '/api/engage/social/diagnostics' && requestMethod === 'GET') {
    const posts = socialStore.listPosts();
    const failures = posts
      .filter((post) => String(post.status || '').toLowerCase() === 'failed')
      .slice(0, 10)
      .map((post) => ({
        id: post.id,
        channel: post.channel,
        campaignId: post.campaignId,
        scheduledFor: post.scheduledFor,
        createdAt: post.createdAt,
        error: post.error,
        diagnostics: post.diagnostics || null,
      }));
    const creds = xClient.getXCredentials();
    const payload = {
      checkedAt: new Date().toISOString(),
      xConfig: {
        configured: xClient.isConfigured(),
        accountName: creds.accountName || '',
        hasApiKey: Boolean(creds.apiKey),
        hasApiSecret: Boolean(creds.apiSecret),
        hasAccessToken: Boolean(creds.accessToken),
        hasAccessTokenSecret: Boolean(creds.accessTokenSecret),
      },
      telegramConfig: (() => {
        const tg = telegramClient.getTelegramCredentials();
        return {
          configured: telegramClient.isConfigured(tg),
          hasBotToken: Boolean(tg.botToken),
          hasChatId: Boolean(tg.chatId),
          baseUrl: tg.baseUrl || '',
        };
      })(),
      blueskyConfig: (() => {
        const bs = blueskyClient.getBlueskyCredentials();
        return {
          configured: blueskyClient.isConfigured(bs),
          hasIdentifier: Boolean(bs.identifier),
          hasAppPassword: Boolean(bs.appPassword),
          serviceUrl: bs.serviceUrl || '',
        };
      })(),
      facebookConfig: (() => {
        const fb = metaClients.getFacebookCredentials();
        return {
          configured: metaClients.isFacebookConfigured(fb),
          hasAccessToken: Boolean(fb.accessToken),
          hasPageId: Boolean(fb.pageId),
          baseUrl: fb.baseUrl || '',
        };
      })(),
      threadsConfig: (() => {
        const th = metaClients.getThreadsCredentials();
        return {
          configured: metaClients.isThreadsConfigured(th),
          hasAccessToken: Boolean(th.accessToken),
          hasUserId: Boolean(th.userId),
          baseUrl: th.baseUrl || '',
        };
      })(),
      instagramConfig: (() => {
        const ig = metaClients.getInstagramCredentials();
        return {
          configured: metaClients.isInstagramConfigured(ig),
          hasAccessToken: Boolean(ig.accessToken),
          hasBusinessAccountId: Boolean(ig.igUserId),
          baseUrl: ig.baseUrl || '',
        };
      })(),
      queue: {
        total: posts.length,
        failed: posts.filter((post) => String(post.status || '').toLowerCase() === 'failed').length,
        scheduled: posts.filter((post) => String(post.status || '').toLowerCase() === 'scheduled').length,
        published: posts.filter((post) => String(post.status || '').toLowerCase() === 'published').length,
      },
      recentFailures: failures,
    };
    return sendOk(res, 200, payload, { diagnostics: payload }), true;
  }

  if (pathname === '/api/engage/social/posts' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const text = String(body.text || '').trim();
    const channel = String(body.channel || 'x').trim().toLowerCase() || 'x';
    const campaignId = String(body.campaignId || '').trim();
    let imageUrl = safeText(body.imageUrl);
    let imageAlt = safeText(body.imageAlt);
    const publishNow = Boolean(body.publishNow);
    const scheduledFor = String(body.scheduledFor || '').trim();
    const maxLengths = {
      x: 280,
      facebook: 63206,
      instagram: 2200,
      linkedin: 3000,
      threads: 500,
      bluesky: 300,
      pinterest: 500,
      reddit: 40000,
      telegram: 4096,
    };
    const maxLen = Number(maxLengths[channel] || 5000);

    if (!text) return sendErr(res, 400, 'Post text is required', { code: 'VALIDATION_ERROR' }), true;
    if (text.length > maxLen) return sendErr(res, 400, `${channel.toUpperCase()} posts must be ${maxLen} characters or fewer`, { code: 'VALIDATION_ERROR' }), true;
    if (channel === 'bluesky' && !imageUrl && campaignId) {
      try {
        const fallback = await resolveCampaignImageMeta(campaignId, req);
        imageUrl = safeText(fallback.imageUrl);
        imageAlt = safeText(imageAlt || fallback.imageAlt);
      } catch {
        // Leave image fields empty if fallback lookup fails.
      }
    }

    const created = socialStore.createPost({
      text,
      channel,
      campaignId,
      imageUrl,
      imageAlt,
      scheduledFor: publishNow ? '' : scheduledFor,
      status: publishNow && PUBLISH_NOW_CHANNELS.includes(channel) ? 'queued' : 'scheduled',
    });

    logActivity({
      action: publishNow ? 'engage.social.publish_now_requested' : 'engage.social.scheduled',
      entityType: 'engage_social_post',
      entityId: created.id,
      summary: publishNow ? `Publish now requested for ${channel.toUpperCase()} post` : `Scheduled ${channel.toUpperCase()} post`,
      meta: { scheduledFor: created.scheduledFor || '', channel, campaignId },
    });

    if (publishNow && PUBLISH_NOW_CHANNELS.includes(channel)) {
      const publishResult = await publishStoredPost(created, req);
      if (!publishResult.ok) {
        return sendErr(res, publishResult.status || 500, publishResult.error, {
          code: 'SOCIAL_PUBLISH_FAILED',
        }), true;
      }
      return sendOk(res, 201, publishResult.data, publishResult.data), true;
    }

    return sendOk(res, 201, { post: created }, { post: created }), true;
  }

  if (pathname === '/api/engage/social/posts/publish-due' && requestMethod === 'POST') {
    const duePosts = socialStore.listDuePosts();
    const results = [];
    for (const post of duePosts) {
      const result = await publishStoredPost(post, req);
      results.push({
        id: post.id,
        ok: !!result.ok,
        error: result.ok ? '' : String(result.error || 'Publish failed'),
      });
    }
    const posts = socialStore.listPosts();
    return sendOk(res, 200, { processed: results, posts }, { processed: results, posts }), true;
  }

  const publishMatch = String(pathname || '').match(/^\/api\/engage\/social\/posts\/([^/]+)\/publish\/?$/);
  if (publishMatch && requestMethod === 'POST') {
    const postId = decodeURIComponent(publishMatch[1] || '');
    const post = socialStore.getPost(postId);
    if (!post) return sendErr(res, 404, 'Post not found', { code: 'NOT_FOUND' }), true;
    const result = await publishStoredPost(post, req);
    if (!result.ok) return sendErr(res, result.status || 500, result.error, { code: 'SOCIAL_PUBLISH_FAILED' }), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  const postMatch = String(pathname || '').match(/^\/api\/engage\/social\/posts\/([^/]+)\/?$/);
  if (postMatch && requestMethod === 'DELETE') {
    const postId = decodeURIComponent(postMatch[1] || '');
    const deleted = socialStore.deletePost(postId);
    if (!deleted) return sendErr(res, 404, 'Post not found', { code: 'NOT_FOUND' }), true;
    logActivity({
      action: 'engage.social.deleted',
      entityType: 'engage_social_post',
      entityId: deleted.id,
      summary: `Deleted ${String(deleted.channel || '').toUpperCase() || 'social'} post from queue`,
    });
    return sendOk(res, 200, { post: deleted }, { post: deleted }), true;
  }

  return false;
}

const manifest = {
  id: 'engage',
  label: 'Engage',
  prefixes: ['/api/engage'],
};

module.exports = { handle, manifest };
