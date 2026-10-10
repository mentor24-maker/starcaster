'use strict';

/**
 * Substack Miner — the recommendations snowball (Substack Miner 3/7, task
 * 86bcfprxk).
 *
 * Every Substack publication has a public page at
 * `https://<handle>.substack.com/recommendations` listing the publications it
 * recommends. For each writer Dane has approved (or the handles passed in),
 * this reads that page once, keeps every `https://<other>.substack.com` link
 * on it, and saves each one as a candidate through lib/substackMinerStore.js
 * with `found_via: 'recommendations'` and the recommending handle added to
 * `recommended_by`. Fifty approved seeds become thousands of candidates
 * without anybody searching.
 *
 * One level deep per run: the writers it adds are candidates, not approved,
 * so their own pages are only read once Dane approves them.
 *
 * Dane's decisions are safe by construction: the store's upsert merges into a
 * writer already here and never touches status, so a writer he rejected stays
 * rejected however many pages recommend them, and one he approved stays
 * approved. Only `recommended_by` grows.
 *
 * Public HTML pages only — no login, nothing posted — one page at a time,
 * `pauseMsBetweenFetches` apart, and at most MAX_FETCHES_PER_RUN pages a run.
 * A publication on its own domain is counted as skipped and not followed: its
 * address does not say which Substack handle it is.
 *
 * The answer accounts for every source handle: read ok or failed (with the
 * HTTP status), links found, writers added and merged — and every handle the
 * cap or the clock left unread, by name.
 *
 * Every outside dependency comes in through `deps`, so the tests in
 * scripts/builder/substackRecommendationsRun.test.js drive it with no network.
 */

const minerStore = require('../substackMinerStore');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const PAGE_TIMEOUT_MS = 15000;
const MAX_PAGE_BYTES = 2_000_000;
// Not measured: a ceiling chosen so one run stays a polite burst against
// Substack (100 pages at the default 1.5s pause is about three minutes). The
// summary says when it was the cap that stopped the run.
const MAX_FETCHES_PER_RUN = 100;
// Vercel stops a function at 300s. Handles not read when the budget runs out
// are named in the summary rather than lost to a timeout that returns nothing.
// The 60s left over covers the page already in flight and saving its writers.
const DEFAULT_TIME_BUDGET_MS = 240000;
const MAX_HANDLES_PER_RUN = 500;

// Substack's own subdomains — not anybody's publication.
const RESERVED_LABELS = new Set(['www', 'open', 'on', 'support', 'api', 'cdn', 'help', 'email', 'app']);

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hrefs(html) {
  const out = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match;
  while ((match = re.exec(String(html || ''))) !== null) {
    out.push((match[1] !== undefined ? match[1] : match[2]).replace(/&amp;/g, '&'));
  }
  return out;
}

/**
 * The publications a recommendations page links to.
 *
 *   handles             every `<other>.substack.com` handle, once each, in page
 *                       order — the page's own handle and Substack's own
 *                       subdomains dropped
 *   skippedNotSubstack  recommendation cards pointing at a publication on its
 *                       own domain (Substack tags each card's link with
 *                       `utm_source=recommendations`), counted and not followed
 */
function parseRecommendations(html, ownHandle) {
  const own = String(ownHandle || '').toLowerCase();
  const handles = [];
  let skippedNotSubstack = 0;
  for (const href of hrefs(html)) {
    let url;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (!host.endsWith('.substack.com')) {
      if (/[?&]utm_source=recommendations/i.test(url.search) && host !== 'substack.com') skippedNotSubstack += 1;
      continue;
    }
    const label = host.slice(0, -'.substack.com'.length);
    if (label.includes('.') || RESERVED_LABELS.has(label) || label === own) continue;
    const checked = minerStore.handleOrError(label);
    if (!checked.ok) continue;
    if (!handles.includes(checked.value)) handles.push(checked.value);
  }
  return { handles, skippedNotSubstack };
}

/**
 * Read one recommendations page. Answers `{ ok, html }` or
 * `{ ok: false, httpStatus, reason }`; never throws.
 */
async function fetchRecommendationsPage(url) {
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, httpStatus: 0, reason: `could not be reached: ${err.message}` };
  }
  if (!res.ok) return { ok: false, httpStatus: res.status, reason: `answered HTTP ${res.status}` };
  let html;
  try {
    html = await res.text();
  } catch (err) {
    return { ok: false, httpStatus: res.status, reason: `could not be read: ${err.message}` };
  }
  return { ok: true, html: html.slice(0, MAX_PAGE_BYTES) };
}

function handleListOrError(value) {
  if (!Array.isArray(value)) return refuse('handles must be a list of Substack handles');
  const out = [];
  for (const item of value) {
    const checked = minerStore.handleOrError(item, 'handles');
    if (!checked.ok) return checked;
    if (!out.includes(checked.value)) out.push(checked.value);
  }
  if (out.length > MAX_HANDLES_PER_RUN) return refuse(`a run can read at most ${MAX_HANDLES_PER_RUN} handles — got ${out.length}`);
  return { ok: true, value: out };
}

/**
 * Run the snowball for one project.
 *
 *   input.handles  optional list; every approved writer in the project otherwise
 *
 * Answers the store envelope: `{ ok: true, status: 200, data: summary }`, or
 * a refusal naming why nothing was read.
 */
async function runSubstackSnowball(input = {}, scope = null, deps = {}) {
  const readPage = deps.fetchRecommendationsPage || fetchRecommendationsPage;
  const store = deps.store || minerStore;
  const wait = deps.sleep || sleep;
  const now = deps.now || Date.now;
  const timeBudgetMs = deps.timeBudgetMs || DEFAULT_TIME_BUDGET_MS;
  const fetchCap = deps.maxFetches || MAX_FETCHES_PER_RUN;

  const settings = await store.getSettings(scope);
  if (!settings.ok) return settings;
  const pauseMs = Math.max(0, Number(settings.data.pauseMsBetweenFetches ?? minerStore.SETTINGS_DEFAULTS.pauseMsBetweenFetches) || 0);

  // Writers already here — merged without overwriting the name a front-page
  // read gave them. Past 1000 in a project the rest read as new and are saved
  // with their handle as a name only if they have no name yet; the merge still
  // adds the recommender.
  const existing = await store.listCandidates(1000, scope);
  if (!existing.ok) return existing;
  const known = new Set(existing.data.map((row) => row.handle));

  let sources;
  if (input && input.handles !== undefined && input.handles !== null) {
    const checked = handleListOrError(input.handles);
    if (!checked.ok) return checked;
    sources = checked.value;
  } else {
    // Asked separately so approved writers are never lost past the 1000 above.
    const approved = await store.listCandidates(1000, scope, { status: 'approved' });
    if (!approved.ok) return approved;
    sources = approved.data.map((row) => row.handle);
  }
  if (!sources.length) {
    return refuse('There are no approved writers to read recommendations from — approve some first, or send { "handles": [...] }.');
  }

  const summary = {
    sourcesRequested: sources.length,
    sources: [],
    sourcesRead: 0,
    sourcesFailed: 0,
    notRead: [],
    fetches: 0,
    fetchCap,
    stoppedByCap: false,
    linksFound: 0,
    added: 0,
    merged: 0,
    skippedNotSubstack: 0,
    refused: [],
  };

  const startedAt = now();
  for (const source of sources) {
    if (summary.fetches >= fetchCap) {
      summary.stoppedByCap = true;
      summary.notRead.push({ handle: source, reason: `not read — the run stopped at its cap of ${fetchCap} pages` });
      continue;
    }
    if (now() - startedAt > timeBudgetMs) {
      summary.notRead.push({ handle: source, reason: 'not read — the run ran out of time' });
      continue;
    }
    if (summary.fetches > 0 && pauseMs) await wait(pauseMs);
    summary.fetches += 1;
    const page = await readPage(`https://${source}.substack.com/recommendations`);
    if (!page || !page.ok) {
      summary.sourcesFailed += 1;
      summary.sources.push({
        handle: source,
        read: 'failed',
        httpStatus: Number(page?.httpStatus) || 0,
        reason: String(page?.reason || 'the page gave no answer'),
      });
      continue;
    }

    const { handles, skippedNotSubstack } = parseRecommendations(page.html, source);
    const record = { handle: source, read: 'ok', linksFound: handles.length, added: 0, merged: 0, skippedNotSubstack };
    summary.sourcesRead += 1;
    summary.linksFound += handles.length;
    summary.skippedNotSubstack += skippedNotSubstack;

    for (const handle of handles) {
      const find = {
        handle,
        publicationUrl: `https://${handle}.substack.com`,
        foundVia: 'recommendations',
        recommendedBy: [source],
      };
      if (!known.has(handle)) find.name = handle;
      const saved = await store.upsertCandidate(find, scope);
      if (!saved.ok) {
        // A tenancy or database failure is not one writer's fault: stop and say so.
        if (saved.status !== 400) return saved;
        summary.refused.push({ handle, recommendedBy: source, error: saved.error });
        continue;
      }
      known.add(handle);
      if (saved.status === 201) {
        record.added += 1;
        summary.added += 1;
      } else {
        record.merged += 1;
        summary.merged += 1;
      }
    }
    summary.sources.push(record);
  }

  return { ok: true, status: 200, data: summary };
}

module.exports = {
  runSubstackSnowball,
  parseRecommendations,
  fetchRecommendationsPage,
  MAX_FETCHES_PER_RUN,
  DEFAULT_TIME_BUDGET_MS,
};
