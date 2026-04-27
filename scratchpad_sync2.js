const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('agent_messages')
    .select('id, role, content, status, created_at, session_id')
    .order('created_at', { ascending: false })
    .limit(10);
  
  data.forEach(msg => {
    console.log(`[${msg.created_at}] Session: ${msg.session_id} | Role: ${msg.role}`);
  });
}
run();
