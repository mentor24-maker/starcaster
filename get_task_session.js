const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('dev_tasks')
    .select('*')
    .eq('id', '1D35F945-3939-495d-9075-8ef5d12e54e8'.toLowerCase())
    .single();
  
  if (error) console.error(error);
  else console.log("Session ID:", data.session_id);
}
run();
