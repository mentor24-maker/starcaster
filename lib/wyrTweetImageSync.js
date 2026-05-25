'use strict';

const { listAssets, rowToAsset } = require('./assetsStore');
const { listMessagingTweets, updateMessagingTweet, rowToTweet } = require('./messagingTweetsStore');
const { ocrAssetForWyr } = require('./wyrTweetOcr');
const { parseWyrTweetContent, isWyrTweetContent } = require('./wyrTweetContent');
const { buildWyrTweetContentFromPhrases } = require('./wyrTweetTransform');

function normalizeContent(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function buildTweetContentFromOcr(phraseA, phraseB, tweetId, options = {}) {
  const preserveFollowUp = Boolean(options.preserveFollowUp);
  const existing = options.existingContent ? parseWyrTweetContent(options.existingContent) : null;
  if (preserveFollowUp && existing?.followUp) {
    const { formatWyrTweetWithFollowUp } = require('./wyrTweetContent');
    return formatWyrTweetWithFollowUp(phraseA, phraseB, existing.followUp);
  }
  return buildWyrTweetContentFromPhrases(phraseA, phraseB, tweetId);
}

async function syncWyrTweetFromImage(tweet, assetById, scope, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const tweetId = Number(tweet?.id || 0);
  const assetId = Number(tweet?.image_asset_id || 0);
  if (!tweetId) {
    return { ok: false, status: 400, error: 'Tweet id is required' };
  }
  if (!assetId) {
    return { ok: false, status: 400, error: 'Tweet has no linked image' };
  }

  const asset = assetById.get(assetId) || null;
  if (!asset) {
    return { ok: false, status: 404, error: `Asset ${assetId} not found` };
  }

  const ocr = await ocrAssetForWyr(asset, options.ocr || {});
  if (!ocr.ok) {
    return {
      ok: false,
      status: ocr.status || 500,
      error: ocr.error || 'OCR failed',
      debug: ocr.debug,
    };
  }

  const { phraseA, phraseB, rawText } = ocr.data;
  const nextContent = buildTweetContentFromOcr(phraseA, phraseB, tweetId, {
    preserveFollowUp: options.preserveFollowUp,
    existingContent: tweet.content,
  });
  const previous = String(tweet.content || '').trim();
  const changed = normalizeContent(previous) !== normalizeContent(nextContent);

  if (dryRun) {
    return {
      ok: true,
      status: 200,
      data: {
        tweetId,
        assetId,
        phraseA,
        phraseB,
        rawText,
        previous,
        nextContent,
        changed,
        applied: false,
      },
    };
  }

  if (!changed) {
    return {
      ok: true,
      status: 200,
      data: {
        tweetId,
        assetId,
        phraseA,
        phraseB,
        rawText,
        previous,
        nextContent,
        changed: false,
        applied: false,
        skipped: true,
      },
    };
  }

  const update = await updateMessagingTweet(
    tweetId,
    {
      content: nextContent,
      topic: tweet.topic,
      url: tweet.url,
      hashtags: tweet.hashtags,
      image_asset_id: assetId,
    },
    scope
  );

  if (!update.ok) {
    return { ok: false, status: update.status || 500, error: update.error || 'Tweet update failed' };
  }

  const updated = update.data || null;
  return {
    ok: true,
    status: 200,
    data: {
      tweetId,
      assetId,
      phraseA,
      phraseB,
      rawText,
      previous,
      nextContent: updated?.content || nextContent,
      changed: true,
      applied: true,
      tweet: updated,
    },
  };
}

async function syncAllWyrTweetsFromImages(scope, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const onlyWyr = options.onlyWyr !== false;
  const limit = Math.max(0, Number(options.limit || 0) || 0);
  const tweetId = Math.max(0, Number(options.tweetId || 0) || 0);

  const tweetsRes = await listMessagingTweets(5000, scope);
  if (!tweetsRes.ok) {
    return { ok: false, status: tweetsRes.status || 500, error: tweetsRes.error || 'Could not load tweets' };
  }

  const assetsRes = await listAssets(scope);
  if (!assetsRes.ok) {
    return { ok: false, status: assetsRes.status || 500, error: assetsRes.error || 'Could not load assets' };
  }

  const assetById = new Map(
    (Array.isArray(assetsRes.data) ? assetsRes.data : [])
      .map(rowToAsset)
      .filter(Boolean)
      .map((asset) => [Number(asset.id || 0), asset])
  );

  let candidates = (Array.isArray(tweetsRes.data) ? tweetsRes.data : [])
    .map(rowToTweet)
    .filter((tweet) => Number(tweet?.image_asset_id || 0) > 0);

  if (onlyWyr) {
    candidates = candidates.filter((tweet) => isWyrTweetContent(tweet.content));
  }

  if (tweetId > 0) {
    candidates = candidates.filter((t) => Number(t.id || 0) === tweetId);
  }

  if (limit > 0) candidates = candidates.slice(0, limit);

  const results = [];
  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const tweet of candidates) {
    if (options.onProgress) {
      options.onProgress({ tweetId: tweet.id, phase: 'ocr' });
    }
    const result = await syncWyrTweetFromImage(tweet, assetById, scope, {
      dryRun,
      preserveFollowUp: options.preserveFollowUp,
      ocr: options.ocr,
    });
    if (!result.ok) {
      failed += 1;
      results.push({
        tweetId: tweet.id,
        ok: false,
        error: result.error,
        debug: result.debug,
      });
      continue;
    }
    const row = result.data || {};
    if (row.applied) applied += 1;
    else if (row.skipped || !row.changed) skipped += 1;
    results.push({
      tweetId: tweet.id,
      ok: true,
      changed: row.changed,
      applied: row.applied,
      previous: row.previous,
      nextContent: row.nextContent,
      phraseA: row.phraseA,
      phraseB: row.phraseB,
    });
  }

  return {
    ok: failed === 0,
    status: failed ? 500 : 200,
    data: {
      matched: candidates.length,
      applied,
      skipped,
      failed,
      results,
    },
  };
}

module.exports = {
  buildTweetContentFromOcr,
  syncWyrTweetFromImage,
  syncAllWyrTweetsFromImages,
};
