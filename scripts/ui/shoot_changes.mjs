/**
 * BEFORE / AFTER — photograph what this branch changed about a rendered page,
 * and put the two pictures in front of the operator.
 *
 * WHY THIS EXISTS
 * Nothing in this repo tests CSS. `check:css` asks the browser which
 * declarations survived; `check:render` asks whether a control is dead. Both
 * answer questions about mechanism, and neither can tell a bounce from a
 * wobble (DOCTRINE §5.14). The only instrument that has ever caught a
 * page looking wrong is the operator's eye — so the job here is not to judge
 * the change, it is to get the change IN FRONT OF that eye without him having
 * to open anything, check out a branch, or know a branch exists.
 *
 * Ratified as charter Q5 (2026-08-18): visual changes reach Dane as
 * before/after screenshots in the approval queue; non-visual work ships on
 * gates and a second-agent review.
 *
 * HOW "BEFORE" IS OBTAINED, AND WHY NOT FROM COMMITTED BASELINE IMAGES
 * The obvious design is a folder of expected PNGs in git. It does not work
 * here: fonts are system fonts (the harness blocks the network so a font host
 * can never decide a measurement), so a baseline shot on this Mac and a shot
 * on the Mini differ in every letter, forever. Instead the merge-base is
 * BUILT — extracted with `git archive`, bundled with the same two build
 * scripts — and shot on the same machine, in the same browser, minutes apart.
 * Both sides then share every variable except the change itself.
 *
 *   PORT=3058 node server.js                                    # in another shell
 *   UI_HARNESS_BASE_URL=http://localhost:3058 npm run check:shots
 *   ... --task 86bbxxxxx        # attach the pair to a ClickUp ticket
 *   ... --list 901418546619     # or file a fresh review task for the operator
 *
 * READ THIS BEFORE LOOSENING THE COMPARISON
 * It is exact: one differing pixel is a change. That is only affordable
 * because the run proves its own instrument first — an identical scene shot
 * through the same interception machinery must come back pixel-identical, or
 * the whole run fails rather than filing noise. If that control starts
 * failing, the fix is a more deterministic scene, never a tolerance. A
 * tolerance hides exactly the change most worth a human's eye: a border that
 * lost 1px, a colour two shades off, a caption that moved.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, ensureBuildIsCurrent } from './app-driver.mjs';
import { SHOT_SCENES } from './shot-scenes.mjs';
import { VISUAL_SOURCES, visualFilesIn, comparePixels, describeChange } from './visual-diff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');
const sharp = require('sharp');

let createEmptyModule;
try {
  ({ createEmptyModule } = require(path.join(ROOT, 'lib/builder/template.js')));
} catch {
  console.error(
    '\n[check:shots] lib/builder/template.js is missing — it is a generated file\n' +
    'and a fresh worktree does not have one.\n\nRun `npm run build:builder-template`.\n'
  );
  process.exit(2);
}

const DRAFT_KEY = 'starcaster_builder_preview_draft';
const WIDTH = Number(process.env.UI_HARNESS_WIDTH || 1440);
const SHELL = '.builder-preview-shell';

/** The three artifacts that decide what the preview draws. Nothing else is served from the baseline. */
const SWAPPED = [
  { pathname: '/builder-bundle.js', file: 'public/builder-bundle.js', type: 'text/javascript; charset=utf-8' },
  { pathname: '/styles.css', file: 'public/styles.css', type: 'text/css; charset=utf-8' },
  { pathname: '/builder-preview.html', file: 'public/builder-preview.html', type: 'text/html; charset=utf-8' },
];

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const BASE_REF = arg('base', 'origin/main');
const TASK_ID = arg('task');
const LIST_ID = arg('list');
const DRY_RUN = flag('dry-run');
const FORCE = flag('force');

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/* ── 1. Is there anything here that could change a rendering? ───────────── */

function changedFiles() {
  let mergeBase;
  try {
    mergeBase = git('merge-base', BASE_REF, 'HEAD');
  } catch {
    console.error(
      `\n[check:shots] Could not find a merge base with \`${BASE_REF}\`.\n` +
      'Run `git fetch origin` first, or pass `--base <ref>`.\n'
    );
    process.exit(2);
  }
  // Working tree vs the merge base: committed AND uncommitted edits both
  // count. The loop runs this before it commits as often as after, and a
  // check that only sees committed work would report "nothing changed" on the
  // change being made right now.
  const tracked = git('diff', '--name-only', mergeBase).split('\n').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
  return { mergeBase, files: [...new Set([...tracked, ...untracked])] };
}

/* ── 2. Build the "before" side. ────────────────────────────────────────── */

/**
 * The merge base, extracted and built, in a throwaway folder.
 *
 * `git archive` rather than `git worktree add`: no worktree registry entry to
 * leak, no post-checkout hook to fire, and nothing that can collide with the
 * operator's real worktrees. It lands INSIDE the repo on purpose — node
 * resolves upward, so the extracted copy reaches this checkout's
 * `node_modules` without an install and without a symlink (landmine 8).
 *
 * WHAT THIS CANNOT DO, said plainly: the baseline is built with TODAY'S
 * dependencies. If the change under review is a dependency bump, the "before"
 * side is the old source against the new packages, which is not what the old
 * commit really looked like. That is a rare enough case to name rather than
 * engineer around — but it is named, because a wrong "before" reads exactly
 * like a right one.
 */
function buildBaseline(mergeBase, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync('sh', ['-c', `git archive ${mergeBase} | tar -x -C ${JSON.stringify(outDir)}`], { cwd: ROOT, stdio: 'pipe' });

  for (const script of ['scripts/build_builder_bundle.mjs', 'scripts/build_styles.mjs']) {
    const result = spawnSync(process.execPath, [path.join(outDir, script)], { cwd: outDir, encoding: 'utf8' });
    if (result.status !== 0) {
      console.error(
        `\n[check:shots] Could not build the "before" side (${script} failed at ${mergeBase.slice(0, 8)}).\n` +
        'Without it there is nothing to compare against, so this is a failure rather than a pass.\n\n' +
        (result.stderr || result.stdout || '').slice(-1500) + '\n'
      );
      process.exit(2);
    }
  }
  return outDir;
}

/* ── 3. Shoot. ──────────────────────────────────────────────────────────── */

function moduleFrom(spec, index) {
  const base = createEmptyModule(spec.type, 'main');
  return {
    ...base,
    id: `module-shot-${spec.type}-${index}`,
    name: spec.type,
    text: spec.text ?? base.text ?? '',
    settings: { ...base.settings, ...(spec.settings || {}) },
  };
}

function documentFor(scene) {
  return {
    name: scene.title,
    layoutSections: [{
      id: `section-shot-${scene.id}`,
      title: scene.title,
      layout: 'single',
      locked: false,
      alignment: 'left',
      widthMode: 'contained',
      modules: scene.modules.map(moduleFrom),
    }],
  };
}

/**
 * A browser context. `servedFrom` swaps the three build artifacts for another
 * checkout's copies; everything else (images, API calls) still comes from the
 * live server, so both sides see the same pictures and the same data.
 */
async function makeContext(browser, servedFrom) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: 1000 },
    // Pinned, not inherited: every effect stops under prefers-reduced-motion,
    // so without this the same commit photographs differently on two machines.
    reducedMotion: 'no-preference',
    deviceScaleFactor: 1,
  });
  // A font host must never decide a pixel. builder-preview.html pulls Google
  // Fonts; a laptop with network and a box without would disagree forever.
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());

  if (servedFrom) {
    for (const swap of SWAPPED) {
      const full = path.join(servedFrom, swap.file);
      if (!existsSync(full)) continue; // the file did not exist at that commit
      const body = readFileSync(full);
      await context.route(
        (url) => url.pathname === swap.pathname,
        (route) => route.fulfill({ status: 200, contentType: swap.type, body })
      );
    }
  }
  return context;
}

async function shoot(page, scene) {
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value),
    [DRAFT_KEY, JSON.stringify(documentFor(scene))]);
  // NOT `networkidle` — the page runs animations and never goes idle.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.builder-preview-module', { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  const modules = await page.locator('.builder-preview-module').count();
  const shell = page.locator(SHELL).first();
  if (!modules || !(await shell.count())) return { modules, png: null };

  // `animations: 'disabled'` finishes CSS animations and parks them at their
  // end state, which is what makes two shots of a moving module comparable.
  const png = await shell.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
  return { modules, png };
}

const raw = (png) => sharp(png).raw().toBuffer({ resolveWithObject: true })
  .then(({ data, info }) => ({ data, width: info.width, height: info.height, channels: info.channels }));

/* ── 4. Put it in front of the operator. ────────────────────────────────── */

function clickup(args, label) {
  const result = spawnSync('npm', ['run', '--silent', 'clickup', '--', ...args], { cwd: ROOT, encoding: 'utf8' });
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) {
    console.error(`\n[check:shots] ${label} FAILED. The images are on disk; nothing was filed.\n`);
    process.exit(1);
  }
  return result.stdout || '';
}

/* ────────────────────────────────────────────────────────────────────────── */

const { mergeBase, files } = changedFiles();
const visual = visualFilesIn(files);

if (!visual.length && !FORCE) {
  console.log(
    `[check:shots] Nothing to shoot — none of the ${files.length} changed file(s) can alter what a page renders.\n` +
    'Watched surfaces:\n' +
    VISUAL_SOURCES.map((s) => `  ${s.path}${' '.repeat(Math.max(1, 28 - s.path.length))}${s.why}`).join('\n') +
    '\nA change OUTSIDE those is assumed non-visual. If that assumption is wrong here, re-run with --force.'
  );
  process.exit(0);
}

await ensureBuildIsCurrent(BASE_URL);

console.log(`[check:shots] ${visual.length} changed file(s) touch the rendering surface; ` +
  `building the "before" side at ${mergeBase.slice(0, 8)}.`);

const runDir = path.join(ROOT, '.ui-shots', new Date().toISOString().replace(/[:.]/g, '-'));
const baselineDir = path.join(ROOT, '.ui-shots', 'baseline');
mkdirSync(runDir, { recursive: true });
buildBaseline(mergeBase, baselineDir);

const browser = await chromium.launch({ headless: true });
const changes = [];
let failure = null;

try {
  const after = await makeContext(browser);
  // The control serves THIS checkout's own files through the same
  // interception machinery the baseline uses. If its shot differs from the
  // plain one, the difference came from the machinery rather than from the
  // change — and every result below would be noise wearing a verdict.
  const control = await makeContext(browser, ROOT);
  const before = await makeContext(browser, baselineDir);

  const open = async (context) => {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/builder-preview.html`, { waitUntil: 'domcontentloaded' });
    return page;
  };
  const afterPage = await open(after);
  const controlPage = await open(control);
  const beforePage = await open(before);

  const probe = SHOT_SCENES[0];
  const afterProbe = await shoot(afterPage, probe);
  const controlProbe = await shoot(controlPage, probe);
  if (!afterProbe.png || !controlProbe.png) {
    failure =
      `the control scene "${probe.id}" rendered ${afterProbe.modules} module(s) and no shell to photograph. ` +
      'NOTHING WAS MEASURED — either the preview surface changed or the bundle is stale (`npm run build:builder`).';
  } else {
    const check = comparePixels(await raw(controlProbe.png), await raw(afterProbe.png));
    if (!check.identical) {
      writeFileSync(path.join(runDir, 'control-a.png'), controlProbe.png);
      writeFileSync(path.join(runDir, 'control-b.png'), afterProbe.png);
      failure =
        'the control failed: the SAME scene, shot twice against the SAME build, came back different — ' +
        `${check.summary}. Every before/after below would be noise wearing a verdict, so nothing was ` +
        `filed. The two shots are in ${path.relative(ROOT, runDir)}. Fix the scene, never the comparison: ` +
        'a tolerance here hides the 1px border that is the whole reason for looking.';
    }
  }

  if (!failure) {
    for (const scene of SHOT_SCENES) {
      const afterShot = await shoot(afterPage, scene);
      const beforeShot = await shoot(beforePage, scene);
      if (!afterShot.png) {
        failure = `scene "${scene.id}" rendered nothing on THIS build (${afterShot.modules} module(s)). ` +
          'A scene that photographs an empty page proves nothing, so this is a failure rather than a pass.';
        break;
      }
      if (!beforeShot.png) {
        // New module, new scene, or a page that simply did not exist before.
        console.log(`[check:shots] ${scene.id}: nothing rendered on the "before" side — treating as new.`);
        changes.push({ scene, result: { identical: false, summary: 'did not render before this change' }, beforePng: null, afterPng: afterShot.png });
        continue;
      }
      const result = comparePixels(await raw(beforeShot.png), await raw(afterShot.png));
      console.log(`[check:shots] ${describeChange(scene.id, result)}`);
      if (!result.identical) changes.push({ scene, result, beforePng: beforeShot.png, afterPng: afterShot.png });
    }
  }
} finally {
  await browser.close();
}

if (failure) {
  console.error(`\n[check:shots] FAILED — ${failure}\n`);
  process.exit(1);
}

if (!changes.length) {
  rmSync(runDir, { recursive: true, force: true });
  console.log(
    `[check:shots] OK — ${SHOT_SCENES.length} scene(s) render pixel-identically to ${mergeBase.slice(0, 8)}. ` +
    'Nothing filed, because there is nothing for a person to look at.'
  );
  process.exit(0);
}

const written = [];
for (const change of changes) {
  if (change.beforePng) {
    const p = path.join(runDir, `${change.scene.id}-before.png`);
    writeFileSync(p, change.beforePng);
    written.push(p);
  }
  const p = path.join(runDir, `${change.scene.id}-after.png`);
  writeFileSync(p, change.afterPng);
  written.push(p);
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const body =
  `**${changes.length} of ${SHOT_SCENES.length} scenes look different on \`${branch}\`.**\n\n` +
  'Each pair below is the same page rendered twice — once with the code as it is on `main`, once with ' +
  'this change. Nothing here judges whether the new one is better; that is what your eye is for.\n\n' +
  changes.map((c) => `- **${c.scene.title}** (\`${c.scene.id}\`) — ${c.result.summary}\n  _${c.scene.why}_`).join('\n') +
  `\n\nCompared against \`${mergeBase.slice(0, 8)}\`. Files that could have caused it:\n` +
  visual.slice(0, 20).map((f) => `- \`${f}\``).join('\n') +
  (visual.length > 20 ? `\n- …and ${visual.length - 20} more` : '') +
  '\n\n**If they look right**, move this ticket on. **If they do not**, say what is wrong in a comment and ' +
  'it goes back to the build loop.';

const bodyFile = path.join(runDir, 'body.md');
writeFileSync(bodyFile, body);

console.log(`\n[check:shots] ${changes.length} scene(s) changed. Images in ${path.relative(ROOT, runDir)}/`);

if (DRY_RUN || (!TASK_ID && !LIST_ID)) {
  console.log(
    DRY_RUN
      ? '[check:shots] --dry-run: nothing filed.'
      : '[check:shots] Nothing filed — add `--task <clickup-id>` to attach these to a ticket, ' +
        'or `--list <clickup-list-id>` to open a fresh review task for the operator.'
  );
  process.exit(0);
}

let taskId = TASK_ID;
if (!taskId) {
  const idFile = path.join(runDir, 'task-id');
  clickup([
    'task', '--list', LIST_ID,
    '--name', `Visual review: ${branch}`,
    '--body-file', bodyFile,
    '--status', 'Needs your input',
    '--id-out', idFile,
  ], 'creating the review task');
  taskId = readFileSync(idFile, 'utf8').trim();
} else {
  clickup(['comment', '--task', taskId, '--body-file', bodyFile], 'commenting on the task');
}

clickup(['attach', '--task', taskId, ...written.flatMap((f) => ['--file', f])], 'attaching the screenshots');
console.log(`[check:shots] ${written.length} image(s) filed on https://app.clickup.com/t/${taskId}`);
