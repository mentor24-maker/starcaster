'use strict';

/**
 * The browser's return from a provider's sign-in, for every adapter whose
 * callback lives at `/api/connections/<provider>/callback`. Booking calendar,
 * slice 5 of 6 (SC-913) added it for Google Calendar; it names no provider, so
 * the next redirect provider that registers a path of that shape is finished
 * here too.
 *
 * (Facebook, Instagram and X still finish in routes/engage.js, because the
 * callback address each has registered with Meta or X points there and cannot
 * move without re-registering it.)
 *
 * SECURITY. The browser arriving here carries no session for us and no
 * project header, so routes/index.js lets exactly these paths through without
 * one (`isGenericCallbackPath`). What authorises the request is the SIGNED
 * STATE: the project and the user are read from it and nowhere else
 * (lib/metaOAuthState.js), and a state whose signature, expiry or provider does
 * not check out is refused before any code is exchanged.
 *
 * THE ANSWER is a small page, not a redirect. The Booking Manager opens the
 * sign-in in its own window; this page tells the window that opened it how it
 * went (postMessage, carrying only the provider, ok and a sentence, never a
 * token) and closes itself. Opened without a window behind it, it simply says
 * how it went and that the tab can be closed.
 */

const registry = require('./registry');
const { verifyOAuthState } = require('../metaOAuthState');
const { storeAccounts } = require('./completeConnection');

const PREFIX = '/api/connections/';
const MESSAGE_TYPE = 'starcaster-connection';

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

/** The registered adapter this callback path belongs to, or null. */
function adapterForCallbackPath(pathname) {
  const path = safeText(pathname);
  if (!path.startsWith(PREFIX) || !path.endsWith('/callback')) return null;
  return registry.listAdapters().find((adapter) => adapter.callbackPath === path) || null;
}

function isGenericCallbackPath(pathname) {
  return Boolean(adapterForCallbackPath(pathname));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** JSON safe inside a <script>: nothing in it can close the tag. */
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function resultPage({ provider, ok, heading, message }) {
  const payload = { type: MESSAGE_TYPE, provider, ok, message };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.25rem;color:#1f2937;line-height:1.5}h1{font-size:1.25rem}</style>
</head><body>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(message)}</p>
<p>You can close this window.</p>
<script>
(function () {
  var result = ${scriptJson(payload)};
  try { if (window.opener) { window.opener.postMessage(result, '*'); window.close(); } } catch (e) {}
})();
</script>
</body></html>`;
}

function sendPage(res, status, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(html);
}

/**
 * Finish one sign-in. `params` is the query string's URLSearchParams.
 * Always answers (never throws); returns what it decided, for the tests.
 */
async function finishRedirectCallback(req, res, pathname, params) {
  const adapter = adapterForCallbackPath(pathname);
  const entry = adapter ? registry.getEntry(adapter.provider) : null;
  const name = entry?.displayName || 'The account';
  const fail = (status, message) => {
    sendPage(res, status, resultPage({ provider: adapter?.provider || '', ok: false, heading: `${name} was not connected`, message }));
    return { ok: false, status, message };
  };
  if (!adapter) return fail(404, 'This sign-in address is not one Starcaster knows.');

  const state = verifyOAuthState(params.get('state'));
  if (!state.ok) {
    return fail(400, state.error === 'OAuth state expired'
      ? 'The sign-in took too long and expired. Please press Connect again.'
      : 'This sign-in could not be checked, so nothing was saved. Please press Connect again.');
  }
  if (state.data.provider !== adapter.provider) {
    return fail(400, 'This sign-in was started for a different service, so nothing was saved. Please press Connect again.');
  }
  const denied = safeText(params.get('error'));
  if (denied) {
    return fail(400, denied === 'access_denied'
      ? `You chose not to allow access, so ${name} was not connected.`
      : `${name} answered "${denied}", so nothing was connected. Please press Connect again.`);
  }

  const exchanged = await adapter.exchange({
    code: params.get('code'),
    redirectUri: adapter.callbackUrl(),
    state: params.get('state'),
    nonce: state.data.nonce,
  });
  if (!exchanged.ok) return fail(exchanged.status || 502, exchanged.error || `${name} refused the connection.`);

  const scope = { projectId: state.data.projectId, userId: state.data.userId };
  const stored = await storeAccounts({
    provider: adapter.provider,
    displayName: name,
    accounts: exchanged.data?.accounts,
    scope,
  });
  if (!stored.ok) return fail(stored.status || 500, `${name} said yes, but the connection could not be saved: ${stored.error}`);

  const label = safeText(stored.data.saved?.[stored.data.saved.length - 1]?.accountLabel);
  const message = label ? `Connected as ${label}.` : `${name} is connected.`;
  sendPage(res, 200, resultPage({ provider: adapter.provider, ok: true, heading: `${name} is connected`, message }));
  return { ok: true, status: 200, message };
}

module.exports = {
  MESSAGE_TYPE,
  adapterForCallbackPath,
  isGenericCallbackPath,
  finishRedirectCallback,
  resultPage,
};
