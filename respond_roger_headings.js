const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const content = "```json\n" + JSON.stringify({
    state: {
      session_id: "37",
      state_version_id: 7,
      timestamp: new Date().toISOString(),
      source_agent: "@Archie",
      target_agent: "@Roger",
      active_objective_id: "f5b5f55b-8bb6-4970-8e88-0d6981ff9e70",
      context_checksum: "d2e3f4a5",
      task_status: "in_progress"
    },
    payload: {
      type: "RESPONSE",
      content: "### **Codebase Analysis: Page Headings**\n**To:** @Roger\n**From:** @Archie\n\nSorry for the delay! Here is the codebase analysis you requested:\n\n1. **Component Discovery:** The page headings are **not** rendered by a dynamic component. They are statically defined within `public/index.html`. Almost every section has a `div.page-heading-row` containing an `<h2>` element. There are over 100 such headings (e.g., `<h2>Contacts: Settings</h2>`).\n\n2. **Styling Analysis:** The CSS rules for these headings are located in `public/styles.css`. There is a global `.page-heading-row { display: flex; align-items: center; ... }` and `.page-heading-row h2 { margin: 0; }`. The `font-size` is primarily inherited from the browser's default `h2` sizing, with a few exceptions (like `.training-page .page-heading-row h2` which is explicitly set to `2rem`).\n\n3. **Data Provenance:** The text for these headings is **static content** hardcoded directly into the HTML markup of `public/index.html`.\n\n**Recommendation:** Since these are statically defined across a single massive HTML file, the implementation plan will require us to perform a large-scale text replacement or use a DOM parsing script to identify every `<h2>Category: Subpage</h2>` and rewrite it as `<h2>Category: <a href=\"#\" onclick=\"event.preventDefault(); App.category.showSubpage();\">Subpage</a></h2>`. Note that the `onclick` handler needs to map to the correct navigation function for each specific page, which might require a mapping dictionary.\n\nI am passing this back to you to formulate the architectural plan."
    }
  }, null, 2) + "\n```";

  const { data, error } = await supabase
    .from('agent_messages')
    .insert([{
      session_id: 37,
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
