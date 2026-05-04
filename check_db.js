const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const r1 = await supabase.from('dev_projects').select('id');
  const r2 = await supabase.from('dev_team').select('id');
  const r3 = await supabase.from('dev_roles').select('id');
  
  console.log('Projects:', r1.data?.length, 'error:', r1.error);
  console.log('Team:', r2.data?.length, 'error:', r2.error);
  console.log('Roles:', r3.data?.length, 'error:', r3.error);
}

check();
