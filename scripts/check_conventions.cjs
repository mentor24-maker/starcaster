#!/usr/bin/env node
'use strict';

/**
 * scripts/check_conventions.cjs — deterministic repo-convention checks.
 *
 * Default mode inspects the STAGED diff (runs from the pre-commit hook);
 * `--all` scans the working tree (for CI).
 *
 * Escape hatch: SKIP_CONVENTIONS=1 git commit ...   (or git commit --no-verify)
 * If you bypass, say so in the commit/PR description.
 *
 * Checks:
 *   1. Stale artifacts — build-source files staged without their generated
 *      artifact (and the builder-template dual-registration landmine).
 *   2. public/js/ freeze — no NEW .js files there (see public/js/CLAUDE.md).
 *   3. No <button>/<a> inside <th> (sort id goes on the <th> itself).
 */

const { execSync } = require('child_process');

const MODE_ALL = process.argv.includes('--all');
const failures = [];

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function stagedFiles(filter) {
  const flag = filter ? ` --diff-filter=${filter}` : '';
  return sh(`git diff --cached --name-only${flag}`).split('\n').map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 1. Artifact pairing — source staged ⇒ artifact staged
// ---------------------------------------------------------------------------

const PAIRINGS = [
  {
    sources: (f) => f.startsWith('src/css/') && f.endsWith('.css'),
    artifacts: ['public/styles.css'],
    fix: 'npm run build:css && git add public/styles.css',
  },
  {
    sources: (f) => (f.startsWith('src/pages/') || f === 'src/layout.html') && f.endsWith('.html'),
    artifacts: ['public/app-shell.html'],
    fix: 'npm run build:html && git add public/app-shell.html',
  },
  {
    sources: (f) => f.startsWith('src/legal/') && f.endsWith('.html'),
    artifacts: ['public/privacy-policy.html', 'public/terms-of-service.html', 'public/data-deletion.html'],
    anyArtifact: true,
    fix: 'npm run build:html && git add public/privacy-policy.html public/terms-of-service.html public/data-deletion.html',
  },
  {
    sources: (f) => f === 'lib/builder-client/builder-template.ts' || f === 'lib/builder-client/builder-email-template.ts',
    artifacts: ['lib/builder/template.js', 'lib/builder/email-template.js'],
    anyArtifact: true,
    fix: 'npm run build:builder-template && git add lib/builder/template.js lib/builder/email-template.js  # LANDMINE: without this, new module types silently coerce to "text"',
  },
  {
    sources: (f) => (f.startsWith('components/') || f.startsWith('lib/builder-client/'))
      && /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !f.endsWith('CLAUDE.md'),
    artifacts: ['public/builder-bundle.js'],
    fix: 'npm run build:builder && git add public/builder-bundle.js',
  },
];

function checkArtifactPairings(files) {
  const staged = new Set(files);
  for (const pair of PAIRINGS) {
    const touchedSources = files.filter(pair.sources);
    if (!touchedSources.length) continue;
    const satisfied = pair.anyArtifact
      ? pair.artifacts.some((a) => staged.has(a))
      : pair.artifacts.every((a) => staged.has(a));
    if (!satisfied) {
      failures.push(
        `Stale artifact: staged ${touchedSources.join(', ')} without ${pair.artifacts.join(' / ')}.\n` +
        `  Fix: ${pair.fix}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 2. public/js freeze — no new .js files
// ---------------------------------------------------------------------------

function checkPublicJsFreeze(addedFiles) {
  const offenders = addedFiles.filter((f) => f.startsWith('public/js/') && f.endsWith('.js'));
  if (offenders.length) {
    failures.push(
      `public/js/ is frozen — new files are not allowed: ${offenders.join(', ')}\n` +
      '  New admin UI goes in components/ + lib/builder-client/ (see public/js/CLAUDE.md).'
    );
  }
}

// ---------------------------------------------------------------------------
// 3. No interactive elements inside <th>
// ---------------------------------------------------------------------------

const TH_BUTTON_RE = /<th\b[^>]*>(?:(?!<\/th>)[\s\S])*?<(?:button|a)[\s>]/i;

function checkButtonInTh() {
  if (MODE_ALL) {
    const files = sh("git ls-files 'src/pages/*.html' 'src/pages/**/*.html' 'public/js/*.js'")
      .split('\n').filter(Boolean);
    for (const file of files) {
      const content = require('fs').readFileSync(file, 'utf8');
      if (TH_BUTTON_RE.test(content)) {
        failures.push(`Interactive element inside <th> in ${file} — put the sort id on the <th>, not a nested button/link.`);
      }
    }
    return;
  }
  // Staged mode: only inspect added lines.
  const diff = sh('git diff --cached --unified=0 -- src/pages public/js components');
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  for (const line of added) {
    if (/<th\b[^>]*>\s*<(button|a)[\s>]/i.test(line)) {
      failures.push(`Interactive element inside <th> in staged change: ${line.slice(0, 120)}\n  Put the sort id on the <th> itself (see src/css/CLAUDE.md).`);
    }
  }
}

// ---------------------------------------------------------------------------

function main() {
  if (String(process.env.SKIP_CONVENTIONS || '') === '1') {
    console.log('[conventions] SKIP_CONVENTIONS=1 — checks bypassed.');
    return;
  }

  if (MODE_ALL) {
    checkButtonInTh();
  } else {
    const files = stagedFiles();
    if (!files.length) return;
    checkArtifactPairings(files);
    checkPublicJsFreeze(stagedFiles('A'));
    checkButtonInTh();
  }

  if (failures.length) {
    console.error('\n[conventions] Commit blocked — fix the following (or SKIP_CONVENTIONS=1 with a stated reason):\n');
    for (const f of failures) console.error(`  ✗ ${f}\n`);
    process.exit(1);
  }
  console.log('[conventions] All checks passed.');
}

main();
