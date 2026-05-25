'use strict';

const DEFAULT_INCLUDES = ' or ';

const WYR_PREFIX_RE = /^would\s+you\s+rather[.\s…?]*/i;

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeIncludesDelimiter(includes) {
  const text = String(includes == null ? DEFAULT_INCLUDES : includes).trim();
  return text || DEFAULT_INCLUDES;
}

function stripExtension(name) {
  return String(name || '').trim().replace(/\.[^.]+$/, '');
}

/**
 * True when the asset name contains the user's Includes substring (case-insensitive).
 */
function assetNameMatchesIncludes(assetName, includes) {
  const stem = stripExtension(assetName);
  const delim = normalizeIncludesDelimiter(includes);
  if (!delim) return false;
  return stem.toLowerCase().includes(delim.toLowerCase());
}

/**
 * Normalize a phrase extracted from a filename: underscores/hyphens → spaces, trim junk.
 */
function normalizeWyrPhrase(raw) {
  return String(raw || '')
    .trim()
    .replace(WYR_PREFIX_RE, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[?.!…\s]+|[?.!…\s]+$/g, '');
}

/**
 * Split an asset filename into two WYR option phrases, or null if not splittable.
 */
function parseWyrPhrasesFromAssetName(assetName, includes) {
  const stem = stripExtension(assetName);
  const delim = normalizeIncludesDelimiter(includes);
  if (!assetNameMatchesIncludes(stem, delim)) return null;

  const parts = stem.split(new RegExp(escapeRegExp(delim), 'i'));
  if (parts.length < 2) return null;

  const phraseA = normalizeWyrPhrase(parts[0]);
  const phraseB = normalizeWyrPhrase(parts.slice(1).join(delim));
  if (!phraseA || !phraseB) return null;

  return { phraseA, phraseB };
}

/**
 * Tweet text: Would You Rather...? [phrase A] OR [phrase B]?
 */
function formatWyrTweetContent(phraseA, phraseB) {
  const a = normalizeWyrPhrase(phraseA);
  const b = normalizeWyrPhrase(phraseB);
  if (!a || !b) return '';
  return `Would You Rather...? ${a} OR ${b}?`;
}

/**
 * Build tweet content from an asset record ({ assetName } or { asset_name }).
 */
function wyrTweetContentFromAsset(asset, includes) {
  const name = String(asset?.assetName ?? asset?.asset_name ?? '').trim();
  const parsed = parseWyrPhrasesFromAssetName(name, includes);
  if (!parsed) return '';
  return formatWyrTweetContent(parsed.phraseA, parsed.phraseB);
}

function isWyrImageAsset(asset, includes) {
  const type = String(asset?.assetType ?? asset?.asset_type ?? '').trim();
  if (type && type.toLowerCase() !== 'image') return false;
  const name = String(asset?.assetName ?? asset?.asset_name ?? '').trim();
  return assetNameMatchesIncludes(name, includes);
}

module.exports = {
  DEFAULT_INCLUDES,
  normalizeIncludesDelimiter,
  assetNameMatchesIncludes,
  stripExtension,
  normalizeWyrPhrase,
  parseWyrPhrasesFromAssetName,
  formatWyrTweetContent,
  wyrTweetContentFromAsset,
  isWyrImageAsset,
};
