import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing required environment variables (SUPABASE_URL, SUPABASE_SERVICE_KEY).");
  process.exit(1);
}

const cleanServiceKey = SUPABASE_KEY.replace(/\\n/g, '').trim();

async function fetchFrictionLogs() {
  const req = await fetch(`${SUPABASE_URL}/rest/v1/roger_friction_logs?status=eq.open&order=created_at.desc`, {
    method: 'GET',
    headers: {
      'apikey': cleanServiceKey,
      'Authorization': `Bearer ${cleanServiceKey}`
    }
  });
  
  if (!req.ok) {
    throw new Error(`Failed to map Friction logs from PostgreSQL: ${await req.text()}`);
  }
  return await req.json();
}

async function run() {
  console.log("🔻 Ask Roger Synchronizer Initiated (Reverse Pull Pipeline)...");
  
  const transcriptDir = path.resolve(__dirname, '../docs/roger_transcripts');
  if (!fs.existsSync(transcriptDir)) {
    fs.mkdirSync(transcriptDir);
  }

  try {
    const activeFrictionLogs = await fetchFrictionLogs();
    
    if (activeFrictionLogs.length === 0) {
      console.log("   -> No new open friction logs detected from Roger.");
      return;
    }

    console.log(`Discovered ${activeFrictionLogs.length} active anomalies... Extracting configurations into local framework IDE...`);

    let pulledCount = 0;
    for (const log of activeFrictionLogs) {
      // Create explicit MD documentation payload for local IDE indexing
      const markdownPayload = `
# Friction Log: ${log.title || 'Undefined Core Incident'}
**Status:** ${log.status}  
**App Section:** ${log.section || '-'}  
**Logged At:** ${new Date(log.created_at).toLocaleString()}  
**Database Binding ID:** \`${log.id}\`  

## System Description
${log.description}

## Internal Resolution Strategy mapped by Roger
${log.resolution_notes || "*Roger hasn't defined an explicit path. Needs logical alignment from Antigravity.*"}
`;
      const safeFilename = (log.title || 'friction').toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
      const filePath = path.join(transcriptDir, `log_${safeFilename}_${log.id.substring(0, 5)}.md`);
      
      fs.writeFileSync(filePath, markdownPayload.trim());
      console.log(`   ✔️ Extracted explicit context node -> ${path.relative(path.resolve(__dirname, '../'), filePath)}`);
      pulledCount++;
    }

    console.log(`\n✅ Synchronization complete. Downloaded ${pulledCount} isolated incident reports.`);
    console.log(`💡 Usage Directive: Tell agent Antigravity "@antigravity address the friction events in docs/roger_transcripts/" to resolve these bounds!`);
  } catch(e) {
    console.error("Pipeline failure:", e.message);
  }
}

run();
