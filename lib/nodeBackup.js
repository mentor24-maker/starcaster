'use strict';

/**
 * What must survive a machine dying — the whole inventory, in one place.
 *
 * WHY THIS EXISTS (ticket 86bc1c1zb)
 * On 2026-09-15 the Mac Mini had never been backed up. `tmutil
 * destinationinfo` answered "No destinations configured" and no drive had ever
 * been attached, on the machine that runs the bus relay, both loop lanes, the
 * pipeline pulse, the weekly report, the YouTube media worker and the two
 * Pulse pipelines. The operator was about to leave it alone in an apartment
 * for two weeks. The recovery plan, had it died, was "remember what was on
 * it", from another timezone.
 *
 * THE INSIGHT THAT MAKES THIS SMALL
 * Almost nothing on a node needs backing up, because almost everything on a
 * node is DERIVED:
 *
 *   the repos      come from GitHub
 *   the secrets    come from Doppler
 *   the data       comes from Supabase
 *   the toolchain  comes from `npm run provision:node`, which already rebuilds
 *                  it from the committed inventory in lib/nodeProvision.js
 *
 * So this file is not "back up the Mac". It is the much shorter list of things
 * that exist on exactly one disk and nowhere else, and it is short enough to
 * read — which is the property that makes it auditable. A backup you cannot
 * read the manifest of is a backup you are trusting rather than checking.
 *
 * THE SECRETS BOUNDARY IS A DESIGN CHOICE, NOT A LIMITATION
 * No credential value enters this archive. Not the ssh key, not the Doppler
 * token, not the GitHub token, not a .env.local (docs/DOCTRINE.md §4.1, vault
 * OPERATIONS.md SOP 6). That is what lets the archive live in an ordinary
 * private GitHub repo that any replacement Mac can fetch with one login,
 * instead of in a vault that needs a credential to open — and needing a
 * credential to open your disaster recovery, on the day of the disaster, is a
 * plan with a loop in it.
 *
 * The cost of that choice is four logins somebody types on the new machine.
 * `lib/nodeProvision.js` already prints exactly those four as PROMPT FOR DANE
 * blocks, so the cost was already being paid; EXCLUDED below is the same list,
 * stated from this side, so a reader of the manifest sees what is missing and
 * why rather than discovering it later.
 *
 * NOTHING HERE TOUCHES THE NETWORK and nothing here writes. Every function is
 * a pure decision over data the caller read, so `node --test` drives every
 * branch with no machine, no clock and no token. The IO lives in
 * `scripts/backup_node.mjs` and `scripts/restore_node.mjs`.
 *
 * NO MACHINE IS NAMED HERE (NODES P1). Every path derives from os.homedir().
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const nodeRoles = require('./nodeRoles.js');

/** This repo's root, derived — not the worktree's, when one is in play. */
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * The private GitHub repo the archives land in.
 *
 * A repo rather than a Drive folder or an object store, chosen by the operator
 * on 2026-09-15, and the reasons are worth keeping because they are the
 * requirements:
 *
 *   - Every night's copy is kept, and diffable. "What changed on that machine
 *     the week it broke" is a question a tarball cannot answer.
 *   - It is reachable from a brand-new Mac with `gh auth login` and nothing
 *     else. The alternatives all need a credential that lived on the machine
 *     that just died.
 *   - `gh` is already installed and authenticated on every node, because
 *     lib/nodeProvision.js requires it. No new dependency, no new thing to rot.
 *
 * It is PRIVATE, and the secret scan below is what keeps that from being the
 * only thing standing between a token and a public mirror of it.
 */
const BACKUP_REPO = 'mentor24-maker/alphire-node-backup';

/** Where a machine's own archives sit inside that repo. One folder per node. */
function nodeFolder(node) {
  return path.posix.join('nodes', node);
}

// --- what gets captured -----------------------------------------------------

/**
 * THE INVENTORY.
 *
 * Each entry says what it is, where it lives (derived at call time), and — the
 * field that earns its place — WHY it cannot simply be rebuilt. An item whose
 * `why` reads "in case" does not belong here; it belongs in GitHub, in Doppler
 * or in Supabase, and putting it here instead is how a backup grows until
 * nobody reads its manifest.
 *
 * `kind`:
 *   file    one file
 *   dir     a folder, copied whole
 *   glob    files in a folder matching a pattern
 *   derived produced by running something, not copied (see backup_node.mjs)
 *
 * `optional: true` means "absent is a normal reading on some machines" — the
 * MacBook has no launchd jobs for roles it does not own, and that is correct,
 * not a failure. An absent NON-optional item is reported as a gap in the
 * manifest, never silently skipped: a backup that omits something without
 * saying so is worse than one that fails, because it looks complete.
 */
const CAPTURE = [
  {
    id: 'identity',
    title: 'The machine identity file',
    kind: 'file',
    at: (home) => path.join(home, '.alphire-node'),
    why:
      'One line naming which node this is. Every ownership guard in the system reads it, '
      + 'and lib/nodeRoles.js deliberately refuses to guess from the hostname — so a '
      + 'replacement Mac without this file runs no jobs at all and says so out loud. '
      + 'It is one line, and it is the single most load-bearing line on the disk.',
  },
  {
    id: 'launch-agents',
    title: 'The scheduled job definitions',
    kind: 'glob',
    at: (home) => path.join(home, 'Library', 'LaunchAgents'),
    match: /^com\.(starcaster|danechristensen\.pulse)\./,
    matchText: 'a job file whose name starts with com.starcaster. or com.danechristensen.pulse.',
    optional: true,
    why:
      'The nine plists that make this machine actually DO anything. Several are generated '
      + 'for this specific machine — absolute paths, its Node version, its checkout — so '
      + 'they exist in no repo. A rebuilt machine with none of these passes every check '
      + 'in doctor:node except the schedules one and runs nothing, which is the exact '
      + 'failure NODES was written against: a green board on a machine doing no work.',
  },
  {
    id: 'heartbeat',
    title: 'The heartbeat and reboot-test records',
    kind: 'dir',
    at: (home) => path.join(home, 'Library', 'Application Support', 'starcaster', 'heartbeat'),
    // The `pulse` subfolder is ~3.6 MB of alarm de-duplication stamps — state
    // whose whole purpose is to stop a message being posted twice, worth
    // nothing once the machine it throttled is gone. Excluding it keeps the
    // archive small enough that a person will actually open the manifest.
    skipEntries: ['pulse'],
    optional: true,
    why:
      'The only record of when each job last actually worked on this machine. '
      + 'lib/nodeHeartbeat.js reads these to answer "has a job stopped beating?" and '
      + 'lib/nodeRebootTest.js reads role-verification.json to answer "did the roles come '
      + 'back after the last restart?". Lose them and both questions answer CANNOT TELL '
      + 'until a full cycle has run again — on the exact morning you need them.',
  },
  {
    id: 'loop-logs',
    title: 'The loops’ own logs (recent)',
    kind: 'dir',
    at: (home) => path.join(home, 'loop-logs'),
    maxAgeDays: 14,
    // ONLY THE TAIL OF A BIG FILE, and this is the one number in the inventory
    // that is about the BACKUP REPO rather than about the machine.
    //
    // `loop-build.log` and `loop-review.log` are single files that are appended
    // to and never rotated — 2.8 MB and 2.0 MB when this was measured. A nightly
    // backup that copies them whole stores a brand-new 5 MB blob every night,
    // because a file with one byte added is a different file to git. That is
    // about 1.8 GB a year, growing, in a repo whose whole job is to be cloned
    // quickly onto a replacement Mac by somebody who is not at home.
    //
    // A backup that makes the recovery slower every day is working against
    // itself, and the value in these logs is entirely in the recent end: check
    // A1 of `npm run pulse` reads the last few passes, not the last few months.
    // So a file over the cap is captured as its last 256 KB, with a header
    // saying so — see `tailWithNotice`. It must never look like a whole file.
    tailBytes: 256 * 1024,
    optional: true,
    why:
      'Check A1 of `npm run pulse` reads the build loop’s log, and it is the only '
      + 'surface that can show a loop firing and achieving nothing — the failure that '
      + 'cost a morning on 2026-08-31. Fourteen days rather than all of it: the value is '
      + 'in diagnosing what a machine was doing lately, and it decays fast.',
  },
  {
    id: 'claude-memory',
    title: 'The Claude Code memory folders',
    kind: 'claude-memory',
    at: (home) => path.join(home, '.claude', 'projects'),
    optional: true,
    why:
      'What every agent session on this machine has learned about how the operator wants '
      + 'work done. Not in any repo, and NOT COPYABLE BETWEEN MACS by hand: the folder '
      + 'name is derived from the checkout’s absolute path, so a naive copy lands it '
      + 'where nothing will ever read it — and an empty memory folder looks exactly like a '
      + 'working one. The restore side re-derives the name rather than trusting it.',
  },
  {
    id: 'shell-config',
    title: 'The shell and git configuration',
    kind: 'files',
    at: (home) => [path.join(home, '.zshrc'), path.join(home, '.gitconfig')],
    optional: true,
    scanForSecrets: true,
    why:
      'PATH order, nvm setup, the git identity commits are attributed to. Small, '
      + 'hand-edited over months, and reconstructing it is an afternoon of "why does this '
      + 'command not resolve". Both are scanned before capture, because an exported token '
      + 'in a .zshrc is the single likeliest way a secret would reach this archive.',
  },
  {
    id: 'local-bin',
    title: 'Hand-written scripts in ~/bin',
    kind: 'dir',
    at: (home) => path.join(home, 'bin'),
    optional: true,
    why:
      'Anything here is by definition uncommitted — that is what puts it in a home folder '
      + 'rather than a repo. An uncommitted file loses its behaviour the moment its '
      + 'machine does, and the system has already been bitten by exactly that: the bus '
      + 'relay’s failure alert lived in an uncommitted wrapper, and when the job moved '
      + 'machines the alert did not come with it. Nothing announced that.',
  },
  {
    id: 'loose-backups',
    title: 'Loose backup files sitting in the home folder',
    kind: 'glob',
    at: (home) => home,
    match: /(backup|snapshot).*\.json$/i,
    matchText: 'a .json file with "backup" or "snapshot" in its name',
    optional: true,
    why:
      'These are the ones that hurt. On this machine that is '
      + '`delray-orphan-snapshots-backup-2026-09-02.json`, which the bulk-import notes '
      + 'record as THE ONLY COPY of the Delray orphan snapshots — a client’s content, '
      + 'in one file, in a home folder, on a machine with no backup. A file matching this '
      + 'shape is somebody’s "I had better keep this", and keeping it is the job.',
  },
  {
    id: 'git-bundles',
    title: 'Commits that exist on this disk and nowhere else',
    kind: 'derived',
    why:
      'The real data-loss risk, and the one nobody looks for. On 2026-09-15 the branch '
      + '`studio-drive-watcher` had eight commits on the Mini that had never been pushed. '
      + 'A git bundle is a complete, self-contained copy of those commits that restores '
      + 'with `git fetch <file>` — so the work survives the disk. Every checkout is '
      + 'swept, and a branch fully represented on origin is skipped and said to be.',
  },
  {
    id: 'machine-report',
    title: 'A written description of the machine itself',
    kind: 'derived',
    why:
      'Not files — answers. The Node version, the installed Homebrew packages, which '
      + 'schedules launchd actually had loaded, and the full `doctor:node` report. This is '
      + 'what turns "rebuild the Mini" from an act of memory into a comparison: stand the '
      + 'new machine up, run doctor:node, and diff it against what the old one said on its '
      + 'last good day.',
  },
];

// --- what is deliberately NOT captured --------------------------------------

/**
 * The secrets boundary, as data — the mirror image of nodeProvision.SECRET_STEPS.
 *
 * Every entry is a thing that genuinely lives only on the machine and is
 * genuinely not in this archive. Stating them here, and printing them in the
 * manifest, is the whole difference between a backup with a known gap and a
 * backup with a surprise in it. The `instead` line is what somebody types on
 * the new machine, and it is the same command nodeProvision already prompts.
 */
const EXCLUDED = [
  {
    id: 'ssh-keys',
    what: 'The ssh private keys (~/.ssh)',
    instead: 'ssh-keygen -t ed25519  →  add the new public key to GitHub, and to the other Mac',
    why: 'A private key in a git repo is a private key that has left the machine. Keys are cheap to replace and catastrophic to copy around; this one is not a close call.',
  },
  {
    id: 'doppler',
    what: 'The Doppler session token (~/.doppler)',
    instead: 'doppler login   then   doppler setup --project starcaster --config dev',
    why: 'Every secret the repo reads comes through Doppler. The token is the key to all of them, so it is typed by Dane on the new machine and never carried.',
  },
  {
    id: 'gh-auth',
    what: 'The GitHub credential (~/.config/gh and the macOS keychain)',
    instead: 'gh auth login && gh auth setup-git',
    why: 'It is also what fetches this very archive, so it has to exist before a restore can start. Backing it up inside the thing it unlocks would be a loop.',
  },
  {
    id: 'claude-signin',
    what: 'The Claude Code sign-in',
    instead: 'claude   then sign in when prompted',
    why: 'A browser login. No file to copy, and the loops cannot start without it.',
  },
  {
    id: 'env-local',
    what: 'The .env.local files in each checkout',
    instead: 'npm run env:local   in every checkout and worktree',
    why: 'They hold live database credentials. They are also fully regenerated by that one command from the local Supabase defaults, so copying them buys nothing and risks everything.',
  },
  {
    id: 'service-env',
    what: 'The YouTube media worker’s environment file',
    instead: 'Re-create it from Doppler once the worker is being stood back up',
    why: 'It sits in Application Support rather than a checkout, which makes it easy to sweep up by accident. It is named here so that it is not.',
  },
];

// --- the secret scan --------------------------------------------------------

/**
 * The shapes of a credential, as patterns.
 *
 * This is a BACKSTOP, not the mechanism. The mechanism is that the inventory
 * above simply does not list any file that holds a secret. The scan exists
 * because inventories drift — a `.zshrc` picks up an `export` line, a loose
 * JSON in the home folder turns out to have an API response in it — and the
 * drift would be silent and permanent, in a repo, with history.
 *
 * It errs toward false positives on purpose. A false positive costs one line
 * in the manifest saying a file was held back and why, which a person reads
 * and resolves. A false negative costs a token in a git history forever, and
 * git history is the one place "just delete it" does not work.
 */
const SECRET_PATTERNS = [
  { name: 'a private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'an Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: 'a GitHub token', re: /\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { name: 'a Doppler token', re: /\bdp\.(pt|st|sa|scim)\.[A-Za-z0-9]{8,}/ },
  { name: 'a JSON web token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: 'a Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'a Google API key', re: /\bAIza[A-Za-z0-9_-]{30,}/ },
  { name: 'a Stripe key', re: /\b[rs]k_(live|test)_[A-Za-z0-9]{16,}/ },
  { name: 'an OpenAI key', re: /\bsk-(?!ant-)[A-Za-z0-9]{32,}/ },
  {
    name: 'a named secret being assigned a value',
    // The generic catch: any NAME that reads like a credential, followed by an
    // assignment and something long enough to be one. Three things narrow it,
    // and all three were added because the broad version fired on real files:
    //
    //   - the value must be 12+ characters with no spaces, so a bare
    //     `SUPABASE_SERVICE_KEY=` — which is what a .env.example and most prose
    //     look like — does not fire;
    //   - a value that is a REFERENCE rather than a literal is excluded.
    //     `SESSION_SECRET: process.env.SESSION_SECRET` is the safest possible
    //     line and the first version flagged it, which is exactly how a scan
    //     teaches people to route around it;
    //   - and a shell or template interpolation ($VAR, ${VAR}, {{VAR}}) is the
    //     same case wearing different syntax.
    re: /\b[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_KEY|API_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[:=]\s*["'`]?(?!process\.env\b|import\.meta\.env\b|Deno\.env\b|os\.environ\b|ENV\[|\$|\{)[^\s"'`]{12,}/,
  },
];

/**
 * Does this content look like it contains a credential?
 *
 * Returns the list of matches (empty means clean) rather than a boolean,
 * because the caller has to be able to SAY WHICH — "a file was held back" with
 * no reason is the shape of message that gets ignored, and then worked around.
 */
function scanForSecrets(text) {
  if (typeof text !== 'string' || text === '') return [];
  const found = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      found.push({
        name,
        // The matched text is never reproduced — not into a manifest, not into
        // a log, not into a terminal an agent session can read. Position only.
        at: m.index,
      });
    }
  }
  return found;
}

/**
 * The last `limit` bytes of a file's text, carrying a header that says so.
 *
 * THE HEADER IS THE POINT. A truncated log that looks like a whole log is a
 * reader being quietly misled about what they are holding — they scroll to the
 * top, see a line mid-sentence, and conclude the job started there. That is the
 * same defect class as a check that cannot run reporting a pass: the output has
 * to state its own limits (docs/DOCTRINE.md §3.11).
 *
 * The cut is moved forward to the next newline so the first surviving line is a
 * whole one, which costs at most one line and removes the "why does this start
 * halfway through a word" question entirely.
 */
function tailWithNotice(text, limit, { name = 'this file' } = {}) {
  if (typeof text !== 'string') return { text: '', truncated: false };
  const bytes = Buffer.byteLength(text, 'utf8');
  if (!Number.isFinite(limit) || limit <= 0 || bytes <= limit) {
    return { text, truncated: false, originalBytes: bytes };
  }
  let cut = Buffer.from(text, 'utf8').subarray(bytes - limit).toString('utf8');
  const nl = cut.indexOf('\n');
  if (nl >= 0 && nl < cut.length - 1) cut = cut.slice(nl + 1);
  const header = `*** THIS IS THE LAST ${humanBytes(limit)} OF ${name}, NOT THE WHOLE FILE. ***\n`
    + `*** The original was ${humanBytes(bytes)}. Older entries were not backed up: these logs are\n`
    + `*** appended to and never rotated, so copying them whole every night would grow the backup\n`
    + `*** repo by gigabytes a year and make the rebuild it exists for slower every day.\n`
    + '***\n';
  return { text: header + cut, truncated: true, originalBytes: bytes };
}

// --- when the last backup was taken, and whether that is good enough --------

/**
 * Where the local stamp lives. Beside the heartbeat stamps, and for the same
 * reason they are there: it is a fact about the MACHINE, not about the code, so
 * a worktree must not get its own idea of it.
 */
function backupStampFile(homedir = os.homedir()) {
  return path.join(homedir, 'Library', 'Application Support', 'starcaster', 'backup', 'last-backup.json');
}

/**
 * How stale is too stale.
 *
 * Three days rather than one. The backup runs nightly, so one missed run is
 * ordinary — a machine asleep, a network blip, a ClickUp reserve — and an alarm
 * that fires on the ordinary case is an alarm that gets filtered, which is the
 * failure lib/nodeHeartbeat.js spends four hundred lines avoiding. Three
 * consecutive misses is not ordinary.
 */
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * THREE STATES, NEVER TWO (docs/DOCTRINE.md §3.11).
 *
 * The state that matters is the third one. A machine whose stamp cannot be read
 * is not a machine that is fine, and it is not a machine that is failing
 * either — it is a machine nobody can answer the question about, and saying so
 * is the only honest reading. The version of this that returned a boolean
 * reported an unreadable stamp as "not backed up", which is a false alarm, and
 * the version before that reported it as fresh, which is very much worse.
 */
function freshnessReport({ stamp, now = Date.now(), node = null, staleAfterMs = STALE_AFTER_MS } = {}) {
  if (node && !nodeRoles.KNOWN_NODES.includes(node)) {
    return {
      state: 'CANNOT TELL',
      text: `this machine calls itself "${node}", which is not a node this system knows — `
        + 'so a stamp sitting here is most likely a folder copied from another Mac, and '
        + 'grading it would be grading somebody else’s backup.',
      fix: 'Name the machine: echo <macbook-pro|mac-mini> > ~/.alphire-node',
    };
  }
  if (!stamp) {
    return {
      state: 'NEVER',
      text: 'no backup has ever been recorded on this machine.',
      fix: 'npm run backup:node',
    };
  }
  const at = Date.parse(stamp.at || '');
  if (!Number.isFinite(at)) {
    return {
      state: 'CANNOT TELL',
      text: 'a backup stamp exists but carries no readable time, so how old it is cannot be established.',
      fix: 'npm run backup:node',
    };
  }
  // A stamp from a DIFFERENT machine is the copied-folder case, and it gets the
  // same refusal lib/nodeRebootTest.js gives a copied verification record — an
  // unattributed one included, because a record that cannot say whose it is has
  // less claim on this machine than one naming the wrong one.
  if (node && stamp.node !== node) {
    return {
      state: 'CANNOT TELL',
      text: stamp.node
        ? `the stamp here was written by "${stamp.node}", not by this machine — it says nothing about whether THIS machine is backed up.`
        : 'the stamp here does not say which machine wrote it, so it cannot be read as this machine’s.',
      fix: 'npm run backup:node',
    };
  }
  const ageMs = now - at;
  if (ageMs > staleAfterMs) {
    return {
      state: 'STALE',
      text: `the last backup was ${ageText(ageMs)} ago, which is past the ${Math.round(staleAfterMs / 86400000)}-day threshold.`,
      fix: 'npm run backup:node',
      ageMs,
    };
  }
  return {
    state: 'FRESH',
    text: `last backed up ${ageText(ageMs)} ago (${stamp.items || 0} items, ${stamp.bytes ? humanBytes(stamp.bytes) : 'size not recorded'}).`,
    ageMs,
  };
}

function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'an unknown time';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * A size a person can read — and, when the size was never measured, saying so.
 *
 * The null case is not defensive padding. A dry run deliberately does not read
 * the git bundles (writing them is the expensive part and it writes nothing),
 * so it has no size for them, and the first version printed that as "0 B" —
 * which is not "unmeasured", it is a specific and wrong claim that there is
 * nothing there.
 */
function humanBytes(n) {
  if (n === null || n === undefined) return 'size not measured';
  if (!Number.isFinite(n)) return 'an unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * Should this machine take a backup on this wake-up?
 *
 * The backup rides the bus relay's ten-minute wake rather than owning a ninth
 * launchd job — the same place `heartbeat --push-owned`, `throughput --check`
 * and `repair --check` already ride. Two reasons, and the second is the one
 * that decided it: a wake that already exists is a wake that is already
 * watched, so a backup hung on it cannot silently stop firing without the
 * relay's own alarms noticing; and a ninth plist is a ninth thing to install
 * on a new machine, in the step of the rebuild that is already the weakest.
 *
 * So the schedule is "wake often, act once a day", which is a throttle, not a
 * timer. `null` for `lastAt` means never — and never is always due.
 */
function backupDue({ lastAt = null, now = Date.now(), everyMs = 20 * 60 * 60 * 1000 } = {}) {
  if (!lastAt) return { due: true, why: 'no backup has ever been taken on this machine' };
  const at = Date.parse(lastAt);
  if (!Number.isFinite(at)) return { due: true, why: 'the last-backup stamp is unreadable, so it is treated as absent' };
  const ageMs = now - at;
  if (ageMs < 0) {
    // A stamp in the future means the clock moved, and re-backing-up on every
    // wake for as long as it is wrong would be worse than waiting. Treat it as
    // fresh and let the staleness check be the thing that complains.
    return { due: false, why: 'the last-backup stamp is in the future (the clock has moved); not re-running on every wake' };
  }
  if (ageMs >= everyMs) return { due: true, why: `the last backup was ${ageText(ageMs)} ago` };
  return { due: false, why: `the last backup was only ${ageText(ageMs)} ago` };
}

// --- the manifest -----------------------------------------------------------

/**
 * The manifest is the product. The archive is just the bytes beside it.
 *
 * It is written as markdown, in the archive AND at the top of the node's folder
 * in the backup repo, because the question it answers — "what would I actually
 * get back?" — is one somebody needs to be able to answer without downloading
 * or unpacking anything, possibly on a phone, possibly in an airport.
 *
 * SKIPPED IS NOT AN APPENDIX. It renders above the file list, at the same
 * weight as what was captured, with a reason on every line. A sweep that
 * reports only what it managed to do is the shape of check that reads as a
 * pass while covering nothing (docs/DOCTRINE.md §3.11).
 */
function renderManifest({
  node,
  takenAt,
  captured = [],
  skipped = [],
  excluded = EXCLUDED,
  totalBytes = 0,
  gitBundles = [],
  notes = [],
} = {}) {
  const lines = [];
  lines.push(`# Backup of \`${node || 'an unidentified machine'}\``);
  lines.push('');
  lines.push(`Taken ${takenAt}. ${captured.length} item${captured.length === 1 ? '' : 's'}, ${humanBytes(totalBytes)}.`);
  lines.push('');
  lines.push('Restore with: `npm run restore:node -- --from <this folder>` (dry run by default).');
  lines.push('Full plan: `docs/NODE_RECOVERY.md` in the starcaster repo.');
  lines.push('');

  if (skipped.length) {
    lines.push('## Not captured, and why');
    lines.push('');
    lines.push('Read this part first. Everything below it went in; everything here did not.');
    lines.push('');
    for (const s of skipped) {
      lines.push(`- **${s.title}** — ${s.why}`);
    }
    lines.push('');
  } else {
    lines.push('## Not captured, and why');
    lines.push('');
    lines.push('Nothing on the inventory was missed on this run.');
    lines.push('');
  }

  lines.push('## Captured');
  lines.push('');
  for (const c of captured) {
    lines.push(`- **${c.title}** — ${c.files} file${c.files === 1 ? '' : 's'}, ${humanBytes(c.bytes)}`);
  }
  lines.push('');

  if (gitBundles.length) {
    lines.push('## Commits that existed only on this disk');
    lines.push('');
    lines.push('Each of these is a complete copy of work that was not on GitHub. Restore one with');
    lines.push('`git fetch <bundle-file> <branch>` inside the matching checkout.');
    lines.push('');
    for (const b of gitBundles) {
      lines.push(`- \`${b.repo}\` / \`${b.branch}\` — ${b.commits} commit${b.commits === 1 ? '' : 's'} not on origin`);
    }
    lines.push('');
  }

  lines.push('## Deliberately never in this archive');
  lines.push('');
  lines.push('These are credentials. They are typed on the new machine, not carried to it');
  lines.push('(docs/DOCTRINE.md §4.1). `npm run provision:node` prompts for the same four.');
  lines.push('');
  for (const e of excluded) {
    lines.push(`- **${e.what}**`);
    lines.push(`  - Instead: \`${e.instead}\``);
    lines.push(`  - Why: ${e.why}`);
  }
  lines.push('');

  if (notes.length) {
    lines.push('## Notes from this run');
    lines.push('');
    for (const n of notes) lines.push(`- ${n}`);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  BACKUP_REPO,
  CAPTURE,
  EXCLUDED,
  REPO_ROOT,
  SECRET_PATTERNS,
  STALE_AFTER_MS,
  ageText,
  backupDue,
  backupStampFile,
  freshnessReport,
  humanBytes,
  nodeFolder,
  renderManifest,
  scanForSecrets,
  tailWithNotice,
};
