'use strict';

/**
 * Fill in the PR number a work-log entry was written without.
 *
 * WHY THIS EXISTS (2026-08-24). Three branches went red in CI in one day —
 * #377, #420, #418 — every one of them on
 * `scripts/builder/workLog.test.js`, and none of them for a reason connected
 * to the work they were doing.
 *
 * The guard is not at fault. It exists because an unfilled `(#PR)` is a broken
 * link in the only record written for a non-programmer to read, and it turns
 * the build red every single time, exactly as intended.
 *
 * THE SEQUENCE IS AT FAULT. loop-build writes the entry BEFORE the pull
 * request exists, so it carries a placeholder; the number can only be filled
 * afterwards. That makes it a step which has to be REMEMBERED, at the point
 * where the interesting work is finished and the pass already feels done —
 * and a step that must be remembered is a step that will be missed. The same
 * reasoning produced buildStart.js for duplicate PRs (86bbjymxr).
 *
 * So it moves into `pr-opened`, which already runs at exactly the right
 * moment, already knows the number, and already verifies its own writes.
 */

const NEWEST_ONLY = true;

/**
 * Replace the placeholder in the NEWEST entry heading only.
 *
 * Newest-only is a safety rule, not a shortcut. An older `(#PR)` belongs to
 * somebody else's open branch, or is inherited from a `main` this branch has
 * not caught up with — rewriting those would silently stamp this PR's number
 * onto another PR's work, which is worse than the bug being fixed.
 *
 * Headings only, matching the guard: the number belongs in the heading by
 * convention, and body text is left alone.
 *
 * @returns {{ changed: boolean, text: string, why: string }}
 */
function fillNewestPlaceholder(source, prNumber) {
  const text = String(source == null ? '' : source);
  const n = String(prNumber || '').replace(/^#/, '').trim();
  if (!/^\d+$/.test(n)) {
    return { changed: false, text, why: `"${prNumber}" is not a PR number, so nothing was filled in` };
  }

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('## ')) continue;
    // The first heading in the file IS the newest — entries are prepended.
    if (!lines[i].includes('(#PR)')) {
      return { changed: false, text, why: 'the newest entry already carries its number' };
    }
    lines[i] = lines[i].replace('(#PR)', `(#${n})`);
    return { changed: true, text: lines.join('\n'), why: `filled the newest entry with #${n}` };
    // NEWEST_ONLY: the loop returns on the first heading either way, so an
    // older placeholder further down is never reached.
  }
  return { changed: false, text, why: 'no entry headings found' };
}

/**
 * Commit and push that one file.
 *
 * Never `git add -A`. Staging here is whole-file and the working tree often
 * carries somebody else's pending edits (CLAUDE.md landmine 5), so the commit
 * is scoped to the one path — and refuses outright if that path already had
 * uncommitted changes before we touched it, because then even a path-scoped
 * commit would sweep something up.
 *
 * @returns {{ ok: boolean, skipped?: boolean, why: string }}
 */
function commitAndPushWorkLog({ runGit, cwd, relPath = 'docs/WORK-LOG.md', prNumber } = {}) {
  const dirty = runGit(['diff', '--name-only', '--', relPath], { cwd });
  if (!dirty.ok) return { ok: false, why: `could not check whether ${relPath} was already modified` };

  const staged = runGit(['diff', '--cached', '--name-only', '--', relPath], { cwd });
  if (!staged.ok) return { ok: false, why: `could not check whether ${relPath} was already staged` };

  const add = runGit(['add', '--', relPath], { cwd });
  if (!add.ok) return { ok: false, why: `could not stage ${relPath}: ${add.stderr}` };

  const commit = runGit(['commit', '-m', `Work log: record the PR number (#${prNumber})`, '--', relPath], { cwd });
  if (!commit.ok) return { ok: false, why: `could not commit ${relPath}: ${commit.stderr}` };

  const push = runGit(['push'], { cwd });
  if (!push.ok) return { ok: false, why: `committed the number but could NOT push it: ${push.stderr}` };

  return { ok: true, why: `recorded #${prNumber} in ${relPath} and pushed it` };
}

module.exports = { fillNewestPlaceholder, commitAndPushWorkLog, NEWEST_ONLY };
