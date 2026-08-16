#!/usr/bin/env node
'use strict';

/**
 * Claude Code PreToolUse hook (Edit|Write).
 * Blocks direct edits to generated files and points the agent at the
 * source + rebuild command instead. Exit 2 = block the tool call.
 *
 * Generated-file map: keep in sync with CLAUDE.md and
 * scripts/check_conventions.cjs.
 *
 * TWO CATEGORIES, and the second one is why this hook exists at all now.
 *
 * GENERATED are gitignored build artifacts: edit the source, run the rebuild.
 *
 * REPLACED_WHOLESALE are files that ARE committed to git and look completely
 * ordinary in an editor, but a script rewrites them end to end. A hand edit
 * survives until the next regeneration and then vanishes with no error and no
 * test failure. `_builder-react.css` lost the CRM modal styles that way in
 * commit 2bd3018 and Contacts delete stayed broken for a month.
 *
 * That rule was already written down — MODULE_UI_DOCTRINE R2 — and already
 * enforced by check_conventions. Both fire at COMMIT time, which is after the
 * edit, the rebuild, the screenshots and the verification are all done. The
 * operator reported on 2026-08-15 that agents fall into it "every time".
 * Blocking the Edit call is the only version of this rule that lands before
 * the work is wasted, so it stops depending on an agent reading the doctrine
 * at the right moment.
 */

const path = require('path');

/**
 * Committed files that a script rewrites in full. Not "rebuild it" — the fix
 * is to put the hand-written rule somewhere the regeneration cannot reach.
 */
const REPLACED_WHOLESALE = [
  {
    file: 'src/css/_builder-react.css',
    regenerator: 'scripts/extract_builder_css.mjs (npm run extract:builder-css)',
    instead: 'src/css/_builder-react-overrides.css — imported after this file, so it wins',
    incident: 'commit 2bd3018 regenerated it and silently deleted the CRM modal styles, '
      + 'breaking Contacts delete for a month. Nothing tests CSS, so the deletion was silent.',
  },
];

const GENERATED = [
  { file: 'public/app-shell.html', source: 'src/layout.html + src/pages/**', cmd: 'npm run build:html' },
  { file: 'public/privacy-policy.html', source: 'src/legal/_privacy-body.html', cmd: 'npm run build:html' },
  { file: 'public/terms-of-service.html', source: 'src/legal/_terms-body.html', cmd: 'npm run build:html' },
  { file: 'public/data-deletion.html', source: 'src/legal/_data-deletion-body.html', cmd: 'npm run build:html' },
  { file: 'public/styles.css', source: 'src/css/*.css (via main.css)', cmd: 'npm run build:css' },
  { file: 'public/builder-bundle.js', source: 'components/** + lib/builder-client/**', cmd: 'npm run build:builder' },
  { file: 'public/bundle.js', source: 'react-entry.js + campaigns components', cmd: 'npx esbuild react-entry.js --bundle --outfile=public/bundle.js --loader:.js=jsx' },
  { file: 'public/js/richtext-vendor.js', source: 'public/js/richtext-vendor-entry.js', cmd: 'npm run build:richtext' },
  { file: 'lib/builder/template.js', source: 'lib/builder-client/builder-template.ts', cmd: 'npm run build:builder-template' },
  { file: 'lib/builder/email-template.js', source: 'lib/builder-client/builder-email-template.ts', cmd: 'npm run build:builder-template' },
  { file: 'lib/builder/email-render.js', source: 'lib/builder-client (email render entry)', cmd: 'npm run build:builder-email-render' },
  { file: 'lib/site-import/dist/normalize.js', source: 'lib/site-import/*.ts', cmd: 'npm run build:site-import' },
  { file: 'lib/site-import/dist/crawl.js', source: 'lib/site-import/*.ts', cmd: 'npm run build:site-import' },
  { file: 'lib/site-import/dist/capture-playwright.js', source: 'lib/site-import/*.ts', cmd: 'npm run build:site-import' },
];

function main(input) {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // unparseable — don't block
  }

  const filePath = String(payload?.tool_input?.file_path || '');
  if (!filePath) process.exit(0);

  const root = String(process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, '..', '..'));
  const rel = path.relative(root, path.resolve(filePath)).split(path.sep).join('/');

  const wholesale = REPLACED_WHOLESALE.find((g) => g.file === rel);
  if (wholesale) {
    process.stderr.write(
      `BLOCKED: ${rel} is committed to git but REGENERATED WHOLESALE by\n` +
      `${wholesale.regenerator}. It replaces the whole file, so a hand edit here\n` +
      `survives until the next regeneration and then disappears — no error, no failing test.\n` +
      `\n` +
      `Put the rule here instead: ${wholesale.instead}\n` +
      `\n` +
      `Incident: ${wholesale.incident}\n` +
      `(Doctrine: docs/MODULE_UI_DOCTRINE.md R2.)\n`
    );
    process.exit(2);
  }

  const hit = GENERATED.find((g) => g.file === rel);
  if (!hit) process.exit(0);

  process.stderr.write(
    `BLOCKED: ${rel} is a generated build artifact — direct edits are wiped on the next build.\n` +
    `Edit the source instead: ${hit.source}\n` +
    `Then regenerate with: ${hit.cmd}\n` +
    `(See CLAUDE.md "Generated files".)\n`
  );
  process.exit(2);
}

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => main(stdin));
