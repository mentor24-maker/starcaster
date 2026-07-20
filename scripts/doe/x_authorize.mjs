#!/usr/bin/env node
/**
 * One-time authorizer: get an X access token for @DaneOfEarth under the
 * existing Starcaster.pro app (PIN-based OAuth 1.0a, no callback server).
 *
 * Run it in a terminal:  node scripts/doe/x_authorize.mjs
 *
 * Steps it walks you through:
 *   1. Prints an authorize URL. Open it in a browser where you are logged
 *      into X as @DaneOfEarth (check the avatar before approving!).
 *   2. Approve the app; X shows a numeric PIN.
 *   3. Paste the PIN back into the terminal.
 *   4. The script writes the new token to .env.doe (gitignored).
 *
 * Consumer keys are read from .env.local (the platform's existing app keys).
 * Nothing in .env.local is modified.
 */
'use strict';
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadEnv(file) {
  const env = {};
  let raw;
  try { raw = readFileSync(path.join(ROOT, file), 'utf8'); }
  catch { return env; }
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return env;
}

const platform = loadEnv('.env.local');
if (!platform.X_API_KEY || !platform.X_API_SECRET) {
  console.error('X_API_KEY / X_API_SECRET not found in .env.local — cannot continue.');
  process.exit(1);
}

const pctEncode = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function oauthHeader(method, url, extraParams = {}, tokenSecret = '') {
  const params = {
    oauth_consumer_key: platform.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...extraParams,
  };
  const paramString = Object.keys(params).sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(params[k])}`).join('&');
  const base = [method, pctEncode(url), pctEncode(paramString)].join('&');
  const key = `${pctEncode(platform.X_API_SECRET)}&${pctEncode(tokenSecret)}`;
  params.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(params).sort()
    .map((k) => `${pctEncode(k)}="${pctEncode(params[k])}"`).join(', ');
}

async function oauthPost(url, extraParams, tokenSecret) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: oauthHeader('POST', url, extraParams, tokenSecret) },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${body}`);
  return Object.fromEntries(new URLSearchParams(body));
}

// X's OAuth 1.0a endpoints live on api.x.com (api.twitter.com is the legacy alias).
async function withFallback(pathname, extraParams, tokenSecret) {
  try {
    return await oauthPost(`https://api.x.com${pathname}`, extraParams, tokenSecret);
  } catch (err) {
    console.error(`api.x.com failed (${err.message.slice(0, 120)}…) — retrying legacy host`);
    return oauthPost(`https://api.twitter.com${pathname}`, extraParams, tokenSecret);
  }
}

console.log('Step 1/3: requesting a temporary token from X…');
const reqTok = await withFallback('/oauth/request_token', { oauth_callback: 'oob' }, '');

console.log('\nStep 2/3: open this URL in a browser logged in as @DaneOfEarth');
console.log('          (check the avatar in the corner BEFORE approving):\n');
console.log(`  https://api.x.com/oauth/authorize?oauth_token=${reqTok.oauth_token}\n`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pin = (await rl.question('Step 3/3: enter the PIN shown after approving: ')).trim();
rl.close();

const access = await withFallback('/oauth/access_token',
  { oauth_token: reqTok.oauth_token, oauth_verifier: pin }, reqTok.oauth_token_secret);

console.log(`\nAuthorized as @${access.screen_name}`);
if (access.screen_name?.toLowerCase() !== 'daneofearth') {
  console.log('⚠️  That is NOT @DaneOfEarth. If you approved from the wrong account,');
  console.log('   just run this script again from a browser session logged into @DaneOfEarth.');
}

const out = [
  '# Dane of Earth launch posting identity (written by scripts/doe/x_authorize.mjs)',
  `X_API_KEY=${platform.X_API_KEY}`,
  `X_API_SECRET=${platform.X_API_SECRET}`,
  `X_ACCESS_TOKEN=${access.oauth_token}`,
  `X_ACCESS_SECRET=${access.oauth_token_secret}`,
  `X_ACCOUNT_NAME=${access.screen_name}`,
  '',
].join('\n');
writeFileSync(path.join(ROOT, '.env.doe'), out);
console.log(`\nWrote .env.doe — posting identity is @${access.screen_name}.`);
console.log('Test with: node scripts/doe/x_post.mjs --text "..." --dry-run');
