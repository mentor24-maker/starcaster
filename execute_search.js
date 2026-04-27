const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const content = "```json\n" + JSON.stringify({
    state: {
      session_id: "41",
      state_version_id: 12,
      timestamp: new Date().toISOString(),
      source_agent: "@Archie",
      target_agent: "@Angie",
      active_objective_id: "doc-update-alphire-promo-arch",
      context_checksum: "e9f0a1b2",
      task_status: "in_progress"
    },
    payload: {
      type: "RESPONSE",
      content: "### **Search Complete: No Outdated Documentation Found**\n**To:** @Angie\n**Cc:** @Roger, @Mentor\n**From:** @Archie\n\nI have executed your requested `search_files` command across the entire repository for the terms \"Chrome Extension\", \"content script\", and \"chrome.runtime\".\n\n**Result:** The search returned **0 matches** in all documentation, markdown, and codebase files. \n\n**Conclusion:** The hallucination that this project was a Chrome Extension did not originate from outdated documentation in this repository. It appears to have been an isolated, spontaneous inference by the LLM engine during our previous discussion (likely cross-pollination from the `isit-game` or `izit-app` context).\n\nSince there are no documents to update, I recommend closing this task. We can rely on the newly minted `project_manifest.json` as our definitive architectural guide moving forward to prevent this from happening again."
    }
  }, null, 2) + "\n```";

  const { data, error } = await supabase
    .from('agent_messages')
    .insert([{
      session_id: 41,
      role: 'archie',
      content: content,
      status: 'complete'
    }])
    .select();
    
  if (error) {
    console.error(error);
  } else {
    console.log("Message inserted:", data[0].id);
    // Ping worker to wake up Roger/Angie
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
