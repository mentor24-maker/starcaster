'use strict';

const { getProviderValues } = require('./apiSettings');

function safeText(value) {
  return String(value || '').trim();
}

function normalizeBaseUrl(raw) {
  const text = safeText(raw);
  if (!text) return '';
  return text.replace(/\/+$/, '');
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

async function callOpenClawResponses(options = {}) {
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
  if (options.user) body.user = safeText(options.user);

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
          ok: false,
          status: 401,
          error: 'OpenClaw gateway rejected the API key. Check Settings > APIs > OpenClaw Gateway API Key matches gateway.auth.token on the server.',
          data: payload,
        };
      }
      if (response.status === 404 || /endpoint_disabled|ENDPOINT_DISABLED/i.test(message)) {
        return {
          ok: false,
          status: response.status || 502,
          error: 'OpenClaw /v1/responses is disabled on the gateway. Enable gateway.http.endpoints.responses.enabled in openclaw.json and restart the gateway.',
          data: payload,
        };
      }
      return { ok: false, status: response.status || 502, error: message, data: payload };
    }
    return { ok: true, status: response.status || 200, data: payload, text: extractOpenClawOutputText(payload) };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, status: 504, error: `OpenClaw /v1/responses timed out after ${requestTimeout}ms` };
    }
    const rawMessage = safeText(err?.message);
    return {
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
};
