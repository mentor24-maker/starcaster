#!/usr/bin/env node
'use strict';

/**
 * check:automerge-reach — is any auto-mergeable file reachable from the server?
 *
 * WHY THIS EXISTS. Lane B (2026-09-04, task 86bbuzyra) lets the pipeline's own
 * tooling under `scripts/` merge without Dane's hand on it. The whole safety
 * argument for that boundary is one sentence: **no served route reaches
 * `scripts/`.** That was true when he chose it, and he said so himself when he
 * chose it:
 *
 *   "A folder boundary is not permanent. scripts/ is unreachable from a served
 *    route today, but nothing enforces that — lib/loopThroughput.js already
 *    imports scripts/builder/wipCap.js, so the trees are not cleanly separated,
 *    and a future import could quietly put an auto-mergeable file on a live
 *    path. If you pick A or D, the build should include a check that fails if
 *    an auto-mergeable folder becomes reachable from the server. Otherwise this
 *    decision silently expires."
 *                                              — Dane, 2026-09-04
 *
 * That last sentence is the requirement. Without this check the boundary is a
 * claim about the code as it was on one morning, and the first `require()` that
 * crosses it turns Lane B into a lane that can auto-merge code running on a
 * client's site — with nothing anywhere reporting the change.
 *
 * WHAT IT DOES. Walks the require/import graph out from the server's real entry
 * points and fails if it reaches a file that `autoMergeLane.governanceReason`
 * would NOT block and `laneForFile` WOULD carry. Both halves matter: a governed
 * file (the merge step, a gate) is already unmergeable, so it being reachable
 * is not this check's problem.
 *
 * The known crossing is allowed and NAMED, not waved through silently — see
 * KNOWN_CROSSINGS. A new one fails, and the message says which import did it.
 */

const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const { governanceReason, laneForFile } = require('./builder/autoMergeLane.js');

/** Where a request can actually enter this app. */
const ENTRY_POINTS = [
  'server.js',
  'api/[...slug].js',
  'routes/index.js',
];

/**
 * Crossings that exist on a SERVED path and are accepted anyway, each with why.
 *
 * Empty, and that is the measured answer rather than an aspiration. Dane named
 * `lib/loopThroughput.js` importing `scripts/builder/wipCap.js` as the example
 * of the trees not being cleanly separated, and that import is real (line 37).
 * But `lib/loopThroughput.js` is not reachable from `server.js`, the Vercel
 * dispatcher or `routes/index.js` — only scripts use it — so it is not a
 * crossing this check is about. Both files it pulls are governance-blocked in
 * any case, so neither could auto-merge even if a route did reach them.
 *
 * An entry here is an EXCEPTION and should be rare: it says a file that Lane B
 * may auto-merge does run on a live path, and somebody decided that is fine.
 */
const KNOWN_CROSSINGS = [];

const rel = (abs) => path.relative(repo, abs).split(path.sep).join('/');

/** Every require()/import specifier in a file, without executing it. */
function specifiersIn(src) {
  const out = [];
  const re = /(?:require\s*\(\s*|(?:^|[\s;}])(?:import|export)[\s\S]{0,200}?\bfrom\s*|import\s*\(\s*)(['"])([^'"]+)\1/g;
  let m;
  while ((m = re.exec(src))) out.push(m[2]);
  return out;
}

const EXTS = ['', '.js', '.mjs', '.cjs', '.json', '/index.js'];

function resolveLocal(fromAbs, spec) {
  if (!spec.startsWith('.')) return null; // a package, not our code
  const base = path.resolve(path.dirname(fromAbs), spec);
  for (const ext of EXTS) {
    const cand = base + ext;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function walk() {
  const seen = new Set();
  const queue = [];
  const missingEntries = [];

  for (const e of ENTRY_POINTS) {
    const abs = path.join(repo, e);
    if (fs.existsSync(abs)) queue.push({ abs, via: [] });
    else missingEntries.push(e);
  }

  const crossings = [];
  while (queue.length) {
    const { abs, via } = queue.shift();
    const key = rel(abs);
    if (seen.has(key)) continue;
    seen.add(key);

    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }

    for (const spec of specifiersIn(src)) {
      const next = resolveLocal(abs, spec);
      if (!next) continue;
      const nextRel = rel(next);
      if (nextRel.startsWith('..')) continue; // outside the repo

      // The thing we are actually looking for.
      if (laneForFile(nextRel) && !governanceReason(nextRel)) {
        crossings.push({ from: key, to: nextRel, via: [...via, key] });
      }
      queue.push({ abs: next, via: [...via, key] });
    }
  }
  return { crossings, reached: seen.size, missingEntries };
}

const { crossings, reached, missingEntries } = walk();

// A check that could not run must not exit 0 (DOCTRINE §5.33, PR #584). If an
// entry point is missing the graph is not the app's graph, and a clean sweep
// over the wrong graph is worse than no sweep.
if (missingEntries.length) {
  console.error('check:automerge-reach CANNOT TELL — these entry points do not exist:');
  for (const e of missingEntries) console.error(`  ${e}`);
  console.error('The reachability graph would not be the server\'s graph, so no verdict is claimed.');
  process.exit(2);
}

const known = new Set(KNOWN_CROSSINGS.map((k) => `${k.from} -> ${k.to}`));
const fresh = crossings.filter((c) => !known.has(`${c.from} -> ${c.to}`));

// A recorded crossing that no longer crosses is not a failure, but it IS stale
// bookkeeping — and a stale allowance is how an exception outlives its reason.
const stillCrossing = new Set(crossings.map((c) => `${c.from} -> ${c.to}`));
const staleAllowances = KNOWN_CROSSINGS
  .map((k) => `${k.from} -> ${k.to}`)
  .filter((k) => !stillCrossing.has(k));

if (fresh.length) {
  console.error(`check:automerge-reach FAILED — ${fresh.length} auto-mergeable file(s) are now reachable from the server:\n`);
  for (const c of fresh) {
    console.error(`  ${c.to}`);
    console.error(`    imported by ${c.from}`);
    console.error(`    path from the server: ${[...c.via, c.to].join(' -> ')}`);
  }
  console.error('\nLane B may auto-merge those files without Dane\'s word, and they now run on a');
  console.error('live path. Either break the import, or add the file to GOVERNANCE_STEMS /');
  console.error('GOVERNANCE_FILES in scripts/builder/autoMergeLane.js so no lane may carry it.');
  console.error('Do NOT add it to KNOWN_CROSSINGS unless it is already governance-blocked.');
  process.exit(1);
}

if (staleAllowances.length) {
  console.log(`check:automerge-reach — ${reached} file(s) reachable from the server, no new crossings.`);
  console.log('These recorded crossings no longer exist and can be deleted from KNOWN_CROSSINGS:');
  for (const k of staleAllowances) console.log(`  ${k}`);
  process.exit(0);
}

console.log(`check:automerge-reach OK — ${reached} file(s) reachable from the server; no auto-mergeable file among them.`);
console.log(`(${KNOWN_CROSSINGS.length} known crossing(s), each already blocked as governance.)`);
process.exit(0);
