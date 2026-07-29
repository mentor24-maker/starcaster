#!/usr/bin/env node
'use strict';

/**
 * Why is X saying "Unauthorized"?
 *
 * StarCaster signs every X request with four values (API Key, API Secret,
 * Access Token, Access Token Secret). A 401 from X means one of three very
 * different things, and X's v2 API reports all three as the same bare word
 * "Unauthorized". The v1.1 endpoint still returns a numeric code that tells
 * them apart, so this script asks both and translates the answer:
 *
 *   code 32  "Could not authenticate you"   -> signature is wrong: the API
 *            Key/Secret and the Access Token pair are not from the same app,
 *            or a value has a stray space / got truncated on paste.
 *   code 89  "Invalid or expired token"     -> the token itself was killed:
 *            X password change, app permissions edited without regenerating
 *            tokens, keys regenerated, or access revoked.
 *   code 326 / 64                           -> account locked or app suspended.
 *
 * Nothing is written anywhere, and no secret is printed — only lengths and
 * first/last four characters, which is what you need to spot a bad paste.
 *
 * Run:  node scripts/diagnose_x_auth.js
 */

try {
  const dotenv = require('dotenv');
  dotenv.config();
  dotenv.config({ path: '.env.local', override: false });
} catch (_) {
  // dotenv absent — fall back to whatever is already in the environment
}

const xClient = require('../lib/xClient');
const { getProviderCredentialDiagnostics } = require('../lib/apiSettings');

const crypto = require('crypto');

const V11_VERIFY_URL = 'https://api.twitter.com/1.1/account/verify_credentials.json';

function percentEncode(value) {
  return encodeURIComponent(String(value == null ? '' : value))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function shape(value) {
  const text = String(value || '');
  if (!text) return 'MISSING';
  const notes = [];
  if (text !== text.trim()) notes.push('HAS SURROUNDING WHITESPACE');
  if (/\s/.test(text.trim())) notes.push('CONTAINS A SPACE');
  if (/^["']|["']$/.test(text)) notes.push('WRAPPED IN QUOTES');
  if (/^AAAA/.test(text)) notes.push('LOOKS LIKE AN APP-ONLY BEARER TOKEN');
  const preview = text.length <= 8 ? '********' : `${text.slice(0, 4)}...${text.slice(-4)}`;
  return `${String(text.length).padStart(3)} chars  ${preview}${notes.length ? '  <-- ' + notes.join(', ') : ''}`;
}

/** Signed GET against the v1.1 endpoint, which returns a numeric error code. */
async function verifyV11(creds) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const base = [
    'GET',
    percentEncode(V11_VERIFY_URL),
    percentEncode(
      Object.entries(oauth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
        .join('&')
    ),
  ].join('&');
  const signature = crypto
    .createHmac('sha1', `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`)
    .update(base)
    .digest('base64');
  const header = `OAuth ${Object.entries({ ...oauth, oauth_signature: signature })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ')}`;

  const response = await fetch(V11_VERIFY_URL, {
    method: 'GET',
    headers: { Authorization: header, Accept: 'application/json' },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }
  return { status: response.status, payload };
}

const CODE_MEANINGS = {
  32: [
    'SIGNATURE REJECTED - the four values do not belong together.',
    'The API Key/Secret and the Access Token/Secret must come from the SAME app.',
    'Also check for a trailing space or a truncated paste (see shapes above).',
  ],
  89: [
    'TOKEN INVALIDATED - the key pair is fine, the access token was killed.',
    'X does this when: the account password changed; the app permissions were',
    'edited (Read -> Read and Write) without regenerating the tokens afterward;',
    'the keys were regenerated; or app access was revoked under',
    'x.com > Settings > Security and account access > Apps and sessions.',
    'Fix: developer.x.com > your app > Keys and tokens > Access Token and Secret',
    '> Regenerate, then paste both into StarCaster.',
  ],
  64: ['APP SUSPENDED - the developer app itself is suspended. Check developer.x.com for a notice.'],
  326: ['ACCOUNT TEMPORARILY LOCKED - log in at x.com and clear the lock, then retry.'],
  326.1: [],
  99: ['APP CANNOT BE AUTHENTICATED - the consumer key is not valid for this app.'],
};

(async () => {
  const diag = getProviderCredentialDiagnostics('x');
  const creds = xClient.getXCredentials();

  console.log('\n=== Where each X value is coming from ===');
  if (diag && diag.ok) {
    for (const [field, source] of Object.entries(diag.sources || {})) {
      const label = source === 'file' ? 'Settings > APIs (data/api_settings.json)'
        : source === 'env' ? `env var ${diag.envKeys[field]}`
        : 'MISSING';
      console.log(`  ${field.padEnd(22)} ${label}`);
    }
    console.log(`  runtime                ${diag.runtime.vercel ? 'Vercel ' + diag.runtime.vercelEnv : 'local'}`);
  }

  console.log('\n=== Shape of each value (no secrets printed) ===');
  console.log(`  api_key               ${shape(creds.apiKey)}`);
  console.log(`  api_secret            ${shape(creds.apiSecret)}`);
  console.log(`  access_token          ${shape(creds.accessToken)}`);
  console.log(`  access_token_secret   ${shape(creds.accessTokenSecret)}`);
  if (creds.accessToken && !creds.accessToken.includes('-')) {
    console.log('  NOTE: a real OAuth 1.0a access token looks like 1234567890-AbCd...');
    console.log('        (numeric account id, a dash, then the token). This one has no dash.');
  }

  const tokenAccountId = String(creds.accessToken || '').split('-')[0];
  if (/^\d+$/.test(tokenAccountId)) {
    console.log(`\n  The token was issued for X account id ${tokenAccountId}.`);
    console.log('  If the live check below succeeds it will name that account — confirm it is the one you meant to post from.');
  }

  console.log('\n=== Clock check (OAuth 1.0a fails if we are more than ~5 min off) ===');
  try {
    const head = await fetch('https://api.x.com/2/openapi.json', { method: 'HEAD' });
    const remote = Date.parse(head.headers.get('date') || '');
    if (remote) {
      const skew = Math.round((Date.now() - remote) / 1000);
      console.log(`  this machine is ${skew} second(s) off X's clock ${Math.abs(skew) > 240 ? '<-- TOO FAR OFF, this alone causes 401' : '(fine)'}`);
    }
  } catch (_) {
    console.log('  (could not reach X to compare clocks)');
  }

  console.log('\n=== Live check against X ===');
  const v2 = await xClient.checkAuth();
  if (v2.ok) {
    const user = v2.data && v2.data.user;
    console.log(`  v2 /users/me: OK - authenticated as @${user && user.username ? user.username : '(unknown)'}`);
    console.log('\nThese credentials are GOOD. If Promote still fails, the failure is happening');
    console.log('in a different environment (production reads its own Vercel env vars, not this file).');
    process.exit(0);
  }
  console.log(`  v2 /users/me: FAILED (${v2.status}) ${v2.error}`);

  const v11 = await verifyV11(creds);
  const errors = (v11.payload && Array.isArray(v11.payload.errors)) ? v11.payload.errors : [];
  const first = errors[0] || null;
  console.log(`  v1.1 verify_credentials: ${v11.status}${first ? ` code ${first.code} - ${first.message}` : ''}`);

  console.log('\n=== What that means ===');
  const meaning = first && CODE_MEANINGS[first.code];
  if (meaning) {
    meaning.forEach((line) => console.log('  ' + line));
  } else {
    console.log('  X did not return a recognized code. Full response:');
    console.log('  ' + JSON.stringify(v11.payload));
  }
  console.log('');
  process.exit(1);
})().catch((err) => {
  console.error('Diagnostic failed to run:', err && err.message ? err.message : err);
  process.exit(2);
});
