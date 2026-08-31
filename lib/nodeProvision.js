'use strict';

/**
 * What a node IS — the whole inventory, in one place.
 *
 * WHY THIS EXISTS (NODES Slice D, principle P2)
 * Standing a machine up used to be a seven-page document with about thirty
 * hand steps (ClickUp doc 2kydhxeu-754). A document with thirty steps is a
 * document whose thirtieth step gets skipped, and several of these steps fail
 * SILENTLY when skipped — a missing container runtime does not announce
 * itself, it just makes the visual gates unrunnable a week later.
 *
 * So the steps stopped being prose and became this table. Two things read it
 * and nothing else may hardcode a copy:
 *
 *   scripts/provision_node.sh   does the FIXING   (check → fix → re-check)
 *   scripts/doctor_node.mjs     does the CHECKING (`npm run doctor:node`)
 *
 * ONE INVENTORY, ON PURPOSE. The same reasoning put the role registry in
 * lib/nodeRoles.js: a provisioner and a verifier that each carry their own
 * idea of what "provisioned" means will disagree, and the disagreement will
 * be a green check on a machine that does not work. The verifier must be
 * able to fail something the provisioner just "fixed".
 *
 * THE RULE EVERY ENTRY OBEYS
 * A check that could not run reports CANNOT TELL, never a pass
 * (docs/DOCTRINE.md §3.11). That is why `blocked` and `secret` are fields
 * here rather than special cases in the two callers — a step nobody can
 * automate is a first-class state of this table, not an omission.
 *
 * NO MACHINE IS NAMED HERE. Every path is derived at call time (NODES P1);
 * `scripts/check_machine_paths.cjs` fails the commit if one creeps in.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const taskRepo = require('../scripts/builder/taskRepo.js');
const nodeRoles = require('./nodeRoles.js');

/** This repo's root, derived — not the worktree's, when one is in play. */
const REPO_ROOT = path.resolve(__dirname, '..');

// --- the pinned Node version ------------------------------------------------

/**
 * The Node version every node runs.
 *
 * Pinned because the two machines had already drifted apart without anyone
 * choosing to: the MacBook is on 22.22.0 via nvm and the Mac Mini on 22.23.2
 * via brew, purely because brew installed whatever was newest on the day
 * (found 2026-08-22, recorded on this ticket). Version drift between nodes is
 * precisely the class of thing NODES exists to stop, and "whatever brew last
 * installed" is not a decision anybody made.
 *
 * The pin lives in `.nvmrc` rather than here so `nvm use` in the checkout
 * picks it up with no argument. This function is the reader, and a missing or
 * unreadable file answers null — which the callers report as CANNOT TELL, not
 * as a pass.
 */
function pinnedNodeVersion(root = REPO_ROOT) {
  try {
    const raw = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
    return /^v?\d+\.\d+\.\d+$/.test(raw) ? raw.replace(/^v/, '') : null;
  } catch (_) {
    return null;
  }
}

// --- the toolchain ----------------------------------------------------------

/**
 * Every command a node needs on its PATH.
 *
 * `brew` is the fix for most of them, which is why most of them are safe for
 * an unattended pass to install. The two that are not — Homebrew itself and
 * the Claude CLI — install by piping a URL into a shell, and that is a
 * decision with a person's name on it, so they are `secret: false` but
 * `manual: true`: prompted, never run.
 *
 * `versionArgs` is separate from `command` because several of these answer
 * `--version` on stderr, or not at all.
 */
const REQUIRED_TOOLS = [
  {
    id: 'homebrew',
    command: 'brew',
    versionArgs: ['--version'],
    manual: true,
    why: 'Everything else on this list is installed with it.',
    fixHint: 'Install Homebrew from https://brew.sh (it pipes a script into bash — your call, not an agent\'s).',
  },
  {
    id: 'git',
    command: 'git',
    versionArgs: ['--version'],
    brew: 'git',
    why: 'Every repo on the machine.',
  },
  {
    id: 'node',
    command: 'node',
    versionArgs: ['--version'],
    pinned: true,
    manual: true,
    why: 'The runtime for the app, the build and every loop script. Pinned so two nodes cannot drift apart.',
    fixHint: 'nvm install   (from inside the checkout — it reads .nvmrc)',
  },
  {
    id: 'npm',
    command: 'npm',
    versionArgs: ['--version'],
    manual: true,
    why: 'Ships with Node; a missing npm means the Node install is broken, not that npm needs installing.',
    fixHint: 'Reinstall Node — npm comes with it.',
  },
  {
    id: 'gh',
    command: 'gh',
    versionArgs: ['--version'],
    brew: 'gh',
    why: 'Pull requests, CI status and the git credentials for pushing.',
  },
  {
    id: 'doppler',
    command: 'doppler',
    versionArgs: ['--version'],
    brew: 'dopplerhq/cli/doppler',
    why: 'Every secret this repo reads comes through it; no script here holds one directly.',
  },
  {
    id: 'supabase',
    command: 'supabase',
    versionArgs: ['--version'],
    brew: 'supabase/tap/supabase',
    why: 'Starts and stops the local database the visual gates need.',
  },
  {
    id: 'jq',
    command: 'jq',
    versionArgs: ['--version'],
    brew: 'jq',
    why: 'Used by the shell scripts that read JSON.',
  },
  {
    id: 'claude',
    command: 'claude',
    versionArgs: ['--version'],
    manual: true,
    why: 'The agent sessions the loops run in.',
    fixHint: 'Install Claude Code from https://claude.com/claude-code (it lands in ~/.local/bin).',
  },
];

/**
 * The container runtime. Deliberately NOT a row in REQUIRED_TOOLS, because
 * the two machines legitimately answer it differently: the MacBook runs
 * Docker Desktop, the Mac Mini runs Colima (headless, no login session to
 * hang a GUI app on). Requiring a specific one would have failed a working
 * machine.
 *
 * What actually matters is that `docker info` answers — a runtime that is
 * installed but not running is worth nothing. That is the check; how it got
 * there is not our business.
 *
 * The related trap, from 2026-08-21: probing this over SSH reported "lima not
 * found" on a machine where Colima was running perfectly, because a
 * non-interactive shell has no /opt/homebrew/bin on its PATH. A probe that
 * contradicts itself is a statement about the instrument, not the machine.
 */
const CONTAINER_RUNTIME = {
  id: 'container-runtime',
  why: 'No container runtime means no local database, which means the visual gates cannot run at all.',
  candidates: [
    { id: 'colima', command: 'colima', brew: 'colima', note: 'headless — the right choice on a machine with no one logged in' },
    { id: 'docker-desktop', command: 'docker', brew: null, note: 'Docker Desktop — the usual choice on a laptop' },
  ],
  fixHint: 'brew install colima docker && colima start   (headless), or install Docker Desktop and open it.',
};

// --- the repos --------------------------------------------------------------

/**
 * The four checkouts a node carries, and where each one goes.
 *
 * The homes are NOT written down here — they come from
 * scripts/builder/taskRepo.js, which is what the loops themselves use to
 * decide where a `repo:` tagged ticket gets built. If this table invented its
 * own answer, a node could be "fully provisioned" by this script and still
 * escalate every ticket for a repo it demonstrably has.
 */
const REPO_URLS = {
  starcaster: 'https://github.com/mentor24-maker/starcaster.git',
  normie: 'https://github.com/mentor24-maker/normie.git',
  pulse: 'https://github.com/mentor24-maker/pulse.git',
  vault: 'https://github.com/mentor24-maker/daneofearth-vault.git',
};

const REPO_WHY = {
  starcaster: 'The platform, and the home of every ops command on this list.',
  normie: 'A sibling product; Loop Queue tickets tagged repo:normie build here.',
  pulse: 'The scheduled pipelines, and the launchd installer this script wants to call.',
  vault: 'Canon. Doctrine that every session reads lives here, not in a repo.',
};

function requiredRepos() {
  return Object.keys(REPO_URLS).map((name) => ({
    name,
    home: taskRepo.repoHome(name),
    url: REPO_URLS[name],
    why: REPO_WHY[name],
  }));
}

/**
 * The other places a checkout might actually be sitting.
 *
 * This exists because of a real finding on the first run of `doctor:node`
 * (2026-08-30): `pulse` is not at the home taskRepo derives for it
 * (`<siblings>/pulse`) — it is directly in the home folder. Two consequences,
 * and the second is the dangerous one:
 *
 *   1. `resolveTaskRepo` reports pulse as "not checked out on this machine"
 *      and escalates every repo:pulse ticket, on the ONE machine that has it.
 *   2. A provisioner that only knew the expected home would happily clone a
 *      SECOND copy on top — two checkouts of the same repo, diverging, with
 *      nothing to say which one anybody is editing.
 *
 * So this reports the discrepancy rather than papering over it. It deliberately
 * does NOT change where the loops build: that is `taskRepo.repoHome`'s answer,
 * it is what loop-build already uses, and quietly relocating it from inside a
 * provisioning script would be a behaviour change to the build lane hidden in
 * an ops tool. Where pulse should live is a decision, and it is Dane's.
 */
function findRepoElsewhere(name, expectedHome, { homedir = os.homedir(), exists = fs.existsSync } = {}) {
  const siblings = path.dirname(REPO_ROOT);
  const candidates = [
    path.join(homedir, name),
    path.join(homedir, 'WebApps', name),
    path.join(siblings, name),
  ];
  for (const candidate of candidates) {
    if (candidate === expectedHome) continue;
    if (exists(path.join(candidate, '.git'))) return candidate;
  }
  return null;
}

// --- config that is derived from a path, not typed --------------------------

/**
 * The per-project folder Claude Code keeps its memory in.
 *
 * Its NAME is derived from the checkout's absolute path — every separator
 * becomes a dash — which means it is different on every machine and cannot be
 * copied across. That is the specific step the old setup document got wrong:
 * copying `.claude` from one Mac put the memory under the OTHER machine's
 * folder name, where nothing would ever read it, and no error was produced
 * because an empty memory folder is a perfectly normal state.
 */
function claudeProjectSlug(checkoutPath) {
  return String(checkoutPath || '').replace(/[^A-Za-z0-9]/g, '-');
}

function claudeMemoryDir(checkoutPath, homedir = os.homedir()) {
  return path.join(homedir, '.claude', 'projects', claudeProjectSlug(checkoutPath), 'memory');
}

// --- the steps that touch a live credential ---------------------------------

/**
 * The secrets boundary, as data.
 *
 * Every one of these needs a real credential typed by Dane. No agent session
 * and no script may hold the value (docs/DOCTRINE.md §4.1, vault
 * OPERATIONS.md SOP 6) — so the provisioner does not attempt them, does not
 * fail on them, and does not quietly skip them either. It PRINTS them, in the
 * block below, and reports them as WAITING.
 *
 * They are in this file so the two callers cannot disagree about what counts
 * as a secret. A step that moved out of this list by accident would be a step
 * an unattended pass tried to run.
 */
const SECRET_STEPS = [
  {
    id: 'doppler-login',
    title: 'Log this machine in to Doppler',
    command: 'doppler login',
    why: 'Every secret the repo reads comes through Doppler. Until this is done, every ops command fails.',
  },
  {
    id: 'gh-login',
    title: 'Log this machine in to GitHub, and hand git the same credentials',
    command: 'gh auth login && gh auth setup-git',
    why: 'Without the second command, pushes prompt for a password forever and a scheduled job hangs instead of failing.',
  },
  {
    id: 'doppler-scope',
    title: 'Point the checkout at the right Doppler project',
    command: 'doppler setup --project starcaster --config dev --no-interactive',
    why: 'Scoping is per folder. An unscoped checkout reads no secrets and says so unhelpfully.',
    // Safe to automate ONCE doppler-login has happened: it selects a project,
    // it does not reveal or transmit a value. The provisioner runs it.
    automatableAfter: 'doppler-login',
  },
  {
    id: 'claude-login',
    title: 'Log this machine in to Claude Code',
    command: 'claude   (then follow the sign-in prompt, once)',
    why: 'The loops run as agent sessions; an unauthenticated CLI exits immediately and the queue silently stops moving.',
  },
];

/**
 * Render a prompt block. ONE renderer, so the shell script and the checker
 * produce a byte-identical block — the operator learns to recognise it once.
 */
function promptBlock(step) {
  return [
    '::: PROMPT FOR DANE :::',
    `  ${step.title}`,
    `  Why: ${step.why}`,
    '',
    `  ${step.command}`,
    ':::::::::::::::::::::::',
  ].join('\n');
}

// --- schedules --------------------------------------------------------------

/**
 * How each exclusive job's SCHEDULE gets installed on the machine that owns
 * it. Which machine owns what is lib/nodeRoles.js's answer and is not
 * repeated here; this only says "and how do you install it once you know".
 *
 * `blocked` is the honest entry for a job whose installer does not exist yet.
 * It is reported as CANNOT DO YET — loudly, every run — and never as a pass.
 * A provisioning script that reported success across the board while quietly
 * installing no scheduled jobs would be a green check on a machine that does
 * nothing, which is the exact failure this whole plan was written against.
 */
const JOB_SCHEDULES = {
  'bus-relay': {
    installer: 'scripts/install_bus_relay.sh',
    status: 'scripts/install_bus_relay.sh --status',
    label: 'com.starcaster.bus-relay',
  },
  'db-refresh': {
    manual: true,
    why: 'Deliberately has no schedule. It spends production disk IO and wants a person nearby; '
      + 'six unattended runs in one day took every client site down on 2026-08-17.',
  },
  'loop-build': {
    blocked: 'The loops run inside a long-lived agent session, not a launchd job — there is no installer in this repo yet. '
      + 'Start them by hand on the owning machine and record how, then this row gets an installer.',
  },
  'loop-review': {
    blocked: 'Same as loop-build — one session runs both lanes.',
  },
  'pulse-pipelines': {
    blocked: 'Installing these needs pulse\'s bin/install-launchd.sh, which is NODES Slice B (ticket 86bbh9kh2) and is not written yet. '
      + 'Until it exists, the pulse schedules are installed by hand and this row cannot be automated.',
    blockedBy: '86bbh9kh2',
  },
};

/** The schedules that matter on THIS machine — the jobs it actually owns. */
function schedulesForNode(nodeName) {
  return nodeRoles.rolesOwnedBy(nodeName).map((role) => ({
    role,
    ...(JOB_SCHEDULES[role] || { blocked: `No installer is registered for "${role}" in lib/nodeProvision.js.` }),
  }));
}

module.exports = {
  CONTAINER_RUNTIME,
  JOB_SCHEDULES,
  REPO_ROOT,
  REPO_URLS,
  REQUIRED_TOOLS,
  SECRET_STEPS,
  claudeMemoryDir,
  claudeProjectSlug,
  findRepoElsewhere,
  pinnedNodeVersion,
  promptBlock,
  requiredRepos,
  schedulesForNode,
};
