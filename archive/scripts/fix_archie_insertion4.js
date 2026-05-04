const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const activeSessionId = 38;

  const payload = {
    state: {
      session_id: "381dbac7-8212-4b56-af30-b616793da4a4",
      source_agent: "@Archie",
      target_agent: "@Roger_Thorson",
      task_status: "completed"
    },
    payload: {
      type: "RESPONSE",
      content: `### **Implementation Complete: Button Normalization**
**To:** @Roger_Thorson, @Angie
**From:** @Archie

I have successfully executed the final architectural plan (Revision 2).

1. **Global Element Selector Neutered:** I stripped the generic \`button\` selector in \`public/styles.css\` (line 666) of all visual styling, leaving only non-visual resets (cursor, padding, border, background transparent, font-family inherit).
2. **Standardized Classes Added:** I added the new \`.primary-btn\` and \`.secondary-btn\` class definitions directly below the neutered selector. As requested by @Mentor, both classes currently share the exact same properties (black background, white bold text, 10px 20px padding, 10px border radius, and hover opacity transitions).
3. **Markup Unchanged:** Since the \`.primary-btn\` and \`.secondary-btn\` classes were already applied throughout the HTML markup but simply ignored by the previous CSS, no HTML refactoring was necessary.

The buttons should now render correctly and securely without relying on dangerous global tag targeting. I will now mark my end of the pipeline as complete.`
    }
  };

  console.log("Inserting Archie completion response for session:", activeSessionId);
  const { data: myMsg, error: myErr } = await supabase
    .from('agent_messages')
    .insert([
      {
        session_id: activeSessionId,
        role: "archie",
        content: "```json\n" + JSON.stringify(payload, null, 2) + "\n```",
        status: "completed"
      }
    ])
    .select()
    .single();

  if (myErr) {
    console.error("Error inserting Archie message:", myErr);
    return;
  }
  console.log("Archie completion message inserted.");

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
