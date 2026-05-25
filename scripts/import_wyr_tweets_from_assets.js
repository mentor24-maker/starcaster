#!/usr/bin/env node
'use strict';

/**
 * Create messaging tweets from image asset filenames that contain " or " / " OR ".
 *
 *   node scripts/import_wyr_tweets_from_assets.js
 *   node scripts/import_wyr_tweets_from_assets.js --apply
 *   node scripts/import_wyr_tweets_from_assets.js --apply --project-id=YOUR_PROJECT_UUID
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { listAssets, rowToAsset } = require('../lib/assetsStore');
const { listMessagingTweets, createMessagingTweet } = require('../lib/messagingTweetsStore');
const {
  DEFAULT_INCLUDES,
  normalizeIncludesDelimiter,
  isWyrImageAsset,
  parseWyrPhrasesFromAssetName,
} = require('../lib/wyrAssetTweet');
const { DEFAULT_ENGINE_VERSION, resolveWyrTweetFromAsset } = require('../lib/wyrTweetTransform');

function parseArgs(argv) {
  const args = {
    apply: false,
    force: false,
    limit: null,
    projectId: String(process.env.WYR_IMPORT_PROJECT_ID || process.env.MESSAGING_IMPORT_PROJECT_ID || '').trim(),
  };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--force') args.force = true;
    else if (raw.startsWith('--limit=')) {
      const n = Number(raw.split('=')[1]);
      args.limit = Number.isFinite(n) && n > 0 ? n : null;
    } else if (raw.startsWith('--project-id=')) {
      args.projectId = raw.split('=').slice(1).join('=').trim();
    }
  }
  return args;
}

function normalizeContent(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const includesArg = process.argv.find((a) => a.startsWith('--includes='));
  const includes = normalizeIncludesDelimiter(
    includesArg ? includesArg.split('=').slice(1).join('=') : DEFAULT_INCLUDES
  );
  const scope = args.projectId ? { projectId: args.projectId, userId: '' } : null;

  const assetsRes = await listAssets(scope);
  if (!assetsRes.ok) {
    console.error(`Could not load assets: ${assetsRes.error || assetsRes.status || 'unknown'}`);
    process.exit(1);
  }

  const candidates = (Array.isArray(assetsRes.data) ? assetsRes.data : [])
    .map(rowToAsset)
    .filter((asset) => isWyrImageAsset(asset, includes));

  if (args.limit) candidates.splice(args.limit);

  const tweetsRes = await listMessagingTweets(5000, scope);
  if (!tweetsRes.ok) {
    console.error(`Could not load tweets: ${tweetsRes.error || tweetsRes.status || 'unknown'}`);
    process.exit(1);
  }

  const existingByContent = new Set();
  const existingByAssetId = new Set();
  for (const tweet of tweetsRes.data || []) {
    const content = normalizeContent(tweet.content);
    if (content) existingByContent.add(content);
    const assetId = Number(tweet.image_asset_id || 0);
    if (assetId > 0) existingByAssetId.add(assetId);
  }

  const engineVersion = DEFAULT_ENGINE_VERSION;
  const plan = [];
  let ocrCount = 0;
  let filenameFallbackCount = 0;

  for (const asset of candidates) {
    const transformed = await resolveWyrTweetFromAsset(asset, { includes, engineVersion });
    if (!transformed.ok || !transformed.content) continue;

    if (transformed.source === 'ocr') ocrCount += 1;
    if (transformed.source === 'filename') filenameFallbackCount += 1;

    const content = transformed.content;
    const assetId = Number(asset.id || 0);
    const dupContent = existingByContent.has(normalizeContent(content));
    const dupAsset = assetId > 0 && existingByAssetId.has(assetId);
    if (!args.force && (dupContent || dupAsset)) {
      plan.push({ asset, content, source: transformed.source, action: 'skip', reason: dupAsset ? 'image_asset_id' : 'content' });
      continue;
    }
    plan.push({ asset, content, source: transformed.source, action: 'create' });
  }

  console.log(`WYR image assets (name contains Includes): ${candidates.length}`);
  console.log(`Transform v${engineVersion}: ${ocrCount} OCR, ${filenameFallbackCount} file-name fallback`);
  console.log(`Planned: ${plan.filter((p) => p.action === 'create').length} create, ${plan.filter((p) => p.action === 'skip').length} skip`);

  if (plan.length) {
    const sample = plan.find((p) => p.action === 'create') || plan[0];
    const parsed = parseWyrPhrasesFromAssetName(sample.asset.assetName, includes);
    console.log('Sample:', {
      assetName: sample.asset.assetName,
      phrases: parsed,
      source: sample.source,
      content: sample.content,
      action: sample.action,
    });
  }

  if (!args.apply) {
    console.log('Dry run only. Re-run with --apply to create tweets.');
    return;
  }

  let created = 0;
  const errors = [];
  for (const entry of plan) {
    if (entry.action !== 'create') continue;
    const { asset, content } = entry;
    const payload = {
      content,
      topic: String(asset.topic || '').trim(),
      category: String(asset.category || '').trim(),
      image_asset_id: Number(asset.id || 0) || null,
    };
    const result = await createMessagingTweet(payload, scope);
    if (result.ok) {
      created += 1;
      existingByContent.add(normalizeContent(content));
      if (payload.image_asset_id) existingByAssetId.add(payload.image_asset_id);
    } else {
      errors.push({
        assetId: asset.id,
        assetName: asset.assetName,
        error: result.error || 'Create failed',
      });
    }
  }

  console.log(`Created ${created} tweet(s).`);
  if (errors.length) {
    console.error(`Errors (${errors.length}):`, errors.slice(0, 5));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
