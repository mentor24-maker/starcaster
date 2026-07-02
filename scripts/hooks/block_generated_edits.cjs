#!/usr/bin/env node
'use strict';

/**
 * Claude Code PreToolUse hook (Edit|Write).
 * Blocks direct edits to generated files and points the agent at the
 * source + rebuild command instead. Exit 2 = block the tool call.
 *
 * Generated-file map: keep in sync with CLAUDE.md and
 * scripts/check_conventions.cjs.
 */

const path = require('path');

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
