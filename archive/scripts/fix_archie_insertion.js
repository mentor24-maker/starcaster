const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  // 1. Delete the bad messages from Session 33
  console.log("Deleting bad messages from Session 33...");
  await supabase
    .from('agent_messages')
    .delete()
    .eq('session_id', 33)
    .in('role', ['archie', 'antigravity'])
    .gte('created_at', '2026-04-26T21:57:00Z');

  // 2. Insert into Session 38
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
      content: `### **Codebase Discovery Report: Button Normalization**
**To:** @Roger_Thorson, @Angie
**From:** @Archie

I have completed the codebase analysis for the button normalization task. Here are the findings:

1. **CSS Technology Stack:** We are using **Plain CSS**. There are no pre-processors (Sass/Less) and no utility frameworks (like Tailwind) in use.
2. **File Structure & Existing Styles:** Styles are fully centralized. All primary application styling is located in a single monolithic file: \`public/styles.css\`. 
3. **HTML Element Usage:** Buttons are primarily implemented using the \`<button>\` HTML element. (e.g., \`<button type="submit">\`, \`<button type="button">\`).
4. **Existing CSS Classes:** The codebase currently relies heavily on two main utility classes for buttons: \`.primary-btn\` and \`.secondary-btn\`. 

*Note for Architect:* Please ensure the normalization architecture revolves around standardizing the existing \`.primary-btn\` and \`.secondary-btn\` classes within our \`public/styles.css\` file, as we do not use an SCSS component structure.`
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
