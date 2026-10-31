'use strict';

const crypto = require('node:crypto');
const { getProviderValues } = require('./apiSettings');

function safeText(value) {
  return String(value || '').trim();
}

function normalizeBaseUrl(raw) {
  const text = safeText(raw);
  if (!text) return '';
  return text.replace(/\/+$/, '');
}

/**
 * EVERY REQUEST IS ITS OWN CONVERSATION. OpenClaw turns a `user` string into a
 * stable session key, so every request carrying the same label continues ONE
 * agent session and re-sends its whole history, screenshots included
 * (OpenClaw docs/gateway/openresponses-http-api.md). The sign-in check's fixed
 * label grew one session past 380 messages and emptied the Anthropic account
 * twice, Oct 29 and Oct 30, 2026 (task 86bcvhy8c). The label is kept, so the
 * Mini's log still says which job asked, and made unique per request here,
 * where every caller passes, rather than at eight call sites.
 */
function freshSessionLabel(label) {
  const text = safeText(label);
  return text ? `${text}:${crypto.randomUUID().slice(0, 8)}` : '';
}

/**
 * The job a request belongs to: its label's first two parts. Facebook adds a
 * post id (`starcaster:facebook_personal:<id>`) and every request gets a random
 * suffix above, so the label as sent would make each call its own "job".
 */
function jobLabel(label) {
  const text = safeText(label);
  return text ? text.split(':').slice(0, 2).join(':') : 'unlabelled';
}

/**
 * What one OpenClaw run spent, from the `usage` block of its response.
 *
 * OpenClaw 2026.9.8 always sends `usage`, and sends ALL ZEROS when the provider
 * reported nothing (`toOpenAiResponsesUsage(undefined)` in its dist), so a zero
 * total is "unknown", never "free" — `null` here, and the meter row says so.
 * `input_tokens` already includes the cache reads and writes, which are split
 * out so they are not counted twice.
 */
function openClawUsage(payload) {
  const u = payload && typeof payload.usage === 'object' ? payload.usage : null;
  if (!u) return null;
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const cached = n(u.input_tokens_details?.cached_tokens) + n(u.input_tokens_details?.cache_write_tokens);
  const completion = n(u.output_tokens);
  const prompt = Math.max(0, n(u.input_tokens) - cached);
  const total = Math.max(n(u.total_tokens), prompt + cached + completion);
  if (!total) return null;
  return { promptTokens: prompt, completionTokens: completion, cachedTokens: cached, totalTokens: total };
}

/**
 * One meter row per OpenClaw request (AI Quota 3/5, task 86bcvj7vc). Every AI
 * call the Mini makes goes through OpenClaw straight to Anthropic, so until
 * this none of it reached Starcaster's meter — about $35 on Oct 28–30, 2026
 * before anybody knew. The write is the same outbound Supabase call the
 * outreach worker makes for its settings rows (lib/supabase.js); nothing has
 * to reach the Mini. Never throws: a meter failure must not fail the job.
 *
 * A call with no token counts is still a row — `tokens_known: false` — so it
 * is counted and reads as "cost unknown" on the AI Quota page, never as $0.
 */
async function recordOpenClawCall({ label, ok, status, durationMs, payload } = {}) {
  try {
    const { logUsage } = require('./observeStore');
    const { USAGE_TYPE } = require('./aiUsage');
    const { OPENCLAW_MODEL } = require('./aiJobs');
    const usage = openClawUsage(payload);
    const job = jobLabel(label);
    await logUsage('openclaw', USAGE_TYPE, usage ? usage.totalTokens : 0, null, {
      model: OPENCLAW_MODEL,
      feature: job,
      job,
      ok: Boolean(ok),
      status: Number(status) || 0,
      duration_ms: Math.max(0, Math.round(Number(durationMs) || 0)),
      tokens_known: Boolean(usage),
      prompt_tokens: usage ? usage.promptTokens : 0,
      completion_tokens: usage ? usage.completionTokens : 0,
      cached_tokens: usage ? usage.cachedTokens : 0,
    });
  } catch (err) {
    console.warn('[OpenClaw] usage meter failed:', err && err.message);
  }
}

function getOpenClawConfig() {
  const cfg = getProviderValues('openclaw') || {};
  const baseUrl = normalizeBaseUrl(cfg.base_url);
  const apiKey = safeText(cfg.api_key);
  const timeoutMs = Math.max(5000, Number(cfg.timeout_ms || 0) || 120000);
  return { baseUrl, apiKey, timeoutMs };
}

function extractOpenClawOutputText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = [];
  for (const message of output) {
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const part of content) {
      const text = safeText(
        part?.text
        || part?.value
        || (typeof part?.json === 'string' ? part.json : '')
        || (part?.json && typeof part.json === 'object' ? JSON.stringify(part.json) : '')
      );
      if (text) chunks.push(text);
    }
  }
  if (chunks.length) return chunks.join('\n').trim();
  return safeText(payload?.output_text || payload?.text || payload?.message);
}

function maybeParseJson(raw) {
  try {
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function extractJsonFromText(text) {
  const raw = safeText(text);
  if (!raw) return null;
  const direct = maybeParseJson(raw);
  if (direct) return direct;
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const parsed = maybeParseJson(fencedMatch[1]);
    if (parsed) return parsed;
  }
  const startObj = raw.indexOf('{');
  const endObj = raw.lastIndexOf('}');
  if (startObj >= 0 && endObj > startObj) {
    const parsed = maybeParseJson(raw.slice(startObj, endObj + 1));
    if (parsed) return parsed;
  }
  return null;
}

/**
 * One request to OpenClaw's /v1/responses, metered. Configuration refusals
 * (no URL, no key) never reach OpenClaw and spend nothing, so they write no row;
 * everything that was actually sent — answered, refused or timed out — does.
 *
 * A BACKGROUND job's request asks the Mini's daily limit first (AI Quota 5/5,
 * lib/miniAiLimit.js) and is refused, unsent and unmetered, once today's
 * count reaches it. Here rather than at each job, so a new background caller
 * cannot be the one that forgot. `options.limitDeps` replaces its seams (tests).
 */
async function callOpenClawResponses(options = {}) {
  const gate = await require('./miniAiLimit').checkRequest(options.user, options.limitDeps || null);
  if (!gate.allowed) {
    return { ok: false, status: 429, code: gate.code, error: gate.error };
  }
  const startedAt = Date.now();
  const res = await sendOpenClawRequest(options);
  if (res && res.sent) {
    await recordOpenClawCall({
      label: options.user,
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - startedAt,
      payload: res.data,
    });
  }
  const { sent, ...result } = res;
  return result;
}

async function sendOpenClawRequest(options = {}) {
  const { baseUrl, apiKey, timeoutMs } = getOpenClawConfig();
  if (!baseUrl) {
    return { ok: false, status: 400, error: 'OpenClaw API is not configured in Settings > APIs' };
  }
  if (!apiKey) {
    return {
      ok: false,
      status: 400,
      error: 'OpenClaw Gateway API Key is required for /v1/responses (Settings > APIs > OpenClaw).',
    };
  }

  const requestTimeout = Math.max(5000, Number(options.timeoutMs || timeoutMs) || timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeout);

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'x-openclaw-agent-id': safeText(options.agentId) || 'main',
  };

  const body = {
    model: safeText(options.model) || 'openclaw',
    input: options.input,
  };
  if (options.instructions) body.instructions = safeText(options.instructions);
  const user = freshSessionLabel(options.user);
  if (user) body.user = user;

  try {
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { raw };
    }
    if (!response.ok) {
      const message = safeText(payload?.error?.message || payload?.message || payload?.error)
        || `OpenClaw /v1/responses failed (${response.status})`;
      if (response.status === 401) {
        return {
          sent: true,
          ok: false,
          status: 401,
          error: 'OpenClaw gateway rejected the API key. Check Settings > APIs > OpenClaw Gateway API Key matches gateway.auth.token on the server.',
          data: payload,
        };
      }
      if (response.status === 404 || /endpoint_disabled|ENDPOINT_DISABLED/i.test(message)) {
        return {
          sent: true,
          ok: false,
          status: response.status || 502,
          error: 'OpenClaw /v1/responses is disabled on the gateway. Enable gateway.http.endpoints.responses.enabled in openclaw.json and restart the gateway.',
          data: payload,
        };
      }
      return { sent: true, ok: false, status: response.status || 502, error: message, data: payload };
    }
    return { sent: true, ok: true, status: response.status || 200, data: payload, text: extractOpenClawOutputText(payload) };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { sent: true, ok: false, status: 504, error: `OpenClaw /v1/responses timed out after ${requestTimeout}ms` };
    }
    // Could not reach the gateway: no agent ran and nothing was spent. A timed
    // out request (above) did reach it, and may have spent, so it is metered.
    const rawMessage = safeText(err?.message);
    return {
      sent: false,
      ok: false,
      status: 502,
      error: rawMessage === 'fetch failed'
        ? `Failed to reach OpenClaw at ${baseUrl}. Confirm the gateway is running and reachable.`
        : (rawMessage || `Failed to reach OpenClaw at ${baseUrl}`),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function testOpenClawGateway() {
  const { baseUrl, apiKey } = getOpenClawConfig();
  if (!baseUrl) {
    return { ok: false, authOk: false, error: 'OpenClaw Gateway Base URL is not configured' };
  }
  if (!apiKey) {
    return { ok: false, authOk: false, error: 'OpenClaw Gateway API Key is not configured' };
  }
  const probe = await callOpenClawResponses({
    user: 'starcaster:gateway-auth-test',
    input: 'Reply with the single word OK.',
    timeoutMs: 30000,
  });
  if (!probe.ok) {
    return {
      ok: false,
      authOk: probe.status === 401,
      error: safeText(probe.error) || 'OpenClaw gateway probe failed',
      status: probe.status || 502,
      protocol: 'openresponses_v1',
      baseUrl,
    };
  }
  return {
    ok: true,
    authOk: true,
    protocol: 'openresponses_v1',
    baseUrl,
    sample: safeText(probe.text).slice(0, 120),
  };
}

module.exports = {
  getOpenClawConfig,
  callOpenClawResponses,
  extractOpenClawOutputText,
  extractJsonFromText,
  testOpenClawGateway,
  freshSessionLabel,
  jobLabel,
  openClawUsage,
  recordOpenClawCall,
};
