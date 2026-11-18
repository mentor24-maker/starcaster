#!/usr/bin/env node
'use strict';

/**
 * `npm run sql:handoff` — print the SQL handoff block(s), ready to paste, per
 * DOCTRINE.md §6.5.
 *
 *   npm run sql:handoff                         the SQL this branch adds, linked by its pushed commit
 *   npm run sql:handoff -- docs/SQL/<file>.sql  a named file (usually one already merged), linked by main
 *
 * The hook (scripts/hooks/require_sql_handoff.cjs) and the ticket door
 * (`npm run clickup -- ask` / `comment`) stop you forgetting. This stops you
 * getting it wrong: the URL is built from the real commit and the real file
 * path, the spacing is the spacing §6.5 specifies, and it refuses to print a
 * link that would not open.
 *
 * Links name a commit or `main`, never a branch: GitHub deletes a branch when
 * its pull request merges, and a branch link then opens nothing (SC-867).
 */

const fs = require('fs');
const path = require('path');
const {
  SQL_DIR,
  newSqlFiles,
  currentBranch,
  repoRoot,
  renderBlock,
  onMain,
  pushedCommit,
} = require('./lib/sql_handoff.cjs');

const root = repoRoot(process.cwd());
if (!root) {
  console.error('[sql:handoff] Not inside a git repository.');
  process.exit(1);
}

const named = process.argv.slice(2).map((arg) => {
  const base = path.basename(arg);
  return `${SQL_DIR}${base.endsWith('.sql') ? base : `${base}.sql`}`;
});

const branch = currentBranch(root);
const branchFiles = branch && branch !== 'main' && branch !== 'HEAD' ? newSqlFiles(root) : [];
const files = named.length ? named : branchFiles;

if (!files.length) {
  console.log(
    branch === 'main'
      ? '[sql:handoff] Name the file to hand over: npm run sql:handoff -- docs/SQL/<file>.sql'
      : '[sql:handoff] This branch adds no docs/SQL/*.sql files. Name one to hand over: npm run sql:handoff -- docs/SQL/<file>.sql'
  );
  process.exit(0);
}

const blocks = [];
for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`[sql:handoff] ${file} does not exist in this checkout.`);
    process.exit(1);
  }
  let ref = '';
  if (!branchFiles.includes(file) && onMain(root, file)) {
    ref = 'main';
  } else {
    ref = pushedCommit(root);
    if (!ref) {
      console.error(
        `[sql:handoff] ${file} is not on main and branch "${branch}" is not pushed, so the link would 404.\n` +
        `              Push it first, then run this again:\n\n` +
        `                git push -u origin ${branch}\n`
      );
      process.exit(1);
    }
  }
  blocks.push(renderBlock(ref, file));
}

console.log(
  `\n[sql:handoff] ${files.length} file(s) for the operator to run, in this order.\n` +
  `              Paste each block as PLAIN TEXT — never inside a code fence, or\n` +
  `              the link renders dead and he cannot click it. Two blank lines\n` +
  `              above and below each one. Say in one line, outside the block,\n` +
  `              what it changes and whether it touches anything existing.\n`
);

for (const block of blocks) {
  console.log('\n\n' + block + '\n\n');
}
