const { sbQuery } = require('../lib/supabase');

async function run() {
  const res = await sbQuery({ method: 'GET', table: 'assets_video_curation', query: 'select=video_id,score,positive_feedback' });
  console.log(res.data);
}
run();
