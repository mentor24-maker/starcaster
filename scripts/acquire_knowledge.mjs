import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Provide absolute paths setup for ES module execution context if run natively
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bind to local env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error("Missing required environment variables (SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY). Ensure .env is populated.");
  process.exit(1);
}

// Clean key formatting string escaping issues from CI copies
const cleanServiceKey = SUPABASE_KEY.replace(/\\n/g, '').trim();

function getFilesByExt(dirPath, extArray, fileList = []) {
  if (!fs.existsSync(dirPath)) return fileList;
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    const ext = path.extname(dirPath).toLowerCase();
    if (extArray.includes(ext)) {
      fileList.push(dirPath);
    }
    return fileList;
  }
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    if (file === 'node_modules' || file === '.git') continue;
    const fullPath = path.join(dirPath, file);
    const childStat = fs.statSync(fullPath);
    if (childStat.isDirectory()) {
      getFilesByExt(fullPath, extArray, fileList);
    } else {
      const ext = path.extname(file).toLowerCase();
      if (extArray.includes(ext)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

// Interface natively with OpenAI directly without heavy package installs
async function getEmbedding(text) {
  const req = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({
      input: text.replace(/\n/g, ' '), // Baseline string normalization
      model: 'text-embedding-3-small' // Produces native 1536 dimension vector mappings
    })
  });
  const data = await req.json();
  if (data.error) {
    throw new Error(`OpenAI Error: ${data.error.message}`);
  }
  return data.data[0].embedding;
}

// Push directly via POST schema REST instead of requiring @supabase/supabase-js
async function uploadToSupabase(record) {
  const req = await fetch(`${SUPABASE_URL}/rest/v1/training_corpus`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': cleanServiceKey,
      'Authorization': `Bearer ${cleanServiceKey}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(record)
  });
  
  if (!req.ok) {
    const errorText = await req.text();
    throw new Error(`Supabase Context Overwrite Error (${req.status}): ${errorText}`);
  }
}

// Essential string splitting algorithm. Vector endpoints (like Ada and text-embedding-3) have token limits.
// Chunking ensures extremely dense documents (like large source code files) are correctly semantically segmented before indexing.
function chunkText(text, maxChars = 3500) {
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    let nextIndex = index + maxChars;
    if (nextIndex < text.length) {
      let breakPoint = text.lastIndexOf('\n', nextIndex);
      if (breakPoint > index + (maxChars / 2)) {
         nextIndex = breakPoint;
      }
    }
    chunks.push(text.substring(index, nextIndex));
    index = nextIndex;
  }
  return chunks;
}

async function clearSupabaseCorpus() {
  console.log("🧹 Wiping previous knowledge records...");
  const req = await fetch(`${SUPABASE_URL}/rest/v1/training_corpus?id=not.is.null`, {
    method: 'DELETE',
    headers: {
      'apikey': cleanServiceKey,
      'Authorization': `Bearer ${cleanServiceKey}`
    }
  });
  if (!req.ok) {
    const errorText = await req.text();
    console.error(`Warning: Could not clear previous corpus (${req.status}): ${errorText}`);
  }
}

async function run() {
  console.log("🧠 Core Tri-Agent Context Acquirer Initiated...");

  await clearSupabaseCorpus();

  const os = await import('os');
  const targetDirs = [
    { dir: path.resolve(__dirname, '../docs'), type: 'Architecture & Rules', exts: ['.md', '.sql'] },
    { dir: path.join(os.homedir(), '.gemini/antigravity/knowledge'), type: 'Knowledge Item', exts: ['.md'] },
    { dir: path.resolve(__dirname, '../public/js'), type: 'Frontend Logic', exts: ['.js'] },
    { dir: path.resolve(__dirname, '../routes'), type: 'Backend API', exts: ['.js'] },
    { dir: path.resolve(__dirname, '../lib'), type: 'Backend Logic', exts: ['.js'] },
    { dir: path.resolve(__dirname, '../src/pages'), type: 'Frontend HTML', exts: ['.html'] },
    { dir: path.resolve(__dirname, '../src/layout.html'), type: 'Frontend HTML', exts: ['.html'] },
    { dir: path.resolve(__dirname, '../server.js'), type: 'Server Logic', exts: ['.js'] },
    { dir: path.resolve(__dirname, '../app.js'), type: 'Frontend Logic', exts: ['.js'] }
  ];

  let totalUploaded = 0;

  for (const target of targetDirs) {
    const files = getFilesByExt(target.dir, target.exts);
    for (const file of files) {
      console.log(`\nScanning Data Profile -> ${path.basename(file)}`);
      const rawText = fs.readFileSync(file, 'utf-8');
      if (!rawText.trim()) continue;

      const chunks = chunkText(rawText);
      const filename = path.basename(file);
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const recordTitle = chunks.length > 1 ? `${filename} (Part ${i+1})` : filename;
        
        try {
          const vector = await getEmbedding(chunk);
          
          await uploadToSupabase({
            title: recordTitle,
            source_type: target.type,
            category: 'Alpha_Knowledge_Base',
            content_text: chunk,
            embedding: vector, 
            metadata: { filepath: file.replace(path.resolve(__dirname, '../'), ''), chunk_index: i, pipeline: 'acquire_knowledge.js' }
          });
          totalUploaded++;
          console.log(`   ✔️ Vector alignment secured -> chunk ${i+1}/${chunks.length}`);
        } catch (e) {
          console.error(`   ❌ Failed synchronization: ${e.message}`);
        }
      }
    }
  }
  console.log(`\n✅ Knowledge pipeline resolved. Added ${totalUploaded} context tokens to the Supabase layer.`);
}

run();
