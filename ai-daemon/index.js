require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { prepareBranch, commitAndPush } = require('./gitManager');
const { createPullRequest } = require('./githubManager');
const { executeTask } = require('./executor');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const DAEMON_AGENT_ID = process.env.DAEMON_AGENT_ID || 'daemon';

console.log(`Starting AI Daemon. Listening for tasks assigned to: ${DAEMON_AGENT_ID}`);

async function handleTask(task) {
    console.log(`\n--- Received New Task ---`);
    console.log(`ID: ${task.id}`);
    console.log(`Title: ${task.title}`);
    
    try {
        // 1. Prepare Sandbox & Branch
        const { repoPath, branchName } = await prepareBranch(task.id);
        
        // 2. Execute Task logic (modify files in repoPath)
        await executeTask(task.id, task.title, task.description, repoPath);
        
        // 3. Commit and Push
        const needsPR = await commitAndPush(repoPath, branchName, task.title);
        
        if (needsPR) {
            // 4. Create PR
            const prUrl = await createPullRequest(branchName, task.title, task.description, task.id);
            
            // 5. Update Task in DB with PR URL and complete status
            await supabase
                .from('dev_tasks')
                .update({ 
                    status: 'review', 
                    description: task.description + `\n\n--- \n**Daemon Status:** PR Created -> ${prUrl}`
                })
                .eq('id', task.id);
                
            // 6. Post message to Forum Discussion
            await supabase
                .from('agent_messages')
                .insert({
                    task_id: task.id,
                    sender: DAEMON_AGENT_ID,
                    receiver: 'user', // Adjust if you use a specific user handle
                    message: `I have completed the code modifications for **${task.title}** and pushed them to a secure branch.\n\n[🔍 Click here to Review the PR and Preview URL](${prUrl})`
                });
                
            console.log(`Task ${task.id} moved to 'review' state and forum message posted.`);
        } else {
            console.log(`No changes made. Leaving task as in_progress.`);
        }
        
    } catch (error) {
        console.error(`Error processing task ${task.id}:`, error);
        // Optionally update task status to 'failed' if that's a valid status
    }
}

// Check for existing tasks on startup
async function checkInitialTasks() {
    const { data, error } = await supabase
        .from('dev_tasks')
        .select('*')
        .eq('status', 'in_progress')
        .eq('assignee', DAEMON_AGENT_ID);
        
    if (error) {
        console.error('Error fetching initial tasks:', error);
        return;
    }
    
    console.log(`Found ${data.length} tasks currently assigned and in_progress.`);
    for (const task of data) {
        await handleTask(task);
    }
}

// Setup Realtime Subscription
const subscription = supabase
  .channel('daemon-tasks-channel')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'dev_tasks',
      filter: `assignee=eq.${DAEMON_AGENT_ID}`
    },
    (payload) => {
      const newTask = payload.new;
      const oldTask = payload.old;
      
      // If it transitioned to in_progress
      if (newTask.status === 'in_progress' && oldTask.status !== 'in_progress') {
          handleTask(newTask);
      }
    }
  )
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'dev_tasks',
      filter: `assignee=eq.${DAEMON_AGENT_ID}`
    },
    (payload) => {
      const newTask = payload.new;
      if (newTask.status === 'in_progress') {
          handleTask(newTask);
      }
    }
  )
  .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to Supabase Realtime for dev_tasks.');
          checkInitialTasks();
      }
  });
