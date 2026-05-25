'use strict';

const {
  parseWyrPhrasesFromAssetName,
  wyrTweetContentFromAsset,
  formatWyrTweetContent,
} = require('./wyrAssetTweet');
const { ocrAssetForWyr } = require('./wyrTweetOcr');
const {
  formatWyrTweetWithFollowUp,
  pickWyrFollowUp,
} = require('./wyrTweetContent');

/** Default parsing engine for Image → Tweet import and OCR sync. */
const DEFAULT_ENGINE_VERSION = 2;

function normalizeEngineVersion(value) {
  const n = Number(value);
  if (n === 1) return 1;
  return DEFAULT_ENGINE_VERSION;
}

function assetHasFetchableImage(asset) {
  return Boolean(String(asset?.location || '').trim());
}

function buildV2TweetContent(phraseA, phraseB, seed) {
  const followUp = pickWyrFollowUp(phraseA, phraseB, seed);
  return formatWyrTweetWithFollowUp(phraseA, phraseB, followUp);
}

/**
 * v1 — filename only; main question, no follow-up teaser.
 */
function transformWyrTweetV1(asset, includes) {
  const content = wyrTweetContentFromAsset(asset, includes);
  if (!content) {
    return { ok: false, error: 'Could not parse WYR phrases from file name' };
  }
  const parsed = parseWyrPhrasesFromAssetName(
    String(asset?.assetName ?? asset?.asset_name ?? ''),
    includes
  );
  return {
    ok: true,
    engineVersion: 1,
    source: 'filename',
    content,
    phraseA: parsed?.phraseA || '',
    phraseB: parsed?.phraseB || '',
  };
}

/**
 * v2 — OCR image text for options; filename fallback; follow-up teaser.
 */
async function transformWyrTweetV2(asset, includes, options = {}) {
  const assetId = Number(asset?.id || 0) || 0;
  const name = String(asset?.assetName ?? asset?.asset_name ?? '').trim();
  const filenameParsed = parseWyrPhrasesFromAssetName(name, includes);
  let ocrError = '';

  if (assetHasFetchableImage(asset)) {
    const ocr = await ocrAssetForWyr(asset, options.ocr || {});
    if (ocr.ok) {
      const { phraseA, phraseB, rawText } = ocr.data;
      return {
        ok: true,
        engineVersion: 2,
        source: 'ocr',
        content: buildV2TweetContent(phraseA, phraseB, assetId),
        phraseA,
        phraseB,
        rawText,
      };
    }
    ocrError = String(ocr.error || 'OCR failed').trim();
  } else {
    ocrError = 'Asset has no image location for OCR';
  }

  if (filenameParsed) {
    return {
      ok: true,
      engineVersion: 2,
      source: 'filename',
      content: buildV2TweetContent(filenameParsed.phraseA, filenameParsed.phraseB, assetId),
      phraseA: filenameParsed.phraseA,
      phraseB: filenameParsed.phraseB,
      ocrError: ocrError || undefined,
    };
  }

  return {
    ok: false,
    error: ocrError || 'Could not parse WYR phrases from image or file name',
    engineVersion: 2,
  };
}

/**
 * Resolve full WYR tweet copy for an image asset (import / sync).
 */
async function resolveWyrTweetFromAsset(asset, options = {}) {
  const includes = options.includes;
  const version = normalizeEngineVersion(options.engineVersion);
  if (version === 1) {
    return transformWyrTweetV1(asset, includes);
  }
  return transformWyrTweetV2(asset, includes, options);
}

/** Same OCR/filename pipeline; headline text is the main WYR question only (no teaser). */
async function resolveWyrHeadlineFromAsset(asset, options = {}) {
  const transformed = await resolveWyrTweetFromAsset(asset, options);
  if (!transformed.ok) return transformed;
  const content = formatWyrTweetContent(transformed.phraseA, transformed.phraseB);
  if (!content) {
    return { ok: false, error: 'Could not build headline from WYR phrases', engineVersion: transformed.engineVersion };
  }
  return { ...transformed, content };
}

function buildWyrTweetContentFromPhrases(phraseA, phraseB, seed = '') {
  return buildV2TweetContent(phraseA, phraseB, seed);
}

module.exports = {
  DEFAULT_ENGINE_VERSION,
  normalizeEngineVersion,
  resolveWyrTweetFromAsset,
  resolveWyrHeadlineFromAsset,
  transformWyrTweetV1,
  transformWyrTweetV2,
  buildV2TweetContent,
  buildWyrTweetContentFromPhrases,
};
