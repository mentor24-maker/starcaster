'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Ticket 86bbume7b.
 *
 * The Blog Links Manager said the tag "junior tennis" had 13 posts. The public
 * tag page said none. Both were right: all 13 were DRAFTS, and the public feed
 * asks for published posts only. Two screens disagreeing with no explanation
 * reads as a broken site, and did — it was reported as a front-end bug.
 *
 * So the tag list carries a published count beside the total. What these tests
 * pin is that the two come from the same scan and cannot disagree, and that
 * "the server did not say" never renders as "none are live".
 */

const postsStorePath = require.resolve('../../lib/blogPostsStore');
const tagsStorePath = require.resolve('../../lib/blogTagsStore');

function loadTagsStoreWith(posts) {
  delete require.cache[postsStorePath];
  delete require.cache[tagsStorePath];
  const postsStore = require(postsStorePath);
  // One page, then empty — allPosts() stops when a batch is short.
  let served = false;
  postsStore.listPosts = async () => {
    if (served) return [];
    served = true;
    return posts;
  };
  return require(tagsStorePath);
}

const byTag = (list) => Object.fromEntries(list.map((t) => [t.tag, t]));

test('a tag whose posts are all drafts reports zero live, not zero posts', async () => {
  // The Delray case exactly: the count is real, the visibility is not.
  const store = loadTagsStoreWith([
    { id: '1', status: 'draft', tags: ['junior tennis'] },
    { id: '2', status: 'draft', tags: ['junior tennis'] },
    { id: '3', status: 'draft', tags: ['junior tennis'] },
  ]);
  const tags = byTag(await store.listTags());
  assert.equal(tags['junior tennis'].postCount, 3);
  assert.equal(tags['junior tennis'].livePostCount, 0);
});

test('a tag whose posts are all published reports both counts equal', async () => {
  const store = loadTagsStoreWith([
    { id: '1', status: 'published', tags: ['tennis'] },
    { id: '2', status: 'published', tags: ['tennis'] },
  ]);
  const tags = byTag(await store.listTags());
  assert.equal(tags.tennis.postCount, 2);
  assert.equal(tags.tennis.livePostCount, 2);
});

test('a mixed tag counts only the published ones as live', async () => {
  const store = loadTagsStoreWith([
    { id: '1', status: 'published', tags: ['mixed'] },
    { id: '2', status: 'draft', tags: ['mixed'] },
    { id: '3', status: 'archived', tags: ['mixed'] },
  ]);
  const tags = byTag(await store.listTags());
  assert.equal(tags.mixed.postCount, 3);
  assert.equal(tags.mixed.livePostCount, 1, 'archived is not on the website either');
});

test('the live count never exceeds the total, across spellings', async () => {
  // "Junior Tennis" and "junior tennis" are ONE tag with two spellings, and
  // the live count has to fold the same way the total does -- counting it
  // per-spelling would produce a live count larger than the total it sits
  // beside, which is worse than the single number this replaced.
  const store = loadTagsStoreWith([
    { id: '1', status: 'published', tags: ['Junior Tennis'] },
    { id: '2', status: 'published', tags: ['junior tennis'] },
    { id: '3', status: 'draft', tags: ['JUNIOR TENNIS'] },
  ]);
  const tags = await store.listTags();
  assert.equal(tags.length, 1, 'three spellings are one tag');
  assert.equal(tags[0].postCount, 3);
  assert.equal(tags[0].livePostCount, 2);
});

test('a post carrying the same tag twice counts once on BOTH counts', async () => {
  const store = loadTagsStoreWith([
    { id: '1', status: 'published', tags: ['dup', 'dup', 'Dup'] },
  ]);
  const tags = byTag(await store.listTags());
  assert.equal(tags.dup.postCount, 1);
  assert.equal(tags.dup.livePostCount, 1);
});

test('a blank status is not live — the same answer the public feed gives', async () => {
  const store = loadTagsStoreWith([
    { id: '1', status: '', tags: ['odd'] },
    { id: '2', tags: ['odd'] },
  ]);
  const tags = byTag(await store.listTags());
  assert.equal(tags.odd.postCount, 2);
  assert.equal(tags.odd.livePostCount, 0);
});

test('both counts come out of ONE scan of the posts', () => {
  // Computed separately they could disagree, and a live count that
  // contradicts its own total is worse than the misleading single number.
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'blogTagsStore.js'), 'utf8');
  const body = source.split('async function listTags(')[1].split('\nfunction ')[0];
  assert.equal(
    (body.match(/await allPosts\(/g) || []).length,
    1,
    'a second scan is a second answer'
  );
  assert.match(body, /liveCounts\.set\(/, 'the live count is accumulated in the same loop');
});

test('the manager and the public feed agree on what "live" means', () => {
  // Three places decide it: this store, the manager UI, and the public post
  // feed's fetch. If they drift, the manager is lying again.
  const root = path.join(__dirname, '..', '..');
  const tagsStore = fs.readFileSync(path.join(root, 'lib', 'blogTagsStore.js'), 'utf8');
  const preview = fs.readFileSync(path.join(root, 'components', 'builder-template-preview.tsx'), 'utf8');
  assert.match(tagsStore, /function isLive\(post\)[\s\S]{0,160}'published'/);
  assert.match(preview, /function isLiveArticle\([\s\S]{0,160}"published"/);
  assert.match(preview, /\/api\/blog\/posts\?status=published/, 'the public feed still filters on published');
});
