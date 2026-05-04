const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
async function run() {
  const team = await supabase.from('dev_team').select('*');
  const roles = await supabase.from('dev_roles').select('*');
  console.log('Team:', team.data);
  console.log('Roles:', roles.data);
}
run();
