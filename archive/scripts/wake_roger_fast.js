const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const sessions = [37, 41];
  for (const session of sessions) {
    const { data, error } = await supabase
      .from('agent_messages')
      .insert([{
        session_id: session,
        role: 'roger',
        content: '[SYSTEM::QUEUED]',
        status: 'processing'
      }])
      .select();
      
    if (error) {
      console.error(error);
    } else {
      console.log(`Inserted queue for session ${session}:`, data[0].id);
      fetch('http://127.0.0.1:3000/api/develop/devAgent/worker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'INSERT', record: data[0] })
      }).catch(e => {}); // Async fire and forget
      console.log(`Worker pinged for session ${session}!`);
    }
  }
}
run();
