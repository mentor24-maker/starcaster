const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
async function test() {
  const { data, error } = await supabase.from('dev_tasks').select('*, dev_projects(name)').order('created_at', { ascending: false });
  console.log("Error:", error);
  console.log("Tasks:", data);
}
test();
