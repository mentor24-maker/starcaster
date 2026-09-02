'use strict';
/**
 * ONE answer to "is this file a build artifact?".
 *
 * Two gates need it and must never disagree: `check_conventions.cjs` refuses to
 * commit an artifact, and `check_syntax.cjs` refuses to PARSE one. The second
 * matters because of landmine 14 — a generated file under `lib/builder/` does
 * not exist at CI time (vitest and the syntax gate both run before
 * `npm run build`), so a checker that insisted on reading it would fail CI
 * forever while passing on every developer's machine.
 *
 * Keep in sync with the "Build artifacts" block in `.gitignore`, the artifact
 * table in `CLAUDE.md`, and `scripts/hooks/block_generated_edits.cjs`.
 */

/**
 * Individual artifacts, by repo-relative path. `check_conventions.cjs` feeds
 * this straight to `git ls-files`, so every entry has to be a concrete path
 * rather than a pattern.
 */
const GENERATED = [
  'public/app-shell.html',
  'public/about.html',
  'public/site.html',
  'public/explore.html',
  'public/builder-preview.html',
  'public/privacy-policy.html',
  'public/terms-of-service.html',
  'public/data-deletion.html',
  'public/styles.css',
  'public/bundle.js',
  'public/builder-bundle.js',
  'public/js/richtext-vendor.js',
  'lib/builder/template.js',
  'lib/builder/email-template.js',
  'lib/builder/template-frame.js',
  'lib/builder/email-render.js',
  'lib/site-import/dist/normalize.js',
  'lib/site-import/dist/crawl.js',
  'lib/site-import/dist/capture-playwright.js',
];

/**
 * Directories generated wholesale. `.gitignore` ignores the folder, not the
 * three files above, so a fourth output landing there is still an artifact
 * even though nobody remembered to name it here.
 */
const GENERATED_DIR_PREFIXES = ['lib/site-import/dist/'];

/** Is this repo-relative path (POSIX separators) a build artifact? */
function isGenerated(relPath) {
  const rel = String(relPath || '').split('\\').join('/');
  if (GENERATED.includes(rel)) return true;
  return GENERATED_DIR_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

module.exports = { GENERATED, GENERATED_DIR_PREFIXES, isGenerated };
