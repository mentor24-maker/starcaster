const fs = require('fs');

const routeCode = `
  if (pathname === '/api/develop/devAgent/git-status' && requestMethod === 'GET') {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const cmds = [
        'git log -1 --format=%cd',
        'git log -1 --format=%cd origin/main || echo "No origin/main"',
        'git rev-list origin/main..HEAD --count || echo "0"',
        'git status --porcelain | wc -l',
        'git branch --show-current'
      ];
      
      exec(cmds.join(' && '), (error, stdout, stderr) => {
        if (error) {
          console.error('[Git Status Error]', error);
          resolve(sendErr(res, 500, 'Git command failed'));
          return;
        }
        const lines = stdout.trim().split('\\n');
        resolve(sendOk(res, 200, {
          lastCommitDate: lines[0],
          lastPushDate: lines[1],
          unpushedCommits: parseInt(lines[2]) || 0,
          uncommittedFiles: parseInt(lines[3]) || 0,
          currentBranch: lines[4]
        }));
      });
    }).then(() => true);
  }
`;

let content = fs.readFileSync('routes/devAgent.js', 'utf8');

if (!content.includes('/api/develop/devAgent/git-status')) {
  // Insert before the final "return false;" in the handle function
  content = content.replace(
    '  return false;\n}\n\nmodule.exports = { manifest, handle };',
    routeCode + '\n  return false;\n}\n\nmodule.exports = { manifest, handle };'
  );
  fs.writeFileSync('routes/devAgent.js', content, 'utf8');
  console.log('Route injected successfully.');
} else {
  console.log('Route already exists.');
}
