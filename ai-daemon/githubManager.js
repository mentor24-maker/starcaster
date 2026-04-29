require('dotenv').config();
const { Octokit } = require('@octokit/rest');

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const octokit = new Octokit({
    auth: GITHUB_TOKEN
});

async function createPullRequest(branchName, taskTitle, taskDescription, taskId) {
    console.log(`Creating Pull Request for branch ${branchName}...`);
    
    try {
        const response = await octokit.rest.pulls.create({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            title: `AI Daemon: ${taskTitle}`,
            head: branchName,
            base: 'main', // The branch you want to merge into
            body: `### AI Daemon Automated PR\n\nThis Pull Request was generated automatically by the AI Daemon.\n\n**Task ID:** \`${taskId}\`\n**Description:**\n${taskDescription}\n\n---\n*Please review the changes. Vercel/Netlify preview URLs will be populated below automatically if configured.*`
        });
        
        console.log(`Pull Request created successfully! URL: ${response.data.html_url}`);
        return response.data.html_url;
    } catch (error) {
        console.error('Error creating Pull Request:', error.message);
        
        // If PR already exists, try to find it
        if (error.message.includes('A pull request already exists')) {
            console.log('Fetching existing PR...');
            const pulls = await octokit.rest.pulls.list({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                head: `${GITHUB_OWNER}:${branchName}`
            });
            if (pulls.data.length > 0) {
                return pulls.data[0].html_url;
            }
        }
        
        throw error;
    }
}

module.exports = {
    createPullRequest
};
