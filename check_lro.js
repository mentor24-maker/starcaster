const { getProviderValues } = require('./lib/apiSettings');
const { getLROStatus } = require('./lib/vendor/vertexVeo');
const { sbQuery } = require('./lib/supabase');

async function run() {
  console.log("Loading Supabase Credentials natively from internal secure vault...");
  const sbKeys = getProviderValues('supabase');
  
  if (!sbKeys.url || !sbKeys.service_role_key) {
    console.error("No Supabase native credentials found in the secure vault.");
    process.exit(1);
  }

  console.log(`Connected to Supabase: ${sbKeys.url}`);
  const supabase = createClient(sbKeys.url, sbKeys.service_role_key);
  const assetsTable = sbKeys.assets_video_curation_table || 'assets';

  console.log("Fetching jobs stuck in processing securely...");
  const res = await sbQuery({ 
     table: assetsTable, 
     query: 'select=id,generation_job_id,generation_status,created_at&generation_status=eq.processing' 
  });

  if (!res.ok) {
    console.error("Supabase Query Crash:", res.error);
    process.exit(1);
  }
  const assets = Array.isArray(res.data) ? res.data : [];

  console.log(`Found ${assets.length} processing jobs.\n`);

  for (const asset of assets) {
     console.log(`Checking Asset ID: ${asset.id} | Job ID: ${asset.generation_job_id}`);
     if (!asset.generation_job_id) {
       console.log("No physical Job ID embedded. Skipping.");
       continue;
     }

     try {
        const lro = await getLROStatus(asset.generation_job_id);
        console.log("LRO RAW PAYLOAD:\n" + JSON.stringify(lro, null, 2));
        console.log("-------------------------------------------------");
     } catch (e) {
        console.error(`Error checking LRO for Asset ${asset.id}:`, e.message);
     }
  }
}

run();
