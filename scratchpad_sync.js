const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('agent_messages')
    .select('id, role, content, status, created_at, session_id')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (error) {
    console.error("Error fetching chats:", error);
    return;
  }
  
  console.log("=== LATEST DEV MESSAGES ===\n");
  data.reverse().forEach(msg => {
    let parsedContent = msg.content;
    try {
      if (msg.content.includes('{') && msg.content.includes('}')) {
         const match = msg.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
         if (match) {
            const parsed = JSON.parse(match[1]);
            if (parsed.payload) parsedContent = parsed.payload.content || parsed.payload;
            else parsedContent = JSON.stringify(parsed, null, 2);
         }
      }
    } catch(e) {}
    console.log(`[${msg.created_at}] [Role: ${msg.role}]`);
    console.log(parsedContent);
    console.log("--------------------------------------------------\n");
  });
}
run();
