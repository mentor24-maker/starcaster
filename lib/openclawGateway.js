const crypto = require('crypto');
const { getProviderValues } = require('./apiSettings');

const ACTIONS = new Set(['create_job', 'preview_job', 'approve_job', 'execute_job', 'job_status']);
const DEFAULT_ROLE_BY_ACTION = {
  create_job: 'operator',
  preview_job: 'marketer',
  approve_job: 'approver',
  execute_job: 'approver',
  job_status: 'operator'
};

function normalizeBaseUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.replace(/\/+$/, '');
}

function requireManualConfirmation(body) {
  if (!body || body.manual_confirmed !== true) {
    return { ok: false, status: 400, error: 'manual_confirmed=true is required' };
  }
  return { ok: true };
}

function routeForAction(action, body) {
  const jobId = String(body?.job_id || '').trim();
  if (action === 'create_job') return { method: 'POST', path: '/api/v1/jobs' };
  if (!jobId) return { error: 'job_id is required' };
  if (action === 'preview_job') return { method: 'POST', path: `/api/v1/jobs/${encodeURIComponent(jobId)}/preview` };
  if (action === 'approve_job') return { method: 'POST', path: `/api/v1/jobs/${encodeURIComponent(jobId)}/approve` };
  if (action === 'execute_job') return { method: 'POST', path: `/api/v1/jobs/${encodeURIComponent(jobId)}/execute` };
  if (action === 'job_status') return { method: 'GET', path: `/api/v1/jobs/${encodeURIComponent(jobId)}/status` };
  return { error: 'Unsupported action' };
}

function bodyForAction(action, input) {
  const body = { ...(input || {}) };
  delete body.manual_confirmed;
  delete body.role;
  if (action === 'job_status') {
    return undefined;
  }
  if (action === 'create_job') {
    return body;
  }
  delete body.job_id;
  return body;
}

function roleForAction(action, body) {
  const requested = String(body?.role || '').trim().toLowerCase();
  if (requested) return requested;
  return DEFAULT_ROLE_BY_ACTION[action] || 'operator';
}

function incompatibilityMessage(action, status, parsed) {
  const raw = parsed?.error?.message || parsed?.error || parsed?.raw || '';
  const detail = String(raw || '').trim();
  if (action === 'create_job' && status === 405) {
    return 'This OpenClaw gateway does not expose the legacy StarCaster job API (`POST /api/v1/jobs`). Use OpenResponses (`POST /v1/responses`) instead — Facebook Personal publishing in Promote Social already uses that path. Other Acquire/OpenClaw job actions may still require a gateway with the legacy job API or a future StarCaster adapter.';
  }
  if (action === 'job_status' && status === 405) {
    return 'This OpenClaw gateway does not expose the legacy StarCaster job status API. Facebook Personal status checks use OpenResponses (`POST /v1/responses`) via Promote Social.';
  }
  return detail || '';
}

async function relayOpenClaw(action, body) {
  if (!ACTIONS.has(action)) {
    return { ok: false, status: 400, error: 'Unsupported action' };
  }

  const guard = requireManualConfirmation(body);
  if (!guard.ok) return guard;

  const cfg = getProviderValues('openclaw');
  const baseUrl = normalizeBaseUrl(cfg.base_url);
  if (!baseUrl) {
    return { ok: false, status: 400, error: 'OpenClaw API is not configured in Settings > APIs' };
  }

  const routing = routeForAction(action, body);
  if (routing.error) {
    return { ok: false, status: 400, error: routing.error };
  }

  const timeoutMs = Number(cfg.timeout_ms || 30000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 30000);

  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID()
  };

  if (cfg.api_key) {
    headers.Authorization = `Bearer ${cfg.api_key}`;
  }
  headers['x-role'] = roleForAction(action, body);

  const outboundBody = bodyForAction(action, body);

  try {
    const response = await fetch(`${baseUrl}${routing.path}`, {
      method: routing.method,
      headers,
      body: outboundBody ? JSON.stringify(outboundBody) : undefined,
      signal: controller.signal
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!response.ok) {
      const incompatible = incompatibilityMessage(action, response.status, parsed);
      return {
        ok: false,
        status: response.status,
        error: incompatible || parsed?.error?.message || parsed?.error || `OpenClaw request failed (${response.status})`,
        data: parsed
      };
    }

    return { ok: true, status: response.status, data: parsed };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, status: 504, error: 'OpenClaw request timed out' };
    }
    const rawMessage = String(err?.message || '').trim();
    const message = rawMessage === 'fetch failed'
      ? `Failed to reach OpenClaw at ${baseUrl}. Confirm the gateway is running and reachable.`
      : (rawMessage ? `${rawMessage} (${baseUrl})` : `Failed to reach OpenClaw at ${baseUrl}`);
    return { ok: false, status: 502, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  relayOpenClaw
};
