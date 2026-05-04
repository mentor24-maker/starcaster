require('dotenv').config();
const { evaluateAndUpdateTaskStatus } = require('./lib/rogerChatsStore');
const { sbQuery } = require('./lib/supabase');

async function test() {
  console.log("Fetching tasks to get a session_id...");
  const tasksRes = await sbQuery({ method: 'GET', table: 'dev_tasks', query: 'select=id,status,session_id&limit=1' });
  if (tasksRes.data && tasksRes.data.length > 0) {
     const t = tasksRes.data[0];
     console.log(`Testing with Task ID: ${t.id}, session: ${t.session_id}, current_status: ${t.status}`);
     await evaluateAndUpdateTaskStatus(t.session_id);
     
     // Re-fetch to check if it changed
     const checkRes = await sbQuery({ method: 'GET', table: 'dev_tasks', query: `select=id,status&id=eq.${t.id}` });
     console.log("New task state:", checkRes.data[0]);
  } else {
     console.log("No tasks found.");
  }
}

test().catch(console.error);
