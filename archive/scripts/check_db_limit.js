require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY.trim();
  const supabase = createClient(url, key);
  
  const { data, error } = await supabase.from('agent_messages')
    .select('*')
    .eq('session_id', 17)
    .order('created_at', { ascending: false })
    .limit(100);
    
  if (error) throw error;
  
  console.log("Returned messages count:", data.length);
}

run().catch(console.error);
