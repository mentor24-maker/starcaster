'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { defaultHtmlTargets } = require('../pin_asset_versions.cjs');

/**
 * src/layout.html is committed SOURCE and must never be a pin target
 * (2026-08-24, task 86bbkh1nn). It was one for seven weeks after the
 * generated shell went gitignored, and that single redundancy produced most
 * of the repo's `?v=` merge conflicts, stale-pin CI failures and phantom
 * GitHub conflicts. Nothing but this test stops a future edit re-adding it —
 * the symptom of a regression is conflict churn nobody traces back for weeks.
 *
 * And the sibling trap, found in review: scripts that WRITE to the source
 * are the same bug through a different door. `bump_cache.js` stamped labels
 * into src/layout.html and, once the pinner stopped rewriting that file,
 * left committed source dirty in a way CI cannot see (a clean build does not
 * touch the file, so the tree-diff check passes over the damage).
 */

const repoRoot = path.resolve(__dirname, '..', '..');

test('src/layout.html is not a pin target', () => {
  const targets = defaultHtmlTargets(repoRoot);
  // Sanity floor first: an empty or tiny list would pass the exclusion check
  // while proving only that the function broke. The repo carries the four
  // generated static pages, app-shell and the legal pages at minimum.
  assert.ok(targets.length >= 5, `expected a real target list, got ${targets.length}: ${targets.join(', ')}`);
  assert.ok(
    !targets.some((p) => p.endsWith(path.join('src', 'layout.html'))),
    'src/layout.html is committed source and must never be pinned — see task 86bbkh1nn'
  );
  // Everything it DOES target lives in public/ — the generated side.
  for (const t of targets) {
    assert.ok(
      path.relative(repoRoot, t).startsWith('public' + path.sep),
      `pin target outside public/: ${t} — pins belong only on generated output`
    );
  }
});

test('bump_cache.js does not write to committed source', () => {
  // The script rebuilds and stamps generated public/*.html. Assert the
  // property at the source level — no reference to src/layout.html as a
  // WRITE target — rather than executing it (running it would rebuild the
  // whole shell inside a unit test).
  const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'bump_cache.js'), 'utf8');
  assert.ok(
    !/writeFileSync\([^)]*layout/.test(src),
    'bump_cache.js must never write src/layout.html — that is the exact bug from the 2026-08-24 review'
  );
  assert.match(src, /publicDir/, 'the stamp targets the generated public/ files');
});

test('defaultHtmlTargets works on a bare directory, so the floor is honest', () => {
  // Prove the sanity floor is measuring the real repo rather than a happy
  // accident: on an empty scratch root the function returns nothing, which
  // is exactly the state the floor exists to catch.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-targets-'));
  try {
    fs.mkdirSync(path.join(scratch, 'public'));
    assert.equal(defaultHtmlTargets(scratch).length, 0);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
