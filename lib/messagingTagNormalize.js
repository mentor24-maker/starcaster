'use strict';

function clean(value) {
  return String(value || '').trim();
}

function titleCaseWord(word) {
  const text = clean(word);
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function splitCompactWords(text) {
  return clean(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeMessagingTag(raw) {
  let text = clean(raw);
  if (!text) return '';

  text = text.replace(/^#+/, '').replace(/#/g, ' ').trim();
  if (!text) return '';

  const words = splitCompactWords(text).slice(0, 3);
  if (!words.length) return '';

  return words.map(titleCaseWord).join(' ').slice(0, 240);
}

function normalizeMessagingTagKey(raw) {
  return normalizeMessagingTag(raw).toLowerCase();
}

function parseMessagingTagLines(text) {
  const seen = new Set();
  const tags = [];
  for (const line of String(text || '').split('\n')) {
    const tag = normalizeMessagingTag(line);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

module.exports = {
  normalizeMessagingTag,
  normalizeMessagingTagKey,
  parseMessagingTagLines,
};
