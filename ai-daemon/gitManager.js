require('dotenv').config();
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const WORKSPACE_DIR = path.resolve(process.env.WORKSPACE_DIR || './sandbox');

async function ensureSandbox() {
    if (!fs.existsSync(WORKSPACE_DIR)) {
        fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    }
}

async function prepareBranch(taskId) {
    await ensureSandbox();
    
    // We must clone via HTTPS using the token to push later without SSH keys
    const remoteUrl = `https://${GITHUB_TOKEN}@github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git`;
    
    const repoPath = path.join(WORKSPACE_DIR, GITHUB_REPO);
    
    // If repo exists, clean it and pull
    if (fs.existsSync(path.join(repoPath, '.git'))) {
        console.log(`Repository already exists at ${repoPath}. Fetching latest...`);
        const git = simpleGit(repoPath);
        await git.checkout('main'); // default branch
        await git.fetch();
        await git.pull('origin', 'main');
    } else {
        console.log(`Cloning repository into ${repoPath}...`);
        const git = simpleGit(WORKSPACE_DIR);
        await git.clone(remoteUrl, GITHUB_REPO);
    }
    
    const git = simpleGit(repoPath);
    
    // Configure local git user to use an environment variable or fall back to system default
    const daemonEmail = process.env.GITHUB_EMAIL || 'daemon@isitas.ai';
    await git.addConfig('user.name', 'AI Daemon');
    
    // Only set email if explicitly provided in .env, otherwise let Git use the global user.email
    if (process.env.GITHUB_EMAIL) {
        await git.addConfig('user.email', process.env.GITHUB_EMAIL);
    }
    
    // Check out new branch
    const branchName = `agent/task-${taskId.substring(0,8)}`;
    console.log(`Checking out branch ${branchName}...`);
    
    // check if branch already exists locally or remotely
    const branchSummary = await git.branch();
    if (branchSummary.all.includes(branchName) || branchSummary.all.includes(`remotes/origin/${branchName}`)) {
        await git.checkout(branchName);
        try {
            await git.pull('origin', branchName);
        } catch(e) {}
    } else {
        await git.checkoutLocalBranch(branchName);
    }
    
    return {
        repoPath,
        branchName
    };
}

async function commitAndPush(repoPath, branchName, taskTitle) {
    const git = simpleGit(repoPath);
    
    console.log(`Staging changes...`);
    await git.add('./*');
    
    const status = await git.status();
    if (status.isClean()) {
        console.log(`No changes detected for task: ${taskTitle}. Skipping commit/push.`);
        return false; // indicating no PR needed
    }
    
    console.log(`Committing changes...`);
    await git.commit(`feat: ${taskTitle}\n\nAutomated commit by AI Daemon.`);
    
    console.log(`Pushing branch ${branchName}...`);
    await git.push('origin', branchName, { '--set-upstream': null });
    
    return true; // PR is needed
}

module.exports = {
    prepareBranch,
    commitAndPush
};
