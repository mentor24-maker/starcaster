'use strict';

const { listAssets, rowToAsset } = require('./assetsStore');
const { listMessagingTweets, createMessagingTweet } = require('./messagingTweetsStore');
const { listMessagingHeadlines, createMessagingHeadline } = require('./messagingHeadlinesStore');
const {
  DEFAULT_INCLUDES,
  normalizeIncludesDelimiter,
  isWyrImageAsset,
} = require('./wyrAssetTweet');
const {
  DEFAULT_ENGINE_VERSION,
  normalizeEngineVersion,
  resolveWyrTweetFromAsset,
} = require('./wyrTweetTransform');
const {
  resolveHeadlineFromImageAsset,
  resolveHeadlineFromTweetContent,
  isHeadlineImportImageAsset,
  tweetContentMatchesIncludes,
} = require('./headlineImportTransform');
const { rowToTweet } = require('./messagingTweetsStore');

const FIELD_TYPE_OPTIONS = [
  { id: 'image', label: 'Image', group: 'Assets' },
  { id: 'video', label: 'Video', group: 'Assets' },
  { id: 'audio', label: 'Audio', group: 'Assets' },
  { id: 'lead_magnet', label: 'PDF', group: 'Assets' },
  { id: 'file', label: 'File', group: 'Assets' },
  { id: 'tweet', label: 'Tweet', group: 'Messaging' },
  { id: 'headline', label: 'Headline', group: 'Messaging' },
  { id: 'subheading', label: 'Sub-heading', group: 'Messaging' },
  { id: 'tagline', label: 'Tagline', group: 'Messaging' },
  { id: 'pitch', label: 'Pitch', group: 'Messaging' },
  { id: 'article', label: 'Article', group: 'Messaging' },
  { id: 'email', label: 'Email', group: 'Messaging' },
  { id: 'post', label: 'Post', group: 'Messaging' },
  { id: 'hashtag', label: 'Hashtag', group: 'Messaging' },
];

const IMPORT_TARGETS = {
  tweet: {
    toType: 'tweet',
    fromType: 'image',
    list: listMessagingTweets,
    create: createMessagingTweet,
    resolveContent: resolveWyrTweetFromAsset,
    skipByAssetId: true,
    buildCreatePayload: (entry) => ({
      content: entry.content,
      topic: entry.topic,
      category: entry.category,
      image_asset_id: entry.assetId || null,
    }),
    readExisting: (row) => ({
      content: row.content,
      assetId: Number(row.image_asset_id || 0),
    }),
  },
  headline: {
    toType: 'headline',
    fromType: 'image',
    list: listMessagingHeadlines,
    create: createMessagingHeadline,
    resolveContent: (asset) => Promise.resolve(resolveHeadlineFromImageAsset(asset)),
    skipByAssetId: false,
    buildCreatePayload: (entry) => ({
      headline: entry.content,
      topic: entry.topic,
      category: entry.category,
    }),
    readExisting: (row) => ({
      content: row.headline,
      assetId: 0,
    }),
  },
};

const HANDLERS = {
  'image:tweet': (options) => runImageToMessagingImport('tweet', options),
  'image:headline': (options) => runImageToMessagingImport('headline', options),
  'tweet:headline': (options) => runTweetToHeadlineImport(options),
};

function normalizeContent(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeApplyPlan(inputPlan, fallbackPlan) {
  const raw = Array.isArray(inputPlan) ? inputPlan : [];
  if (!raw.length) return fallbackPlan;
  return raw
    .map((entry) => ({
      assetId: Number(entry.assetId || entry.asset_id || 0) || 0,
      assetName: String(entry.assetName || entry.asset_name || '').trim(),
      content: String(entry.content || entry.headline || '').trim(),
      topic: String(entry.topic || '').trim(),
      category: String(entry.category || '').trim(),
      source: String(entry.source || '').trim(),
    }))
    .filter((entry) => Boolean(String(entry.content || entry.headline || '').trim()));
}

function pairKey(fromType, toType) {
  return `${String(fromType || '').trim().toLowerCase()}:${String(toType || '').trim().toLowerCase()}`;
}

function getHandler(fromType, toType) {
  return HANDLERS[pairKey(fromType, toType)] || null;
}

function isSupportedPair(fromType, toType) {
  return Boolean(getHandler(fromType, toType));
}

function hintForPair(fromType, toType) {
  const key = pairKey(fromType, toType);
  if (key === 'image:tweet') {
    return 'Matching images become Would You Rather… tweets: OCR options (v2), file-name fallback, plus a follow-up teaser.';
  }
  if (key === 'image:headline') {
    return 'Matching images become headlines: use Caption when set, otherwise title-case the file name (lowercase stop words).';
  }
  if (key === 'tweet:headline') {
    return 'Matching tweets become headlines: WYR tweets use the main question only; others use the first statement (skip if over 20 words).';
  }
  return 'This import combination is not available yet.';
}

function listSupportedPairs() {
  return [
    { fromType: 'image', toType: 'tweet', engineVersion: DEFAULT_ENGINE_VERSION },
    { fromType: 'image', toType: 'headline' },
    { fromType: 'tweet', toType: 'headline' },
  ];
}

async function runImageToMessagingImport(targetKey, options = {}) {
  const target = IMPORT_TARGETS[targetKey];
  if (!target) {
    return { ok: false, status: 400, error: `Unknown import target: ${targetKey}` };
  }

  const scope = options.scope || null;
  const includes = normalizeIncludesDelimiter(options.includes);
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const engineVersion = normalizeEngineVersion(options.engineVersion);

  const assetsRes = await listAssets(scope);
  if (!assetsRes.ok) {
    return { ok: false, status: assetsRes.status || 500, error: assetsRes.error || 'Could not load assets' };
  }

  const candidates = (Array.isArray(assetsRes.data) ? assetsRes.data : [])
    .map(rowToAsset)
    .filter((asset) => (
      targetKey === 'headline'
        ? isHeadlineImportImageAsset(asset, includes)
        : isWyrImageAsset(asset, includes)
    ));

  const existingRes = await target.list(5000, scope);
  if (!existingRes.ok) {
    return { ok: false, status: existingRes.status || 500, error: existingRes.error || 'Could not load existing items' };
  }

  const existingByContent = new Set();
  const existingByAssetId = new Set();
  for (const row of existingRes.data || []) {
    const existing = target.readExisting(row);
    const content = normalizeContent(existing.content);
    if (content) existingByContent.add(content);
    const assetId = Number(existing.assetId || 0);
    if (target.skipByAssetId && assetId > 0) existingByAssetId.add(assetId);
  }

  const plan = [];
  let ocrCount = 0;
  let filenameFallbackCount = 0;
  let captionCount = 0;
  let filenameHeadlineCount = 0;
  let transformErrors = 0;

  for (const asset of candidates) {
    const assetId = Number(asset.id || 0);
    const transformed = await target.resolveContent(asset, {
      includes,
      engineVersion,
      ocr: options.ocr,
    });

    if (!transformed.ok || !transformed.content) {
      if (transformed.skipReason) {
        plan.push({
          assetId,
          assetName: asset.assetName,
          action: 'skip',
          reason: transformed.skipReason,
          error: transformed.error || '',
        });
      } else {
        transformErrors += 1;
        plan.push({
          assetId,
          assetName: asset.assetName,
          action: 'error',
          error: transformed.error || 'Transform failed',
        });
      }
      continue;
    }

    if (transformed.source === 'ocr') ocrCount += 1;
    if (targetKey === 'tweet' && transformed.source === 'filename') filenameFallbackCount += 1;
    if (transformed.source === 'caption') captionCount += 1;
    if (targetKey === 'headline' && transformed.source === 'filename') filenameHeadlineCount += 1;

    const content = transformed.content;
    const dupContent = existingByContent.has(normalizeContent(content));
    const dupAsset = target.skipByAssetId && assetId > 0 && existingByAssetId.has(assetId);
    if (!force && (dupContent || dupAsset)) {
      plan.push({
        assetId,
        assetName: asset.assetName,
        content,
        source: transformed.source,
        action: 'skip',
        reason: dupAsset ? 'image_asset_id' : 'content',
      });
      continue;
    }
    plan.push({
      assetId,
      assetName: asset.assetName,
      content,
      source: transformed.source,
      phraseA: transformed.phraseA,
      phraseB: transformed.phraseB,
      action: 'create',
      category: String(asset.category || '').trim(),
      topic: String(asset.topic || '').trim(),
    });
  }

  const toCreate = plan.filter((entry) => entry.action === 'create');
  const preview = toCreate.slice(0, 3).map((entry) => ({
    assetId: entry.assetId,
    assetName: entry.assetName,
    content: entry.content,
    source: entry.source,
  }));
  const applyPlan = toCreate.map((entry) => ({
    assetId: entry.assetId,
    assetName: entry.assetName,
    content: entry.content,
    topic: entry.topic,
    category: entry.category,
    source: entry.source,
  }));

  const resultData = {
    fromType: target.fromType,
    toType: target.toType,
    includes,
    engineVersion,
    matched: candidates.length,
    skipped: plan.filter((entry) => entry.action === 'skip').length,
    planned: toCreate.length,
    ocrCount,
    filenameFallbackCount,
    captionCount,
    filenameHeadlineCount,
    transformErrors,
    preview,
  };

  if (dryRun) {
    return {
      ok: true,
      status: 200,
      data: {
        ...resultData,
        created: 0,
        plan: applyPlan,
        errors: [],
      },
    };
  }

  const entriesToCreate = normalizeApplyPlan(options.plan, applyPlan);

  let created = 0;
  const errors = [];
  for (const entry of entriesToCreate) {
    const result = await target.create(target.buildCreatePayload(entry), scope);
    if (result.ok) {
      created += 1;
      existingByContent.add(normalizeContent(entry.content));
      if (target.skipByAssetId && entry.assetId) existingByAssetId.add(entry.assetId);
    } else {
      errors.push({
        assetId: entry.assetId,
        assetName: entry.assetName,
        error: result.error || 'Create failed',
      });
    }
  }

  return {
    ok: errors.length === 0,
    status: errors.length ? 500 : 200,
    data: {
      ...resultData,
      created,
      errors,
    },
    error: errors.length ? errors[0].error : '',
  };
}

async function runTweetToHeadlineImport(options = {}) {
  const scope = options.scope || null;
  const includes = normalizeIncludesDelimiter(options.includes);
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);

  const tweetsRes = await listMessagingTweets(5000, scope);
  if (!tweetsRes.ok) {
    return { ok: false, status: tweetsRes.status || 500, error: tweetsRes.error || 'Could not load tweets' };
  }

  const candidates = (Array.isArray(tweetsRes.data) ? tweetsRes.data : [])
    .map(rowToTweet)
    .filter((tweet) => tweetContentMatchesIncludes(tweet?.content, includes));

  const existingRes = await listMessagingHeadlines(5000, scope);
  if (!existingRes.ok) {
    return { ok: false, status: existingRes.status || 500, error: existingRes.error || 'Could not load headlines' };
  }

  const existingByContent = new Set();
  for (const row of existingRes.data || []) {
    const content = normalizeContent(row.headline);
    if (content) existingByContent.add(content);
  }

  const plan = [];
  let wyrCount = 0;
  let firstStatementCount = 0;
  let transformErrors = 0;

  for (const tweet of candidates) {
    const tweetId = Number(tweet.id || 0);
    const transformed = resolveHeadlineFromTweetContent(tweet.content);

    if (!transformed.ok || !transformed.content) {
      if (transformed.skipReason) {
        plan.push({
          tweetId,
          tweetPreview: String(tweet.content || '').slice(0, 80),
          action: 'skip',
          reason: transformed.skipReason,
          error: transformed.error || '',
        });
      } else {
        transformErrors += 1;
        plan.push({
          tweetId,
          tweetPreview: String(tweet.content || '').slice(0, 80),
          action: 'error',
          error: transformed.error || 'Transform failed',
        });
      }
      continue;
    }

    if (transformed.source === 'wyr') wyrCount += 1;
    if (transformed.source === 'first_statement') firstStatementCount += 1;

    const content = transformed.content;
    if (!force && existingByContent.has(normalizeContent(content))) {
      plan.push({
        tweetId,
        tweetPreview: String(tweet.content || '').slice(0, 80),
        content,
        source: transformed.source,
        action: 'skip',
        reason: 'content',
      });
      continue;
    }

    plan.push({
      tweetId,
      tweetPreview: String(tweet.content || '').slice(0, 80),
      content,
      source: transformed.source,
      action: 'create',
      topic: String(tweet.topic || '').trim(),
      category: String(tweet.category || '').trim(),
    });
  }

  const toCreate = plan.filter((entry) => entry.action === 'create');
  const preview = toCreate.slice(0, 3).map((entry) => ({
    tweetId: entry.tweetId,
    content: entry.content,
    source: entry.source,
  }));
  const applyPlan = toCreate.map((entry) => ({
    tweetId: entry.tweetId,
    content: entry.content,
    topic: entry.topic,
    category: entry.category,
    source: entry.source,
  }));

  const resultData = {
    fromType: 'tweet',
    toType: 'headline',
    includes,
    matched: candidates.length,
    skipped: plan.filter((entry) => entry.action === 'skip').length,
    planned: toCreate.length,
    wyrCount,
    firstStatementCount,
    transformErrors,
    preview,
  };

  if (dryRun) {
    return {
      ok: true,
      status: 200,
      data: {
        ...resultData,
        created: 0,
        plan: applyPlan,
        errors: [],
      },
    };
  }

  const entriesToCreate = normalizeApplyPlan(options.plan, applyPlan);
  let created = 0;
  const errors = [];
  for (const entry of entriesToCreate) {
    const result = await createMessagingHeadline({
      headline: entry.content,
      topic: entry.topic,
      category: entry.category,
    }, scope);
    if (result.ok) {
      created += 1;
      existingByContent.add(normalizeContent(entry.content));
    } else {
      errors.push({
        tweetId: entry.tweetId,
        error: result.error || 'Create failed',
      });
    }
  }

  return {
    ok: errors.length === 0,
    status: errors.length ? 500 : 200,
    data: {
      ...resultData,
      created,
      errors,
    },
    error: errors.length ? errors[0].error : '',
  };
}

async function runAssetFieldImport(input, scope = null) {
  const fromType = String(input?.fromType ?? input?.from_type ?? '').trim().toLowerCase();
  const toType = String(input?.toType ?? input?.to_type ?? '').trim().toLowerCase();
  const includes = normalizeIncludesDelimiter(input?.includes);
  const dryRun = Boolean(input?.dryRun ?? input?.dry_run);
  const force = Boolean(input?.force);
  const engineVersion = normalizeEngineVersion(
    input?.engineVersion ?? input?.engine_version
  );

  if (!fromType || !toType) {
    return { ok: false, status: 400, error: 'fromType and toType are required' };
  }
  if (!includes) {
    return { ok: false, status: 400, error: 'includes is required' };
  }

  const handler = getHandler(fromType, toType);
  if (!handler) {
    return {
      ok: false,
      status: 400,
      error: `Import from ${fromType} to ${toType} is not supported yet`,
    };
  }

  return handler({
    scope,
    includes,
    dryRun,
    force,
    engineVersion,
    ocr: input?.ocr,
    plan: input?.plan,
  });
}

module.exports = {
  DEFAULT_INCLUDES,
  DEFAULT_ENGINE_VERSION,
  FIELD_TYPE_OPTIONS,
  listSupportedPairs,
  getHandler,
  isSupportedPair,
  hintForPair,
  runAssetFieldImport,
  runImageToMessagingImport,
  runTweetToHeadlineImport,
};
