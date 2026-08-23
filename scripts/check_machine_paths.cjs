#!/usr/bin/env node
'use strict';

/**
 * scripts/check_machine_paths.cjs — fail on a home-folder path written into a
 * committed file.
 *
 * A machine-specific path is an assumption recorded where nothing can notice it
 * stopped being true. `/Users/mentor/WebApps/starcaster` is correct on exactly
 * one laptop; on the Mac Mini that folder does not exist, and the failure it
 * produces is a confusing "no such file" rather than "this file names somebody's
 * laptop". launchd fires a job whose script is not there and records success.
 *
 * Discovered 2026-08-19 while provisioning the Mini: 13 committed files outside
 * `docs/` carried that path, including `.claude/skills/loop-build/SKILL.md` —
 * the skill the Mini exists to run. Ratified as vault `doctrine/NODES.md`
 * principle P1: no committed artifact names a machine.
 *
 * This is a SEPARATE script and a separate BLOCKING CI step, for the reason
 * spelled out in check_model_ids.cjs: `check_conventions.cjs --all` runs under
 * continue-on-error in CI, so a rule folded into it is advisory and can never
 * turn the build red. It is required from check_conventions too, which is fine
 * because pre-commit DOES block. NODES asks for born-blocking checks — a
 * warning has no reader in an unattended pipeline.
 *
 *   npm run check:paths       # repo-wide, blocking (CI + by hand)
 *   node scripts/check_machine_paths.cjs --all
 *
 * `docs/` is deliberately exempt. Prose that mentions a path is a different
 * failure mode — drift, not breakage — and is handled under the vault's
 * OPERATIONS.md SOP 2.
 */

const fs = require('fs');
const { execSync } = require('child_process');

const SELF = 'scripts/check_machine_paths.cjs';

// A macOS home folder (/Users/<name>/) or a Linux one (/home/<name>/).
//
// Two things this pattern has to get right, both found by running it:
//
// - The trailing separator is required, so the bare word "/Users" in prose does
//   not trip it and this only fires once a path actually names somebody.
// - The lookbehind is required, because "home" is an ordinary folder name. The
//   first version flagged five files over the TypeScript path alias
//   `@/src/site/home/partials/*` — the "/home/" there is preceded by "site",
//   not by the start of an absolute path. Rejecting a preceding word char, "/",
//   "." or "-" is what separates "an absolute path to somebody's home folder"
//   from "a folder that happens to be called home".
const MACHINE_PATH_RE = /(?<![\w./-])\/(?:Users|home)\/[A-Za-z0-9._-]+\//;

const ADVICE =
  'Derive the path instead of writing it down: `git rev-parse --show-toplevel`\n' +
  "    in a shell, `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`\n" +
  '    in a script, or `mainCheckoutDir(ROOT)` from scripts/lib/main_checkout.mjs\n' +
  '    when you specifically need the MAIN checkout from inside a worktree.\n' +
  '    If a literal path is genuinely unavoidable it belongs in docs/ (exempt),\n' +
  '    with the reason stated. See vault doctrine/NODES.md principle P1.';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// git quotes any path containing a space or a non-ASCII character, so the plain
// --name-only form hands back `"docs/Module Overhaul/Screenshot ….png"` — quote
// marks included. That leading quote made `startsWith('docs/')` false, and two
// exempt files were reported as unreadable. `-z` emits raw NUL-separated names
// and never quotes, which removes the class rather than unescaping after it.
function shPaths(cmd) {
  return sh(cmd).split('\0').map((s) => s.trim()).filter(Boolean);
}

// Everything git tracks except docs/ and this file, which has to contain the
// pattern in order to test for it.
function isExempt(file) {
  return file === SELF || file.startsWith('docs/');
}

function isBinary(content) {
  return content.includes('\0');
}

function scan(content, where, failures) {
  content.split('\n').forEach((line, i) => {
    const hit = line.match(MACHINE_PATH_RE);
    if (hit) {
      failures.push(
        `Machine-specific path "${hit[0]}…" in ${where}:${i + 1}\n` +
        `    ${line.trim().slice(0, 110)}\n` +
        `    ${ADVICE}`,
      );
    }
  });
}

/**
 * @param {{ all?: boolean }} opts
 * @returns {{ failures: string[], notes: string[] }}
 */
function run(opts = {}) {
  const failures = [];
  const notes = [];

  if (opts.all) {
    const files = shPaths('git ls-files -z').filter((f) => !isExempt(f));
    let scanned = 0;
    for (const file of files) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        // Listed by git but unreadable right now (deleted mid-run, bad symlink).
        // Say so rather than counting it clean — a sweep that could not read a
        // file has not checked it (docs/DOCTRINE.md 3.11).
        notes.push(`could not read ${file} — NOT checked`);
        continue;
      }
      if (isBinary(content)) continue;
      scanned += 1;
      scan(content, file, failures);
    }
    notes.push(`machine paths: scanned ${scanned} tracked file(s) outside docs/`);
    return { failures, notes };
  }

  // Staged mode: scan the full staged blob of each changed file, not just its
  // added lines — a path that already existed in HEAD and merely moved within
  // the file shows up in the diff as unchanged context, which is exactly the
  // case this check exists for. Untouched files are never scanned, so an
  // unrelated commit is not blocked by a path living somewhere else.
  const staged = shPaths('git diff --cached --name-only --diff-filter=ACMR -z')
    .filter((f) => !isExempt(f));

  for (const file of staged) {
    let content;
    try {
      // The staged blob, not the working tree — that is what is being committed.
      content = sh(`git show :"${file}"`);
    } catch {
      notes.push(`could not read staged ${file} — NOT checked`);
      continue;
    }
    if (isBinary(content)) continue;
    scan(content, `${file} (staged)`, failures);
  }
  return { failures, notes };
}

module.exports = { run, MACHINE_PATH_RE };

if (require.main === module) {
  const { failures, notes } = run({ all: process.argv.includes('--all') });
  for (const note of notes) console.log(`[check:paths] ${note}`);
  if (failures.length) {
    console.error('\n[check:paths] Blocked — machine-specific path(s) found:\n');
    for (const f of failures) console.error(`  ✗ ${f}\n`);
    process.exit(1);
  }
  console.log('[check:paths] OK — no committed file names a machine.');
}
