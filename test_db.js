require('dotenv').config({ path: '/Users/mentor/Desktop/ISITAS/Development/alphire-promo/.env' });
const { sbQuery } = require('./lib/supabase');

async function test() {
  const res = await sbQuery({ method: 'GET', table: 'harvest_youtube_videos', query: 'select=video_url,title,created_at&order=created_at.desc&limit=5' });
  console.log("VIDEOS:", JSON.stringify(res, null, 2));

  const res2 = await sbQuery({ method: 'GET', table: 'harvest_youtube_details', query: 'select=video_url,title,created_at&order=created_at.desc&limit=5' });
  console.log("DETAILS:", JSON.stringify(res2, null, 2));
}
test().catch(console.error);
