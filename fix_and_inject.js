require('dotenv').config();
const fs = require('fs');

async function run() {
  const fileContent = fs.readFileSync('task_api_discovery.md', 'utf8');
  
  const { createClient } = require('@supabase/supabase-js');
  const config = require('./lib/config');
  const url = config.get('supabaseUrl');
  const anonKey = config.get('supabaseAnonKey');
  const supabase = createClient(url, anonKey);
  
  const payloadStr = JSON.stringify({
    state: {
      session_id: 19,
      state_version_id: 173,
      timestamp: new Date().toISOString(),
      source_agent: '@Mentor',
      target_agent: '@Archie',
      active_objective_id: "ACTIVE-SESSION",
      context_checksum: "resolved"
    },
    payload: {
      type: "QUERY",
      content: "Here are the results of the `cat task_api_discovery.md` command for @Archie:\n\n" + fileContent
    }
  }, null, 2);

  const { data, error } = await supabase.from('agent_messages').insert([{
    session_id: 19,
    role: 'user',
    content: "```json\n" + payloadStr + "\n```",
    status: 'complete',
    parent_id: 1200
  }]).select().single();
  
  if (error) {
    console.error("DB Error:", error);
    return;
  }
  
  console.log("Inserted user msg:", data.id);
  
  const agentOptions = { session_id: 19, role: 'archie', status: 'processing', content: '[SYSTEM::PROCESSING]', parent_id: data.id };
  const { data: agentData, error: agentErr } = await supabase.from('agent_messages').insert([agentOptions]).select().single();
  
  if (agentErr) {
    console.error("Agent insert error:", agentErr);
    return;
  }
  
  console.log("Inserted agent processing msg:", agentData.id);
  
  const res = await fetch('http://127.0.0.1:3000/api/develop/devAgent/worker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'INSERT', record: agentData })
  });
  
  console.log("Worker status:", res.status);
}

run();
