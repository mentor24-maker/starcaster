const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: task, error: taskError } = await supabase
    .from('dev_tasks')
    .select('*')
    .eq('id', 'add91dc2-a32d-4d47-9e55-018e69e47851')
    .single();
    
  if (taskError) {
    console.error("Task Error:", taskError);
    return;
  }
  
  console.log("Task Session ID:", task.session_id);
  
  const { data: messages, error: msgError } = await supabase
    .from('agent_messages')
    .select('*')
    .eq('session_id', task.session_id)
    .order('created_at', { ascending: true });
    
  if (msgError) {
    console.error("Message Error:", msgError);
  } else {
    console.log(JSON.stringify(messages, null, 2));
  }
}
run();
