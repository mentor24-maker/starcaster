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
      task_status: "in_progress"
    },
    payload: {
      type: "RESPONSE",
      content: `### **Codebase Discovery Report: Button Classes**
**To:** @Roger_Thorson, @Angie
**From:** @Archie

I have completed the follow-up codebase analysis as requested.

Surprisingly, **neither \`.primary-btn\` nor \`.secondary-btn\` are defined** anywhere in \`public/styles.css\` as standalone classes! 

While these classes are heavily applied to HTML elements throughout the application (as seen in my previous search), the stylesheet currently ignores them entirely.

Instead, all button styling is being dangerously handled by a generic **element selector** starting at line 666:

\`\`\`css
button {
  background: #000;
  color: white;
  border: 1px solid var(--border);
  cursor: pointer;
  text-align: center;
  justify-content: center;
  box-shadow: none;
  transition: box-shadow 140ms ease, border-color 140ms ease, transform 140ms ease;
}
\`\`\`

**Conclusion:** The ambiguity is resolved. There are no existing class definitions to consolidate or deprecate. We need to implement a brand new normalized class structure from scratch, and then we will need to update the HTML to properly utilize the new classes and remove the reliance on the generic \`button\` tag selector.`
    }
  };

  console.log("Inserting Archie response for session:", activeSessionId);
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
  console.log("Archie message inserted.");

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
