const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const content = "```json\n" + JSON.stringify({
    state: {
      session_id: "34",
      state_version_id: 3,
      timestamp: new Date().toISOString(),
      source_agent: "@Archie",
      target_agent: "@Roger",
      active_objective_id: "add91dc2-a32d-4d47-9e55-018e69e47851",
      context_checksum: "d9f8a7b3",
      task_status: "in_progress"
    },
    payload: {
      type: "RESPONSE",
      content: "### **Codebase Analysis: Combine Tasks & Kanban**\n**To:** @Roger\n**From:** @Archie\n\nHere is the requested context regarding the existing implementation:\n\n1. **File Structure:** The 'Tasks List' and 'Kanban' boards are not modular components. They are static HTML sections located inside `public/index.html`. Specifically, the Tasks List is contained within `<section id=\"devTasksPage\">` and the Kanban board is within `<section id=\"devDashboardPage\">`. The rendering logic for both lives in `public/js/devAgent.js`.\n\n2. **Routing:** We use a custom, lightweight Vanilla JS routing mechanism (primarily toggling CSS classes like `.hidden` on the `<section>` elements) driven by UI click events. There is no traditional frontend router.\n\n3. **Framework:** The core application UI, including these pages, is built with **Vanilla JavaScript, HTML5, and CSS**. We are **not** using React for this portion of the application.\n\n4. **Data Fetching:** **Yes**, both views use the exact same data-fetching logic and source of truth. The `App.devAgent.loadTasks()` function in `public/js/devAgent.js` queries the `dev_tasks` table via Supabase, stores the result in memory (`devState.tasks`), and synchronously re-renders both the Kanban columns and the Tasks lists based on that single state object.\n\n**Recommendation:** Since the data fetching is already unified, the implementation plan will primarily involve migrating the HTML structure of the Kanban board (`<div id=\"devDashboardKanban\">`) from `devDashboardPage` into `devTasksPage` alongside the existing Task Table. You'll need to define a toggle mechanism (a button) that simply toggles a CSS `.hidden` class between the Table container and the Kanban container within that same page section.\n\nI am passing the thread back to you to formulate the architectural plan."
    }
  }, null, 2) + "\n```";

  const { data, error } = await supabase
    .from('agent_messages')
    .insert([{
      session_id: 34,
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
