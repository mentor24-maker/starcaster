'use strict';

const { listAssets, rowToAsset } = require('./assetsStore');
const { listMessagingTweets, createMessagingTweet } = require('./messagingTweetsStore');
const { listMessagingHeadlines, createMessagingHeadline } = require('./messagingHeadlinesStore');
const { listMessagingPosts, createMessagingPost } = require('./messagingPostsStore');
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
const { listMessagingSubheadings, createMessagingSubheading } = require('./messagingSubheadingsStore');
const { listMessagingTaglines, createMessagingTagline } = require('./messagingTaglinesStore');
const { listMessagingPitches, createMessagingPitch } = require('./messagingPitchesStore');
const { listMessagingEmails, createMessagingEmail } = require('./messagingEmailsStore');
const { listMessagingDescriptions, createMessagingDescription } = require('./messagingDescriptionsStore');
const { listMessagingTranscripts, createMessagingTranscript } = require('./messagingTranscriptsStore');
const { listMessagingComments, createMessagingComment } = require('./messagingCommentsStore');
const { listMessagingHashtags, createMessagingHashtag } = require('./messagingHashtagsStore');
const { listMessagingCtas, createMessagingCta } = require('./messagingCtasStore');
const { listMessagingArticles, createMessagingArticle } = require('./messagingArticlesStore');
const { listMessagingReports, createMessagingReport } = require('./messagingReportsStore');
const { listMessagingWhitePapers, createMessagingWhitePaper } = require('./messagingWhitePapersStore');
const { listMessagingEbooks, createMessagingEbook } = require('./messagingEbooksStore');
const { listWebPagesForMessagingImport } = require('./webPageContentImport');
const { listMessagingKeywords, createMessagingKeyword } = require('./messagingKeywordsStore');
const { listMessagingTags, createMessagingTag } = require('./messagingTagsStore');
const { runWebPageToKeywordImport } = require('./webPageKeywordImport');
const {
  FAMILY,
  getFormatSpec,
  listFormatSlugs,
  getSourceText,
  buildCreatePayload,
  contentMatchesIncludes,
} = require('./messagingFormatRegistry');
const { transformContent } = require('./messagingFormatTransformer');

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
  { id: 'email', label: 'Email', group: 'Messaging' },
  { id: 'post', label: 'Post', group: 'Messaging' },
  { id: 'description', label: 'Description', group: 'Messaging' },
  { id: 'transcript', label: 'Transcript', group: 'Messaging' },
  { id: 'comment', label: 'Comment', group: 'Messaging' },
  { id: 'hashtag', label: 'Hashtag', group: 'Messaging' },
  { id: 'keyword', label: 'Keyword', group: 'Messaging' },
  { id: 'tag', label: 'Tag', group: 'Messaging' },
  { id: 'cta', label: 'Call to Action', group: 'Messaging' },
  { id: 'article', label: 'Article', group: 'Messaging' },
  { id: 'report', label: 'Report', group: 'Messaging' },
  { id: 'white-paper', label: 'White Paper', group: 'Messaging' },
  { id: 'ebook', label: 'eBook', group: 'Messaging' },
  { id: 'web-page', label: 'Web Page', group: 'Messaging' },
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
  'tweet:post': (options) => runTweetToPostImport(options),
  'web-page:keyword': (options) => runWebPageToKeywordImport(options),
};

// Maps singular format slug → { list, create } for use in the generic text-to-text handler.
// Slugs are singular to match FIELD_TYPE_OPTIONS IDs and existing handler keys.
async function unsupportedWebPageContentCreate() {
  return {
    ok: false,
    status: 400,
    error: 'Web page content is synced from Builder pages; edit pages there or run Sync Web Pages.',
  };
}

const FORMAT_STORE_MAP = {
  tweet:         { list: listMessagingTweets,        create: createMessagingTweet },
  headline:      { list: listMessagingHeadlines,     create: createMessagingHeadline },
  subheading:    { list: listMessagingSubheadings,   create: createMessagingSubheading },
  tagline:       { list: listMessagingTaglines,      create: createMessagingTagline },
  pitch:         { list: listMessagingPitches,       create: createMessagingPitch },
  email:         { list: listMessagingEmails,        create: createMessagingEmail },
  post:          { list: listMessagingPosts,         create: createMessagingPost },
  description:   { list: listMessagingDescriptions,  create: createMessagingDescription },
  transcript:    { list: listMessagingTranscripts,   create: createMessagingTranscript },
  comment:       { list: listMessagingComments,      create: createMessagingComment },
  hashtag:       { list: listMessagingHashtags,      create: createMessagingHashtag },
  keyword:       { list: listMessagingKeywords,      create: createMessagingKeyword },
  tag:           { list: listMessagingTags,          create: createMessagingTag },
  cta:           { list: listMessagingCtas,          create: createMessagingCta },
  article:       { list: listMessagingArticles,      create: createMessagingArticle },
  report:        { list: listMessagingReports,       create: createMessagingReport },
  'white-paper': { list: listMessagingWhitePapers,   create: createMessagingWhitePaper },
  ebook:         { list: listMessagingEbooks,        create: createMessagingEbook },
  'web-page':    { list: listWebPagesForMessagingImport, create: unsupportedWebPageContentCreate },
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
      tweetId: Number(entry.tweetId || entry.tweet_id || 0) || 0,
      content: String(entry.content || entry.headline || entry.post || '').trim(),
      post: String(entry.post || entry.content || '').trim(),
      url: String(entry.url || '').trim(),
      hashtags: String(entry.hashtags || '').trim(),
      image_asset_id: Number(entry.image_asset_id || 0) || null,
      topic: String(entry.topic || '').trim(),
      category: String(entry.category || '').trim(),
      source: String(entry.source || '').trim(),
    }))
    .filter((entry) => Boolean(entry.content || entry.post));
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
  if (key === 'tweet:post') {
    return 'Matching tweets become posts: copies post text, URL, hashtags, image, and topic unchanged.';
  }
  if (fromType === 'web-page') {
    return 'Reads text from every Builder page in this project and repurposes each page separately (no content_items sync).';
  }
  const fromSpec = getFormatSpec(fromType);
  const toSpec = getFormatSpec(toType);
  if (fromSpec && toSpec && fromType !== toType) {
    return `AI repurposes each ${fromSpec.label} into ${toSpec.aiDescriptor}.`;
  }
  return 'This import combination is not available yet.';
}

function listSupportedPairs() {
  const pairs = [
    { fromType: 'image', toType: 'tweet', engineVersion: DEFAULT_ENGINE_VERSION },
    { fromType: 'image', toType: 'headline' },
  ];
  for (const from of listFormatSlugs()) {
    for (const to of listFormatSlugs()) {
      if (from !== to) pairs.push({ fromType: from, toType: to });
    }
  }
  return pairs;
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

async function runTweetToPostImport(options = {}) {
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

  const existingRes = await listMessagingPosts(5000, scope);
  if (!existingRes.ok) {
    return { ok: false, status: existingRes.status || 500, error: existingRes.error || 'Could not load posts' };
  }

  const existingByContent = new Set();
  for (const row of existingRes.data || []) {
    const content = normalizeContent(row.post);
    if (content) existingByContent.add(content);
  }

  const plan = [];

  for (const tweet of candidates) {
    const tweetId = Number(tweet.id || 0);
    const post = normalizeContent(tweet.content);
    if (!post) {
      plan.push({
        tweetId,
        tweetPreview: String(tweet.content || '').slice(0, 80),
        action: 'skip',
        reason: 'empty',
      });
      continue;
    }

    if (!force && existingByContent.has(post)) {
      plan.push({
        tweetId,
        tweetPreview: String(tweet.content || '').slice(0, 80),
        post,
        action: 'skip',
        reason: 'content',
      });
      continue;
    }

    plan.push({
      tweetId,
      tweetPreview: String(tweet.content || '').slice(0, 80),
      post,
      url: String(tweet.url || '').trim(),
      hashtags: String(tweet.hashtags || '').trim(),
      image_asset_id: Number(tweet.image_asset_id || 0) || null,
      action: 'create',
      topic: String(tweet.topic || '').trim(),
      category: String(tweet.category || '').trim(),
    });
  }

  const toCreate = plan.filter((entry) => entry.action === 'create');
  const preview = toCreate.slice(0, 3).map((entry) => ({
    tweetId: entry.tweetId,
    content: entry.post,
    source: 'tweet_copy',
  }));
  const applyPlan = toCreate.map((entry) => ({
    tweetId: entry.tweetId,
    post: entry.post,
    url: entry.url,
    hashtags: entry.hashtags,
    image_asset_id: entry.image_asset_id,
    topic: entry.topic,
    category: entry.category,
  }));

  const resultData = {
    fromType: 'tweet',
    toType: 'post',
    includes,
    matched: candidates.length,
    skipped: plan.filter((entry) => entry.action === 'skip').length,
    planned: toCreate.length,
    transformErrors: 0,
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
    const result = await createMessagingPost({
      post: entry.post || entry.content,
      url: entry.url,
      hashtags: entry.hashtags,
      image_asset_id: entry.image_asset_id,
      topic: entry.topic,
      category: entry.category,
    }, scope);
    if (result.ok) {
      created += 1;
      existingByContent.add(normalizeContent(entry.post));
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

// Generic AI-powered handler for any text-to-text format pair not covered by a specialized handler.
async function runGenericTextToTextImport(fromSlug, toSlug, options = {}) {
  const fromSpec = getFormatSpec(fromSlug);
  const toSpec = getFormatSpec(toSlug);
  const fromStore = FORMAT_STORE_MAP[fromSlug];
  const toStore = FORMAT_STORE_MAP[toSlug];

  if (!fromSpec || !fromStore) {
    return { ok: false, status: 400, error: `Unknown source format: ${fromSlug}` };
  }
  if (!toSpec || !toStore) {
    return { ok: false, status: 400, error: `Unknown target format: ${toSlug}` };
  }

  const scope = options.scope || null;
  const includes = String(options.includes || '').trim();
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);

  const sourceRes = await fromStore.list(5000, scope);
  if (!sourceRes.ok) {
    return { ok: false, status: sourceRes.status || 500, error: sourceRes.error || `Could not load ${fromSpec.label} items` };
  }

  const candidates = (Array.isArray(sourceRes.data) ? sourceRes.data : []).filter((row) => {
    const text = getSourceText(fromSpec, row);
    return text && contentMatchesIncludes(text, includes);
  });

  const existingRes = await toStore.list(5000, scope);
  if (!existingRes.ok) {
    return { ok: false, status: existingRes.status || 500, error: existingRes.error || `Could not load existing ${toSpec.label} items` };
  }

  const existingByContent = new Set();
  for (const row of existingRes.data || []) {
    const text = normalizeContent(toSpec.isLongform ? row.content : row[toSpec.contentField]);
    if (text) existingByContent.add(text);
  }

  const preview = candidates.slice(0, 3).map((row) => ({
    sourceId: Number(row.id || 0),
    sourcePreview: getSourceText(fromSpec, row).slice(0, 120),
  }));

  const resultData = {
    fromType: fromSlug,
    toType: toSlug,
    includes: includes || null,
    matched: candidates.length,
    skipped: 0,
    planned: candidates.length,
    transformErrors: 0,
    preview,
  };

  if (dryRun) {
    return { ok: true, status: 200, data: { ...resultData, created: 0, errors: [] } };
  }

  let created = 0;
  let transformErrors = 0;
  const errors = [];

  for (const candidate of candidates) {
    const sourceText = getSourceText(fromSpec, candidate);
    const sourceId = Number(candidate.id || 0);
    const topic = String(candidate.topic || candidate.category || '').trim();
    const category = String(candidate.category || '').trim();

    const transformed = await transformContent(sourceText, fromSpec, toSpec);
    if (!transformed.ok) {
      transformErrors += 1;
      errors.push({ sourceId, error: transformed.error || 'Transform failed' });
      continue;
    }

    if (toSpec.family === FAMILY.SUPPORT_TAGS) {
      // Each line of the AI response becomes a separate hashtag record.
      const tags = transformed.content.split('\n').map((s) => s.trim()).filter(Boolean);
      for (const tag of tags) {
        const dup = normalizeContent(tag);
        if (!force && existingByContent.has(dup)) continue;
        const result = await toStore.create(buildCreatePayload(toSpec, tag, { topic, category }), scope);
        if (result.ok) { created += 1; existingByContent.add(dup); }
        else errors.push({ sourceId, error: result.error || 'Create failed' });
      }
    } else {
      const content = transformed.content;
      const dup = normalizeContent(content);
      if (!force && existingByContent.has(dup)) continue;
      const payload = buildCreatePayload(toSpec, content, {
        topic,
        category,
        title: transformed.title || '',
        body: content,
      });
      const result = await toStore.create(payload, scope);
      if (result.ok) { created += 1; existingByContent.add(dup); }
      else errors.push({ sourceId, error: result.error || 'Create failed' });
    }
  }

  return {
    ok: errors.length === 0,
    status: errors.length ? 500 : 200,
    data: { ...resultData, transformErrors, created, errors },
    error: errors.length ? errors[0].error : '',
  };
}

// Auto-register all text-to-text pairs not already covered by a specialized handler.
for (const from of listFormatSlugs()) {
  for (const to of listFormatSlugs()) {
    const key = `${from}:${to}`;
    if (!HANDLERS[key] && from !== to) {
      HANDLERS[key] = (options) => runGenericTextToTextImport(from, to, options);
    }
  }
}

const ASSET_SOURCE_TYPES = new Set(['image', 'video', 'audio', 'lead_magnet', 'file']);

async function runAssetFieldImport(input, scope = null) {
  const fromType = String(input?.fromType ?? input?.from_type ?? '').trim().toLowerCase();
  const toType = String(input?.toType ?? input?.to_type ?? '').trim().toLowerCase();
  const rawIncludes = String(input?.includes || '').trim();
  const dryRun = Boolean(input?.dryRun ?? input?.dry_run);
  const force = Boolean(input?.force);
  const engineVersion = normalizeEngineVersion(
    input?.engineVersion ?? input?.engine_version
  );

  if (!fromType || !toType) {
    return { ok: false, status: 400, error: 'fromType and toType are required' };
  }

  // Asset-source handlers (image, video, etc.) use the WYR-normalized includes filter and require it.
  // Text-to-text handlers receive the raw includes (empty string = match all).
  const isAssetSource = ASSET_SOURCE_TYPES.has(fromType);
  if (isAssetSource && !rawIncludes) {
    return { ok: false, status: 400, error: 'includes is required' };
  }
  const includes = isAssetSource ? normalizeIncludesDelimiter(rawIncludes) : rawIncludes;

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
  runTweetToPostImport,
  runGenericTextToTextImport,
};
