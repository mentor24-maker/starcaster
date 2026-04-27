require('dotenv').config({ path: '.env' });
const fs = require('fs');
const { createRogerChat } = require('../lib/rogerChatsStore');

async function run() {
  const args = process.argv.slice(2);
  let sessionId = null;
  let targetAgent = '@Angie';
  let messageFile = null;
  let messageContent = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session' && args[i+1]) {
      sessionId = args[i+1];
      i++;
    } else if (args[i] === '--target' && args[i+1]) {
      targetAgent = args[i+1];
      i++;
    } else if (args[i] === '--file' && args[i+1]) {
      messageFile = args[i+1];
      i++;
    } else if (!args[i].startsWith('--')) {
      messageContent = args[i];
    }
  }

  if (!sessionId) {
    console.error("Usage: node ag_push.js --session <id> [--target @Angie] [--file path.md | 'Inline message']");
    process.exit(1);
  }

  if (messageFile) {
    try {
      messageContent = fs.readFileSync(messageFile, 'utf8');
    } catch (e) {
      console.error(`Failed to read file: ${messageFile}`);
      process.exit(1);
    }
  }

  if (!messageContent) {
    console.error("Error: Message content is empty.");
    process.exit(1);
  }

  const triAgentPayload = {
    state: {
      target_agent: targetAgent
    },
    payload: {
      type: "RESPONSE",
      content: messageContent
    }
  };

  const finalContent = "```json\n" + JSON.stringify(triAgentPayload, null, 2) + "\n```";

  console.log(`Pushing response to Session ${sessionId} targeted at ${targetAgent}...`);
  
  const res = await createRogerChat({
    session_id: sessionId,
    role: 'archie',
    content: finalContent
  });

  if (res.ok) {
    console.log("Success! Response pushed to database.");
    
    // Now create the processing nodes to wake up the agents
    let rolesToWake = [];
    if (targetAgent.toLowerCase().includes('@all')) {
       rolesToWake = ['antigravity', 'angie'];
    } else if (targetAgent.toLowerCase().includes('angie')) {
       rolesToWake = ['angie'];
    } else {
       rolesToWake = ['antigravity'];
    }

    for (const roleToWake of rolesToWake) {
      console.log(`Waking up ${roleToWake}...`);
      const triggerNodeRes = await createRogerChat({
        session_id: sessionId,
        role: roleToWake,
        status: 'processing',
        content: '[SYSTEM::PROCESSING]'
      });

      if (triggerNodeRes.ok) {
         const triggerRes = await fetch('http://localhost:3000/api/develop/devAgent/worker', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ type: 'INSERT', record: triggerNodeRes.data })
         });
         console.log(`Worker trigger status for ${roleToWake}: ${triggerRes.status}`);
      } else {
         console.error(`Failed to create processing node for ${roleToWake}:`, triggerNodeRes.error);
      }
    }
  } else {
    console.error("Database insert failed:", res.error);
  }
}

run().catch(console.error);
