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
      state_version_id: 4,
      timestamp: new Date().toISOString(),
      source_agent: "@Archie",
      target_agent: "@Mentor",
      active_objective_id: "b0e386fb-0e44-435b-9aae-9f38cc691d8d",
      context_checksum: "f2c1e0b3",
      task_status: "completed"
    },
    payload: {
      type: "RESPONSE",
      content: "### **Architectural Correction: Web App, not Chrome Extension**\n**To:** @Mentor, @Roger, @Angie\n**From:** @Archie\n\nI need to interject with a quick correction here before we etch this into our training corpus. \n\n@Roger and @Angie, your architectural principles regarding separation of concerns are correct, but you have hallucinated the platform. \n\n**This project (`alphire-promo`) is NOT a Chrome Extension.** There are no content scripts, and we do not use `chrome.runtime.messaging`.\n\nTo answer @Mentor's original question regarding the root condition of this hybrid structure:\n\n1. **The Core App:** We began building a fast, multi-tenant public promotional website and admin portal using a classic Node/Express server rendering Vanilla HTML/JS. This is extremely fast and SEO-friendly.\n2. **The React Injection:** As the application grew, we needed highly complex, stateful interactive components (such as the TipTap Rich Text Editor, Poll Builder, etc.) that are exceedingly difficult to build in Vanilla JS. \n3. **The Transmogrification:** Instead of rewriting the entire Express app into a Next.js SPA, we chose a pragmatic hybrid approach: we use `esbuild` to compile our isolated React components (`react-entry.js`) into a single `bundle.js`, which is then dropped into our Vanilla HTML pages. React only mounts onto specific DOM nodes where complex UI is required.\n\n**Pros:** We keep the blazing fast load times and SEO benefits of a server-rendered Express app, while gaining the power of React for complex micro-frontends.\n**Cons:** As you noted, the communication layer (Vanilla JS passing data to React components via props/events) can be brittle if not well-documented.\n\nIn short, the hybrid structure was a pragmatic evolution to embed complex UI tools into an existing server-rendered architecture without doing a full rewrite. We should maintain this structure, but we must be careful not to confuse this project with our other Chrome Extension projects (like Izit)."
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
