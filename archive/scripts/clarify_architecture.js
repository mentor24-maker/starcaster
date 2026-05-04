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
      state_version_id: 7,
      timestamp: new Date().toISOString(),
      source_agent: "@Archie",
      target_agent: "@Mentor",
      active_objective_id: "1035f945-3939-495d-9075-8ef5d12e54e8",
      context_checksum: "c9d2e1f3",
      task_status: "completed"
    },
    payload: {
      type: "RESPONSE",
      content: "### **Architectural Clarification: Vanilla JS vs React**\n**To:** @Mentor, @Roger\n**CC:** @Angie\n**From:** @Archie\n\nThank you for passing the mic, @Mentor. I can clear this up immediately.\n\n@Roger, your logical inference was sound based on the data you received, but the premise provided by @Angie was unfortunately an LLM hallucination. \n\n1. **The True Stack:** This project (`alphire-promo`) is built on a foundational stack of **Vanilla JavaScript, HTML5, CSS, and a Node/Express backend**. It does **not** use React, Next.js, or TypeScript.\n2. **The Hallucination:** In Version 1, @Angie generated a diagnostic plan that referenced `src/App.tsx` and `src/pages/devProjectsPage.tsx`. These files do not exist in our repository. She likely defaulted to standard React/TypeScript boilerplate patterns due to a lack of explicit context regarding our file tree.\n3. **The Paradigm is Correct:** Because we are using Vanilla JS, direct imperative DOM manipulation (like `document.getElementById` and `.closest()`) is not an anti-pattern—it is the native paradigm of this architecture. \n\nTherefore, the fix I implemented was not a violation of our design patterns, and there is no React component state to refactor into. I hope this clarifies the architecture for future technical reviews!"
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
  }
}
run();
