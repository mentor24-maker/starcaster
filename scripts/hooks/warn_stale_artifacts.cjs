#!/usr/bin/env node
'use strict';

/**
 * Claude Code PostToolUse hook (Edit|Write).
 * After an edit to a build-source file, reminds the agent which artifact
 * is now stale and how to rebuild it. Exit 2 = surface stderr to the
 * agent (the edit itself already succeeded).
 */

const path = require('path');

const RULES = [
  { test: (p) => p.startsWith('src/css/') && p.endsWith('.css'),
    msg: 'public/styles.css is now stale — run: npm run build:css' },
  { test: (p) => (p.startsWith('src/pages/') || p.startsWith('src/legal/') || p === 'src/layout.html') && p.endsWith('.html'),
    msg: 'public/app-shell.html (and legal pages) are now stale — run: npm run build:html' },
  { test: (p) => p === 'lib/builder-client/builder-template.ts' || p === 'lib/builder-client/builder-email-template.ts',
    msg: 'SERVER BUNDLE STALE: run `npm run build:builder-template` or new module types are silently coerced to "text" on load. Then: npm run build:builder' },
  { test: (p) => (p.startsWith('components/') || p.startsWith('lib/builder-client/'))
      && /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p),
    msg: 'public/builder-bundle.js is now stale — run: npm run build:builder' },
];

function main(input) {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const filePath = String(payload?.tool_input?.file_path || '');
  if (!filePath) process.exit(0);

  const root = String(process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, '..', '..'));
  const rel = path.relative(root, path.resolve(filePath)).split(path.sep).join('/');

  const rule = RULES.find((r) => r.test(rel));
  if (!rule) process.exit(0);

  process.stderr.write(`[stale-artifact] ${rule.msg}\n`);
  process.exit(2);
}

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => main(stdin));
