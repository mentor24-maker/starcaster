const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('agent_messages')
    .select('id, role, content, status, created_at')
    .eq('session_id', 39)
    .order('created_at', { ascending: true });
  
  if (error) console.error(error);
  else console.log(JSON.stringify(data, null, 2));
}
run();
