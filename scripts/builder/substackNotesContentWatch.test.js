'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Notes 4/7 (86bcet775) — a draft Note when Dane publishes something.
 *
 * The feeds are REAL, saved 2026-10-09 with their long bodies trimmed:
 *   youtube-feed.xml                https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw
 *   substack-feed-daneofearth.xml   https://daneofearth.substack.com/feed  (his own, one article)
 *   substack-feed-lenny.xml         https://www.lennysnewsletter.com/feed  (three articles)
 *
 * The database is the SQL-parsing fake (scripts/builder/sqlSchemaFake.js) over
 * BOTH docs/SQL/substack_notes_setup.sql and substack_notes_content_unique.sql,
 * so the never-twice unique index is the real one, not a hand-written copy.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'substack-notes');
const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/substackNotesStore.js');
const watchPath = require.resolve('../../lib/substackNotesContentWatch.js');

const SCOPE = { projectId: 'proj_doe', userId: 'user_dane' };
const CHANNEL = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';

const youtubeXml = fs.readFileSync(path.join(FIXTURES, 'youtube-feed.xml'), 'utf8');
const daneXml = fs.readFileSync(path.join(FIXTURES, 'substack-feed-daneofearth.xml'), 'utf8');
const lennyXml = fs.readFileSync(path.join(FIXTURES, 'substack-feed-lenny.xml'), 'utf8');

function sqlText({ withWatchSql = true } = {}) {
  const parts = [fs.readFileSync(path.join(SQL_DIR, 'substack_notes_setup.sql'), 'utf8')];
  if (withWatchSql) parts.push(fs.readFileSync(path.join(SQL_DIR, 'substack_notes_content_unique.sql'), 'utf8'));
  return parts.join('\n');
}

function withDb(options = {}) {
  const db = createFakeDb(parseSchemaText(sqlText(options)));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      substackNotesItems: 'substack_notes_items',
      substackNotesSettings: 'substack_notes_settings',
    }),
    sbQuery: db.sbQuery,
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of [projectScopePath, storePath, watchPath]) delete require.cache[p];
  const store = require(storePath);
  const watch = require(watchPath);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of [projectScopePath, storePath, watchPath]) delete require.cache[p];
  }
  return { db, store, watch, restore };
}

/** A pretend internet: each feed address answers whatever the test put there. */
function makeDeps(feeds, { posts = [], domain = 'daneofearth.starcaster.pro', page = 'blog-post' } = {}) {
  const fetched = [];
  return {
    fetched,
    deps: {
      fetcher: async (url) => {
        fetched.push(url);
        if (!(url in feeds)) return { ok: false, status: 404, text: 'not found' };
        const body = feeds[url];
        if (body && typeof body === 'object') return body;
        return { ok: true, status: 200, text: body };
      },
      getProject: async () => ({ ok: true, data: { id: SCOPE.projectId, domain } }),
      findPage: async (projectId, slug) => (slug === page ? 'page_1' : ''),
      listPosts: async () => posts,
      projectTimeZone: async () => 'UTC',
    },
  };
}

const YT_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;
const SUB_URL = 'https://daneofearth.substack.com/feed';

/** The AI, answering with a short clean Note every time. */
const generate = async () => ({ ok: true, text: '{"text": "New piece out today, about building a company at sixty-four."}' });

async function saveSettings(store, extra = {}) {
  const saved = await store.saveSettings({ substackUrl: 'https://daneofearth.substack.com', youtubeChannelId: CHANNEL, maxActionsPerDay: 3, ...extra }, SCOPE);
  assert.equal(saved.ok, true, saved.error);
}

function aVideo(id, title, publishedIso) {
  return `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><title>${title}</title>`
    + `<link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/><published>${publishedIso}</published></entry>`;
}

/** The real YouTube fixture with one more video added at the top. */
function youtubeWith(extraEntry) {
  return youtubeXml.replace(' <entry>', ` ${extraEntry}\n <entry>`);
}

// ── Feed parsing, from the real feeds ──────────────────────────────────────

test('YouTube feed: every video, by its watch address, title and date — not the channel\'s own title or link', () => {
  const { watch, restore } = withDb();
  try {
    const entries = watch.parseYouTubeFeed(youtubeXml);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries[0], {
      url: 'https://www.youtube.com/watch?v=7sKHiuE7J-Y',
      title: 'Building low-latency remote robotics with Gemini',
      publishedAt: '2026-10-09T16:00:10.000Z',
    });
    assert.ok(entries.every((e) => e.url.startsWith('https://www.youtube.com/watch?v=')));
    assert.ok(!entries.some((e) => e.title === 'Google for Developers'), 'the channel title was read as a video');
    assert.equal(entries[2].title, '📷 Searching for images from text with EmbeddingGemma 2');
  } finally {
    restore();
  }
});

test('Substack feed: every article, its link, CDATA title and date — not the publication\'s own link', () => {
  const { watch, restore } = withDb();
  try {
    const dane = watch.parseRssFeed(daneXml);
    assert.deepEqual(dane, [{
      url: 'https://daneofearth.substack.com/p/the-sixty-four-year-old-startup',
      title: 'The Sixty-Four-Year-Old Startup',
      publishedAt: '2026-07-20T17:12:14.000Z',
    }]);
    const lenny = watch.parseRssFeed(lennyXml);
    assert.equal(lenny.length, 3);
    assert.ok(!lenny.some((e) => e.url === 'https://www.lennysnewsletter.com/'), 'the channel link was read as an article');
    assert.equal(lenny[1].title, 'How OpenAI uses ChatGPT Sites (live at DevDay!) | Kath Korevec (Product Lead)');
    assert.equal(lenny[2].title, 'OpenAI’s Head of ChatGPT: We’re entering a new era of AI (again) | Tibo Sottiaux');
  } finally {
    restore();
  }
});

test('one piece, one address: tracking, fragments, slashes and short links all normalize to the same thing', () => {
  const { watch, restore } = withDb();
  try {
    const n = watch.normalizeContentUrl;
    assert.equal(n('https://youtu.be/7sKHiuE7J-Y'), 'https://www.youtube.com/watch?v=7sKHiuE7J-Y');
    assert.equal(n('https://m.youtube.com/watch?v=7sKHiuE7J-Y&t=30s'), 'https://www.youtube.com/watch?v=7sKHiuE7J-Y');
    assert.equal(
      n('https://DaneOfEarth.substack.com/p/the-sixty-four-year-old-startup/?utm_source=x#comments'),
      'https://daneofearth.substack.com/p/the-sixty-four-year-old-startup'
    );
    assert.equal(n('javascript:alert(1)'), '');
    assert.equal(n('not a link'), '');
  } finally {
    restore();
  }
});

test('a page that is not a feed (a login page answers 200 too) is a read failure with a reason, not an empty feed', async () => {
  const { watch, restore } = withDb();
  try {
    const { deps } = makeDeps({ [YT_URL]: '<html><body>Sign in</body></html>' });
    const read = await watch.readYouTube({ youtubeChannelId: CHANNEL }, deps);
    assert.equal(read.ok, false);
    assert.match(read.reason, /did not send a feed/);
  } finally {
    restore();
  }
});

// ── The first-run rule ─────────────────────────────────────────────────────

test('turning it on drafts NOTHING for old content, and says how many it recorded as seen', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const { deps } = makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml });
    const first = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps, generate });
    assert.equal(first.ok, true, first.error);
    assert.deepEqual(first.data.recordedSeen, { youtube: 3, substack: 1, blog: 0 });
    assert.equal(first.data.drafted.length, 0);
    assert.equal((db.data.get('substack_notes_items') || []).length, 0, 'the back catalogue was drafted');

    const status = await watch.getWatchStatus(SCOPE);
    const yt = status.data.sources.find((s) => s.key === 'youtube');
    assert.equal(yt.watched, true);
    assert.equal(yt.ok, true);
    assert.equal(yt.baselineCount, 3);
    assert.ok(status.data.checkedAt);
  } finally {
    restore();
  }
});

test('a first read that failed does not make the back catalogue look new later', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const down = makeDeps({ [YT_URL]: { ok: false, status: 500, text: '' }, [SUB_URL]: daneXml });
    await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: down.deps, generate });
    const up = makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml });
    const second = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: up.deps, generate });
    assert.equal(second.data.recordedSeen.youtube, 3);
    assert.equal((db.data.get('substack_notes_items') || []).length, 0);
  } finally {
    restore();
  }
});

test('a piece dated before watching began is recorded as seen, never drafted', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const now = Date.parse('2026-10-09T18:00:00Z');
    await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml }).deps, generate, now });
    // An older video that was missing from the first read (unlisted then, say).
    const old = youtubeWith(aVideo('OLDvideo001', 'An old one', '2026-01-01T00:00:00+00:00'));
    const later = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps({ [YT_URL]: old, [SUB_URL]: daneXml }).deps, generate, now: now + 3600000 });
    assert.equal(later.data.drafted.length, 0);
    assert.equal((db.data.get('substack_notes_items') || []).length, 0);
  } finally {
    restore();
  }
});

// ── New content, and the never-twice rule ─────────────────────────────────

test('a new video makes exactly one draft Note on the next pass, and a second pass makes none', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const t0 = Date.parse('2026-10-09T18:00:00Z');
    await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml }).deps, generate, now: t0 });

    const fresh = youtubeWith(aVideo('NEWvideo001', 'Why I build in public', '2026-10-09T19:00:00+00:00'));
    const feeds = { [YT_URL]: fresh, [SUB_URL]: daneXml };
    const second = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps(feeds).deps, generate, now: t0 + 3600000 * 2 });
    assert.equal(second.data.drafted.length, 1);
    const rows = (db.data.get('substack_notes_items') || []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'note');
    assert.equal(rows[0].source, 'new_content');
    assert.equal(rows[0].status, 'draft', 'it should land on Approvals as a draft');
    assert.equal(rows[0].content_url, 'https://www.youtube.com/watch?v=NEWvideo001');
    assert.equal(rows[0].content_title, 'Why I build in public');
    assert.equal(rows[0].project_id, SCOPE.projectId);
    assert.equal(rows[0].owner_user_id, SCOPE.userId);

    const third = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps(feeds).deps, generate, now: t0 + 3600000 * 3 });
    assert.equal(third.data.drafted.length, 0);
    assert.deepEqual(third.data.alreadyHad, [], 'the pass tried to save it again and only the database stopped it');
    assert.equal((db.data.get('substack_notes_items') || []).length, 1, 'the same video was drafted twice');
  } finally {
    restore();
  }
});

test('never twice even when the saved "seen" memory is lost: the existing Note is what counts', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const t0 = Date.parse('2026-10-09T18:00:00Z');
    await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml }).deps, generate, now: t0 });
    const feeds = { [YT_URL]: youtubeWith(aVideo('NEWvideo002', 'Second one', '2026-10-09T19:00:00+00:00')), [SUB_URL]: daneXml };
    await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps(feeds).deps, generate, now: t0 + 7200000 });
    // Wipe every seen list, keeping only when watching began.
    const settingsRow = (db.data.get('substack_notes_settings') || [])[0];
    for (const key of Object.keys(settingsRow.content_watch.sources)) settingsRow.content_watch.sources[key].seen = [];
    const again = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps(feeds).deps, generate, now: t0 + 10800000 });
    assert.equal(again.data.drafted.length, 0);
    assert.deepEqual(again.data.alreadyHad, [], 'the pass tried to save it again and only the database stopped it');
    assert.equal((db.data.get('substack_notes_items') || []).length, 1);
  } finally {
    restore();
  }
});

test('the database refuses a second new_content Note for one address (the unique index), and the watch takes that as "already have it"', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const input = { kind: 'note', source: 'new_content', contentUrl: 'https://www.youtube.com/watch?v=RACEvideo01', contentTitle: 'Race' };
    const one = await store.createItem(input, SCOPE);
    assert.equal(one.ok, true, one.error);
    const two = await store.createItem(input, SCOPE);
    assert.equal(two.ok, false, 'two new_content Notes for one address were saved');
    assert.equal(two.status, 409);
    // A Note he jots by hand about the same piece is not blocked.
    const jotted = await store.createItem({ kind: 'note', source: 'jotted', ideaText: 'More on this', contentUrl: input.contentUrl }, SCOPE);
    assert.equal(jotted.ok, true, jotted.error);
    assert.equal((db.data.get('substack_notes_items') || []).length, 2);
  } finally {
    restore();
  }
});

test('a Note Dane deletes stays seen, so the pass does not bring it back', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const t0 = Date.parse('2026-10-09T18:00:00Z');
    await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml }).deps, generate, now: t0 });
    const feeds = { [YT_URL]: youtubeWith(aVideo('NEWvideo003', 'Delete me', '2026-10-09T19:00:00+00:00')), [SUB_URL]: daneXml };
    const made = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps(feeds).deps, generate, now: t0 + 7200000 });
    const removed = await store.deleteItem(made.data.drafted[0].id, SCOPE);
    assert.equal(removed.ok, true, removed.error);
    const again = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps(feeds).deps, generate, now: t0 + 10800000 });
    assert.equal(again.data.drafted.length, 0);
    assert.equal((db.data.get('substack_notes_items') || []).length, 0);
  } finally {
    restore();
  }
});

// ── The daily maximum ──────────────────────────────────────────────────────

test('never more drafts waiting than today can post; the extras wait for a later pass', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store, { maxActionsPerDay: 2 });
    // One draft already waiting from something else.
    const jotted = await store.createItem({ kind: 'note', ideaText: 'Already waiting' }, SCOPE);
    await store.writeDraftForItem(jotted.data.id, SCOPE, { generate });
    const t0 = Date.parse('2026-10-09T12:00:00Z');
    await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml }).deps, generate, now: t0 });

    const three = youtubeWith(aVideo('NEWa', 'A', '2026-10-09T13:00:00+00:00'))
      .replace(' <entry>', ` ${aVideo('NEWb', 'B', '2026-10-09T14:00:00+00:00')}\n <entry>`)
      .replace(' <entry>', ` ${aVideo('NEWc', 'C', '2026-10-09T15:00:00+00:00')}\n <entry>`);
    const feeds = { [YT_URL]: three, [SUB_URL]: daneXml };
    const pass = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps(feeds).deps, generate, now: t0 + 4 * 3600000 });
    assert.equal(pass.data.drafted.length, 1, 'only one fits: a maximum of 2, with 1 already waiting');
    assert.equal(pass.data.drafted[0].title, 'A', 'the oldest new piece goes first');
    assert.equal(pass.data.waitingForRoom, 2);

    // Dane rejects the waiting jotted draft: room for one more on the next pass.
    await store.rejectItem(jotted.data.id, SCOPE);
    const next = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps(feeds).deps, generate, now: t0 + 5 * 3600000 });
    assert.equal(next.data.drafted.length, 1);
    assert.equal(next.data.drafted[0].title, 'B');
    assert.equal((db.data.get('substack_notes_items') || []).filter((r) => r.source === 'new_content').length, 2);
  } finally {
    restore();
  }
});

test('draftAllowance counts what posted today in the account\'s time zone, and everything waiting', () => {
  const { watch, restore } = withDb();
  try {
    const now = Date.parse('2026-10-09T05:00:00Z'); // still Oct 8 in Denver
    const items = [
      { kind: 'note', status: 'posted', postedAt: '2026-10-09T04:00:00Z' }, // Oct 8 in Denver: today
      { kind: 'note', status: 'posted', postedAt: '2026-10-08T05:00:00Z' }, // Oct 7 in Denver
      { kind: 'note', status: 'draft' },
      { kind: 'like', status: 'idea' },
      { kind: 'note', status: 'idea' },
      { kind: 'note', status: 'rejected' },
    ];
    const room = watch.draftAllowance({ settings: { maxActionsPerDay: 5 }, items, now, timeZone: 'America/Denver' });
    assert.deepEqual(room, { allowance: 2, cap: 5, postedToday: 1, waiting: 2 });
  } finally {
    restore();
  }
});

// ── The blog ───────────────────────────────────────────────────────────────

test('a new blog post is drafted with the address a visitor opens; drafts and scheduled posts are not', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const t0 = Date.parse('2026-10-09T18:00:00Z');
    const old = { slug: 'old-post', title: 'Old', status: 'published', publishedAt: '2026-09-01T00:00:00Z' };
    await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml }, { posts: [old] }).deps, generate, now: t0 });
    const posts = [
      { slug: 'new-post', title: 'A new post', status: 'published', publishedAt: '2026-10-09T19:00:00Z' },
      { slug: 'not-yet', title: 'Scheduled', status: 'published', publishedAt: '2026-12-01T00:00:00Z' },
      { slug: 'wip', title: 'Draft', status: 'draft', publishedAt: null },
      old,
    ];
    const pass = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml }, { posts }).deps, generate, now: t0 + 7200000 });
    assert.equal(pass.data.drafted.length, 1);
    const row = (db.data.get('substack_notes_items') || [])[0];
    assert.equal(row.content_url, 'https://daneofearth.starcaster.pro/blog-post?post=new-post');
    assert.equal(row.content_title, 'A new post');
  } finally {
    restore();
  }
});

// ── Saying why a source is not watched ─────────────────────────────────────

test('a source with no setting says why on screen, rather than silently not watching', async () => {
  const { store, watch, restore } = withDb();
  try {
    await store.saveSettings({ maxActionsPerDay: 3 }, SCOPE);
    const before = await watch.getWatchStatus(SCOPE);
    const reasons = Object.fromEntries(before.data.sources.map((s) => [s.key, [s.watched, s.reason]]));
    assert.deepEqual(reasons.youtube, [false, 'no YouTube channel saved in Settings']);
    assert.deepEqual(reasons.substack, [false, 'no Substack address saved in Settings']);
    assert.deepEqual(reasons.blog, [true, 'not checked yet']);

    const { deps, fetched } = makeDeps({}, { domain: '' });
    const pass = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps, generate });
    assert.equal(pass.ok, true, pass.error);
    assert.deepEqual(fetched, [], 'nothing should be fetched for a source with no setting');
    const blog = pass.data.watch.sources.find((s) => s.key === 'blog');
    assert.equal(blog.watched, false);
    assert.match(blog.reason, /no web address saved/);
  } finally {
    restore();
  }
});

test('a source that could not be read says what happened', async () => {
  const { store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const { deps } = makeDeps({ [SUB_URL]: daneXml });
    const pass = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps, generate });
    const yt = pass.data.watch.sources.find((s) => s.key === 'youtube');
    assert.equal(yt.watched, true);
    assert.equal(yt.ok, false);
    assert.match(yt.reason, /answered 404/);
  } finally {
    restore();
  }
});

test('without the SQL\'s content_watch column, the watch refuses by name instead of flooding', async () => {
  const { db, store, watch, restore } = withDb({ withWatchSql: false });
  try {
    await saveSettings(store);
    const pass = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml }).deps, generate });
    assert.equal(pass.ok, false);
    assert.equal(pass.code, 'NOT_SET_UP');
    assert.match(pass.error, /substack_notes_content_unique\.sql/);
    assert.equal((db.data.get('substack_notes_items') || []).length, 0);
    const status = await watch.getWatchStatus(SCOPE);
    assert.equal(status.data.setUp, false);
  } finally {
    restore();
  }
});

test('with nothing saved in Settings there is nothing to watch, and it says so', async () => {
  const { watch, restore } = withDb();
  try {
    const pass = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps({}).deps, generate });
    assert.equal(pass.ok, false);
    assert.match(pass.error, /Save the settings first/);
  } finally {
    restore();
  }
});

// ── "Draft a Note for my latest piece" ─────────────────────────────────────

test('"Draft a Note for my latest piece" drafts the newest across all sources, even on the first run; clicking again does not make a second', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const feeds = { [YT_URL]: youtubeXml, [SUB_URL]: daneXml };
    const first = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps(feeds).deps, generate, latest: true });
    assert.equal(first.ok, true, first.error);
    assert.equal(first.data.latest.status, 'draft');
    assert.equal(first.data.drafted.length, 1);
    assert.equal(first.data.latestItem.contentUrl, 'https://www.youtube.com/watch?v=7sKHiuE7J-Y');
    assert.equal(first.data.latestItem.status, 'draft');

    const again = await watch.watchAccount(SCOPE, 'dane_of_earth', { deps: makeDeps(feeds).deps, generate, latest: true });
    assert.equal(again.data.latest.status, 'exists');
    assert.equal(again.data.latestItem.id, first.data.latestItem.id);
    assert.equal((db.data.get('substack_notes_items') || []).length, 1);
  } finally {
    restore();
  }
});

// ── The scheduled pass ─────────────────────────────────────────────────────

test('the scheduled pass watches every project with saved settings, each under its own scope', async () => {
  const { db, store, watch, restore } = withDb();
  try {
    await saveSettings(store);
    const other = { projectId: 'proj_other', userId: 'user_other' };
    await store.saveSettings({ maxActionsPerDay: 1 }, other);
    const result = await watch.runWatch({ deps: makeDeps({ [YT_URL]: youtubeXml, [SUB_URL]: daneXml }).deps, generate });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.data.accounts, 2);
    assert.equal(result.data.drafted, 0);
    assert.equal(result.data.recordedSeen, 4);
    const rows = (db.data.get('substack_notes_settings') || []);
    assert.ok(rows.every((r) => r.content_watch && r.content_watch.checkedAt), 'every account should record that it was checked');
  } finally {
    restore();
  }
});

test('the watch path is a cron path and is on the Vercel schedule', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8'));
  assert.ok(vercel.crons.some((c) => c.path === '/api/engage/substack-notes/watch-content'));
  const index = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'index.js'), 'utf8');
  const cronBlock = index.slice(index.indexOf('const CRON_PATHS'), index.indexOf(']);', index.indexOf('const CRON_PATHS')));
  assert.match(cronBlock, /'\/api\/engage\/substack-notes\/watch-content'/);
});
