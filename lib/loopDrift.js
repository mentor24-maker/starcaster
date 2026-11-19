/**
 * Is StarCaster's copy of the loop (`loop/`) the same as Spirality's `main`?
 * (SC-868, slice 1 of 3.)
 *
 * WHY THIS EXISTS
 * StarCaster runs its own copy of Spirality's ticket door, copied by hand at a
 * fixed commit (`loop/README.md`). On 2026-11-17 at 2:13 PM MT Spirality
 * shipped a check that refuses a card handing Dane SQL without a clickable
 * link (Spirality #313). At 10:45 PM MT StarCaster's build pass put exactly
 * that on SC-832, because nobody had copied the fix across, and nothing said
 * the copy was behind. This says so. It is a stopgap: SC-869 runs StarCaster's
 * lanes from Spirality itself, and SC-870 deletes the copy and this with it.
 *
 * WHAT IT COMPARES
 * `loop/X` is Spirality's `X`, byte for byte (README.md is StarCaster's own and
 * is skipped). Each local file's git blob id — the id `git hash-object` prints,
 * computed here in-process — is compared with the id Spirality's tree lists for
 * the same path. Only files StarCaster HAS are compared: Spirality files that
 * were deliberately not copied (tests that read Spirality's own docs/ folder)
 * are not drift. A file here that Spirality no longer has IS drift: it was
 * deleted there.
 *
 * Three verdicts, never two: IN STEP (0), BEHIND (1), CANNOT TELL (2). A
 * GitHub read that failed, or a tree GitHub truncated, is CANNOT TELL and is
 * never reported as in step — that would be the silent all-clear this exists
 * against.
 *
 * Pure: no network, no disk. scripts/loop_drift.mjs does the reading.
 */
'use strict';

const crypto = require('node:crypto');

const VERDICT = Object.freeze({ IN_STEP: 'IN STEP', BEHIND: 'BEHIND', CANNOT_TELL: 'CANNOT TELL' });
const EXIT = Object.freeze({ [VERDICT.IN_STEP]: 0, [VERDICT.BEHIND]: 1, [VERDICT.CANNOT_TELL]: 2 });
const SPIRALITY_REPO = 'mentor24-maker/spirality';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Files in loop/ that are StarCaster's own, never copied. */
const LOCAL_ONLY = new Set(['README.md']);

/** The git blob id of a file's bytes — exactly what `git hash-object <file>` prints. */
function blobSha(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer));
  return crypto.createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

/**
 * Judge one reading.
 *   local:  [{ path, sha }]  every file under loop/, path relative to loop/
 *   remote: { commit, tree: [{ path, type, sha }], truncated } or null
 *   error:  why remote is null
 * Returns { verdict, reason, commit, changed: [path], deleted: [path], compared }.
 */
function judge({ local, remote, error }) {
  const files = (local || []).filter((f) => !LOCAL_ONLY.has(f.path));
  if (!remote) {
    return { verdict: VERDICT.CANNOT_TELL, reason: `could not read Spirality's main: ${error || 'no reading'}`, commit: '', changed: [], deleted: [], compared: 0 };
  }
  if (remote.truncated) {
    return { verdict: VERDICT.CANNOT_TELL, reason: 'GitHub cut Spirality\'s file list short (truncated), so some files could not be compared', commit: remote.commit || '', changed: [], deleted: [], compared: 0 };
  }
  if (!remote.commit || !Array.isArray(remote.tree) || !remote.tree.length) {
    return { verdict: VERDICT.CANNOT_TELL, reason: 'GitHub answered without a commit or a file list', commit: remote.commit || '', changed: [], deleted: [], compared: 0 };
  }
  if (!files.length) {
    return { verdict: VERDICT.CANNOT_TELL, reason: 'found no files in loop/ to compare', commit: remote.commit, changed: [], deleted: [], compared: 0 };
  }
  const theirs = new Map(remote.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
  const changed = [];
  const deleted = [];
  for (const f of files) {
    if (!theirs.has(f.path)) deleted.push(f.path);
    else if (theirs.get(f.path) !== f.sha) changed.push(f.path);
  }
  changed.sort();
  deleted.sort();
  const short = remote.commit.slice(0, 7);
  if (!changed.length && !deleted.length) {
    return { verdict: VERDICT.IN_STEP, reason: `all ${files.length} copied files match Spirality's main at ${short}`, commit: remote.commit, changed, deleted, compared: files.length };
  }
  const parts = [];
  if (changed.length) parts.push(`${changed.length} differ`);
  if (deleted.length) parts.push(`${deleted.length} deleted in Spirality`);
  return { verdict: VERDICT.BEHIND, reason: `${parts.join(', ')} of ${files.length} copied files, against Spirality's main at ${short}`, commit: remote.commit, changed, deleted, compared: files.length };
}

/**
 * What --check should post, given what it posted before.
 * state: { behindAt, cannotTellAt } (ISO strings, '' or absent when not alarmed)
 * Returns { behind, cannotTell, cleared, next }:
 *   behind      post the BEHIND message (not posted in the last day)
 *   cannotTell  post the CANNOT TELL message (not posted in the last day)
 *   cleared     post one all-clear (IN STEP after a BEHIND that was posted)
 * A reading of either kind clears a CANNOT TELL silently: it could tell.
 */
function plan({ judged, state = {}, now = Date.now(), everyMs = DAY_MS }) {
  const at = new Date(now).toISOString();
  const recent = (iso) => {
    const then = Date.parse(iso || '');
    return Number.isFinite(then) && now - then < everyMs;
  };
  const behindAt = (state && state.behindAt) || '';
  const cannotTellAt = (state && state.cannotTellAt) || '';
  if (judged.verdict === VERDICT.CANNOT_TELL) {
    const due = !recent(cannotTellAt);
    return { behind: false, cannotTell: due, cleared: false, next: { behindAt, cannotTellAt: due ? at : cannotTellAt } };
  }
  if (judged.verdict === VERDICT.BEHIND) {
    const due = !recent(behindAt);
    return { behind: due, cannotTell: false, cleared: false, next: { behindAt: due ? at : behindAt, cannotTellAt: '' } };
  }
  return { behind: false, cannotTell: false, cleared: Boolean(behindAt), next: { behindAt: '', cannotTellAt: '' } };
}

function commitUrl(commit) {
  return `https://github.com/${SPIRALITY_REPO}/commit/${commit}`;
}

function renderBehind({ judged, node, at }) {
  const lines = [
    `[CC-starcaster] 🟠 StarCaster's copy of the loop is behind Spirality (${judged.reason})`,
    '',
    'Fixes made to the ticket door in Spirality are NOT in force on StarCaster yet: StarCaster\'s lanes still run the older copy in loop/. '
      + 'Whatever these files changed in Spirality (a new check, a fixed command) is not happening here until they are copied.',
    '',
  ];
  for (const p of judged.changed) lines.push(`• loop/${p} differs from Spirality's ${p}`);
  for (const p of judged.deleted) lines.push(`• loop/${p} no longer exists in Spirality`);
  lines.push(
    '',
    `Spirality's main is at ${judged.commit.slice(0, 7)}: ${commitUrl(judged.commit)}`,
    'The fix is an agent session copying from that commit (`npm run onboard:copy` in Spirality), with `npm run test:loop` passing, in a StarCaster pull request that updates the commit named in loop/README.md.',
    `Checked from ${node} at ${at}. Said again once a day until loop/ matches; one all-clear when it does.`,
  );
  return lines.join('\n');
}

function renderCannotTell({ judged, node, at }) {
  return [
    '[CC-starcaster] ⚪ Could not tell whether StarCaster\'s copy of the loop is behind Spirality',
    '',
    `The check (npm run loop:drift) ${judged.reason}.`,
    'This is not an all-clear: until it can read Spirality again, a Spirality fix StarCaster is missing would go unnoticed.',
    `Checked from ${node} at ${at}. Said again once a day while it cannot tell.`,
  ].join('\n');
}

function renderClear({ judged, node, at }) {
  return [
    `[CC-starcaster] ✅ StarCaster's copy of the loop matches Spirality again (${judged.reason})`,
    `Checked from ${node} at ${at}.`,
  ].join('\n');
}

module.exports = {
  VERDICT,
  EXIT,
  SPIRALITY_REPO,
  DAY_MS,
  LOCAL_ONLY,
  blobSha,
  judge,
  plan,
  renderBehind,
  renderCannotTell,
  renderClear,
};
