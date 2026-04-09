const { sbQuery } = require('./lib/supabase');
async function run() {
  const res = await sbQuery({ table: 'segments', query: 'select=*&order=created_at.desc' });
  console.log(JSON.stringify(res.data, null, 2));
}
run();
