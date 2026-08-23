#!/usr/bin/env node
/**
 * Drift check for docs/ecosystem/inventory.yaml — asks whether the inventory
 * still matches REALITY, so the Development Ecosystem map cannot quietly go
 * stale. (check_ecosystem_inventory.mjs asks the other question — whether the
 * file is internally coherent. Run that one first; this one assumes it.)
 *
 *   npm run check:ecosystem-drift
 *
 * Probes run on real machines (launchctl, docker, repo folders, installed
 * commands) — this one, and any OTHER machine the inventory says is reachable
 * over ssh, which is probed there rather than written off for being elsewhere.
 * That is why this is NOT a pre-commit or CI gate: on a GitHub runner every
 * probe would report "could not check" and a green run would mean nothing. It
 * is a by-hand / scheduled check, run on a real machine.
 *
 * A machine that is asleep or off the network is COULD NOT CHECK, never drift —
 * one of Dane's two machines is regularly off, and a check that cries wolf gets
 * ignored. A remote probe that RUNS and fails is a different thing, and is
 * reported as drift.
 *
 * Three outcomes per object, and nothing else:
 *   DRIFT            reality and inventory disagree — named, with direction.
 *   COULD NOT CHECK  the probe could not run HERE (other machine, daemon
 *                    down, no probe defined). Said out loud, never a pass —
 *                    a silent skip is how a sweep gives a false all-clear
 *                    (docs/DOCTRINE.md §3.11).
 *   OK               the probe ran and reality agrees.
 *
 * Report-only. It never edits the inventory — a human decides which side of
 * a disagreement is wrong. Exit is non-zero when there is any drift.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load: parseYaml } = require('js-yaml');
const { createExecutor } = require(path.join(__dirname, 'builder', 'remoteProbe.js'));

const ROOT = path.resolve(__dirname, '..');

// `--inventory <path>` points the check at a different inventory. The real run
// never passes it; the tests do, because the remote-probe paths need a second
// machine to aim at and only one machine exists wherever this is running.
function argInventory() {
  const i = process.argv.indexOf('--inventory');
  if (i !== -1 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  return path.join(ROOT, 'docs', 'ecosystem', 'inventory.yaml');
}
const FILE = argInventory();

// ---------------------------------------------------------------- plumbing

const drift = [];  // { what, why }  — reality and inventory disagree
const cannot = []; // { what, why }  — probe could not run here
const ok = [];     // { what, how }  — probe ran, reality agrees

const home = os.homedir();
const expand = (p) => String(p).replace(/^~(?=\/|$)/, home);

function run(cmd, args, timeoutMs = 8000) {
  try {
    const out = execFileSync(cmd, args, {
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out };
  } catch (err) {
    return {
      ok: false,
      missing: err.code === 'ENOENT',
      timedOut: err.killed === true,
      code: typeof err.status === 'number' ? err.status : null,
      err,
    };
  }
}

// ------------------------------------------------------------- inventory

if (!fs.existsSync(FILE)) {
  console.error(`[drift] Missing ${path.relative(ROOT, FILE)} — nothing to check against.`);
  process.exit(1);
}
let doc;
try {
  doc = parseYaml(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  console.error(`[drift] inventory.yaml is not valid YAML:\n  ${err.message}`);
  process.exit(1);
}
const objects = doc?.objects ?? [];
const relationships = doc?.relationships ?? [];
const byId = new Map(objects.map((o) => [o.id, o]));

// Which machine is this? Matched by the login user, never by a hardcoded
// path — the MacBook is `mentor`, the Mini is `daneofearth`, and the check
// must run identically on both.
const user = os.userInfo().username;
const machines = objects.filter((o) => o.kind === 'machine');
const here = machines.find((m) => m.detail?.user === user) ?? null;
if (!here) {
  drift.push({
    what: `this machine (user "${user}")`,
    why: 'matches no machine object in the inventory — either the inventory is missing a machine, or this check is running somewhere it was never meant to (it has no business in CI)',
  });
}

// Walk an object's `host` chain to the machine it ultimately runs on.
// Null means it is not pinned to one machine and can be probed anywhere.
function hostMachine(obj) {
  let cur = obj;
  const seen = new Set();
  while (cur?.host && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.host);
    if (cur?.kind === 'machine') return cur;
  }
  return null;
}
// "Is this object expected on the machine we are standing on?"
function expectedHere(obj) {
  const m = hostMachine(obj);
  if (m) return here != null && m.id === here.id;
  return true; // unpinned — expected everywhere
}
// Repos are pinned by relationships ("checked out on"), not by host.
function repoExpectedHere(obj) {
  if (!here) return false;
  return relationships.some((r) => r.from === obj.id && r.to === here.id && r.kind === 'runs');
}

// ------------------------------------------------------------ remote probing
//
// Once ssh has proved a machine is reachable, an object that lives THERE is
// probed there rather than landing in COULD NOT CHECK just for being elsewhere.
// The probes ask exactly what they asked before; only the location changes.
// The rules (one connection per machine; unreachable is never drift; a failed
// remote probe IS drift) live in scripts/builder/remoteProbe.js.

const exec = createExecutor({ run, hereId: here?.id ?? null });

// Only machines the inventory says are reachable that way. macbook-pro is
// `probe: hostname` — no ssh route is claimed for it — so nothing hosted there
// is probed remotely, and it keeps exactly the wording it has always had.
function sshRoute(obj) {
  const m = hostMachine(obj);
  if (!m || (here && m.id === here.id)) return null;
  return m.probe === 'ssh' ? m : null;
}

// Every machine other than this one that declares an ssh route.
const remoteMachines = machines.filter((m) => m.probe === 'ssh' && !(here && m.id === here.id));

// Does the inventory claim something starts this machine's container runtime by
// itself? `colima` carries `detail.autostart: com.starcaster.colima`. If a
// runtime is supposed to come up unattended and the daemon is not answering,
// reality and the inventory disagree — that is the 2026-08-21 fatal start, and
// it is drift. Where nothing claims to start it (Docker Desktop on the laptop,
// which a person opens), a stopped daemon stays a state, not a disagreement.
function autostartedRuntimeOn(machineId) {
  return objects.find(
    (o) => o.kind === 'runtime' && o.detail?.autostart && hostMachine(o)?.id === machineId
  ) ?? null;
}

// `launchctl list` output -> the job labels in it.
function parseLaunchctlLabels(out) {
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[2])
    .filter(Boolean);
}

// One `launchctl list` per remote machine, shared by the per-job probe and the
// reverse sweep below.
const remoteLaunchctl = new Map();
function remoteLaunchctlLabels(machineId) {
  if (remoteLaunchctl.has(machineId)) return remoteLaunchctl.get(machineId);
  const r = exec.shell(machineId, 'launchctl list');
  let result;
  if (!r.ran) result = { error: r.why, unreachable: true, list: [] };
  else if (!r.ok) result = { error: `launchctl list did not run on ${machineId}`, unreachable: false, list: [] };
  else result = { error: null, unreachable: false, list: parseLaunchctlLabels(r.out) };
  remoteLaunchctl.set(machineId, result);
  return result;
}

// ---------------------------------------------------------------- probes
//
// Each probe returns via drift/cannot/ok — never silently. An object whose
// probe type this script does not know goes to DRIFT, not to a skip: a
// typo'd probe that quietly checked nothing would be §3.11 all over again.

// Shared: is the docker daemon answering? (Cached — several probes ask.)
let dockerState; // 'up' | 'down' | 'absent'
function dockerUp() {
  if (dockerState) return dockerState;
  const r = run('docker', ['ps', '-a', '--format', '{{.Names}}'], 15000);
  dockerState = r.ok ? 'up' : r.missing ? 'absent' : 'down';
  dockerContainers = r.ok ? r.out.split('\n').filter(Boolean) : [];
  return dockerState;
}
let dockerContainers = [];

let launchctlLabels = null; // null = could not list
{
  const r = run('launchctl', ['list']);
  if (r.ok) launchctlLabels = parseLaunchctlLabels(r.out);
}

// One wording for "what is docker doing on machine X", used for this machine
// and for remote ones. A stopped daemon is only drift where the inventory says
// something starts the runtime unattended — that is the difference between
// "Dane has not opened Docker Desktop" and "colima will not start".
function reportDocker(what, machineId, where, state) {
  const label = `${what} on ${where}`;
  if (state === 'absent') {
    drift.push({ what: label, why: `inventory says Docker runs on ${where} — no docker binary is installed there` });
    return;
  }
  if (state === 'down') {
    const auto = machineId ? autostartedRuntimeOn(machineId) : null;
    if (auto) {
      drift.push({
        what: label,
        why: `docker is installed but the daemon is not answering, and the inventory says "${auto.id}" brings it up automatically (${auto.detail.autostart}) — installed, but will not start`,
      });
    } else {
      ok.push({ what: label, how: 'docker binary installed (daemon not running right now — that is a state, not drift)' });
    }
    return;
  }
  ok.push({ what: label, how: 'docker binary installed and daemon answering' });
}

const probes = {
  // A machine object for the machine we are standing on proves itself.
  hostname(obj) {
    if (here && obj.id === here.id) {
      ok.push({ what: obj.id, how: `this IS the current machine (user "${user}")` });
    } else {
      cannot.push({ what: obj.id, why: 'not the machine this check is running on, and no remote probe is defined for it' });
    }
  },

  // The other machine: prove it over ssh, briefly. Unreachable is NOT
  // drift — a sleeping or off-network box is still real.
  ssh(obj) {
    if (here && obj.id === here.id) {
      ok.push({ what: obj.id, how: `this IS the current machine (user "${user}")` });
      return;
    }
    // Memoised: the probes below reuse this verdict rather than reconnecting.
    const r = exec.reach(obj.id); // `ssh mac-mini` per detail.reachable
    if (r.reachable) ok.push({ what: obj.id, how: `reachable over ssh as "${r.target}"` });
    else cannot.push({ what: obj.id, why: r.why });
  },

  // detail.path exists and its origin remote matches detail.remote.
  'git-remote'(obj) {
    const p = obj.detail?.path ? expand(obj.detail.path) : null;
    const want = obj.detail?.remote;
    if (!p || !want) {
      drift.push({ what: obj.id, why: 'probe is git-remote but detail.path / detail.remote are missing from the inventory' });
      return;
    }
    if (!fs.existsSync(p)) {
      if (repoExpectedHere(obj)) {
        drift.push({ what: obj.id, why: `inventory says it is checked out at ${obj.detail.path} on this machine — the folder does not exist` });
      } else {
        cannot.push({ what: obj.id, why: `not checked out on this machine per the inventory, and ${obj.detail.path} is indeed absent here` });
      }
      return;
    }
    const r = run('git', ['-C', p, 'remote', 'get-url', 'origin']);
    if (!r.ok) {
      drift.push({ what: obj.id, why: `${obj.detail.path} exists but is not a git repo with an origin remote` });
      return;
    }
    const got = r.out.trim();
    if (got === want) ok.push({ what: obj.id, how: `${obj.detail.path} exists, origin is ${got}` });
    else drift.push({ what: obj.id, why: `origin remote is "${got}" but the inventory says "${want}"` });
  },

  // The object's id names an installed command (colima, doppler).
  command(obj) {
    if (!expectedHere(obj)) {
      const remote = sshRoute(obj);
      if (!remote) {
        cannot.push({ what: obj.id, why: `hosted on ${hostMachine(obj).id}, not on this machine` });
        return;
      }
      const r = exec.shell(remote.id, `command -v ${obj.id}`);
      if (!r.ran) cannot.push({ what: obj.id, why: `hosted on ${remote.id}; ${r.why}` });
      else if (r.ok) ok.push({ what: obj.id, how: `"${obj.id}" is installed on ${remote.id} (${r.out.trim()})` });
      else drift.push({ what: obj.id, why: `inventory says "${obj.id}" runs on ${remote.id} — the command is not installed there` });
      return;
    }
    const r = run('/bin/sh', ['-c', `command -v ${obj.id}`]);
    if (r.ok) ok.push({ what: obj.id, how: `"${obj.id}" is installed (${r.out.trim()})` });
    else drift.push({ what: obj.id, why: `inventory says "${obj.id}" runs here — the command is not installed` });
  },

  // Docker is unpinned in the inventory — "provided by Colima on the Mini and
  // by Docker Desktop on the MacBook" — so it is expected on EVERY machine, and
  // is now checked on every machine we can reach rather than only this one.
  'docker-info'(obj) {
    reportDocker(obj.id, here?.id ?? null, 'this machine', dockerUp());
    for (const m of remoteMachines) {
      const r = exec.shell(m.id, 'docker ps -a --format "{{.Names}}"');
      if (!r.ran) {
        cannot.push({ what: `${obj.id} on ${m.id}`, why: r.why });
        continue;
      }
      if (r.ok) {
        reportDocker(obj.id, m.id, m.id, 'up');
        continue;
      }
      // The daemon said no. Installed-but-dead and never-installed are
      // different disagreements, so ask which one it is.
      const installed = exec.shell(m.id, 'command -v docker');
      reportDocker(obj.id, m.id, m.id, installed.ran && installed.ok ? 'down' : 'absent');
    }
  },

  // Every name in detail.components exists as a container (running or not).
  'docker-containers'(obj) {
    const wanted = obj.detail?.components;
    if (!Array.isArray(wanted) || !wanted.length) {
      drift.push({ what: obj.id, why: 'probe is docker-containers but detail.components lists nothing to check' });
      return;
    }
    const state = dockerUp();
    if (state !== 'up') {
      cannot.push({ what: obj.id, why: `docker daemon is ${state === 'absent' ? 'not installed' : 'not running'} — ${wanted.length} container name(s) unverified` });
      return;
    }
    const missing = wanted.filter((n) => !dockerContainers.includes(n));
    if (missing.length) drift.push({ what: obj.id, why: `inventory lists container(s) docker does not have: ${missing.join(', ')}` });
    else ok.push({ what: obj.id, how: `all ${wanted.length} containers exist in docker` });
  },

  // detail.label is loaded in launchctl on the machine that hosts the job.
  launchctl(obj) {
    const label = obj.detail?.label;
    if (!label) {
      drift.push({ what: obj.id, why: 'probe is launchctl but detail.label is missing from the inventory' });
      return;
    }
    if (!expectedHere(obj)) {
      const remote = sshRoute(obj);
      if (!remote) {
        cannot.push({ what: obj.id, why: `scheduled on ${hostMachine(obj)?.id ?? 'another machine'}, not on this machine` });
        return;
      }
      const labels = remoteLaunchctlLabels(remote.id);
      if (labels.error) cannot.push({ what: obj.id, why: `scheduled on ${remote.id}; ${labels.error}${labels.unreachable ? '' : ' — cannot tell whether the job is loaded'}` });
      else if (labels.list.includes(label)) ok.push({ what: obj.id, how: `"${label}" is loaded in launchctl on ${remote.id}` });
      else drift.push({ what: obj.id, why: `inventory says "${label}" is scheduled on ${remote.id} — launchctl there has no such job` });
      return;
    }
    if (launchctlLabels == null) {
      cannot.push({ what: obj.id, why: 'launchctl list did not run — cannot tell whether the job is loaded' });
      return;
    }
    if (launchctlLabels.includes(label)) ok.push({ what: obj.id, how: `"${label}" is loaded in launchctl` });
    else drift.push({ what: obj.id, why: `inventory says "${label}" is scheduled here — launchctl has no such job` });
  },

  // No API calls (this check touches nothing remote) — present + well-formed.
  'clickup-id'(obj) {
    const channel = obj.detail?.channel_id;
    const list = obj.detail?.list_id;
    if (channel == null && list == null) {
      drift.push({ what: obj.id, why: 'probe is clickup-id but detail carries neither channel_id nor list_id' });
      return;
    }
    const bad = [];
    if (channel != null && !/^[a-z0-9]+-\d+$/.test(String(channel))) bad.push(`channel_id "${channel}" is not shaped like a ClickUp channel id`);
    if (list != null && !/^\d+$/.test(String(list))) bad.push(`list_id "${list}" is not all digits`);
    if (bad.length) drift.push({ what: obj.id, why: bad.join('; ') });
    else ok.push({ what: obj.id, how: `id present and well-formed (${channel ?? list}) — existence not probed, this check makes no API calls` });
  },

  // The agent's skill lives at .claude/skills/<id>/SKILL.md in this repo.
  'skill-file'(obj) {
    const p = path.join(ROOT, '.claude', 'skills', obj.id, 'SKILL.md');
    if (fs.existsSync(p)) ok.push({ what: obj.id, how: `.claude/skills/${obj.id}/SKILL.md exists` });
    else drift.push({ what: obj.id, why: `inventory names agent "${obj.id}" — .claude/skills/${obj.id}/SKILL.md does not exist` });
  },

  'gh-auth'(obj) {
    const r = run('gh', ['auth', 'status']);
    if (r.ok) ok.push({ what: obj.id, how: 'gh is authenticated on this machine' });
    else if (r.missing) cannot.push({ what: obj.id, why: 'gh CLI is not installed here — cannot tell whether GitHub auth works' });
    else drift.push({ what: obj.id, why: 'inventory says this machine authenticates to GitHub — `gh auth status` says it does not' });
  },

  // Declared unprobeable. Saying so is the whole point.
  none(obj) {
    cannot.push({ what: obj.id, why: 'probe is "none" — nothing machine-readable to check it against' });
  },
};

for (const obj of objects) {
  const probe = obj.probe ?? 'none';
  const fn = probes[probe];
  if (!fn) {
    drift.push({ what: obj.id, why: `probe "${probe}" is not one this check knows — it would otherwise be silently skipped, which is worse than failing` });
    continue;
  }
  try {
    fn(obj);
  } catch (err) {
    cannot.push({ what: obj.id, why: `probe "${probe}" blew up: ${err.message}` });
  }
}

// ------------------------------------------- reality → inventory (reverse)
//
// The forward pass catches inventory entries reality lacks. These sweeps
// catch the other direction: things that exist and the inventory forgot.

// Every com.starcaster.* / *.pulse.* job loaded here must be in the
// inventory, hosted on this machine.
function launchctlSweep(labels, machineId, where) {
  const ours = labels.filter((l) => /^com\.starcaster\./.test(l) || /\.pulse\./.test(l));
  const known = new Set(
    objects.filter((o) => o.kind === 'job' && (machineId == null || hostMachine(o)?.id === machineId)).map((o) => o.detail?.label)
  );
  for (const label of ours) {
    if (!known.has(label)) drift.push({ what: label, why: `loaded in launchctl on ${where} but the inventory has no job with this label hosted there` });
  }
  ok.push({ what: `launchctl sweep (${where})`, how: `${ours.length} starcaster/pulse job(s) loaded on ${where}, all accounted for or reported` });
}

if (launchctlLabels == null) {
  cannot.push({ what: 'launchctl sweep (this machine)', why: 'launchctl list did not run — cannot look for scheduled jobs the inventory is missing' });
} else {
  launchctlSweep(launchctlLabels, here?.id ?? null, 'this machine');
}

// ...and on every machine we can reach. A job running there that the inventory
// has never heard of was invisible from this side until now.
for (const m of remoteMachines) {
  const labels = remoteLaunchctlLabels(m.id);
  if (labels.error) cannot.push({ what: `launchctl sweep (${m.id})`, why: `${labels.error}${labels.unreachable ? '' : ' — cannot look for scheduled jobs the inventory is missing there'}` });
  else launchctlSweep(labels.list, m.id, m.id);
}

// Every supabase_*_starcaster container docker has must appear in some
// docker-containers object's components.
{
  const state = dockerUp();
  if (state !== 'up') {
    cannot.push({ what: 'docker sweep', why: `docker daemon is ${state === 'absent' ? 'not installed' : 'not running'} — cannot look for containers the inventory is missing` });
  } else {
    const known = new Set(objects.flatMap((o) => (o.probe === 'docker-containers' && Array.isArray(o.detail?.components) ? o.detail.components : [])));
    const strays = dockerContainers.filter((n) => /^supabase_.*_starcaster$/.test(n) && !known.has(n));
    for (const n of strays) drift.push({ what: n, why: 'container exists in docker but no inventory object lists it in detail.components' });
    if (!strays.length) ok.push({ what: 'docker sweep', how: 'no starcaster containers unaccounted for' });
  }
}

// Every loop-* skill in this repo must be an inventory agent.
{
  const dir = path.join(ROOT, '.claude', 'skills');
  const skills = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith('loop-')) : [];
  const known = new Set(objects.filter((o) => o.probe === 'skill-file').map((o) => o.id));
  const strays = skills.filter((n) => !known.has(n));
  for (const n of strays) drift.push({ what: n, why: `.claude/skills/${n}/ exists in this repo but the inventory has no such agent` });
  if (!strays.length) ok.push({ what: 'skills sweep', how: `${skills.length} loop-* skill(s) in the repo, all in the inventory` });
}

// ---------------------------------------------------------------- report

const machineLine = here ? `${here.name} (${here.id}, user "${user}")` : `UNKNOWN machine (user "${user}")`;
console.log(`\n[drift] Development Ecosystem drift check — running on ${machineLine}`);
console.log(`[drift] inventory: ${path.relative(ROOT, FILE)} — ${objects.length} object(s)\n`);

if (drift.length) {
  console.log(`  DRIFT — reality and inventory disagree (${drift.length}):`);
  for (const d of drift) console.log(`    ✗ ${d.what}: ${d.why}`);
  console.log('');
}
console.log(`  COULD NOT CHECK from this machine (${cannot.length}):`);
if (cannot.length) for (const c of cannot) console.log(`    ? ${c.what}: ${c.why}`);
else console.log('    (nothing — every probe ran)');
console.log('');
console.log(`  OK (${ok.length}):`);
for (const o of ok) console.log(`    ✓ ${o.what}: ${o.how}`);
console.log('');

if (drift.length) {
  console.log(`[drift] FAIL — ${drift.length} disagreement(s) between the inventory and reality.`);
  console.log('[drift] Decide which side is wrong and fix THAT side by hand. This check never edits the inventory.');
  process.exit(1);
}
console.log(`[drift] OK — nothing this machine can see disagrees with the inventory. The ${cannot.length} item(s) above were NOT verified.`);
