'use strict';

/**
 * The Mini's scheduled Notes search — Outreach wizard 14/19 (task 86bcrmbqu).
 * launchd runs scripts/run_substack_notes_search.sh every six hours on the Mini
 * (scripts/install_substack_notes_search.sh, role `substack-notes-search` in
 * lib/nodeRoles.js); that runs scripts/substack_notes_search_due.mjs, which
 * runs this.
 *
 * For every project with Substack Miner keywords: ONE keyword's Notes search
 * through the signed-in browser (./SubstackNotesSearch.js runNotesSearchPass),
 * then Miner Suggest (./SubstackSuggestRun.js), so a writer the search just
 * found arrives already carrying an Approve-or-Reject suggestion.
 *
 * THE KEYWORD WALK. One keyword per pass, walked by six-hour period, so a list
 * of four keywords is each searched once a day. Searching all of them each
 * pass would be four browser sessions back to back every six hours on Dane's
 * real account, which is the kind of pattern a site notices.
 *
 * WHY IT RUNS HERE AND NOT ON VERCEL. The search needs the browser — Substack's
 * public search does not filter to Notes (measured 2026-10-10, see
 * ./SubstackNotesSearch.js) — and the browser is on the Mini.
 *
 * Every verdict is kept per project. A refused search (signed out, the browser
 * down, an answer it could not read) is a FAILURE, never "found nothing": the
 * runner exits non-zero, records no beat and posts to the bus.
 */

const { sbQuery, tableConfig } = require('../supabase');
const { runNotesSearchPass, pickKeyword } = require('./SubstackNotesSearch');
const { runSubstackSuggestions } = require('./SubstackSuggestRun');

/** How often the schedule runs, and so how fast the keyword walk advances. */
const PASS_PERIOD_MS = 6 * 60 * 60 * 1000;

function text(value, max = 500) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

/** Every project whose Substack Miner has keywords, and an owner to act as. */
async function discoverProjects(deps = {}) {
  const query = deps.sbQuery || sbQuery;
  const res = await query({
    method: 'GET',
    table: tableConfig().substackMinerSettings,
    query: 'select=project_id,owner_user_id,keywords&limit=5000',
  });
  if (!res.ok) return res;
  const seen = new Map();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const projectId = text(row.project_id, 120);
    const keywords = (Array.isArray(row.keywords) ? row.keywords : []).map((k) => text(k, 200)).filter(Boolean);
    if (!projectId || !keywords.length || seen.has(projectId)) continue;
    seen.set(projectId, { projectId, userId: text(row.owner_user_id, 120), keywords });
  }
  return { ok: true, status: 200, data: [...seen.values()] };
}

/**
 * One pass. `deps`:
 *   discover          () → { ok, data: [{ projectId, userId, keywords }] } (tests)
 *   search            runNotesSearchPass (tests)
 *   suggest           runSubstackSuggestions (tests)
 *   projectTimeZone   (projectId, userId) → zone
 *   now               the clock (ms)
 *   anyHour           true searches even outside the active hours
 *
 * `data.projects[]` holds, per project, `{ projectId, keyword, verdict,
 * message, search, suggest }`, where verdict is `searched` | `not_now` |
 * `failed`. `data.failed` counts the failed ones; the runner's exit code reads it.
 */
async function runNotesSearchDue(deps = {}) {
  const discover = deps.discover || (() => discoverProjects(deps));
  const search = deps.search || runNotesSearchPass;
  const suggest = deps.suggest || runSubstackSuggestions;
  const now = deps.now || Date.now;
  const projectTimeZone = deps.projectTimeZone || require('../projectsStore').getProjectTimezoneForUser;

  const found = await discover();
  if (!found.ok) {
    return { ok: false, status: found.status || 500, error: `Could not read which projects have Substack Miner keywords: ${found.error || 'unknown error'}` };
  }

  const projects = [];
  for (const { projectId, userId, keywords } of found.data) {
    const scope = { projectId, userId };
    const pick = pickKeyword(keywords, '', now(), PASS_PERIOD_MS);
    const keyword = pick.ok ? pick.keyword : '';
    // eslint-disable-next-line no-await-in-loop
    const res = await search({ keyword, anyHour: deps.anyHour === true }, scope, {
      projectTimeZone: async () => text(await projectTimeZone(projectId, userId), 120),
    });
    if (!res.ok) {
      projects.push({ projectId, keyword, verdict: res.status === 409 ? 'not_now' : 'failed', message: res.error, search: null, suggest: null });
      continue;
    }
    // Suggest after EVERY successful search, even one that added nobody: a
    // writer added by hand since the last pass is waiting for one too.
    // eslint-disable-next-line no-await-in-loop
    const sug = await suggest(scope, {});
    projects.push({
      projectId,
      keyword,
      verdict: 'searched',
      message: '',
      search: res.data,
      // A Suggest that refused (too few decisions to learn from) is reported,
      // not failed: the search did its job, and the refusal names why.
      suggest: sug.ok ? { ok: true, data: sug.data } : { ok: false, error: sug.error },
    });
  }
  return {
    ok: true,
    status: 200,
    data: { projects, failed: projects.filter((p) => p.verdict === 'failed').length },
  };
}

/** What the log prints for one pass: a line per project, then the total. */
function formatSearchDueLog(report, { formatSearchSummary }) {
  const lines = [];
  for (const p of report.projects) {
    lines.push(`--- project ${p.projectId}, keyword "${p.keyword}"`);
    if (p.verdict === 'not_now') { lines.push(`Not now: ${p.message}`); continue; }
    if (p.verdict === 'failed') { lines.push(`SEARCH FAILED: ${p.message}`); continue; }
    lines.push(formatSearchSummary(p.search));
    if (p.suggest.ok) {
      const s = p.suggest.data || {};
      const made = Array.isArray(s.suggested) ? s.suggested.length : Number(s.suggested) || 0;
      lines.push(`Suggest: ${made} writer${made === 1 ? '' : 's'} given a suggestion.`);
    } else {
      lines.push(`Suggest did not run: ${p.suggest.error}`);
    }
  }
  const searched = report.projects.filter((p) => p.verdict === 'searched').length;
  const notNow = report.projects.filter((p) => p.verdict === 'not_now').length;
  lines.push(`${report.projects.length} project${report.projects.length === 1 ? '' : 's'} with keywords: `
    + `${searched} searched, ${notNow} not now (outside the active hours), ${report.failed} failed.`);
  return lines.join('\n');
}

module.exports = { runNotesSearchDue, discoverProjects, formatSearchDueLog, PASS_PERIOD_MS };
