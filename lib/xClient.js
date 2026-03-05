'use strict';

const crypto = require('crypto');
const { getProviderValues } = require('./apiSettings');

const CREATE_POST_URL = 'https://api.x.com/2/tweets';

function percentEncode(value) {
  return encodeURIComponent(String(value == null ? '' : value))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function nonce() {
  return crypto.randomBytes(16).toString('hex');
}

function signingKey(consumerSecret, tokenSecret) {
  return `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
}

function baseString(method, url, params) {
  const sorted = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join('&');
  return [String(method || 'GET').toUpperCase(), percentEncode(url), percentEncode(sorted)].join('&');
}

function buildOAuthHeader(params) {
  const header = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ');
  return `OAuth ${header}`;
}

function getXCredentials() {
  const cfg = getProviderValues('x');
  return {
    apiKey: String(cfg.api_key || '').trim(),
    apiSecret: String(cfg.api_secret || '').trim(),
    accessToken: String(cfg.access_token || '').trim(),
    accessTokenSecret: String(cfg.access_token_secret || '').trim(),
    accountName: String(cfg.account_name || '').trim(),
  };
}

function isConfigured() {
  const creds = getXCredentials();
  return Boolean(creds.apiKey && creds.apiSecret && creds.accessToken && creds.accessTokenSecret);
}

async function createPost(text) {
  const creds = getXCredentials();
  if (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessTokenSecret) {
    return { ok: false, status: 400, error: 'X credentials are missing. Save API Key, API Secret, Access Token, and Access Token Secret in Settings > APIs.' };
  }

  const trimmedText = String(text || '').trim();
  if (!trimmedText) {
    return { ok: false, status: 400, error: 'Post text is required' };
  }

  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const signature = crypto
    .createHmac('sha1', signingKey(creds.apiSecret, creds.accessTokenSecret))
    .update(baseString('POST', CREATE_POST_URL, oauth))
    .digest('base64');

  const authHeader = buildOAuthHeader({ ...oauth, oauth_signature: signature });

  let response;
  try {
    response = await fetch(CREATE_POST_URL, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ text: trimmedText }),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `X request failed: ${err.message || err}` };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = Array.isArray(payload?.errors) && payload.errors.length
      ? payload.errors.map((e) => e?.message || e?.detail || JSON.stringify(e)).filter(Boolean).join(' | ')
      : (payload?.detail || payload?.title || response.statusText || 'Unknown X API error');
    return { ok: false, status: response.status, error: `X API error: ${detail}`, data: payload };
  }

  return {
    ok: true,
    status: response.status,
    data: {
      id: String(payload?.data?.id || ''),
      text: String(payload?.data?.text || trimmedText),
      raw: payload,
    },
  };
}

module.exports = {
  getXCredentials,
  isConfigured,
  createPost,
};
