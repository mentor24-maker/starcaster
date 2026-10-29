'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Miner upgrade 1/4 (86bcuxwhy) — each writer's newest posts and
 * pictures are KEPT, read through the one archive reader the suggestion pass
 * uses too.
 *
 * The store is the REAL one over a fake database whose schema is read from
 * the setup file, so a missing recent_posts / posts_read_at / photo_url /
 * logo_url column fails here. Substack is a stand-in shaped like the real
 * answers of 2026-10-29 (field names in lib/acquire/SubstackArchive.js).
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const ACQUIRE = path.join(__dirname, '..', '..', 'lib', 'acquire');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const ALL = [
  '../../lib/projectScope.js', '../../lib/substackMinerStore.js', '../../lib/substackNotesStore.js',
  '../../lib/acquire/SubstackNotesReadRun.js', '../../lib/acquire/SubstackArchive.js',
  '../../lib/acquire/SubstackPostsReadRun.js', '../../lib/acquire/SubstackSuggestRun.js',
].map((p) => require.resolve(p));

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-29T12:00:00Z');

function withDb() {
  const sql = ['substack_miner_setup.sql', 'substack_notes_setup.sql']
    .map((f) => fs.readFileSync(path.join(SQL_DIR, f), 'utf8')).join('\n');
  const db = createFakeDb(parseSchemaText(sql));
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      isConfigured: () => true,
      tableConfig: () => ({
        substackCandidates: 'substack_candidates',
        substackMinerSettings: 'substack_miner_settings',
        substackNotesItems: 'substack_notes_items',
        substackNotesSettings: 'substack_notes_settings',
      }),
      sbQuery: db.sbQuery,
    },
  };
  for (const p of ALL) delete require.cache[p];
  const store = require('../../lib/substackMinerStore.js');
  const run = require('../../lib/acquire/SubstackPostsReadRun.js');
  const archive = require('../../lib/acquire/SubstackArchive.js');
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of ALL) delete require.cache[p];
  }
  return { store, run, archive, db, restore };
}

/** One archive post in Substack's own field names. */
function post(n, extra = {}) {
  return {
    id: 1000 + n,
    publication_id: 77,
    title: `Post ${n}`,
    subtitle: `Subtitle ${n}`,
    slug: `post-${n}`,
    canonical_url: `https://writer.substack.com/p/post-${n}`,
    post_date: new Date(NOW - n * DAY).toISOString(),
    audience: 'everyone',
    truncated_body_text: `Opening of post ${n}. `.repeat(60),
    cover_image: `https://substack-post-media.s3.amazonaws.com/public/images/${n}.jpeg`,
    publishedBylines: [{
      id: 9, name: 'W', handle: 'w', is_guest: false,
      photo_url: 'https://substackcdn.com/image/photo.png',
      publicationUsers: [{ publication_id: 77, role: 'admin', publication: { subdomain: 'writer', logo_url: 'https://bucketeer.s3.amazonaws.com/logo.png' } }],
    }],
    ...extra,
  };
}

/**
 * Substack, faked. `archives[handle]` is the archive answer (or a failure
 * object); `profiles[handle]` the public profile. Every URL asked is recorded.
 */
function fakeSubstack({ archives = {}, profiles = {} } = {}, calls = []) {
  return async (url) => {
    calls.push(url);
    const arch = url.match(/^https:\/\/([^.]+)\.substack\.com\/api\/v1\/archive\?sort=new&limit=8$/);
    if (arch) {
      const a = archives[arch[1]];
      if (a && a.fail) return { ok: false, httpStatus: 404, reason: 'answered HTTP 404' };
      return { ok: true, data: a || [] };
    }
    const prof = url.match(/^https:\/\/substack\.com\/api\/v1\/user\/([^/]+)\/public_profile$/);
    if (prof) {
      const p = profiles[decodeURIComponent(prof[1])];
      return p ? { ok: true, data: p } : { ok: false, httpStatus: 404, reason: 'answered HTTP 404' };
    }
    return { ok: false, httpStatus: 404, reason: `unexpected address ${url}` };
  };
}

async function writer(store, handle, extra = null) {
  const saved = await store.upsertCandidate({ handle, name: handle.toUpperCase() }, SCOPE);
  assert.equal(saved.ok, true, saved.error);
  if (extra) {
    const done = await store.updateCandidate(saved.data.id, extra, SCOPE);
    assert.equal(done.ok, true, done.error);
  }
  return saved.data;
}

const deps = (extra) => ({ sleep: async () => {}, now: () => NOW, ...extra });

test('parses the real archive shape: newest first, at most 8, every field the ticket names', () => {
  const { archive, restore } = withDb();
  try {
    const raw = [post(0, { audience: 'only_paid' }), ...Array.from({ length: 9 }, (_, i) => post(i + 1))];
    const posts = archive.parseArchivePosts(raw);
    assert.equal(posts.length, 8, 'at most 8');
    assert.deepEqual(Object.keys(posts[0]).sort(), ['coverImage', 'excerpt', 'paid', 'postedAt', 'subtitle', 'title', 'url']);
    assert.equal(posts[0].title, 'Post 0');
    assert.equal(posts[0].url, 'https://writer.substack.com/p/post-0');
    assert.equal(posts[0].postedAt, new Date(NOW).toISOString(), 'postedAt is read from post_date');
    assert.equal(posts[0].paid, true, 'only_paid is a paid post');
    assert.equal(posts[1].paid, false);
    assert.equal(posts[0].excerpt.length, 500, 'the teaser is cut to 500');
    assert.match(posts[0].coverImage, /^https:\/\/substack-post-media/);

    // No canonical_url: built from the slug on the publication's own address.
    const [bare] = archive.parseArchivePosts([post(1, { canonical_url: null, cover_image: null, truncated_body_text: null })], 'https://www.example.com');
    assert.equal(bare.url, 'https://www.example.com/p/post-1');
    assert.equal(bare.coverImage, '');
    assert.equal(bare.excerpt, '');

    assert.deepEqual(archive.imagesFromArchive(raw), {
      photoUrl: 'https://substackcdn.com/image/photo.png',
      logoUrl: 'https://bucketeer.s3.amazonaws.com/logo.png',
    });
  } finally { restore(); }
});

test('one pass fills recent_posts and posts_read_at for every writer read, and names the one it could not read', async () => {
  const { store, run, db, restore } = withDb();
  try {
    const a = await writer(store, 'writer');
    const empty = await writer(store, 'quiet');
    const broken = await writer(store, 'broken');
    const calls = [];
    const res = await run.runSubstackPostsRead({}, SCOPE, deps({
      fetchJson: fakeSubstack({
        archives: { writer: [post(2), post(1)], quiet: [], broken: { fail: true } },
        profiles: { quiet: { id: 5, handle: 'quiet', photo_url: 'https://substackcdn.com/quiet.png', primaryPublication: { subdomain: 'quiet', logo_url: 'https://bucketeer.s3.amazonaws.com/quiet-logo.png' } } },
      }, calls),
    }));
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.due, 3);
    assert.deepEqual(res.data.read.map((r) => [r.handle, r.posts]).sort(), [['quiet', 0], ['writer', 2]]);
    assert.deepEqual(res.data.failed, [{ handle: 'broken', name: 'BROKEN', reason: 'its newest posts answered HTTP 404' }]);

    const back = (await store.getCandidateById(a.id, SCOPE)).data;
    assert.equal(back.recentPosts.length, 2);
    assert.equal(back.recentPosts[0].title, 'Post 1', 'newest first');
    assert.equal(back.recentPosts[0].postedAt, new Date(NOW - DAY).toISOString());
    assert.equal(back.postsReadAt, new Date(NOW).toISOString());
    assert.equal(back.photoUrl, 'https://substackcdn.com/image/photo.png');
    assert.equal(back.logoUrl, 'https://bucketeer.s3.amazonaws.com/logo.png');
    assert.equal(calls.filter((u) => u.includes('/user/writer/')).length, 0, 'the archive named both pictures, so no profile read');

    const quiet = (await store.getCandidateById(empty.id, SCOPE)).data;
    assert.deepEqual(quiet.recentPosts, [], 'read, has no posts');
    assert.equal(quiet.postsReadAt, new Date(NOW).toISOString());
    assert.equal(quiet.photoUrl, 'https://substackcdn.com/quiet.png', 'no posts: the photo came from the profile');
    assert.equal(quiet.logoUrl, 'https://bucketeer.s3.amazonaws.com/quiet-logo.png');

    const unread = (await store.getCandidateById(broken.id, SCOPE)).data;
    assert.equal(unread.postsReadAt, null, 'could not be read: the date stays null');

    // Landmine 12: the rows the store wrote keep both tenant columns.
    const raw = db.data.get('substack_candidates').find((r) => r.id === a.id);
    assert.equal(raw.project_id, 'proj_a');
    assert.equal(raw.owner_user_id, 'user_1');
    assert.equal(back.projectId, 'proj_a');
    assert.equal(back.ownerUserId, 'user_1');
  } finally { restore(); }
});

test('a writer read this week is skipped, an old reading is read again oldest first, rejected never', async () => {
  const { store, run, restore } = withDb();
  try {
    const fresh = await writer(store, 'fresh');
    const stale = await writer(store, 'stale');
    await writer(store, 'never');
    await writer(store, 'nope', { status: 'rejected' });
    assert.equal((await store.recordRecentPosts(fresh.id, { posts: [] }, SCOPE, { now: NOW - 2 * DAY })).ok, true);
    assert.equal((await store.recordRecentPosts(stale.id, { posts: [] }, SCOPE, { now: NOW - 8 * DAY })).ok, true);

    const calls = [];
    const res = await run.runSubstackPostsRead({}, SCOPE, deps({ fetchJson: fakeSubstack({}, calls) }));
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.writers, 3, 'rejected writers are not counted');
    assert.equal(res.data.recent, 1);
    const archives = calls.filter((u) => u.includes('/api/v1/archive'));
    assert.deepEqual(archives.map((u) => u.match(/https:\/\/([^.]+)/)[1]), ['never', 'stale'], 'never read first, then the oldest');

    // Straight away again: nothing is due, and the summary says so in plain words.
    const again = await run.runSubstackPostsRead({}, SCOPE, deps({ fetchJson: fakeSubstack({}) }));
    assert.equal(again.data.due, 0);
    assert.deepEqual(run.formatPostsReadSummary(again.data), ['Nothing to read: every writer was read in the last 7 days (3 writers).']);
  } finally { restore(); }
});

test('the clock stops the pass early and says how many writers it left for next time', async () => {
  const { store, run, restore } = withDb();
  try {
    for (const h of ['one', 'two', 'three', 'four']) await writer(store, h);
    let t = NOW;
    const res = await run.runSubstackPostsRead({}, SCOPE, {
      sleep: async () => {},
      now: () => t,
      timeBudgetMs: 1000,
      fetchJson: async (url) => { t += 600; return fakeSubstack({})(url); },
    });
    assert.equal(res.ok, true, res.error);
    assert.ok(res.data.read.length >= 1 && res.data.read.length < 4, `read ${res.data.read.length}`);
    assert.equal(res.data.read.length + res.data.notReached, 4);
    assert.match(run.formatPostsReadSummary(res.data).join('\n'), /not reached — the run ran out of time/);
  } finally { restore(); }
});

test('re-reading one writer reads it now, even inside the 7 days', async () => {
  const { store, run, restore } = withDb();
  try {
    const w = await writer(store, 'writer');
    await store.recordRecentPosts(w.id, { posts: [] }, SCOPE, { now: NOW - DAY });
    const res = await run.runSubstackPostsRead({ candidateId: w.id }, SCOPE, deps({ fetchJson: fakeSubstack({ archives: { writer: [post(1)] } }) }));
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.candidate.recentPosts.length, 1);
    const failed = await run.runSubstackPostsRead({ candidateId: w.id }, SCOPE, deps({ fetchJson: fakeSubstack({ archives: { writer: { fail: true } } }) }));
    assert.equal(failed.ok, false);
    assert.match(failed.error, /WRITER could not be read: its newest posts answered HTTP 404/);
  } finally { restore(); }
});

test('a profile that does not own the publication lends no picture', async () => {
  const { run, restore } = withDb();
  try {
    const stranger = { id: 1, handle: 'writer', photo_url: 'https://substackcdn.com/stranger.png', primaryPublication: { subdomain: 'elsewhere', logo_url: 'https://x.s3.amazonaws.com/l.png' } };
    assert.deepEqual(await run.imagesFromProfile('writer', fakeSubstack({ profiles: { writer: stranger } })), { photoUrl: '', logoUrl: '' });
  } finally { restore(); }
});

test('the store refuses a malformed post by name, and keeps a picture a later reading did not find', async () => {
  const { store, restore } = withDb();
  try {
    const w = await writer(store, 'writer');
    const bad = await store.recordRecentPosts(w.id, { posts: [{ title: 'x', url: 'http://insecure.example/p' }] }, SCOPE);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /posts\[0\]\.url must be an https address/);
    const unknown = await store.recordRecentPosts(w.id, { posts: [{ title: 'x', body: 'whole article' }] }, SCOPE);
    assert.equal(unknown.ok, false);
    assert.match(unknown.error, /posts\[0\]/);

    await store.recordRecentPosts(w.id, { posts: [], photoUrl: 'https://substackcdn.com/p.png', logoUrl: 'https://x.s3.amazonaws.com/l.png' }, SCOPE);
    const later = await store.recordRecentPosts(w.id, { posts: [], photoUrl: '', logoUrl: '' }, SCOPE);
    assert.equal(later.data.photoUrl, 'https://substackcdn.com/p.png');
    assert.equal(later.data.logoUrl, 'https://x.s3.amazonaws.com/l.png');
  } finally { restore(); }
});

test('the scheduled pass reads every project with writers, and logs each writer not read', async () => {
  const { run, restore } = withDb();
  try {
    const seen = [];
    const res = await run.runPostsReadDue({
      discover: async () => ({ ok: true, data: [{ projectId: 'p1', userId: 'u1' }, { projectId: 'p2', userId: 'u2' }] }),
      read: async (input, scope) => {
        seen.push(scope.projectId);
        return scope.projectId === 'p1'
          ? { ok: true, data: { read: [{ handle: 'a' }], failed: [{ handle: 'b', reason: 'its newest posts answered HTTP 404' }], notReached: 2 } }
          : { ok: false, status: 500, error: 'database down' };
      },
    });
    assert.equal(res.ok, true);
    assert.deepEqual(seen, ['p1', 'p2']);
    const log = run.formatPostsReadDueLog(res.data).join('\n');
    assert.match(log, /writers_read=1 writers_not_read=1 writers_left_for_next_time=2 failed=1/);
    assert.match(log, /WRITER NOT READ project=p1 writer=b/);
    assert.match(log, /FAILED project=p2: database down/);
  } finally { restore(); }
});

test('the scheduled path is a cron path and is scheduled in vercel.json', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8'));
  assert.ok(vercel.crons.some((c) => c.path === '/api/acquire/substack-miner/read-posts-due'), 'listed in vercel.json crons');
  const index = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'index.js'), 'utf8');
  assert.match(index, /'\/api\/acquire\/substack-miner\/read-posts-due'/, 'listed in CRON_PATHS');
});

test('the suggestion pass and the posts pass read the archive through the SAME function', () => {
  for (const file of ['SubstackSuggestRun.js', 'SubstackPostsReadRun.js']) {
    const src = fs.readFileSync(path.join(ACQUIRE, file), 'utf8');
    assert.match(src, /require\('\.\/SubstackArchive'\)/, `${file} uses the shared reader`);
    assert.match(src, /readArchive\(/, `${file} calls readArchive`);
    assert.doesNotMatch(src, /api\/v1\/archive/, `${file} must not build an archive address of its own`);
  }
});

test('the suggestion pass sees the same post lines through the shared reader', async () => {
  const { restore } = withDb();
  try {
    const suggest = require('../../lib/acquire/SubstackSuggestRun.js');
    assert.equal(suggest.archiveUrl({ handle: 'x', publicationUrl: '' }), 'https://x.substack.com/api/v1/archive?sort=new&limit=8');
  } finally { restore(); }
});
