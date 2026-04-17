'use strict';

const { sendOk, sendErr } = require('./http');
const { getProviderValues } = require('../lib/apiSettings');

const manifest = {
  id: 'observe',
  label: 'Observe Module',
  prefixes: ['/api/observe']
};

/**
 * Perform a minimal 1-token fetch (maxResults=1) to check YouTube Data API Quota.
 */
async function pingYoutube(req, res) {
  const youtubeEnvKey = String(process.env.YOUTUBE_API_KEY || '').trim();
  const storeKey = String(getProviderValues('google')?.api_key || '').trim();
  const apiKey = youtubeEnvKey || storeKey;

  if (!apiKey) {
    return sendErr(res, 400, 'YouTube API key is not configured.', { code: 'NOT_CONFIGURED' });
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('q', 'test');
  url.searchParams.set('key', apiKey);

  try {
    const response = await fetch(url.toString(), {
      headers: { accept: 'application/json', 'user-agent': 'APH-ObservePing/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    
    const body = await response.json();

    if (!response.ok) {
      const msg = body?.error?.message || body?.error?.errors?.[0]?.message || 'YouTube API error';
      // Specifically check for quota limit strings
      const isQuota = msg.toLowerCase().includes('quota');
      return sendJson(res, 200, {
        ok: true,
        data: {
          status: isQuota ? 'exhausted' : 'error',
          message: msg,
          diagnostics: body?.error
        }
      });
    }

    return sendOk(res, 200, { status: 'healthy', message: 'Quota verified and healthy.' });
  } catch (err) {
    return sendErr(res, 500, 'Network error reaching YouTube: ' + err.message);
  }
}

/**
 * Perform a minimal fetch (GET /v1/models) to OpenAI to test API key validity.
 */
async function pingOpenai(req, res) {
  const openaiEnvKey = String(process.env.OPENAI_API_KEY || '').trim();
  const storeKey = String(getProviderValues('openai')?.api_key || '').trim();
  const apiKey = openaiEnvKey || storeKey;

  if (!apiKey) {
    return sendErr(res, 400, 'OpenAI API key is not configured.', { code: 'NOT_CONFIGURED' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    const body = await response.json();

    if (!response.ok) {
      const msg = body?.error?.message || 'OpenAI API error';
      const isQuota = msg.toLowerCase().includes('quota') || response.status === 429;
      return sendJson(res, 200, {
        ok: true,
        data: {
          status: isQuota ? 'exhausted' : 'error',
          message: msg,
          diagnostics: body?.error
        }
      });
    }

    return sendOk(res, 200, { status: 'healthy', message: 'Quota verified and healthy.' });
  } catch (err) {
    return sendErr(res, 500, 'Network error reaching OpenAI: ' + err.message);
  }
}

/**
 * Perform a minimal fetch (GET models) to Gemini to test API key validity and quota.
 */
async function pingGemini(req, res) {
  const geminiEnvKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '').trim();
  const storeKey = String(getProviderValues('gemini')?.api_key || '').trim();
  const apiKey = geminiEnvKey || storeKey;

  if (!apiKey) {
    return sendErr(res, 400, 'Gemini API key is not configured.', { code: 'NOT_CONFIGURED' });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    const body = await response.json();

    if (!response.ok) {
      const msg = body?.error?.message || 'Gemini API error';
      const isQuota = msg.toLowerCase().includes('quota') || response.status === 429;
      return sendJson(res, 200, {
        ok: true,
        data: {
          status: isQuota ? 'exhausted' : 'error',
          message: msg,
          diagnostics: body?.error
        }
      });
    }

    return sendOk(res, 200, { status: 'healthy', message: 'Quota verified and healthy.' });
  } catch (err) {
    return sendErr(res, 500, 'Network error reaching Gemini: ' + err.message);
  }
}

/**
 * Ping the OpenClaw browser automation worker root endpoint or healthcheck.
 */
async function pingOpenclaw(req, res) {
  const openclawEnvUrl = String(process.env.OPENCLAW_BASE_URL || '').trim();
  const storeUrl = String(getProviderValues('openclaw')?.base_url || '').trim();
  const baseUrl = openclawEnvUrl || storeUrl || 'http://localhost:1337'; // default local

  const openclawEnvKey = String(process.env.OPENCLAW_API_KEY || '').trim();
  const storeKey = String(getProviderValues('openclaw')?.api_key || '').trim();
  const apiKey = openclawEnvKey || storeKey;

  try {
    // Trim trailing slashes for clean /health endpoint connection
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    
    // Some basic python web servers respond to /health or we can just GET /
    const response = await fetch(`${cleanUrl}/`, {
      method: 'GET',
      headers: apiKey ? { 'x-api-key': apiKey } : {},
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
        return sendJson(res, 200, {
            ok: true, 
            data: {
                status: response.status === 401 || response.status === 403 ? 'error' : 'error', 
                message: `Connection failed with status ${response.status}`,
                diagnostics: {}
            }
        });
    }

    return sendOk(res, 200, { status: 'healthy', message: 'Worker connection active.' });
  } catch (err) {
    return sendJson(res, 200, {
        ok: true,
        data: {
            status: 'error',
            message: 'Worker is completely offline or unreachable.',
            diagnostics: { detail: err.message }
        }
    });
  }
}

// Ensure `sendJson` is accessible since it's used inside ping handles
const { sendJson } = require('./http');
const { getUsageAnalytics } = require('../lib/observeStore');

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/observe')) return false;

  const scope = {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
    projectIds: Array.isArray(req?.projectContext?.projects)
      ? req.projectContext.projects.map(p => String(p?.id || '').trim()).filter(Boolean)
      : []
  };

  if (method === 'GET') {
     if (pathname === '/api/observe/usage-reports') {
        const payload = await getUsageAnalytics(scope);
        if (!payload.ok) return sendErr(res, 500, payload.error), true;
        return sendOk(res, 200, payload.data), true;
     }
  }

  if (method === 'POST') {
    if (pathname === '/api/observe/ping-youtube') {
      await pingYoutube(req, res);
      return true;
    }
    if (pathname === '/api/observe/ping-openai') {
      await pingOpenai(req, res);
      return true;
    }
    if (pathname === '/api/observe/ping-openclaw') {
      await pingOpenclaw(req, res);
      return true;
    }
    if (pathname === '/api/observe/ping-gemini') {
      await pingGemini(req, res);
      return true;
    }
  }

  sendErr(res, 404, 'Observe endpoint not found');
  return true;
}

module.exports = { handle, manifest };
