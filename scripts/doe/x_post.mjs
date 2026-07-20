#!/usr/bin/env node
/**
 * Dane of Earth — X (Twitter) posting pipeline.
 *
 * Posts a single post or a numbered thread to X via the v2 API using
 * OAuth 1.0a user context (no external dependencies).
 *
 * Usage:
 *   node scripts/doe/x_post.mjs --text "Hello world"
 *   node scripts/doe/x_post.mjs --file content/launch-day1.txt
 *   node scripts/doe/x_post.mjs --file content/normie-thread.txt --thread
 *   node scripts/doe/x_post.mjs --delete <post id>     (remove a post)
 *   Add --dry-run to print what would be posted without posting.
 *
 * Thread files: separate posts with a line containing only "---".
 * Each post must be <= 280 characters; the script refuses to send otherwise.
 *
 * Credentials (never commit): .env.doe in the repo root, gitignored via .env.*
 *   X_API_KEY=...          (Consumer Key)
 *   X_API_SECRET=...       (Consumer Secret)
 *   X_ACCESS_TOKEN=...     (Access Token   — generate AFTER app permissions
 *   X_ACCESS_SECRET=...     Access Secret     are set to "Read and write")
 */
'use strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
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

const env = loadEnv('.env.doe');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const DRY = args.includes('--dry-run');
const THREAD = args.includes('--thread');

// ------------------------------------------------------------- gather posts --
const deleteId = opt('delete');
let posts = [];
const text = opt('text');
const file = opt('file');
if (typeof deleteId === 'string') {
  posts = []; // handled after credential checks below
} else
if (typeof text === 'string') {
  posts = [text];
} else if (typeof file === 'string') {
  const body = readFileSync(file, 'utf8').trim();
  posts = THREAD
    ? body.split(/\n---\n/).map((p) => p.trim()).filter(Boolean)
    : [body];
} else {
  console.error('Nothing to post. Use --text "..." or --file <path> [--thread]. Add --dry-run to preview.');
  process.exit(1);
}

const tooLong = posts.filter((p) => [...p].length > 280);
if (tooLong.length) {
  console.error(`REFUSING: ${tooLong.length} post(s) exceed 280 characters:`);
  for (const p of tooLong) console.error(`  (${[...p].length} chars) ${p.slice(0, 60)}…`);
  process.exit(1);
}

if (DRY) {
  console.log(`DRY RUN — would post ${posts.length} post(s)${THREAD ? ' as a thread' : ''}:\n`);
  posts.forEach((p, i) => console.log(`--- ${i + 1}/${posts.length} (${[...p].length} chars) ---\n${p}\n`));
  process.exit(0);
}

// --------------------------------------------------------------- credentials --
const missing = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing credentials in .env.doe: ${missing.join(', ')}`);
  console.error('Get them from the app "Keys and tokens" tab at console.x.com (set app to Read and write FIRST).');
  process.exit(1);
}

// ----------------------------------------------------------- OAuth 1.0a sign --
const pctEncode = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function oauthHeader(method, url) {
  const params = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };
  const paramString = Object.keys(params).sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(params[k])}`).join('&');
  const base = [method, pctEncode(url), pctEncode(paramString)].join('&');
  const signingKey = `${pctEncode(env.X_API_SECRET)}&${pctEncode(env.X_ACCESS_SECRET)}`;
  params.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  return 'OAuth ' + Object.keys(params).sort()
    .map((k) => `${pctEncode(k)}="${pctEncode(params[k])}"`).join(', ');
}

// ------------------------------------------------------------------- delete --
const API = 'https://api.x.com/2/tweets';
if (typeof deleteId === 'string') {
  const url = `${API}/${deleteId}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: oauthHeader('DELETE', url) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Delete FAILED (HTTP ${res.status}):`, JSON.stringify(body));
    process.exit(1);
  }
  console.log(`Deleted post ${deleteId}.`);
  process.exit(0);
}

// --------------------------------------------------------------------- post --
let replyTo = null;
for (let i = 0; i < posts.length; i += 1) {
  const payload = { text: posts[i] };
  if (replyTo) payload.reply = { in_reply_to_tweet_id: replyTo };
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: oauthHeader('POST', API), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`FAILED on post ${i + 1}/${posts.length} (HTTP ${res.status}):`, JSON.stringify(body));
    if (replyTo) console.error(`Thread partially posted — last successful id: ${replyTo}`);
    process.exit(1);
  }
  replyTo = body.data.id;
  console.log(`Posted ${i + 1}/${posts.length}: https://x.com/i/status/${replyTo}`);
  if (i < posts.length - 1) await new Promise((r) => setTimeout(r, 2000));
}
console.log('Done.');
