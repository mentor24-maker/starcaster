#!/usr/bin/env node
/**
 * Dane of Earth — BlueSky posting pipeline.
 *
 * Thin CLI wrapper around the platform's own lib/blueskyClient.js, so posts
 * go out exactly the way Promote > Social sends them — including the new
 * clickable-link facets and best-effort link-preview card.
 *
 * Usage:
 *   node scripts/doe/bluesky_post.mjs --file scripts/doe/content/bluesky-launch-ep1.txt --dry-run
 *   node scripts/doe/bluesky_post.mjs --file scripts/doe/content/bluesky-launch-ep1.txt --confirm
 *   node scripts/doe/bluesky_post.mjs --text "Hello BlueSky" --dry-run
 *
 *   --dry-run   Preview the post (text, char count, detected links). No auth,
 *               no network, no secret touched. Safe to run anytime.
 *   --confirm   Actually publish. Required for a live post — nothing goes out
 *               without it. This is public and cannot be un-posted.
 *   --image <url>      Optional image URL to attach (replaces the link card).
 *   --alt "<text>"     Alt text for --image.
 *
 * Posts must be <= 300 characters (BlueSky's limit); the client refuses longer.
 *
 * Credentials (never commit): read from .env.local in the repo root.
 *   BLUESKY_IDENTIFIER=daneofearth.bsky.social
 *   BLUESKY_APP_PASSWORD=...   (an app password from BlueSky settings, not the login password)
 *   BLUESKY_SERVICE_URL=https://bsky.social
 */
'use strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadEnvInto(file) {
  let raw;
  try { raw = readFileSync(path.join(ROOT, file), 'utf8'); }
  catch { return; }
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
}

// BlueSky credentials live in .env.local (identity: daneofearth.bsky.social).
loadEnvInto('.env.local');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');

const text = opt('text');
const file = opt('file');
let body = '';
if (typeof text === 'string') {
  body = text;
} else if (typeof file === 'string') {
  body = readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file), 'utf8').trim();
} else {
  console.error('Nothing to post. Use --file <path> or --text "...". Add --dry-run to preview or --confirm to publish.');
  process.exit(1);
}

const chars = [...body].length;
if (chars > 300) {
  console.error(`REFUSING: post is ${chars} characters (BlueSky limit is 300). Trim ${chars - 300}.`);
  console.error(`\n${body}\n`);
  process.exit(1);
}

const { buildLinkFacets, createPost } = require('../../lib/blueskyClient.js');
const links = buildLinkFacets(body).map((f) => f.features[0].uri);

if (DRY || !CONFIRM) {
  console.log(`${DRY ? 'DRY RUN' : 'PREVIEW (no --confirm, nothing sent)'} — would post to BlueSky as ${process.env.BLUESKY_IDENTIFIER || '(identity unset!)'}:\n`);
  console.log(`--- ${chars}/300 chars ---\n${body}\n`);
  console.log(links.length
    ? `Clickable link(s): ${links.join(', ')}${opt('image') ? '' : '\nA link-preview card will be attempted at post time (best-effort).'}`
    : 'No links detected in the text.');
  if (!DRY && !CONFIRM) console.log('\nThis was a preview only. Re-run with --confirm to actually publish.');
  process.exit(0);
}

// ---------------------------------------------------------------- live post --
const imageUrl = opt('image');
const options = {};
if (typeof imageUrl === 'string') {
  options.imageUrl = imageUrl;
  options.imageAlt = typeof opt('alt') === 'string' ? opt('alt') : '';
}

const result = await createPost(body, options);
if (!result.ok) {
  console.error(`FAILED (HTTP ${result.status || '?'}): ${result.error || 'unknown error'}`);
  process.exit(1);
}
const uri = result.data?.uri || '';
const rkey = uri.split('/').pop();
const handle = process.env.BLUESKY_IDENTIFIER;
console.log('Posted to BlueSky.');
if (rkey && handle) console.log(`https://bsky.app/profile/${handle}/post/${rkey}`);
console.log(`at-uri: ${uri}`);
