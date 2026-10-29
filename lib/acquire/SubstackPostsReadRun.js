'use strict';

/**
 * Substack Miner — keep each writer's newest posts and pictures (Substack
 * Miner upgrade 1/4, task 86bcuxwhy).
 *
 * Until this existed the Miner stored no posts at all: the suggestion pass
 * read a writer's eight newest titles, used them once for its guess and threw
 * them away. The Candidates list (2/4, 3/4) and the writer's details page
 * (4/4) need them, so this pass reads and KEEPS them on the writer.
 *
 * Per writer that is not rejected and was never read, or last read more than
 * 7 days ago (oldest first, never-read before any):
 *
 *   1. read the newest 8 posts from the public archive through
 *      ./SubstackArchive.js readArchive — the same function the suggestion
 *      pass reads with, so the two cannot read a post differently. The
 *      archive's admin byline also carries the writer's photo and the
 *      publication's logo, so most writers cost ONE request;
 *   2. only when the archive named no photo or no logo (a writer with no
 *      posts yet, or only guest bylines), ask Substack's public profile
 *      (`substack.com/api/v1/user/<handle>/public_profile` → `photo_url`, and
 *      `primaryPublication.logo_url` or the matching `publicationUsers[]
 *      .publication.logo_url`), trusted only when that profile says the
 *      publication is theirs — the Notes pass's own rule, so a person who
 *      merely shares the handle never lends a stranger their face;
 *   3. store it (store.recordRecentPosts). A writer with no posts gets [] and a
 *      date, which reads as "read, has no posts". A writer whose archive could
 *      not be read keeps its date as it was and is named with the reason.
 *
 * Polite like every Miner pass: `pauseMsBetweenFetches` between any two
 * requests, and a 240s clock — a serverless request ends at 300s — after which
 * it stops starting writers and says how many it left for next time.
 *
 * runPostsReadDue is the scheduled pass (Vercel Cron, once a day): the same
 * read for every project with writers to read, sharing one clock.
 *
 * Every outside dependency comes in through `deps`, so
 * scripts/builder/substackPostsReadRun.test.js drives it with no network.
 */

const minerStore = require('../substackMinerStore');
const { sbQuery, tableConfig } = require('../supabase');
const { fetchSubstackJson, profileOwnsPublication } = require('./SubstackNotesReadRun');
const { readArchive, httpsUrl } = require('./SubstackArchive');

const DAY_MS = 24 * 60 * 60 * 1000;
/** A writer read more recently than this is not read again (the ticket's 7 days). */
const REREAD_AFTER_MS = 7 * DAY_MS;
/** Stop starting new writers after this long — a serverless request ends at 300s. */
const DEFAULT_TIME_BUDGET_MS = 240000;
/** Below this much time left on the scheduled pass, a project is not started. */
const MIN_PROJECT_BUDGET_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function text(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/** Never read sorts first, then the longest ago. */
function readAtMs(c) {
  const ms = Date.parse(c.postsReadAt || '');
  return Number.isFinite(ms) ? ms : -Infinity;
}

/** Is this writer due a read at `now`? Rejected writers never are. */
function isDue(c, now) {
  if (c.status === 'rejected') return false;
  const ms = readAtMs(c);
  return ms === -Infinity || now - ms > REREAD_AFTER_MS;
}

/**
 * The photo and logo from a writer's public profile, or blanks. Trusted only
 * when the profile owns the publication (see step 2 above).
 */
async function imagesFromProfile(handle, fetchJson) {
  const profile = await fetchJson(`https://substack.com/api/v1/user/${encodeURIComponent(handle)}/public_profile`);
  if (!profile.ok || !profileOwnsPublication(profile.data, handle)) return { photoUrl: '', logoUrl: '' };
  const p = profile.data;
  const owned = text(p.primaryPublication?.subdomain).toLowerCase() === handle
    ? p.primaryPublication
    : (Array.isArray(p.publicationUsers) ? p.publicationUsers : [])
      .map((pu) => pu?.publication)
      .find((pub) => text(pub?.subdomain).toLowerCase() === handle);
  return { photoUrl: httpsUrl(p.photo_url), logoUrl: httpsUrl(owned?.logo_url) };
}

/**
 * Read one writer and store it. Answers `{ ok: true, data: candidate }`,
 * `{ ok: false, reason }` when Substack could not be read (nothing stored), or
 * the store's refusal (`{ ok: false, status, error }`).
 */
async function readOneWriter(writer, scope, { store, fetchJson, now }) {
  const archive = await readArchive(writer, fetchJson);
  if (!archive.ok) return { ok: false, reason: `its newest posts ${archive.reason}` };
  let { photoUrl, logoUrl } = archive.images;
  if (!photoUrl || !logoUrl) {
    const profile = await imagesFromProfile(writer.handle, fetchJson);
    photoUrl = photoUrl || profile.photoUrl;
    logoUrl = logoUrl || profile.logoUrl;
  }
  return store.recordRecentPosts(writer.id, { posts: archive.posts, photoUrl, logoUrl }, scope, { now: now() });
}

/**
 * Run the pass for one project.
 *
 *   input.candidateId   read just this writer, now, whenever it was last read
 *                       (rejected writers included — it was asked for by name)
 *
 * Answers `{ ok: true, status: 200, data: summary }`:
 *   { writers, due, read: [{ handle, name, posts }], failed: [{ handle, name,
 *     reason }], recent, notReached, candidate? }
 * or a refusal naming why nothing was read.
 */
async function runSubstackPostsRead(input = {}, scope = null, deps = {}) {
  const store = deps.minerStore || minerStore;
  const baseFetch = deps.fetchJson || fetchSubstackJson;
  const wait = deps.sleep || sleep;
  const now = deps.now || Date.now;
  const timeBudgetMs = deps.timeBudgetMs || DEFAULT_TIME_BUDGET_MS;

  const settings = await store.getSettings(scope);
  if (!settings.ok) return settings;
  const pauseMs = Math.max(0, Number(settings.data.pauseMsBetweenFetches ?? minerStore.SETTINGS_DEFAULTS.pauseMsBetweenFetches) || 0);

  let fetches = 0;
  const fetchJson = async (url) => {
    if (fetches > 0 && pauseMs) await wait(pauseMs);
    fetches += 1;
    return baseFetch(url);
  };

  const oneId = text(input?.candidateId, 120);
  if (oneId) {
    const found = await store.getCandidateById(oneId, scope);
    if (!found.ok) return found;
    const writer = found.data;
    const label = writer.name || writer.handle;
    const saved = await readOneWriter(writer, scope, { store, fetchJson, now });
    if (saved.reason) return refuse(`${label} could not be read: ${saved.reason}`, 502);
    if (!saved.ok) return saved;
    return {
      ok: true,
      status: 200,
      data: {
        writers: 1, due: 1, recent: 0, notReached: 0, failed: [],
        read: [{ handle: writer.handle, name: label, posts: saved.data.recentPosts.length }],
        candidate: saved.data,
      },
    };
  }

  const listed = await store.listCandidates(1000, scope);
  if (!listed.ok) return listed;
  const writers = (listed.data || []).filter((c) => c.status !== 'rejected');
  const startNow = now();
  const due = writers.filter((c) => isDue(c, startNow)).sort((a, b) => readAtMs(a) - readAtMs(b));
  const summary = {
    writers: writers.length,
    due: due.length,
    recent: writers.length - due.length,
    read: [],
    failed: [],
    notReached: 0,
  };

  for (let i = 0; i < due.length; i += 1) {
    if (now() - startNow > timeBudgetMs) {
      summary.notReached = due.length - i;
      break;
    }
    const writer = due[i];
    const label = writer.name || writer.handle;
    const saved = await readOneWriter(writer, scope, { store, fetchJson, now });
    if (saved.reason) {
      summary.failed.push({ handle: writer.handle, name: label, reason: saved.reason });
      continue;
    }
    if (!saved.ok) {
      // A tenancy or database failure is not one writer's fault: stop and say so.
      if (saved.status >= 500) return saved;
      summary.failed.push({ handle: writer.handle, name: label, reason: saved.error });
      continue;
    }
    summary.read.push({ handle: writer.handle, name: label, posts: saved.data.recentPosts.length });
  }
  return { ok: true, status: 200, data: summary };
}

/** The summary as lines: one headline, then every writer not read, by name. */
function formatPostsReadSummary(s) {
  if (!s.due) {
    return [s.writers
      ? `Nothing to read: every writer was read in the last 7 days (${s.writers} writer${s.writers === 1 ? '' : 's'}).`
      : 'Nothing to read: there are no writers yet, other than rejected ones.'];
  }
  const noPosts = s.read.filter((r) => !r.posts).length;
  const lines = [`Read posts for ${s.read.length} writer${s.read.length === 1 ? '' : 's'}`
    + (s.failed.length ? `; ${s.failed.length} could not be read` : '')
    + (noPosts ? `; ${noPosts} ha${noPosts === 1 ? 's' : 've'} no posts yet` : '')
    + '.'
    + (s.recent ? ` ${s.recent} other writer${s.recent === 1 ? ' was' : 's were'} read in the last 7 days and skipped.` : '')];
  for (const f of s.failed) lines.push(`${f.name}: not read — ${f.reason}`);
  if (s.notReached) lines.push(`${s.notReached} writer${s.notReached === 1 ? '' : 's'} not reached — the run ran out of time. They are read next time.`);
  return lines;
}

// ── The scheduled pass ─────────────────────────────────────────────────────

/** Every project with at least one writer that is not rejected, and an owner to act as. */
async function discoverProjects(deps = {}) {
  const query = deps.sbQuery || sbQuery;
  const res = await query({
    method: 'GET',
    table: tableConfig().substackCandidates,
    query: 'status=neq.rejected&select=project_id,owner_user_id&limit=5000',
  });
  if (!res.ok) return res;
  const seen = new Map();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const projectId = text(row.project_id, 120);
    if (!projectId || seen.has(projectId)) continue;
    seen.set(projectId, { projectId, userId: text(row.owner_user_id, 120) });
  }
  return { ok: true, status: 200, data: [...seen.values()] };
}

/**
 * The scheduled pass: runSubstackPostsRead for every project, one clock for
 * all of them. `ok` is false only when discovery itself failed.
 *   { projects, read: [{ projectId, read, failed, notReached }], failed, notReached }
 */
async function runPostsReadDue(deps = {}) {
  const discover = deps.discover || (() => discoverProjects(deps));
  const read = deps.read || runSubstackPostsRead;
  const now = deps.now || Date.now;
  const budgetMs = deps.budgetMs || DEFAULT_TIME_BUDGET_MS;

  const found = await discover();
  if (!found.ok) {
    return { ok: false, status: found.status || 500, error: `Could not read which projects have Substack writers: ${found.error || 'unknown error'}` };
  }
  const report = { projects: found.data.length, read: [], failed: [], notReached: [] };
  const startedAt = now();
  for (const { projectId, userId } of found.data) {
    const left = budgetMs - (now() - startedAt);
    if (left < MIN_PROJECT_BUDGET_MS) {
      report.notReached.push({ projectId });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const res = await read({}, { projectId, userId }, { timeBudgetMs: left });
    if (res.ok) {
      report.read.push({ projectId, read: res.data.read.length, failed: res.data.failed, notReached: res.data.notReached });
    } else {
      report.failed.push({ projectId, error: res.error || 'unknown error' });
    }
  }
  return { ok: true, status: 200, data: report };
}

/** The log lines for one scheduled pass: one summary, then each failure by name. */
function formatPostsReadDueLog(report) {
  const writers = report.read.reduce((n, r) => n + r.read, 0);
  const notRead = report.read.reduce((n, r) => n + r.failed.length, 0);
  const left = report.read.reduce((n, r) => n + r.notReached, 0);
  const lines = [`[substack-miner] read-posts-due projects=${report.projects} writers_read=${writers} writers_not_read=${notRead} `
    + `writers_left_for_next_time=${left} failed=${report.failed.length} not_reached=${report.notReached.length}`];
  for (const r of report.read) {
    for (const f of r.failed) lines.push(`[substack-miner] read-posts-due WRITER NOT READ project=${r.projectId} writer=${f.handle}: ${f.reason}`);
  }
  for (const f of report.failed) lines.push(`[substack-miner] read-posts-due FAILED project=${f.projectId}: ${f.error}`);
  for (const f of report.notReached) lines.push(`[substack-miner] read-posts-due NOT REACHED project=${f.projectId}`);
  return lines;
}

module.exports = {
  runSubstackPostsRead,
  runPostsReadDue,
  discoverProjects,
  formatPostsReadSummary,
  formatPostsReadDueLog,
  imagesFromProfile,
  isDue,
  REREAD_AFTER_MS,
};
