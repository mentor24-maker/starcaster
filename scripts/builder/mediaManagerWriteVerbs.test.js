'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Ticket 86bbrth9z. The Media Manager module shipped with rename sending PUT
 * to /api/assets/:id, which routes/assets.js does not handle — it handles
 * PATCH and DELETE for that path and nothing else. The request fell through
 * unmatched and the rename silently did not happen.
 *
 * It shipped because the closing check verified the grid RENDERED and never
 * exercised a write action. A screen that paints is not a screen that works.
 *
 * These tests read the two files against each other. That is a weaker
 * instrument than driving a browser — it proves the verbs agree, not that the
 * round trip succeeds — so the browser check stays in the ticket's test steps
 * and this exists to stop the specific regression coming back unseen.
 */

const routes = read('routes/assets.js');
const preview = read('components/builder-template-preview.tsx');

/** The Media Manager component only, so another module's fetch cannot answer for it. */
function mediaManagerSource() {
  const start = preview.indexOf('function MediaManagerPreview(');
  assert.ok(start > 0, 'MediaManagerPreview must exist');
  const end = preview.indexOf('/* ── Event Manager (admin)', start);
  assert.ok(end > start, 'expected the Event Manager section to follow it');
  return preview.slice(start, end);
}

test('the asset route handles PATCH and DELETE for a single asset, and not PUT', () => {
  assert.match(routes, /assetIdMatch && requestMethod === 'PATCH'/);
  assert.match(routes, /assetIdMatch && requestMethod === 'DELETE'/);
  // The trap itself: if a PUT handler is ever added, this test should be
  // revisited deliberately rather than the client quietly switching back.
  assert.doesNotMatch(routes, /assetIdMatch && requestMethod === 'PUT'/);
});

test('the Media Manager renames with PATCH, the verb the route actually handles', () => {
  const source = mediaManagerSource();
  const renameStart = source.indexOf('async function saveRename');
  assert.ok(renameStart > 0, 'saveRename must exist');
  const renameBody = source.slice(renameStart, renameStart + 1200);
  assert.match(renameBody, /method: "PATCH"/, 'rename must PATCH');
  assert.doesNotMatch(renameBody, /method: "PUT"/, 'PUT is not handled for this path');
});

test('the Media Manager sends no PUT at all', () => {
  // Broader than the rename check on purpose: any future write on this module
  // reaching for PUT hits the same unhandled path.
  assert.doesNotMatch(mediaManagerSource(), /method: "PUT"/);
});

test('the Content box is wired to the renderer, not left inert', () => {
  // Doctrine E7. builder-module-card offers a generic Content textarea to
  // every module type it does not exclude; media-manager is not excluded, so
  // the box is offered and MUST be read, or it is a control that does nothing.
  const card = read('components/builder/builder-module-card.tsx');
  assert.doesNotMatch(card, /module\.type !== "media-manager"/,
    'media-manager is not excluded from the Content box, so it must render it');
  assert.match(preview, /<MediaManagerPreview settings=\{module\.settings\} text=\{module\.text\} \/>/,
    'the renderer must receive module.text');
  assert.match(mediaManagerSource(), /const description = String\(text \|\| ""\)\.trim\(\);/);
});

test('the description is rendered as text, never as markup', () => {
  const source = mediaManagerSource();
  assert.match(source, /<p className="builder-media-manager-description">\{description\}<\/p>/,
    'React escapes an interpolated string; building markup out of it would not');
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/,
    'the Content box is a plain textarea — its value is text, not HTML');
});
