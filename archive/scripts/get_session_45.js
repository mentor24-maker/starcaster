const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('roger_chats').select('*').eq('session_id', 45).order('created_at', { ascending: true });
  console.log(JSON.stringify(data, null, 2));
}

run();
