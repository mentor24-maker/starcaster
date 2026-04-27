require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const { data, error } = await supabase.from('dev_sessions').insert([{ name: 'Test Session', project_id: null }]).select().single();
  console.log('Data:', data);
  console.log('Error:', error);
}
run();
