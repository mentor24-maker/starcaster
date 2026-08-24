// Where the main checkout lives — derived, never a hardcoded machine path.
//
// Several one-off scripts need `.env.local`, which is gitignored and therefore
// only exists in the primary checkout, not in the worktrees the loops build in.
// They used to reach it through a literal absolute path into one person's home folder,
// which is a machine-specific assumption recorded where nothing can notice it
// stopped being true: on any other machine the path simply does not exist and
// the failure is a confusing "no such file", not "this script names a laptop".
// (NODES principle P1 — no committed artifact names a machine.)
//
// `git rev-parse --git-common-dir` answers this exactly: inside a linked
// worktree it points at the MAIN checkout's `.git`, so its parent is the main
// checkout; in the main checkout it points at that checkout's own `.git`.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

export function mainCheckoutDir(fallbackDir) {
  try {
    const commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: fallbackDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (commonDir) return path.dirname(commonDir);
  } catch {
    // Not a git checkout, or git is unavailable — the caller's own root is the
    // best remaining answer, and is correct whenever this is the main checkout.
  }
  return fallbackDir;
}

// Runnable, so a shell can ask the same question the scripts do:
//
//   node "$(git rev-parse --show-toplevel)/scripts/lib/main_checkout.mjs"
//
// The `--show-toplevel` there only locates THIS FILE, which every worktree
// carries, so it is correct from anywhere. The answer itself comes from the
// function above. `loop-build`'s step 2 used `--show-toplevel` for the answer
// as well, which is the bug: it means "the folder I am in", so a loop started
// inside a worktree nested its per-task worktrees inside that one. Two
// spellings of "where is the main checkout" would drift apart, so there is one.
// "Was this file RUN, or imported?" — and there are two separate ways to get
// that comparison wrong, both of which make this block silently not run. The
// caller then gets an empty string and dies further down naming nothing
// useful; it fails closed rather than building in the wrong place, but a guard
// whose failure mode is a blank answer is worth spelling correctly.
//
//   1. A hand-built `file://${argv[1]}` does no percent-encoding, so any path
//      containing a space never matches.
//   2. `import.meta.url` is the REAL path; `argv[1]` is the path as typed. On
//      macOS `/tmp` is a symlink to `/private/tmp`, so running this from
//      anywhere under /tmp compares two spellings of the same file.
//
// Fixing only the first still fails under /tmp — measured, not assumed.
function isRunDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false; // the entry path vanished; not our file
  }
}

if (isRunDirectly()) {
  process.stdout.write(`${mainCheckoutDir(process.cwd())}\n`);
}
