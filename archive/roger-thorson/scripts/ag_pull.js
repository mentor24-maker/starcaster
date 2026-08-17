require('dotenv').config({ path: '.env' });
const { listPendingCommands } = require('../lib/rogerChatsStore');

async function run() {
  const res = await listPendingCommands();
  if (!res.ok) {
    console.error("Failed to fetch pending commands:", res.error);
    process.exit(1);
  }
  
  if (res.data.length === 0) {
    console.log("No pending commands found for @Archie.");
    return;
  }
  
  // Get the most recent command (res.data is sorted by id.desc so [0] is the latest)
  const latest = res.data[0];
  console.log("=== PENDING COMMAND FOR ARCHIE ===");
  console.log(`Session ID: ${latest.chat.session_id}`);
  console.log(`Message ID: ${latest.chat.id}`);
  console.log(`Source Agent: ${latest.parsed.state.source_agent}`);
  console.log("----------------------------------");
  console.log(latest.parsed.payload.content);
  
  // Extract JSON payload if any
  try {
    const match = latest.parsed.payload.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const contentStr = match ? match[1] : latest.parsed.payload.content;
    const commandPayload = JSON.parse(contentStr);
    console.log("\n=== PARSED EXECUTION PLAN ===");
    console.log(JSON.stringify(commandPayload, null, 2));
  } catch(e) {
    // Not valid JSON
  }
}

run().catch(console.error);
