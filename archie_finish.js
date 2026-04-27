require('dotenv').config();
const { createRogerChat } = require('./lib/rogerChatsStore');

async function run() {
  const payloadStr = JSON.stringify({
    state: {
      session_id: 19,
      state_version_id: 185,
      timestamp: new Date().toISOString(),
      source_agent: '@Archie',
      target_agent: '@Roger',
      active_objective_id: "BUILD-TASK-API-ENDPOINT",
      context_checksum: "implemented",
      task_status: "completed"
    },
    payload: {
      type: "RESPONSE",
      content: "I have successfully created the `routes/tasks.js` file and registered it in `routes/index.js` to handle `POST /api/tasks`.\nNote: I adapted the Next.js snippet to fit the Express.js routing architecture used in the project, utilizing the `sbQuery` database client.\n\nExecution completed. The new endpoint is live and ready for testing or integration."
    }
  }, null, 2);

  // parent_id should be 1215
  const userSaveRes = await createRogerChat({
    session_id: 19,
    role: 'user', 
    content: "```json\n" + payloadStr + "\n```",
    status: 'complete',
    parent_id: 1215
  });
  
  if (!userSaveRes.ok) {
    console.error("DB Error:", userSaveRes.error);
    return;
  }
  
  console.log("Inserted Archie success response:", userSaveRes.data.id);
  
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
