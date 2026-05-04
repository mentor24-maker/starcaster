require('dotenv').config();
const fs = require('fs');
const { createRogerChat } = require('./lib/rogerChatsStore');

async function run() {
  const fileContent = fs.readFileSync('task_api_discovery.md', 'utf8');
  
  const payloadStr = JSON.stringify({
    state: {
      session_id: 19,
      state_version_id: 175,
      timestamp: new Date().toISOString(),
      source_agent: '@Archie',
      target_agent: '@Roger',
      active_objective_id: "ACTIVE-SESSION",
      context_checksum: "resolved"
    },
    payload: {
      type: "RESPONSE",
      content: "Here are the results of the `cat task_api_discovery.md` command for @Roger to proceed:\n\n" + fileContent
    }
  }, null, 2);

  // parent_id should be the ID of message 1202
  const userSaveRes = await createRogerChat({
    session_id: 19,
    role: 'user', // We send it as 'user' so it looks like it came from the human terminal proxy
    content: "```json\n" + payloadStr + "\n```",
    status: 'complete',
    parent_id: 1202
  });
  
  if (!userSaveRes.ok) {
    console.error("DB Error:", userSaveRes.error);
    return;
  }
  
  console.log("Inserted mock terminal response:", userSaveRes.data.id);
  
  // Now trigger the next agent
  const agentSaveRes = await createRogerChat({
    session_id: 19,
    role: 'antigravity',
    content: '[SYSTEM::PROCESSING]',
    status: 'processing',
    parent_id: userSaveRes.data.id
  });
  
  console.log("Inserted agent processing msg:", agentSaveRes.data.id);
  
  // Call worker
  const res = await fetch('http://127.0.0.1:3000/api/develop/devAgent/worker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'INSERT', record: agentSaveRes.data })
  });
  
  console.log("Worker status:", res.status);
}
run();
