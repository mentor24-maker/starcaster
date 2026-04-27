const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const activeSessionId = 38;

  const userMessage = "@Roger_Thorson Let's keep both styles, but we can make them both exactly the same for now. I'll decide how to tweak the secondary later.";

  console.log("Inserting User message for session:", activeSessionId);
  const { data: myMsg, error: myErr } = await supabase
    .from('agent_messages')
    .insert([
      {
        session_id: activeSessionId,
        role: "user",
        content: userMessage,
        status: "completed"
      }
    ])
    .select()
    .single();

  if (myErr) {
    console.error("Error inserting User message:", myErr);
    return;
  }
  console.log("User message inserted.");

  console.log("Inserting processing node for Antigravity (Roger Thorson)...");
  const { data: qMsg, error: qErr } = await supabase
    .from('agent_messages')
    .insert([
      {
        session_id: activeSessionId,
        role: "antigravity",
        content: "[SYSTEM::PROCESSING]",
        status: "processing",
        parent_id: myMsg.id
      }
    ])
    .select()
    .single();

  if (qErr) {
    console.error("Error inserting queued message:", qErr);
    return;
  }
  console.log("Processing node inserted. Triggering worker...");

  try {
    const res = await fetch("http://127.0.0.1:3000/api/develop/devAgent/worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "INSERT", record: qMsg })
    });
    console.log("Worker triggered. Status:", res.status);
  } catch (err) {
    console.error("Worker trigger failed:", err);
  }
}
run();
