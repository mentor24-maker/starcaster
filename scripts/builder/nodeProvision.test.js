'use strict';

/**
 * Tests for lib/nodeProvision.js — the inventory of what a node IS.
 *
 * The interesting assertions here are not "does the table have rows". They are
 * the invariants that, if they broke, would produce a provisioner that reports
 * success on a machine that does not work:
 *
 *   - a secret step must never become automatable by accident
 *   - a blocked schedule must stay blocked until its installer exists
 *   - the memory folder name must be DERIVED, because copying it is the
 *     specific mistake this slice exists to stop
 *   - the repo homes must come from the same place the loops read them from
 *
 * This is a NODE test (scripts/builder/*.test.js), not a vitest one, on
 * purpose: it requires lib/nodeProvision.js, which requires
 * scripts/builder/taskRepo.js. Nothing here reaches a generated lib, but the
 * node suite is where server-side lib tests live (CLAUDE.md landmine 14).
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');

const provision = require('../../lib/nodeProvision.js');
const nodeRoles = require('../../lib/nodeRoles.js');
const taskRepo = require('./taskRepo.js');

// --- the pinned Node version ------------------------------------------------

test('pinnedNodeVersion reads .nvmrc and strips the v', () => {
  const version = provision.pinnedNodeVersion();
  assert.match(version, /^\d+\.\d+\.\d+$/, 'the repo must pin an exact Node version');
});

test('pinnedNodeVersion answers null when there is no .nvmrc — never a guess', () => {
  // A missing pin has to be CANNOT TELL, not "whatever is running is fine".
  // Answering the running version here would make every machine self-certify.
  assert.strictEqual(provision.pinnedNodeVersion(os.tmpdir()), null);
});

test('pinnedNodeVersion rejects a malformed .nvmrc rather than trusting it', () => {
  const fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvmrc-'));
  fs.writeFileSync(path.join(dir, '.nvmrc'), 'lts/hydrogen\n');
  assert.strictEqual(provision.pinnedNodeVersion(dir), null);
});

// --- the toolchain ----------------------------------------------------------

test('every required tool has a fix — either a brew formula or a hint', () => {
  // A tool with neither is a FAIL the operator can do nothing about, which is
  // the same as no check at all.
  for (const tool of provision.REQUIRED_TOOLS) {
    const hasFix = Boolean(tool.brew) || Boolean(tool.fixHint);
    assert.ok(hasFix, `${tool.id} has no brew formula and no fixHint`);
    assert.ok(tool.why, `${tool.id} does not say why a node needs it`);
  }
});

test('a manual tool never also carries a brew formula', () => {
  // `manual` means "a script must not install this". A row carrying both would
  // let the provisioner install something that was deliberately reserved.
  for (const tool of provision.REQUIRED_TOOLS) {
    if (tool.manual) assert.ok(!tool.brew, `${tool.id} is manual but also has brew: ${tool.brew}`);
  }
});

test('Homebrew and the Claude CLI are manual — they pipe a URL into a shell', () => {
  for (const id of ['homebrew', 'claude']) {
    const tool = provision.REQUIRED_TOOLS.find((t) => t.id === id);
    assert.ok(tool, `${id} is missing from REQUIRED_TOOLS`);
    assert.strictEqual(tool.manual, true, `${id} must not be installed by an unattended pass`);
  }
});

test('exactly one tool is version-pinned, and it is node', () => {
  const pinned = provision.REQUIRED_TOOLS.filter((t) => t.pinned).map((t) => t.id);
  assert.deepStrictEqual(pinned, ['node']);
});

test('the container runtime is not a required tool — the two nodes answer it differently', () => {
  // Docker Desktop on the laptop, Colima on the headless Mini. Requiring a
  // specific one would fail a machine that works.
  const ids = provision.REQUIRED_TOOLS.map((t) => t.id);
  assert.ok(!ids.includes('colima'), 'colima must not be a hard requirement');
  assert.ok(provision.CONTAINER_RUNTIME.candidates.length > 1, 'more than one runtime must be acceptable');
});

// --- repos ------------------------------------------------------------------

test('repo homes come from taskRepo, not from a second copy of the answer', () => {
  // If this table invented its own homes, a machine could be "fully
  // provisioned" by the script and still escalate every ticket for a repo it
  // demonstrably has.
  for (const repo of provision.requiredRepos()) {
    assert.strictEqual(repo.home, taskRepo.repoHome(repo.name), `${repo.name} home disagrees with taskRepo`);
  }
});

test('every repo the loops know about is provisioned', () => {
  const provisioned = provision.requiredRepos().map((r) => r.name).sort();
  const known = Object.keys(taskRepo.KNOWN_REPOS).sort();
  assert.deepStrictEqual(provisioned, known,
    'a repo the loops can be asked to build in, but which nothing provisions, is a ticket that escalates forever');
});

test('every repo has a clone URL and a reason', () => {
  for (const repo of provision.requiredRepos()) {
    assert.match(repo.url, /^https:\/\/github\.com\/.+\.git$/, `${repo.name} has no usable clone URL`);
    assert.ok(repo.why, `${repo.name} does not say why a node carries it`);
  }
});

// --- the derived memory folder ----------------------------------------------

test('claudeProjectSlug turns every separator into a dash', () => {
  assert.strictEqual(provision.claudeProjectSlug('/a/b/starcaster'), '-a-b-starcaster');
});

test('a worktree gets its own slug, distinct from the main checkout', () => {
  // `.claude` contributes a second dash, which is why a worktree's folder name
  // has a double dash in it. Asserted because the doubling looks like a typo
  // and would be "tidied away" by someone reading it casually.
  const main = provision.claudeProjectSlug('/a/b/starcaster');
  const tree = provision.claudeProjectSlug('/a/b/starcaster/.claude/worktrees/x');
  assert.notStrictEqual(main, tree);
  assert.strictEqual(tree, '-a-b-starcaster--claude-worktrees-x');
});

test('claudeMemoryDir is derived from the path, so it differs per machine', () => {
  // This is the step the old setup document got wrong. Copying `.claude`
  // between Macs puts the memory under the OTHER machine's folder name, where
  // nothing reads it — and an empty memory folder looks exactly like a working
  // one, so nothing errors.
  // Fake roots, deliberately not shaped like a real home folder: writing
  // "/Users/<name>/" into a committed file is what check_machine_paths.cjs
  // blocks, and it blocked this very line on first commit (NODES P1).
  const a = provision.claudeMemoryDir('/one/repo', '/one');
  const b = provision.claudeMemoryDir('/two/repo', '/two');
  assert.notStrictEqual(a, b);
  assert.ok(a.endsWith(path.join('memory')), 'must point at the memory folder itself');
  assert.ok(a.includes(path.join('.claude', 'projects')));
});

// --- the secrets boundary ---------------------------------------------------

test('every secret step has a command and a reason a non-programmer can act on', () => {
  for (const step of provision.SECRET_STEPS) {
    assert.ok(step.title, `${step.id} has no title`);
    assert.ok(step.command, `${step.id} has no command`);
    assert.ok(step.why && step.why.length > 30, `${step.id} does not explain what breaks without it`);
  }
});

test('the four credentialed steps are all present', () => {
  // Named individually rather than counted, so deleting one fails loudly
  // instead of being absorbed by a length assertion.
  const ids = provision.SECRET_STEPS.map((s) => s.id).sort();
  assert.deepStrictEqual(ids, ['claude-login', 'doppler-login', 'doppler-scope', 'gh-login']);
});

test('promptBlock renders the recognisable block, with the command inside it', () => {
  const step = provision.SECRET_STEPS.find((s) => s.id === 'gh-login');
  const block = provision.promptBlock(step);
  assert.ok(block.startsWith('::: PROMPT FOR DANE :::'), 'the operator learns one shape; it must not drift');
  assert.ok(block.trimEnd().endsWith(':::::::::::::::::::::::'));
  assert.ok(block.includes(step.command));
  assert.ok(block.includes(step.why));
});

test('promptBlock is the only renderer — both callers get identical bytes', () => {
  // The shell script shells out to this same function rather than formatting
  // its own block. Rendering twice must be stable.
  const step = provision.SECRET_STEPS[0];
  assert.strictEqual(provision.promptBlock(step), provision.promptBlock(step));
});

// --- schedules --------------------------------------------------------------

test('every role in the registry has a schedule entry', () => {
  // A role with no entry would be silently skipped by the provisioner — a job
  // nobody installs, on a machine that reports itself fully provisioned.
  for (const role of Object.keys(nodeRoles.ROLES)) {
    assert.ok(provision.JOB_SCHEDULES[role], `${role} has no entry in JOB_SCHEDULES`);
  }
});

test('every schedule entry is exactly one of: installer, manual, blocked', () => {
  for (const [role, spec] of Object.entries(provision.JOB_SCHEDULES)) {
    const kinds = ['installer', 'manual', 'blocked'].filter((k) => spec[k]);
    assert.strictEqual(kinds.length, 1, `${role} declares ${kinds.length} kinds (${kinds.join(', ')}); it must declare one`);
  }
});

test('a blocked schedule says WHY, so CANNOT DO YET is never mistaken for a skip', () => {
  for (const [role, spec] of Object.entries(provision.JOB_SCHEDULES)) {
    if (!spec.blocked) continue;
    assert.ok(spec.blocked.length > 40, `${role}'s blocked reason is too thin to act on`);
  }
});

test('pulse-pipelines stays blocked, and names the ticket that unblocks it', () => {
  // The load-bearing one. If this row ever quietly becomes an installer
  // before Slice B exists, the provisioner starts reporting a green check on a
  // machine that runs no scheduled pipelines at all — the precise failure the
  // NODES plan was written against.
  const spec = provision.JOB_SCHEDULES['pulse-pipelines'];
  assert.ok(spec.blocked, 'pulse-pipelines must report CANNOT DO YET until Slice B lands');
  assert.strictEqual(spec.blockedBy, '86bbh9kh2');
});

test('db-refresh has no schedule on purpose, and says so', () => {
  const spec = provision.JOB_SCHEDULES['db-refresh'];
  assert.strictEqual(spec.manual, true);
  assert.ok(/disk IO|2026-08-17/.test(spec.why), 'the reason it is unscheduled must survive in the table');
});

test('schedulesForNode returns only the jobs that machine owns', () => {
  for (const machine of nodeRoles.KNOWN_NODES) {
    const roles = provision.schedulesForNode(machine).map((s) => s.role);
    assert.deepStrictEqual(roles.sort(), nodeRoles.rolesOwnedBy(machine).sort(),
      `${machine} would be provisioned with the wrong set of jobs`);
    for (const role of roles) {
      assert.strictEqual(nodeRoles.roleOwner(role), machine, `${role} is not owned by ${machine}`);
    }
  }
});

test('schedulesForNode on an unknown machine returns nothing at all', () => {
  // Not "everything" and not a crash. An unidentified machine must be told it
  // cannot know, which is doctor_node's job — this must not hand it a list.
  assert.deepStrictEqual(provision.schedulesForNode('some-laptop'), []);
});

test('an unregistered role would report blocked, not silently vanish', () => {
  // schedulesForNode fills in a blocked row for anything missing from
  // JOB_SCHEDULES, so adding a role to nodeRoles.js without adding it here
  // produces a loud CANNOT DO YET rather than a job nobody installs.
  const spec = provision.JOB_SCHEDULES;
  const missing = { role: 'not-registered', ...(spec['not-registered'] || { blocked: 'x' }) };
  assert.ok(missing.blocked, 'the fallback for an unregistered role must be blocked');
});

// --- no machine is named ----------------------------------------------------

test('nodeProvision.js names no machine and no home folder', () => {
  // NODES principle P1, enforced repo-wide by check_machine_paths.cjs — but
  // asserted here too, because this is the file most likely to acquire one.
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'nodeProvision.js'), 'utf8');
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\/(Users|home)\/[A-Za-z0-9._-]+\//.test(withoutComments),
    'a home-folder path has been written into the inventory; derive it instead');
});

// --- a repo that is on the machine, but not where the loops look ------------

test('findRepoElsewhere finds a checkout sitting in another known location', () => {
  // The real finding that produced this helper: pulse is on the MacBook, but
  // not at the home taskRepo derives, so every repo:pulse ticket escalates on
  // the one machine that has it.
  const seen = [];
  const found = provision.findRepoElsewhere('pulse', '/expected/pulse', {
    homedir: '/home-dir',
    exists: (p) => { seen.push(p); return p === path.join('/home-dir', 'pulse', '.git'); },
  });
  assert.strictEqual(found, path.join('/home-dir', 'pulse'));
});

test('findRepoElsewhere never answers with the expected home itself', () => {
  // Otherwise a repo that IS in the right place would be reported as "found
  // somewhere else", and the caller would print a move command that is a no-op.
  const found = provision.findRepoElsewhere('pulse', path.join('/home-dir', 'pulse'), {
    homedir: '/home-dir',
    exists: () => true,
  });
  assert.notStrictEqual(found, path.join('/home-dir', 'pulse'));
});

test('findRepoElsewhere answers null when the repo is genuinely absent', () => {
  // Null is what separates "clone it" from "decide where it lives". Answering
  // a path here would make the provisioner refuse to clone a missing repo.
  assert.strictEqual(
    provision.findRepoElsewhere('pulse', '/expected/pulse', { homedir: '/home-dir', exists: () => false }),
    null,
  );
});

test('findRepoElsewhere requires a .git, not just a folder of the right name', () => {
  // An empty ~/pulse directory is not a checkout, and treating it as one would
  // block the clone that would have fixed the machine.
  assert.strictEqual(
    provision.findRepoElsewhere('pulse', '/expected/pulse', {
      homedir: '/home-dir',
      exists: (p) => !p.endsWith('.git'),
    }),
    null,
  );
});

// --- the provisioner refuses to mistake a crash for "nothing to do" ---------

test('provision_node.sh exits non-zero when it cannot read the inventory', () => {
  // The regression this locks in was found by break-testing and was inside the
  // guard itself. `ask_inventory` originally called `exit 1`, which does
  // nothing useful: every caller invokes it inside `$( )`, so the exit killed
  // the command substitution's subshell and the script carried on with an
  // empty variable. A run against a folder with no inventory printed four
  // stack traces and still finished "0 passed ... this was a dry run",
  // exit 0 — the silent green this whole script exists to prevent.
  const fs = require('node:fs');
  const { spawnSync } = require('node:child_process');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(
    path.join(__dirname, '..', 'provision_node.sh'),
    path.join(dir, 'scripts', 'provision_node.sh'),
  );

  const run = spawnSync('bash', [path.join(dir, 'scripts', 'provision_node.sh')], { encoding: 'utf8' });

  assert.strictEqual(run.status, 1, 'an unreadable inventory must stop the run, not be read as an empty one');
  assert.match(run.stderr, /Refusing to continue/, 'it must say why it stopped');
  assert.ok(!/passed,.*fixed/.test(run.stdout), 'it must not print a tally it did not earn');
});
