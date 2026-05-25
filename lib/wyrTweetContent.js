'use strict';

const {
  normalizeWyrPhrase,
  formatWyrTweetContent,
} = require('./wyrAssetTweet');

const WYR_FOLLOW_UP_TEMPLATES = [
  'How do you think most other people answered this question?',
  'The answer to this question will tell more about yourself than you might think.',
  'Which would you pick — and what does that say about you?',
  'Most people split on this one. Where do you land?',
  'Your choice here says more than you might expect.',
];

function hashString(value) {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickWyrFollowUp(phraseA, phraseB, seed = '') {
  const key = `${seed}|${normalizeWyrPhrase(phraseA)}|${normalizeWyrPhrase(phraseB)}`.toLowerCase();
  const idx = hashString(key) % WYR_FOLLOW_UP_TEMPLATES.length;
  return WYR_FOLLOW_UP_TEMPLATES[idx];
}

function formatWyrTweetWithFollowUp(phraseA, phraseB, followUp) {
  const main = formatWyrTweetContent(phraseA, phraseB);
  const tail = String(followUp || '').trim();
  if (!tail) return main;
  return `${main} ${tail}`;
}

function parseWyrTweetContent(content) {
  const text = String(content || '').trim();
  const match = text.match(
    /^Would You Rather[.\s…?]*\s*(.+?)\s+OR\s+(.+?)\?\s*([\s\S]*)$/i
  );
  if (!match) return null;
  const phraseA = normalizeWyrPhrase(match[1]);
  const phraseB = normalizeWyrPhrase(match[2]);
  const followUp = String(match[3] || '').trim();
  if (!phraseA || !phraseB) return null;
  return { phraseA, phraseB, followUp };
}

function isWyrTweetContent(content) {
  return /^Would You Rather/i.test(String(content || '').trim());
}

function parsePhrasesFromOcrText(rawText) {
  const source = String(rawText || '').replace(/\r/g, '\n').trim();
  if (!source) return null;

  const singleLine = source.replace(/[|¦]/g, '\n').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const lines = source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const contentLines = lines.filter((line) => {
    const lower = line.toLowerCase();
    return !/^would you rather/.test(lower)
      && !/^wyr\b/.test(lower)
      && !/^option\s*[ab]\b/i.test(line)
      && line.length > 2;
  });

  let phraseA = '';
  let phraseB = '';

  if (contentLines.length === 2 && !/\s+OR\s+/i.test(source)) {
    phraseA = normalizeWyrPhrase(contentLines[0]);
    phraseB = normalizeWyrPhrase(contentLines[1]);
  }

  const labeled = singleLine.match(
    /(?:option\s*)?a[:\s]+(.+?)(?:option\s*b[:\s]+|(?:\s+OR\s+)|$)/i
  );
  if (labeled) {
    phraseA = phraseA || normalizeWyrPhrase(labeled[1]);
    const afterA = singleLine.slice(singleLine.toLowerCase().indexOf(labeled[1].toLowerCase()) + labeled[1].length);
    const bMatch = afterA.match(/(?:option\s*b[:\s]+|OR\s+)(.+)$/i);
    if (bMatch) phraseB = phraseB || normalizeWyrPhrase(bMatch[1]);
  }

  if (!phraseA || !phraseB) {
    const orParts = singleLine.split(/\s+OR\s+/i);
    if (orParts.length >= 2) {
      phraseA = phraseA || normalizeWyrPhrase(orParts[0]);
      phraseB = phraseB || normalizeWyrPhrase(orParts.slice(1).join(' OR '));
    }
  }

  if (!phraseA || !phraseB) return null;
  return { phraseA, phraseB, rawText: source };
}

module.exports = {
  WYR_FOLLOW_UP_TEMPLATES,
  pickWyrFollowUp,
  formatWyrTweetWithFollowUp,
  parseWyrTweetContent,
  isWyrTweetContent,
  parsePhrasesFromOcrText,
};
