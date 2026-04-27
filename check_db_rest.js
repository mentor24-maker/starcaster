require('dotenv').config({ path: '.env' });

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY.trim();
  
  const res = await fetch(`${url}/rest/v1/dev_sessions?select=id,name,created_at`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  const sessions = await res.json();
  
  for (const s of sessions) {
    const mRes = await fetch(`${url}/rest/v1/agent_messages?select=id&session_id=eq.${s.id}`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    const msgs = await mRes.json();
    s.msgCount = msgs.length || 0;
  }
  
  const tRes = await fetch(`${url}/rest/v1/dev_tasks?select=id,title,session_id`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  const tasks = await tRes.json();
  
  console.log("Tasks:");
  console.table(tasks);
  
  console.log("\nSessions:");
  console.table(sessions.map(s => ({ id: s.id, name: s.name, msgCount: s.msgCount })));
}

run().catch(console.error);
