'use strict';

const {
  stripExtension,
  assetNameMatchesIncludes,
  normalizeIncludesDelimiter,
  formatWyrTweetContent,
} = require('./wyrAssetTweet');
const {
  parseWyrTweetContent,
  isWyrTweetContent,
} = require('./wyrTweetContent');

const MAX_FIRST_STATEMENT_WORDS = 20;

const HEADLINE_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'as', 'nor', 'yet', 'so', 'if', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'vs', 'via', 'per', 'into', 'onto', 'upon',
]);

function normalizeHeadlineText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function countWords(text) {
  const normalized = normalizeHeadlineText(text);
  if (!normalized) return 0;
  return normalized.split(' ').length;
}

function firstStatement(text) {
  const source = String(text || '').trim();
  if (!source) return '';

  const lineBreak = source.indexOf('\n');
  if (lineBreak >= 0) {
    const firstLine = source.slice(0, lineBreak).trim();
    if (firstLine) return firstLine;
  }

  const match = source.match(/^([\s\S]*?)(?:[.!?]+(?:\s+|$)|[.!?]+$)/);
  if (match && match[1]) {
    return normalizeHeadlineText(match[1]);
  }

  return normalizeHeadlineText(source);
}

function splitFilenameToWords(stem) {
  return String(stem || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function titleCaseHeadlineWords(words) {
  return words
    .map((word, index) => {
      const lower = String(word || '').toLowerCase();
      if (!lower) return '';
      if (index > 0 && HEADLINE_STOP_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .filter(Boolean)
    .join(' ');
}

function formatFilenameAsHeadline(assetName) {
  const stem = stripExtension(assetName);
  const words = splitFilenameToWords(stem);
  if (!words.length) return '';
  return titleCaseHeadlineWords(words);
}

function resolveHeadlineFromTweetContent(content) {
  const raw = String(content || '').trim();
  if (!raw) {
    return { ok: false, error: 'Tweet has no content' };
  }

  if (isWyrTweetContent(raw)) {
    const parsed = parseWyrTweetContent(raw);
    if (!parsed) {
      return { ok: false, error: 'Could not parse WYR tweet' };
    }
    const headline = formatWyrTweetContent(parsed.phraseA, parsed.phraseB);
    if (!headline) {
      return { ok: false, error: 'Could not build WYR headline' };
    }
    return { ok: true, content: headline, source: 'wyr' };
  }

  const statement = firstStatement(raw);
  if (!statement) {
    return { ok: false, error: 'No first statement found' };
  }

  const words = countWords(statement);
  if (words > MAX_FIRST_STATEMENT_WORDS) {
    return {
      ok: false,
      error: `First statement is ${words} words (max ${MAX_FIRST_STATEMENT_WORDS})`,
      skipReason: 'too_long',
    };
  }

  return { ok: true, content: statement, source: 'first_statement' };
}

function resolveHeadlineFromImageAsset(asset) {
  const caption = normalizeHeadlineText(asset?.caption ?? asset?.image_caption ?? '');
  if (caption) {
    return { ok: true, content: caption, source: 'caption' };
  }

  const name = String(asset?.assetName ?? asset?.asset_name ?? '').trim();
  const headline = formatFilenameAsHeadline(name);
  if (!headline) {
    return { ok: false, error: 'Could not format file name as headline' };
  }

  return { ok: true, content: headline, source: 'filename' };
}

function isImageAsset(asset) {
  return String(asset?.assetType ?? asset?.asset_type ?? '').trim().toLowerCase() === 'image';
}

function isHeadlineImportImageAsset(asset, includes) {
  if (!isImageAsset(asset)) return false;
  const caption = normalizeHeadlineText(asset?.caption ?? asset?.image_caption ?? '');
  if (caption) return true;
  const name = String(asset?.assetName ?? asset?.asset_name ?? '').trim();
  return assetNameMatchesIncludes(name, includes);
}

function tweetContentMatchesIncludes(content, includes) {
  const text = String(content || '').trim().toLowerCase();
  const delim = normalizeIncludesDelimiter(includes).toLowerCase();
  if (!delim) return true;
  return text.includes(delim);
}

module.exports = {
  MAX_FIRST_STATEMENT_WORDS,
  HEADLINE_STOP_WORDS,
  normalizeHeadlineText,
  countWords,
  firstStatement,
  formatFilenameAsHeadline,
  resolveHeadlineFromTweetContent,
  resolveHeadlineFromImageAsset,
  isHeadlineImportImageAsset,
  tweetContentMatchesIncludes,
};
