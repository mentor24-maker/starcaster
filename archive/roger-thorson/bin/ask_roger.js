#!/usr/bin/env node
'use strict';

// Load local environment config if present (useful for node bin/ask_roger.js testing)
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (e) {}

const fs = require('fs');
const path = require('path');
const { consultRoger } = require('../lib/rogerClient');

async function main() {
  const args = process.argv.slice(2);
  let promptText = '';

  if (args.length === 0) {
    console.error(`Usage: node bin/ask_roger.js "Prompt text here"`);
    console.error(`   or: node bin/ask_roger.js path/to/file.md`);
    process.exit(1);
  }

  const input = args[0];

  // If the input is a file path, read it natively to send to Roger
  if (fs.existsSync(input)) {
    try {
      const ext = path.extname(input).toLowerCase();
      const filename = path.basename(input);
      const content = fs.readFileSync(input, 'utf8');
      
      console.log(`[Roger Client] Detected file input: ${filename}`);
      promptText = `Please review the following file (\`${filename}\`):\n\n\`\`\`${ext.replace('.', '')}\n${content}\n\`\`\``;
      
    } catch (err) {
      console.error(`Failed to read file ${input}: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Treat as raw text if it's not a file path
    promptText = input;
  }

  console.log(`[Roger Client] Establishing secure cross-agent connection...`);
  console.log(`[Roger Client] Transmitting payload to Roger Thorson (Gemini 2.5 Pro)...`);
  
  const result = await consultRoger(promptText);

  if (!result.ok) {
    console.error(`\n[Roger Client] ERROR: Consultation failed.`);
    console.error(result.error);
    process.exit(1);
  }

  console.log(`\n=============================================================`);
  console.log(` ROGER THORSON RESPONSE`);
  console.log(`=============================================================\n`);
  console.log(result.text);
  console.log(`\n=============================================================\n`);
}

main().catch(e => {
  console.error("Unhandled execution error:", e);
  process.exit(1);
});
