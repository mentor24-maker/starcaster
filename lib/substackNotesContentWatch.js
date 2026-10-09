'use strict';

/**
 * Substack Notes 4/7 (task 86bcet775) — when Dane publishes something new (a
 * YouTube video, a Substack article, a post on his Starcaster blog), a draft
 * Note about it lands on the Approvals tab. He still approves every one.
 *
 * Vercel Cron calls GET /api/engage/substack-notes/watch-content every fifteen
 * minutes. For each account with saved settings this reads three sources:
 *
 *   YouTube   https://www.youtube.com/feeds/videos.xml?channel_id=<id>  (no API key)
 *   Substack  <substack address>/feed
 *   Blog      the project's published blog_posts, through lib/blogPostsStore.js
 *
 * and for each piece it has not seen, makes one `new_content` Note and runs the
 * drafter from 3/7 on it (lib/substackNotesStore.js writeDraftForItem — the
 * same rule checks as the button).
 *
 * THREE RULES, each tested in scripts/builder/substackNotesContentWatch.test.js:
 *
 *   NEVER TWICE. A piece is new only if no `new_content` Note has its address
 *   and it is not in the source's `seen` list. The address is normalized first
 *   (normalizeContentUrl), so a tracking parameter or a trailing slash cannot
 *   make one video two. docs/SQL/substack_notes_content_unique.sql adds the
 *   unique index that stops two passes racing; a 409 from it is "already have
 *   it", not a failure. A Note Dane deletes stays seen, so it does not come back.
 *
 *   FIRST RUN DOES NOT FLOOD. The first time a source is read successfully,
 *   everything in it is recorded as seen and nothing is drafted; the screen
 *   says how many. After that, a piece dated before watching began is also
 *   recorded as seen rather than drafted — which is what makes a first read
 *   that came back empty by mistake harmless. "Draft a Note for my latest
 *   piece" on Settings is the way to get one for something older.
 *
 *   NEVER MORE WAITING THAN TODAY CAN POST. New drafts are limited to the
 *   daily maximum, less what posted today, less what is already waiting. A
 *   piece that does not fit stays unseen and is drafted on a later pass.
 *
 * A source that is not watched says why ("no Substack address saved in
 * Settings"), and one that could not be read says what happened — the
 * Ideas tab shows both. Nothing here posts anything.
 *
 * The pure half (parsing, planning, wording) is exported for the tests; the
 * readers and the stores are injectable for the same reason.
 */

const { sbQuery, tableConfig } = require('./supabase');
const store = require('./substackNotesStore');
const { isValidTimeZone, localDay } = require('./youtubeOutreachSchedule');

/** Drafts written in one pass across every account: each is an AI call. The rest wait for the next pass. */
const MAX_DRAFTS_PER_PASS = 6;

/** Addresses remembered per source. A feed holds ~15; this is many passes of headroom. */
const MAX_SEEN_PER_SOURCE = 300;

/** How many blog posts are read per pass — the newest. */
const BLOG_POSTS_READ = 20;

/** Where a site's post page lives, in order of preference (lib/builder-client/blog-post-editor-meta.ts). */
const POST_PAGE_SLUGS = ['blog-post-view', 'blog-post'];

const SOURCE_LABELS = Object.freeze({ youtube: 'YouTube', substack: 'Substack', blog: 'Blog' });
const SOURCE_KEYS = Object.freeze(['youtube', 'substack', 'blog']);

/** Statuses that are already waiting to go out, whatever their kind. */
const WAITING_STATUSES = new Set(['draft', 'approved', 'posting']);

function text(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

// ── Addresses ──────────────────────────────────────────────────────────────

/**
 * One piece of content, one address. Lower-case host, no #fragment, no
 * utm_* tracking, no trailing slash; a YouTube watch link keeps only `v`.
 * Returns '' for anything that is not an http(s) address.
 */
function normalizeContentUrl(value) {
  let url;
  try {
    url = new URL(text(value));
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if ((host === 'youtube.com') && url.pathname === '/watch' && url.searchParams.get('v')) {
    return `https://www.youtube.com/watch?v=${url.searchParams.get('v')}`;
  }
  if (host === 'youtu.be' && url.pathname.length > 1) {
    return `https://www.youtube.com/watch?v=${url.pathname.slice(1).split('/')[0]}`;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

// ── Feed parsing ───────────────────────────────────────────────────────────

function decodeXml(value) {
  const raw = String(value || '').trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) return cdata[1].trim();
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, '\'')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** The text of the first <tag> inside `block`, or ''. */
function tagText(block, tag) {
  const escaped = tag.replace(':', '\\:');
  const match = String(block).match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function isoOrNull(value) {
  const at = Date.parse(String(value || ''));
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/**
 * A YouTube channel feed (Atom) → [{ url, title, publishedAt }], newest first
 * as the feed lists them. Only <entry> blocks are read — the feed's own
 * <title> and <link> describe the channel, not a video.
 */
function parseYouTubeFeed(xml) {
  const entries = [];
  for (const match of String(xml || '').matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = match[1];
    const videoId = tagText(block, 'yt:videoId');
    const link = (block.match(/<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"/i) || [])[1] || '';
    const url = normalizeContentUrl(videoId ? `https://www.youtube.com/watch?v=${videoId}` : decodeXml(link));
    if (!url) continue;
    entries.push({ url, title: tagText(block, 'title'), publishedAt: isoOrNull(tagText(block, 'published')) });
  }
  return entries;
}

/**
 * An RSS 2.0 feed (Substack's) → [{ url, title, publishedAt }]. Only <item>
 * blocks are read — the channel's <link> is the publication, not an article.
 */
function parseRssFeed(xml) {
  const entries = [];
  for (const match of String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const url = normalizeContentUrl(tagText(block, 'link') || tagText(block, 'guid'));
    if (!url) continue;
    entries.push({ url, title: tagText(block, 'title'), publishedAt: isoOrNull(tagText(block, 'pubDate')) });
  }
  return entries;
}

/** Does this body look like a feed at all? A login page or an error page answers 200 too. */
function looksLikeFeed(body) {
  return /<(?:rss|feed)\b/i.test(String(body || '').slice(0, 5000));
}

// ── Reading the three sources ──────────────────────────────────────────────

async function defaultFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Starcaster Substack Notes)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(10000),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/** Fetch and parse one feed. Never throws: `{ ok, entries }` or `{ ok: false, reason }`. */
async function readFeed(url, parse, what, fetcher) {
  let res;
  try {
    res = await fetcher(url);
  } catch (err) {
    return { ok: false, reason: `${what} could not be reached (${text(err?.message, 200) || 'unknown error'})` };
  }
  if (!res?.ok) return { ok: false, reason: `${what} answered ${res?.status || 'with an error'}` };
  if (!looksLikeFeed(res.text)) return { ok: false, reason: `${what} did not send a feed` };
  return { ok: true, entries: parse(res.text) };
}

async function readYouTube(settings, deps) {
  const channelId = text(settings?.youtubeChannelId, 40);
  if (!channelId) return { key: 'youtube', identity: '', watched: false, reason: 'no YouTube channel saved in Settings' };
  const read = await readFeed(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
    parseYouTubeFeed,
    'YouTube\'s feed for this channel',
    deps.fetcher
  );
  return { key: 'youtube', identity: channelId, watched: true, ...read };
}

async function readSubstack(settings, deps) {
  const address = text(settings?.substackUrl);
  if (!address) return { key: 'substack', identity: '', watched: false, reason: 'no Substack address saved in Settings' };
  let origin;
  try {
    origin = new URL(address).origin;
  } catch {
    return { key: 'substack', identity: '', watched: false, reason: `the Substack address in Settings is not a web address (${address})` };
  }
  const read = await readFeed(`${origin}/feed`, parseRssFeed, `The Substack feed at ${origin}/feed`, deps.fetcher);
  return { key: 'substack', identity: origin.toLowerCase(), watched: true, ...read };
}

/**
 * The project's published blog posts, each with the address a visitor opens:
 * https://<domain>/<post page>?post=<slug>. A project with no domain or no
 * post page has nothing to link a Note to, and says so.
 */
async function readBlog(scope, deps, now) {
  const project = await deps.getProject(scope.projectId);
  if (!project?.ok) return { key: 'blog', identity: '', watched: true, ok: false, reason: `the project could not be read (${text(project?.error, 200) || 'unknown error'})` };
  const domain = text(project.data?.domain, 255).toLowerCase();
  if (!domain) {
    return { key: 'blog', identity: '', watched: false, reason: 'this project has no web address saved, so a blog post has no link to share' };
  }
  let pagePath = '';
  for (const slug of POST_PAGE_SLUGS) {
    // eslint-disable-next-line no-await-in-loop
    const found = await deps.findPage(scope.projectId, slug);
    if (found === null || found === undefined) {
      return { key: 'blog', identity: '', watched: true, ok: false, reason: 'the site\'s pages could not be read to find the blog post page' };
    }
    if (found) { pagePath = slug; break; }
  }
  if (!pagePath) {
    return { key: 'blog', identity: '', watched: false, reason: `the site has no blog post page (${POST_PAGE_SLUGS.map((s) => `/${s}`).join(' or ')})` };
  }
  let posts;
  try {
    posts = await deps.listPosts({ status: 'published', limit: BLOG_POSTS_READ }, { projectId: scope.projectId });
  } catch (err) {
    return { key: 'blog', identity: '', watched: true, ok: false, reason: `the blog could not be read (${text(err?.message, 200) || 'unknown error'})` };
  }
  const entries = [];
  for (const post of Array.isArray(posts) ? posts : []) {
    const slug = text(post?.slug, 300);
    if (!slug || post?.status !== 'published') continue;
    const publishedAt = isoOrNull(post.publishedAt);
    // Scheduled for later: not published yet as far as a visitor can tell.
    if (publishedAt && Date.parse(publishedAt) > now) continue;
    entries.push({
      url: normalizeContentUrl(`https://${domain}/${pagePath}?post=${encodeURIComponent(slug)}`),
      title: text(post.title, 500),
      publishedAt,
    });
  }
  return { key: 'blog', identity: `${domain}/${pagePath}`, watched: true, ok: true, entries };
}

// ── The plan (pure) ────────────────────────────────────────────────────────

/**
 * How many new drafts the account may add now: the daily maximum, less what
 * posted today, less what is already waiting (a draft, an approved action, a
 * restack or like still to be decided). `items` is every item on the account.
 */
function draftAllowance({ settings, items, now, timeZone }) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const cap = Number(settings?.maxActionsPerDay);
  const list = Array.isArray(items) ? items : [];
  const today = localDay(now, zone);
  const postedToday = list.filter((item) => {
    if (item.status !== 'posted') return false;
    const at = Date.parse(item.postedAt || item.updatedAt || '');
    return Number.isFinite(at) && localDay(at, zone) === today;
  }).length;
  const waiting = list.filter((item) => WAITING_STATUSES.has(item.status)
    || (item.status === 'idea' && (item.kind === 'restack' || item.kind === 'like'))).length;
  if (!Number.isFinite(cap)) return { allowance: 0, cap: null, postedToday, waiting };
  return { allowance: Math.max(0, cap - postedToday - waiting), cap, postedToday, waiting };
}

function timeOf(entry) {
  const at = Date.parse(entry?.publishedAt || '');
  return Number.isFinite(at) ? at : null;
}

/**
 * Decide one pass from what was read. Pure: the caller does every read and write.
 *
 *   reads      one per source: { key, identity, watched, ok, reason, entries }
 *   state      the saved content_watch object ({} the first time)
 *   existing   Set of normalized addresses that already have a new_content Note
 *   allowance  how many new drafts fit today (draftAllowance)
 *   latest     true for "Draft a Note for my latest piece": the newest piece
 *              is drafted too, outside the allowance, unless it already has a Note
 *
 * Returns { state, toDraft, held, recordedSeen, latest } — `state` is the new
 * content_watch to save; `toDraft` entries carry their `source` key.
 */
function planWatch({ reads, state, existing, now, allowance, latest = false }) {
  const nowIso = new Date(now).toISOString();
  const previous = state && typeof state === 'object' && state.sources && typeof state.sources === 'object' ? state.sources : {};
  const have = existing instanceof Set ? existing : new Set(existing || []);
  const sources = {};
  const candidates = [];
  const recordedSeen = {};
  const fresh = [];

  for (const read of reads) {
    const prior = previous[read.key];
    // A changed channel or address is a different source: watch it from scratch.
    const prev = prior && prior.identity === read.identity ? prior : null;
    if (!read.watched) {
      sources[read.key] = { identity: '', watched: false, ok: false, reason: text(read.reason, 300), checkedAt: nowIso, since: null, baselineCount: 0, seen: [] };
      continue;
    }
    if (!read.ok) {
      sources[read.key] = {
        identity: read.identity,
        watched: true,
        ok: false,
        reason: text(read.reason, 300),
        checkedAt: nowIso,
        since: prev?.since || null,
        baselineCount: prev?.baselineCount || 0,
        seen: Array.isArray(prev?.seen) ? prev.seen : [],
      };
      continue;
    }
    const entries = (read.entries || []).filter((entry) => entry && entry.url);
    for (const entry of entries) fresh.push({ ...entry, source: read.key });
    const seen = new Set(Array.isArray(prev?.seen) ? prev.seen : []);
    if (!prev?.since) {
      // First successful read: everything already out there is the back catalogue.
      for (const entry of entries) seen.add(entry.url);
      recordedSeen[read.key] = entries.length;
      sources[read.key] = { identity: read.identity, watched: true, ok: true, reason: '', checkedAt: nowIso, since: nowIso, baselineCount: entries.length, seen: [...seen] };
      continue;
    }
    const since = Date.parse(prev.since);
    for (const entry of entries) {
      if (seen.has(entry.url) || have.has(entry.url)) {
        seen.add(entry.url);
        continue;
      }
      const at = timeOf(entry);
      if (at !== null && Number.isFinite(since) && at < since) {
        seen.add(entry.url);
        continue;
      }
      candidates.push({ ...entry, source: read.key });
    }
    sources[read.key] = {
      identity: read.identity, watched: true, ok: true, reason: '', checkedAt: nowIso,
      since: prev.since, baselineCount: prev.baselineCount || 0, seen: [...seen],
    };
  }

  // Oldest first, so a burst of new pieces is drafted in the order they came out.
  candidates.sort((a, b) => (timeOf(a) ?? Infinity) - (timeOf(b) ?? Infinity));
  const room = Math.max(0, Number.isFinite(allowance) ? allowance : 0);
  const toDraft = candidates.slice(0, room);
  const held = candidates.slice(room);

  let latestOutcome = null;
  if (latest) {
    const newest = [...fresh].sort((a, b) => (timeOf(b) ?? -Infinity) - (timeOf(a) ?? -Infinity))[0] || null;
    if (!newest) {
      latestOutcome = { status: 'none' };
    } else if (have.has(newest.url)) {
      latestOutcome = { status: 'exists', entry: newest };
    } else {
      latestOutcome = { status: 'draft', entry: newest };
      if (!toDraft.some((entry) => entry.url === newest.url)) {
        toDraft.unshift(newest);
        const at = held.findIndex((entry) => entry.url === newest.url);
        if (at >= 0) held.splice(at, 1);
      }
    }
  }

  // Keep every source's saved state, including ones not read this time.
  const nextSources = { ...previous, ...sources };
  return {
    state: { ...(state || {}), sources: nextSources, checkedAt: nowIso },
    toDraft,
    held,
    recordedSeen,
    latest: latestOutcome,
  };
}

/** Add `url` to a source's seen list in `state`, keeping the newest MAX_SEEN_PER_SOURCE. */
function markSeen(state, sourceKey, url) {
  const source = state?.sources?.[sourceKey];
  if (!source || !url) return;
  const seen = (Array.isArray(source.seen) ? source.seen : []).filter((u) => u !== url);
  seen.push(url);
  source.seen = seen.slice(-MAX_SEEN_PER_SOURCE);
}

function trimSeen(state) {
  for (const key of Object.keys(state?.sources || {})) {
    const source = state.sources[key];
    if (Array.isArray(source?.seen)) source.seen = source.seen.slice(-MAX_SEEN_PER_SOURCE);
  }
}

// ── What the Ideas tab says (pure) ─────────────────────────────────────────

/**
 * One line per source for the Ideas tab: watched or not, and why; when it
 * last looked; how much was recorded as seen when watching began. Settings
 * decide whether YouTube and Substack are watched before any pass has run, so
 * "not checked yet" and "not watched" are told apart from the start.
 */
function describeWatch({ settings, state, setUp }) {
  const saved = state && typeof state === 'object' ? state : {};
  const sources = saved.sources || {};
  const configured = {
    youtube: settings?.youtubeChannelId ? '' : 'no YouTube channel saved in Settings',
    substack: settings?.substackUrl ? '' : 'no Substack address saved in Settings',
    blog: '',
  };
  const lines = SOURCE_KEYS.map((key) => {
    const s = sources[key] || null;
    const notConfigured = configured[key];
    if (notConfigured) {
      return { key, label: SOURCE_LABELS[key], watched: false, ok: false, reason: notConfigured, checkedAt: '', since: '', baselineCount: 0 };
    }
    if (!s) {
      return { key, label: SOURCE_LABELS[key], watched: true, ok: null, reason: 'not checked yet', checkedAt: '', since: '', baselineCount: 0 };
    }
    return {
      key,
      label: SOURCE_LABELS[key],
      watched: Boolean(s.watched),
      ok: s.watched ? Boolean(s.ok) : false,
      reason: text(s.reason, 300),
      checkedAt: text(s.checkedAt, 40),
      since: text(s.since, 40),
      baselineCount: Number(s.baselineCount) || 0,
    };
  });
  return {
    saved: Boolean(settings?.saved),
    setUp: setUp === false ? false : setUp === true ? true : null,
    checkedAt: text(saved.checkedAt, 40),
    sources: lines,
    lastPass: saved.lastPass && typeof saved.lastPass === 'object' ? saved.lastPass : null,
  };
}

// ── One account, one pass ──────────────────────────────────────────────────

function defaultDeps() {
  const { getPublicProjectById, getProjectTimezoneForUser } = require('./projectsStore');
  const { resolvePublicPageIdForSlug } = require('./builderPagesStore');
  const { listPosts } = require('./blogPostsStore');
  return {
    fetcher: defaultFetch,
    getProject: getPublicProjectById,
    findPage: resolvePublicPageIdForSlug,
    listPosts,
    projectTimeZone: getProjectTimezoneForUser,
  };
}

const NOT_SET_UP = 'The content watch is not set up in this database yet: docs/SQL/substack_notes_content_unique.sql has not been run, so there is nowhere to record what has already been seen. Nothing was drafted.';

/**
 * Watch one account's three sources once: read, plan, make and draft the new
 * Notes, save what was seen. Returns `{ ok, data: report }`; a refusal only
 * when the account could not be read or watched at all.
 *
 * options.latest     also draft the newest piece ("Draft a Note for my latest piece")
 * options.maxDrafts  drafts this call may write (the pass's remaining budget)
 * options.deps       readers and lookups (tests)
 * options.generate   the AI call (tests)
 */
async function watchAccount(scope, accountKey, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const deps = { ...defaultDeps(), ...(options.deps || {}) };
  const account = { accountKey: accountKey || store.DEFAULT_ACCOUNT };

  const watch = await store.getContentWatch(scope, account);
  if (!watch.ok) return watch;
  const { settings, state, setUp } = watch.data;
  if (!settings.saved) {
    return { ok: false, status: 409, error: 'Nothing is saved in Substack Notes Settings for this account yet, so there is nothing to watch. Save the settings first.' };
  }
  if (setUp === false) return { ok: false, status: 503, error: NOT_SET_UP, code: 'NOT_SET_UP' };

  const listed = await store.listItems(1000, scope, account);
  if (!listed.ok) return { ok: false, status: listed.status || 500, error: `The Notes list could not be read, so nothing was drafted: ${listed.error || 'unknown error'}` };
  const existing = new Set(listed.data
    .filter((item) => item.source === 'new_content')
    .map((item) => normalizeContentUrl(item.contentUrl))
    .filter(Boolean));

  let zone = settings.timeZone;
  if (!isValidTimeZone(zone)) zone = text(await deps.projectTimeZone(scope.projectId, scope.userId), 120);
  const room = draftAllowance({ settings, items: listed.data, now, timeZone: zone });

  const reads = await Promise.all([
    readYouTube(settings, deps),
    readSubstack(settings, deps),
    readBlog(scope, deps, now),
  ]);
  const plan = planWatch({ reads, state, existing, now, allowance: room.allowance, latest: Boolean(options.latest) });
  const next = plan.state;

  const budget = Number.isInteger(options.maxDrafts) && options.maxDrafts >= 0 ? options.maxDrafts : MAX_DRAFTS_PER_PASS;
  const report = {
    projectId: scope.projectId,
    accountKey: account.accountKey,
    recordedSeen: plan.recordedSeen,
    drafted: [],
    alreadyHad: [],
    notDrafted: [],
    failed: [],
    waitingForRoom: plan.held.length,
    leftForNextPass: 0,
    allowance: room,
    latest: plan.latest,
    latestItem: null,
  };

  let written = 0;
  for (const entry of plan.toDraft) {
    const isLatest = plan.latest?.status === 'draft' && plan.latest.entry.url === entry.url;
    if (written >= budget && !isLatest) {
      report.leftForNextPass += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const created = await store.createItem({
      accountKey: account.accountKey,
      kind: 'note',
      source: 'new_content',
      contentUrl: entry.url,
      contentTitle: text(entry.title, 500),
    }, scope);
    if (!created.ok) {
      if (created.status === 409) {
        // The unique index: another pass made it a moment ago. Not a failure.
        markSeen(next, entry.source, entry.url);
        report.alreadyHad.push({ url: entry.url, title: entry.title });
      } else {
        report.failed.push({ url: entry.url, title: entry.title, error: created.error || 'the Note was not saved' });
      }
      continue;
    }
    written += 1;
    markSeen(next, entry.source, entry.url);
    // eslint-disable-next-line no-await-in-loop
    const drafted = await store.writeDraftForItem(created.data.id, scope, { generate: options.generate });
    const item = drafted.ok ? drafted.data : created.data;
    if (isLatest) report.latestItem = item;
    if (drafted.ok) {
      report.drafted.push({ id: item.id, url: entry.url, title: entry.title, source: entry.source });
    } else {
      // Saved as an idea with "Write a draft" on its row; the reason is kept for the screen.
      report.notDrafted.push({ id: item.id, url: entry.url, title: entry.title, error: drafted.error || 'no draft was written' });
    }
  }
  if (plan.latest?.status === 'exists') {
    report.latestItem = listed.data.find((item) => item.source === 'new_content'
      && normalizeContentUrl(item.contentUrl) === plan.latest.entry.url) || null;
  }

  trimSeen(next);
  next.lastPass = {
    at: new Date(now).toISOString(),
    drafted: report.drafted.length,
    notDrafted: report.notDrafted.length,
    waitingForRoom: report.waitingForRoom + report.leftForNextPass,
    failed: report.failed.map((f) => `${f.title || f.url}: ${f.error}`).slice(0, 5),
  };
  const saved = await store.saveContentWatch(next, scope, account);
  if (!saved.ok) {
    // The Notes were made; only the memory of what was seen is lost. The
    // address check still stops a second Note, so say it and carry on.
    report.failed.push({ url: '', title: '', error: `what was seen could not be saved: ${saved.error || 'unknown error'}` });
  }
  report.watch = describeWatch({ settings, state: next, setUp });
  return { ok: true, status: 200, data: report };
}

// ── The scheduled pass, across every project ───────────────────────────────

/** Every (project, account) with saved Substack Notes settings, and its owner to act as. */
async function discoverAccounts() {
  const res = await sbQuery({
    method: 'GET',
    table: tableConfig().substackNotesSettings,
    query: 'select=project_id,owner_user_id,account_key&limit=1000',
  });
  if (!res.ok) return res;
  const out = [];
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const projectId = text(row.project_id, 120);
    if (!projectId) continue;
    out.push({ projectId, userId: text(row.owner_user_id, 120), accountKey: text(row.account_key, 80) || store.DEFAULT_ACCOUNT });
  }
  return { ok: true, data: out };
}

/**
 * The cron pass. Cross-project on purpose and cron-only for that reason; the
 * one cross-project read is the discovery above, and everything after it goes
 * through the stores with that project's own scope. An account that could not
 * be watched is reported by name, never skipped quietly.
 */
async function runWatch(options = {}) {
  const found = await discoverAccounts();
  if (!found.ok) {
    return { ok: false, status: found.status || 500, error: `Could not read which projects have Substack Notes settings: ${found.error || 'unknown error'}` };
  }
  const report = { accounts: found.data.length, drafted: 0, recordedSeen: 0, waitingForRoom: 0, results: [], failed: [] };
  let budget = Number.isInteger(options.maxDrafts) && options.maxDrafts >= 0 ? options.maxDrafts : MAX_DRAFTS_PER_PASS;
  for (const { projectId, userId, accountKey } of found.data) {
    // eslint-disable-next-line no-await-in-loop
    const result = await watchAccount({ projectId, userId }, accountKey, { ...options, maxDrafts: budget });
    if (!result.ok) {
      report.failed.push({ projectId, accountKey, error: result.error || 'unknown error' });
      continue;
    }
    const data = result.data;
    budget = Math.max(0, budget - data.drafted.length - data.notDrafted.length);
    report.drafted += data.drafted.length;
    report.recordedSeen += Object.values(data.recordedSeen).reduce((sum, n) => sum + n, 0);
    report.waitingForRoom += data.waitingForRoom + data.leftForNextPass;
    for (const f of data.failed) report.failed.push({ projectId, accountKey, error: `${f.title || f.url || 'watch'}: ${f.error}` });
    for (const f of data.notDrafted) report.failed.push({ projectId, accountKey, error: `${f.title || f.url}: saved as an idea, but ${f.error}` });
    report.results.push({ projectId, accountKey, drafted: data.drafted.length, recordedSeen: data.recordedSeen, sources: data.watch.sources.map((s) => `${s.key}:${s.watched ? (s.ok ? 'ok' : `unread (${s.reason})`) : `off (${s.reason})`}`) });
  }
  return { ok: true, status: 200, data: report };
}

/** The Ideas tab's "Watching:" line for the signed-in project. */
async function getWatchStatus(scope, options = {}) {
  const watch = await store.getContentWatch(scope, options);
  if (!watch.ok) return watch;
  return { ok: true, status: 200, data: describeWatch(watch.data) };
}

module.exports = {
  MAX_DRAFTS_PER_PASS,
  MAX_SEEN_PER_SOURCE,
  POST_PAGE_SLUGS,
  NOT_SET_UP,
  normalizeContentUrl,
  parseYouTubeFeed,
  parseRssFeed,
  looksLikeFeed,
  readYouTube,
  readSubstack,
  readBlog,
  draftAllowance,
  planWatch,
  describeWatch,
  watchAccount,
  runWatch,
  getWatchStatus,
};
