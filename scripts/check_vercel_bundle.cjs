#!/usr/bin/env node
'use strict';

/**
 * check:vercel-bundle — does `workers/` reach the Vercel build?
 *
 * WHY THIS EXISTS (Studio 7/8, task 86bbjv68y). The serverless bundle is
 * already about 97 MB and is implicated in the cold-start 502s. The Studio
 * workers drive ffmpeg over multi-gigabyte video and are the largest thing
 * this repo will ever grow; none of it can run on a read-only serverless
 * filesystem or finish inside a function timeout. `.vercelignore` keeps it
 * out — and, in the ticket's own words, **an ignore file nobody verifies is an
 * ignore file that stops working silently.**
 *
 * TWO CLAIMS, CHECKED SEPARATELY, BECAUSE THEY FAIL SEPARATELY:
 *
 *   1. EXCLUDED — every file under `workers/` is excluded by the rules in
 *      `.vercelignore`, evaluated rather than grepped for. A commented-out
 *      rule, a `!workers/...` line added later, or a rename of the folder all
 *      break this and all read fine to a human eye.
 *
 *   2. UNREACHABLE — nothing Vercel actually serves `require()`s a file under
 *      `workers/`. This is the half that an ignore file cannot enforce and the
 *      half that would hurt: Vercel's Node builder traces the require graph out
 *      from each function, so an import from a served route either drags the
 *      tree back in or breaks the deployment outright. A repo can be perfectly
 *      ignored and completely wrong.
 *
 * Same walk as scripts/check_automerge_reach.cjs, for the same reason and with
 * the same manners — a missing entry point is CANNOT TELL (exit 2), never a
 * pass over the wrong graph.
 *
 * EXIT CODES (DOCTRINE §5.33): 0 clean, 1 a real breach, 2 could not tell.
 */

const fs = require('fs');
const path = require('path');
const { matches, unreadableRules } = require('./builder/vercelIgnore.js');

const repo = path.resolve(__dirname, '..');

/** The tree that must never reach Vercel. */
const FORBIDDEN_PREFIX = 'workers/';

/**
 * What Vercel actually runs. `vercel.json` routes everything to these two, and
 * `server.js` is the local equivalent — included because a require added there
 * is a require somebody will shortly add to the dispatcher too, and catching
 * it one commit earlier costs nothing.
 */
const ENTRY_POINTS = ['api/[...slug].js', 'api/index.js', 'server.js', 'routes/index.js'];

const rel = (abs) => path.relative(repo, abs).split(path.sep).join('/');

function specifiersIn(src) {
  const out = [];
  const re = /(?:require\s*\(\s*|(?:^|[\s;}])(?:import|export)[\s\S]{0,200}?\bfrom\s*|import\s*\(\s*)(['"])([^'"]+)\1/g;
  let m;
  while ((m = re.exec(src))) out.push(m[2]);
  return out;
}

const EXTS = ['', '.js', '.mjs', '.cjs', '.json', '/index.js'];

function resolveLocal(fromAbs, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromAbs), spec);
  for (const ext of EXTS) {
    const cand = base + ext;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function everyFileUnder(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
    const next = `${dir}/${entry.name}`;
    if (entry.isDirectory()) everyFileUnder(next, out);
    else out.push(next);
  }
  return out;
}

function walkFromEntries() {
  const seen = new Set();
  const queue = [];
  const missingEntries = [];
  for (const e of ENTRY_POINTS) {
    const abs = path.join(repo, e);
    if (fs.existsSync(abs)) queue.push({ abs, via: [] });
    else missingEntries.push(e);
  }

  const reaches = [];
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
      if (nextRel.startsWith('..')) continue;
      if (nextRel.startsWith(FORBIDDEN_PREFIX)) reaches.push({ from: key, to: nextRel, via: [...via, key] });
      queue.push({ abs: next, via: [...via, key] });
    }
  }
  return { reaches, reached: seen.size, missingEntries };
}

const failures = [];
const cannotTell = [];

// ── Claim 1: .vercelignore excludes every file under workers/ ───────────────
const ignoreFile = path.join(repo, '.vercelignore');
if (!fs.existsSync(ignoreFile)) {
  failures.push(
    '.vercelignore does not exist, so nothing is keeping workers/ out of the Vercel upload.\n'
    + '  Fix: create it with a line reading `workers/`.'
  );
} else {
  const ignoreText = fs.readFileSync(ignoreFile, 'utf8');
  const unreadable = unreadableRules(ignoreText);
  if (unreadable.length) {
    for (const r of unreadable) {
      cannotTell.push(
        `.vercelignore contains a pattern this check cannot evaluate: "${r.pattern}" — it ${r.why}.\n`
        + '  No verdict is claimed, because an unread rule could exclude or un-exclude anything.\n'
        + '  Fix: rewrite it in the supported subset (see scripts/builder/vercelIgnore.js), or teach the matcher.'
      );
    }
  } else if (!fs.existsSync(path.join(repo, 'workers'))) {
    cannotTell.push(
      'There is no workers/ folder in this checkout, so there is nothing to test the ignore rules against.\n'
      + '  A clean sweep over an empty tree is not evidence the rule works.'
    );
  } else {
    const kept = everyFileUnder('workers').filter((f) => matches(ignoreText, f) !== true);
    if (kept.length) {
      failures.push(
        `.vercelignore does NOT exclude ${kept.length} file(s) under workers/, so they would be uploaded to Vercel:\n`
        + kept.slice(0, 10).map((f) => `    ${f}`).join('\n')
        + (kept.length > 10 ? `\n    ...and ${kept.length - 10} more` : '')
        + '\n  Fix: make sure `.vercelignore` carries a line reading `workers/` and that no later `!` rule undoes it.'
      );
    }
  }
}

// ── Claim 2: nothing served requires anything under workers/ ───────────────
const { reaches, reached, missingEntries } = walkFromEntries();
if (missingEntries.length) {
  cannotTell.push(
    'These server entry points do not exist, so the require graph is not the app\'s graph:\n'
    + missingEntries.map((e) => `    ${e}`).join('\n')
  );
} else if (reaches.length) {
  failures.push(
    `${reaches.length} served file(s) now require something under workers/:\n`
    + reaches.map((r) => `    ${r.to}\n      imported by ${r.from}\n      path from the server: ${[...r.via, r.to].join(' -> ')}`).join('\n')
    + '\n  Vercel traces requires out of each function, so this either drags the whole media\n'
    + '  toolchain into the bundle or breaks the deployment against the ignore rule.\n'
    + '  Fix: break the import. Serverless code and worker code do not share modules —\n'
    + '  move whatever they both need into lib/.'
  );
}

if (failures.length) {
  console.error('check:vercel-bundle FAILED — workers/ can reach the Vercel build:\n');
  for (const f of failures) console.error(`  ${f}\n`);
  for (const c of cannotTell) console.error(`  ALSO COULD NOT CHECK: ${c}\n`);
  process.exit(1);
}

if (cannotTell.length) {
  console.error('check:vercel-bundle CANNOT TELL — no verdict is claimed:\n');
  for (const c of cannotTell) console.error(`  ${c}\n`);
  process.exit(2);
}

console.log(`check:vercel-bundle OK — every file under workers/ is excluded by .vercelignore,`);
console.log(`and none of the ${reached} file(s) reachable from the server requires one.`);
process.exit(0);
