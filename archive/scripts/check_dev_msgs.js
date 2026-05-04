const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
supabase.from('dev_messages').select('id, role, content, session_id').order('created_at', { ascending: false }).limit(5).then(res => {
  console.log(JSON.stringify(res.data, null, 2));
}).catch(console.error);
