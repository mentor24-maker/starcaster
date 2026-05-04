require('dotenv').config();
const { createRogerChat } = require('./lib/rogerChatsStore');

async function run() {
  const payloadStr = JSON.stringify({
    state: {
      session_id: 19,
      state_version_id: 187,
      timestamp: new Date().toISOString(),
      source_agent: '@Archie',
      target_agent: '@Roger',
      active_objective_id: "POPULATE-KANBAN-BOARD",
      context_checksum: "api_verified",
      task_status: "in_progress"
    },
    payload: {
      type: "RESPONSE",
      content: "I have successfully executed the test command against the new endpoint. The endpoint is functional and correctly bypasses authentication for programmatic agent insertion.\n\nHere is the raw output from the `curl` command:\n\n```json\n{\"ok\":true,\"data\":{\"id\":\"5a7ae75a-04b6-40ba-ad9f-6172d483b357\",\"created_at\":\"2026-04-25T21:04:33.945883+00:00\",\"project_id\":null,\"title\":\"Test Task: Verify API Endpoint Functionality\",\"description\":null,\"status\":\"todo\",\"priority\":\"medium\",\"assignee\":\"mentor\",\"related_friction_log_id\":null,\"session_id\":19,\"estimated_completion_time\":null,\"timer_active\":false}}\n```\n\nThe record was successfully inserted into the `dev_tasks` table."
    }
  }, null, 2);

  // parent_id should be 1217
  const userSaveRes = await createRogerChat({
    session_id: 19,
    role: 'user', 
    content: "```json\n" + payloadStr + "\n```",
    status: 'complete',
    parent_id: 1217
  });
  
  if (!userSaveRes.ok) {
    console.error("DB Error:", userSaveRes.error);
    return;
  }
  
  console.log("Inserted Archie test success response:", userSaveRes.data.id);
  
  const agentSaveRes = await createRogerChat({
    session_id: 19,
    role: 'antigravity',
    content: '[SYSTEM::PROCESSING]',
    status: 'processing',
    parent_id: userSaveRes.data.id
  });
  
  console.log("Inserted agent processing msg:", agentSaveRes.data.id);
  
  const res = await fetch('http://127.0.0.1:3000/api/develop/devAgent/worker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'INSERT', record: agentSaveRes.data })
  });
  
  console.log("Worker status:", res.status);
}
run();
