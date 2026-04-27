require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('dev_tasks').select('*, dev_projects(name)').limit(1);
  console.log('Error:', error);
  console.log('Data length:', data ? data.length : 0);
}
run();
