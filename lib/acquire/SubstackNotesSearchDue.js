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
 * THE KEYWORD WALK. One keyword per pass, and the walk moves on only after a
 * pass that actually SEARCHED. Searching all of them each pass would be four
 * browser sessions back to back every six hours on Dane's real account, which
 * is the kind of pattern a site notices.
 *
 * It used to be walked by the clock (six-hour period number modulo the list),
 * and a day holds exactly four six-hour periods: with 2, 4 or 8 keywords each
 * one landed on the same time of day for ever, and whichever fell on the night
 * slot was refused by the active-hours check on every pass — never searched
 * (round-1 review of 86bcrmbqu). So the walk remembers the last keyword it
 * searched, per project, in a small file beside the heartbeat stamps on the
 * machine that runs it. No table holds it: the job runs on one machine, and if
 * the role ever moves, the walk restarts at the first keyword — which costs
 * nothing.
 *
 * WHY IT RUNS HERE AND NOT ON VERCEL. The search needs the browser — Substack's
 * public search does not filter to Notes (measured 2026-10-10, see
 * ./SubstackNotesSearch.js) — and the browser is on the Mini.
 *
 * Every verdict is kept per project. A refused search (signed out, the browser
 * down, an answer it could not read) is a FAILURE, never "found nothing": the
 * runner exits non-zero, records no beat and posts to the bus. A pass that
 * searched NOTHING (every project outside its active hours, or no project has
 * keywords) is not a failure, but it is not a clean pass either: the runner
 * records no beat for it, so a schedule that never searches goes stale on the
 * roll call instead of reading as healthy.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sbQuery, tableConfig } = require('../supabase');
const { runNotesSearchPass } = require('./SubstackNotesSearch');
const { runSubstackSuggestions } = require('./SubstackSuggestRun');

function text(value, max = 500) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

/** Where the walk is remembered: beside the heartbeat stamps (lib/nodeHeartbeat.js). */
function walkFile(homedir = os.homedir()) {
  return path.join(homedir, 'Library', 'Application Support', 'starcaster', 'substack-notes-search-walk.json');
}

/**
 * The walk as last saved: `{ [projectId]: { lastKeyword, at } }`. No file yet is
 * an empty walk (the first pass); a file that cannot be read as JSON is also
 * started afresh, and `note` says so for the log.
 */
function readWalk({ file = walkFile(), read = fs } = {}) {
  let raw;
  try {
    raw = read.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { walk: {}, note: '' };
    return { walk: {}, note: `The keyword walk could not be read (${err.message}); starting it again at the first keyword.` };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { walk: parsed, note: '' };
  } catch { /* fall through */ }
  return { walk: {}, note: `The keyword walk in ${file} was not readable JSON; starting it again at the first keyword.` };
}

/** Save the walk. Answers `{ ok }` or `{ ok: false, error }` — never throws. */
function writeWalk(walk, { file = walkFile(), write = fs } = {}) {
  try {
    write.mkdirSync(path.dirname(file), { recursive: true });
    write.writeFileSync(file, `${JSON.stringify(walk, null, 2)}\n`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `The keyword walk could not be saved to ${file}: ${err.message}` };
  }
}

/**
 * The keyword after the one searched last. A keyword removed from the list
 * since (or no last one at all) starts the walk at the top. Pure.
 */
function nextKeyword(keywords, last) {
  const list = (Array.isArray(keywords) ? keywords : []).map((k) => text(k, 200)).filter(Boolean);
  if (!list.length) return { ok: false, keyword: '', how: '' };
  const at = list.findIndex((k) => k.toLowerCase() === text(last, 200).toLowerCase());
  const index = at < 0 ? 0 : (at + 1) % list.length;
  return { ok: true, keyword: list[index], how: `keyword ${index + 1} of ${list.length}` };
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
 *   readWalk          () → { walk, note }   (default: the file, ./walkFile)
 *   writeWalk         (walk) → { ok, error } (default: the file)
 *
 * `data.projects[]` holds, per project, `{ projectId, keyword, verdict,
 * message, search, suggest }`, where verdict is `searched` | `not_now` |
 * `failed`. `data.failed` counts the failed ones, and a walk that could not be
 * saved counts as one too (`data.walkError`) — otherwise the next pass would
 * search the same keyword again, and so would every pass after it.
 * `data.searched` counts the searched ones; the runner's exit code reads all three.
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

  const { walk, note: walkNote } = (deps.readWalk || readWalk)();
  let walked = false;
  const projects = [];
  for (const { projectId, userId, keywords } of found.data) {
    const scope = { projectId, userId };
    const pick = nextKeyword(keywords, walk[projectId]?.lastKeyword);
    const keyword = pick.ok ? pick.keyword : '';
    // eslint-disable-next-line no-await-in-loop
    const res = await search({ keyword, anyHour: deps.anyHour === true }, scope, {
      projectTimeZone: async () => text(await projectTimeZone(projectId, userId), 120),
    });
    if (!res.ok) {
      projects.push({ projectId, keyword, verdict: res.status === 409 ? 'not_now' : 'failed', message: res.error, search: null, suggest: null });
      continue;
    }
    // Only a pass that searched moves the walk on: a "not now" or a failure
    // leaves this keyword's turn waiting for the next pass.
    walk[projectId] = { lastKeyword: keyword, at: new Date(now()).toISOString() };
    walked = true;
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
  const saved = walked ? (deps.writeWalk || writeWalk)(walk) : { ok: true };
  const walkError = saved.ok ? '' : saved.error;
  return {
    ok: true,
    status: 200,
    data: {
      projects,
      searched: projects.filter((p) => p.verdict === 'searched').length,
      failed: projects.filter((p) => p.verdict === 'failed').length + (walkError ? 1 : 0),
      walkNote,
      walkError,
    },
  };
}

/** What the log prints for one pass: a line per project, then the total. */
function formatSearchDueLog(report, { formatSearchSummary }) {
  const lines = [];
  if (report.walkNote) lines.push(report.walkNote);
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
  const failedSearches = report.projects.filter((p) => p.verdict === 'failed').length;
  if (report.walkError) lines.push(`WALK NOT SAVED: ${report.walkError}`);
  lines.push(`${report.projects.length} project${report.projects.length === 1 ? '' : 's'} with keywords: `
    + `${searched} searched, ${notNow} not now (outside the active hours), ${failedSearches} failed.`);
  if (!searched && !report.failed) {
    lines.push('Nothing was searched this pass, so no beat is recorded: a schedule that never searches must go stale, not read as healthy.');
  }
  return lines.join('\n');
}

module.exports = {
  runNotesSearchDue, discoverProjects, formatSearchDueLog, nextKeyword, readWalk, writeWalk, walkFile,
};
