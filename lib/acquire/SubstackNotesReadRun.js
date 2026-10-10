'use strict';

/**
 * Substack Miner — read each approved writer's newest Notes and line them up
 * on the Substack Notes screen (Substack Miner 5/7, task 86bcfpry0).
 *
 * WHY THIS IS A SERVER READ, NOT THE MINI'S BROWSER. The ticket planned a
 * browser task because the Notes PAGE (substack.com/@name/notes) carries no
 * Notes in its HTML — they are drawn by scripts after it loads. But the data
 * those scripts load is Substack's own public feed, and it answers a plain
 * request with no sign-in (measured 2026-10-10, correction posted on the
 * ticket before building):
 *
 *   substack.com/api/v1/user/<handle>/public_profile      → the writer's user id
 *   substack.com/api/v1/reader/feed/profile/<id>?types[]=note → their Notes
 *
 * So reading needs no browser and no sign-in; the like and the reply it lines
 * up are still done by the Mini's browser later, which checks its own sign-in.
 *
 * WHO WRITES A PUBLICATION. A writer here is a publication handle (the part
 * before .substack.com), and a person's profile handle can differ from it. The
 * profile is trusted only when it says that publication is theirs; otherwise
 * the publication's newest post names its admin. A writer neither answers is
 * reported as not read, by name — never guessed, because a guess would line up
 * a like on a stranger's Note.
 *
 * Per writer: at most a few public reads, `pauseMsBetweenFetches` apart (the
 * Miner's own setting). A writer read in the last 7 days is skipped and
 * counted. It runs only inside the Substack account's active hours
 * (substack_notes_settings), like everything else this account does.
 *
 * The answer accounts for every approved writer: read (how many Notes, what
 * was lined up), skipped (when last read), failed (why), or not reached (the
 * clock ran out). Every outside dependency comes in through `deps`, so
 * scripts/builder/substackNotesCapture.test.js drives it with no network.
 */

const minerStore = require('../substackMinerStore');
const { captureCandidateNotes } = require('./SubstackNotesCapture');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A writer read more recently than this is skipped (the ticket's 7 days). */
const SKIP_IF_READ_WITHIN_MS = 7 * DAY_MS;
/** How many of a writer's newest Notes are taken each read (the ticket's 3). */
const NOTES_PER_WRITER = 3;
// Vercel stops a function at 300s; writers not reached in time are named in
// the answer rather than lost to a timeout that returns nothing.
const DEFAULT_TIME_BUDGET_MS = 240000;

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

/** GET a Substack JSON address. `{ ok, data }` or `{ ok: false, httpStatus, reason }`; never throws. */
async function fetchSubstackJson(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, httpStatus: 0, reason: `could not be reached: ${err.message}` };
  }
  if (!res.ok) return { ok: false, httpStatus: res.status, reason: `answered HTTP ${res.status}` };
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, httpStatus: res.status, reason: 'answered, but not with data it could read' };
  }
}

/** Does this profile say the publication `handle` is theirs (as its admin)? */
function profileOwnsPublication(profile, handle) {
  if (!profile || typeof profile !== 'object') return false;
  if (text(profile.primaryPublication?.subdomain).toLowerCase() === handle) return true;
  return (Array.isArray(profile.publicationUsers) ? profile.publicationUsers : []).some((pu) => (
    text(pu?.publication?.subdomain).toLowerCase() === handle && text(pu?.role) === 'admin'
  ));
}

/** The admin byline on a publication's newest post — its writer. */
function adminFromArchive(posts) {
  const post = Array.isArray(posts) ? posts[0] : null;
  if (!post) return null;
  const pubId = post.publication_id;
  for (const byline of Array.isArray(post.publishedBylines) ? post.publishedBylines : []) {
    if (byline?.is_guest) continue;
    const admin = (Array.isArray(byline?.publicationUsers) ? byline.publicationUsers : [])
      .some((pu) => pu?.publication_id === pubId && pu?.role === 'admin');
    if (admin && byline.id) return { userId: String(byline.id), userHandle: text(byline.handle) };
  }
  return null;
}

/**
 * Which Substack user writes publication `handle`. `fetchJson` is passed in so
 * the pass's polite spacing covers these reads too.
 */
async function resolveWriter(handle, { fetchJson }) {
  const profile = await fetchJson(`https://substack.com/api/v1/user/${encodeURIComponent(handle)}/public_profile`);
  if (profile.ok && profile.data?.id && profileOwnsPublication(profile.data, handle)) {
    return { ok: true, userId: String(profile.data.id), userHandle: text(profile.data.handle) || handle };
  }
  const archive = await fetchJson(`https://${handle}.substack.com/api/v1/archive?sort=new&limit=1`);
  if (!archive.ok) return { ok: false, reason: `could not tell who writes it: its newest post ${archive.reason}` };
  const admin = adminFromArchive(archive.data);
  if (!admin) {
    return { ok: false, reason: 'could not tell who writes it: no Substack profile by that name owns it, and it has no post naming its writer' };
  }
  return { ok: true, ...admin };
}

/**
 * The writer's own Notes out of their profile feed, newest first: only Notes
 * they wrote (not restacks of someone else's), only top-level (not replies).
 *
 * The shape, as Substack answered on 2026-10-10: each item is
 * `{ type: 'comment', context: { type: 'note' }, comment: { id, user_id,
 * handle, body, date, ancestor_path, type: 'feed' } }`. The NOTE marker is on
 * the item's `context`, not on `comment.type` (which says 'feed') — reading the
 * wrong one finds no Notes for anybody, which is what the first live run did.
 */
function parseProfileNotes(feed, userId, userHandle) {
  const items = Array.isArray(feed?.items) ? feed.items : [];
  const out = [];
  for (const item of items) {
    const c = item?.comment;
    if (item?.type !== 'comment' || !c || item?.context?.type !== 'note') continue;
    if (String(c.user_id) !== String(userId)) continue;
    if (text(c.ancestor_path)) continue;
    const posted = Date.parse(text(c.date));
    if (!c.id || !Number.isFinite(posted)) continue;
    const who = text(c.handle) || userHandle;
    out.push({
      url: `https://substack.com/@${who}/note/c-${c.id}`,
      text: text(c.body),
      postedAt: new Date(posted).toISOString(),
    });
  }
  return out.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}

/** The hour (0-23) at `now` in `zone`. */
function hourIn(now, zone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  return Number((parts.find((p) => p.type === 'hour') || {}).value) % 24;
}

function isValidTimeZone(zone) {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function hourText(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  if (h === 0) return 'midnight';
  if (h === 12) return 'noon';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/**
 * Inside the account's active hours? Start inclusive, end exclusive; an end
 * before the start wraps past midnight; equal means all day — the same rule
 * the Mini's poster uses (workers/youtube-outreach/limits.js insideHours).
 */
function activeHoursVerdict(settings, now, zone) {
  const start = Number(settings?.activeStartHour);
  const end = Number(settings?.activeEndHour);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start === end) return { ok: true };
  const hour = hourIn(now, zone);
  const inside = start < end ? (hour >= start && hour < end) : (hour >= start || hour < end);
  if (inside) return { ok: true };
  return {
    ok: false,
    reason: `Not reading now — the Substack account is active between ${hourText(start)} and ${hourText(end)} (${zone}), `
      + 'and the reading runs in the same hours. Run it again then.',
  };
}

/** "today", "1 day ago", "6 days ago". */
function agoText(ms) {
  const days = Math.floor(ms / DAY_MS);
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Run the pass for one project.
 *
 *   input.anyHour  true reads even outside the active hours (a by-hand try)
 *
 * Answers `{ ok: true, status: 200, data: summary }`, or a refusal naming why
 * nothing was read.
 */
async function runSubstackNotesRead(input = {}, scope = null, deps = {}) {
  const store = deps.minerStore || minerStore;
  const notesStore = deps.notesStore || require('../substackNotesStore');
  const fetchJson = deps.fetchJson || fetchSubstackJson;
  const wait = deps.sleep || sleep;
  const now = deps.now || Date.now;
  const capture = deps.capture || ((id, notes) => captureCandidateNotes(id, notes, scope, { minerStore: store, notesStore, now }));
  const timeBudgetMs = deps.timeBudgetMs || DEFAULT_TIME_BUDGET_MS;
  const projectTimeZone = deps.projectTimeZone || (async () => '');

  const account = await notesStore.getSettings(scope);
  if (!account.ok) return account;
  let zone = account.data.timeZone;
  if (!isValidTimeZone(zone)) zone = text(await projectTimeZone(scope?.projectId));
  if (!isValidTimeZone(zone)) zone = 'UTC';
  if (!input?.anyHour) {
    const hours = activeHoursVerdict(account.data, now(), zone);
    if (!hours.ok) return refuse(hours.reason, 409);
  }

  const settings = await store.getSettings(scope);
  if (!settings.ok) return settings;
  const pauseMs = Math.max(0, Number(settings.data.pauseMsBetweenFetches ?? minerStore.SETTINGS_DEFAULTS.pauseMsBetweenFetches) || 0);

  const approved = await store.listCandidates(1000, scope, { status: 'approved' });
  if (!approved.ok) return approved;
  if (!approved.data.length) {
    return refuse('There are no approved writers to read Notes from — approve some on the Candidates screen first.');
  }

  const summary = {
    approved: approved.data.length,
    read: [],
    skipped: [],
    failed: [],
    notReached: [],
    likesLinedUp: 0,
    repliesLinedUp: 0,
  };

  let fetches = 0;
  const politeFetch = async (url) => {
    if (fetches > 0 && pauseMs) await wait(pauseMs);
    fetches += 1;
    return fetchJson(url);
  };

  const startedAt = now();
  for (const writer of approved.data) {
    const label = writer.name || writer.handle;
    const lastRead = Date.parse(writer.lastNotesReadAt || '');
    if (Number.isFinite(lastRead) && now() - lastRead < SKIP_IF_READ_WITHIN_MS) {
      summary.skipped.push({ handle: writer.handle, name: label, lastReadAt: new Date(lastRead).toISOString(), ago: agoText(now() - lastRead) });
      continue;
    }
    if (now() - startedAt > timeBudgetMs) {
      summary.notReached.push({ handle: writer.handle, name: label, reason: 'not read — the run ran out of time' });
      continue;
    }

    const who = await resolveWriter(writer.handle, { fetchJson: politeFetch });
    if (!who.ok) {
      summary.failed.push({ handle: writer.handle, name: label, reason: who.reason });
      continue;
    }
    const feed = await politeFetch(`https://substack.com/api/v1/reader/feed/profile/${encodeURIComponent(who.userId)}?types%5B%5D=note`);
    if (!feed.ok) {
      summary.failed.push({ handle: writer.handle, name: label, reason: `their Notes ${feed.reason}` });
      continue;
    }
    const notes = parseProfileNotes(feed.data, who.userId, who.userHandle).slice(0, NOTES_PER_WRITER);
    const saved = await capture(writer.id, notes);
    if (!saved.ok) {
      // A tenancy or database failure is not one writer's fault: stop and say so.
      if (saved.status >= 500) return saved;
      summary.failed.push({ handle: writer.handle, name: label, reason: saved.error });
      continue;
    }
    const lined = saved.data.linedUp || {};
    if (lined.like?.created) summary.likesLinedUp += 1;
    if (lined.reply?.created) summary.repliesLinedUp += 1;
    summary.read.push({
      handle: writer.handle,
      name: label,
      notes: notes.length,
      newestUrl: saved.data.newestUrl,
      likeLinedUp: Boolean(lined.like?.created),
      replyLinedUp: Boolean(lined.reply?.created),
    });
  }

  return { ok: true, status: 200, data: summary };
}

/** One line per writer, as the terminal prints it. */
function formatReadSummary(s) {
  const lines = [];
  for (const r of s.read) {
    const what = !r.notes
      ? 'read — no Notes yet'
      : `read ${r.notes} Note${r.notes === 1 ? '' : 's'}`
        + (r.likeLinedUp || r.replyLinedUp
          ? ` — lined up ${[r.likeLinedUp && 'a like', r.replyLinedUp && 'a reply'].filter(Boolean).join(' and ')} for the newest`
          : ' — the newest is already lined up');
    lines.push(`${r.name}: ${what}`);
  }
  for (const r of s.skipped) lines.push(`${r.name}: skipped, read ${r.ago}`);
  for (const r of s.failed) lines.push(`${r.name}: NOT READ — ${r.reason}`);
  for (const r of s.notReached) lines.push(`${r.name}: ${r.reason}`);
  lines.push(`${s.approved} approved writer${s.approved === 1 ? '' : 's'}: ${s.read.length} read, ${s.skipped.length} skipped (read in the last 7 days), `
    + `${s.failed.length} could not be read, ${s.notReached.length} not reached. `
    + `Lined up ${s.likesLinedUp} like${s.likesLinedUp === 1 ? '' : 's'} and ${s.repliesLinedUp} repl${s.repliesLinedUp === 1 ? 'y' : 'ies'}.`);
  return lines.join('\n');
}

module.exports = {
  runSubstackNotesRead,
  formatReadSummary,
  parseProfileNotes,
  resolveWriter,
  profileOwnsPublication,
  adminFromArchive,
  activeHoursVerdict,
  fetchSubstackJson,
  SKIP_IF_READ_WITHIN_MS,
  NOTES_PER_WRITER,
};
