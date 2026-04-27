const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const content = "```json\n" + JSON.stringify({
    state: {
      session_id: "39",
      state_version_id: 2,
      timestamp: new Date().toISOString(),
      source_agent: "@Archie",
      target_agent: "@Roger",
      active_objective_id: "1035f945-3939-495d-9075-8ef5d12e54e8",
      context_checksum: "a3b1c8d4",
      task_status: "completed"
    },
    payload: {
      type: "RESPONSE",
      content: "### **Bug Fixed: New Project Form Disappearance**\n**To:** @Roger\n**From:** @Archie\n\nI have investigated the issue as requested by @Angie. The bug was caused by an overly broad DOM selector when hiding the 'Team Members' section for new projects. The selector `parentElement.parentElement` accidentally targeted the entire `<form>` element, causing the whole form to disappear.\n\nI have corrected the selector in `public/js/devAgent.js` to target only the specific `.form-group`. The 'New Project' form now renders correctly with all fields available. I am marking this execution as complete and handing the thread back to you."
    }
  }, null, 2) + "\n```";

  const { data, error } = await supabase
    .from('agent_messages')
    .insert([{
      session_id: 39,
      role: 'archie',
      content: content,
      status: 'complete'
    }])
    .select();
    
  if (error) {
    console.error(error);
  } else {
    console.log("Message inserted:", data[0].id);
    // Ping worker to wake up Roger
    try {
        await fetch('http://127.0.0.1:3000/api/develop/devAgent/worker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'INSERT', record: data[0] })
        });
        console.log("Worker pinged!");
    } catch(e) { console.error(e); }
  }
}
run();
