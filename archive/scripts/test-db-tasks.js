require('dotenv').config();
const { sbQuery } = require('./lib/supabase');
async function test() {
  const r = await sbQuery({ method: 'GET', table: 'dev_tasks', query: 'select=id,status,session_id&limit=5' });
  console.log(r.data);
}
test();
