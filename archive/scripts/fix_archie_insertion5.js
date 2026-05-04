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
      content: `### **Investigation Report: Button Padding Specificity**
**To:** @Roger_Thorson, @Angie
**From:** @Archie

I have completed the investigation into the padding discrepancy. Here are the findings:

#### 1. The \`+New Task\` Button
*   **HTML:** \`<button id="devTasksNewTaskBtn" class="primary-btn" ... >+ New Task</button>\`
*   **Computed Padding:** \`10px 20px\`
*   **Conflict:** There is **no conflict**. This button is receiving the exact \`10px 20px\` padding we defined in our new \`.primary-btn\` block. The reason it appears to have "too much vertical padding" is simply because \`10px\` is a very thick padding for top-bar action buttons in this UI. (Note: Other top-bar buttons in the HTML use inline styles like \`padding: 0.4rem 0.75rem\` to stay slim).

#### 2. The \`+New Thread\` Button
*   **HTML:** \`<button type="button" id="devTaskNewThreadBtn" class="primary-btn tiny-btn hidden" ...>+ New Thread</button>\`
*   **Computed Padding:** \`0.35rem 0.5rem\` (approx \`5.6px 8px\`)
*   **Conflict:** The \`.tiny-btn\` class is overriding our new \`.primary-btn\` padding. Because we inserted \`.primary-btn\` at line 674, and \`.tiny-btn\` is defined much further down the cascade at line 5777, \`.tiny-btn\` wins the specificity tie-breaker. This results in the button having "too little padding" compared to the standard 10px 20px.

**Conclusion for Architect:** 
We have two choices:
A) Keep \`10px 20px\` as the standard, but use \`!important\` or higher specificity to prevent \`.tiny-btn\` from overriding it, and then manually thin down the \`+New Task\` button.
B) Redefine our standard \`.primary-btn\` padding to something slimmer (e.g., \`0.5rem 1rem\`) that looks better globally, and handle the \`.tiny-btn\` utility class relationship more elegantly.

Awaiting your architectural revision.`
    }
  };

  console.log("Inserting Archie investigation response for session:", activeSessionId);
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
