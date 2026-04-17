require('dotenv').config();
const { sbQuery, tableConfig } = require('./lib/supabase');
const { getLROStatus } = require('./lib/vendor/vertexVeo');

async function run() {
  console.log("Fetching processing assets...");
  try {
     const t = tableConfig();
     const res = await sbQuery({ table: t.assets, query: 'select=id,generation_job_id,generation_status,created_at&generation_status=eq.processing' });
     if (!res.ok) {
        console.error("Failed to query DB:", res.error);
        process.exit(1);
     }
     
     const assets = Array.isArray(res.data) ? res.data : [];
     console.log(`Found ${assets.length} processing jobs.\n`);
     
     for (const asset of assets) {
        console.log(`Checking Asset ID: ${asset.id} | Job ID: ${asset.generation_job_id}`);
        try {
           const lro = await getLROStatus(asset.generation_job_id);
           console.log(JSON.stringify(lro, null, 2));
           console.log("-------------------------------------------------");
        } catch (e) {
           console.error(`Error checking LRO for Asset ${asset.id}:`, e.message);
        }
     }
  } catch (err) {
    console.error("Script failed:", err);
  }
}

run();
