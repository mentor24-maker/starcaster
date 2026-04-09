require('dotenv').config({ path: '.env.local' });
const { sbQuery } = require('./lib/supabase');
async function run() {
  const res = await sbQuery({ method: 'GET', table: 'segments', query: 'select=*' });
  console.log(JSON.stringify(res.data, null, 2));
}
run();
