require('dotenv').config({ path: '.env' });

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY.trim();
  
  const mRes = await fetch(`${url}/rest/v1/agent_messages?select=id,role,content,status,created_at&session_id=eq.18&order=created_at.asc&limit=10&offset=6`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  const msgs = await mRes.json();
  
  console.log(JSON.stringify(msgs[0], null, 2));
}

run().catch(console.error);
