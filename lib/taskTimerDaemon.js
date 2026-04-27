'use strict';

const { sbQuery } = require('./supabase');
const { createRogerChat } = require('./rogerChatsStore');
const config = require('./config');

async function checkExpiredTimers() {
  try {
    const nowISO = new Date().toISOString();
    // Fetch all active tasks with an expired timer
    const tasksRes = await sbQuery({
      method: 'GET',
      table: 'dev_tasks',
      query: `select=id,session_id,project_id,assignee,title&timer_active=eq.true&estimated_completion_time=lte.${nowISO}`
    });

    if (!tasksRes.ok || !tasksRes.data || tasksRes.data.length === 0) {
      return; // No expired timers
    }

    for (const task of tasksRes.data) {
      console.log(`[TimerDaemon] Task ${task.id} (${task.title}) has expired. Notifying assignee: ${task.assignee}`);

      // 1. Disable timer to prevent re-triggering
      await sbQuery({
        method: 'PATCH',
        table: 'dev_tasks',
        query: `id=eq.${task.id}`,
        body: { timer_active: false }
      });

      // 2. Inject system prompt
      const systemPrompt = `**SYSTEM ALERT:** The estimated time for this task has elapsed. Please evaluate your progress. If you are not finished, provide a new estimated completion time. Otherwise, confirm completion.`;
      
      const rogerSaveRes = await createRogerChat({ 
        session_id: task.session_id, 
        project_id: task.project_id, 
        role: 'user', // We send it as 'user' so the agent responds to it
        content: systemPrompt 
      });

      if (!rogerSaveRes.ok) {
         console.error(`[TimerDaemon] Failed to inject system prompt for task ${task.id}`);
         continue;
      }

      // 3. Inject processing nodes for the agents
      const agent = task.assignee === 'mentor' ? 'roger' : task.assignee;
      const processingRes = await createRogerChat({ 
        session_id: task.session_id, 
        project_id: task.project_id, 
        role: agent, 
        status: 'processing', 
        content: '[SYSTEM::PROCESSING]' 
      });

      if (processingRes.ok) {
        // Trigger inference engine natively using fetch
        const port = config.get('port') || 3000;
        const triggerHost = `127.0.0.1:${port}`;
        fetch(`http://${triggerHost}/api/develop/devAgent/worker`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'INSERT', record: processingRes.data })
        }).catch(err => console.error("[TimerDaemon] Internal worker trigger failed:", err));
      }
    }
  } catch (error) {
    console.error('[TimerDaemon] Error checking timers:', error);
  }
}

function initTimerDaemon() {
  console.log('[TimerDaemon] Starting background timer daemon...');
  // Check every 30 seconds
  setInterval(checkExpiredTimers, 30000);
}

module.exports = { initTimerDaemon, checkExpiredTimers };
