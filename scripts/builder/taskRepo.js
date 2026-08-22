'use strict';

/**
 * Which repo a Loop Queue task belongs to (Charter: "a task declares its
 * repo"). Pulled out of the loop skills and clickup_direct.mjs so the rule is
 * one testable function, not prose re-interpreted by each agent.
 *
 * A task declares its repo with a ClickUp TAG, `repo:<name>` — a tag, not a
 * word in the body, because a tag is queryable and cannot be reworded by an
 * edit that reads as innocent. Four repos are known: starcaster, normie,
 * pulse, vault.
 *
 * The rules, and why each is the safe direction:
 *   - No `repo:` tag  → starcaster. The default is today's behaviour, so
 *     nothing already in the queue changes when this ships.
 *   - One known tag   → that repo.
 *   - An UNKNOWN repo → escalate (Needs your input), never guess. Building a
 *     `repo:nonsense` task in starcaster would run the wrong gates against the
 *     wrong checkout and call it done.
 *   - TWO different repo tags → escalate. "Both" is not a repo; a loop that
 *     picked one would be picking at random.
 *
 * Repo HOMES are derived from the environment, never hardcoded (NODES P1: no
 * committed artifact names a machine). starcaster is this checkout's root;
 * its siblings sit beside it; the vault is `~/vault` (the same default the
 * ecosystem-map and vault-drift tools already use).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

/**
 * The MAIN starcaster checkout, even when this module is required from inside
 * a linked worktree (which is where the loops run). `__dirname` under a
 * worktree is `<main>/.claude/worktrees/<topic>/scripts/builder`, so deriving
 * siblings from it would put normie/pulse under `.claude/worktrees/` — wrong.
 * git's common dir is always `<main>/.git`, so its parent is the real root.
 * Falls back to the __dirname guess only if git cannot answer.
 */
function mainCheckoutRoot() {
  const here = path.join(__dirname, '..', '..');
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (common.endsWith(`${path.sep}.git`) || common.endsWith('/.git')) return path.dirname(common);
  } catch { /* not a git checkout, or git absent — fall back */ }
  return here;
}

const STARCASTER_ROOT = mainCheckoutRoot();
const SIBLINGS = path.dirname(STARCASTER_ROOT);

/**
 * name → how to find its checkout and what "gates" mean there. The gate
 * details live in docs/LOOP_ENGINEERING.md (the loops read them there); this
 * carries only what code needs: where the repo is, and whether it has a
 * programmatic test suite at all.
 */
const KNOWN_REPOS = {
  starcaster: { home: STARCASTER_ROOT, hasTests: true },
  normie: { home: path.join(SIBLINGS, 'normie'), hasTests: true },
  pulse: { home: path.join(SIBLINGS, 'pulse'), hasTests: false },
  vault: { home: path.join(os.homedir(), 'vault'), hasTests: false },
};

const DEFAULT_REPO = 'starcaster';
const REPO_TAG_RE = /^repo:(.+)$/i;

/** Accept ClickUp's tag objects ({ name }) or plain strings. */
function tagNames(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (typeof t === 'string' ? t : t && t.name))
    .filter((s) => typeof s === 'string')
    .map((s) => s.trim());
}

/**
 * @returns {{ repo: string|null, known: boolean, action: 'build'|'escalate',
 *   reason: string }}
 *   `action` is what the loop should do: 'build' (repo is resolved) or
 *   'escalate' (move to Needs your input, do not guess).
 */
function resolveTaskRepo(tags, { exists = fs.existsSync } = {}) {
  const declared = tagNames(tags)
    .map((name) => {
      const m = name.match(REPO_TAG_RE);
      return m ? m[1].trim().toLowerCase() : null;
    })
    .filter(Boolean);
  const distinct = [...new Set(declared)];

  if (distinct.length === 0) {
    return { repo: DEFAULT_REPO, known: true, action: 'build', reason: 'no repo: tag — defaults to starcaster' };
  }
  if (distinct.length > 1) {
    return {
      repo: null,
      known: false,
      action: 'escalate',
      reason: `more than one repo tag (${distinct.map((r) => `repo:${r}`).join(', ')}) — "both" is not a repo`,
    };
  }
  const repo = distinct[0];
  if (!Object.prototype.hasOwnProperty.call(KNOWN_REPOS, repo)) {
    return {
      repo,
      known: false,
      action: 'escalate',
      reason: `unknown repo "${repo}" — known repos are ${Object.keys(KNOWN_REPOS).join(', ')}`,
    };
  }
  // A KNOWN repo whose checkout is not on THIS machine must escalate, not
  // build: otherwise the loop claims it and dies on a raw `git -C <missing>`
  // partway through — the "wrong checkout, called done" failure this resolver
  // exists to prevent, one step later. (docs/LOOP_ENGINEERING.md promises it.)
  const home = repoHome(repo);
  if (!exists(home)) {
    return {
      repo,
      known: true,
      action: 'escalate',
      reason: `repo:${repo} is not checked out on this machine (${home}) — provision it or run this task on the node that has it`,
    };
  }
  return { repo, known: true, action: 'build', reason: `tagged repo:${repo}` };
}

/** Absolute checkout path for a known repo, or '' for an unknown one. */
function repoHome(repo) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_REPOS, repo)) return '';
  return KNOWN_REPOS[repo].home;
}

module.exports = {
  KNOWN_REPOS,
  DEFAULT_REPO,
  REPO_TAG_RE,
  resolveTaskRepo,
  repoHome,
  tagNames,
};
