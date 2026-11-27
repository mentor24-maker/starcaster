#!/usr/bin/env node
/**
 * Move StarCaster's bus into the StarCaster project (SC-818).
 *
 *   npm run bus:move-in               dry run: read both projects, print the plan, change nothing
 *   npm run bus:move-in -- --apply    carry it out, reading back every step
 *   ... --since <ISO time>            also name every comment the old copies got
 *                                     at or after that time (use the merge time:
 *                                     between merge and move, posts land on them)
 *
 * The plan and the reasons behind it are lib/busMove.js. In order:
 *   1. put `noticeboard` on the project's tag list (a moved board is tagged),
 *      and read the list back before anything else is written;
 *   2. rename each old ClickUp-era copy "<name> (ClickUp archive)", so the
 *      moved board is the only ticket under its name;
 *   3. move every bus ticket in (the tracker's `move`, which keeps every
 *      comment; the comment count is read before and after), and tag each
 *      moved board `noticeboard`;
 *   4. read both projects back: one ticket per board name, tagged, and an
 *      empty bus.
 *
 * The tickets come from `--from` (default starcaster-bus) and go to the
 * config's projectSlug. The bus is not read from busProject, because by the
 * time this runs the config already names the destination there.
 *
 * Exit 0 done (or nothing to do), 1 a step failed (it says which, and stops
 * there: a rerun plans only what is left), 2 could not plan (nothing written).
 * Take the tracker backup first (the PR's runbook says how).
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// Spirality's own door code, from the release StarCaster's lanes run (SC-870).
const { spiralityPath } = require('../lib/spirality.cjs');
const fromSpirality = (rel) => import(pathToFileURL(spiralityPath(rel)).href);
const { createApiTracker, trackerTokenEnv } = await fromSpirality('scripts/tracker/apiTracker.mjs');
const { projectSeats } = await fromSpirality('scripts/lib/expectedSecrets.mjs');
const { planBusMove, checkMoved, commentsSince, tagWords, ARCHIVE_SUFFIX, BOARD_NAMES } = require('../lib/busMove.js');
const { NOTICEBOARD_TAG } = require('../lib/spirality.cjs').requireSpirality('lib/loopNoticeboards.js');
const { SWITCH_TASK_NAME } = require('../lib/spirality.cjs').requireSpirality('lib/pipelinePause.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const fromAt = argv.indexOf('--from');
const FROM = fromAt >= 0 ? argv[fromAt + 1] : 'starcaster-bus';
const sinceAt = argv.indexOf('--since');
const SINCE = sinceAt >= 0 ? Date.parse(argv[sinceAt + 1] ?? '') : null;
if (sinceAt >= 0 && !Number.isFinite(SINCE)) {
  console.error(`move_bus_into_project: --since needs a time like 2026-11-17T06:30:00Z, not "${argv[sinceAt + 1] ?? ''}". Nothing was written.`);
  process.exit(2);
}

const config = JSON.parse(readFileSync(join(ROOT, 'spirality.project.json'), 'utf8'));
const TO = config.projectSlug;
if (!TO || !FROM || FROM === TO) {
  console.error(`move_bus_into_project: needs two different projects (from "${FROM}", to "${TO}"). Nothing was written.`);
  process.exit(2);
}

let tokenEnv;
try { tokenEnv = trackerTokenEnv(process.env, projectSeats(config)); } catch (err) {
  console.error(`move_bus_into_project: ${err.message} Nothing was written.`);
  process.exit(2);
}
if (!process.env[tokenEnv]) {
  console.error(`move_bus_into_project: ${tokenEnv} is not set; run it through npm run bus:move-in (Doppler supplies it). Nothing was written.`);
  process.exit(2);
}
const tracker = createApiTracker({
  token: process.env[tokenEnv],
  baseUrl: config.trackerApiUrl || config.trackerUrl,
  project: TO,
  listId: config.loopQueueListId,
});

const fail = (why) => { console.error(`move_bus_into_project FAILED: ${why}`); process.exit(1); };

/** Every ticket in a project, Live included, as `{ id, name, tags, created }`; null when unreadable. */
async function ticketsIn(slug) {
  const out = await tracker.listTasksPage(slug, 0, { includeClosed: true });
  if (!out.res?.ok || !Array.isArray(out.json?.tasks)) {
    console.error(`  could not list ${slug}: HTTP ${out.res?.status ?? '?'} ${out.json?.err || out.text || ''}`.trimEnd());
    return null;
  }
  return out.json.tasks.map((t) => ({ id: t.id, name: t.name, tags: tagWords(t), created: t.date_created }));
}

async function commentCount(id) {
  const out = await tracker.ticketRecord(id);
  if (!out.res?.ok || !Array.isArray(out.json?.comments)) return null;
  return out.json.comments.length;
}

/** The ticket's comments as the tracker stores them; null when unreadable. */
async function commentsOf(id) {
  const out = await tracker.ticketRecord(id);
  return out.res?.ok && Array.isArray(out.json?.comments) ? out.json.comments : null;
}

const projectTickets = await ticketsIn(TO);
const busTickets = await ticketsIn(FROM);
// The pause switch IS its comments: its newest one says whether somebody is using it.
const lastWrittenAt = {};
for (const t of projectTickets || []) {
  if (String(t.name).trim().toLowerCase() !== SWITCH_TASK_NAME.toLowerCase()) continue;
  const comments = await commentsOf(t.id);
  if (!comments) { console.error(`  could not read ${t.id}'s comments`); continue; }
  const times = comments.map((c) => Date.parse(c.createdAt)).filter(Number.isFinite);
  lastWrittenAt[t.id] = times.length ? Math.max(...times) : null;
}
const plan = planBusMove({ projectTickets, busTickets, lastWrittenAt });
if (plan.problems.length) {
  for (const p of plan.problems) console.error(`  ${p}`);
  console.error('move_bus_into_project: could not plan, so nothing was written.');
  process.exit(2);
}

console.log(`From ${FROM} into ${TO}${APPLY ? '' : ' (dry run: nothing is written)'}:`);
for (const r of plan.renames) console.log(`  rename ${r.id} "${r.from}" -> "${r.to}"`);
for (const k of plan.kept) console.log(`  leave  ${k.id} "${k.name}": ${k.why}`);
for (const m of plan.moves) console.log(`  move   ${m.id} "${m.name}"${m.tag ? `, then tag it ${NOTICEBOARD_TAG}` : ''}`);

// Posts that landed on an old copy after the merge, named before anything is renamed.
if (SINCE != null) {
  const ids = new Set(plan.renames.map((r) => r.id));
  for (const t of projectTickets) if (String(t.name).endsWith(ARCHIVE_SUFFIX)) ids.add(t.id);
  const records = [];
  for (const id of ids) {
    const comments = await commentsOf(id);
    if (!comments) {
      console.error(`move_bus_into_project: could not read ${id}'s comments, so posts stranded on it since ${new Date(SINCE).toISOString()} cannot be named. Nothing was written.`);
      process.exit(2);
    }
    records.push({ id, name: projectTickets.find((t) => t.id === id)?.name, comments });
  }
  const stranded = commentsSince(records, SINCE);
  if (stranded.length) {
    console.log(`  ${stranded.length} comment(s) landed on the old copies at or after ${new Date(SINCE).toISOString()}; they stay there, read them by id:`);
    for (const c of stranded) console.log(`    ${c.id} "${c.name}" ${c.at}: ${c.firstLine}`);
  } else {
    console.log(`  no comment landed on the old copies (${[...ids].join(', ') || 'none'}) at or after ${new Date(SINCE).toISOString()}`);
  }
} else {
  console.log('  (no --since given: comments the old copies got after the merge are not checked)');
}
if (!plan.renames.length && !plan.moves.length) {
  console.log('  nothing to do: the bus project is empty.');
  process.exit(0);
}
if (!APPLY) {
  console.log('Run again with --apply to carry it out.');
  process.exit(0);
}

// 1. The tag on the project's list, so tagging a moved board is not refused.
const listed = await tracker.listProjectTags(TO);
if (!listed.res?.ok || !Array.isArray(listed.json?.tags)) fail(`could not read ${TO}'s tag list (HTTP ${listed.res?.status ?? '?'}); nothing was written.`);
if (!listed.json.tags.some((t) => String(t.name).toLowerCase() === NOTICEBOARD_TAG)) {
  const added = await tracker.addProjectTag(TO, NOTICEBOARD_TAG, 'A standing board, not work: no loop claims it.');
  const back = await tracker.listProjectTags(TO);
  const there = back.res?.ok && Array.isArray(back.json?.tags)
    && back.json.tags.some((t) => String(t.name).toLowerCase() === NOTICEBOARD_TAG);
  if (!there) fail(`adding ${NOTICEBOARD_TAG} to ${TO}'s tag list did not read back (add: HTTP ${added.res?.status ?? '?'}, read: HTTP ${back.res?.status ?? '?'}); nothing has been renamed or moved.`);
  console.log(`  added ${NOTICEBOARD_TAG} to ${TO}'s tag list (read back)`);
}

// 2. The old copies out of the way, each read back.
for (const r of plan.renames) {
  const out = await tracker.updateTask(r.id, { name: r.to });
  if (!out.res?.ok || out.json?.name !== r.to) fail(`renaming ${r.id} to "${r.to}" did not stick (HTTP ${out.res?.status ?? '?'}). Nothing has been moved yet.`);
  console.log(`  renamed ${r.id} to "${r.to}" (read back)`);
}

// 3. The moves, each counted before and after, then the tag.
const boards = [];
for (const m of plan.moves) {
  const want = await commentCount(m.id);
  if (want == null) fail(`could not read ${m.id}'s comments before moving it; it was not moved.`);
  const out = await tracker.moveTicket(m.id, TO);
  const newId = out.json?.ticket?.id;
  if (!out.res?.ok || !newId) fail(`moving ${m.id} into ${TO} failed (HTTP ${out.res?.status ?? '?'} ${out.json?.err || ''}).`);
  const got = await commentCount(newId);
  if (got !== want) fail(`${m.id} had ${want} comment(s) and ${newId} reads back with ${got ?? 'none readable'}.`);
  console.log(`  moved ${m.id} to ${newId} with its ${got} comment(s) (read back)`);
  if (m.tag) {
    const tagged = await tracker.setTag(newId, NOTICEBOARD_TAG, true);
    const back = await tracker.ticketRecord(newId);
    if (!tagged.res?.ok || !(back.json?.tags || []).some((t) => String(t).toLowerCase() === NOTICEBOARD_TAG)) {
      fail(`${newId} "${m.name}" was moved but the ${NOTICEBOARD_TAG} tag did not stick: tag it with npm run clickup -- tag --task ${newId} --add ${NOTICEBOARD_TAG}`);
    }
    console.log(`  tagged ${newId} ${NOTICEBOARD_TAG} (read back)`);
  }
  if (BOARD_NAMES.some((n) => n.toLowerCase() === String(m.name).trim().toLowerCase())) boards.push(m.name);
}

// 4. The whole thing, read back.
const verdict = checkMoved({ projectTickets: await ticketsIn(TO), busTickets: await ticketsIn(FROM), boards });
if (!verdict.ok) fail(verdict.problems.join('; '));
console.log(`Done: ${boards.length} board(s) are in ${TO}, one ticket each, tagged ${NOTICEBOARD_TAG}; ${FROM} holds no tickets.`);
