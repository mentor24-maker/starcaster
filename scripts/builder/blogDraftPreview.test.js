'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canPreviewDraft, isPublishedPost } = require('../../lib/blogDraftPreview');

/**
 * Ticket 86bbvtzt1 — the "Preview draft" link in the Blog Manager.
 *
 * The link opens the public post page for an unpublished post, as the tenant
 * admin. That address is a public read route, so the request carries no
 * platform user — and until this rule, the route answered a tenant admin
 * exactly as it answers a visitor: "Post not found". The opening must be as
 * narrow as the case: THIS project's admin, THIS project's draft.
 */

const draft = { id: 'p1', status: 'draft', projectId: 'proj_delray' };

test('a tenant admin may preview a draft of their OWN project', () => {
  assert.equal(canPreviewDraft(draft, { projectId: 'proj_delray' }), true);
});

test('an admin of another tenant is a visitor here', () => {
  assert.equal(canPreviewDraft(draft, { projectId: 'proj_marinoff' }), false);
});

test('no session, no preview — the visitor case stays a 404', () => {
  assert.equal(canPreviewDraft(draft, null), false);
  assert.equal(canPreviewDraft(draft, undefined), false);
});

test('a session or a post with no project never matches — blank is not equal to blank', () => {
  assert.equal(canPreviewDraft({ status: 'draft', projectId: '' }, { projectId: '' }), false);
  assert.equal(canPreviewDraft(draft, { projectId: '' }), false);
  assert.equal(canPreviewDraft(null, { projectId: 'proj_delray' }), false);
});

test('reads the snake_case project column too, for a row that skipped sanitize()', () => {
  assert.equal(canPreviewDraft({ status: 'draft', project_id: 'proj_delray' }, { projectId: 'proj_delray' }), true);
});

test('isPublishedPost is exact — "Published", "draft" and blank are all not published', () => {
  assert.equal(isPublishedPost({ status: 'published' }), true);
  assert.equal(isPublishedPost({ status: ' published ' }), true);
  assert.equal(isPublishedPost({ status: 'Published' }), false);
  assert.equal(isPublishedPost({ status: 'draft' }), false);
  assert.equal(isPublishedPost({}), false);
  assert.equal(isPublishedPost(null), false);
});
