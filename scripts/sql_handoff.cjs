#!/usr/bin/env node
'use strict';

/**
 * `npm run sql:handoff` — print the SQL handoff block(s) for this branch,
 * ready to paste, per DOCTRINE.md §6.5.
 *
 * The hook (scripts/hooks/require_sql_handoff.cjs) stops you forgetting.
 * This stops you getting it wrong: the URL is built from the real branch name
 * and the real file path, the spacing is the spacing §6.5 specifies, and it
 * refuses to print anything until the branch is pushed and the URL would
 * actually resolve.
 */

const {
  newSqlFiles,
  currentBranch,
  repoRoot,
  isPushed,
  renderBlock,
} = require('./lib/sql_handoff.cjs');

const root = repoRoot(process.cwd());
if (!root) {
  console.error('[sql:handoff] Not inside a git repository.');
  process.exit(1);
}

const branch = currentBranch(root);
if (branch === 'main') {
  console.error(
    '[sql:handoff] You are on main. The handoff URL has to point at the topic\n' +
    '              branch that carries the file — run this from that worktree.'
  );
  process.exit(1);
}

const files = newSqlFiles(root);
if (!files.length) {
  console.log('[sql:handoff] This branch adds no docs/SQL/*.sql files. Nothing to hand off.');
  process.exit(0);
}

if (!isPushed(root)) {
  console.error(
    `[sql:handoff] Branch "${branch}" is not pushed, so the GitHub URL would 404.\n` +
    `              Push it first, then run this again:\n\n` +
    `                git push -u origin ${branch}\n`
  );
  process.exit(1);
}

console.log(
  `\n[sql:handoff] ${files.length} file(s) for the operator to run, in this order.\n` +
  `              Paste each block as PLAIN TEXT — never inside a code fence, or\n` +
  `              the link renders dead and he cannot click it. Two blank lines\n` +
  `              above and below each one. Say in one line, outside the block,\n` +
  `              what it changes and whether it touches anything existing.\n`
);

for (const file of files) {
  console.log('\n' + renderBlock(branch, file) + '\n');
}
