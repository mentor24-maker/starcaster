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
 * How OpenClaw on the Mini is doing, as the Mini last reported it.
 *
 * This used to fetch the gateway's address from the server — `localhost:1337`
 * by default, with an `x-api-key` header the gateway does not accept (it wants
 * `Authorization: Bearer`). It could never succeed: the gateway listens on the
 * Mini's 127.0.0.1 only, and production runs on Vercel, so the card read
 * "completely offline" whatever the Mini was doing — a probe that cannot
 * succeed reads as an outage (YouTube outreach 7/7, task 86bcda6dt).
 *
 * So it reports the Mini's OWN reading instead: once an hour the posting
 * worker checks the gateway and the browser's sign-in and writes the answer
 * onto the active project's outreach settings row. A reading older than
 * OPENCLAW_READING_STALE_MS is reported as stale, because the worker that
 * writes it has stopped, and that is a finding in itself.
 */
const OPENCLAW_READING_STALE_MS = 2 * 60 * 60 * 1000;

function openclawCardFromCheck(check, now = Date.now()) {
  const at = Date.parse(check?.checkedAt || '');
  if (!check?.state || !Number.isFinite(at)) {
    return {
      status: 'error',
      message: 'No reading from the Mini yet: the YouTube outreach worker has never checked OpenClaw for this project.',
    };
  }
  const when = new Date(at).toISOString();
  if (now - at > OPENCLAW_READING_STALE_MS) {
    return {
      status: 'error',
      message: `The Mini has not reported since ${when} — the YouTube outreach worker may be stopped. Last reading: ${check.message}`,
      diagnostics: { state: check.state, checkedAt: when },
    };
  }
  return {
    status: check.state === 'signed_in' ? 'healthy' : 'error',
    message: `${check.message} (checked ${when})`,
    diagnostics: { state: check.state, checkedAt: when, signedInAt: check.signedInAt || null },
  };
}

async function pingOpenclaw(req, res) {
  const scope = {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
  };
  const settings = await require('../lib/youtubeOutreachStore').getSettings(scope);
  if (!settings.ok) {
    return sendJson(res, 200, {
      ok: true,
      data: { status: 'error', message: `The Mini's last reading could not be read: ${settings.error}`, diagnostics: {} },
    });
  }
  return sendJson(res, 200, { ok: true, data: openclawCardFromCheck(settings.data.browserCheck) });
}

// Ensure `sendJson` is accessible since it's used inside ping handles
const { sendJson } = require('./http');
const { getUsageAnalytics, getAiSpendSummary, recordPageView, listPageViews } = require('../lib/observeStore');

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
     if (pathname === '/api/observe/ai-spend') {
        const payload = await getAiSpendSummary(20000, scope, req.query?.since || null);
        if (!payload.ok) return sendErr(res, 500, payload.error), true;
        return sendOk(res, 200, payload.data), true;
     }
     if (pathname === '/api/observe/page-views') {
        const payload = await listPageViews(req.query?.limit || 1000, scope);
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
    if (pathname === '/api/observe/page-views') {
      const { parseJsonBody } = require('./http');
      const body = await parseJsonBody(req);
      const pageId = body.pageId || body.page_id;
      if (!pageId) return sendErr(res, 400, "pageId is required"), true;
      await recordPageView(pageId, scope);
      return sendOk(res, 200, { success: true }), true;
    }
  }

  sendErr(res, 404, 'Observe endpoint not found');
  return true;
}

module.exports = { handle, manifest, openclawCardFromCheck, OPENCLAW_READING_STALE_MS };
