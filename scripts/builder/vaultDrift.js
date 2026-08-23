'use strict';

/**
 * Vault drift detection — the two variants of "canon state nothing reads" that
 * a script CAN see (approved by Dane in session, 2026-08-20):
 *
 *   1. Publication state — vault work committed but never pushed, or edits
 *      never committed, so HQ cannot see the canon that exists locally.
 *   2. Citation resolution — signed doctrine citing a doctrine file that does
 *      not exist (the quota-doctrine gap: BOOTSTRAP-CAPACITY cited a canon
 *      file that went two days undrafted).
 *
 * The vault is a NO-MACHINERY zone (vault CLAUDE.md), so this lives in
 * starcaster and only READS the vault. It NEVER writes to the vault. It is not
 * a CI/commit gate — it informs a human at `npm run doctor` time, and a
 * missing vault is CANNOT TELL, never a silent pass (DOCTRINE §3.11).
 *
 * The citation scanner is pure (content in, findings out) so it is tested
 * without a vault; the git/fs orchestration takes injectable deps.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Bare ALL-CAPS *.md names that belong to OTHER repos, not vault doctrine —
// doctrine prose names them legitimately. A path-prefixed reference (a/b/X.md)
// is exempt automatically; this list covers the bare mentions.
const EXTERNAL_DOC_NAMES = new Set([
  'DOCTRINE.md', 'LOOP_ENGINEERING.md', 'SKILL.md', 'MEMORY.md', 'README.md',
  'CLAUDE.md', 'WORK-LOG.md', 'UI_RULES.md', 'APPROVALS.md', 'NODES.md',
]);
// NODES.md is the ONE that lives in the vault as _proposals/NODES.md — it is
// resolved by the scan when present; it is NOT in the exempt set. (Removed
// below so the scan checks it.)
EXTERNAL_DOC_NAMES.delete('NODES.md');

// An ALL-CAPS basename with .md: LETTERS/DIGITS, hyphen or underscore joined.
const DOC_REF = /(?<![\w/.-])([A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*\.md)\b/g;

/**
 * Scan doctrine files for references to doctrine .md files that do not resolve.
 * @param {Array<{path:string, content:string}>} files  doctrine + _proposals md files
 * @param {Set<string>} existingBasenames  every *.md basename present in doctrine/ + _proposals/
 * @returns {Array<{file:string, missing:string}>}  dangling citations
 */
function scanCitations(files, existingBasenames) {
  const dangling = [];
  for (const { path: file, content } of files) {
    const seen = new Set();
    for (const m of String(content || '').matchAll(DOC_REF)) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      if (EXTERNAL_DOC_NAMES.has(name)) continue;         // known other-repo doc
      if (existingBasenames.has(name)) continue;          // resolves in the vault
      // Not resolvable and not a known external doc — report it, naming the
      // citing file and the missing name. "Unrecognized" rather than silent.
      dangling.push({ file, missing: name });
    }
  }
  return dangling;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * Full drift check against a vault directory. Returns typed buckets:
 *   findings: real problems, each with a one-line fix
 *   cannotTell: what could not be checked (never folded into "ok")
 *   ok: true only when something was actually checked and all clean
 * Injectable deps for tests (default real fs/git).
 */
function checkVaultDrift(vaultDir, deps = {}) {
  const {
    exists = (p) => fs.existsSync(p),
    listDir = (p) => fs.readdirSync(p),
    readFile = (p) => fs.readFileSync(p, 'utf8'),
    runGit = git,
  } = deps;

  const findings = [];
  const cannotTell = [];

  if (!vaultDir || !exists(vaultDir)) {
    cannotTell.push(`vault not found at ${vaultDir || '(unset)'} — this machine may not carry it (worktrees and CI do not). Not a problem, just unchecked.`);
    return { findings, cannotTell, ok: false, checked: false };
  }

  // ── 1. publication state ──────────────────────────────────────────────
  try {
    const porcelain = runGit(['status', '--porcelain'], vaultDir);
    if (porcelain) {
      const n = porcelain.split('\n').filter((l) => l.trim()).length;
      findings.push(`Vault: ${n} uncommitted change${n === 1 ? '' : 's'} in the vault — commit them in ~/vault so HQ can see the canon.`);
    }
    try {
      const ahead = runGit(['log', '--oneline', '@{upstream}..HEAD'], vaultDir);
      if (ahead) {
        const n = ahead.split('\n').filter((l) => l.trim()).length;
        findings.push(`Vault: ${n} commit${n === 1 ? '' : 's'} saved on this machine but never sent to GitHub — run git push in ~/vault.`);
      }
    } catch {
      cannotTell.push('Vault: no upstream configured for the current branch — cannot tell whether local commits are pushed. Set one with `git branch --set-upstream-to`.');
    }
  } catch (err) {
    cannotTell.push(`Vault: not a readable git repo at ${vaultDir} (${err.message}) — publication state unchecked.`);
  }

  // ── 2. citation resolution ────────────────────────────────────────────
  try {
    const dirs = ['doctrine', path.join('doctrine', '_proposals')]
      .map((d) => path.join(vaultDir, d))
      .filter((d) => exists(d));
    if (!dirs.length) {
      cannotTell.push(`Vault: no doctrine/ directory under ${vaultDir} — citation check skipped.`);
    } else {
      const files = [];
      const basenames = new Set();
      for (const dir of dirs) {
        for (const entry of listDir(dir)) {
          if (!entry.endsWith('.md')) continue;
          basenames.add(entry);
          files.push({ path: path.relative(vaultDir, path.join(dir, entry)), content: readFile(path.join(dir, entry)) });
        }
      }
      for (const d of scanCitations(files, basenames)) {
        findings.push(`Vault: ${d.file} cites ${d.missing}, which is not in doctrine/ or doctrine/_proposals/ (and is not a known external doc) — draft it, fix the name, or add it to the ignore list.`);
      }
    }
  } catch (err) {
    cannotTell.push(`Vault: citation scan failed (${err.message}).`);
  }

  return { findings, cannotTell, ok: findings.length === 0, checked: true };
}

module.exports = { scanCitations, checkVaultDrift, EXTERNAL_DOC_NAMES };
