#!/usr/bin/env node
/**
 * `npm run node:verify` — the reboot test's other half.
 *
 * `doctor:node` READS whether this machine's roles have been confirmed since
 * it last restarted. This is the thing that confirms them, and it is a
 * separate program for one reason: doctor:node promises, at the top of its own
 * file, to install nothing, start nothing and write nothing. That promise is
 * what makes it safe to run on a machine that is on fire, and a check which
 * quietly wrote state would retire it.
 *
 * WHAT IT ACTUALLY DOES
 * Asks every schedule this machine owns whether it is installed and loaded,
 * pairs those observations with the machine's boot identity
 * (`sysctl -n kern.boottime`), and records both. A later `doctor:node` compares
 * the recorded boot against the live one, so a restart invalidates the record
 * on its own with nobody having to remember anything.
 *
 * IT RECORDS WHAT IT SAW, NOT THAT IT FINISHED
 * `recordVerification` refuses a record with no per-role rows, so this script
 * cannot claim a verification by reaching its last line — the rows are the
 * only currency. And if ANY owned schedule could not be probed, it writes
 * nothing at all and exits 2: a partial verification is not a verification,
 * and half a reading recorded as a whole one is the failure this slice is
 * against (docs/DOCTRINE.md §3.11).
 *
 * Exit codes:
 *   0  every owned role is installed and loaded — recorded
 *   1  a role did not come back — recorded, so doctor:node reports FAIL too
 *   2  could not take a reading; nothing was written
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const nodeRoles = require('../lib/nodeRoles.js');
const provision = require('../lib/nodeProvision.js');
const rebootTest = require('../lib/nodeRebootTest.js');
const { mainCheckoutDir } = await import('./lib/main_checkout.mjs');

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_CHECKOUT = mainCheckoutDir(HERE);

function sh(command, args, options = {}) {
  try {
    const text = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? 20000,
    });
    return { ran: true, ok: true, text: String(text).trim() };
  } catch (error) {
    return {
      ran: error?.code !== 'ENOENT',
      ok: false,
      text: String(error?.stdout || error?.stderr || '').trim(),
      error: error?.message || String(error),
    };
  }
}

function cannotTell(lines) {
  console.log(['CANNOT TELL — nothing recorded.', ...lines].join('\n'));
  process.exit(2);
}

// --- which machine is this, and what does it owe? ---------------------------

const node = nodeRoles.thisNode();
if (!nodeRoles.isKnownNode(node.name)) {
  cannotTell([
    `This machine calls itself "${node.name || '(nothing)'}", which is not a node this system knows.`,
    `Known machines: ${nodeRoles.KNOWN_NODES.join(', ')}.`,
    'Verifying "the roles this machine owns" needs to know which machine it is; guessing would confirm another one\'s jobs.',
    `→ echo ${nodeRoles.KNOWN_NODES[0]} > ${node.file}`,
  ]);
}

const bootProbe = sh('sysctl', ['-n', 'kern.boottime']);
if (!bootProbe.ok) {
  cannotTell([
    'Could not read this machine\'s boot time.',
    `sysctl -n kern.boottime ${bootProbe.ran ? `failed: ${bootProbe.error}` : 'is not on this shell\'s PATH'}`,
    'Without a boot identity there is nothing a later run could compare against, so a record would be a date somebody has to remember to distrust.',
  ]);
}

const boot = rebootTest.parseBootTime(bootProbe.text);
if (!boot.ok) cannotTell(['Could not read this machine\'s boot time.', boot.why]);

// --- probe every owned schedule ---------------------------------------------

const owned = provision.schedulesForNode(node.name);
const observed = [];
const skipped = [];
const unprobeable = [];

for (const job of owned) {
  if (job.blocked) {
    skipped.push({ role: job.role, why: `no installer exists yet — ${job.blocked}` });
    continue;
  }
  if (job.manual) {
    skipped.push({ role: job.role, why: `no schedule, on purpose — ${job.why}` });
    continue;
  }
  const status = sh('bash', [path.join(MAIN_CHECKOUT, job.installer), '--status']);
  if (!status.ran || !status.ok) {
    unprobeable.push({ role: job.role, why: `${job.installer} --status did not answer (${status.error || 'no output'})` });
    continue;
  }
  observed.push({ role: job.role, ...rebootTest.parseScheduleStatus(status.text) });
}

if (unprobeable.length > 0) {
  cannotTell([
    `${unprobeable.length} owned schedule${unprobeable.length === 1 ? '' : 's'} could not be probed, so this is half a reading:`,
    ...unprobeable.map((u) => `  - ${u.role}: ${u.why}`),
    '',
    'Half a reading recorded as a whole one is worse than no reading — it would read as a verification.',
  ]);
}

if (observed.length === 0) {
  cannotTell([
    `${node.name} owns ${owned.length} role${owned.length === 1 ? '' : 's'}, and not one of them has a schedule that can be probed:`,
    ...skipped.map((s) => `  - ${s.role}: ${s.why}`),
    '',
    'There is nothing here a reboot could take away, so there is nothing to verify. This is not a pass.',
  ]);
}

// --- record what was seen ---------------------------------------------------

// The skipped rows go in too, so the record states what was NOT looked at as
// well as what answered. A record listing three roles is otherwise
// indistinguishable from a machine that owns three, which is how doctor:node
// came to print "All 3 owned roles came back" on a Mini owning six.
const written = rebootTest.recordVerification({ node: node.name, boot, roles: observed, skipped });
if (!written.ok) {
  cannotTell(['Could not write the verification record.', written.why, written.file ? `file: ${written.file}` : '']);
}

// The table and the summary read the SAME fact, from the same function. They
// did not used to: the row prefix keyed off `row.loaded` alone while this
// count keyed off `!installed || !loaded`, so a plist deleted without
// unloading — `{installed: false, loaded: true}`, the state
// `install_bus_relay.sh --uninstall` explicitly produces — printed
// `ok  bus-relay: loaded` under a summary saying one role did not come back,
// naming nothing. The operator was handed a contradiction with no way to
// resolve it.
const missing = observed.filter(rebootTest.didNotComeBack);
const lines = [];

lines.push(`${node.name} — roles verified against boot ${boot.at}`);
lines.push('');
for (const row of observed) lines.push(rebootTest.roleTableLine(row));
for (const row of skipped) lines.push(`  --    ${row.role}: not checked — ${row.why}`);
lines.push('');
lines.push(`recorded: ${written.file}`);
lines.push('');

if (missing.length > 0) {
  lines.push(`${missing.length} role${missing.length === 1 ? '' : 's'} did not come back. npm run doctor:node will report this as FAIL until it is fixed.`);
  lines.push('→ npm run provision:node      # then run this again');
  console.log(lines.join('\n'));
  process.exit(1);
}

lines.push(
  `All ${observed.length} probeable role${observed.length === 1 ? '' : 's'} are installed and loaded`
  + (skipped.length
    ? `, and ${skipped.length} owned role${skipped.length === 1 ? '' : 's'} (${skipped.map((s) => s.role).join(', ')}) ${skipped.length === 1 ? 'has' : 'have'} no schedule to check — recorded as unchecked, not as passing.`
    : `. ${node.name} owns ${owned.length} role${owned.length === 1 ? '' : 's'} and every one of them was probed.`),
);
lines.push('doctor:node will report PASS until this machine restarts, and CANNOT TELL again after that.');
console.log(lines.join('\n'));
process.exit(0);
