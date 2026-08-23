'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectSourceWrite, targetsWorktree, shouldBlockBashOnMain } = require('./mainGuard.js');

test('detects the write forms that bypassed the Edit-tool hook', () => {
  assert.ok(detectSourceWrite('cat > routes/publicSite.js <<EOF'));
  assert.ok(detectSourceWrite('echo x > lib/foo.js'));
  assert.ok(detectSourceWrite('printf y >> src/css/main.css'));
  assert.ok(detectSourceWrite('sed -i "" "s/a/b/" scripts/thing.cjs'));
  assert.ok(detectSourceWrite('cp /tmp/x.js lib/new.js'));
  assert.ok(detectSourceWrite('mv /tmp/a components/Widget.tsx'));
  assert.ok(detectSourceWrite("node -e \"require('fs').writeFileSync('lib/x.js','y')\""));
  assert.ok(detectSourceWrite("python3 - <<'PY'\nopen('lib/x.js','w').write('z')\nPY"));
});

test('does NOT flag legitimate non-source writes from the main folder', () => {
  assert.equal(detectSourceWrite('echo x > /tmp/scratch.txt'), '');
  assert.equal(detectSourceWrite('echo x > docs/WORK-LOG.md'), '');           // docs edited legitimately
  assert.equal(detectSourceWrite('cat file.txt > out.json'), '');
  assert.equal(detectSourceWrite('git status'), '');
  assert.equal(detectSourceWrite('npm run build'), '');
  assert.equal(detectSourceWrite('grep -r foo lib/'), '');                    // reads lib, does not write
  assert.equal(detectSourceWrite(''), '');
});

test('a worktree-targeted command is never the hazard', () => {
  assert.ok(targetsWorktree('cd .claude/worktrees/x && cat > lib/y.js <<EOF'));
  assert.equal(targetsWorktree('cat > lib/y.js <<EOF'), false);
});

test('shouldBlockBashOnMain: blocks a source write on main, only off a worktree', () => {
  assert.equal(shouldBlockBashOnMain('cat > lib/x.js <<EOF', { onMain: true }).block, true);
  // same command, but clearly in a worktree → allowed
  assert.equal(shouldBlockBashOnMain('cd .claude/worktrees/t && cat > lib/x.js <<EOF', { onMain: true }).block, false);
  // not on main → allowed
  assert.equal(shouldBlockBashOnMain('cat > lib/x.js <<EOF', { onMain: false }).block, false);
  // harmless command on main → allowed
  assert.equal(shouldBlockBashOnMain('git status', { onMain: true }).block, false);
});
