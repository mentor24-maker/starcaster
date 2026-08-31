#!/usr/bin/env node
/**
 * `npm run doctor:node` — is this MACHINE a valid node?
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `npm run doctor`
 * `doctor` answers "is this FOLDER able to run?" — Docker, the built files,
 * which database this checkout points at. Those are per-worktree questions and
 * a machine can fail every one of them while being a perfectly good node.
 *
 * This answers the other question, the one that had no command at all: does
 * this machine have the identity, the toolchain, the checkouts, the config and
 * the schedules that make it a place work can run? Until now that was a
 * seven-page document (ClickUp doc 2kydhxeu-754) and a person reading down it.
 *
 * READ-ONLY. It installs nothing, starts nothing and writes nothing. Running
 * it on a machine that is on fire is always safe — which is the point, because
 * it is what you run BEFORE deciding whether to provision.
 *
 * THREE STATES, NEVER TWO
 *   PASS         checked, and correct.
 *   FAIL         checked, and wrong — with the command that fixes it.
 *   CANNOT TELL  not checked. Never rendered as a pass.
 *
 * The third one is the whole reason this file is careful. On 2026-08-21 a
 * probe of the Mac Mini reported the container runtime as fatally broken; it
 * was not, and never had been. The probe ran over a non-interactive SSH
 * session with no /opt/homebrew/bin on its PATH, so `colima` could not find
 * `limactl`. Everything it said was consistent with a machine that was working
 * fine, and a day was spent on it. A check that cannot see is not a check that
 * failed — and the two must not print the same way (docs/DOCTRINE.md §3.11).
 *
 * Exit codes, because scripts branch on this:
 *   0  no failures (there may still be CANNOT TELLs — read them)
 *   1  at least one FAIL
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const nodeRoles = require('../lib/nodeRoles.js');
const provision = require('../lib/nodeProvision.js');
const { mainCheckoutDir } = await import('./lib/main_checkout.mjs');

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_CHECKOUT = mainCheckoutDir(HERE);

// --- output -----------------------------------------------------------------

const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);
const dim = (t) => paint('2', t);
const bold = (t) => paint('1', t);

const out = [];
let failures = 0;
let cannotTell = 0;

const heading = (text) => out.push('', bold(text));

function pass(text, detail) {
  out.push(`  ${green('PASS')}  ${text}`);
  if (detail) out.push(`        ${dim(detail)}`);
}

function fail(text, fix, detail) {
  failures += 1;
  out.push(`  ${red('FAIL')}  ${text}`);
  if (detail) out.push(`        ${dim(detail)}`);
  if (fix) out.push(`        ${yellow('→')} ${fix}`);
}

/**
 * Not a pass and not a failure. `why` is required and is not decoration: a
 * CANNOT TELL whose reason is missing is indistinguishable from a bug in this
 * script, and the operator has no way to judge how much it matters.
 */
function unknown(text, why, fix) {
  cannotTell += 1;
  out.push(`  ${yellow('????')}  ${text}`);
  out.push(`        ${dim(`cannot tell: ${why}`)}`);
  if (fix) out.push(`        ${yellow('→')} ${fix}`);
}

/** Neither a check nor a problem — a step that is waiting on Dane. */
function waiting(text, detail) {
  out.push(`  ${yellow('WAIT')}  ${text}`);
  if (detail) out.push(`        ${dim(detail)}`);
}

function note(text) {
  out.push(`        ${dim(text)}`);
}

// --- helpers ----------------------------------------------------------------

/**
 * Run a command and capture its output.
 *
 * Returns three states of its own, mirroring the report: `ran` says whether
 * the command was even found. "The tool is missing" and "the tool ran and
 * disagreed with us" are different findings and this is where they separate.
 */
function sh(command, args, options = {}) {
  try {
    const text = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? 15000,
      cwd: options.cwd,
    });
    return { ran: true, ok: true, text: String(text).trim() };
  } catch (error) {
    const found = error?.code !== 'ENOENT';
    return {
      ran: found,
      ok: false,
      text: String(error?.stdout || error?.stderr || '').trim(),
      error: error?.message || String(error),
    };
  }
}

function has(command) {
  return sh('command', ['-v', command]).ok || sh(command, ['--version']).ran;
}

/** First version-looking token in a version banner. */
function versionOf(text) {
  const m = String(text || '').match(/\d+\.\d+(\.\d+)?/);
  return m ? m[0] : null;
}

// --- 1. identity ------------------------------------------------------------
// First, because every other answer is conditional on it. A machine that does
// not know which node it is cannot be told whether it has the right schedules,
// and reporting on the schedules anyway would be reporting on a guess.

heading('IDENTITY — which node is this?');

const node = nodeRoles.thisNode();
const knownNode = nodeRoles.isKnownNode(node.name);

if (node.source === 'file' && knownNode) {
  pass(`This machine is ${bold(node.name)}.`, `declared in ${node.file}`);
} else if (node.source === 'file' && !knownNode) {
  fail(
    `${node.file} says "${node.raw}", which is not a node this system knows.`,
    `echo ${nodeRoles.KNOWN_NODES[0]} > ${node.file}      ${dim(`# or: ${nodeRoles.KNOWN_NODES.slice(1).join(', ')}`)}`,
    `Known machines: ${nodeRoles.KNOWN_NODES.join(', ')}. Every exclusive job will refuse to run until this is fixed.`,
  );
} else if (knownNode) {
  // The hostname happens to match. That is luck, not a statement — renaming
  // the Mac in System Settings would silently un-provision it.
  fail(
    `This machine has no identity file; it is being recognised by its hostname alone.`,
    `echo ${node.name} > ${node.file}`,
    'A hostname is a guess we accept when there is no statement. Rename the Mac and every guard stops recognising it.',
  );
} else {
  fail(
    `This machine has not been told which node it is (it called itself "${node.name || '(nothing)'}").`,
    `echo ${nodeRoles.KNOWN_NODES[0]} > ${node.file}      ${dim(`# or: ${nodeRoles.KNOWN_NODES.slice(1).join(', ')}`)}`,
    'Until this exists, every exclusive job refuses out loud — which is correct, and is also a machine doing nothing.',
  );
}

// --- 2. toolchain -----------------------------------------------------------

heading('TOOLCHAIN — the commands a node needs');

// The pin is a property of the CODE, so it is read from the checkout this
// script lives in — not from MAIN_CHECKOUT. Reading it from the main checkout
// made this report CANNOT TELL whenever it ran from a worktree whose branch
// had not merged yet, which is a statement about git, not about the machine.
const pinnedNode = provision.pinnedNodeVersion();

for (const tool of provision.REQUIRED_TOOLS) {
  const probe = sh(tool.command, tool.versionArgs);

  if (!probe.ran) {
    const fix = tool.brew ? `brew install ${tool.brew}` : tool.fixHint;
    fail(`${tool.command} is not on this machine's PATH.`, fix, tool.why);
    continue;
  }

  const version = versionOf(probe.text) || '(version not reported)';

  if (!tool.pinned) {
    pass(`${tool.command} ${version}`, tool.why);
    continue;
  }

  // The pinned one. Two nodes running different Node versions is drift that
  // nobody chose, and it was already real between these two machines.
  if (!pinnedNode) {
    unknown(
      `${tool.command} ${version} — cannot confirm it is the pinned version.`,
      'This checkout has no readable .nvmrc, so there is nothing to compare against.',
      'Restore .nvmrc from git.',
    );
  } else if (version === pinnedNode) {
    pass(`${tool.command} ${version} — matches the pin in .nvmrc.`, tool.why);
  } else {
    fail(
      `${tool.command} is ${version}, but this repo pins ${pinnedNode}.`,
      'nvm install      (run it inside the checkout — it reads .nvmrc)',
      'Version drift between nodes is the class of thing NODES exists to stop. The two machines had already drifted apart without anyone choosing to.',
    );
  }
}

// The container runtime, which the two machines answer differently on purpose.
const runtimeInstalled = provision.CONTAINER_RUNTIME.candidates.filter((c) => has(c.command));
const dockerInfo = sh('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 20000 });

if (dockerInfo.ok && dockerInfo.text) {
  pass(`Container runtime is running (Docker server ${dockerInfo.text}).`, provision.CONTAINER_RUNTIME.why);
} else if (runtimeInstalled.length === 0) {
  fail(
    'No container runtime is installed.',
    provision.CONTAINER_RUNTIME.fixHint,
    provision.CONTAINER_RUNTIME.why,
  );
} else if (dockerInfo.ran) {
  // `docker` was FOUND and answered "no daemon". That is a real, knowable
  // state — the runtime is installed and stopped — and reporting it as
  // CANNOT TELL would be its own kind of dishonesty, the opposite one: hiding
  // a fact behind caution. `npm run doctor` calls this a failure too, and the
  // two must not disagree about the same machine.
  fail(
    'A container runtime is installed, but it is not running.',
    'colima start      (or open Docker Desktop and wait for the whale to settle)',
    provision.CONTAINER_RUNTIME.why,
  );
} else {
  // The genuinely ambiguous branch: something is installed by the look of the
  // filesystem, but `docker` was not even on this shell's PATH. That is the
  // exact shape of the 2026-08-21 false alarm — the Mini's runtime was healthy
  // and had always been; the probe ran over a non-interactive SSH session with
  // no /opt/homebrew/bin, so `colima` could not find `limactl`, and a day went
  // into a machine that was fine. A probe that cannot see is not a machine
  // that is broken.
  const names = runtimeInstalled.map((c) => c.command).join(', ');
  unknown(
    `A container runtime looks installed (${names}) but \`docker\` is not on this shell's PATH.`,
    'This is very likely the probe, not the machine — a non-interactive shell has no /opt/homebrew/bin. '
      + 'Re-run it in a login shell (ssh <host> \'zsh -lc "npm run doctor:node"\') before believing anything here.',
    'Check it in a login shell first; only then treat it as a real fault.',
  );
}

// --- 3. repos ---------------------------------------------------------------

heading('REPOS — the checkouts on this machine');

for (const repo of provision.requiredRepos()) {
  if (!repo.home) {
    unknown(`${repo.name}: cannot work out where it belongs.`, 'scripts/builder/taskRepo.js returned no home for it.');
    continue;
  }
  if (!fs.existsSync(path.join(repo.home, '.git'))) {
    // "Missing" and "somewhere else" are different problems with different
    // fixes, and cloning is only the right answer to the first one. Saying
    // "not checked out" about a repo that is plainly on the machine is the
    // kind of confidently wrong reading this whole file is written against.
    const elsewhere = provision.findRepoElsewhere(repo.name, repo.home);
    if (elsewhere) {
      fail(
        `${repo.name} is on this machine at ${elsewhere}, but the loops look for it at ${repo.home}.`,
        `Decide which: move it (mv ${elsewhere} ${repo.home}), or change its home in scripts/builder/taskRepo.js.`,
        `Until they agree, every Loop Queue ticket tagged repo:${repo.name} escalates on the one machine that HAS the repo. `
          + 'Not auto-corrected: where a repo lives is a decision, and moving it from inside an ops tool would change where the build lane works without a commit saying so.',
      );
    } else {
      fail(
        `${repo.name} is not checked out at ${repo.home}.`,
        `git clone ${repo.url} ${repo.home}`,
        `${repo.why} A Loop Queue ticket tagged repo:${repo.name} escalates on this machine until it is here.`,
      );
    }
    continue;
  }

  // Present. Is it current? A stale checkout is not a failure — it is a
  // machine quietly running last week's code, which is worth saying out loud.
  const head = sh('git', ['-C', repo.home, 'rev-parse', '--short', 'HEAD']);
  const fetched = sh('git', ['-C', repo.home, 'rev-list', '--count', 'HEAD..@{upstream}'], { timeoutMs: 10000 });

  if (!head.ok) {
    unknown(`${repo.name} is at ${repo.home} but git could not read it.`, head.error || 'git rev-parse failed.');
  } else if (!fetched.ok) {
    unknown(
      `${repo.name} at ${head.text} — cannot tell how far behind it is.`,
      'No upstream is configured, or the last fetch is too old to compare against. This reads only what is already on disk; it does not reach the network.',
      `git -C ${repo.home} fetch`,
    );
  } else {
    const behind = Number(fetched.text) || 0;
    if (behind === 0) {
      pass(`${repo.name} at ${head.text} — up to date with its last fetch.`);
    } else {
      fail(
        `${repo.name} is ${behind} commit${behind === 1 ? '' : 's'} behind (${head.text}).`,
        `git -C ${repo.home} pull`,
        repo.name === 'vault'
          ? 'A stale vault means this machine is reading old canon — the Mini was 30 commits behind on 2026-08-22 and was missing the very doctrine page it was working from.'
          : repo.why,
      );
    }
  }
}

// --- 4. config --------------------------------------------------------------

heading('CONFIG — settings that are per machine, not in git');

// The Claude memory folder, whose NAME is derived from the checkout path. This
// is the step the old document got wrong: copying `.claude` between machines
// puts the memory under the other machine's folder name, where nothing reads
// it, and an empty memory folder is a perfectly normal state so nothing errors.
const memoryDir = provision.claudeMemoryDir(MAIN_CHECKOUT);
if (fs.existsSync(memoryDir)) {
  const count = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md')).length;
  pass(`Claude memory folder exists for this checkout.`, `${memoryDir} (${count} file${count === 1 ? '' : 's'})`);
} else {
  fail(
    'This checkout has no Claude memory folder.',
    `mkdir -p ${memoryDir}`,
    'Its name is derived from the checkout path, so it differs on every machine and cannot be copied across. '
      + 'An empty memory folder looks exactly like a working one, which is why this is checked rather than assumed.',
  );
}

// Doppler scoping is per folder, and an unscoped checkout fails every ops
// command with a message about a missing project rather than a missing login.
const dopplerProject = sh('doppler', ['configure', 'get', 'project', '--plain'], { cwd: MAIN_CHECKOUT });
const dopplerConfig = sh('doppler', ['configure', 'get', 'config', '--plain'], { cwd: MAIN_CHECKOUT });

if (!dopplerProject.ran) {
  unknown('Cannot tell whether Doppler is scoped to this checkout.', 'The doppler command is not installed, so there is nothing to ask.');
} else if (!dopplerProject.ok || !dopplerProject.text) {
  fail(
    'Doppler is not scoped to this checkout.',
    'doppler setup --project starcaster --config dev --no-interactive',
    'Scoping is per folder. Without it every ops command fails, and the message names a missing project rather than a missing setup.',
  );
} else if (dopplerProject.text === 'starcaster') {
  pass(`Doppler scoped to ${dopplerProject.text}/${dopplerConfig.text || '(no config)'}.`);
} else {
  fail(
    `Doppler in this checkout is scoped to "${dopplerProject.text}", not starcaster.`,
    'doppler setup --project starcaster --config dev --no-interactive',
  );
}

// GitHub credentials. Never reads a token — only asks whether one WORKS, which
// is all that can be verified without handling the value (DOCTRINE §4.1).
//
// The test is the OUTCOME, not the mechanism, and that distinction cost this
// check a rewrite. The first version asked whether `gh auth setup-git` had been
// run, by parsing `gh auth status` prose. It reported this laptop as broken —
// and the laptop pushes perfectly, because it authenticates through macOS's
// osxkeychain helper instead. Two things were wrong with that: it tested one
// blessed route to a result rather than the result, and it parsed a sentence
// gh is free to reword. Telling a working machine to fix itself is exactly the
// failure this whole ticket exists to prevent, one level up.
//
// GIT_TERMINAL_PROMPT=0 is what makes this honest: without it git would sit
// waiting for a password and the probe would hang rather than answer. With it,
// a machine that cannot authenticate fails immediately and says so — which is
// also precisely how a scheduled job experiences the same fault.
const ghAuth = sh('gh', ['auth', 'status'], { timeoutMs: 20000 });
const gitReach = sh('git', ['ls-remote', provision.REPO_URLS.starcaster, 'HEAD'], {
  timeoutMs: 25000,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
});

if (gitReach.ok) {
  pass('git can reach GitHub without prompting for anything.');
} else if (!ghAuth.ran) {
  unknown(
    'git could not reach GitHub, and there is no gh to ask why.',
    'It may be the network rather than the credentials — this cannot tell the two apart on its own.',
    'brew install gh && gh auth login && gh auth setup-git',
  );
} else if (!ghAuth.ok) {
  fail(
    'GitHub is not authenticated on this machine.',
    'gh auth login && gh auth setup-git',
    'The second half matters as much as the first: without it a push waits for a password, and a scheduled job HANGS rather than failing — which looks like a job that is still working.',
  );
} else {
  fail(
    'GitHub is logged in, but git itself cannot authenticate without prompting.',
    'gh auth setup-git',
    'A push from a scheduled job will hang waiting for a password nobody is there to type. Any credential helper will do; gh just sets one up for you.',
  );
}

// --- 5. schedules -----------------------------------------------------------

heading('SCHEDULES — the jobs this node owns, and whether they are installed');

if (!knownNode) {
  unknown(
    'Cannot tell which jobs this machine should be running.',
    'It has no recognised identity (see IDENTITY above), and guessing which node it is would mean reporting on the wrong machine\'s jobs.',
  );
} else {
  const owned = provision.schedulesForNode(node.name);
  if (owned.length === 0) {
    note(`${node.name} owns no exclusive jobs.`);
  }
  for (const job of owned) {
    if (job.blocked) {
      // CANNOT DO YET. Loud, every run, and never a pass — the whole reason
      // this ticket did not ship a green-across-the-board provisioner.
      waiting(`${job.role}: CANNOT DO YET — no installer exists.`, job.blocked);
      if (job.blockedBy) note(`Blocked by ticket ${job.blockedBy}.`);
      continue;
    }
    if (job.manual) {
      pass(`${job.role}: no schedule, on purpose.`, job.why);
      continue;
    }
    const status = sh('bash', [path.join(MAIN_CHECKOUT, job.installer), '--status'], { timeoutMs: 20000 });
    if (!status.ran || !status.ok) {
      unknown(
        `${job.role}: cannot tell whether its schedule is installed.`,
        `${job.installer} --status did not answer (${status.error || 'no output'}).`,
      );
    } else if (/schedule:\s+INSTALLED/.test(status.text)) {
      const loaded = /loaded:\s+yes/.test(status.text);
      if (loaded) pass(`${job.role}: schedule installed and loaded.`, job.label);
      else fail(`${job.role}: schedule file exists but launchd has not loaded it.`, `${job.installer}`, job.label);
    } else {
      fail(`${job.role}: this machine owns it, but its schedule is not installed here.`, job.installer);
    }
  }

  // The mirror image, and the one nobody thinks to check: a schedule still
  // installed on a machine that no longer owns the job. It is harmless today
  // — every job re-checks ownership at run time and exits 0 on the wrong
  // machine — but a job waking every ten minutes to decide it is not its
  // business is a thing worth knowing about.
  for (const [role, spec] of Object.entries(provision.JOB_SCHEDULES)) {
    if (!spec.installer) continue;
    if (nodeRoles.roleOwner(role) === node.name) continue;
    const status = sh('bash', [path.join(MAIN_CHECKOUT, spec.installer), '--status'], { timeoutMs: 20000 });
    if (status.ok && /schedule:\s+INSTALLED/.test(status.text)) {
      fail(
        `${role} is installed here, but ${nodeRoles.roleOwner(role)} owns it.`,
        `${spec.installer} --uninstall`,
        'Harmless — it checks ownership at run time and exits — but a leftover schedule is how a cutover ends up half-done in both directions.',
      );
    }
  }
}

// --- 6. the steps that are Dane's -------------------------------------------

heading("WAITING ON DANE — steps no script may perform");

// These are not failures. They are the secrets boundary, stated out loud so
// that "the script did not do it" never reads as "the script forgot".
const unresolvedSecrets = [];
if (!gitReach.ok && !ghAuth.ok) unresolvedSecrets.push('gh-login');
if (dopplerProject.ran && (!dopplerProject.ok || !dopplerProject.text)) unresolvedSecrets.push('doppler-scope');

const dopplerMe = sh('doppler', ['me', '--json'], { timeoutMs: 15000 });
if (dopplerMe.ran && !dopplerMe.ok) unresolvedSecrets.push('doppler-login');

if (unresolvedSecrets.length === 0) {
  note('Nothing. Every credentialed step this can see is already done.');
} else {
  for (const id of unresolvedSecrets) {
    const step = provision.SECRET_STEPS.find((s) => s.id === id);
    if (step) out.push(...provision.promptBlock(step).split('\n').map((l) => `  ${l}`), '');
  }
}

// --- verdict ----------------------------------------------------------------

out.push('');
if (failures === 0 && cannotTell === 0) {
  out.push(bold(green('This machine is a valid node.')));
} else if (failures === 0) {
  out.push(bold(yellow(`No failures, but ${cannotTell} thing${cannotTell === 1 ? '' : 's'} could not be checked.`)));
  out.push(dim('Read the ???? lines. An unchecked thing is not a working thing.'));
} else {
  out.push(bold(red(`${failures} thing${failures === 1 ? '' : 's'} to fix${cannotTell ? `, and ${cannotTell} that could not be checked` : ''}.`)));
  out.push(dim('Work down the → lines. `npm run provision:node` fixes the ones a script is allowed to fix.'));
}
out.push('');

console.log(out.join('\n'));
process.exit(failures > 0 ? 1 : 0);
