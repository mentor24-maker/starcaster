'use strict';

const { createHash } = require('crypto');

const TEXT_MODULE_TYPES = new Set([
  'text',
  'heading',
  'button',
  'speech-bubble',
  'reminder',
  'code',
]);

function safeText(value, max = 50000) {
  return String(value || '').trim().slice(0, max);
}

function decodeBasicEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToPlainText(html) {
  return decodeBasicEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n'))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function pushText(parts, value) {
  const text = htmlToPlainText(value);
  if (text) parts.push(text);
}

function collectModuleText(module, parts) {
  if (!module || typeof module !== 'object') return;
  const type = String(module.type || '').trim().toLowerCase();
  const settings = module.settings && typeof module.settings === 'object' ? module.settings : {};

  if (TEXT_MODULE_TYPES.has(type)) {
    pushText(parts, module.text);
  }

  pushText(parts, settings.title);
  pushText(parts, settings.text);
  pushText(parts, settings.label);
  pushText(parts, settings.caption);
  pushText(parts, settings.subtitle);
}

function collectLayoutSectionText(sections) {
  const parts = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    pushText(parts, section?.title);
    for (const module of Array.isArray(section?.modules) ? section.modules : []) {
      collectModuleText(module, parts);
    }
  }
  return parts;
}

function collectLegacyPageFields(page) {
  return [
    page?.featureTitle,
    page?.featureCopy,
    page?.highlightTitle,
    page?.highlightCopy,
  ].filter(Boolean);
}

function buildWebPageContentItemPayload(page) {
  const name = safeText(page?.name, 300);
  const slug = safeText(page?.slug, 160);
  const parts = [
    ...collectLayoutSectionText(page?.layoutSections),
    ...collectLegacyPageFields(page).map((value) => htmlToPlainText(value)),
  ].filter(Boolean);

  const content = parts.join('\n\n').trim();
  const title = name || slug || 'Untitled Page';

  return {
    title,
    content,
    url: slug ? `/${slug.replace(/^\/+/, '')}` : '',
    sourceSlug: slug,
    contentHash: createHash('sha256').update([title, content, slug].join('\u001f')).digest('hex'),
  };
}

module.exports = {
  htmlToPlainText,
  buildWebPageContentItemPayload,
};
