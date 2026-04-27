require('dotenv').config({ path: '.env' });

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY.trim();
  
  const mRes = await fetch(`${url}/rest/v1/agent_messages?select=id,role,content,status,created_at&session_id=eq.17&order=created_at.desc&limit=10`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  const msgs = await mRes.json();
  
  console.log("Last 10 messages for Session 17:");
  for (const m of msgs.reverse()) {
    console.log(`[${m.created_at}] ${m.role} (${m.status}):`);
    console.log(m.content.substring(0, 100).replace(/\n/g, ' ') + "...");
    console.log("---");
  }
}

run().catch(console.error);
