'use strict';

// Task 86bcg88kp: a Paragraph module kept only its first 10,000 characters on
// every read and write. The server reads a page through document.js, which runs
// migrate-from-legacy.js before the generated template bundle — so all three
// carry the limit, and a smaller number in any one of them cuts the article.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MODULE_TEXT_MAX_LENGTH,
  migrateLegacyLayoutSections,
  migrateLegacyEmailBlocksToDocument,
} = require('../../lib/builder/migrate-from-legacy');
const { normalizeBuilderDocument } = require('../../lib/builder/document');
const template = require('../../lib/builder/template');

function article(length) {
  const paragraph = '<p>I also have a highly fertile imagination, and it does not stop at ten thousand.</p>';
  return paragraph.repeat(Math.ceil(length / paragraph.length)).slice(0, length);
}

test('the server copy of the module text limit equals the builder one', () => {
  assert.equal(MODULE_TEXT_MAX_LENGTH, 200000);
  assert.equal(template.BUILDER_MODULE_TEXT_MAX_LENGTH, MODULE_TEXT_MAX_LENGTH);
});

test('a 30,000-character Paragraph survives a server-side page read', () => {
  const text = article(30000);
  const doc = normalizeBuilderDocument({
    sections: [{ id: 's1', layout: 'single', modules: [{ id: 'm1', type: 'text', column: 'main', text }] }],
  });
  assert.equal(doc.layoutSections[0].modules[0].text, text);
});

test('a 30,000-character Paragraph survives the legacy-layout conversion', () => {
  const text = article(30000);
  const migrated = migrateLegacyLayoutSections([
    { id: 's1', layout: '6', modules: [{ id: 'm1', type: 'pitch', column: 'col1', text }] },
  ]);
  assert.equal(migrated.sections[0].modules[0].text, text);
});

test('a 30,000-character email body survives the email-block conversion', () => {
  const text = article(30000);
  const fromBlocks = migrateLegacyEmailBlocksToDocument({ blocks: [{ type: 'paragraph', text }] });
  assert.equal(fromBlocks.sections[0].modules[0].text, text);
  const fromBody = migrateLegacyEmailBlocksToDocument({ body: text });
  assert.equal(fromBody.sections[0].modules.find((m) => m.type === 'text').text, text);
});
