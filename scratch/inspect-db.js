require('dotenv').config();
const { sbQuery } = require('../lib/supabase');
async function run() {
  const r = await sbQuery({ method: 'GET', table: 'assets_video_curation', query: 'select=video_id,score,positive_feedback,topic' });
  console.log("Response:", JSON.stringify(r, null, 2));
}
run();
